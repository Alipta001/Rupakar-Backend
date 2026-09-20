import { orderService } from '../services/order.service.js';
import { createOrderSchema, cancelOrderSchema } from '../validators/order.validators.js';
import { AppError } from '../utils/app-error.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Vendor } from '../models/vendor.model.js';
import mongoose from 'mongoose';

export const createOrder = async (req, res, next) => {
  try {
    const payload = createOrderSchema.parse(req.body ?? {});
    const customerId = req.user?.sub;

    if (!customerId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required');
    }

    const order = await orderService.createOrder({
      customerId,
      shippingAddressId: payload.shippingAddressId,
      shippingAddress: payload.shippingAddress,
      billingAddressId: payload.billingAddressId,
      couponCode: payload.couponCode,
      paymentMethod: payload.paymentMethod,
      idempotencyKey: req.headers['idempotency-key'] || payload.idempotencyKey,
    });

    res.status(201).json({
      success: true,
      data: order,
      message: 'Order created',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const filter = { customerId: req.user.sub };
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    res.status(200).json({
      success: true,
      data: { items: orders, page, limit, total },
      message: 'Orders loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getOrder = async (req, res, next) => {
  try {
    const identifier = String(req.params.id);
    const filter = mongoose.isValidObjectId(identifier)
      ? { _id: identifier, customerId: req.user.sub }
      : { orderNumber: identifier, customerId: req.user.sub };
    const order = await Order.findOne(filter).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    res.status(200).json({
      success: true,
      data: order,
      message: 'Order loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const cancelOrder = async (req, res, next) => {
  try {
    const payload = cancelOrderSchema.parse(req.body ?? {});
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user.sub });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const result = await orderService.cancelOrder({
      orderId: order._id,
      customerId: req.user.sub,
      reason: payload.reason || 'Customer cancelled',
      actorType: 'CUSTOMER',
      actorId: req.user.sub,
    });

    res.status(200).json({
      success: true,
      data: result,
      message: 'Order cancelled',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listVendorOrders = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) {
      throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can view orders');
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const filter = { vendorId: vendor._id, deletedAt: null };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search && String(req.query.search).trim()) {
      const escaped = String(req.query.search).trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parentOrderIds = await Order.find({ orderNumber: { $regex: escaped, $options: 'i' } }).distinct('_id');
      filter.$or = [
        { 'items.productName': { $regex: escaped, $options: 'i' } },
        { 'items.sku': { $regex: escaped, $options: 'i' } },
        { parentOrderId: { $in: parentOrderIds } },
      ];
    }
    const [orders, total] = await Promise.all([
      VendorOrder.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      VendorOrder.countDocuments(filter),
    ]);
    const parentOrders = await Order.find({ _id: { $in: orders.map((order) => order.parentOrderId) } }).select('paymentStatus status shippingAddressSnapshot createdAt updatedAt').lean();
    const parentById = new Map(parentOrders.map((order) => [String(order._id), order]));
    res.status(200).json({
      success: true,
      data: { items: orders.map((order) => ({ ...order, parent: parentById.get(String(order.parentOrderId)) || null })), page, limit, total },
      message: 'Vendor orders loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getVendorOrder = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) {
      throw new AppError(403, 'FORBIDDEN', 'Vendor profile is required to view orders');
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');
    }
    const vendorOrder = await VendorOrder.findOne({ _id: req.params.id, vendorId: vendor._id, deletedAt: null }).lean();
    if (!vendorOrder) {
      throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');
    }

    const parent = await Order.findOne({ _id: vendorOrder.parentOrderId }).select('paymentStatus status shippingAddressSnapshot createdAt updatedAt').lean();
    res.status(200).json({
      success: true,
      data: { ...vendorOrder, parent: parent || null },
      message: 'Vendor order loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listAdminOrders = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const { status, vendorId, customerId, orderNumber } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vendorId) filter.vendorId = vendorId;
    if (customerId) filter.customerId = customerId;
    if (orderNumber) {
      const escaped = String(orderNumber).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.orderNumber = { $regex: escaped, $options: 'i' };
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    res.status(200).json({
      success: true,
      data: { items: orders, page, limit, total },
      message: 'Admin orders loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    res.status(200).json({
      success: true,
      data: order,
      message: 'Admin order loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};
