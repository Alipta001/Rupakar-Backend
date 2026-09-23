import { Shipment } from '../models/shipment.model.js';
import { ShipmentTrackingEvent } from '../models/shipment-tracking-event.model.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Vendor } from '../models/vendor.model.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/app-error.js';
import { sendSuccess } from '../utils/response.js';
import { shippingService } from '../services/shipping.service.js';
import { shipmentStateService } from '../services/shipment-state.service.js';
import { schedulePackingSlipGeneration } from '../jobs/queues.js';
import { shipmentStatusSchema, paginationSchema, shipmentTrackingQuerySchema } from '../validators/shipping.validators.js';
import { env } from '../config/env.js';
import crypto from 'node:crypto';
import { scheduleNotification } from '../jobs/queues.js';

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
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const vendorOrder = await VendorOrder.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');

    const order = await Order.findById(vendorOrder.parentOrderId);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (!['PAID', 'CAPTURED'].includes(order.paymentStatus) || vendorOrder.status !== 'PROCESSING') {
      throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order is not ready to be packed');
    }

    const shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id }) || await shippingService.createShipment({
      orderId: order._id,
      vendorOrderId: vendorOrder._id,
      vendorId: vendor._id,
      customerId: order.customerId,
      shippingMethod: 'standard',
      carrier: 'mock-carrier',
    });

    const nextStatus = 'PACKED';
    await shipmentStateService.transitionShipmentStatus(shipment.status || 'PENDING', nextStatus, { shipmentId: shipment._id, actorType: 'VENDOR', actorId: req.user.sub, reason: 'Packed by vendor' });

    shipment.status = nextStatus;
    await shipment.save();

    vendorOrder.status = nextStatus;
    await vendorOrder.save();

    await schedulePackingSlipGeneration({ orderId: order._id, vendorOrderId: vendorOrder._id, vendorId: vendor._id, customerId: order.customerId });

    const siblingOrders = await VendorOrder.find({ parentOrderId: order._id }).select('status').lean();
    if (siblingOrders.length > 0 && siblingOrders.every((entry) => ['PACKED', 'SHIPPED', 'DELIVERED'].includes(entry.status))) order.status = 'PACKED';
    await order.save();

    sendSuccess(res, { shipment: shipment.toObject ? shipment.toObject() : shipment, vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder, order: order.toObject ? order.toObject() : order }, 'Order packed', String(req.headers['x-request-id'] ?? ''));
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
    sendSuccess(res, { vendorOrder: vendorOrder.toObject() }, 'Order processing started', String(req.headers['x-request-id'] ?? ''));
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
    if (!['PAID', 'CAPTURED'].includes(order.paymentStatus) || vendorOrder.status !== 'READY_TO_SHIP') {
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
    await shipment.save();

    vendorOrder.status = nextStatus;
    await vendorOrder.save();

    const siblingOrders = await VendorOrder.find({ parentOrderId: order._id }).select('status').lean();
    if (siblingOrders.length > 0 && siblingOrders.every((entry) => ['SHIPPED', 'DELIVERED'].includes(entry.status))) order.status = 'SHIPPED';
    await order.save();

    sendSuccess(res, { shipment: shipment.toObject ? shipment.toObject() : shipment, vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder }, 'Order shipped', String(req.headers['x-request-id'] ?? ''));
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
    if (vendorOrder.status !== 'PACKED') throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order must be packed before it is ready to ship');
    const shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id });
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment has not been created');
    await shipmentStateService.transitionShipmentStatus(shipment.status, 'READY_TO_SHIP', { shipmentId: shipment._id, actorType: 'VENDOR', actorId: req.user.sub, reason: 'Ready for carrier handoff' });
    shipment.status = 'READY_TO_SHIP';
    await shipment.save();
    vendorOrder.status = 'READY_TO_SHIP';
    await vendorOrder.save();
    sendSuccess(res, { shipment: shipment.toObject(), vendorOrder: vendorOrder.toObject() }, 'Order ready to ship', String(req.headers['x-request-id'] ?? ''));
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
    if (nextStatus === 'DELIVERED') shipment.deliveredAt = shipment.deliveredAt || new Date();
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

    sendSuccess(res, shipment.toObject ? shipment.toObject() : shipment, 'Shipment status updated', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const deliveryWebhook = async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const expectedSignature = crypto.createHmac('sha256', env.DELIVERY_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const providedSignature = String(req.get('x-delivery-signature') || '');
    if (!providedSignature || providedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(providedSignature))) {
      throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid delivery webhook signature');
    }
    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : (req.body || {});
    const shipment = await Shipment.findOne({ trackingNumber: payload.trackingNumber || payload.awb });
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
    const nextStatus = { picked_up: 'SHIPPED', shipped: 'SHIPPED', in_transit: 'IN_TRANSIT', out_for_delivery: 'OUT_FOR_DELIVERY', delivered: 'DELIVERED' }[String(payload.status || '').toLowerCase()];
    if (!nextStatus) throw new AppError(400, 'INVALID_DELIVERY_STATUS', 'Unsupported delivery status');
    const eventId = String(payload.eventId || `${shipment.trackingNumber}:${nextStatus}:${payload.timestamp || ''}`);
    try {
      await ShipmentTrackingEvent.create({ shipmentId: shipment._id, status: nextStatus, provider: shipment.provider, providerEventId: eventId, location: payload.location || null, description: payload.description || null, rawMetadata: payload });
    } catch (error) {
      if (error?.code === 11000) return res.status(200).json({ success: true, duplicate: true });
      throw error;
    }
    const previousStatus = shipment.status;
    await shipmentStateService.transitionShipmentStatus(previousStatus, nextStatus, { shipmentId: shipment._id, actorType: 'DELIVERY_PROVIDER', reason: 'Provider webhook' });
    shipment.status = nextStatus;
    if (nextStatus === 'DELIVERED') shipment.deliveredAt = shipment.deliveredAt || new Date();
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
