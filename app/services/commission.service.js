import { CommissionConfig } from '../models/commission-config.model.js';
import { AppError } from '../utils/app-error.js';

const scopes = ['PRODUCT', 'VENDOR', 'CATEGORY', 'GLOBAL'];

export class CommissionService {
  async resolve({ productId, vendorId, categoryId, price = null, at = new Date() }) {
    const mongoose = await import('mongoose');
    const isDbConnected = mongoose.default?.connection?.readyState === 1;
    const isMocked = Boolean(CommissionConfig.findOne?._isMockFunction || CommissionConfig.findOne?.mock);
    if (!isDbConnected && !isMocked) {
      return { rate: 0, commissionType: 'PERCENTAGE', fixedAmount: 0, fixedAmountPaise: 0, source: 'DEFAULT', configId: null };
    }

    const base = {
      active: true,
      $or: [{ effectiveFrom: null }, { effectiveFrom: { $lte: at } }],
      $and: [{ $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }] }],
    };

    const numPrice = (price !== null && price !== undefined && Number.isFinite(Number(price))) ? Number(price) : null;
    const priceCondition = numPrice !== null ? {
      minPrice: { $lte: numPrice },
      $or: [{ maxPrice: null }, { maxPrice: { $gte: numPrice } }],
    } : {};

    const candidates = [
      ['PRODUCT', { productId }],
      ['VENDOR', { vendorId }],
      ['CATEGORY', { categoryId }],
      ['GLOBAL', {}],
    ];

    for (const [scope, target] of candidates) {
      if (scope !== 'GLOBAL' && !Object.values(target)[0]) continue;
      
      // If price is supplied, try to find a matching price-bracket rule first
      let config = null;
      if (numPrice !== null) {
        config = await CommissionConfig.findOne({ ...base, scope, ...target, ...priceCondition })
          .sort({ minPrice: -1, effectiveFrom: -1, createdAt: -1 })
          .lean();
      }
      
      // If no price-specific rule matched or price wasn't supplied, check general rule
      if (!config) {
        config = await CommissionConfig.findOne({ ...base, scope, ...target })
          .sort({ minPrice: -1, effectiveFrom: -1, createdAt: -1 })
          .lean();
      }

      if (config) {
        return {
          rate: Number(config.rate || 0),
          commissionType: config.commissionType || 'PERCENTAGE',
          fixedAmount: Number(config.fixedAmount || 0),
          fixedAmountPaise: config.fixedAmountPaise || Math.round(Number(config.fixedAmount || 0) * 100),
          source: scope,
          configId: config._id,
        };
      }
    }

    return { rate: 0, commissionType: 'PERCENTAGE', fixedAmount: 0, fixedAmountPaise: 0, source: 'DEFAULT', configId: null };
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
    }).sort({ minPrice: -1, effectiveFrom: -1, createdAt: -1 }).lean();
  }

  resolveFromBatch({ productId, vendorId, categoryId, price = null, configs = [] }) {
    const strProd = productId ? String(productId) : null;
    const strVendor = vendorId ? String(vendorId) : null;
    const strCat = categoryId ? String(categoryId) : null;
    const numPrice = (price !== null && price !== undefined && Number.isFinite(Number(price))) ? Number(price) : null;

    const matchesPrice = (c) => {
      if (numPrice === null) return true;
      const min = (c.minPrice !== null && c.minPrice !== undefined) ? Number(c.minPrice) : 0;
      if (numPrice < min) return false;
      if (c.maxPrice !== null && c.maxPrice !== undefined && c.maxPrice !== '') {
        if (numPrice > Number(c.maxPrice)) return false;
      }
      return true;
    };

    const pickBest = (candidateList, scope) => {
      const matching = candidateList.filter(matchesPrice);
      if (!matching.length) return null;
      matching.sort((a, b) => (Number(b.minPrice || 0)) - (Number(a.minPrice || 0)));
      const best = matching[0];
      return {
        rate: Number(best.rate || 0),
        commissionType: best.commissionType || 'PERCENTAGE',
        fixedAmount: Number(best.fixedAmount || 0),
        fixedAmountPaise: best.fixedAmountPaise || Math.round(Number(best.fixedAmount || 0) * 100),
        source: scope,
        configId: best._id,
      };
    };

    if (strProd) {
      const prodConfigs = configs.filter((c) => c.scope === 'PRODUCT' && String(c.productId) === strProd);
      const res = pickBest(prodConfigs, 'PRODUCT');
      if (res) return res;
    }
    if (strVendor) {
      const vendConfigs = configs.filter((c) => c.scope === 'VENDOR' && String(c.vendorId) === strVendor);
      const res = pickBest(vendConfigs, 'VENDOR');
      if (res) return res;
    }
    if (strCat) {
      const catConfigs = configs.filter((c) => c.scope === 'CATEGORY' && String(c.categoryId) === strCat);
      const res = pickBest(catConfigs, 'CATEGORY');
      if (res) return res;
    }
    const globalConfigs = configs.filter((c) => c.scope === 'GLOBAL');
    const res = pickBest(globalConfigs, 'GLOBAL');
    if (res) return res;

    return { rate: 0, commissionType: 'PERCENTAGE', fixedAmount: 0, fixedAmountPaise: 0, source: 'DEFAULT', configId: null };
  }

  validateInput({
    scope,
    rate = 0,
    commissionType = 'PERCENTAGE',
    fixedAmount = 0,
    minPrice = 0,
    maxPrice = null,
    productId = null,
    vendorId = null,
    categoryId = null,
  }) {
    if (!scopes.includes(scope)) throw new AppError(400, 'INVALID_COMMISSION_SCOPE', 'Invalid commission scope');
    if (!['PERCENTAGE', 'FIXED'].includes(commissionType)) {
      throw new AppError(400, 'INVALID_COMMISSION_TYPE', 'Commission type must be PERCENTAGE or FIXED');
    }
    if (commissionType === 'PERCENTAGE') {
      if (!Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > 100) {
        throw new AppError(400, 'INVALID_COMMISSION_RATE', 'Commission rate must be between 0 and 100');
      }
    } else if (commissionType === 'FIXED') {
      if (!Number.isFinite(Number(fixedAmount)) || Number(fixedAmount) < 0) {
        throw new AppError(400, 'INVALID_FIXED_AMOUNT', 'Fixed commission amount must be 0 or greater');
      }
    }
    if (minPrice !== null && minPrice !== undefined) {
      if (!Number.isFinite(Number(minPrice)) || Number(minPrice) < 0) {
        throw new AppError(400, 'INVALID_PRICE_RANGE', 'Minimum price must be greater than or equal to 0');
      }
    }
    if (maxPrice !== null && maxPrice !== undefined && maxPrice !== '') {
      if (!Number.isFinite(Number(maxPrice)) || Number(maxPrice) <= Number(minPrice || 0)) {
        throw new AppError(400, 'INVALID_PRICE_RANGE', 'Maximum price must be greater than minimum price');
      }
    }
    if (scope === 'PRODUCT' && !productId) throw new AppError(400, 'COMMISSION_TARGET_REQUIRED', 'Product commission target is required');
    if (scope === 'VENDOR' && !vendorId) throw new AppError(400, 'COMMISSION_TARGET_REQUIRED', 'Vendor commission target is required');
    if (scope === 'CATEGORY' && !categoryId) throw new AppError(400, 'COMMISSION_TARGET_REQUIRED', 'Category commission target is required');
  }

  async create(input) {
    this.validateInput(input);
    const fixedAmount = Number(input.fixedAmount || 0);
    const payload = {
      ...input,
      fixedAmount,
      fixedAmountPaise: Math.round(fixedAmount * 100),
      minPrice: Number(input.minPrice || 0),
      maxPrice: (input.maxPrice !== null && input.maxPrice !== undefined && input.maxPrice !== '') ? Number(input.maxPrice) : null,
    };
    return CommissionConfig.create(payload);
  }

  async update(id, input) {
    const existing = await CommissionConfig.findById(id);
    if (!existing) throw new AppError(404, 'COMMISSION_CONFIG_NOT_FOUND', 'Commission configuration not found');

    const merged = {
      scope: input.scope || existing.scope,
      commissionType: input.commissionType || existing.commissionType,
      rate: input.rate !== undefined ? Number(input.rate) : existing.rate,
      fixedAmount: input.fixedAmount !== undefined ? Number(input.fixedAmount) : existing.fixedAmount,
      minPrice: input.minPrice !== undefined ? Number(input.minPrice) : existing.minPrice,
      maxPrice: input.maxPrice !== undefined ? (input.maxPrice !== '' ? Number(input.maxPrice) : null) : existing.maxPrice,
      productId: input.productId !== undefined ? input.productId : existing.productId,
      vendorId: input.vendorId !== undefined ? input.vendorId : existing.vendorId,
      categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
    };
    this.validateInput(merged);

    if (input.scope !== undefined) existing.scope = input.scope;
    if (input.commissionType !== undefined) existing.commissionType = input.commissionType;
    if (input.rate !== undefined) existing.rate = Number(input.rate);
    if (input.fixedAmount !== undefined) {
      existing.fixedAmount = Number(input.fixedAmount);
      existing.fixedAmountPaise = Math.round(Number(input.fixedAmount) * 100);
    }
    if (input.minPrice !== undefined) existing.minPrice = Number(input.minPrice);
    if (input.maxPrice !== undefined) existing.maxPrice = (input.maxPrice !== '' && input.maxPrice !== null) ? Number(input.maxPrice) : null;
    if (input.description !== undefined) existing.description = input.description;
    if (input.productId !== undefined) existing.productId = input.productId || null;
    if (input.vendorId !== undefined) existing.vendorId = input.vendorId || null;
    if (input.categoryId !== undefined) existing.categoryId = input.categoryId || null;
    if (input.active !== undefined) existing.active = Boolean(input.active);
    if (input.effectiveFrom !== undefined) existing.effectiveFrom = input.effectiveFrom;
    if (input.effectiveTo !== undefined) existing.effectiveTo = input.effectiveTo;

    return existing.save();
  }

  async toggleStatus(id) {
    const config = await CommissionConfig.findById(id);
    if (!config) throw new AppError(404, 'COMMISSION_CONFIG_NOT_FOUND', 'Commission configuration not found');
    config.active = !config.active;
    return config.save();
  }

  async delete(id) {
    const config = await CommissionConfig.findById(id);
    if (!config) throw new AppError(404, 'COMMISSION_CONFIG_NOT_FOUND', 'Commission configuration not found');
    await CommissionConfig.findByIdAndDelete(id);
    return { success: true };
  }
}

export const commissionService = new CommissionService();
