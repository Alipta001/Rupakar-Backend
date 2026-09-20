import { Vendor } from '../models/vendor.model.js';
import { VendorBankAccount } from '../models/vendor-bank.model.js';
import { VendorLedgerEntry } from '../models/vendor-ledger-entry.model.js';
import { VendorPayout } from '../models/vendor-payout.model.js';
import { AppError } from '../utils/app-error.js';

const sum = (items, field) => Number(items?.[0]?.[field] || 0);

export class SettlementService {
  async readiness(vendorId) {
    const vendor = await Vendor.findById(vendorId).select('status verificationStatus').lean();
    const bankAccount = await VendorBankAccount.findOne({ vendorId, isDeleted: false }).select('_id').lean();
    const approved = vendor?.status === 'APPROVED';
    const verified = vendor?.verificationStatus === 'VERIFIED';
    const providerConfigured = false;
    return {
      approvedVendor: approved,
      verifiedVendor: verified,
      bankAccountPresent: Boolean(bankAccount),
      providerConfigured,
      payoutRequestsEnabled: false,
      eligible: approved && verified && Boolean(bankAccount) && providerConfigured,
      reason: providerConfigured ? null : 'Razorpay marketplace transfer capability is not configured',
    };
  }

  async balanceForVendor(vendorId) {
    const [ledgerTotal, pending, eligible, paid, reserved] = await Promise.all([
      VendorLedgerEntry.aggregate([{ $match: { vendorId, status: 'POSTED' } }, { $group: { _id: null, amount: { $sum: '$netAmount' } } }]),
      VendorLedgerEntry.aggregate([{ $match: { vendorId, status: 'POSTED', eligibilityStatus: 'PENDING' } }, { $group: { _id: null, amount: { $sum: '$netAmount' } } }]),
      VendorLedgerEntry.aggregate([{ $match: { vendorId, status: 'POSTED', eligibilityStatus: 'ELIGIBLE' } }, { $group: { _id: null, amount: { $sum: '$netAmount' } } }]),
      VendorPayout.aggregate([{ $match: { vendorId, status: 'PAID' } }, { $group: { _id: null, amount: { $sum: { $subtract: ['$requestedAmount', '$reversalAmount'] } } } }]),
      VendorPayout.aggregate([
        { $match: { vendorId, status: { $in: ['REQUESTED', 'PROCESSING'] } } },
        { $group: { _id: null, amount: { $sum: '$requestedAmount' } } },
      ]),
    ]);
    const readiness = await this.readiness(vendorId);
    const eligibleAmount = sum(eligible, 'amount');
    const settledAmount = sum(paid, 'amount');
    const reservedAmount = sum(reserved, 'amount');
    return {
      ledgerNet: sum(ledgerTotal, 'amount'),
      pendingAmount: sum(pending, 'amount'),
      eligibleAmount,
      settledAmount,
      reservedAmount,
      availableAmount: Math.max(0, eligibleAmount - settledAmount - reservedAmount),
      currency: 'INR',
      readiness,
    };
  }

  async listPayouts(vendorId, { page = 1, limit = 20 } = {}) {
    const filter = { vendorId };
    const [items, total] = await Promise.all([
      VendorPayout.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      VendorPayout.countDocuments(filter),
    ]);
    return { items, page, limit, total };
  }

  async getPayout(vendorId, payoutId) {
    const payout = await VendorPayout.findOne({ _id: payoutId, vendorId }).lean();
    if (!payout) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout record not found');
    return payout;
  }

  async listAdminPayouts({ page = 1, limit = 20, status } = {}) {
    const filter = status ? { status } : {};
    const [items, total] = await Promise.all([
      VendorPayout.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      VendorPayout.countDocuments(filter),
    ]);
    return { items, page, limit, total };
  }
}

export const settlementService = new SettlementService();
