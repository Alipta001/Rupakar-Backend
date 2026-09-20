import mongoose from 'mongoose';
import { VendorLedgerEntry } from '../models/vendor-ledger-entry.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Payment } from '../models/payment.model.js';
import { Product } from '../models/product.model.js';
import { commissionService } from './commission.service.js';

const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export class VendorLedgerService {
  async recordCapturedPayment({ orderId, paymentId, payment: capturedPayment = null }) {
    if (!mongoose.isValidObjectId(orderId) || !mongoose.isValidObjectId(paymentId)) return { created: 0, skipped: true };
    const paymentQuery = capturedPayment ? capturedPayment : Payment.findById(paymentId);
    const paymentDoc = paymentQuery && typeof paymentQuery.lean === 'function' ? await paymentQuery.lean() : await paymentQuery;
    const payment = paymentDoc?.toObject ? paymentDoc.toObject() : paymentDoc;
    if (!payment || payment.status !== 'CAPTURED') return { created: 0, skipped: true };
    const vendorOrders = await VendorOrder.find({ parentOrderId: orderId, deletedAt: null }).lean();
    let created = 0;
    for (const vendorOrder of vendorOrders) {
      const existing = await VendorLedgerEntry.findOne({ vendorOrderId: vendorOrder._id, transactionType: 'SALE_CAPTURE' }).lean();
      if (existing) continue;
      const lines = [];
      for (const item of vendorOrder.items || []) {
        const product = await Product.findById(item.productId).select('categoryId').lean();
        const resolved = await commissionService.resolve({ productId: item.productId, vendorId: vendorOrder.vendorId, categoryId: product?.categoryId });
        const grossAmount = round(item.lineTotal);
        lines.push({ productId: item.productId, categoryId: product?.categoryId || null, grossAmount, rate: resolved.rate, commissionAmount: round(grossAmount * resolved.rate / 100), source: resolved.source });
      }
      const grossAmount = round(lines.reduce((sum, line) => sum + line.grossAmount, 0));
      const commissionAmount = round(lines.reduce((sum, line) => sum + line.commissionAmount, 0));
      const commissionRate = grossAmount ? round(commissionAmount / grossAmount * 100) : 0;
      const commissionSource = new Set(lines.map((line) => line.source)).size === 1 ? lines[0]?.source || 'GLOBAL' : 'MIXED';
      try {
        await VendorLedgerEntry.create({
          parentOrderId: vendorOrder.parentOrderId,
          vendorOrderId: vendorOrder._id,
          vendorId: vendorOrder.vendorId,
          paymentId,
          idempotencyKey: `sale_capture:${String(vendorOrder._id)}`,
          transactionType: 'SALE_CAPTURE',
          status: 'POSTED',
          grossAmount,
          commissionRate,
          commissionAmount,
          commissionSource,
          commissionLines: lines,
          paymentFee: 0,
          adjustmentAmount: 0,
          netAmount: round(grossAmount - commissionAmount),
          currency: vendorOrder.currency || payment.currency || 'INR',
          metadata: { capturedAt: payment.paidAt || new Date(), commissionSnapshotAt: new Date() },
        });
        created += 1;
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }
    return { created, skipped: false };
  }

  async recordRefundAdjustment({ refundId, parentOrderId, vendorOrderId, vendorId, paymentId, amount, currency = 'INR' }) {
    const adjustment = round(-Math.abs(Number(amount)));
    if (!mongoose.isValidObjectId(refundId) || !mongoose.isValidObjectId(vendorOrderId)) return { created: false, skipped: true };
    try {
      await VendorLedgerEntry.create({
        parentOrderId,
        vendorOrderId,
        vendorId,
        paymentId,
        idempotencyKey: `refund_adjustment:${String(refundId)}`,
        transactionType: 'REFUND_ADJUSTMENT',
        status: 'POSTED',
        grossAmount: 0,
        commissionRate: 0,
        commissionAmount: 0,
        commissionSource: 'REFUND',
        paymentFee: 0,
        adjustmentAmount: adjustment,
        netAmount: adjustment,
        currency,
        metadata: { refundId },
      });
      return { created: true, skipped: false };
    } catch (error) {
      if (error?.code === 11000) return { created: false, skipped: true };
      throw error;
    }
  }

  async listForVendor(vendorId, { page = 1, limit = 20, transactionType } = {}) {
    const filter = { vendorId };
    if (transactionType) filter.transactionType = transactionType;
    const [items, total] = await Promise.all([
      VendorLedgerEntry.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      VendorLedgerEntry.countDocuments(filter),
    ]);
    return { items, page, limit, total };
  }

  async summaryForVendor(vendorId) {
    const [summary] = await VendorLedgerEntry.aggregate([
      { $match: { vendorId } },
      { $group: { _id: null, grossAmount: { $sum: '$grossAmount' }, commissionAmount: { $sum: '$commissionAmount' }, paymentFee: { $sum: '$paymentFee' }, adjustmentAmount: { $sum: '$adjustmentAmount' }, netAmount: { $sum: '$netAmount' }, count: { $sum: 1 } } },
    ]);
    return summary || { grossAmount: 0, commissionAmount: 0, paymentFee: 0, adjustmentAmount: 0, netAmount: 0, count: 0 };
  }
}

export const vendorLedgerService = new VendorLedgerService();
