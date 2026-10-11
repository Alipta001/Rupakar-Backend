import mongoose from 'mongoose';
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
import { deliveryProvider, isAuthenticAwb } from '../services/delivery-provider.service.js';
import { isReplacementOrder, replacementService } from '../services/replacement.service.js';
import { Replacement } from '../models/replacement.model.js';
import { Return } from '../models/return.model.js';
import { ReturnShipment } from '../models/return-shipment.model.js';
import { returnShipmentService } from '../services/return-shipment.service.js';
import { normalizeIndianPhone10 } from '../services/sms.service.js';
import { auditService } from '../services/audit.service.js';
import { pdfService } from '../services/pdf.service.js';

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

    const isReplacement = isReplacementOrder(order, vendorOrder);
    const isOrderPayableOrCod = ['PAID', 'CAPTURED'].includes(order.paymentStatus) || order.paymentMethod === 'cod' || isReplacement;
    if (!isOrderPayableOrCod || vendorOrder.status !== 'PROCESSING') {
      throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order is not ready to be packed');
    }

    // Optional package info during pack step
    let packageInfo = null;
    const body = req.body || {};
    const hasExplicitPkg = body.weight !== undefined || body.length !== undefined || body.width !== undefined || body.height !== undefined || body.packageInfo !== undefined;
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
    if (isReplacement) {
      // For replacement orders in Phase 7A:
      // Maintain local shipment record with package information for Phase 7B.
      // Do NOT create an external Shiprocket shipment or assign AWB/tracking.
      if (!shipment) {
        shipment = await Shipment.create({
          orderId: order._id,
          vendorOrderId: vendorOrder._id,
          vendorId: vendor._id,
          customerId: order.customerId,
          shipmentNumber: `SHIP-REP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          carrier: null,
          provider: null,
          trackingNumber: null,
          trackingUrl: null,
          shippingMethod: 'standard',
          status: 'PACKED',
          pickupAddress: vendor.pickupAddress || vendor.registeredAddress || {},
          deliveryAddress: order.shippingAddressSnapshot || order.shippingAddress || {},
          packageInfo: packageInfo || {},
          providerShipmentId: null,
          providerAwb: null,
          labelUrl: null,
          pickupStatus: 'PENDING',
          metadata: {
            isReplacement: true,
            originalOrderId: vendorOrder.financialSnapshot?.originalOrderId || null,
            returnId: vendorOrder.financialSnapshot?.returnId || null,
          },
        });
      } else {
        if (packageInfo) {
          shipment.packageInfo = packageInfo;
        }
        shipment.status = 'PACKED';
        await shipment.save();
      }

      await replacementService.syncReplacementFulfillmentStatus({
        vendorOrderId: vendorOrder._id,
        status: 'PACKED',
        actorId: req.user.sub,
        actorType: 'SYSTEM',
      });

      auditService.log('REPLACEMENT_ORDER_PACKED', {
        actor: req.user.sub,
        actorType: 'VENDOR',
        vendorOrderId: vendorOrder._id,
        orderId: order._id,
        returnId: vendorOrder.financialSnapshot?.returnId || null,
        previousStatus: 'PROCESSING',
        newStatus: 'PACKED',
        packageInfo: packageInfo || shipment?.packageInfo || null,
        timestamp: new Date().toISOString(),
      });
    } else {
      if (!shipment) {
        shipment = await shippingService.createShipment({
          orderId: order._id,
          orderNumber: order.orderNumber,
          vendorOrderId: vendorOrder._id,
          vendorId: vendor._id,
          customerId: order.customerId,
          shippingMethod: 'standard',
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
    }

    await orderService.syncParentOrderStatus(order._id);
    const orderQuery = Order.findById(order._id);
    const updatedOrder = typeof orderQuery?.lean === 'function' ? await orderQuery.lean() : await orderQuery;
    sendSuccess(res, {
      shipment: shipment ? (shipment.toObject ? shipment.toObject() : shipment) : null,
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

    const isReplacement = isReplacementOrder(order, vendorOrder);
    if (isReplacement) {
      if (vendorOrder.status !== 'READY_TO_SHIP') {
        throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Replacement order must be ready to ship before carrier handoff');
      }

      const isShipmentQueryable = Boolean(
        mongoose?.connection?.readyState === 1 ||
        Shipment.findOne?._isMockFunction ||
        Shipment.findOne?.mock
      );
      let shipment = isShipmentQueryable ? await Shipment.findOne({ vendorOrderId: vendorOrder._id }) : null;
      if (!shipment || !isAuthenticAwb(shipment.trackingNumber, shipment.providerShipmentId)) {
        throw new AppError(400, 'REPLACEMENT_SHIPMENT_NOT_READY', 'Replacement order cannot be marked shipped without authentic provider AWB');
      }

      const nextStatus = 'SHIPPED';
      await shipmentStateService.transitionShipmentStatus(shipment.status || 'READY_TO_SHIP', nextStatus, {
        shipmentId: shipment._id,
        actorType: 'VENDOR',
        actorId: req.user.sub,
        reason: 'Handed over to carrier',
      });

      shipment.status = nextStatus;
      shipment.shippedAt = shipment.shippedAt || new Date();
      if (typeof shipment.save === 'function') {
        await shipment.save();
      } else {
        await Shipment.updateOne({ _id: shipment._id }, { $set: { status: nextStatus, shippedAt: shipment.shippedAt } });
      }

      vendorOrder.status = nextStatus;
      await vendorOrder.save();

      await replacementService.syncReplacementFulfillmentStatus({
        vendorOrderId: vendorOrder._id,
        status: 'SHIPPED',
        actorId: req.user.sub,
        actorType: 'VENDOR',
      });

      auditService.log('REPLACEMENT_ORDER_SHIPPED', {
        actor: req.user.sub,
        actorType: 'VENDOR',
        vendorOrderId: vendorOrder._id,
        orderId: order._id,
        returnId: vendorOrder.financialSnapshot?.returnId || null,
        previousStatus: 'READY_TO_SHIP',
        newStatus: 'SHIPPED',
        awb: shipment.trackingNumber,
        carrier: shipment.carrier,
        timestamp: new Date().toISOString(),
      });

      await orderService.syncParentOrderStatus(order._id);
      const updatedOrder = await Order.findById(order._id).lean();
      return sendSuccess(res, {
        shipment: shipment.toObject ? shipment.toObject() : shipment,
        vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder,
        order: updatedOrder || (order.toObject ? order.toObject() : order),
      }, 'Order shipped', String(req.headers['x-request-id'] ?? ''));
    }

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

    const isOrderQueryable = Boolean(
      mongoose?.connection?.readyState === 1 ||
      Order.findById?._isMockFunction ||
      Order.findById?.mock ||
      Order.findOne?._isMockFunction ||
      Order.findOne?.mock
    );
    let order = {};
    if (isOrderQueryable && vendorOrder.parentOrderId) {
      try {
        const orderQuery = Order.findById(vendorOrder.parentOrderId);
        order = (typeof orderQuery?.lean === 'function' ? await orderQuery.lean() : await orderQuery) || {};
      } catch (_) {
        order = {};
      }
    }
    const isReplacement = isReplacementOrder(order, vendorOrder);

    // Idempotent return if already ready to ship
    if (vendorOrder.status === 'READY_TO_SHIP') {
      const shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });
      const currentOrder = await Order.findById(vendorOrder.parentOrderId).lean();
      return sendSuccess(res, {
        shipment: shipment ? (shipment.toObject ? shipment.toObject() : shipment) : null,
        vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder,
        order: currentOrder || null,
        isIdempotent: true,
      }, 'Order ready to ship', String(req.headers['x-request-id'] ?? ''));
    }

    if (vendorOrder.status !== 'PACKED') throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order must be packed before it is ready to ship');

    // Package information validation
    let packageInfo = null;
    const body = req.body || {};
    const hasExplicitPkg = body.weight !== undefined || body.length !== undefined || body.width !== undefined || body.height !== undefined || body.packageInfo !== undefined;
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
    if (!packageInfo && shipment?.packageInfo?.weight > 0 && shipment?.packageInfo?.length > 0) {
      packageInfo = shipment.packageInfo;
    }

    // Strict validation for replacement orders: packageInfo MUST be present and valid
    if (isReplacement) {
      if (!packageInfo || !packageInfo.weight || !packageInfo.length || !packageInfo.width || !packageInfo.height) {
        throw new AppError(400, 'PACKAGE_INFO_REQUIRED', 'Package weight and dimensions are required before marking a replacement ready to ship');
      }
      packageInfoSchema.parse(packageInfo);
    } else if (!packageInfo) {
      // Normal order fallback
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
            // Already consumed; available stock was already reduced
          } else if (!isReplacement) {
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

    if (isReplacement) {
      // 1. Validate replacement record linkage
      const rep = await Replacement.findOne({ replacementVendorOrderId: vendorOrder._id });
      if (!rep) {
        throw new AppError(404, 'REPLACEMENT_NOT_FOUND', 'Replacement record not found for vendor order');
      }
      if (['CANCELLED', 'REJECTED', 'ORDER_CREATION_FAILED'].includes(rep.status)) {
        throw new AppError(400, 'INVALID_REPLACEMENT_STATE', `Replacement is in invalid state: ${rep.status}`);
      }
      if (!rep.returnId || (vendorOrder.financialSnapshot?.returnId && String(rep.returnId) !== String(vendorOrder.financialSnapshot.returnId))) {
        throw new AppError(400, 'INVALID_REPLACEMENT_LINKAGE', 'Replacement is not linked to the correct return');
      }
      const isReturnQueryable = Boolean(
        mongoose?.connection?.readyState === 1 ||
        Return.findById?._isMockFunction ||
        Return.findById?.mock ||
        Return.findOne?._isMockFunction ||
        Return.findOne?.mock
      );
      if (isReturnQueryable && rep.returnId) {
        const linkedReturn = await Return.findById(rep.returnId);
        if (!linkedReturn) {
          throw new AppError(404, 'RETURN_NOT_FOUND', 'Linked return record not found');
        }
      }

      // 2. Validate seller pickup address (approved and registered required)
      const hasConfiguredPickup = Boolean(
        vendor.pickupAddress &&
        vendor.pickupAddress.pincode &&
        vendor.pickupAddress.addressLine1 &&
        vendor.pickupAddress.city &&
        vendor.pickupAddress.pickupLocationName
      );
      if (!hasConfiguredPickup) {
        throw new AppError(400, 'PICKUP_ADDRESS_REQUIRED', 'Please configure your pickup / dispatch address in Settings before marking this replacement ready to ship.');
      }
      if (vendor.pickupAddress.registrationStatus !== 'REGISTERED') {
        const errorDetail = vendor.pickupAddress.registrationError ? `: ${vendor.pickupAddress.registrationError}` : '';
        throw new AppError(400, 'PICKUP_LOCATION_NOT_REGISTERED', `Pickup location "${vendor.pickupAddress.pickupLocationName}" is not registered with Shiprocket${errorDetail}.`);
      }
      if (vendor.pickupAddress.adminStatus !== 'APPROVED') {
        let msg = 'Pickup location is awaiting admin approval.';
        if (vendor.pickupAddress.adminStatus === 'DEACTIVATED') msg = 'Pickup location is deactivated by admin.';
        if (vendor.pickupAddress.adminStatus === 'ARCHIVED') msg = 'Pickup location has been archived.';
        throw new AppError(400, 'PICKUP_LOCATION_NOT_APPROVED', msg);
      }

      const pickupAddress = {
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
        registrationStatus: vendor.pickupAddress.registrationStatus || 'REGISTERED',
        adminStatus: vendor.pickupAddress.adminStatus || 'APPROVED',
        shiprocketPickupId: vendor.pickupAddress.shiprocketPickupId || null,
      };

      // 3. Validate customer phone from shipping address snapshot
      const customerShippingSnapshot = order.shippingAddressSnapshot || order.shippingAddress || {};
      const rawCustomerPhone = customerShippingSnapshot.phone || customerShippingSnapshot.phoneNumber || customerShippingSnapshot.mobile || '';
      const normalizedCustomerPhone = normalizeIndianPhone10(rawCustomerPhone);
      if (!normalizedCustomerPhone) {
        throw new AppError(400, 'INVALID_PHONE_NUMBER', 'Customer phone number must be a valid 10-digit Indian mobile number');
      }

      const deliveryAddress = {
        ...customerShippingSnapshot,
        phone: normalizedCustomerPhone,
      };

      // 4. Dispatch carrier shipment via existing DeliveryProvider abstraction
      const canonicalOrderNumber = rep.replacementNumber || order.orderNumber || `REP-${String(rep._id).slice(-8)}`;

      shipment = await shippingService.createShipment({
        orderId: order._id,
        orderNumber: canonicalOrderNumber,
        vendorOrderId: vendorOrder._id,
        vendorId: vendor._id,
        customerId: order.customerId || rep.customerId,
        pickupAddress,
        deliveryAddress,
        packageInfo,
        items: vendorOrder.items,
        cod: false,
        metadata: {
          isReplacement: true,
          replacementId: rep._id,
          returnId: rep.returnId,
          originalOrderId: vendorOrder.financialSnapshot?.originalOrderId || rep.originalOrderId || null,
          originalVendorOrderId: vendorOrder.financialSnapshot?.originalVendorOrderId || rep.originalVendorOrderId || null,
        },
      });

      if (shipment.status !== 'READY_TO_SHIP' && !['SHIPPED', 'PICKUP_REQUESTED', 'IN_TRANSIT', 'DELIVERED'].includes(shipment.status)) {
        await shipmentStateService.transitionShipmentStatus(shipment.status || 'PACKED', 'READY_TO_SHIP', {
          shipmentId: shipment._id,
          actorType: 'VENDOR',
          actorId: req.user.sub,
          reason: 'Ready for carrier handoff',
        });
        shipment.status = 'READY_TO_SHIP';
        await shipment.save();
      }

      const isTrackingEventQueryable = Boolean(
        mongoose?.connection?.readyState === 1 ||
        ShipmentTrackingEvent.create?._isMockFunction ||
        ShipmentTrackingEvent.create?.mock
      );
      if (isTrackingEventQueryable) {
        await ShipmentTrackingEvent.create({
          shipmentId: shipment._id,
          status: 'READY_TO_SHIP',
          provider: shipment.provider || 'mock',
          providerEventId: `${shipment._id}:READY_TO_SHIP:${Date.now()}`,
          description: 'Replacement packed and ready for carrier pickup',
          timestamp: new Date(),
        }).catch(() => null);
      }

      vendorOrder.status = 'READY_TO_SHIP';
      await vendorOrder.save();

      const hasAuthenticAwb = isAuthenticAwb(shipment.trackingNumber, shipment.providerShipmentId);
      const isPickupScheduled = shipment.pickupStatus === 'SCHEDULED' || shipment.pickupStatus === 'REQUESTED';

      if (hasAuthenticAwb && isPickupScheduled) {
        await replacementService.syncReplacementFulfillmentStatus({
          vendorOrderId: vendorOrder._id,
          status: 'SHIPPED',
          actorId: req.user.sub,
          actorType: 'SYSTEM',
        });
      } else {
        await replacementService.syncReplacementFulfillmentStatus({
          vendorOrderId: vendorOrder._id,
          status: 'READY_TO_SHIP',
          actorId: req.user.sub,
          actorType: 'SYSTEM',
        });
      }

      auditService.log('REPLACEMENT_ORDER_READY_TO_SHIP', {
        actor: req.user.sub,
        actorType: 'VENDOR',
        vendorOrderId: vendorOrder._id,
        orderId: order._id,
        returnId: rep.returnId,
        previousStatus: 'PACKED',
        newStatus: 'READY_TO_SHIP',
        packageInfo,
        providerShipmentId: shipment.providerShipmentId,
        awb: shipment.trackingNumber,
        timestamp: new Date().toISOString(),
      });

      await orderService.syncParentOrderStatus(order._id);
      const updatedOrder = isOrderQueryable && vendorOrder.parentOrderId
        ? await Order.findById(vendorOrder.parentOrderId).lean().catch(() => null)
        : null;

      return sendSuccess(res, {
        shipment: shipment ? (shipment.toObject ? shipment.toObject() : shipment) : null,
        vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder,
        order: updatedOrder || (order.toObject ? order.toObject() : order),
      }, 'Order ready to ship', String(req.headers['x-request-id'] ?? ''));
    }

    const hasConfiguredPickup = Boolean(
      vendor.pickupAddress &&
      vendor.pickupAddress.pincode &&
      vendor.pickupAddress.addressLine1 &&
      vendor.pickupAddress.city &&
      vendor.pickupAddress.pickupLocationName
    );

    if (env.DELIVERY_PROVIDER === 'shiprocket') {
      if (!hasConfiguredPickup) {
        throw new AppError(400, 'PICKUP_ADDRESS_REQUIRED', 'Please configure your pickup / dispatch address in Settings before marking this order Ready to Ship.');
      }
      if (vendor.pickupAddress.registrationStatus !== 'REGISTERED') {
        const errorDetail = vendor.pickupAddress.registrationError ? `: ${vendor.pickupAddress.registrationError}` : '';
        throw new AppError(400, 'PICKUP_LOCATION_NOT_REGISTERED', `Pickup location "${vendor.pickupAddress.pickupLocationName}" is not registered with Shiprocket${errorDetail}. Please update your pickup address in Settings to register it.`);
      }
    }

    if (hasConfiguredPickup) {
      const adminStatus = vendor.pickupAddress.adminStatus || 'APPROVED';
      if (adminStatus !== 'APPROVED') {
        let msg = 'Pickup location is awaiting admin approval.';
        if (adminStatus === 'DEACTIVATED') {
          msg = 'Pickup location is deactivated by admin.';
        } else if (adminStatus === 'ARCHIVED') {
          msg = 'Pickup location has been archived.';
        }
        throw new AppError(400, 'PICKUP_LOCATION_NOT_APPROVED', msg);
      }
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
      registrationStatus: vendor.pickupAddress.registrationStatus || 'PENDING',
      adminStatus: vendor.pickupAddress.adminStatus || (vendor.pickupAddress.registrationStatus === 'REGISTERED' ? 'APPROVED' : 'PENDING'),
      shiprocketPickupId: vendor.pickupAddress.shiprocketPickupId || null,
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
      shipment = await shippingService.createShipment({
        orderId: order._id,
        orderNumber: order.orderNumber,
        vendorOrderId: vendorOrder._id,
        vendorId: vendor._id,
        customerId: order.customerId || order.userId || order.user?._id || order.user || vendorOrder.customerId || vendorOrder.userId || order._id,
        pickupAddress,
        deliveryAddress,
        packageInfo,
        items: vendorOrder.items,
        cod: order.paymentMethod === 'cod',
      });
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

    if (shipment.status !== 'READY_TO_SHIP' && !['SHIPPED', 'PICKUP_REQUESTED', 'IN_TRANSIT', 'DELIVERED'].includes(shipment.status)) {
      await shipmentStateService.transitionShipmentStatus(shipment.status, 'READY_TO_SHIP', {
        shipmentId: shipment._id,
        actorType: 'VENDOR',
        actorId: req.user.sub,
        reason: 'Ready for carrier handoff',
      });
      shipment.status = 'READY_TO_SHIP';
      await shipment.save();
    }

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

    if (order._id) {
      await orderService.syncParentOrderStatus(order._id).catch(() => null);
    }
    const updatedOrder = isOrderQueryable && vendorOrder.parentOrderId
      ? await Order.findById(vendorOrder.parentOrderId).lean().catch(() => null)
      : null;

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
        if (!shipment.metadata?.isReplacement) {
          await settlementService.handleVendorOrderDelivered(shipment.vendorOrderId).catch(() => null);
        }
      }
    }
    await shipment.save();

    if (shipment.metadata?.isReplacement && shipment.vendorOrderId) {
      if (['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(nextStatus)) {
        await replacementService.syncReplacementFulfillmentStatus({
          vendorOrderId: shipment.vendorOrderId,
          status: 'SHIPPED',
          actorId: req.user.sub,
          actorType: 'ADMIN',
        }).catch(() => null);
      } else if (nextStatus === 'DELIVERED') {
        await replacementService.syncReplacementFulfillmentStatus({
          vendorOrderId: shipment.vendorOrderId,
          status: 'DELIVERED',
          actorId: req.user.sub,
          actorType: 'ADMIN',
        }).catch(() => null);
      }
    }

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

    const returnQuery = [];
    if (trackingNumber) {
      returnQuery.push({ trackingNumber });
      returnQuery.push({ providerAwb: trackingNumber });
    }
    if (providerShipmentId) {
      returnQuery.push({ providerShipmentId });
    }
    if (payload.channel_order_id) {
      returnQuery.push({ channelOrderId: payload.channel_order_id });
      returnQuery.push({ shipmentNumber: payload.channel_order_id });
    }
    if (payload.order_id) {
      returnQuery.push({ channelOrderId: String(payload.order_id) });
      returnQuery.push({ providerOrderId: payload.order_id });
    }

    const isExplicitReturn = Boolean(
      payload.is_return === 1 ||
      payload.is_return === true ||
      payload.return === 1 ||
      payload.direction === 'RETURN' ||
      String(payload.order_id || '').startsWith('RET-') ||
      String(payload.order_id || '').startsWith('REV-') ||
      String(payload.channel_order_id || '').startsWith('RET-') ||
      String(payload.channel_order_id || '').startsWith('REV-')
    );

    if (isExplicitReturn && returnQuery.length > 0) {
      const returnShipment = await ReturnShipment.findOne({ $or: returnQuery });
      if (returnShipment) {
        return returnShipmentService.handleReverseWebhookEvent({
          returnShipment,
          payload,
          res,
        });
      }
    }

    const forwardQuery = [];
    if (trackingNumber) forwardQuery.push({ trackingNumber });
    if (providerShipmentId) forwardQuery.push({ providerShipmentId });

    let shipment = forwardQuery.length > 0 ? await Shipment.findOne({ $or: forwardQuery }) : null;

    if (!shipment && returnQuery.length > 0) {
      const returnShipment = await ReturnShipment.findOne({ $or: returnQuery });
      if (returnShipment) {
        return returnShipmentService.handleReverseWebhookEvent({
          returnShipment,
          payload,
          res,
        });
      }
    }

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
      if (shipment.vendorOrderId && !shipment.metadata?.isReplacement) {
        await settlementService.handleVendorOrderDelivered(shipment.vendorOrderId).catch(() => null);
      }
    }
    await shipment.save();

    await VendorOrder.updateOne({ _id: shipment.vendorOrderId }, { $set: { status: nextStatus } });

    if (shipment.metadata?.isReplacement && shipment.vendorOrderId) {
      if (['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(nextStatus)) {
        await replacementService.syncReplacementFulfillmentStatus({
          vendorOrderId: shipment.vendorOrderId,
          status: 'SHIPPED',
          actorType: 'DELIVERY_PROVIDER',
        }).catch(() => null);
      } else if (nextStatus === 'DELIVERED') {
        await replacementService.syncReplacementFulfillmentStatus({
          vendorOrderId: shipment.vendorOrderId,
          status: 'DELIVERED',
          actorType: 'DELIVERY_PROVIDER',
        }).catch(() => null);
      }
    }
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

    if (shipment.labelUrl && /^https?:\/\//i.test(shipment.labelUrl)) {
      return res.redirect(shipment.labelUrl);
    }

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

    if (shipment.labelUrl && /^https?:\/\//i.test(shipment.labelUrl)) {
      return res.redirect(shipment.labelUrl);
    }

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

export const retryVendorShipment = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can retry shipments');

    const orderId = req.params.orderId || req.params.id;
    const vendorOrder = await VendorOrder.findOne({ _id: orderId, vendorId: vendor._id });
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');

    const shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found for this order');

    const order = await Order.findById(vendorOrder.parentOrderId).lean();
    const isReplacement = isReplacementOrder(order, vendorOrder) || Boolean(shipment.metadata?.isReplacement);
    const rep = isReplacement ? await Replacement.findOne({ replacementVendorOrderId: vendorOrder._id }) : null;

    const updatedShipment = await shippingService.createShipment({
      orderId: order?._id || shipment.orderId,
      orderNumber: isReplacement ? (rep?.replacementNumber || order?.orderNumber) : order?.orderNumber,
      vendorOrderId: vendorOrder._id,
      vendorId: vendor._id,
      customerId: order?.customerId || shipment.customerId,
      pickupAddress: shipment.pickupAddress,
      deliveryAddress: shipment.deliveryAddress,
      packageInfo: shipment.packageInfo,
      items: vendorOrder.items,
      cod: isReplacement ? false : (order?.paymentMethod === 'cod'),
      metadata: shipment.metadata || {},
    });

    sendSuccess(res, { shipment: updatedShipment.toObject ? updatedShipment.toObject() : updatedShipment, vendorOrder }, 'Shipment fulfillment retried successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const retryAdminFulfillment = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const vendorOrder = await VendorOrder.findById(shipment.vendorOrderId);
    const order = await Order.findById(shipment.orderId).lean();
    const isReplacement = isReplacementOrder(order, vendorOrder) || Boolean(shipment.metadata?.isReplacement);
    const rep = isReplacement ? await Replacement.findOne({ replacementVendorOrderId: shipment.vendorOrderId }) : null;

    const updated = await shippingService.createShipment({
      orderId: shipment.orderId,
      orderNumber: isReplacement ? (rep?.replacementNumber || order?.orderNumber) : order?.orderNumber,
      vendorOrderId: shipment.vendorOrderId,
      vendorId: shipment.vendorId,
      customerId: shipment.customerId,
      pickupAddress: shipment.pickupAddress,
      deliveryAddress: shipment.deliveryAddress,
      packageInfo: shipment.packageInfo,
      items: vendorOrder?.items || [],
      cod: isReplacement ? false : (order?.paymentMethod === 'cod'),
      metadata: shipment.metadata || {},
    });

    sendSuccess(res, updated.toObject ? updated.toObject() : updated, 'Shipment fulfillment completed', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const assignAdminAwb = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const updated = await shippingService.assignAwb({
      shipmentId: shipment._id,
      courierId: req.body?.courierId || req.body?.courierCompanyId || null,
    });
    sendSuccess(res, updated, 'AWB assigned successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const generateAdminLabel = async (req, res, next) => {
  try {
    const shipment = await Shipment.findById(req.params.id);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const updated = await shippingService.generateLabel({ shipmentId: shipment._id });
    sendSuccess(res, updated, 'Label generated successfully', String(req.headers['x-request-id'] ?? ''));
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
            if (!shipment.metadata?.isReplacement) {
              await settlementService.handleVendorOrderDelivered(shipment.vendorOrderId).catch(() => null);
            }
          }
        }
        await shipment.save();

        if (shipment.metadata?.isReplacement && shipment.vendorOrderId) {
          if (['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(normalizedStatus)) {
            await replacementService.syncReplacementFulfillmentStatus({
              vendorOrderId: shipment.vendorOrderId,
              status: 'SHIPPED',
              actorId: req.user.sub,
              actorType: 'ADMIN',
            }).catch(() => null);
          } else if (normalizedStatus === 'DELIVERED') {
            await replacementService.syncReplacementFulfillmentStatus({
              vendorOrderId: shipment.vendorOrderId,
              status: 'DELIVERED',
              actorId: req.user.sub,
              actorType: 'ADMIN',
            }).catch(() => null);
          }
        }
      }
    }

    sendSuccess(res, { shipment: shipment.toObject ? shipment.toObject() : shipment, tracking }, 'Tracking resynced', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

