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
    // A missing rule means no commission, not a failed customer payment. The
    // ledger still records the zero-rate snapshot for later settlement audits.
    return { rate: 0, source: 'DEFAULT', configId: null };
  }

  async batchLoadConfigs({ productIds = [], vendorIds = [], categoryIds = [], at = new Date() }) {
    const base = {
      active: true,
      $or: [{ effectiveFrom: null }, { effectiveFrom: { $lte: at } }],
      $and: [{ $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }] }],
    };
    const targetConditions = [{ scope: 'GLOBAL' }];
    const validProductIds = productIds.filter(Boolean);
    const validVendorIds = vendorIds.filter(Boolean);
    const validCategoryIds = categoryIds.filter(Boolean);

    if (validProductIds.length) targetConditions.push({ scope: 'PRODUCT', productId: { $in: validProductIds } });
    if (validVendorIds.length) targetConditions.push({ scope: 'VENDOR', vendorId: { $in: validVendorIds } });
    if (validCategoryIds.length) targetConditions.push({ scope: 'CATEGORY', categoryId: { $in: validCategoryIds } });

    return CommissionConfig.find({
      ...base,
      $or: targetConditions,
    }).sort({ effectiveFrom: -1, createdAt: -1 }).lean();
  }

  resolveFromBatch({ productId, vendorId, categoryId, configs = [] }) {
    const strProd = productId ? String(productId) : null;
    const strVendor = vendorId ? String(vendorId) : null;
    const strCat = categoryId ? String(categoryId) : null;

    if (strProd) {
      const match = configs.find((c) => c.scope === 'PRODUCT' && String(c.productId) === strProd);
      if (match) return { rate: Number(match.rate), source: 'PRODUCT', configId: match._id };
    }
    if (strVendor) {
      const match = configs.find((c) => c.scope === 'VENDOR' && String(c.vendorId) === strVendor);
      if (match) return { rate: Number(match.rate), source: 'VENDOR', configId: match._id };
    }
    if (strCat) {
      const match = configs.find((c) => c.scope === 'CATEGORY' && String(c.categoryId) === strCat);
      if (match) return { rate: Number(match.rate), source: 'CATEGORY', configId: match._id };
    }
    const globalMatch = configs.find((c) => c.scope === 'GLOBAL');
    if (globalMatch) return { rate: Number(globalMatch.rate), source: 'GLOBAL', configId: globalMatch._id };

    return { rate: 0, source: 'DEFAULT', configId: null };
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
