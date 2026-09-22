import { Shipment } from '../models/shipment.model.js';
import { ShipmentTrackingEvent } from '../models/shipment-tracking-event.model.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Vendor } from '../models/vendor.model.js';
import { AppError } from '../utils/app-error.js';
import { sendSuccess } from '../utils/response.js';
import { shippingService } from '../services/shipping.service.js';
import { shipmentStateService } from '../services/shipment-state.service.js';
import { schedulePackingSlipGeneration } from '../jobs/queues.js';
import { shipmentStatusSchema, paginationSchema, shipmentTrackingQuerySchema } from '../validators/shipping.validators.js';

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

    sendSuccess(res, vendorOrder, 'Vendor order loaded', String(req.headers['x-request-id'] ?? ''));
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
    if (!['PAID', 'CAPTURED'].includes(order.paymentStatus) || !['PAID', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP'].includes(vendorOrder.status)) {
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

    order.status = 'PACKED';
    await order.save();

    sendSuccess(res, { shipment: shipment.toObject ? shipment.toObject() : shipment, vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder, order: order.toObject ? order.toObject() : order }, 'Order packed', String(req.headers['x-request-id'] ?? ''));
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
    if (!['PAID', 'CAPTURED'].includes(order.paymentStatus) || vendorOrder.status !== 'PACKED') {
      throw new AppError(400, 'INVALID_VENDOR_ORDER_TRANSITION', 'Order must be packed before it can be shipped');
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

    order.status = 'SHIPPED';
    await order.save();

    sendSuccess(res, { shipment: shipment.toObject ? shipment.toObject() : shipment, vendorOrder: vendorOrder.toObject ? vendorOrder.toObject() : vendorOrder }, 'Order shipped', String(req.headers['x-request-id'] ?? ''));
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
    await shipment.save();

    sendSuccess(res, shipment.toObject ? shipment.toObject() : shipment, 'Shipment status updated', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};
