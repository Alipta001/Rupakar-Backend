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

    const key = `${refundData.orderId}:${refundData.returnId ?? refundData.cancellationRequestId ?? 'none'}:${refundData.amount}`;
    if (this.isDuplicateRefund({ orderId: refundData.orderId, returnId: refundData.returnId || refundData.cancellationRequestId, refundKey: key })) {
      throw new AppError(409, 'DUPLICATE_REFUND', 'Duplicate refund request');
    }

    const payment = await Payment.findById(refundData.paymentId);
    if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');

    let providerRefundId = refundData.providerRefundId || null;
    let status = 'REQUESTED';
    if (payment.provider === 'razorpay') {
      if (!payment.providerPaymentId) {
        throw new AppError(409, 'PAYMENT_NOT_CAPTURED', 'Captured payment is required before refund');
      }
      const providerRefund = await paymentService.provider.refundPayment({
        providerPaymentId: payment.providerPaymentId,
        amount: Number(refundData.amount || 0),
        notes: { reason: refundData.reason || 'RETURN_APPROVED' },
      });
      providerRefundId = providerRefund?.id ?? providerRefundId;
      status = 'PROCESSING';
      payment.status = 'REFUND_PENDING';
      await payment.save();
      const refundStatus = Number(refundData.amount || 0) >= Number(payment.amount || 0)
        ? 'REFUND_PENDING'
        : 'REFUND_PENDING';
      await Order.updateOne({ _id: refundData.orderId }, { $set: { status: refundStatus, paymentStatus: refundStatus } });
      if (refundData.vendorOrderId) {
        await VendorOrder.updateOne({ _id: refundData.vendorOrderId }, { $set: { status: refundStatus } });
      } else {
        await VendorOrder.updateMany({ parentOrderId: refundData.orderId }, { $set: { status: refundStatus } });
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
