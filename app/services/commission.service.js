import { CommissionConfig } from '../models/commission-config.model.js';
import { AppError } from '../utils/app-error.js';

const scopes = ['PRODUCT', 'VENDOR', 'CATEGORY', 'GLOBAL'];

export class CommissionService {
  async resolve({ productId, vendorId, categoryId, at = new Date() }) {
    const base = { active: true, $or: [{ effectiveFrom: null }, { effectiveFrom: { $lte: at } }], $and: [{ $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }] }] };
    const candidates = [
      ['PRODUCT', { productId }],
      ['VENDOR', { vendorId }],
      ['CATEGORY', { categoryId }],
      ['GLOBAL', {}],
    ];
    for (const [scope, target] of candidates) {
      if (scope !== 'GLOBAL' && !Object.values(target)[0]) continue;
      const config = await CommissionConfig.findOne({ ...base, scope, ...target }).sort({ effectiveFrom: -1, createdAt: -1 }).lean();
      if (config) return { rate: Number(config.rate), source: scope, configId: config._id };
    }
    throw new AppError(500, 'COMMISSION_CONFIG_MISSING', 'No active global commission configuration exists');
  }

  validateInput({ scope, rate, productId = null, vendorId = null, categoryId = null }) {
    if (!scopes.includes(scope)) throw new AppError(400, 'INVALID_COMMISSION_SCOPE', 'Invalid commission scope');
    if (!Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > 100) throw new AppError(400, 'INVALID_COMMISSION_RATE', 'Commission rate must be between 0 and 100');
    if (scope === 'PRODUCT' && !productId) throw new AppError(400, 'COMMISSION_TARGET_REQUIRED', 'Product commission target is required');
    if (scope === 'VENDOR' && !vendorId) throw new AppError(400, 'COMMISSION_TARGET_REQUIRED', 'Vendor commission target is required');
    if (scope === 'CATEGORY' && !categoryId) throw new AppError(400, 'COMMISSION_TARGET_REQUIRED', 'Category commission target is required');
  }

  async create(input) {
    this.validateInput(input);
    return CommissionConfig.create(input);
  }
}

export const commissionService = new CommissionService();
