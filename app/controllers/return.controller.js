import mongoose from 'mongoose';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Return, ReturnItem } from '../models/return.model.js';
import { Refund } from '../models/refund.model.js';
import { Payment } from '../models/payment.model.js';
import { Shipment } from '../models/shipment.model.js';
import { Vendor } from '../models/vendor.model.js';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/app-error.js';
import { sendSuccess } from '../utils/response.js';
import { returnEligibilityService } from '../services/return-eligibility.service.js';
import { refundService } from '../services/refund.service.js';
import { returnStateService } from '../services/return-state.service.js';
import {
  createReturnSchema,
  cancelReturnSchema,
  adminReturnDecisionSchema,
  returnListQuerySchema,
  sellerReviewReturnSchema,
  sellerApproveReturnSchema,
  sellerReceiveReturnSchema,
  sellerInspectionSchema,
  sellerDisputeSchema,
  sellerReturnListQuerySchema,
  adminDisputeDecisionSchema,
  adminReturnResolutionSchema,
  adminReturnListQuerySchema,
  customerPayoutDetailsSchema,
  adminExecuteRefundSchema,
  adminCodPayoutSchema,
  createReplacementSchema,
  prepareReverseShipmentSchema,
  retryReverseShipmentSchema,
  returnDispositionSchema,
} from '../validators/return.validators.js';
import { Replacement } from '../models/replacement.model.js';
import { replacementService } from '../services/replacement.service.js';
import { ReturnShipment } from '../models/return-shipment.model.js';
import { returnShipmentService } from '../services/return-shipment.service.js';
import { auditService } from '../services/audit.service.js';
import { Product } from '../models/product.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { Inventory } from '../models/inventory.model.js';
import { InventoryMovement } from '../models/inventory-movement.model.js';
import { inventoryService } from '../services/inventory.service.js';
import { returnNotificationService } from '../services/return-notification.service.js';

const getListMeta = (query = {}) => {
  const { page, limit } = returnListQuerySchema.parse(query ?? {});
  return { page, limit, skip: (page - 1) * limit };
};

const isQueryable = (m) => {
  const isDbConnected = Boolean(mongoose?.connection?.readyState === 1);
  const isMocked = Boolean(
    m?.findOne?._isMockFunction || m?.findOne?.mock ||
    m?.findById?._isMockFunction || m?.findById?.mock ||
    m?.find?._isMockFunction || m?.find?.mock
  );
  return isDbConnected || isMocked;
};

const buildReturnDto = async (doc) => {
  const returnDoc = doc.toObject ? doc.toObject() : doc;
  const items = isQueryable(ReturnItem)
    ? await ReturnItem.find({ _id: { $in: returnDoc.items || [] } }).lean()
    : [];
  let payoutDetails = returnDoc.payoutDetails || null;
  if (payoutDetails && payoutDetails.accountNumber) {
    payoutDetails = {
      ...payoutDetails,
      accountNumber: payoutDetails.maskedAccountNumber || `****${payoutDetails.accountNumber.slice(-4)}`,
    };
  }

  let replacement = null;
  if (isQueryable(Replacement)) {
    try {
      const repQuery = Replacement.findOne({ returnId: returnDoc._id });
      const rep = repQuery && typeof repQuery.lean === 'function' ? await repQuery.lean() : await repQuery;
      if (rep) {
        let repOrder = null;
        let repVendorOrder = null;
        let repShipment = null;
        if (rep.replacementOrderId) {
          let repOrderQuery = Order.findById(rep.replacementOrderId);
          if (repOrderQuery && typeof repOrderQuery.select === 'function') {
            repOrderQuery = repOrderQuery.select('orderNumber status createdAt');
          }
          repOrder = repOrderQuery && typeof repOrderQuery.lean === 'function' ? await repOrderQuery.lean() : await repOrderQuery;
        }
        if (rep.replacementVendorOrderId) {
          let repVoQuery = VendorOrder.findById(rep.replacementVendorOrderId);
          if (repVoQuery && typeof repVoQuery.select === 'function') {
            repVoQuery = repVoQuery.select('status createdAt');
          }
          repVendorOrder = repVoQuery && typeof repVoQuery.lean === 'function' ? await repVoQuery.lean() : await repVoQuery;

          if (isQueryable(Shipment)) {
            let shipQuery = Shipment.findOne({ vendorOrderId: rep.replacementVendorOrderId });
            if (shipQuery && typeof shipQuery.select === 'function') {
              shipQuery = shipQuery.select('carrier trackingNumber trackingUrl status estimatedDeliveryAt packageInfo');
            }
            repShipment = shipQuery && typeof shipQuery.lean === 'function' ? await shipQuery.lean() : await shipQuery;
          }
        }
        const voStatus = repVendorOrder?.status || null;
        replacement = {
          _id: rep._id,
          replacementNumber: rep.replacementNumber,
          status: rep.status,
          quantity: rep.quantity,
          replacementOrderId: rep.replacementOrderId,
          replacementOrderNumber: repOrder?.orderNumber || null,
          vendorOrderStatus: voStatus,
          fulfillmentStatus: voStatus === 'READY_TO_SHIP' ? 'READY_TO_SHIP' : (voStatus === 'PACKED' ? 'PACKED' : (voStatus === 'PROCESSING' ? 'PROCESSING' : rep.status)),
          packageInfo: repShipment?.packageInfo || null,
          carrier: repShipment?.carrier || null,
          trackingNumber: repShipment?.trackingNumber || null,
          trackingUrl: repShipment?.trackingUrl || null,
          estimatedDeliveryAt: repShipment?.estimatedDeliveryAt || null,
          shipmentStatus: repShipment?.status || null,
          readyToShip: voStatus === 'READY_TO_SHIP',
          createdAt: rep.createdAt,
          approvedAt: rep.approvedAt,
        };
      }
    } catch (_) {}
  }

  let sanitizedInspection = null;
  if (returnDoc.inspection) {
    sanitizedInspection = {
      inspectedAt: returnDoc.inspection.inspectedAt || null,
      result: returnDoc.inspection.result || null,
      condition: returnDoc.inspection.condition || returnDoc.inspection.itemCondition || null,
      totalReturnedQuantity: returnDoc.inspection.totalReturnedQuantity || 0,
      totalAcceptedQuantity: returnDoc.inspection.totalAcceptedQuantity || 0,
      totalRejectedQuantity: returnDoc.inspection.totalRejectedQuantity || 0,
      status: ['INSPECTION_PASSED', 'INSPECTION_FAILED'].includes(returnDoc.status)
        ? 'INSPECTION_COMPLETED'
        : (returnDoc.status === 'INSPECTION_PENDING' ? 'INSPECTION_PENDING' : null),
    };
  }

  let sanitizedDisposition = null;
  if (returnDoc.disposition && returnDoc.disposition.status) {
    sanitizedDisposition = {
      status: returnDoc.disposition.status === 'COMPLETED' ? 'DISPOSITION_COMPLETED' : returnDoc.disposition.status,
      disposedAt: returnDoc.disposition.disposedAt || null,
    };
  }

  const sanitizedItems = items.map((it) => {
    const safeItem = { ...it };
    if (safeItem.inspection) {
      safeItem.inspection = {
        inspectedAt: safeItem.inspection.inspectedAt || null,
        result: safeItem.inspection.result || null,
        acceptedQuantity: safeItem.inspection.acceptedQuantity || 0,
        rejectedQuantity: safeItem.inspection.rejectedQuantity || 0,
        condition: safeItem.inspection.condition || safeItem.inspection.itemCondition || null,
      };
    }
    if (safeItem.disposition) {
      safeItem.disposition = {
        disposedAt: safeItem.disposition.disposedAt || null,
        disposition: safeItem.disposition.disposition || null,
        restocked: Boolean(safeItem.disposition.restocked),
      };
    }
    return safeItem;
  });

  let reverseShipment = null;
  if (isQueryable(ReturnShipment)) {
    try {
      const revShip = await ReturnShipment.findOne({ returnId: returnDoc._id, status: { $ne: 'CANCELLED' } }) ||
                      await ReturnShipment.findOne({ returnId: returnDoc._id }).sort({ createdAt: -1 });
      if (revShip) {
        reverseShipment = returnShipmentService.buildShipmentDto(revShip, 'CUSTOMER');
      }
    } catch (_) {}
  }

  return {
    ...returnDoc,
    items: sanitizedItems,
    payoutDetails,
    replacement,
    reverseShipment,
    inspection: sanitizedInspection,
    disposition: sanitizedDisposition,
  };
};

export const createOrderReturn = async (req, res, next) => {
  try {
    const payload = createReturnSchema.parse(req.body ?? {});
    const order = await Order.findOne({ _id: req.params.id, customerId: req.user.sub }).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    if (payload.idempotencyKey) {
      const existingIdempotent = await Return.findOne({
        customerId: req.user.sub,
        idempotencyKey: payload.idempotencyKey,
      });
      if (existingIdempotent) {
        return sendSuccess(res, await buildReturnDto(existingIdempotent), 'Return loaded', String(req.headers['x-request-id'] ?? ''));
      }
    }

    const eligibility = await returnEligibilityService.canRequestReturn({
      customerId: req.user.sub,
      orderId: order._id,
      vendorOrderId: payload.vendorOrderId || null,
      items: payload.items,
      type: payload.type || 'RETURN',
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
      const vendorOrder = await VendorOrder.findOne({ parentOrderId: orderDoc._id, vendorId }).lean();
      const returnItemIds = [];
      for (const entry of groupItems) {
        const createdItem = await ReturnItem.create({
          productId: entry.source.productId,
          variantId: entry.source.variantId,
          quantity: Number(entry.quantity),
          unitPrice: Number(entry.source.unitPrice || 0),
          lineTotal: Number((entry.source.unitPrice || 0) * Number(entry.quantity)),
          reason: entry.reason || payload.reason || 'Customer requested return',
          productSnapshot: entry.source.productSnapshot || {},
        });
        returnItemIds.push(createdItem._id);
      }

      const returnNumber = `RUP-RET-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const created = await Return.create({
        returnNumber,
        orderId: orderDoc._id,
        vendorOrderId: vendorOrder ? vendorOrder._id : (payload.vendorOrderId || null),
        customerId: req.user.sub,
        vendorId,
        type: payload.type || 'RETURN',
        reason: payload.reason || 'Customer requested return',
        description: payload.description || payload.notes || null,
        evidenceImages: payload.evidenceImages || [],
        status: 'REQUESTED',
        items: returnItemIds,
        idempotencyKey: payload.idempotencyKey || null,
      });

      returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_REQUESTED', returnDoc: created }).catch(() => null);
      returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_REQUESTED', returnDoc: created }).catch(() => null);

      createdReturns.push(await buildReturnDto(created));
    }

    sendSuccess(res, createdReturns.length === 1 ? createdReturns[0] : createdReturns, 'Return created', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getOrderReturnEligibility = async (req, res, next) => {
  try {
    const eligibility = await returnEligibilityService.getOrderEligibility({
      customerId: req.user.sub,
      orderId: req.params.id,
      variantId: req.query.variantId || null,
    });
    sendSuccess(res, eligibility, 'Return eligibility loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listCustomerReturns = async (req, res, next) => {
  try {
    const { page, limit, skip } = getListMeta(req.query);
    const returns = await Return.find({ customerId: req.user.sub })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    const payload = await Promise.all(returns.map((doc) => buildReturnDto(doc)));
    sendSuccess(res, { items: payload, page, limit, total: payload.length }, 'Customer returns loaded', String(req.headers['x-request-id'] ?? ''));
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

    const refund = isQueryable(Refund)
      ? await Refund.findOne({ returnId: returnDoc._id, customerId: req.user.sub }).lean()
      : null;
    const order = (isQueryable(Order) && returnDoc.orderId)
      ? await Order.findById(returnDoc.orderId).select('orderNumber currency').lean()
      : null;
    const payload = await buildReturnDto(returnDoc);
    sendSuccess(res, {
      ...payload,
      orderNumber: order?.orderNumber || null,
      currency: order?.currency || 'INR',
      refund,
    }, 'Return loaded', String(req.headers['x-request-id'] ?? ''));
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

    returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_CANCELLED', returnDoc }).catch(() => null);

    sendSuccess(res, { ...returnDoc.toObject ? returnDoc.toObject() : returnDoc }, 'Return cancelled', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const buildVendorReturnDto = async (doc) => {
  const returnDoc = doc.toObject ? doc.toObject() : doc;
  const rawItems = ReturnItem.find({ _id: { $in: returnDoc.items || [] } });
  const items = rawItems && typeof rawItems.lean === 'function' ? await rawItems.lean() : await rawItems;

  let orderData = null;
  if (returnDoc.orderId) {
    const rawOrder = Order.findById(returnDoc.orderId);
    const order = rawOrder && typeof rawOrder.lean === 'function' ? await rawOrder.lean() : await rawOrder;
    if (order) {
      orderData = {
        _id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        customer: {
          name: order.shippingAddress?.fullName || 'Customer',
          city: order.shippingAddress?.city || '',
          state: order.shippingAddress?.state || '',
        },
      };
    }
  }

  let vendorOrderData = null;
  if (returnDoc.vendorOrderId) {
    const rawVo = VendorOrder.findById(returnDoc.vendorOrderId);
    const vo = rawVo && typeof rawVo.lean === 'function' ? await rawVo.lean() : await rawVo;
    if (vo) {
      vendorOrderData = {
        _id: vo._id,
        status: vo.status,
        total: vo.total,
      };
    }
  }

  const resultDto = {
    _id: returnDoc._id,
    returnNumber: returnDoc.returnNumber,
    orderId: returnDoc.orderId,
    vendorOrderId: returnDoc.vendorOrderId,
    vendorId: returnDoc.vendorId,
    type: returnDoc.type,
    reason: returnDoc.reason,
    description: returnDoc.description,
    status: returnDoc.status,
    items,
    evidenceImages: returnDoc.evidenceImages || [],
    requestedAt: returnDoc.requestedAt,
    reviewedAt: returnDoc.reviewedAt,
    reviewedBy: returnDoc.reviewedBy,
    approvedAt: returnDoc.approvedAt,
    approvedBy: returnDoc.approvedBy || null,
    receivedAt: returnDoc.receivedAt,
    receivedBy: returnDoc.receivedBy,
    completedAt: returnDoc.completedAt,
    inspection: returnDoc.inspection || null,
    dispute: returnDoc.dispute || null,
    disposition: returnDoc.disposition || null,
    statusHistory: returnDoc.statusHistory || [],
    order: orderData,
    vendorOrder: vendorOrderData,
    replacement: null,
    createdAt: returnDoc.createdAt,
    updatedAt: returnDoc.updatedAt,
  };

  if (isQueryable(Replacement)) {
    try {
      const repQuery = Replacement.findOne({ returnId: returnDoc._id, vendorId: returnDoc.vendorId });
      const rep = repQuery && typeof repQuery.lean === 'function' ? await repQuery.lean() : await repQuery;
      if (rep) {
        let repOrder = null;
        let repVendorOrder = null;
        let repShipment = null;
        if (rep.replacementOrderId) {
          let repOrderQuery = Order.findById(rep.replacementOrderId);
          if (repOrderQuery && typeof repOrderQuery.select === 'function') {
            repOrderQuery = repOrderQuery.select('orderNumber status');
          }
          repOrder = repOrderQuery && typeof repOrderQuery.lean === 'function' ? await repOrderQuery.lean() : await repOrderQuery;
        }
        if (rep.replacementVendorOrderId) {
          let repVoQuery = VendorOrder.findById(rep.replacementVendorOrderId);
          if (repVoQuery && typeof repVoQuery.select === 'function') {
            repVoQuery = repVoQuery.select('status');
          }
          repVendorOrder = repVoQuery && typeof repVoQuery.lean === 'function' ? await repVoQuery.lean() : await repVoQuery;

          if (isQueryable(Shipment)) {
            let shipQuery = Shipment.findOne({ vendorOrderId: rep.replacementVendorOrderId });
            if (shipQuery && typeof shipQuery.select === 'function') {
              shipQuery = shipQuery.select('packageInfo status');
            }
            repShipment = shipQuery && typeof shipQuery.lean === 'function' ? await shipQuery.lean() : await shipQuery;
          }
        }
        const voStatus = repVendorOrder?.status || null;
        resultDto.replacement = {
          _id: rep._id,
          replacementNumber: rep.replacementNumber,
          status: rep.status,
          quantity: rep.quantity,
          replacementOrderId: rep.replacementOrderId,
          replacementOrderNumber: repOrder?.orderNumber || null,
          vendorOrderStatus: voStatus,
          fulfillmentStatus: voStatus === 'READY_TO_SHIP' ? 'READY_TO_SHIP' : (voStatus === 'PACKED' ? 'PACKED' : (voStatus === 'PROCESSING' ? 'PROCESSING' : rep.status)),
          packageInfo: repShipment?.packageInfo || null,
          readyToShip: voStatus === 'READY_TO_SHIP',
          createdAt: rep.createdAt,
        };
      }
    } catch (_) {}
  }

  if (isQueryable(ReturnShipment)) {
    try {
      const revShip = await ReturnShipment.findOne({ returnId: returnDoc._id, status: { $ne: 'CANCELLED' } }) ||
                      await ReturnShipment.findOne({ returnId: returnDoc._id }).sort({ createdAt: -1 });
      if (revShip) {
        resultDto.reverseShipment = returnShipmentService.buildShipmentDto(revShip, 'VENDOR');
      }
    } catch (_) {}
  }

  return resultDto;
};

export const listVendorReturns = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const query = sellerReturnListQuerySchema.parse(req.query ?? {});
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const filter = { vendorId: vendor._id };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.returnNumber) {
      filter.returnNumber = new RegExp(query.returnNumber.trim(), 'i');
    }

    if (query.fromDate || query.toDate) {
      filter.createdAt = {};
      if (query.fromDate) filter.createdAt.$gte = new Date(query.fromDate);
      if (query.toDate) filter.createdAt.$lte = new Date(query.toDate);
    }

    if (query.orderNumber) {
      const orders = await Order.find({ orderNumber: new RegExp(query.orderNumber.trim(), 'i') }).select('_id').lean();
      filter.orderId = { $in: orders.map((o) => o._id) };
    }

    if (query.search) {
      const s = query.search.trim();
      const matchingOrders = await Order.find({ orderNumber: new RegExp(s, 'i') }).select('_id').lean();
      filter.$or = [
        { returnNumber: new RegExp(s, 'i') },
        { orderId: { $in: matchingOrders.map((o) => o._id) } },
      ];
    }

    const total = await Return.countDocuments(filter);
    const docs = await Return.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
    const items = await Promise.all(docs.map((doc) => buildVendorReturnDto(doc)));

    sendSuccess(res, { items, page, limit, total }, 'Vendor returns loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getVendorReturn = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const returnDoc = await Return.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!returnDoc) {
      const otherReturn = await Return.findById(req.params.id).lean();
      if (otherReturn) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
      }
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    sendSuccess(res, await buildVendorReturnDto(returnDoc), 'Vendor return loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const sellerReviewReturn = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const returnDoc = await Return.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!returnDoc) {
      const otherReturn = await Return.findById(req.params.id).lean();
      if (otherReturn) throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const payload = sellerReviewReturnSchema.parse(req.body ?? {});
    await returnStateService.transitionReturnStatus(returnDoc.status, 'UNDER_REVIEW', {
      returnId: returnDoc._id,
      actorType: 'VENDOR',
      actorId: req.user.sub,
      reason: payload.notes || 'Seller reviewed return request',
    });

    returnDoc.status = 'UNDER_REVIEW';
    returnDoc.reviewedAt = new Date();
    returnDoc.reviewedBy = req.user.sub;
    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: 'UNDER_REVIEW',
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: 'VENDOR',
      notes: payload.notes || 'Seller reviewed return request',
    });
    await returnDoc.save();

    sendSuccess(res, await buildVendorReturnDto(returnDoc), 'Return marked under review', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const sellerApproveReturn = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const returnDoc = await Return.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!returnDoc) {
      const otherReturn = await Return.findById(req.params.id).lean();
      if (otherReturn) throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const payload = sellerApproveReturnSchema.parse(req.body ?? {});

    // Idempotency: if already approved, safely return existing state
    if (returnDoc.status === 'APPROVED') {
      return sendSuccess(
        res,
        await buildVendorReturnDto(returnDoc),
        'Return already approved',
        String(req.headers['x-request-id'] ?? '')
      );
    }

    if (returnDoc.status !== 'UNDER_REVIEW') {
      throw new AppError(
        400,
        'INVALID_RETURN_TRANSITION',
        `Cannot approve return with status ${returnDoc.status}. Only UNDER_REVIEW returns can be approved by seller.`
      );
    }

    await returnStateService.transitionReturnStatus(returnDoc.status, 'APPROVED', {
      returnId: returnDoc._id,
      actorType: 'VENDOR',
      actorId: req.user.sub,
      reason: payload.notes || 'Seller approved return request',
    });

    returnDoc.status = 'APPROVED';
    returnDoc.approvedAt = new Date();
    returnDoc.approvedBy = req.user.sub;
    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: 'APPROVED',
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: 'VENDOR',
      notes: payload.notes || 'Seller approved return request',
    });
    await returnDoc.save();

    returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_APPROVED', returnDoc }).catch(() => null);
    returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_APPROVED', returnDoc }).catch(() => null);

    // Auto-process reverse logistics (creates ReturnShipment, assigns authentic AWB, generates label, requests pickup)
    try {
      await returnShipmentService.autoProcessReverseShipment({
        returnId: returnDoc._id,
        returnDoc,
        user: req.user,
        packageInfo: payload.packageInfo,
      });
    } catch (reverseError) {
      // Seller approval itself must not be rolled back if reverse logistics encounters provider failure
      auditService.log('REVERSE_AUTO_PROCESS_ERROR', {
        returnId: returnDoc._id?.toString(),
        error: reverseError.message,
      });
    }

    sendSuccess(
      res,
      await buildVendorReturnDto(returnDoc),
      'Return approved by seller',
      String(req.headers['x-request-id'] ?? '')
    );
  } catch (error) {
    next(error);
  }
};

export const sellerMarkReturnReceived = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const returnDoc = await Return.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!returnDoc) {
      const otherReturn = await Return.findById(req.params.id).lean();
      if (otherReturn) throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    // Guard: Carrier-managed returns cannot be manually marked received before carrier delivery
    if (isQueryable(ReturnShipment)) {
      const activeShipment = await ReturnShipment.findOne({
        returnId: returnDoc._id,
        status: { $nin: ['CANCELLED', 'DELIVERED'] },
      });
      if (activeShipment) {
        throw new AppError(
          400,
          'CARRIER_DELIVERY_REQUIRED',
          `Cannot manually mark return as received. Active reverse shipment ${activeShipment.shipmentNumber} is managed by carrier and is currently ${activeShipment.status}. Receipt will be recorded automatically upon carrier delivery.`
        );
      }
    }

    const payload = sellerReceiveReturnSchema.parse(req.body ?? {});
    await returnStateService.transitionReturnStatus(returnDoc.status, 'RETURN_RECEIVED', {
      returnId: returnDoc._id,
      actorType: 'VENDOR',
      actorId: req.user.sub,
      reason: payload.notes || 'Seller marked return as received',
    });

    returnDoc.status = 'RETURN_RECEIVED';
    returnDoc.receivedAt = new Date();
    returnDoc.receivedBy = req.user.sub;
    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: 'RETURN_RECEIVED',
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: 'VENDOR',
      notes: payload.notes || 'Return received by seller',
    });
    await returnDoc.save();

    returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_RECEIVED', returnDoc }).catch(() => null);
    returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_RECEIVED', returnDoc }).catch(() => null);
    returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_INSPECTION_PENDING', returnDoc }).catch(() => null);

    sendSuccess(res, await buildVendorReturnDto(returnDoc), 'Return marked as received', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const sellerReadyForInspection = async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let vendor = null;
    if (!isAdmin) {
      vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
      if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');
    }

    const query = isAdmin ? { _id: req.params.id } : { _id: req.params.id, vendorId: vendor._id };
    const returnDoc = await Return.findOne(query);
    if (!returnDoc) {
      const otherReturn = await Return.findById(req.params.id).lean();
      if (otherReturn) throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    if (returnDoc.status === 'INSPECTION_PENDING') {
      return sendSuccess(res, await buildVendorReturnDto(returnDoc), 'Return is already pending inspection', String(req.headers['x-request-id'] ?? ''));
    }

    await returnStateService.transitionReturnStatus(returnDoc.status, 'INSPECTION_PENDING', {
      returnId: returnDoc._id,
      actorType: isAdmin ? 'ADMIN' : 'VENDOR',
      actorId: req.user.sub,
      reason: 'Return ready for inspection',
    });

    returnDoc.status = 'INSPECTION_PENDING';
    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: 'INSPECTION_PENDING',
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: isAdmin ? 'ADMIN' : 'VENDOR',
      notes: 'Return is pending inspection',
    });
    await returnDoc.save();

    returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_INSPECTION_STARTED', returnDoc }).catch(() => null);
    returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_INSPECTION_PENDING', returnDoc }).catch(() => null);

    auditService.log('INSPECTION_STARTED', {
      returnId: returnDoc._id?.toString(),
      vendorId: returnDoc.vendorId?.toString(),
      actor: req.user.sub,
      role: isAdmin ? 'ADMIN' : 'VENDOR',
      timestamp: new Date(),
    });

    sendSuccess(res, await buildVendorReturnDto(returnDoc), 'Return moved to inspection pending', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const sellerSubmitInspection = async (req, res, next) => {
  try {
    const payload = sellerInspectionSchema.parse(req.body ?? {});

    const isAdmin = req.user.role === 'admin';
    let vendor = null;
    if (!isAdmin) {
      vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
      if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');
    }

    const query = isAdmin ? { _id: req.params.id } : { _id: req.params.id, vendorId: vendor._id };
    const returnDoc = await Return.findOne(query);
    if (!returnDoc) {
      const otherReturn = await Return.findById(req.params.id).lean();
      if (otherReturn) throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    if (['INSPECTION_PASSED', 'INSPECTION_FAILED', 'COMPLETED', 'CLOSED'].includes(returnDoc.status) || returnDoc.inspection?.inspectedAt) {
      throw new AppError(409, 'INSPECTION_ALREADY_COMPLETED', 'Inspection has already been completed for this return');
    }

    if (!['INSPECTION_PENDING', 'RETURN_RECEIVED', 'INSPECTING'].includes(returnDoc.status)) {
      throw new AppError(400, 'INVALID_RETURN_STATE', `Return cannot be inspected from status ${returnDoc.status}`);
    }

    if (returnDoc.status === 'RETURN_RECEIVED') {
      await returnStateService.transitionReturnStatus(returnDoc.status, 'INSPECTION_PENDING', {
        returnId: returnDoc._id,
        actorType: isAdmin ? 'ADMIN' : 'VENDOR',
        actorId: req.user.sub,
        reason: 'Return received by seller. Beginning inspection.',
      });
      returnDoc.status = 'INSPECTION_PENDING';
      if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
      returnDoc.statusHistory.push({
        status: 'INSPECTION_PENDING',
        changedAt: new Date(),
        changedBy: req.user.sub,
        actorType: isAdmin ? 'ADMIN' : 'VENDOR',
        notes: 'Transitioned to inspection pending prior to recording inspection',
      });
      auditService.log('INSPECTION_STARTED', {
        returnId: returnDoc._id?.toString(),
        vendorId: returnDoc.vendorId?.toString(),
        actor: req.user.sub,
        role: isAdmin ? 'ADMIN' : 'VENDOR',
        timestamp: new Date(),
      });
    }

    const normalizedResult = (payload.result === 'PASS' || payload.result === 'PASSED') ? 'PASSED' : 'FAILED';
    const nextStatus = normalizedResult === 'PASSED' ? 'INSPECTION_PASSED' : 'INSPECTION_FAILED';
    const effectiveNotes = payload.notes || payload.conditionNotes || '';

    if (normalizedResult === 'FAILED' && (!effectiveNotes || !effectiveNotes.trim() || effectiveNotes.trim().length < 3)) {
      throw new AppError(400, 'INSPECTION_REASON_REQUIRED', 'Inspection failure requires a reason/notes');
    }

    let dbItems = [];
    if (isQueryable(ReturnItem)) {
      dbItems = await ReturnItem.find({ _id: { $in: returnDoc.items || [] } });
    }

    let inspectedItems = [];
    let totalReturned = 0;
    let totalAccepted = 0;
    let totalRejected = 0;

    if (payload.items && Array.isArray(payload.items) && payload.items.length > 0) {
      for (const itPayload of payload.items) {
        const match = dbItems.find(it =>
          (itPayload.returnItemId && String(it._id) === String(itPayload.returnItemId)) ||
          (itPayload.variantId && String(it.variantId) === String(itPayload.variantId))
        ) || (dbItems.length === 1 ? dbItems[0] : null);

        const returnedQty = itPayload.returnedQuantity !== undefined
          ? itPayload.returnedQuantity
          : (match ? match.quantity : (itPayload.acceptedQuantity + itPayload.rejectedQuantity));

        if (itPayload.acceptedQuantity < 0 || itPayload.rejectedQuantity < 0) {
          throw new AppError(400, 'INVALID_INSPECTION_QUANTITY', 'Accepted and rejected quantities cannot be negative');
        }
        if (itPayload.acceptedQuantity > returnedQty) {
          throw new AppError(400, 'INVALID_ACCEPTED_QUANTITY', 'Accepted quantity cannot exceed returned quantity');
        }
        if (itPayload.rejectedQuantity > returnedQty) {
          throw new AppError(400, 'INVALID_REJECTED_QUANTITY', 'Rejected quantity cannot exceed returned quantity');
        }
        if (itPayload.acceptedQuantity + itPayload.rejectedQuantity > returnedQty) {
          throw new AppError(400, 'EXCESS_INSPECTION_QUANTITY', 'Sum of accepted and rejected quantities cannot exceed returned quantity');
        }
        if (itPayload.acceptedQuantity + itPayload.rejectedQuantity !== returnedQty) {
          throw new AppError(400, 'INCOMPLETE_INSPECTION_QUANTITY', 'Sum of accepted and rejected quantities must equal the returned quantity');
        }

        totalReturned += returnedQty;
        totalAccepted += itPayload.acceptedQuantity;
        totalRejected += itPayload.rejectedQuantity;

        const disposition = {
          returnItemId: match?._id || itPayload.returnItemId || null,
          variantId: match?.variantId || itPayload.variantId || null,
          returnedQuantity: returnedQty,
          acceptedQuantity: itPayload.acceptedQuantity,
          rejectedQuantity: itPayload.rejectedQuantity,
          condition: itPayload.condition || payload.condition || 'INTACT',
          itemCondition: itPayload.itemCondition || itPayload.condition || payload.itemCondition || payload.condition || 'INTACT',
          notes: itPayload.notes || itPayload.conditionNotes || effectiveNotes || null,
          evidence: itPayload.evidence || itPayload.proofImages || payload.evidence || payload.proofImages || [],
          authenticityCondition: itPayload.authenticityCondition || payload.authenticityCondition || null,
        };
        inspectedItems.push(disposition);

        if (match && typeof match.save === 'function') {
          match.inspection = {
            inspectedAt: new Date(),
            inspectedBy: req.user.sub,
            result: itPayload.acceptedQuantity === returnedQty ? 'PASSED' : (itPayload.rejectedQuantity === returnedQty ? 'FAILED' : 'PARTIAL'),
            acceptedQuantity: itPayload.acceptedQuantity,
            rejectedQuantity: itPayload.rejectedQuantity,
            condition: disposition.condition,
            itemCondition: disposition.itemCondition,
            notes: disposition.notes,
            evidence: disposition.evidence,
            authenticityCondition: disposition.authenticityCondition,
          };
          await match.save().catch(() => {});
        }
      }
    } else {
      if (dbItems.length > 0) {
        for (const it of dbItems) {
          const returnedQty = it.quantity || 1;
          const acceptedQty = normalizedResult === 'PASSED' ? returnedQty : 0;
          const rejectedQty = normalizedResult === 'PASSED' ? 0 : returnedQty;
          totalReturned += returnedQty;
          totalAccepted += acceptedQty;
          totalRejected += rejectedQty;

          const disposition = {
            returnItemId: it._id,
            variantId: it.variantId,
            returnedQuantity: returnedQty,
            acceptedQuantity: acceptedQty,
            rejectedQuantity: rejectedQty,
            condition: payload.condition || 'INTACT',
            itemCondition: payload.itemCondition || payload.condition || 'INTACT',
            notes: effectiveNotes || null,
            evidence: payload.evidence || payload.proofImages || [],
            authenticityCondition: payload.authenticityCondition || null,
          };
          inspectedItems.push(disposition);

          if (typeof it.save === 'function') {
            it.inspection = {
              inspectedAt: new Date(),
              inspectedBy: req.user.sub,
              result: normalizedResult,
              acceptedQuantity: acceptedQty,
              rejectedQuantity: rejectedQty,
              condition: disposition.condition,
              itemCondition: disposition.itemCondition,
              notes: disposition.notes,
              evidence: disposition.evidence,
              authenticityCondition: disposition.authenticityCondition,
            };
            await it.save().catch(() => {});
          }
        }
      } else {
        totalReturned = 1;
        totalAccepted = normalizedResult === 'PASSED' ? 1 : 0;
        totalRejected = normalizedResult === 'PASSED' ? 0 : 1;
      }
    }

    await returnStateService.transitionReturnStatus(returnDoc.status, nextStatus, {
      returnId: returnDoc._id,
      actorType: isAdmin ? 'ADMIN' : 'VENDOR',
      actorId: req.user.sub,
      reason: effectiveNotes || `Inspection ${normalizedResult}`,
    });

    returnDoc.status = nextStatus;
    returnDoc.inspection = {
      inspectedBy: req.user.sub,
      inspectedAt: new Date(),
      result: normalizedResult,
      condition: payload.condition || 'INTACT',
      itemCondition: payload.itemCondition || payload.condition || 'INTACT',
      conditionNotes: payload.conditionNotes || null,
      notes: effectiveNotes || null,
      proofImages: payload.proofImages || payload.evidence || [],
      evidence: payload.evidence || payload.proofImages || [],
      packagingCondition: payload.packagingCondition || null,
      accessoriesComplete: payload.accessoriesComplete !== undefined ? payload.accessoriesComplete : null,
      authenticityCondition: payload.authenticityCondition || null,
      totalReturnedQuantity: totalReturned,
      totalAcceptedQuantity: totalAccepted,
      totalRejectedQuantity: totalRejected,
      items: inspectedItems,
    };

    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: nextStatus,
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: isAdmin ? 'ADMIN' : 'VENDOR',
      notes: `Inspection completed: ${normalizedResult} - ${payload.condition || 'INTACT'}${effectiveNotes ? ` (${effectiveNotes})` : ''}`,
    });

    await returnDoc.save();

    if (nextStatus === 'INSPECTION_PASSED') {
      returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_INSPECTION_PASSED', returnDoc }).catch(() => null);
      returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_DISPOSITION_REQUIRED', returnDoc }).catch(() => null);
    } else {
      returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_INSPECTION_FAILED', returnDoc }).catch(() => null);
      returnNotificationService.emitAdminReturnException({ eventType: 'RETURN_INSPECTION_FAILED', returnDoc }).catch(() => null);
    }

    auditService.log(nextStatus === 'INSPECTION_PASSED' ? 'RETURN_INSPECTION_PASSED' : 'RETURN_INSPECTION_FAILED', {
      returnId: returnDoc._id?.toString(),
      vendorId: returnDoc.vendorId?.toString(),
      actor: req.user.sub,
      role: isAdmin ? 'ADMIN' : 'VENDOR',
      result: normalizedResult,
      timestamp: new Date(),
    });

    sendSuccess(res, await buildVendorReturnDto(returnDoc), `Inspection recorded: ${normalizedResult}`, String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const sellerRaiseDispute = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const returnDoc = await Return.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!returnDoc) {
      const otherReturn = await Return.findById(req.params.id).lean();
      if (otherReturn) throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const payload = sellerDisputeSchema.parse(req.body ?? {});

    await returnStateService.transitionReturnStatus(returnDoc.status, 'DISPUTED', {
      returnId: returnDoc._id,
      actorType: 'VENDOR',
      actorId: req.user.sub,
      reason: payload.description || payload.reason,
    });

    returnDoc.status = 'DISPUTED';
    returnDoc.dispute = {
      disputedBy: req.user.sub,
      disputedAt: new Date(),
      reason: payload.reason,
      description: payload.description,
      evidence: payload.evidence || [],
      status: 'PENDING_ADMIN_REVIEW',
    };
    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: 'DISPUTED',
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: 'VENDOR',
      notes: `Dispute raised: ${payload.reason} - ${payload.description}`,
    });

    await returnDoc.save();

    returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_DISPUTED', returnDoc }).catch(() => null);
    returnNotificationService.emitAdminReturnException({ eventType: 'RETURN_DISPUTED', returnDoc }).catch(() => null);

    sendSuccess(res, await buildVendorReturnDto(returnDoc), 'Dispute raised successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const sellerResolveDispute = async (req, res, next) => {
  try {
    throw new AppError(403, 'FORBIDDEN', 'Sellers are not permitted to resolve disputes');
  } catch (error) {
    next(error);
  }
};

export const buildAdminReturnDto = async (doc) => {
  const returnDoc = doc.toObject ? doc.toObject() : doc;

  let items = [];
  try {
    const rawItems = ReturnItem.find({ _id: { $in: returnDoc.items || [] } });
    const fetched = rawItems && typeof rawItems.lean === 'function' ? await rawItems.lean() : await rawItems;
    items = Array.isArray(fetched) ? fetched.map((i) => (i?.toObject ? i.toObject() : i)) : [];
  } catch (_) {
    items = [];
  }

  let orderData = null;
  let orderDoc = null;
  if (returnDoc.orderId) {
    try {
      const rawOrder = Order.findById(returnDoc.orderId);
      orderDoc = rawOrder && typeof rawOrder.lean === 'function' ? await rawOrder.lean() : await rawOrder;
      if (orderDoc?.toObject) orderDoc = orderDoc.toObject();
      if (orderDoc) {
        orderData = {
          _id: orderDoc._id,
          orderNumber: orderDoc.orderNumber,
          status: orderDoc.status,
          paymentMethod: orderDoc.paymentMethod,
          paymentStatus: orderDoc.paymentStatus,
          total: orderDoc.total,
          currency: orderDoc.currency || 'INR',
          createdAt: orderDoc.createdAt,
          shippingAddress: {
            fullName: orderDoc.shippingAddress?.fullName || '',
            city: orderDoc.shippingAddress?.city || '',
            state: orderDoc.shippingAddress?.state || '',
            pincode: orderDoc.shippingAddress?.pincode || '',
          },
        };
      }
    } catch (_) {}
  }

  let customerData = null;
  if (returnDoc.customerId) {
    try {
      let rawUser = User.findById(returnDoc.customerId);
      if (rawUser && typeof rawUser.select === 'function') {
        rawUser = rawUser.select('name email phone firstName lastName');
      }
      const user = rawUser && typeof rawUser.lean === 'function' ? await rawUser.lean() : await rawUser;
      if (user) {
        const u = user.toObject ? user.toObject() : user;
        customerData = {
          _id: u._id,
          name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Customer',
          email: u.email,
          phone: u.phone || '',
        };
      }
    } catch (_) {}
  }

  let vendorData = null;
  if (returnDoc.vendorId) {
    try {
      let rawVendor = Vendor.findById(returnDoc.vendorId);
      if (rawVendor && typeof rawVendor.select === 'function') {
        rawVendor = rawVendor.select('storeName businessName email');
      }
      const vendor = rawVendor && typeof rawVendor.lean === 'function' ? await rawVendor.lean() : await rawVendor;
      if (vendor) {
        const v = vendor.toObject ? vendor.toObject() : vendor;
        vendorData = {
          _id: v._id,
          storeName: v.storeName || v.businessName || 'Vendor',
          businessName: v.businessName || '',
          email: v.email || '',
        };
      }
    } catch (_) {}
  }

  let vendorOrderData = null;
  let voDoc = null;
  if (returnDoc.vendorOrderId) {
    try {
      const rawVo = VendorOrder.findById(returnDoc.vendorOrderId);
      voDoc = rawVo && typeof rawVo.lean === 'function' ? await rawVo.lean() : await rawVo;
      if (voDoc) {
        const v = voDoc.toObject ? voDoc.toObject() : voDoc;
        vendorOrderData = {
          _id: v._id,
          status: v.status,
          total: v.total,
        };
      }
    } catch (_) {}
  }

  // Authoritative proportional refund calculation preview (read-only)
  let calculatedRefund = null;
  if (orderDoc && items.length > 0) {
    try {
      calculatedRefund = refundService.calculateRefund({
        order: orderDoc,
        vendorOrder: voDoc,
        returnItems: items,
        proportional: true,
      });
    } catch (_) {}
  }

  let safePayoutDetails = null;
  if (returnDoc.payoutDetails && returnDoc.payoutDetails.method) {
    safePayoutDetails = {
      method: returnDoc.payoutDetails.method,
      upiId: returnDoc.payoutDetails.upiId || null,
      accountHolderName: returnDoc.payoutDetails.accountHolderName || null,
      maskedAccountNumber:
        returnDoc.payoutDetails.maskedAccountNumber ||
        (returnDoc.payoutDetails.accountNumber ? `****${returnDoc.payoutDetails.accountNumber.slice(-4)}` : null),
      ifscCode: returnDoc.payoutDetails.ifscCode || null,
      bankName: returnDoc.payoutDetails.bankName || null,
      submittedAt: returnDoc.payoutDetails.submittedAt || null,
    };
  }

  const adminResultDto = {
    _id: returnDoc._id,
    returnNumber: returnDoc.returnNumber,
    orderId: returnDoc.orderId,
    vendorOrderId: returnDoc.vendorOrderId,
    customerId: returnDoc.customerId,
    vendorId: returnDoc.vendorId,
    type: returnDoc.type,
    reason: returnDoc.reason,
    description: returnDoc.description,
    status: returnDoc.status,
    items,
    evidenceImages: returnDoc.evidenceImages || [],
    requestedAt: returnDoc.requestedAt,
    reviewedAt: returnDoc.reviewedAt,
    reviewedBy: returnDoc.reviewedBy,
    approvedAt: returnDoc.approvedAt,
    approvedBy: returnDoc.approvedBy || null,
    rejectedAt: returnDoc.rejectedAt,
    receivedAt: returnDoc.receivedAt,
    receivedBy: returnDoc.receivedBy,
    completedAt: returnDoc.completedAt,
    inspection: returnDoc.inspection || null,
    dispute: returnDoc.dispute || null,
    resolution: returnDoc.resolution || null,
    disposition: returnDoc.disposition || null,
    refundDetails: returnDoc.refundDetails || null,
    payoutDetails: safePayoutDetails,
    manualPayout: returnDoc.manualPayout || null,
    statusHistory: returnDoc.statusHistory || [],
    order: orderData,
    customer: customerData,
    vendor: vendorData,
    vendorOrder: vendorOrderData,
    calculatedRefund,
    replacement: null,
    createdAt: returnDoc.createdAt,
    updatedAt: returnDoc.updatedAt,
  };

  if (isQueryable(Replacement)) {
    try {
      const repQuery = Replacement.findOne({ returnId: returnDoc._id });
      const rep = repQuery && typeof repQuery.lean === 'function' ? await repQuery.lean() : await repQuery;
      if (rep) {
        let repOrder = null;
        let repVendorOrder = null;
        let repShipment = null;
        if (rep.replacementOrderId) {
          let repOrderQuery = Order.findById(rep.replacementOrderId);
          if (repOrderQuery && typeof repOrderQuery.select === 'function') {
            repOrderQuery = repOrderQuery.select('orderNumber status total currency createdAt');
          }
          repOrder = repOrderQuery && typeof repOrderQuery.lean === 'function' ? await repOrderQuery.lean() : await repOrderQuery;
        }
        if (rep.replacementVendorOrderId) {
          let repVoQuery = VendorOrder.findById(rep.replacementVendorOrderId);
          if (repVoQuery && typeof repVoQuery.select === 'function') {
            repVoQuery = repVoQuery.select('status total createdAt');
          }
          repVendorOrder = repVoQuery && typeof repVoQuery.lean === 'function' ? await repVoQuery.lean() : await repVoQuery;

          if (isQueryable(Shipment)) {
            let shipQuery = Shipment.findOne({ vendorOrderId: rep.replacementVendorOrderId });
            if (shipQuery && typeof shipQuery.select === 'function') {
              shipQuery = shipQuery.select('_id shipmentNumber provider providerShipmentId providerOrderId carrier trackingNumber trackingUrl labelUrl pickupStatus pickupScheduledAt status packageInfo metadata createdAt');
            }
            repShipment = shipQuery && typeof shipQuery.lean === 'function' ? await shipQuery.lean() : await shipQuery;
          }
        }
        const voStatus = repVendorOrder?.status || null;
        adminResultDto.replacement = {
          _id: rep._id,
          replacementNumber: rep.replacementNumber,
          status: rep.status,
          quantity: rep.quantity,
          replacementOrderId: rep.replacementOrderId,
          replacementOrderNumber: repOrder?.orderNumber || null,
          replacementOrderStatus: repOrder?.status || null,
          vendorOrderStatus: voStatus,
          fulfillmentStatus: voStatus === 'READY_TO_SHIP' ? 'READY_TO_SHIP' : (voStatus === 'PACKED' ? 'PACKED' : (voStatus === 'PROCESSING' ? 'PROCESSING' : rep.status)),
          packageInfo: repShipment?.packageInfo || null,
          readyToShip: voStatus === 'READY_TO_SHIP',
          failureReason: rep.failureReason,
          shipment: repShipment ? {
            _id: repShipment._id,
            shipmentNumber: repShipment.shipmentNumber,
            provider: repShipment.provider,
            providerShipmentId: repShipment.providerShipmentId,
            providerOrderId: repShipment.providerOrderId,
            carrier: repShipment.carrier,
            trackingNumber: repShipment.trackingNumber,
            trackingUrl: repShipment.trackingUrl,
            labelUrl: repShipment.labelUrl,
            hasLabel: Boolean(repShipment.labelUrl && !repShipment.labelUrl.includes('/api/v1/vendors/orders/')),
            pickupStatus: repShipment.pickupStatus,
            pickupScheduledAt: repShipment.pickupScheduledAt,
            status: repShipment.status,
            awbError: repShipment.metadata?.awbError || null,
            labelError: repShipment.metadata?.labelError || null,
            pickupError: repShipment.metadata?.pickupError || null,
            stagesCompleted: repShipment.metadata?.stagesCompleted || [],
          } : null,
          createdAt: rep.createdAt,
          approvedAt: rep.approvedAt,
          completedAt: rep.completedAt,
        };
      }
    } catch (_) {}
  }

  if (isQueryable(ReturnShipment)) {
    try {
      const revShip = await ReturnShipment.findOne({ returnId: returnDoc._id, status: { $ne: 'CANCELLED' } }) ||
                      await ReturnShipment.findOne({ returnId: returnDoc._id }).sort({ createdAt: -1 });
      if (revShip) {
        adminResultDto.reverseShipment = returnShipmentService.buildShipmentDto(revShip, 'ADMIN');
      }
    } catch (_) {}
  }

  return adminResultDto;
};

export const listAdminReturns = async (req, res, next) => {
  try {
    const query = adminReturnListQuerySchema.parse(req.query ?? {});
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const filter = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.vendorId) {
      filter.vendorId = query.vendorId;
    }

    if (query.customerId) {
      filter.customerId = query.customerId;
    }

    if (query.returnNumber) {
      filter.returnNumber = new RegExp(query.returnNumber.trim(), 'i');
    }

    if (query.fromDate || query.toDate) {
      filter.createdAt = {};
      if (query.fromDate) filter.createdAt.$gte = new Date(query.fromDate);
      if (query.toDate) filter.createdAt.$lte = new Date(query.toDate);
    }

    if (query.orderNumber) {
      const orders = await Order.find({ orderNumber: new RegExp(query.orderNumber.trim(), 'i') }).select('_id').lean();
      filter.orderId = { $in: orders.map((o) => o._id) };
    }

    if (query.search) {
      const s = query.search.trim();
      const matchingOrders = await Order.find({ orderNumber: new RegExp(s, 'i') }).select('_id').lean();
      filter.$or = [
        { returnNumber: new RegExp(s, 'i') },
        { orderId: { $in: matchingOrders.map((o) => o._id) } },
      ];
    }

    const total = await Return.countDocuments(filter);
    const returns = await Return.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit);
    const items = await Promise.all(returns.map((doc) => buildAdminReturnDto(doc)));

    sendSuccess(res, { items, page, limit, total }, 'Admin returns loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getAdminReturn = async (req, res, next) => {
  try {
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    sendSuccess(res, await buildAdminReturnDto(returnDoc), 'Admin return loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminDisputeDecision = async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Only administrators can decide disputes');
    }

    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    if (returnDoc.status !== 'DISPUTED' && returnDoc.dispute?.status !== 'PENDING_ADMIN_REVIEW') {
      throw new AppError(400, 'RETURN_NOT_DISPUTED', 'Only disputed returns can be arbitrated');
    }

    const payload = adminDisputeDecisionSchema.parse(req.body ?? {});

    let nextStatus = returnDoc.status;
    let disputeStatus = 'PENDING_ADMIN_REVIEW';

    if (payload.decision === 'UPHOLD_CUSTOMER') {
      nextStatus = 'APPROVED_FOR_REFUND';
      disputeStatus = 'RESOLVED_CUSTOMER';
    } else if (payload.decision === 'UPHOLD_SELLER') {
      nextStatus = 'REJECTED_AFTER_INSPECTION';
      disputeStatus = 'RESOLVED_SELLER';
    } else if (payload.decision === 'REQUEST_MORE_INFO') {
      nextStatus = returnDoc.status;
      disputeStatus = 'MORE_INFO_REQUESTED';
    }

    if (nextStatus !== returnDoc.status) {
      await returnStateService.transitionReturnStatus(returnDoc.status, nextStatus, {
        returnId: returnDoc._id,
        actorType: 'ADMIN',
        actorId: req.user.sub,
        reason: payload.decisionReason,
      });
      returnDoc.status = nextStatus;
    }

    if (!returnDoc.dispute) returnDoc.dispute = {};
    returnDoc.dispute.decision = payload.decision;
    returnDoc.dispute.decisionReason = payload.decisionReason;
    returnDoc.dispute.decidedBy = req.user.sub;
    returnDoc.dispute.decidedAt = new Date();
    returnDoc.dispute.adminNotes = payload.adminNotes || null;
    returnDoc.dispute.status = disputeStatus;

    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: nextStatus,
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: 'ADMIN',
      notes: `Admin dispute decision: ${payload.decision} - ${payload.decisionReason}`,
    });

    // DO NOT modify inventory (Section 8)
    await returnDoc.save();

    sendSuccess(res, await buildAdminReturnDto(returnDoc), 'Dispute decision recorded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminResolveReturn = async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Only administrators can resolve returns');
    }

    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    const payload = adminReturnResolutionSchema.parse(req.body ?? {});

    let nextStatus;
    if (payload.resolution === 'RETURN_REFUND') {
      nextStatus = 'APPROVED_FOR_REFUND';
    } else if (payload.resolution === 'REPLACEMENT') {
      nextStatus = 'REPLACEMENT_PENDING';
    } else if (payload.resolution === 'REJECT_RETURN') {
      nextStatus = 'REJECTED_AFTER_INSPECTION';
    } else {
      throw new AppError(400, 'INVALID_RESOLUTION', 'Invalid return resolution action');
    }

    await returnStateService.transitionReturnStatus(returnDoc.status, nextStatus, {
      returnId: returnDoc._id,
      actorType: 'ADMIN',
      actorId: req.user.sub,
      reason: payload.notes || `Resolved as ${payload.resolution}`,
    });

    returnDoc.status = nextStatus;

    let calculatedRefundAmount = null;
    if (payload.resolution === 'RETURN_REFUND') {
      let order = null;
      try {
        const rawOrder = Order.findById(returnDoc.orderId);
        order = rawOrder && typeof rawOrder.lean === 'function' ? await rawOrder.lean() : await rawOrder;
        if (order?.toObject) order = order.toObject();
      } catch (_) {}
      if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found for return');

      let returnItems = [];
      try {
        const rawItems = ReturnItem.find({ _id: { $in: returnDoc.items || [] } });
        const fetched = rawItems && typeof rawItems.lean === 'function' ? await rawItems.lean() : await rawItems;
        returnItems = Array.isArray(fetched) ? fetched.map((i) => (i?.toObject ? i.toObject() : i)) : [];
      } catch (_) {}

      let vendorOrder = null;
      if (returnDoc.vendorOrderId) {
        try {
          const rawVo = VendorOrder.findById(returnDoc.vendorOrderId);
          vendorOrder = rawVo && typeof rawVo.lean === 'function' ? await rawVo.lean() : await rawVo;
          if (vendorOrder?.toObject) vendorOrder = vendorOrder.toObject();
        } catch (_) {}
      }

      // Authoritative proportional refund calculation from Phase 1
      const refundCalc = refundService.calculateRefund({
        order,
        vendorOrder,
        returnItems,
        proportional: true,
      });

      calculatedRefundAmount = refundCalc.amount;
      returnDoc.refundDetails = {
        amount: calculatedRefundAmount,
        calculation: refundCalc,
        status: 'APPROVED_PENDING_EXECUTION',
      };
      // Note: COD returns kept pending, Razorpay NOT called in Phase 4
    }

    returnDoc.resolution = {
      action: payload.resolution,
      resolvedBy: req.user.sub,
      resolvedAt: new Date(),
      notes: payload.notes || null,
      calculatedRefundAmount,
    };

    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: nextStatus,
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: 'ADMIN',
      notes: `Admin return resolution: ${payload.resolution}${payload.notes ? ` - ${payload.notes}` : ''}`,
    });

    // DO NOT modify inventory (Section 8 & 13)
    await returnDoc.save();

    sendSuccess(res, await buildAdminReturnDto(returnDoc), `Return resolved as ${payload.resolution}`, String(req.headers['x-request-id'] ?? ''));
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
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found for return');

    const paymentRecord = await Payment.findOne({ orderId: order._id });
    if (!paymentRecord) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found for order');

    const returnItems = await ReturnItem.find({ _id: { $in: returnDoc.items || [] } }).lean();
    const vendorOrder = returnDoc.vendorOrderId
      ? await VendorOrder.findById(returnDoc.vendorOrderId).lean()
      : await VendorOrder.findOne({ parentOrderId: order._id, vendorId: returnDoc.vendorId }).lean();

    const refundCalc = refundService.calculateRefund({
      order,
      vendorOrder,
      returnItems,
      proportional: true,
    });
    const calculatedAmount = refundCalc.amount;

    const isCod = paymentRecord.provider === 'cod' || order.paymentMethod === 'cod';

    const payment = await refundService.createRefund({
      refundData: {
        orderId: order._id,
        paymentId: paymentRecord._id,
        customerId: order.customerId,
        vendorId: returnDoc.vendorId,
        amount: calculatedAmount,
        currency: order.currency || 'INR',
        returnId: returnDoc._id,
        vendorOrderId: returnDoc.vendorOrderId || vendorOrder?._id || null,
        reason: isCod ? 'MANUAL_COD_REFUND_PENDING' : 'RETURN_APPROVED',
      },
    });

    sendSuccess(res, { return: returnDoc.toObject ? returnDoc.toObject() : returnDoc, refund: payment, calculation: refundCalc }, 'Return approved', String(req.headers['x-request-id'] ?? ''));

    returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_APPROVED', returnDoc }).catch(() => null);
    returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_APPROVED', returnDoc }).catch(() => null);
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

    returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_REJECTED', returnDoc }).catch(() => null);

    sendSuccess(res, returnDoc.toObject ? returnDoc.toObject() : returnDoc, 'Return rejected', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const submitCustomerPayoutDetails = async (req, res, next) => {
  try {
    const payload = customerPayoutDetailsSchema.parse(req.body ?? {});
    const returnDoc = await Return.findOne({ _id: req.params.id, customerId: req.user.sub });
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    const order = await Order.findById(returnDoc.orderId).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const payment = await Payment.findOne({ orderId: order._id }).lean();
    const isCod = order.paymentMethod === 'cod' || payment?.provider === 'cod';
    if (!isCod) {
      throw new AppError(400, 'PAYOUT_DETAILS_NOT_APPLICABLE', 'Payout details are only applicable for Cash on Delivery (COD) returns');
    }

    const maskedAccountNumber = payload.accountNumber
      ? `****${payload.accountNumber.slice(-4)}`
      : null;

    returnDoc.payoutDetails = {
      method: payload.method,
      upiId: payload.upiId || null,
      accountHolderName: payload.accountHolderName || null,
      accountNumber: payload.accountNumber || null,
      maskedAccountNumber,
      ifscCode: payload.ifscCode ? payload.ifscCode.toUpperCase() : null,
      bankName: payload.bankName || null,
      submittedAt: new Date(),
    };

    if (!returnDoc.manualPayout) returnDoc.manualPayout = {};
    if (['PENDING_DETAILS', 'NOT_REQUIRED'].includes(returnDoc.manualPayout.status || 'NOT_REQUIRED')) {
      returnDoc.manualPayout.status = 'PAYOUT_REQUIRED';
    }

    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: returnDoc.status,
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: 'CUSTOMER',
      notes: `Customer submitted payout details via ${payload.method}`,
    });

    await returnDoc.save();

    returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_MANUAL_PAYOUT_PENDING', returnDoc }).catch(() => null);
    returnNotificationService.emitAdminReturnException({ eventType: 'RETURN_COD_PAYOUT_PENDING', returnDoc }).catch(() => null);

    sendSuccess(res, await buildReturnDto(returnDoc), 'Payout details saved successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminExecutePrepaidRefund = async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Admin role required');
    }

    const payload = adminExecuteRefundSchema.parse(req.body ?? {});

    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    if (returnDoc.resolution?.action && returnDoc.resolution.action !== 'RETURN_REFUND') {
      throw new AppError(400, 'INVALID_RESOLUTION_FOR_REFUND', `Return resolution is ${returnDoc.resolution.action}, not RETURN_REFUND`);
    }

    if (['REFUNDED', 'COMPLETED', 'CLOSED'].includes(returnDoc.status)) {
      throw new AppError(400, 'RETURN_ALREADY_REFUNDED', 'Return is already refunded or completed');
    }

    if (returnDoc.status === 'REFUND_PROCESSING') {
      throw new AppError(409, 'REFUND_ALREADY_PROCESSING', 'Refund is already currently processing with the provider');
    }

    const validStatuses = ['APPROVED_FOR_REFUND', 'REFUND_PENDING', 'REFUND_FAILED'];
    if (!validStatuses.includes(returnDoc.status)) {
      throw new AppError(400, 'RETURN_NOT_APPROVED_FOR_REFUND', `Return must be in APPROVED_FOR_REFUND or REFUND_PENDING status, currently: ${returnDoc.status}`);
    }

    const order = await Order.findById(returnDoc.orderId);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const payment = await Payment.findOne({ orderId: order._id });
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found for order');

    if (payment.provider === 'cod' || order.paymentMethod === 'cod') {
      throw new AppError(400, 'COD_REFUND_REQUIRES_MANUAL_PAYOUT', 'COD orders cannot be refunded via gateway APIs; use manual COD payout workflow');
    }

    if (!['CAPTURED', 'PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
      throw new AppError(409, 'PAYMENT_NOT_CAPTURED', 'Payment has not been captured; cannot issue refund');
    }

    // Database-backed idempotency check: check if a completed or processing refund already exists for this return
    const existingRefund = await Refund.findOne({
      returnId: returnDoc._id,
      status: { $in: ['COMPLETED', 'PROCESSING'] },
    });
    if (existingRefund) {
      if (existingRefund.status === 'COMPLETED' && returnDoc.status !== 'REFUNDED') {
        returnDoc.status = 'REFUNDED';
        returnDoc.completedAt = new Date();
        await returnDoc.save();
      }
      return sendSuccess(res, await buildAdminReturnDto(returnDoc), 'Refund was already initiated for this return', String(req.headers['x-request-id'] ?? ''));
    }

    // Authoritative refund calculation (never client provided!)
    let refundAmount = Number(returnDoc.resolution?.calculatedRefundAmount ?? returnDoc.refundDetails?.amount ?? 0);
    if (!refundAmount || refundAmount <= 0) {
      const returnItems = await ReturnItem.find({ _id: { $in: returnDoc.items || [] } }).lean();
      const vendorOrder = returnDoc.vendorOrderId ? await VendorOrder.findById(returnDoc.vendorOrderId).lean() : null;
      const refundCalc = refundService.calculateRefund({
        order,
        vendorOrder,
        returnItems,
        proportional: true,
      });
      refundAmount = refundCalc.amount;
    }

    if (refundAmount <= 0) {
      throw new AppError(400, 'INVALID_REFUND_AMOUNT', 'Calculated refund amount must be greater than zero');
    }

    // Atomic transition to REFUND_PENDING
    await returnStateService.transitionReturnStatus(returnDoc.status, 'REFUND_PENDING', {
      returnId: returnDoc._id,
      actorType: 'ADMIN',
      actorId: req.user.sub,
      reason: payload.notes || 'Admin initiated refund execution',
    });
    returnDoc.status = 'REFUND_PENDING';
    if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
    returnDoc.statusHistory.push({
      status: 'REFUND_PENDING',
      changedAt: new Date(),
      changedBy: req.user.sub,
      actorType: 'ADMIN',
      notes: `Admin initiated prepaid refund execution for ₹${refundAmount}${payload.notes ? ` - ${payload.notes}` : ''}`,
    });
    await returnDoc.save();

    returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_REFUND_PENDING', returnDoc }).catch(() => null);

    let refundRecord;
    try {
      refundRecord = await refundService.createRefund({
        refundData: {
          orderId: order._id,
          paymentId: payment._id,
          customerId: returnDoc.customerId,
          vendorId: returnDoc.vendorId,
          vendorOrderId: returnDoc.vendorOrderId || null,
          returnId: returnDoc._id,
          amount: refundAmount,
          currency: order.currency || 'INR',
          reason: returnDoc.reason || 'RETURN_APPROVED',
        },
      });

      const nextStatus = refundRecord.status === 'COMPLETED' ? 'REFUNDED' : 'REFUND_PROCESSING';
      await returnStateService.transitionReturnStatus(returnDoc.status, nextStatus, {
        returnId: returnDoc._id,
        actorType: 'SYSTEM',
        reason: `Refund registered with provider (${refundRecord.providerRefundId || 'processing'})`,
      });
      returnDoc.status = nextStatus;
      if (nextStatus === 'REFUNDED') returnDoc.completedAt = new Date();
      returnDoc.refundDetails = {
        amount: refundAmount,
        refundId: refundRecord._id,
        providerRefundId: refundRecord.providerRefundId || null,
        status: refundRecord.status,
        processedAt: refundRecord.status === 'COMPLETED' ? new Date() : null,
      };
      returnDoc.statusHistory.push({
        status: nextStatus,
        changedAt: new Date(),
        actorType: 'SYSTEM',
        notes: `Refund provider request created: ID ${refundRecord.providerRefundId || refundRecord._id}`,
      });
      await returnDoc.save();

      if (nextStatus === 'REFUNDED') {
        returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_REFUNDED', returnDoc }).catch(() => null);
      } else {
        returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_REFUND_PROCESSING', returnDoc }).catch(() => null);
      }
    } catch (err) {
      console.error(`[ADMIN_REFUND_EXECUTION_ERROR] returnId=${returnDoc._id}:`, err?.message || err);
      try {
        await returnStateService.transitionReturnStatus(returnDoc.status, 'REFUND_FAILED', {
          returnId: returnDoc._id,
          actorType: 'SYSTEM',
          reason: err?.message || 'Payment provider refund failed',
        });
        returnDoc.status = 'REFUND_FAILED';
        if (!returnDoc.refundDetails) returnDoc.refundDetails = {};
        returnDoc.refundDetails.status = 'FAILED';
        returnDoc.refundDetails.failureReason = err?.message || 'Payment provider refund failed';
        returnDoc.statusHistory.push({
          status: 'REFUND_FAILED',
          changedAt: new Date(),
          actorType: 'SYSTEM',
          notes: `Refund execution failed: ${err?.message || 'Provider error'}`,
        });
        await returnDoc.save();
        returnNotificationService.emitAdminReturnException({ eventType: 'RETURN_REFUND_FAILED', returnDoc }).catch(() => null);
      } catch (_) {}
      throw err;
    }

    sendSuccess(res, await buildAdminReturnDto(returnDoc), `Refund initiated successfully: ₹${refundAmount}`, String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminHandleCodPayout = async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Admin role required');
    }

    const payload = adminCodPayoutSchema.parse(req.body ?? {});

    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    const rawOrder = Order.findById(returnDoc.orderId);
    const orderDoc = rawOrder && typeof rawOrder.lean === 'function' ? await rawOrder.lean() : await rawOrder;
    const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc;
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const rawPayment = Payment.findOne({ orderId: order._id });
    const paymentDoc = rawPayment && typeof rawPayment.lean === 'function' ? await rawPayment.lean() : await rawPayment;
    const payment = paymentDoc?.toObject ? paymentDoc.toObject() : paymentDoc;
    const isCod = order.paymentMethod === 'cod' || payment?.provider === 'cod';
    if (!isCod) {
      throw new AppError(400, 'NOT_COD_RETURN', 'This action is only applicable for Cash on Delivery returns');
    }

    const refundAmount = Number(returnDoc.resolution?.calculatedRefundAmount ?? returnDoc.refundDetails?.amount ?? 0);

    if (payload.action === 'INITIATE_PAYOUT') {
      let nextStatus = 'MANUAL_PAYOUT_PROCESSING';
      await returnStateService.transitionReturnStatus(returnDoc.status, nextStatus, {
        returnId: returnDoc._id,
        actorType: 'ADMIN',
        actorId: req.user.sub,
        reason: payload.notes || 'Admin initiated manual COD payout processing',
      });
      returnDoc.status = nextStatus;
      if (!returnDoc.manualPayout) returnDoc.manualPayout = {};
      returnDoc.manualPayout.status = 'PROCESSING';
      returnDoc.manualPayout.notes = payload.notes || returnDoc.manualPayout.notes;
      if (!returnDoc.refundDetails) returnDoc.refundDetails = {};
      returnDoc.refundDetails.status = 'PROCESSING';

      if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
      returnDoc.statusHistory.push({
        status: nextStatus,
        changedAt: new Date(),
        changedBy: req.user.sub,
        actorType: 'ADMIN',
        notes: `Admin marked COD payout processing for ₹${refundAmount}${payload.notes ? ` - ${payload.notes}` : ''}`,
      });
      await returnDoc.save();
    } else if (payload.action === 'COMPLETE_PAYOUT') {
      let nextStatus = 'REFUNDED';
      await returnStateService.transitionReturnStatus(returnDoc.status, nextStatus, {
        returnId: returnDoc._id,
        actorType: 'ADMIN',
        actorId: req.user.sub,
        reason: `Admin recorded manual payout completion (Ref: ${payload.reference})`,
      });
      returnDoc.status = nextStatus;
      returnDoc.completedAt = new Date();
      if (!returnDoc.manualPayout) returnDoc.manualPayout = {};
      returnDoc.manualPayout.status = 'COMPLETED';
      returnDoc.manualPayout.reference = payload.reference;
      returnDoc.manualPayout.paidAt = new Date();
      returnDoc.manualPayout.paidBy = req.user.sub;
      returnDoc.manualPayout.notes = payload.notes || returnDoc.manualPayout.notes;

      if (!returnDoc.refundDetails) returnDoc.refundDetails = {};
      returnDoc.refundDetails.status = 'COMPLETED';
      returnDoc.refundDetails.processedAt = new Date();

      if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
      returnDoc.statusHistory.push({
        status: nextStatus,
        changedAt: new Date(),
        changedBy: req.user.sub,
        actorType: 'ADMIN',
        notes: `Admin completed COD payout of ₹${refundAmount} with reference ${payload.reference}`,
      });
      await returnDoc.save();
      returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_REFUNDED', returnDoc }).catch(() => null);
    } else if (payload.action === 'FAIL_PAYOUT') {
      let nextStatus = 'REFUND_FAILED';
      await returnStateService.transitionReturnStatus(returnDoc.status, nextStatus, {
        returnId: returnDoc._id,
        actorType: 'ADMIN',
        actorId: req.user.sub,
        reason: `Admin marked payout failed: ${payload.failureReason}`,
      });
      returnDoc.status = nextStatus;
      if (!returnDoc.manualPayout) returnDoc.manualPayout = {};
      returnDoc.manualPayout.status = 'FAILED';
      returnDoc.manualPayout.failureReason = payload.failureReason;
      returnDoc.manualPayout.notes = payload.notes || returnDoc.manualPayout.notes;

      if (!returnDoc.refundDetails) returnDoc.refundDetails = {};
      returnDoc.refundDetails.status = 'FAILED';
      returnDoc.refundDetails.failureReason = payload.failureReason;

      if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
      returnDoc.statusHistory.push({
        status: nextStatus,
        changedAt: new Date(),
        changedBy: req.user.sub,
        actorType: 'ADMIN',
        notes: `Admin recorded COD payout failure: ${payload.failureReason}`,
      });
      await returnDoc.save();
      returnNotificationService.emitAdminReturnException({ eventType: 'RETURN_REFUND_FAILED', returnDoc }).catch(() => null);
    }

    sendSuccess(res, await buildAdminReturnDto(returnDoc), `COD payout ${payload.action} completed`, String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const createCustomerReplacement = async (req, res, next) => {
  try {
    const payload = createReplacementSchema.parse(req.body ?? {});
    const returnDoc = await Return.findOne({ _id: req.params.id, customerId: req.user.sub });
    if (!returnDoc) {
      let otherReturn = null;
      try {
        const rawOther = Return.findById(req.params.id);
        otherReturn = rawOther && typeof rawOther.lean === 'function' ? await rawOther.lean() : await rawOther;
      } catch (_) {}
      if (otherReturn) {
        throw new AppError(403, 'FORBIDDEN', 'You do not own this return');
      }
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const replacement = await replacementService.createReplacementOrder({
      returnId: returnDoc._id,
      actorId: req.user.sub,
      actorType: 'CUSTOMER',
      idempotencyKey: payload.idempotencyKey || null,
    });

    sendSuccess(res, replacement, 'Replacement order created successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getCustomerReplacement = async (req, res, next) => {
  try {
    const returnDoc = await Return.findOne({ _id: req.params.id, customerId: req.user.sub });
    if (!returnDoc) {
      let otherReturn = null;
      try {
        const rawOther = Return.findById(req.params.id);
        otherReturn = rawOther && typeof rawOther.lean === 'function' ? await rawOther.lean() : await rawOther;
      } catch (_) {}
      if (otherReturn) {
        throw new AppError(403, 'FORBIDDEN', 'You do not own this return');
      }
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const replacement = await Replacement.findOne({ returnId: returnDoc._id });
    if (!replacement) {
      throw new AppError(404, 'REPLACEMENT_NOT_FOUND', 'Replacement not found for this return');
    }

    let replacementOrder = null;
    if (replacement.replacementOrderId) {
      try {
        const rawOrder = Order.findById(replacement.replacementOrderId);
        replacementOrder = rawOrder && typeof rawOrder.lean === 'function' ? await rawOrder.lean() : await rawOrder;
      } catch (_) {}
    }

    sendSuccess(
      res,
      {
        ...(replacement.toObject ? replacement.toObject() : replacement),
        replacementOrder,
      },
      'Replacement loaded',
      String(req.headers['x-request-id'] ?? ''),
    );
  } catch (error) {
    next(error);
  }
};

export const adminCreateReplacement = async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Only administrators can create replacements');
    }

    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const payload = createReplacementSchema.parse(req.body ?? {});
    const replacement = await replacementService.createReplacementOrder({
      returnId: returnDoc._id,
      actorId: req.user.sub,
      actorType: 'ADMIN',
      idempotencyKey: payload.idempotencyKey || null,
    });

    sendSuccess(res, replacement, 'Replacement order created by admin', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminGetReplacement = async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Only administrators can view replacement');
    }

    const replacement = await Replacement.findOne({ returnId: req.params.id });
    if (!replacement) {
      throw new AppError(404, 'REPLACEMENT_NOT_FOUND', 'Replacement not found for this return');
    }

    let replacementOrder = null;
    let replacementVendorOrder = null;
    let shipment = null;
    if (replacement.replacementOrderId) {
      try {
        const rawOrder = Order.findById(replacement.replacementOrderId);
        replacementOrder = rawOrder && typeof rawOrder.lean === 'function' ? await rawOrder.lean() : await rawOrder;
      } catch (_) {}
    }

    if (replacement.replacementVendorOrderId) {
      try {
        const rawVo = VendorOrder.findById(replacement.replacementVendorOrderId);
        replacementVendorOrder = rawVo && typeof rawVo.lean === 'function' ? await rawVo.lean() : await rawVo;
        if (isQueryable(Shipment)) {
          const rawShipment = Shipment.findOne({ vendorOrderId: replacement.replacementVendorOrderId });
          shipment = rawShipment && typeof rawShipment.lean === 'function' ? await rawShipment.lean() : await rawShipment;
        }
      } catch (_) {}
    }

    sendSuccess(
      res,
      {
        ...(replacement.toObject ? replacement.toObject() : replacement),
        replacementOrder,
        replacementVendorOrder,
        shipment,
      },
      'Admin replacement loaded',
      String(req.headers['x-request-id'] ?? ''),
    );
  } catch (error) {
    next(error);
  }
};

export const vendorGetReplacement = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const returnDoc = await Return.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!returnDoc) {
      let otherReturn = null;
      try {
        const rawOther = Return.findById(req.params.id);
        otherReturn = rawOther && typeof rawOther.lean === 'function' ? await rawOther.lean() : await rawOther;
      } catch (_) {}
      if (otherReturn) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
      }
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const replacement = await Replacement.findOne({ returnId: returnDoc._id, vendorId: vendor._id });
    if (!replacement) {
      throw new AppError(404, 'REPLACEMENT_NOT_FOUND', 'Replacement not found for this return');
    }

    let replacementOrder = null;
    let shipment = null;
    if (replacement.replacementOrderId) {
      try {
        let rawOrder = Order.findById(replacement.replacementOrderId);
        if (rawOrder && typeof rawOrder.select === 'function') {
          rawOrder = rawOrder.select('orderNumber status createdAt items');
        }
        replacementOrder = rawOrder && typeof rawOrder.lean === 'function' ? await rawOrder.lean() : await rawOrder;
      } catch (_) {}
    }

    if (replacement.replacementVendorOrderId && isQueryable(Shipment)) {
      try {
        const rawShipment = Shipment.findOne({ vendorOrderId: replacement.replacementVendorOrderId });
        shipment = rawShipment && typeof rawShipment.lean === 'function' ? await rawShipment.lean() : await rawShipment;
      } catch (_) {}
    }

    sendSuccess(
      res,
      {
        _id: replacement._id,
        replacementNumber: replacement.replacementNumber,
        status: replacement.status,
        quantity: replacement.quantity,
        productSnapshot: replacement.productSnapshot,
        replacementOrderId: replacement.replacementOrderId,
        replacementVendorOrderId: replacement.replacementVendorOrderId,
        replacementOrderNumber: replacementOrder?.orderNumber || null,
        shipment,
        createdAt: replacement.createdAt,
        approvedAt: replacement.approvedAt,
      },
      'Vendor replacement loaded',
      String(req.headers['x-request-id'] ?? ''),
    );
  } catch (error) {
    next(error);
  }
};

export const prepareReturnReverseShipment = async (req, res, next) => {
  try {
    const payload = prepareReverseShipmentSchema.parse(req.body ?? {});
    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: req.params.id,
      packageInfo: payload.packageInfo,
      user: req.user,
      idempotencyKey: payload.idempotencyKey || req.headers['idempotency-key'] || null,
      metadata: payload.metadata || {},
    });

    const role = (req.user?.role || 'CUSTOMER').toUpperCase();
    const dto = returnShipmentService.buildShipmentDto(shipment, role);
    sendSuccess(res, dto, 'Reverse shipment prepared successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getReturnReverseShipment = async (req, res, next) => {
  try {
    const dto = await returnShipmentService.getReturnShipment({
      returnId: req.params.id,
      user: req.user,
    });
    sendSuccess(res, dto, 'Reverse shipment loaded successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const vendorGetReverseShipment = async (req, res, next) => {
  try {
    const dto = await returnShipmentService.getReturnShipment({
      returnId: req.params.id,
      user: { ...req.user, role: 'VENDOR' },
    });
    sendSuccess(res, dto, 'Vendor reverse shipment loaded successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminGetReverseShipment = async (req, res, next) => {
  try {
    const dto = await returnShipmentService.getReturnShipment({
      returnId: req.params.id,
      user: { ...req.user, role: 'ADMIN' },
    });
    sendSuccess(res, dto, 'Admin reverse shipment loaded successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminPrepareReverseShipment = async (req, res, next) => {
  try {
    const payload = prepareReverseShipmentSchema.parse(req.body ?? {});
    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: req.params.id,
      packageInfo: payload.packageInfo,
      user: { ...req.user, role: 'ADMIN' },
      idempotencyKey: payload.idempotencyKey || req.headers['idempotency-key'] || null,
      metadata: payload.metadata || {},
    });

    const dto = returnShipmentService.buildShipmentDto(shipment, 'ADMIN');
    sendSuccess(res, dto, 'Reverse shipment prepared successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminRetryReverseShipment = async (req, res, next) => {
  try {
    const payload = retryReverseShipmentSchema.parse(req.body ?? {});
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    // Validate reverse shipment eligibility (ensures return is in an eligible status like APPROVED)
    await returnShipmentService.validateReverseShipmentEligibility({
      returnDoc,
      user: { ...req.user, role: 'ADMIN' },
    });

    auditService.log('ADMIN_REVERSE_SHIPMENT_RETRY_INITIATED', {
      returnId: returnDoc._id?.toString(),
      returnNumber: returnDoc.returnNumber,
      adminId: req.user?.sub || req.user?._id,
    });

    const result = await returnShipmentService.autoProcessReverseShipment({
      returnId: returnDoc._id,
      returnDoc,
      user: { ...req.user, role: 'ADMIN' },
      packageInfo: payload.packageInfo || null,
      metadata: {
        ...(payload.metadata || {}),
        ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
      },
    });

    const shipmentDto = result.shipment
      ? returnShipmentService.buildShipmentDto(result.shipment, 'ADMIN')
      : null;

    const responseData = {
      returnId: returnDoc._id,
      returnNumber: returnDoc.returnNumber,
      returnStatus: returnDoc.status,
      success: Boolean(result.success),
      stage: result.stage,
      error: result.error || null,
      shipment: shipmentDto,
    };

    sendSuccess(
      res,
      responseData,
      result.success
        ? 'Reverse shipment orchestration processed successfully'
        : `Reverse shipment paused at stage: ${result.stage}`,
      String(req.headers['x-request-id'] ?? '')
    );
  } catch (error) {
    next(error);
  }
};

export const assignReturnAwbController = async (req, res, next) => {
  try {
    const shipment = await returnShipmentService.assignShipmentAwb({
      returnId: req.params.id,
      user: req.user,
      courierId: req.body?.courierId || null,
      mockAwb: req.body?.mockAwb || null,
    });
    const role = (req.user?.role || 'CUSTOMER').toUpperCase();
    const dto = returnShipmentService.buildShipmentDto(shipment, role);
    sendSuccess(res, dto, 'Reverse AWB assigned successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const generateReturnLabelController = async (req, res, next) => {
  try {
    const shipment = await returnShipmentService.generateShipmentLabel({
      returnId: req.params.id,
      user: req.user,
    });
    const role = (req.user?.role || 'CUSTOMER').toUpperCase();
    const dto = returnShipmentService.buildShipmentDto(shipment, role);
    sendSuccess(res, dto, 'Reverse label generated successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const requestReturnPickupController = async (req, res, next) => {
  try {
    const shipment = await returnShipmentService.requestShipmentPickup({
      returnId: req.params.id,
      user: req.user,
      pickupDate: req.body?.pickupDate || null,
    });
    const role = (req.user?.role || 'CUSTOMER').toUpperCase();
    const dto = returnShipmentService.buildShipmentDto(shipment, role);
    sendSuccess(res, dto, 'Reverse pickup requested successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const syncReturnTrackingController = async (req, res, next) => {
  try {
    const shipment = await returnShipmentService.syncReturnTracking({
      returnId: req.params.id,
      user: req.user,
      targetStatus: req.body?.status || req.body?.targetStatus || null,
    });
    const role = (req.user?.role || 'CUSTOMER').toUpperCase();
    const dto = returnShipmentService.buildShipmentDto(shipment, role);
    sendSuccess(res, dto, 'Reverse tracking synchronized successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminAssignReturnAwb = async (req, res, next) => {
  try {
    const shipment = await returnShipmentService.assignShipmentAwb({
      returnId: req.params.id,
      user: { ...req.user, role: 'ADMIN' },
      courierId: req.body?.courierId || null,
      mockAwb: req.body?.mockAwb || null,
    });
    const dto = returnShipmentService.buildShipmentDto(shipment, 'ADMIN');
    sendSuccess(res, dto, 'Admin reverse AWB assigned successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminGenerateReturnLabel = async (req, res, next) => {
  try {
    const shipment = await returnShipmentService.generateShipmentLabel({
      returnId: req.params.id,
      user: { ...req.user, role: 'ADMIN' },
    });
    const dto = returnShipmentService.buildShipmentDto(shipment, 'ADMIN');
    sendSuccess(res, dto, 'Admin reverse label generated successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminRequestReturnPickup = async (req, res, next) => {
  try {
    const shipment = await returnShipmentService.requestShipmentPickup({
      returnId: req.params.id,
      user: { ...req.user, role: 'ADMIN' },
      pickupDate: req.body?.pickupDate || null,
    });
    const dto = returnShipmentService.buildShipmentDto(shipment, 'ADMIN');
    sendSuccess(res, dto, 'Admin reverse pickup requested successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminSyncReturnTracking = async (req, res, next) => {
  try {
    const shipment = await returnShipmentService.syncReturnTracking({
      returnId: req.params.id,
      user: { ...req.user, role: 'ADMIN' },
      targetStatus: req.body?.status || req.body?.targetStatus || null,
    });
    const dto = returnShipmentService.buildShipmentDto(shipment, 'ADMIN');
    sendSuccess(res, dto, 'Admin reverse tracking synchronized successfully', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adminSubmitInspection = sellerSubmitInspection;

const releaseClaimLock = async (returnId) => {
  try {
    if (typeof Return.updateOne === 'function') {
      await Return.updateOne(
        { _id: returnId },
        { $unset: { 'disposition.claimedAt': 1, 'disposition.claimedBy': 1 }, $set: { 'disposition.status': 'PENDING' } }
      );
    }
  } catch (_) {}
};

const handleReturnDisposition = async (req, res, returnDoc, { isAdmin = false, vendorId = null } = {}) => {
  const payload = returnDispositionSchema.parse(req.body ?? {});

  // 1. Idempotency check: if already completed, return immediately without touching inventory or creating ledger entries
  if (returnDoc.disposition?.status === 'COMPLETED') {
    return sendSuccess(
      res,
      isAdmin ? await buildAdminReturnDto(returnDoc) : await buildVendorReturnDto(returnDoc),
      'Return disposition already completed',
      String(req.headers['x-request-id'] ?? '')
    );
  }

  // 2. Status verification
  if (returnDoc.status === 'INSPECTION_FAILED') {
    throw new AppError(400, 'INSPECTION_FAILED_CANNOT_RESTOCK', 'Returns that failed inspection cannot be restocked or disposed');
  }

  const validStatuses = ['INSPECTION_PASSED', 'DISPOSITION_PENDING', 'DISPOSITION_COMPLETED'];
  if (!validStatuses.includes(returnDoc.status)) {
    throw new AppError(400, 'INVALID_RETURN_STATUS', 'Only inspection passed returns can be processed for disposition');
  }

  // 3. Concurrency / Double-restock protection via atomic claim lock
  if (typeof Return.findOneAndUpdate === 'function') {
    const claimed = await Return.findOneAndUpdate(
      {
        _id: returnDoc._id,
        status: { $in: ['INSPECTION_PASSED', 'DISPOSITION_PENDING'] },
        'disposition.status': { $ne: 'COMPLETED' },
        $or: [
          { 'disposition.claimedAt': null },
          { 'disposition.claimedAt': { $exists: false } },
          { 'disposition.claimedAt': { $lt: new Date(Date.now() - 30000) } },
        ],
      },
      {
        $set: {
          'disposition.claimedAt': new Date(),
          'disposition.claimedBy': req.user.sub,
          'disposition.status': 'PROCESSING',
        },
      },
      { new: true }
    );

    if (!claimed && returnDoc.status !== 'DISPOSITION_COMPLETED') {
      const refreshed = await Return.findById(returnDoc._id).lean();
      if (refreshed?.disposition?.status === 'COMPLETED') {
        return sendSuccess(
          res,
          isAdmin ? await buildAdminReturnDto(refreshed) : await buildVendorReturnDto(refreshed),
          'Return disposition already completed',
          String(req.headers['x-request-id'] ?? '')
        );
      }
      throw new AppError(409, 'DISPOSITION_ALREADY_IN_PROGRESS', 'Return disposition is currently being processed by another request');
    }
  }

  auditService.log('RETURN_DISPOSITION_STARTED', {
    returnId: returnDoc._id?.toString(),
    vendorId: returnDoc.vendorId?.toString(),
    actor: req.user.sub,
    role: isAdmin ? 'ADMIN' : 'VENDOR',
    timestamp: new Date(),
  });

  // 4. Fetch ReturnItems
  let dbItems = [];
  try {
    const rawItems = ReturnItem.find({ _id: { $in: returnDoc.items || [] } });
    const fetched = rawItems && typeof rawItems.lean === 'function' ? await rawItems.lean() : await rawItems;
    dbItems = Array.isArray(fetched) ? fetched : [];
  } catch (_) {
    dbItems = [];
  }
  const itemMap = new Map(dbItems.map((i) => [String(i._id), i]));

  // 5. Build planned items and validate item-level quantities
  const plannedItems = [];
  const payloadItems = Array.isArray(payload.items) && payload.items.length > 0 ? payload.items : null;

  if (payloadItems) {
    for (const pItem of payloadItems) {
      const dbItem = itemMap.get(String(pItem.returnItemId));
      if (!dbItem) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(404, 'RETURN_ITEM_NOT_FOUND', 'Return item not found in return');
      }

      const returnedQty = dbItem.quantity || 1;
      let acceptedQty = 0;
      let rejectedQty = 0;

      if (dbItem.inspection && typeof dbItem.inspection.acceptedQuantity === 'number') {
        acceptedQty = dbItem.inspection.acceptedQuantity;
        rejectedQty = dbItem.inspection.rejectedQuantity ?? (returnedQty - acceptedQty);
      } else if (returnDoc.inspection && Array.isArray(returnDoc.inspection.items)) {
        const mi = returnDoc.inspection.items.find((x) => String(x.returnItemId) === String(dbItem._id));
        if (mi) {
          acceptedQty = mi.acceptedQuantity;
          rejectedQty = mi.rejectedQuantity;
        } else {
          acceptedQty = returnDoc.inspection.result === 'PASSED' ? returnedQty : 0;
          rejectedQty = returnedQty - acceptedQty;
        }
      } else {
        acceptedQty = returnDoc.inspection?.result === 'PASSED' ? returnedQty : 0;
        rejectedQty = returnedQty - acceptedQty;
      }

      if (acceptedQty + rejectedQty !== returnedQty) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(400, 'INSPECTION_QUANTITY_MISMATCH', 'Accepted and rejected quantities must equal returned quantity');
      }

      const restockableQty = Number(pItem.restockableQuantity ?? 0);
      const nonRestockableQty = Number(pItem.nonRestockableQuantity ?? 0);

      if (restockableQty < 0 || nonRestockableQty < 0) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(400, 'INVALID_QUANTITY', 'Restock and non-restock quantities must be non-negative');
      }

      if (restockableQty > acceptedQty) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(400, 'INVALID_RESTOCK_QUANTITY', 'Restockable quantity cannot exceed accepted quantity');
      }

      if (nonRestockableQty > acceptedQty) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(400, 'INVALID_RESTOCK_QUANTITY', 'Non-restockable quantity cannot exceed accepted quantity');
      }

      if (restockableQty + nonRestockableQty !== acceptedQty) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(400, 'DISPOSITION_QUANTITY_MISMATCH', 'Sum of restockable and non-restockable quantities must equal accepted quantity');
      }

      const isAuthenticityIssue =
        ['AUTHENTICITY_HOLD', 'SUSPECTED_COUNTERFEIT', 'TAMPERED', 'AUTHENTICITY_MISMATCH'].includes(pItem.disposition) ||
        ['MISMATCH', 'SUSPECTED_COUNTERFEIT', 'TAMPERED'].includes(dbItem.inspection?.authenticityCondition) ||
        ['MISMATCH', 'SUSPECTED_COUNTERFEIT', 'TAMPERED'].includes(returnDoc.inspection?.authenticityCondition);

      if (isAuthenticityIssue && restockableQty > 0) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(400, 'AUTHENTICITY_HOLD_CANNOT_RESTOCK', 'Items with authenticity concerns cannot be restocked');
      }

      if (['DAMAGED', 'DEFECTIVE', 'UNSALEABLE', 'MISSING_PARTS', 'WRONG_ITEM'].includes(pItem.disposition) && restockableQty > 0) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(400, 'NON_RESTOCKABLE_ITEM_CANNOT_RESTOCK', 'Damaged, defective, or unsaleable items cannot be restocked');
      }

      plannedItems.push({
        returnItemId: dbItem._id,
        productId: dbItem.productId,
        variantId: pItem.variantId || dbItem.variantId,
        returnedQuantity: returnedQty,
        acceptedQuantity: acceptedQty,
        rejectedQuantity: rejectedQty,
        restockableQuantity: restockableQty,
        nonRestockableQuantity: nonRestockableQty,
        disposition: pItem.disposition || 'RESTOCKABLE',
        reason: pItem.reason || null,
        notes: pItem.notes || null,
      });
    }
  } else {
    // Default disposition from inspection
    for (const dbItem of dbItems) {
      const returnedQty = dbItem.quantity || 1;
      let acceptedQty = 0;
      let rejectedQty = 0;

      if (dbItem.inspection && typeof dbItem.inspection.acceptedQuantity === 'number') {
        acceptedQty = dbItem.inspection.acceptedQuantity;
        rejectedQty = dbItem.inspection.rejectedQuantity ?? (returnedQty - acceptedQty);
      } else if (returnDoc.inspection && Array.isArray(returnDoc.inspection.items)) {
        const mi = returnDoc.inspection.items.find((x) => String(x.returnItemId) === String(dbItem._id));
        if (mi) {
          acceptedQty = mi.acceptedQuantity;
          rejectedQty = mi.rejectedQuantity;
        } else {
          acceptedQty = returnDoc.inspection.result === 'PASSED' ? returnedQty : 0;
          rejectedQty = returnedQty - acceptedQty;
        }
      } else {
        acceptedQty = returnDoc.inspection?.result === 'PASSED' ? returnedQty : 0;
        rejectedQty = returnedQty - acceptedQty;
      }

      const isAuthenticityIssue =
        ['MISMATCH', 'SUSPECTED_COUNTERFEIT', 'TAMPERED'].includes(dbItem.inspection?.authenticityCondition) ||
        ['MISMATCH', 'SUSPECTED_COUNTERFEIT', 'TAMPERED'].includes(returnDoc.inspection?.authenticityCondition);

      const restockableQty = isAuthenticityIssue ? 0 : acceptedQty;
      const nonRestockableQty = isAuthenticityIssue ? acceptedQty : 0;
      const dispositionCat = isAuthenticityIssue ? 'AUTHENTICITY_HOLD' : (restockableQty > 0 ? 'RESTOCKABLE' : 'UNSALEABLE');

      plannedItems.push({
        returnItemId: dbItem._id,
        productId: dbItem.productId,
        variantId: dbItem.variantId,
        returnedQuantity: returnedQty,
        acceptedQuantity: acceptedQty,
        rejectedQuantity: rejectedQty,
        restockableQuantity: restockableQty,
        nonRestockableQuantity: nonRestockableQty,
        disposition: dispositionCat,
        reason: isAuthenticityIssue ? 'Authenticity concern hold' : (restockableQty > 0 ? 'Passed inspection' : 'Not restockable'),
        notes: null,
      });
    }
  }

  // 6. Pre-flight checks on Products, Variants, Vendor, and Inventory
  for (const plan of plannedItems) {
    if (plan.restockableQuantity > 0) {
      const product = await Product.findOne({ _id: plan.productId, deletedAt: null });
      if (!product) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found for returned item');
      }

      if (String(product.vendorId) !== String(returnDoc.vendorId)) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(403, 'VENDOR_INVENTORY_MISMATCH', 'Product does not belong to authorized vendor');
      }

      const variant = await ProductVariant.findOne({ _id: plan.variantId, productId: product._id });
      if (!variant) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(404, 'VARIANT_NOT_FOUND', 'Product variant not found for returned item');
      }

      const inventory = await Inventory.findOne({ productId: product._id, variantId: variant._id, deletedAt: null });
      if (!inventory) {
        await releaseClaimLock(returnDoc._id);
        throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory record not found for returned item');
      }
    }
  }

  // 7. Atomic restocking with rollback compensation if an error occurs
  const completedRestocks = [];
  try {
    for (const plan of plannedItems) {
      if (plan.restockableQuantity > 0) {
        const result = await inventoryService.restockReturnedItem({
          productId: plan.productId,
          variantId: plan.variantId,
          quantity: plan.restockableQuantity,
          returnId: returnDoc._id,
          returnItemId: plan.returnItemId,
          vendorId: returnDoc.vendorId,
          actorId: req.user.sub,
          reason: plan.reason || 'RETURN_RESTOCK',
        });

        if (!result.skipped) {
          completedRestocks.push({
            inventoryId: result.inventory._id,
            movementId: result.movement?._id,
            quantity: plan.restockableQuantity,
          });

          auditService.log('RETURN_ITEM_RESTOCKED', {
            returnId: returnDoc._id?.toString(),
            returnNumber: returnDoc.returnNumber,
            vendorId: returnDoc.vendorId?.toString(),
            returnItemId: plan.returnItemId?.toString(),
            productId: plan.productId?.toString(),
            variantId: plan.variantId?.toString(),
            quantity: plan.restockableQuantity,
            disposition: plan.disposition,
            actor: req.user.sub,
            role: isAdmin ? 'ADMIN' : 'VENDOR',
            timestamp: new Date(),
          });
        }
      } else {
        auditService.log('RETURN_ITEM_MARKED_NON_RESTOCKABLE', {
          returnId: returnDoc._id?.toString(),
          returnNumber: returnDoc.returnNumber,
          vendorId: returnDoc.vendorId?.toString(),
          returnItemId: plan.returnItemId?.toString(),
          productId: plan.productId?.toString(),
          variantId: plan.variantId?.toString(),
          quantity: plan.nonRestockableQuantity,
          disposition: plan.disposition,
          actor: req.user.sub,
          role: isAdmin ? 'ADMIN' : 'VENDOR',
          timestamp: new Date(),
        });
      }
    }
  } catch (err) {
    for (const cr of completedRestocks) {
      try {
        await Inventory.updateOne({ _id: cr.inventoryId }, { $inc: { availableQuantity: -cr.quantity } });
        if (cr.movementId) await InventoryMovement.deleteOne({ _id: cr.movementId });
      } catch (_) {}
    }
    await releaseClaimLock(returnDoc._id);
    throw err;
  }

  // 8. Update ReturnItem disposition subdocuments
  for (const plan of plannedItems) {
    const itemDoc = await ReturnItem.findById(plan.returnItemId);
    if (itemDoc && typeof itemDoc.save === 'function') {
      itemDoc.disposition = {
        disposedAt: new Date(),
        disposedBy: req.user.sub,
        disposition: plan.disposition,
        returnedQuantity: plan.returnedQuantity,
        acceptedQuantity: plan.acceptedQuantity,
        rejectedQuantity: plan.rejectedQuantity,
        restockableQuantity: plan.restockableQuantity,
        nonRestockableQuantity: plan.nonRestockableQuantity,
        reason: plan.reason || null,
        notes: plan.notes || null,
        restocked: plan.restockableQuantity > 0,
        restockedAt: plan.restockableQuantity > 0 ? new Date() : null,
      };
      await itemDoc.save().catch(() => {});
    }
  }

  // 9. Transition Return status using returnStateService
  await returnStateService.transitionReturnStatus(returnDoc.status, 'DISPOSITION_COMPLETED', {
    returnId: returnDoc._id,
    actorType: isAdmin ? 'ADMIN' : 'VENDOR',
    actorId: req.user.sub,
    reason: 'Return disposition completed',
  });

  returnDoc.status = 'DISPOSITION_COMPLETED';
  returnDoc.disposition = {
    status: 'COMPLETED',
    disposedAt: new Date(),
    disposedBy: req.user.sub,
    claimedAt: null,
    claimedBy: null,
    notes: payload.notes || null,
    totalRestockableQuantity: plannedItems.reduce((acc, i) => acc + i.restockableQuantity, 0),
    totalNonRestockableQuantity: plannedItems.reduce((acc, i) => acc + i.nonRestockableQuantity, 0),
    items: plannedItems.map((p) => ({
      ...p,
      restocked: p.restockableQuantity > 0,
      restockedAt: p.restockableQuantity > 0 ? new Date() : null,
    })),
  };

  if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
  returnDoc.statusHistory.push({
    status: 'DISPOSITION_COMPLETED',
    changedAt: new Date(),
    changedBy: req.user.sub,
    actorType: isAdmin ? 'ADMIN' : 'VENDOR',
    notes: `Disposition completed: restockable=${returnDoc.disposition.totalRestockableQuantity}, nonRestockable=${returnDoc.disposition.totalNonRestockableQuantity}`,
  });

  await returnDoc.save();

  returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_DISPOSITION_COMPLETED', returnDoc }).catch(() => null);
  returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_DISPOSITION_COMPLETED', returnDoc }).catch(() => null);

  auditService.log('RETURN_DISPOSITION_COMPLETED', {
    returnId: returnDoc._id?.toString(),
    returnNumber: returnDoc.returnNumber,
    vendorId: returnDoc.vendorId?.toString(),
    actor: req.user.sub,
    role: isAdmin ? 'ADMIN' : 'VENDOR',
    totalRestockableQuantity: returnDoc.disposition.totalRestockableQuantity,
    totalNonRestockableQuantity: returnDoc.disposition.totalNonRestockableQuantity,
    timestamp: new Date(),
  });

  sendSuccess(
    res,
    isAdmin ? await buildAdminReturnDto(returnDoc) : await buildVendorReturnDto(returnDoc),
    'Return disposition completed successfully',
    String(req.headers['x-request-id'] ?? '')
  );
};

export const sellerSubmitDisposition = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const returnDoc = await Return.findOne({ _id: req.params.id, vendorId: vendor._id });
    if (!returnDoc) {
      const otherReturn = await Return.findById(req.params.id).lean();
      if (otherReturn) throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    await handleReturnDisposition(req, res, returnDoc, { isAdmin: false, vendorId: vendor._id });
  } catch (error) {
    next(error);
  }
};

export const adminSubmitDisposition = async (req, res, next) => {
  try {
    const returnDoc = await Return.findById(req.params.id);
    if (!returnDoc) throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');

    await handleReturnDisposition(req, res, returnDoc, { isAdmin: true, vendorId: returnDoc.vendorId });
  } catch (error) {
    next(error);
  }
};


