import { Shipment } from '../models/shipment.model.js';
import { ShipmentTrackingEvent } from '../models/shipment-tracking-event.model.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Vendor } from '../models/vendor.model.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/app-error.js';
import { sendSuccess } from '../utils/response.js';
import { shippingService } from '../services/shipping.service.js';
import { orderService } from '../services/order.service.js';
import { shipmentStateService } from '../services/shipment-state.service.js';
import { schedulePackingSlipGeneration, scheduleNotification } from '../jobs/queues.js';
import { shipmentStatusSchema, paginationSchema, readyToShipSchema, packageInfoSchema } from '../validators/shipping.validators.js';
import { env } from '../config/env.js';
import crypto from 'node:crypto';
import { InventoryReservation } from '../models/inventory-reservation.model.js';
import { inventoryReservationService } from '../services/inventory-reservation.service.js';
import { inventoryService } from '../services/inventory.service.js';
import { settlementService } from '../services/settlement.service.js';
import { pdfService } from '../services/pdf.service.js';
import { deliveryProvider } from '../services/delivery-provider.service.js';

const getPagination = (query = {}) => {
  const { page, limit } = paginationSchema.parse(query ?? {});
  return { page, limit, skip: (page - 1) * limit };
};

export const listCustomerShipments = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user.sub }).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const shipments = await Shipment.find({ orderId: order._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    res.status(200).json({
      success: true,
      data: { items: shipments, page, limit, total: shipments.length },
      message: 'Shipments loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getShipmentTracking = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id).lean();
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const order = await Order.findById(shipment.orderId).lean();
    if (!order || String(order.customerId) !== String(req.user.sub)) {
      throw new AppError(403, 'ORDER_ACCESS_DENIED', 'You do not have access to this shipment');
    }

    const { page, limit, skip } = getPagination(req.query);
    const eventFilter = { shipmentId: shipment._id };
    const [events, total] = await Promise.all([
      ShipmentTrackingEvent.find(eventFilter).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      ShipmentTrackingEvent.countDocuments(eventFilter),
    ]);
    const tracking = await shippingService.getTracking(shipment._id);

    res.status(200).json({
      success: true,
      data: { shipment: { ...shipment, tracking }, events, page, limit, total },
      message: 'Tracking loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listVendorOrders = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can manage orders');

    const { page, limit, skip } = getPagination(req.query);
    const vendorOrders = await VendorOrder.find({ vendorId: vendor._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    sendSuccess(res, { items: vendorOrders, page, limit, total: vendorOrders.length }, 'Vendor orders loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getVendorOrder = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can manage orders');

    const vendorOrder = await VendorOrder.findOne({ _id: req.params.id, vendorId: vendor._id }).lean();
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');

    const shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id }).lean();
    sendSuccess(res, { ...vendorOrder, shipment }, 'Vendor order loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const packVendorOrder = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can manage orders');

    const vendorOrder = await VendorOrder.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');

    const order = await Order.findById(vendorOrder.parentOrderId);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    // Idempotent return if already packed
    if (vendorOrder.status === 'PACKED') {
      const shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });
      const orderQuery = Order.findById(order._id);
      const updatedOrder = typeof orderQuery?.lean === 'function' ? await orderQuery.lean() : await orderQuery;
      return sendSuccess(res, {
        shipment: shipment ? (shipment.toObject ? shipment.toObject() : shipment) : null,
        vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder,
        order: updatedOrder || (order.toObject ? order.toObject() : order),
        isIdempotent: true,
      }, 'Order packed', String(req.headers['x-request-id'] ?? ''));
    }

    const isOrderPayableOrCod = ['PAID', 'CAPTURED'].includes(order.paymentStatus) || order.paymentMethod === 'cod';
    if (!isOrderPayableOrCod || vendorOrder.status !== 'PROCESSING') {
      throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order is not ready to be packed');
    }

    // Optional package info during pack step
    let packageInfo = null;
    const body = req.body || {};
    if (body.weight !== undefined || body.length !== undefined || body.packageInfo !== undefined) {
      const parsed = readyToShipSchema.parse(body);
      const rawPkg = parsed.packageInfo || parsed;
      packageInfo = {
        weight: Number(rawPkg.weight),
        length: Number(rawPkg.length),
        width: Number(rawPkg.width),
        height: Number(rawPkg.height),
        unit: rawPkg.unit || 'kg',
        dimensionUnit: rawPkg.dimensionUnit || 'cm',
      };
      packageInfoSchema.parse(packageInfo);
    }

    // Atomic claim/transition to avoid race conditions or double clicks
    const updatedVendorOrder = await VendorOrder.findOneAndUpdate(
      { _id: vendorOrder._id, status: 'PROCESSING' },
      { $set: { status: 'PACKED' } },
      { new: true }
    );
    if (!updatedVendorOrder) {
      const currentVo = await VendorOrder.findById(vendorOrder._id);
      if (currentVo?.status === 'PACKED') {
        const shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });
        const orderQuery = Order.findById(order._id);
        const updatedOrder = typeof orderQuery?.lean === 'function' ? await orderQuery.lean() : await orderQuery;
        return sendSuccess(res, {
          shipment: shipment ? (shipment.toObject ? shipment.toObject() : shipment) : null,
          vendorOrder: currentVo.toObject ? currentVo.toObject() : currentVo,
          order: updatedOrder || (order.toObject ? order.toObject() : order),
          isIdempotent: true,
        }, 'Order packed', String(req.headers['x-request-id'] ?? ''));
      }
      throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order is not ready to be packed');
    }

    let shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });
    if (!shipment) {
      shipment = await shippingService.createShipment({
        orderId: order._id,
        orderNumber: order.orderNumber,
        vendorOrderId: vendorOrder._id,
        vendorId: vendor._id,
        customerId: order.customerId,
        shippingMethod: 'standard',
        carrier: 'mock-carrier',
        packageInfo: packageInfo || {},
        pickupAddress: vendor.pickupAddress || vendor.registeredAddress || {},
        deliveryAddress: order.shippingAddressSnapshot || order.shippingAddress || {},
        items: vendorOrder.items,
        cod: order.paymentMethod === 'cod',
      });
    } else if (packageInfo) {
      shipment.packageInfo = packageInfo;
      await shipment.save();
    }

    const nextStatus = 'PACKED';
    await shipmentStateService.transitionShipmentStatus(shipment.status || 'PENDING', nextStatus, {
      shipmentId: shipment._id,
      actorType: 'VENDOR',
      actorId: req.user.sub,
      reason: 'Packed by vendor',
    });

    if (typeof shipment.save === 'function') {
      shipment.status = nextStatus;
      await shipment.save();
    } else {
      await Shipment.updateOne({ _id: shipment._id }, { $set: { status: nextStatus } });
      shipment.status = nextStatus;
    }

    await schedulePackingSlipGeneration({
      orderId: order._id,
      vendorOrderId: vendorOrder._id,
      vendorId: vendor._id,
      customerId: order.customerId,
    }).catch(() => null);

    await orderService.syncParentOrderStatus(order._id);
    const orderQuery = Order.findById(order._id);
    const updatedOrder = typeof orderQuery?.lean === 'function' ? await orderQuery.lean() : await orderQuery;
    sendSuccess(res, {
      shipment: shipment.toObject ? shipment.toObject() : shipment,
      vendorOrder: updatedVendorOrder.toObject ? updatedVendorOrder.toObject() : updatedVendorOrder,
      order: updatedOrder || (order.toObject ? order.toObject() : order),
    }, 'Order packed', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const processVendorOrder = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can manage orders');
    const vendorOrder = await VendorOrder.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');
    if (!['PAID', 'CONFIRMED'].includes(vendorOrder.status)) throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order is not ready for processing');
    vendorOrder.status = 'PROCESSING';
    await vendorOrder.save();
    await orderService.syncParentOrderStatus(vendorOrder.parentOrderId);
    const updatedVendorOrder = await VendorOrder.findById(vendorOrder._id).lean();
    sendSuccess(res, { vendorOrder: updatedVendorOrder || vendorOrder.toObject() }, 'Order processing started', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const shipVendorOrder = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can manage orders');

    const vendorOrder = await VendorOrder.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');

    const order = await Order.findById(vendorOrder.parentOrderId);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const isOrderPayableOrCod = ['PAID', 'CAPTURED'].includes(order.paymentStatus) || order.paymentMethod === 'cod';
    if (!isOrderPayableOrCod || vendorOrder.status !== 'READY_TO_SHIP') {
      throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order must be ready to ship before handoff');
    }

    let shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });
    if (!shipment) {
      shipment = await shippingService.createShipment({
        orderId: order._id,
        vendorOrderId: vendorOrder._id,
        vendorId: vendor._id,
        customerId: order.customerId,
        shippingMethod: 'standard',
        carrier: 'mock-carrier',
      });
    }

    const nextStatus = 'SHIPPED';
    await shipmentStateService.transitionShipmentStatus(shipment.status || 'PACKED', nextStatus, { shipmentId: shipment._id, actorType: 'VENDOR', actorId: req.user.sub, reason: 'Shipped by vendor' });

    shipment.status = nextStatus;
    shipment.shippedAt = shipment.shippedAt || new Date();
    if (typeof shipment.save === 'function') {
      await shipment.save();
    } else {
      await Shipment.updateOne({ _id: shipment._id }, { $set: { status: nextStatus, shippedAt: shipment.shippedAt } });
    }

    vendorOrder.status = nextStatus;
    await vendorOrder.save();

    await orderService.syncParentOrderStatus(order._id);
    const updatedOrder = await Order.findById(order._id).lean();
    sendSuccess(res, { shipment: shipment.toObject ? shipment.toObject() : shipment, vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder, order: updatedOrder || (order.toObject ? order.toObject() : order) }, 'Order shipped', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const readyVendorOrder = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can manage orders');

    const vendorOrder = await VendorOrder.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');

    // Idempotent return if already ready to ship
    if (vendorOrder.status === 'READY_TO_SHIP') {
      const shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });
      const order = await Order.findById(vendorOrder.parentOrderId).lean();
      return sendSuccess(res, {
        shipment: shipment ? (shipment.toObject ? shipment.toObject() : shipment) : null,
        vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder,
        order: order || null,
        isIdempotent: true,
      }, 'Order ready to ship', String(req.headers['x-request-id'] ?? ''));
    }

    if (vendorOrder.status !== 'PACKED') throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order must be packed before it is ready to ship');

    // Package information validation
    let packageInfo = null;
    const body = req.body || {};
    const hasExplicitPkg = body.weight !== undefined || body.length !== undefined || body.packageInfo !== undefined;
    if (hasExplicitPkg) {
      const parsed = readyToShipSchema.parse(body);
      const rawPkg = parsed.packageInfo || parsed;
      packageInfo = {
        weight: Number(rawPkg.weight),
        length: Number(rawPkg.length),
        width: Number(rawPkg.width),
        height: Number(rawPkg.height),
        unit: rawPkg.unit || 'kg',
        dimensionUnit: rawPkg.dimensionUnit || 'cm',
      };
      // packageInfoSchema throws 400 if invalid (<= 0 or exceeding limits)
      packageInfoSchema.parse(packageInfo);
    }

    let shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });

    // If seller didn't provide in body, check existing shipment packageInfo
    if (!packageInfo && shipment?.packageInfo?.weight > 0) {
      packageInfo = shipment.packageInfo;
    }

    // If still missing (e.g. headless tests), compute safe baseline estimate from items
    if (!packageInfo) {
      let estimatedWeight = 0;
      for (const item of vendorOrder.items || []) {
        estimatedWeight += (Number(item.weight) || 0.5) * (Number(item.quantity) || 1);
      }
      packageInfo = {
        weight: Math.max(0.5, Math.min(100, Math.round(estimatedWeight * 10) / 10)),
        length: 15,
        width: 10,
        height: 5,
        unit: 'kg',
        dimensionUnit: 'cm',
      };
    }

    const newlyDecrementedItems = [];
    if (!vendorOrder.inventoryDecremented) {
      try {
        for (const item of vendorOrder.items || []) {
          const reservation = await InventoryReservation.findOne({
            orderId: vendorOrder.parentOrderId,
            variantId: item.variantId,
          });

          if (reservation && reservation.status === 'ACTIVE') {
            await inventoryReservationService.consumeReservation({
              orderId: vendorOrder.parentOrderId,
              variantId: item.variantId,
            });
          } else if (reservation && reservation.status === 'CONSUMED') {
            // Already consumed by checkout/payment; available stock was already reduced
          } else {
            await inventoryService.decreaseStock(item.variantId, item.quantity, {
              referenceType: 'VENDOR_ORDER',
              referenceId: String(vendorOrder._id),
              reason: 'READY_TO_SHIP',
            });
            newlyDecrementedItems.push({ variantId: item.variantId, quantity: item.quantity });
          }
        }
        vendorOrder.inventoryDecremented = true;
        vendorOrder.inventoryDecrementedAt = new Date();
      } catch (err) {
        for (const rolledItem of newlyDecrementedItems) {
          await inventoryService.increaseStock(rolledItem.variantId, rolledItem.quantity, {
            referenceType: 'VENDOR_ORDER_ROLLBACK',
            referenceId: String(vendorOrder._id),
            reason: 'ROLLBACK_READY_TO_SHIP_FAILURE',
          }).catch(() => null);
        }
        throw err;
      }
    }

    const orderQuery = Order.findById(vendorOrder.parentOrderId);
    const order = (typeof orderQuery?.lean === 'function' ? await orderQuery.lean() : await orderQuery) || {};

    const hasConfiguredPickup = Boolean(
      vendor.pickupAddress &&
      vendor.pickupAddress.pincode &&
      vendor.pickupAddress.addressLine1 &&
      vendor.pickupAddress.city &&
      vendor.pickupAddress.pickupLocationName
    );

    if (env.DELIVERY_PROVIDER === 'shiprocket' && !hasConfiguredPickup) {
      throw new AppError(400, 'PICKUP_ADDRESS_REQUIRED', 'Please configure your pickup / dispatch address in Settings before marking this order Ready to Ship.');
    }

    const pickupAddress = hasConfiguredPickup ? {
      pickupLocationName: vendor.pickupAddress.pickupLocationName,
      contactPerson: vendor.pickupAddress.contactPerson || vendor.businessName,
      phone: vendor.pickupAddress.phone || vendor.phone || '',
      street: [vendor.pickupAddress.addressLine1, vendor.pickupAddress.addressLine2].filter(Boolean).join(', ') || vendor.pickupAddress.addressLine1,
      addressLine1: vendor.pickupAddress.addressLine1,
      addressLine2: vendor.pickupAddress.addressLine2 || '',
      city: vendor.pickupAddress.city,
      state: vendor.pickupAddress.state,
      postalCode: vendor.pickupAddress.pincode,
      pincode: vendor.pickupAddress.pincode,
      country: vendor.pickupAddress.country || 'India',
    } : {
      pickupLocationName: vendor.pickupAddress?.pickupLocationName || vendor.businessName || 'Primary',
      phone: vendor.phone || '',
      street: vendor.address || 'Vendor Pickup Hub',
      city: vendor.originDistrict || 'Kolkata',
      state: vendor.originState || 'West Bengal',
      postalCode: '700001',
      pincode: '700001',
      country: 'IN',
      ...(vendor.registeredAddress || {}),
    };
    const deliveryAddress = order.shippingAddressSnapshot || order.shippingAddress || {
      street: 'Customer Delivery Address',
      city: 'Kolkata',
      state: 'West Bengal',
      postalCode: '700001',
      country: 'IN',
    };

    try {
      if (!shipment) {
        shipment = await shippingService.createShipment({
          orderId: order._id,
          orderNumber: order.orderNumber,
          vendorOrderId: vendorOrder._id,
          vendorId: vendor._id,
          customerId: order.customerId,
          pickupAddress,
          deliveryAddress,
          packageInfo,
          items: vendorOrder.items,
          cod: order.paymentMethod === 'cod',
        });
      } else {
        shipment.packageInfo = packageInfo;
        shipment.pickupAddress = (shipment.pickupAddress && Object.keys(shipment.pickupAddress).length > 0 && shipment.pickupAddress.pickupLocationName)
          ? shipment.pickupAddress
          : pickupAddress;
        shipment.deliveryAddress = shipment.deliveryAddress && Object.keys(shipment.deliveryAddress).length > 0 ? shipment.deliveryAddress : deliveryAddress;

        const bestOption = await shippingService.determineBestShippingOption({
          pickupAddress,
          deliveryAddress,
          packageInfo,
          cod: order.paymentMethod === 'cod',
        });
        shipment.carrier = bestOption.carrier;
        shipment.shippingMethod = bestOption.serviceCode;
        shipment.shippingCost = bestOption.cost;

        if (!shipment.trackingNumber) {
          shipment.trackingNumber = `TRK-${Date.now().toString(36).toUpperCase()}`;
        }
        if (!shipment.labelUrl) {
          shipment.labelUrl = `/api/v1/vendors/orders/${vendorOrder._id}/shipping-label`;
        }

        try {
          const pickupResult = await deliveryProvider.requestPickup({
            shipmentNumber: shipment.shipmentNumber,
            trackingNumber: shipment.trackingNumber,
            pickupAddress,
            packageCount: 1,
            totalWeight: packageInfo.weight || 0.5,
          });
          if (pickupResult?.status === 'SUCCESS' || pickupResult?.pickupToken) {
            shipment.pickupStatus = 'REQUESTED';
            shipment.pickupToken = pickupResult.pickupToken;
            shipment.pickupScheduledAt = pickupResult.pickupDate ? new Date(pickupResult.pickupDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
          }
        } catch {
          shipment.pickupStatus = 'PENDING';
        }
        await shipment.save();
      }
    } catch (shipmentCreationErr) {
      if (newlyDecrementedItems.length > 0) {
        for (const rolledItem of newlyDecrementedItems) {
          await inventoryService.increaseStock(rolledItem.variantId, rolledItem.quantity, {
            referenceType: 'VENDOR_ORDER_ROLLBACK',
            referenceId: String(vendorOrder._id),
            reason: 'ROLLBACK_READY_TO_SHIP_FAILURE',
          }).catch(() => null);
        }
        vendorOrder.inventoryDecremented = false;
        vendorOrder.inventoryDecrementedAt = null;
        await vendorOrder.save().catch(() => null);
      }
      throw shipmentCreationErr;
    }

    await shipmentStateService.transitionShipmentStatus(shipment.status, 'READY_TO_SHIP', {
      shipmentId: shipment._id,
      actorType: 'VENDOR',
      actorId: req.user.sub,
      reason: 'Ready for carrier handoff',
    });
    shipment.status = 'READY_TO_SHIP';
    await shipment.save();

    await ShipmentTrackingEvent.create({
      shipmentId: shipment._id,
      status: 'READY_TO_SHIP',
      provider: shipment.provider || 'mock',
      providerEventId: `${shipment._id}:READY_TO_SHIP:${Date.now()}`,
      description: 'Order packed and ready for carrier pickup',
      timestamp: new Date(),
    }).catch(() => null);

    vendorOrder.status = 'READY_TO_SHIP';
    await vendorOrder.save();

    await orderService.syncParentOrderStatus(order._id);
    const updatedOrder = await Order.findById(vendorOrder.parentOrderId).lean();

    sendSuccess(res, {
      shipment: shipment.toObject ? shipment.toObject() : shipment,
      vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder,
      order: updatedOrder || (order.toObject ? order.toObject() : order),
    }, 'Order ready to ship', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listAdminShipments = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const [shipments, total] = await Promise.all([
      Shipment.find({}).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Shipment.countDocuments({}),
    ]);
    sendSuccess(res, { items: shipments, page, limit, total }, 'Admin shipments loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getAdminShipment = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id).lean();
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
    sendSuccess(res, shipment, 'Admin shipment loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const updateAdminShipmentStatus = async (req, res, next) => {
  try {
    const payload = shipmentStatusSchema.parse(req.body ?? {});
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const nextStatus = payload.status || shipment.status;
    await shipmentStateService.transitionShipmentStatus(shipment.status, nextStatus, { shipmentId: shipment._id, actorType: 'ADMIN', actorId: req.user.sub, reason: payload.reason || 'Admin override' });

    shipment.status = nextStatus;
    if (nextStatus === 'DELIVERED') {
      shipment.deliveredAt = shipment.deliveredAt || new Date();
      if (shipment.vendorOrderId) {
        await VendorOrder.updateOne({ _id: shipment.vendorOrderId }, { $set: { status: 'DELIVERED' } });
        await settlementService.handleVendorOrderDelivered(shipment.vendorOrderId).catch(() => null);
      }
    }
    await shipment.save();

    await ShipmentTrackingEvent.updateOne(
      { shipmentId: shipment._id, provider: 'admin', providerEventId: `${shipment._id}:${nextStatus}` },
      { $setOnInsert: { status: nextStatus, description: payload.reason || 'Admin shipment update', timestamp: new Date() } },
      { upsert: true },
    );
    const childShipments = await Shipment.find({ orderId: shipment.orderId }).select('status').lean();
    const parentStatus = childShipments.length > 0 && childShipments.every((entry) => entry.status === 'DELIVERED')
      ? 'DELIVERED'
      : childShipments.some((entry) => entry.status === 'OUT_FOR_DELIVERY')
        ? 'OUT_FOR_DELIVERY'
        : childShipments.some((entry) => entry.status === 'IN_TRANSIT')
          ? 'IN_TRANSIT'
          : childShipments.some((entry) => entry.status === 'SHIPPED') ? 'SHIPPED' : null;
    if (parentStatus) await Order.updateOne({ _id: shipment.orderId }, { $set: { status: parentStatus } });
    const vendorStatuses = await VendorOrder.find({ parentOrderId: shipment.orderId }).select('status').lean();
    const nextOrderStatus = orderService.calculateParentOrderStatus(vendorStatuses.map((entry) => entry.status));
    if (nextOrderStatus) await Order.updateOne({ _id: shipment.orderId }, { $set: { status: nextOrderStatus } });

    sendSuccess(res, shipment.toObject ? shipment.toObject() : shipment, 'Shipment status updated', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const deliveryWebhook = async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const providedSignature = String(req.get('x-delivery-signature') || '');
    const providedApiKey = String(req.get('x-api-key') || req.get('x-shiprocket-token') || '');

    let isAuthorized = false;

    // 1. Verify HMAC signature if x-delivery-signature is present
    if (providedSignature) {
      const expectedSignature = crypto.createHmac('sha256', env.DELIVERY_WEBHOOK_SECRET).update(rawBody).digest('hex');
      if (providedSignature.length === expectedSignature.length && crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(providedSignature))) {
        isAuthorized = true;
      }
    }

    // 2. Verify API key / webhook secret if x-api-key or x-shiprocket-token is present
    if (!isAuthorized && providedApiKey) {
      const validTokens = [env.SHIPROCKET_WEBHOOK_TOKEN, env.DELIVERY_WEBHOOK_SECRET].filter(Boolean);
      for (const token of validTokens) {
        if (providedApiKey.length === token.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(providedApiKey))) {
          isAuthorized = true;
          break;
        }
      }
    }

    if (!isAuthorized) {
      throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid delivery webhook signature');
    }

    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : (req.body || {});
    const trackingNumber = payload.trackingNumber || payload.awb || payload.waybill;
    const providerShipmentId = payload.shipment_id ? String(payload.shipment_id) : null;

    const query = [];
    if (trackingNumber) query.push({ trackingNumber });
    if (providerShipmentId) query.push({ providerShipmentId });

    const shipment = query.length > 0 ? await Shipment.findOne({ $or: query }) : null;
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const statusMap = {
      created: 'CREATED',
      new: 'READY_TO_SHIP',
      'awb assigned': 'READY_TO_SHIP',
      'label generated': 'LABEL_GENERATED',
      label_generated: 'LABEL_GENERATED',
      'pickup scheduled': 'PICKUP_REQUESTED',
      'pickup generated': 'PICKUP_REQUESTED',
      'pickup requested': 'PICKUP_REQUESTED',
      pickup_requested: 'PICKUP_REQUESTED',
      'pickup queued': 'PICKUP_REQUESTED',
      'pickup rescheduled': 'PICKUP_REQUESTED',
      'pickup error': 'DELIVERY_FAILED',
      'picked up': 'SHIPPED',
      picked_up: 'SHIPPED',
      shipped: 'SHIPPED',
      'in transit': 'IN_TRANSIT',
      in_transit: 'IN_TRANSIT',
      'reached at destination': 'IN_TRANSIT',
      'out for delivery': 'OUT_FOR_DELIVERY',
      out_for_delivery: 'OUT_FOR_DELIVERY',
      delivered: 'DELIVERED',
      undelivered: 'DELIVERY_FAILED',
      delivery_failed: 'DELIVERY_FAILED',
      'rto initiated': 'RTO_INITIATED',
      rto_initiated: 'RTO_INITIATED',
      'rto in transit': 'RTO_IN_TRANSIT',
      rto_in_transit: 'RTO_IN_TRANSIT',
      'rto delivered': 'RTO_DELIVERED',
      rto_delivered: 'RTO_DELIVERED',
      canceled: 'CANCELLED',
      cancelled: 'CANCELLED',
    };
    const rawStatus = String(payload.status || payload.current_status || '').toLowerCase().trim();
    const nextStatus = statusMap[rawStatus] || rawStatus.toUpperCase().replace(/\s+/g, '_');
    if (!nextStatus || !shipmentStateService.isValidStatus(nextStatus)) {
      throw new AppError(400, 'INVALID_DELIVERY_STATUS', 'Unsupported delivery status');
    }

    const eventId = String(
      payload.eventId ||
      (payload.shipment_id ? `SR:${payload.shipment_id}:${nextStatus}:${payload.current_timestamp || payload.timestamp || ''}` : '') ||
      `${shipment.trackingNumber}:${nextStatus}:${payload.timestamp || ''}`
    );
    try {
      await ShipmentTrackingEvent.create({
        shipmentId: shipment._id,
        status: nextStatus,
        provider: shipment.provider,
        providerEventId: eventId,
        location: payload.location || payload.current_location || payload.scans?.[0]?.location || null,
        description: payload.description || payload.activity || `Delivery status: ${nextStatus}`,
        rawMetadata: payload,
      });
    } catch (error) {
      if (error?.code === 11000) return res.status(200).json({ success: true, duplicate: true });
      throw error;
    }

    const previousStatus = shipment.status;
    await shipmentStateService.transitionShipmentStatus(previousStatus, nextStatus, {
      shipmentId: shipment._id,
      actorType: 'DELIVERY_PROVIDER',
      reason: 'Provider webhook',
    });

    shipment.status = nextStatus;
    if (nextStatus === 'DELIVERED') {
      shipment.deliveredAt = shipment.deliveredAt || new Date();
      if (shipment.vendorOrderId) {
        await settlementService.handleVendorOrderDelivered(shipment.vendorOrderId).catch(() => null);
      }
    }
    await shipment.save();

    await VendorOrder.updateOne({ _id: shipment.vendorOrderId }, { $set: { status: nextStatus } });
    const siblingShipments = await Shipment.find({ orderId: shipment.orderId }).select('status').lean();
    const parentStatus = siblingShipments.every((entry) => entry.status === 'DELIVERED')
      ? 'DELIVERED'
      : siblingShipments.some((entry) => entry.status === 'OUT_FOR_DELIVERY')
        ? 'OUT_FOR_DELIVERY'
        : siblingShipments.some((entry) => entry.status === 'IN_TRANSIT')
          ? 'IN_TRANSIT'
          : siblingShipments.some((entry) => entry.status === 'SHIPPED') ? 'SHIPPED' : null;
    if (parentStatus) await Order.updateOne({ _id: shipment.orderId }, { $set: { status: parentStatus } });
    const vendorStatuses = await VendorOrder.find({ parentOrderId: shipment.orderId }).select('status').lean();
    const nextOrderStatus = orderService.calculateParentOrderStatus(vendorStatuses.map((entry) => entry.status));
    if (nextOrderStatus) await Order.updateOne({ _id: shipment.orderId }, { $set: { status: nextOrderStatus } });
    const order = await Order.findById(shipment.orderId).select('orderNumber').lean();
    const notification = nextStatus === 'DELIVERED'
      ? { type: 'ORDER_DELIVERED', title: 'Order delivered', message: `Order ${order?.orderNumber || shipment.orderId} was delivered.` }
      : { type: 'ORDER_SHIPMENT_UPDATED', title: `Shipment ${nextStatus.replaceAll('_', ' ').toLowerCase()}`, message: `Shipment ${shipment.trackingNumber} is now ${nextStatus.replaceAll('_', ' ').toLowerCase()}.` };
    await scheduleNotification({ userId: shipment.customerId, ...notification, metadata: { orderId: shipment.orderId, vendorOrderId: shipment.vendorOrderId, shipmentId: shipment._id, idempotencyKey: `shipment:${shipment._id}:${eventId}` } }).catch(() => null);
    if (previousStatus !== nextStatus) {
      const vendor = await Vendor.findById(shipment.vendorId).select('ownerUserId').lean();
      const owner = vendor?.ownerUserId ? await User.findById(vendor.ownerUserId).select('email phone').lean() : null;
      if (vendor?.ownerUserId) await scheduleNotification({
        userId: vendor.ownerUserId,
        type: 'VENDOR_SHIPMENT_UPDATED',
        title: notification.title,
        message: notification.message,
        metadata: { orderId: shipment.orderId, vendorOrderId: shipment.vendorOrderId, shipmentId: shipment._id, email: owner?.email, phone: owner?.phone, idempotencyKey: `vendor-shipment:${shipment._id}:${eventId}` },
      }).catch(() => null);
    }
    return res.status(200).json({ success: true, duplicate: false });
  } catch (error) {
    return next(error);
  }
};

export const downloadVendorShippingLabel = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can download shipping labels');

    const orderId = req.params.orderId || req.params.id;
    const vendorOrder = await VendorOrder.findOne({ _id: orderId, vendorId: vendor._id });
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');

    const shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found for this order');

    const order = await Order.findById(vendorOrder.parentOrderId).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Parent order not found');

    const pdfResult = await pdfService.generateShippingLabelPdf({
      shipment,
      order,
      vendorOrder,
      vendor,
    });

    res.setHeader('Content-Type', pdfResult.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfResult.filename || 'shipping-label.pdf'}"`);
    return res.send(pdfResult.content);
  } catch (error) {
    next(error);
  }
};

export const downloadAdminShippingLabel = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const vendorOrder = await VendorOrder.findById(shipment.vendorOrderId);
    const order = await Order.findById(shipment.orderId).lean();
    const vendor = await Vendor.findById(shipment.vendorId).lean();

    const pdfResult = await pdfService.generateShippingLabelPdf({
      shipment,
      order: order || {},
      vendorOrder: vendorOrder || {},
      vendor: vendor || {},
    });

    res.setHeader('Content-Type', pdfResult.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pdfResult.filename || 'shipping-label.pdf'}"`);
    return res.send(pdfResult.content);
  } catch (error) {
    next(error);
  }
};

export const retryAdminPickup = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const updated = await shippingService.requestPickup({ shipmentId: shipment._id });
    sendSuccess(res, updated, 'Pickup requested successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const resyncAdminTracking = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const tracking = await shippingService.getTracking(shipment._id);
    if (tracking?.status) {
      const normalizedStatus = String(tracking.status).toUpperCase();
      if (normalizedStatus !== shipment.status && shipmentStateService.isValidStatus(normalizedStatus)) {
        await shipmentStateService.transitionShipmentStatus(shipment.status, normalizedStatus, {
          shipmentId: shipment._id,
          actorType: 'ADMIN',
          actorId: req.user.sub,
          reason: 'Manual tracking resync',
        }).catch(() => null);

        shipment.status = normalizedStatus;
        if (normalizedStatus === 'DELIVERED') {
          shipment.deliveredAt = shipment.deliveredAt || new Date();
          if (shipment.vendorOrderId) {
            await VendorOrder.updateOne({ _id: shipment.vendorOrderId }, { $set: { status: 'DELIVERED' } });
            await settlementService.handleVendorOrderDelivered(shipment.vendorOrderId).catch(() => null);
          }
        }
        await shipment.save();
      }
    }

    sendSuccess(res, { shipment: shipment.toObject ? shipment.toObject() : shipment, tracking }, 'Tracking resynced', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

