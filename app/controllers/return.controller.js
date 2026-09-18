import { Order } from '../models/order.model.js';
import { Return, ReturnItem } from '../models/return.model.js';
import { Refund } from '../models/refund.model.js';
import { Payment } from '../models/payment.model.js';
import { Vendor } from '../models/vendor.model.js';
import { AppError } from '../utils/app-error.js';
import { sendSuccess } from '../utils/response.js';
import { returnEligibilityService } from '../services/return-eligibility.service.js';
import { refundService } from '../services/refund.service.js';
import { returnStateService } from '../services/return-state.service.js';
import { createReturnSchema, cancelReturnSchema, adminReturnDecisionSchema, returnListQuerySchema } from '../validators/return.validators.js';

const getListMeta = (query = {}) => {
  const { page, limit } = returnListQuerySchema.parse(query ?? {});
  return { page, limit, skip: (page - 1) * limit };
};

const buildReturnDto = async (doc) => {
  const returnDoc = doc.toObject ? doc.toObject() : doc;
  const items = await ReturnItem.find({ _id: { $in: returnDoc.items || [] } }).lean();
  return { ...returnDoc, items };
};

export const createOrderReturn = async (req, res, next) => {
  try {
    const payload = createReturnSchema.parse(req.body ?? {});
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user.sub }).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const eligibility = await returnEligibilityService.canRequestReturn({
      customerId: req.user.sub,
      orderId: order._id,
      items: payload.items,
    });

    if (!eligibility.allowed) {
      throw new AppError(400, 'RETURN_NOT_ELIGIBLE', eligibility.reason || 'Return is not eligible');
    }

    const orderDoc = await Order.findById(order._id);
    const grouped = new Map();
    for (const item of payload.items) {
      const source = (orderDoc.items || []).find((entry) => String(entry.variantId) === String(item.variantId));
      if (!source) throw new AppError(400, 'RETURN_ITEM_NOT_FOUND', 'Order item not found');
      if (!grouped.has(String(source.vendorId))) grouped.set(String(source.vendorId), []);
      grouped.get(String(source.vendorId)).push({ ...item, source });
    }

    const createdReturns = [];
    for (const [vendorId, groupItems] of grouped.entries()) {
      const returnItemIds = [];
      for (const entry of groupItems) {
        const createdItem = await ReturnItem.create({
          productId: entry.source.productId,
          variantId: entry.source.variantId,
          quantity: Number(entry.quantity),
          unitPrice: Number(entry.source.unitPrice || 0),
          lineTotal: Number((entry.source.unitPrice || 0) * Number(entry.quantity)),
          reason: entry.reason || payload.reason || 'Customer requested return',
        });
        returnItemIds.push(createdItem._id);
      }

      const existingReturn = await Return.findOne({
        orderId: orderDoc._id,
        vendorId,
        customerId: req.user.sub,
        status: { $in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTING', 'APPROVED_FOR_REFUND'] },
      });
      if (existingReturn) {
        throw new AppError(409, 'RETURN_ALREADY_EXISTS', 'A return is already in progress for this item set');
      }

      const created = await Return.create({
        returnNumber: `RET-${Date.now().toString(36).toUpperCase()}`,
        orderId: orderDoc._id,
        vendorOrderId: null,
        customerId: req.user.sub,
        vendorId,
        reason: payload.reason || 'Customer requested return',
        description: payload.notes || null,
        status: 'REQUESTED',
        items: returnItemIds,
      });
      createdReturns.push(await buildReturnDto(created));
    }

    sendSuccess(res, createdReturns.length === 1 ? createdReturns[0] : createdReturns, 'Return created', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listOrderReturns = async (req, res, next) => {
  try {
    const { page, limit, skip } = getListMeta(req.query);
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user.sub }).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const returns = await Return.find({ orderId: order._id, customerId: req.user.sub }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    const payload = await Promise.all(returns.map((doc) => buildReturnDto(doc)));
    sendSuccess(res, { items: payload, page, limit, total: payload.length }, 'Order returns loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getReturnDetail = async (req, res, next) => {
  try {
    const returnDoc = await Return.findOne({ _id: req.params.id, customerId: req.user.sub });
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    const refund = await Refund.findOne({ returnId: returnDoc._id, customerId: req.user.sub }).lean();
    const payload = await buildReturnDto(returnDoc);
    sendSuccess(res, { ...payload, refund }, 'Return loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const cancelReturn = async (req, res, next) => {
  try {
    const payload = cancelReturnSchema.parse(req.body ?? {});
    const returnDoc = await Return.findOne({ _id: req.params.id, customerId: req.user.sub });
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    const allowed = ['REQUESTED', 'UNDER_REVIEW'];
    if (!allowed.includes(returnDoc.status)) {
      throw new AppError(400, 'INVALID_RETURN_TRANSITION', 'This return cannot be cancelled at its current status');
    }

    await returnStateService.transitionReturnStatus(returnDoc.status, 'CANCELLED', { returnId: returnDoc._id, actorType: 'CUSTOMER', actorId: req.user.sub, reason: payload.reason || 'Customer cancelled return' });
    returnDoc.status = 'CANCELLED';
    await returnDoc.save();

    sendSuccess(res, { ...returnDoc.toObject ? returnDoc.toObject() : returnDoc }, 'Return cancelled', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listVendorReturns = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const { page, limit, skip } = getListMeta(req.query);
    const docs = await Return.find({ vendorId: vendor._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    const payload = await Promise.all(docs.map((doc) => buildReturnDto(doc)));
    sendSuccess(res, { items: payload, page, limit, total: payload.length }, 'Vendor returns loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getVendorReturn = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const returnDoc = await Return.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    sendSuccess(res, await buildReturnDto(returnDoc), 'Vendor return loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listAdminReturns = async (req, res, next) => {
  try {
    const { page, limit, skip } = getListMeta(req.query);
    const returns = await Return.find({}).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean();
    const payload = await Promise.all(returns.map((doc) => buildReturnDto(doc)));
    sendSuccess(res, { items: payload, page, limit, total: payload.length }, 'Admin returns loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getAdminReturn = async (req, res, next) => {
  try {
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    sendSuccess(res, await buildReturnDto(returnDoc), 'Admin return loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const approveReturn = async (req, res, next) => {
  try {
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    await returnStateService.transitionReturnStatus(returnDoc.status, 'APPROVED', { returnId: returnDoc._id, actorType: 'ADMIN', actorId: req.user.sub, reason: 'Approved by admin' });
    returnDoc.status = 'APPROVED';
    returnDoc.approvedAt = new Date();
    await returnDoc.save();

    const order = await Order.findById(returnDoc.orderId);
    const paymentRecord = await Payment.findOne({ orderId: order._id });
    if (!paymentRecord) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found for order');
    const payment = await refundService.createRefund({
      refundData: {
        orderId: order._id,
        paymentId: paymentRecord._id,
        customerId: order.customerId,
        vendorId: returnDoc.vendorId,
        amount: order.total,
        currency: order.currency,
        returnId: returnDoc._id,
        vendorOrderId: returnDoc.vendorOrderId,
        reason: 'RETURN_APPROVED',
      },
    });

    sendSuccess(res, { return: returnDoc.toObject ? returnDoc.toObject() : returnDoc, refund: payment }, 'Return approved', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const rejectReturn = async (req, res, next) => {
  try {
    const payload = adminReturnDecisionSchema.parse(req.body ?? {});
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    await returnStateService.transitionReturnStatus(returnDoc.status, 'REJECTED', { returnId: returnDoc._id, actorType: 'ADMIN', actorId: req.user.sub, reason: payload.reason });
    returnDoc.status = 'REJECTED';
    returnDoc.rejectedAt = new Date();
    returnDoc.description = returnDoc.description || payload.reason;
    await returnDoc.save();

    sendSuccess(res, returnDoc.toObject ? returnDoc.toObject() : returnDoc, 'Return rejected', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};
