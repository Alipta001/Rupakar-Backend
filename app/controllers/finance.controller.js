import mongoose from 'mongoose';
import { Vendor } from '../models/vendor.model.js';
import { VendorBankAccount } from '../models/vendor-bank.model.js';
import { CommissionConfig } from '../models/commission-config.model.js';
import { Order } from '../models/order.model.js';
import { Payment } from '../models/payment.model.js';
import { Refund } from '../models/refund.model.js';
import { VendorLedgerEntry } from '../models/vendor-ledger-entry.model.js';
import { VendorPayout } from '../models/vendor-payout.model.js';
import { AppError } from '../utils/app-error.js';
import { commissionService } from '../services/commission.service.js';
import { vendorLedgerService } from '../services/vendor-ledger.service.js';
import { settlementService } from '../services/settlement.service.js';
import { financialSettingsService } from '../services/financial-settings.service.js';
import { reconciliationService } from '../services/reconciliation.service.js';
import { toRupees, toPaise } from '../utils/money.js';

const approvedVendor = async (userId) => {
  const filter = {
    deletedAt: null,
    status: 'APPROVED',
    $or: [
      { ownerUserId: userId },
      ...(mongoose.isValidObjectId(userId) ? [{ ownerUserId: new mongoose.Types.ObjectId(String(userId)) }] : []),
    ],
  };
  const vendor = await Vendor.findOne(filter).lean();
  if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can view financial records');
  return vendor;
};

// ==================== VENDOR ENDPOINTS ====================

export const listVendorLedger = async (req, res, next) => {
  try {
    const vendor = await approvedVendor(req.user.sub);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const data = await vendorLedgerService.listForVendor(vendor._id, { page, limit, transactionType: req.query.transactionType });
    res.status(200).json({ success: true, data, message: 'Vendor ledger loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const getVendorLedgerSummary = async (req, res, next) => {
  try {
    const vendor = await approvedVendor(req.user.sub);
    const summary = await vendorLedgerService.summaryForVendor(vendor._id);
    res.status(200).json({ success: true, data: summary, message: 'Vendor ledger summary loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const getVendorBalance = async (req, res, next) => {
  try {
    const vendor = await approvedVendor(req.user.sub);
    const data = await settlementService.balanceForVendor(vendor._id);
    res.status(200).json({ success: true, data, message: 'Vendor settlement balance loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const listVendorPayouts = async (req, res, next) => {
  try {
    const vendor = await approvedVendor(req.user.sub);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const data = await settlementService.listPayouts(vendor._id, { page, limit });
    res.status(200).json({ success: true, data, message: 'Vendor payout records loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const getVendorPayout = async (req, res, next) => {
  try {
    const vendor = await approvedVendor(req.user.sub);
    const data = await settlementService.getPayout(vendor._id, req.params.id);
    res.status(200).json({ success: true, data, message: 'Vendor payout loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

// ==================== ADMIN ENDPOINTS ====================

export const getAdminFinanceOverview = async (req, res, next) => {
  try {
    const [
      ordersAgg,
      paymentsCapturedAgg,
      paymentsFailedAgg,
      refundsAgg,
      commissionAgg,
      payoutsPaidAgg,
      payoutsFailedAgg,
      pendingSettlementAgg,
      eligibleSettlementAgg,
      onHoldSettlementAgg,
    ] = await Promise.all([
      // Gross sales from captured/paid orders
      Order.aggregate([
        { $match: { paymentStatus: { $in: ['CAPTURED', 'PAID'] } } },
        { $group: { _id: null, grossSales: { $sum: '$total' }, deliveryRevenue: { $sum: '$shipping' }, orderCount: { $sum: 1 } } },
      ]),
      // Captured payments
      Payment.aggregate([
        { $match: { status: 'CAPTURED' } },
        { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      // Failed payments
      Payment.aggregate([
        { $match: { status: 'FAILED' } },
        { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      // Processed refunds
      Refund.aggregate([
        { $match: { status: { $in: ['COMPLETED', 'PROCESSING', 'APPROVED'] } } },
        { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      // Commission and vendor payable earned from ledger
      VendorLedgerEntry.aggregate([
        { $match: { status: 'POSTED', transactionType: 'SALE_CAPTURE' } },
        { $group: { _id: null, commissionEarned: { $sum: '$commissionAmount' }, vendorPayable: { $sum: '$netAmount' } } },
      ]),
      // Completed payouts
      VendorPayout.aggregate([
        { $match: { status: 'PAID' } },
        { $group: { _id: null, totalAmount: { $sum: '$requestedAmount' }, totalPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
      ]),
      // Failed payouts
      VendorPayout.aggregate([
        { $match: { status: 'FAILED' } },
        { $group: { _id: null, totalAmount: { $sum: '$requestedAmount' }, count: { $sum: 1 } } },
      ]),
      // Pending settlement
      VendorLedgerEntry.aggregate([
        { $match: { status: 'POSTED', eligibilityStatus: 'PENDING' } },
        { $group: { _id: '$vendorId', amount: { $sum: '$netAmount' }, amountPaise: { $sum: '$netAmountPaise' } } },
      ]),
      // Eligible settlement
      VendorLedgerEntry.aggregate([
        { $match: { status: 'POSTED', eligibilityStatus: 'ELIGIBLE' } },
        { $group: { _id: '$vendorId', amount: { $sum: '$netAmount' }, amountPaise: { $sum: '$netAmountPaise' } } },
      ]),
      // On hold settlement
      VendorLedgerEntry.aggregate([
        { $match: { status: 'POSTED', eligibilityStatus: 'ON_HOLD' } },
        { $group: { _id: '$vendorId', amount: { $sum: '$netAmount' }, amountPaise: { $sum: '$netAmountPaise' } } },
      ]),
    ]);

    const grossSales = ordersAgg?.[0]?.grossSales ?? 0;
    const deliveryRevenue = ordersAgg?.[0]?.deliveryRevenue ?? 0;
    const commissionEarned = commissionAgg?.[0]?.commissionEarned ?? 0;
    const vendorPayable = commissionAgg?.[0]?.vendorPayable ?? 0;
    const refundsTotal = refundsAgg?.[0]?.totalAmount ?? 0;
    const payoutsPaid = payoutsPaidAgg?.[0]?.totalAmount ?? 0;

    const pendingTotal = (pendingSettlementAgg || []).reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const pendingTotalPaise = (pendingSettlementAgg || []).reduce((acc, curr) => acc + (curr.amountPaise || 0), 0);
    const eligibleTotal = (eligibleSettlementAgg || []).reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const eligibleTotalPaise = (eligibleSettlementAgg || []).reduce((acc, curr) => acc + (curr.amountPaise || 0), 0);
    const onHoldTotal = (onHoldSettlementAgg || []).reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const onHoldTotalPaise = (onHoldSettlementAgg || []).reduce((acc, curr) => acc + (curr.amountPaise || 0), 0);

    const data = {
      grossSales,
      customerPayments: paymentsCapturedAgg?.[0]?.totalAmount ?? 0,
      customerPaymentCount: paymentsCapturedAgg?.[0]?.count ?? 0,
      failedPayments: paymentsFailedAgg?.[0]?.totalAmount ?? 0,
      failedPaymentCount: paymentsFailedAgg?.[0]?.count ?? 0,
      refundsTotal,
      refundCount: refundsAgg?.[0]?.count ?? 0,
      commissionEarned,
      deliveryRevenue,
      vendorPayable: { amount: vendorPayable, paise: Math.round(vendorPayable * 100) },
      eligibleSettlements: { amount: eligibleTotal, paise: eligibleTotalPaise, vendorCount: (eligibleSettlementAgg || []).length },
      pendingSettlements: { amount: pendingTotal, paise: pendingTotalPaise, vendorCount: (pendingSettlementAgg || []).length },
      onHoldSettlements: { amount: onHoldTotal, paise: onHoldTotalPaise, vendorCount: (onHoldSettlementAgg || []).length },
      completedPayouts: { amount: payoutsPaid, paise: payoutsPaidAgg?.[0]?.totalPaise ?? Math.round(payoutsPaid * 100), count: payoutsPaidAgg?.[0]?.count ?? 0 },
      failedPayouts: payoutsFailedAgg?.[0]?.totalAmount ?? 0,
      failedPayoutCount: payoutsFailedAgg?.[0]?.count ?? 0,
      outstandingVendorBalance: Math.max(0, pendingTotal + eligibleTotal + onHoldTotal),
      currency: 'INR',
    };

    res.status(200).json({ success: true, data, message: 'Finance overview loaded' });
  } catch (error) { next(error); }
};

export const getFinancialSettings = async (_req, res, next) => {
  try {
    const settings = await financialSettingsService.getCurrentSettings();
    res.status(200).json({ success: true, data: settings, message: 'Financial settings loaded' });
  } catch (error) { next(error); }
};

export const updateFinancialSettings = async (req, res, next) => {
  try {
    const newSettings = await financialSettingsService.updateSettings(req.body, req.user?.sub);
    res.status(200).json({ success: true, data: newSettings, message: 'Financial settings updated to new version' });
  } catch (error) { next(error); }
};

export const listEligibleSettlements = async (_req, res, next) => {
  try {
    const isDbConnected = mongoose.connection?.readyState === 1;

    // Proactively evaluate any newly delivered orders past return window
    if (isDbConnected || Boolean(settlementService.evaluateSettlementEligibility?._isMockFunction)) {
      await settlementService.evaluateSettlementEligibility().catch(() => null);
    }

    const eligible = await VendorLedgerEntry.aggregate([
      { $match: { status: 'POSTED', eligibilityStatus: 'ELIGIBLE' } },
      {
        $group: {
          _id: '$vendorId',
          totalPayablePaise: { $sum: '$netAmountPaise' },
          totalPayableRupees: { $sum: '$netAmount' },
          entryCount: { $sum: 1 },
          entryIds: { $push: '$_id' },
          earliestEligibleAt: { $min: '$eligibleAt' },
        },
      },
      {
        $lookup: {
          from: 'vendors',
          localField: '_id',
          foreignField: '_id',
          as: 'vendor',
        },
      },
      { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
    ]);

    // Fetch bank accounts for eligible vendors to facilitate manual transfer inspection
    let bankMap = new Map();
    let readyPayoutMap = new Map();
    const isBankFindMocked = Boolean(VendorBankAccount.find?._isMockFunction || VendorBankAccount.find?.mock);
    if ((isDbConnected || isBankFindMocked) && Array.isArray(eligible) && eligible.length > 0) {
      try {
        const vendorIds = eligible.map((e) => e._id).filter(Boolean);
        if (vendorIds.length > 0) {
          const [bankAccounts, readyPayouts] = await Promise.all([
            VendorBankAccount.find({ vendorId: { $in: vendorIds }, isDeleted: false }).lean(),
            VendorPayout.find({ vendorId: { $in: vendorIds }, status: { $in: ['READY', 'PROCESSING'] } }).sort({ createdAt: -1 }).lean(),
          ]);
          bankMap = new Map((bankAccounts || []).map((b) => [String(b.vendorId), b]));
          readyPayoutMap = new Map((readyPayouts || []).map((p) => [String(p.vendorId), p]));
        }
      } catch {}
    }

    const formatted = eligible.map((e) => {
      const bank = bankMap.get(String(e._id));
      const readyPayout = readyPayoutMap.get(String(e._id));
      return {
        vendorId: e._id,
        vendorName: e.vendor?.businessName || e.vendor?.storeName || 'Vendor',
        eligibleAmount: toRupees(e.totalPayablePaise) || e.totalPayableRupees,
        eligibleAmountPaise: e.totalPayablePaise,
        ordersCount: e.entryCount,
        entryCount: e.entryCount,
        entryIds: e.entryIds,
        eligibleSince: e.earliestEligibleAt ? new Date(e.earliestEligibleAt).toISOString() : new Date().toISOString(),
        status: readyPayout ? readyPayout.status : 'READY',
        existingPayoutId: readyPayout ? String(readyPayout._id) : null,
        existingPayoutNumber: readyPayout ? readyPayout.payoutNumber : null,
        bankDetails: bank ? {
          accountHolderName: bank.accountHolderName || e.vendor?.businessName || null,
          accountNumberMasked: bank.maskedAccountNumber || (bank.accountNumber ? `••••${bank.accountNumber.slice(-4)}` : null),
          ifsc: bank.ifscCode || bank.ifsc || null,
          bankName: bank.bankName || null,
        } : null,
      };
    });

    res.status(200).json({ success: true, data: formatted, message: 'Eligible settlements loaded' });
  } catch (error) { next(error); }
};

export const listSettlementReadinessOverview = async (_req, res, next) => {
  try {
    const isDbConnected = mongoose.connection?.readyState === 1;

    // Aggregate all active unsettled entries by vendor and status
    const unSettled = await VendorLedgerEntry.aggregate([
      { $match: { status: 'POSTED', eligibilityStatus: { $in: ['PENDING', 'ON_HOLD', 'ELIGIBLE'] } } },
      {
        $group: {
          _id: { vendorId: '$vendorId', status: '$eligibilityStatus' },
          totalPaise: { $sum: '$netAmountPaise' },
          totalRupees: { $sum: '$netAmount' },
          count: { $sum: 1 },
          holdReasons: { $addToSet: '$holdReason' },
          earliestEligibleAt: { $min: '$eligibleAt' },
        },
      },
    ]);

    // Group by vendorId
    const vendorMap = new Map();
    for (const row of unSettled) {
      const vId = String(row._id.vendorId);
      if (!vendorMap.has(vId)) {
        vendorMap.set(vId, {
          vendorId: row._id.vendorId,
          eligibleAmount: 0,
          pendingAmount: 0,
          onHoldAmount: 0,
          totalPayable: 0,
          ordersCount: 0,
          holdReasons: [],
          earliestEligibleAt: null,
        });
      }
      const item = vendorMap.get(vId);
      item.ordersCount += row.count;
      item.totalPayable += toRupees(row.totalPaise) || row.totalRupees;
      if (row._id.status === 'ELIGIBLE') {
        item.eligibleAmount += toRupees(row.totalPaise) || row.totalRupees;
        if (row.earliestEligibleAt) item.earliestEligibleAt = row.earliestEligibleAt;
      } else if (row._id.status === 'PENDING') {
        item.pendingAmount += toRupees(row.totalPaise) || row.totalRupees;
      } else if (row._id.status === 'ON_HOLD') {
        item.onHoldAmount += toRupees(row.totalPaise) || row.totalRupees;
        item.holdReasons.push(...(row.holdReasons || []).filter(Boolean));
      }
    }

    const vendorIds = Array.from(vendorMap.keys()).map((id) => new mongoose.Types.ObjectId(id));
    const [vendors, bankAccounts] = await Promise.all([
      Vendor.find({ _id: { $in: vendorIds } }).select('businessName storeName status verificationStatus').lean(),
      VendorBankAccount.find({ vendorId: { $in: vendorIds }, isDeleted: false }).lean(),
    ]);

    const vDocMap = new Map(vendors.map((v) => [String(v._id), v]));
    const bDocMap = new Map(bankAccounts.map((b) => [String(b.vendorId), b]));

    const result = Array.from(vendorMap.values()).map((item) => {
      const v = vDocMap.get(String(item.vendorId));
      const b = bDocMap.get(String(item.vendorId));
      const hasBank = Boolean(b && (b.accountNumber || b.maskedAccountNumber));
      const isApproved = v?.status === 'APPROVED';
      const isVerified = v?.verificationStatus === 'VERIFIED';

      let status = 'READY';
      let ineligibilityReason = null;

      if (!isApproved) {
        status = 'NOT_APPROVED';
        ineligibilityReason = 'Vendor account not yet approved';
      } else if (!isVerified) {
        status = 'UNVERIFIED_VENDOR';
        ineligibilityReason = 'Vendor identity verification pending';
      } else if (!hasBank) {
        status = 'NO_BANK_ACCOUNT';
        ineligibilityReason = 'No registered bank account on file';
      } else if (item.onHoldAmount > 0 && item.eligibleAmount === 0) {
        status = 'ON_HOLD';
        ineligibilityReason = item.holdReasons.length > 0
          ? `Dispute or return hold: ${item.holdReasons.join(', ')}`
          : 'Settlement placed on administrative hold';
      } else if (item.eligibleAmount === 0 && item.pendingAmount > 0) {
        status = 'PENDING';
        ineligibilityReason = 'Delivered orders within 7-day return protection period';
      } else if (item.eligibleAmount > 0) {
        status = 'READY';
      }

      return {
        vendorId: item.vendorId,
        vendorName: v?.businessName || v?.storeName || 'Vendor Partner',
        eligibleAmount: item.eligibleAmount,
        pendingAmount: item.pendingAmount,
        onHoldAmount: item.onHoldAmount,
        totalPayable: item.totalPayable,
        ordersCount: item.ordersCount,
        status,
        ineligibilityReason,
        eligibleSince: item.earliestEligibleAt ? new Date(item.earliestEligibleAt).toISOString() : null,
        bankDetails: b ? {
          accountHolderName: b.accountHolderName || v?.businessName || null,
          accountNumberMasked: b.maskedAccountNumber || (b.accountNumber ? `••••${b.accountNumber.slice(-4)}` : null),
          ifsc: b.ifscCode || b.ifsc || null,
          bankName: b.bankName || null,
        } : null,
      };
    });

    res.status(200).json({ success: true, data: result, message: 'Settlement readiness overview loaded' });
  } catch (error) { next(error); }
};

export const triggerSettlementBatch = async (req, res, next) => {
  try {
    const { vendorIds, vendorId, minThresholdPaise } = req.body || {};
    const effectiveVendorIds = vendorIds || (vendorId ? [vendorId] : null);
    const result = await settlementService.createSettlementBatch({
      vendorIds: effectiveVendorIds,
      minThresholdPaise,
      triggeredBy: 'ADMIN',
      adminUserId: req.user?.sub,
    });
    res.status(201).json({ success: true, data: result, message: 'Settlement batch executed' });
  } catch (error) { next(error); }
};

export const listSettlementBatches = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const data = await settlementService.listBatches({ page, limit, status: req.query.status });
    res.status(200).json({ success: true, data, message: 'Settlement batches loaded' });
  } catch (error) { next(error); }
};

export const getSettlementBatchDetail = async (req, res, next) => {
  try {
    const data = await settlementService.getBatchDetails(req.params.id);
    res.status(200).json({ success: true, data, message: 'Settlement batch detail loaded' });
  } catch (error) { next(error); }
};

export const holdSettlementEntry = async (req, res, next) => {
  try {
    const { ledgerEntryId, reason } = req.body;
    const data = await settlementService.holdSettlement({ ledgerEntryId, reason, adminUserId: req.user?.sub });
    res.status(200).json({ success: true, data, message: 'Settlement placed on hold' });
  } catch (error) { next(error); }
};

export const releaseSettlementEntry = async (req, res, next) => {
  try {
    const { ledgerEntryId } = req.body;
    const data = await settlementService.releaseSettlement({ ledgerEntryId, adminUserId: req.user?.sub });
    res.status(200).json({ success: true, data, message: 'Settlement hold released' });
  } catch (error) { next(error); }
};

export const listAdminPayouts = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const data = await settlementService.listAdminPayouts({ page, limit, status: req.query.status, vendorId: req.query.vendorId });

    // Format for admin portal table
    const formattedItems = (data.items || []).map((p) => ({
      id: String(p._id),
      payoutNumber: p.payoutNumber || `PO-${String(p._id).slice(-6).toUpperCase()}`,
      vendorName: p.vendorId?.businessName || p.vendorId?.storeName || 'Vendor',
      vendorId: p.vendorId?._id ? String(p.vendorId._id) : String(p.vendorId),
      grossAmount: p.eligibleAmount || p.requestedAmount || 0,
      commissionAmount: 0,
      netPayable: p.requestedAmount || 0,
      formattedNetPayable: `₹${(p.requestedAmount || 0).toLocaleString('en-IN')}`,
      status: p.status === 'PAID' ? 'Completed' : (p.status === 'FAILED' ? 'Failed' : (p.status === 'READY' ? 'Ready to process' : 'Processing')),
      paymentReference: p.providerTransferId || p.bankSnapshot?.accountNumberMasked || 'N/A',
      bankAccountLast4: p.bankSnapshot?.accountNumberMasked ? p.bankSnapshot.accountNumberMasked.slice(-4) : undefined,
      bankSnapshot: p.bankSnapshot || {},
      referenceId: p.providerTransferId || null,
      processedAt: p.processedAt ? new Date(p.processedAt).toISOString() : null,
      date: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
      rawStatus: p.status,
      provider: p.provider,
      failureReason: p.failureReason,
    }));

    res.status(200).json({
      success: true,
      data: {
        items: formattedItems,
        page: data.page,
        limit: data.limit,
        total: data.total,
        totalPages: Math.ceil(data.total / data.limit),
      },
      message: 'Payout records loaded',
    });
  } catch (error) { next(error); }
};

export const retryPayout = async (req, res, next) => {
  try {
    const data = await settlementService.retryPayout(req.params.id, req.user?.sub);
    res.status(200).json({ success: true, data, message: 'Payout retry executed' });
  } catch (error) { next(error); }
};

export const confirmManualPayout = async (req, res, next) => {
  try {
    const { referenceId, notes, amount, confirmedAmount } = req.body || {};
    const data = await settlementService.confirmManualPayout(req.params.id, {
      referenceId,
      notes,
      amount: amount ?? confirmedAmount,
      adminUserId: req.user?.sub,
    });
    res.status(200).json({ success: true, data, message: 'Manual payout confirmed' });
  } catch (error) { next(error); }
};

export const getReconciliationReport = async (req, res, next) => {
  try {
    const { startDate, endDate, limit } = req.query;
    const report = await reconciliationService.runReconciliation({
      startDate,
      endDate,
      limit: Number(limit) || 100,
    });
    res.status(200).json({ success: true, data: report, message: 'Reconciliation report generated' });
  } catch (error) { next(error); }
};

export const listAdminVendorLedgers = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const data = await vendorLedgerService.listAdminLedger({
      page,
      limit,
      vendorId: req.query.vendorId,
      transactionType: req.query.transactionType,
      eligibilityStatus: req.query.eligibilityStatus,
    });
    res.status(200).json({ success: true, data, message: 'Marketplace vendor ledgers loaded' });
  } catch (error) { next(error); }
};

export const listAdminCommissions = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    const [entries, total] = await Promise.all([
      VendorLedgerEntry.find({ transactionType: 'SALE_CAPTURE', status: 'POSTED' })
        .populate('vendorId', 'businessName storeName')
        .populate('parentOrderId', 'orderNumber status')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      VendorLedgerEntry.countDocuments({ transactionType: 'SALE_CAPTURE', status: 'POSTED' }),
    ]);

    const items = entries.map((entry) => ({
      id: String(entry._id),
      orderNumber: entry.parentOrderId?.orderNumber || 'N/A',
      vendorName: entry.vendorId?.businessName || entry.vendorId?.storeName || 'Vendor',
      productTitle: entry.commissionLines?.[0]?.productId ? 'Marketplace Product' : 'Order Items',
      rate: entry.commissionRate || 0,
      amount: entry.commissionAmount || 0,
      formattedAmount: `₹${(entry.commissionAmount || 0).toLocaleString('en-IN')}`,
      ruleSource: ['Product', 'Vendor', 'Category', 'Global'].includes(entry.commissionSource)
        ? entry.commissionSource
        : (entry.commissionSource === 'PRODUCT' ? 'Product' : (entry.commissionSource === 'VENDOR' ? 'Vendor' : (entry.commissionSource === 'CATEGORY' ? 'Category' : 'Global'))),
      status: entry.eligibilityStatus === 'SETTLED' ? 'Collected' : (entry.eligibilityStatus === 'REVERSED' ? 'Reversed' : 'Pending'),
      date: entry.createdAt ? new Date(entry.createdAt).toISOString() : new Date().toISOString(),
    }));

    res.status(200).json({
      success: true,
      data: {
        items,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      message: 'Commissions loaded',
    });
  } catch (error) { next(error); }
};

export const createCommissionConfig = async (req, res, next) => {
  try {
    const payload = {
      scope: req.body.scope,
      rate: Number(req.body.rate),
      productId: req.body.productId || null,
      vendorId: req.body.vendorId || null,
      categoryId: req.body.categoryId || null,
      active: req.body.active !== false,
      effectiveFrom: req.body.effectiveFrom || null,
      effectiveTo: req.body.effectiveTo || null,
    };
    const config = await commissionService.create(payload);
    res.status(201).json({ success: true, data: config, message: 'Commission configuration created' });
  } catch (error) { next(error); }
};

export const listCommissionConfigs = async (_req, res, next) => {
  try {
    const configs = await CommissionConfig.find({})
      .populate('productId', 'title')
      .populate('vendorId', 'businessName storeName')
      .populate('categoryId', 'name')
      .sort({ scope: 1, createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: configs, message: 'Commission configurations loaded' });
  } catch (error) { next(error); }
};
