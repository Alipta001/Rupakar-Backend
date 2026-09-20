import { Vendor } from '../models/vendor.model.js';
import { CommissionConfig } from '../models/commission-config.model.js';
import { AppError } from '../utils/app-error.js';
import { commissionService } from '../services/commission.service.js';
import { vendorLedgerService } from '../services/vendor-ledger.service.js';
import { settlementService } from '../services/settlement.service.js';

const approvedVendor = async (userId) => {
  const vendor = await Vendor.findOne({ ownerUserId: userId, deletedAt: null, status: 'APPROVED' }).lean();
  if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Only approved vendors can view financial records');
  return vendor;
};

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

export const listAdminPayouts = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const data = await settlementService.listAdminPayouts({ page, limit, status: req.query.status });
    res.status(200).json({ success: true, data, message: 'Payout records loaded' });
  } catch (error) { next(error); }
};

export const createCommissionConfig = async (req, res, next) => {
  try {
    const payload = { scope: req.body.scope, rate: Number(req.body.rate), productId: req.body.productId || null, vendorId: req.body.vendorId || null, categoryId: req.body.categoryId || null, active: req.body.active !== false, effectiveFrom: req.body.effectiveFrom || null, effectiveTo: req.body.effectiveTo || null };
    const config = await commissionService.create(payload);
    res.status(201).json({ success: true, data: config, message: 'Commission configuration created' });
  } catch (error) { next(error); }
};

export const listCommissionConfigs = async (_req, res, next) => {
  try {
    const configs = await CommissionConfig.find({}).sort({ scope: 1, createdAt: -1 }).lean();
    res.status(200).json({ success: true, data: configs, message: 'Commission configurations loaded' });
  } catch (error) { next(error); }
};
