import mongoose from 'mongoose';
import { AppError } from '../utils/app-error.js';
import { Refund } from '../models/refund.model.js';
import { Inventory } from '../models/inventory.model.js';
import { Payment } from '../models/payment.model.js';
import { paymentService } from './payment.service.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';

export class RefundService {
  constructor() {
    this.duplicateRefunds = new Map();
  }

  isDuplicateRefund({ orderId, returnId, refundKey }) {
    const key = `${String(orderId ?? '')}:${String(returnId ?? '')}:${String(refundKey ?? '')}`;
    return this.duplicateRefunds.has(key);
  }

  markRefundSeen({ orderId, returnId, refundKey }) {
    const key = `${String(orderId ?? '')}:${String(returnId ?? '')}:${String(refundKey ?? '')}`;
    this.duplicateRefunds.set(key, true);
    return true;
  }

  calculateRefund({ order, returnItems = [] }) {
    if (!order) {
      throw new AppError(400, 'INVALID_REFUND_ORDER', 'Order is required');
    }

    const items = Array.isArray(returnItems) ? returnItems : [];
    if (items.length === 0) {
      throw new AppError(400, 'INVALID_REFUND_ITEMS', 'Refund items are required');
    }

    const total = items.reduce((sum, item) => sum + (Number(item.lineTotal ?? 0) || 0), 0);
    return {
      amount: Number(total || 0),
      currency: order.currency || 'INR',
      reason: 'RETURN_APPROVED',
      refundSnapshot: {
        orderTotal: Number(order.total ?? 0),
        subtotal: Number(order.subtotal ?? 0),
        discount: Number(order.discount ?? 0),
        tax: Number(order.tax ?? 0),
      },
    };
  }

  async createRefund({ refundData }) {
    if (!refundData?.orderId || !refundData?.paymentId || !refundData?.customerId || !refundData?.vendorId) {
      throw new AppError(400, 'INVALID_REFUND_REQUEST', 'Refund payload is incomplete');
    }

    const key = `${refundData.orderId}:${refundData.returnId ?? refundData.cancellationRequestId ?? refundData.vendorOrderId ?? 'none'}:${refundData.amount}`;
    if (this.isDuplicateRefund({ orderId: refundData.orderId, returnId: refundData.returnId || refundData.cancellationRequestId || refundData.vendorOrderId, refundKey: key })) {
      if (mongoose.isValidObjectId(refundData.orderId)) {
        const query = { orderId: refundData.orderId };
        if (mongoose.isValidObjectId(refundData.vendorOrderId)) query.vendorOrderId = refundData.vendorOrderId;
        if (mongoose.isValidObjectId(refundData.returnId)) query.returnId = refundData.returnId;
        if (mongoose.isValidObjectId(refundData.cancellationRequestId)) query.cancellationRequestId = refundData.cancellationRequestId;
        query.status = { $in: ['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED'] };
        const existing = await Refund.findOne(query);
        if (existing) {
          return existing.toObject ? existing.toObject() : existing;
        }
      }
      throw new AppError(409, 'DUPLICATE_REFUND', 'Duplicate refund request');
    }

    if (mongoose.isValidObjectId(refundData.orderId)) {
      const query = { orderId: refundData.orderId };
      if (mongoose.isValidObjectId(refundData.vendorOrderId)) query.vendorOrderId = refundData.vendorOrderId;
      if (mongoose.isValidObjectId(refundData.returnId)) query.returnId = refundData.returnId;
      if (mongoose.isValidObjectId(refundData.cancellationRequestId)) query.cancellationRequestId = refundData.cancellationRequestId;
      query.status = { $in: ['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED'] };
      const existingRefund = await Refund.findOne(query);
      if (existingRefund) {
        this.markRefundSeen({ orderId: refundData.orderId, returnId: refundData.returnId, refundKey: key });
        return existingRefund.toObject ? existingRefund.toObject() : existingRefund;
      }
    }

    const payment = await Payment.findById(refundData.paymentId);
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');

    let providerRefundId = refundData.providerRefundId || null;
    let status = 'REQUESTED';
    if (['razorpay', 'mock'].includes(payment.provider)) {
      if (!payment.providerPaymentId && payment.provider === 'razorpay') {
        throw new AppError(409, 'PAYMENT_NOT_CAPTURED', 'Captured payment is required before refund');
      }
      try {
        const providerRefund = await paymentService.provider.refundPayment({
          providerPaymentId: payment.providerPaymentId,
          amount: Number(refundData.amount || 0),
          notes: { reason: refundData.reason || 'RETURN_APPROVED' },
        });
        providerRefundId = providerRefund?.id ?? providerRefundId;
        status = 'PROCESSING';
      } catch (err) {
        if (err instanceof AppError) throw err;
        console.error(`[REFUND_PROVIDER_ERROR] orderId=${refundData.orderId}:`, err?.message || err);
        const description = err?.error?.description || err?.message || 'Payment provider refund failed';
        throw new AppError(502, 'REFUND_FAILED', `We couldn't complete the refund yet: ${description}. Your order has not been cancelled. Please try again.`);
      }

      payment.status = 'REFUND_PENDING';
      if (typeof payment.save === 'function') {
        await payment.save();
      } else if (mongoose.isValidObjectId(payment._id)) {
        await Payment.findByIdAndUpdate(payment._id, { $set: { status: 'REFUND_PENDING' } });
      }
      const refundStatus = 'REFUND_PENDING';
      const orderToUpdate = mongoose.isValidObjectId(refundData.orderId)
        ? await Order.findById(refundData.orderId)
        : null;
      const orderUpdate = { paymentStatus: refundStatus };
      if ((!orderToUpdate || orderToUpdate.status !== 'CANCELLED') && !refundData.isCancellation) {
        orderUpdate.status = refundStatus;
      }
      await Order.updateOne({ _id: refundData.orderId }, { $set: orderUpdate });
      if (refundData.vendorOrderId) {
        const voToUpdate = mongoose.isValidObjectId(refundData.vendorOrderId)
          ? await VendorOrder.findById(refundData.vendorOrderId)
          : null;
        const voUpdate = {};
        if ((!voToUpdate || voToUpdate.status !== 'CANCELLED') && !refundData.isCancellation) {
          voUpdate.status = refundStatus;
        }
        if (Object.keys(voUpdate).length > 0) {
          await VendorOrder.updateOne({ _id: refundData.vendorOrderId }, { $set: voUpdate });
        }
      } else {
        await VendorOrder.updateMany(
          { parentOrderId: refundData.orderId, status: { $ne: 'CANCELLED' } },
          { $set: { status: refundStatus } }
        );
      }
    }

    const refundNumber = `RF-${Date.now().toString(36).toUpperCase()}`;
    const refund = await Refund.create({
      refundNumber,
      orderId: refundData.orderId,
      vendorOrderId: refundData.vendorOrderId || null,
      paymentId: refundData.paymentId,
      returnId: refundData.returnId || null,
      cancellationRequestId: refundData.cancellationRequestId || null,
      customerId: refundData.customerId,
      vendorId: refundData.vendorId,
      amount: Number(refundData.amount || 0),
      currency: refundData.currency || 'INR',
      reason: refundData.reason || 'RETURN_APPROVED',
      status,
      providerRefundId,
    });

    this.markRefundSeen({ orderId: refundData.orderId, returnId: refundData.returnId, refundKey: key });
    return refund.toObject ? refund.toObject() : refund;
  }

  async applyRestock({ variantId, quantity, inspectedStatus }) {
    if (!variantId || !quantity || quantity <= 0) {
      throw new AppError(400, 'INVALID_RESTOCK', 'Variant and quantity are required');
    }

    if (inspectedStatus !== 'APPROVED_FOR_REFUND') {
      return { restocked: false, quantity: 0, reason: 'INSPECTION_NOT_APPROVED' };
    }

    const updated = await Inventory.findOneAndUpdate(
      { variantId, deletedAt: null },
      { $inc: { availableQuantity: Number(quantity) } },
      { new: true },
    );

    if (!updated) {
      throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found for restock');
    }

    return { restocked: true, quantity: Number(quantity), inventory: updated.toObject ? updated.toObject() : updated };
  }
}

export const refundService = new RefundService();
