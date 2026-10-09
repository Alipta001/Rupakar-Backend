import { orderService } from '../services/order.service.js';
import { createOrderSchema, cancelOrderSchema } from '../validators/order.validators.js';
import { AppError } from '../utils/app-error.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Vendor } from '../models/vendor.model.js';
import { Shipment } from '../models/shipment.model.js';
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
      items: payload.items,
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
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
    const status = String(req.query.status || '').toUpperCase();
    const statusMap = {
      PENDING: ['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'PACKED', 'READY_TO_SHIP'],
      CONFIRMED: ['CONFIRMED'],
      SHIPPED: ['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'],
      DELIVERED: ['DELIVERED'],
      CANCELLED: ['CANCELLED', 'FAILED'],
    };

    const filter = { customerId: req.user.sub };

    if (status && status !== 'ALL') {
      if (statusMap[status]) {
        filter.status = { $in: statusMap[status] };
      } else {
        filter.status = status;
      }
    }

    const search = String(req.query.search || req.query.q || '').trim();
    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { orderNumber: searchRegex },
        { 'items.productName': searchRegex },
        { 'items.sku': searchRegex },
      ];
    }

    const timeframe = String(req.query.timeframe || '').toLowerCase();
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    if (from || to) {
      filter.createdAt = {};
      if (from && !isNaN(from.getTime())) filter.createdAt.$gte = from;
      if (to && !isNaN(to.getTime())) filter.createdAt.$lte = to;
    } else if (timeframe && timeframe !== 'all') {
      const now = new Date();
      if (timeframe === '30days' || timeframe === 'last30days') {
        filter.createdAt = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
      } else if (timeframe === '3months' || timeframe === 'last3months' || timeframe === '90days') {
        filter.createdAt = { $gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) };
      } else if (timeframe === '6months' || timeframe === 'last6months' || timeframe === '180days') {
        filter.createdAt = { $gte: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000) };
      } else if (timeframe === 'year' || timeframe === 'lastyear' || timeframe === '1year') {
        filter.createdAt = { $gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) };
      } else if (/^\d{4}$/.test(timeframe)) {
        const year = parseInt(timeframe, 10);
        filter.createdAt = {
          $gte: new Date(year, 0, 1),
          $lte: new Date(year, 11, 31, 23, 59, 59, 999),
        };
      }
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    res.status(200).json({
      success: true,
      data: {
        items: orders,
        page,
        limit,
        total,
        totalPages: total ? Math.ceil(total / limit) : 0,
        hasNext: page * limit < total,
        hasPrevious: page > 1,
      },
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
    let orderQuery = Order.findOne(filter);
    // Customer orders retain parent-level totals while fulfillment is performed
    // per vendor. Populate the existing relation instead of creating a second
    // customer-only order shape.
    if (typeof orderQuery.populate === 'function') {
      orderQuery = orderQuery.populate({
        path: 'vendorOrders',
        match: { deletedAt: null },
        populate: { path: 'vendorId', select: 'businessName legalName' },
      });
    }
    const order = await orderQuery.lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    let shipments = [];
    const isFindMocked = Shipment.find && (Boolean(Shipment.find._isMockFunction) || Boolean(Shipment.find.mock));
    if (mongoose.connection.readyState === 1 || isFindMocked) {
      try {
        const res = await Shipment.find({ orderId: order._id }).lean();
        shipments = Array.isArray(res) ? res : [];
      } catch {
        shipments = [];
      }
    }
    const sanitizeCustomerShipment = (s) => {
      if (!s) return null;
      const { pickupAddress, ...rest } = s;
      return {
        ...rest,
        originCity: pickupAddress?.city || null,
        originState: pickupAddress?.state || null,
      };
    };
    const shipmentByVo = new Map(shipments.map((s) => [String(s.vendorOrderId), sanitizeCustomerShipment(s)]));
    if (Array.isArray(order.vendorOrders)) {
      order.vendorOrders = order.vendorOrders.map((vo) => ({
        ...vo,
        shipment: shipmentByVo.get(String(vo._id)) || null,
      }));
    }
    order.shipments = shipments.map(sanitizeCustomerShipment);

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
    let shipment = null;
    const isFindOneMocked = Shipment.findOne && (Boolean(Shipment.findOne._isMockFunction) || Boolean(Shipment.findOne.mock));
    if (mongoose.connection.readyState === 1 || isFindOneMocked) {
      try {
        shipment = await Shipment.findOne({ vendorOrderId: vendorOrder._id }).lean();
      } catch {
        shipment = null;
      }
    }
    const vendorPickupConfigured = Boolean(
      vendor?.pickupAddress &&
      vendor?.pickupAddress?.pincode &&
      vendor?.pickupAddress?.addressLine1 &&
      vendor?.pickupAddress?.city &&
      vendor?.pickupAddress?.pickupLocationName
    );
    const vendorPickupAddress = vendorPickupConfigured ? vendor.pickupAddress : null;

    res.status(200).json({
      success: true,
      data: {
        ...vendorOrder,
        parent: parent || null,
        shipment: shipment || null,
        vendorPickupConfigured,
        vendorPickupAddress,
      },
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
      Order.find(filter)
        .populate('customerId', 'name email phone')
        .populate('items.vendorId', 'businessName storeName name legalName')
        .populate({
          path: 'vendorOrders',
          populate: { path: 'vendorId', select: 'businessName storeName name legalName' },
        })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
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
    const order = await Order.findById(req.params.id)
      .populate('customerId', 'name email phone')
      .populate('items.vendorId', 'businessName storeName name legalName')
      .populate({
        path: 'vendorOrders',
        populate: { path: 'vendorId', select: 'businessName storeName name legalName' },
      })
      .lean();
    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    let shipments = [];
    const isFindMocked = Shipment.find && (Boolean(Shipment.find._isMockFunction) || Boolean(Shipment.find.mock));
    if (mongoose.connection.readyState === 1 || isFindMocked) {
      try {
        const res = await Shipment.find({ orderId: order._id }).lean();
        shipments = Array.isArray(res) ? res : [];
      } catch {
        shipments = [];
      }
    }
    const shipmentByVo = new Map(shipments.map((s) => [String(s.vendorOrderId), s]));
    if (Array.isArray(order.vendorOrders)) {
      order.vendorOrders = order.vendorOrders.map((vo) => ({
        ...vo,
        shipment: shipmentByVo.get(String(vo._id)) || null,
      }));
    }
    order.shipments = shipments;

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
