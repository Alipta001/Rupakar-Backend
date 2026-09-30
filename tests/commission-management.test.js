import mongoose from 'mongoose';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { commissionService } from '../app/services/commission.service.js';
import { CommissionConfig } from '../app/models/commission-config.model.js';
import { AppError } from '../app/utils/app-error.js';

const id = () => new mongoose.Types.ObjectId();

afterEach(() => {
  jest.restoreAllMocks();
});

describe('COMMISSION CONFIGURATION & PRICE-SLAB RESOLUTION TESTS', () => {
  it('validates commission input correctly: rejects invalid scopes, rates, and price ranges', () => {
    // Invalid scope
    expect(() => commissionService.validateInput({ scope: 'INVALID', rate: 10 })).toThrow('Invalid commission scope');

    // Invalid commission type
    expect(() => commissionService.validateInput({ scope: 'GLOBAL', commissionType: 'UNKNOWN' })).toThrow('Commission type must be PERCENTAGE or FIXED');

    // Invalid percentage rate
    expect(() => commissionService.validateInput({ scope: 'GLOBAL', rate: -5 })).toThrow('Commission rate must be between 0 and 100');
    expect(() => commissionService.validateInput({ scope: 'GLOBAL', rate: 105 })).toThrow('Commission rate must be between 0 and 100');

    // Invalid fixed amount
    expect(() => commissionService.validateInput({ scope: 'GLOBAL', commissionType: 'FIXED', fixedAmount: -10 })).toThrow('Fixed commission amount must be 0 or greater');

    // Invalid price range
    expect(() => commissionService.validateInput({ scope: 'GLOBAL', rate: 10, minPrice: -10 })).toThrow('Minimum price must be greater than or equal to 0');
    expect(() => commissionService.validateInput({ scope: 'GLOBAL', rate: 10, minPrice: 1000, maxPrice: 500 })).toThrow('Maximum price must be greater than minimum price');

    // Missing targets
    expect(() => commissionService.validateInput({ scope: 'PRODUCT', rate: 10 })).toThrow('Product commission target is required');
    expect(() => commissionService.validateInput({ scope: 'VENDOR', rate: 10 })).toThrow('Vendor commission target is required');
    expect(() => commissionService.validateInput({ scope: 'CATEGORY', rate: 10 })).toThrow('Category commission target is required');
  });

  it('resolves price-bracket commission rules respecting hierarchy and price slabs', () => {
    const prodId = id();
    const vendId = id();
    const catId = id();

    const configs = [
      // Global fallback: 10%
      { _id: id(), scope: 'GLOBAL', rate: 10, minPrice: 0, maxPrice: null, commissionType: 'PERCENTAGE' },
      // Global luxury tier (> ₹5,000): 12%
      { _id: id(), scope: 'GLOBAL', rate: 12, minPrice: 5000, maxPrice: null, commissionType: 'PERCENTAGE' },
      // Category brass craft: 15%
      { _id: id(), scope: 'CATEGORY', categoryId: catId, rate: 15, minPrice: 0, maxPrice: null, commissionType: 'PERCENTAGE' },
      // Category brass craft premium slab (₹2,000 - ₹5,000): 18%
      { _id: id(), scope: 'CATEGORY', categoryId: catId, rate: 18, minPrice: 2000, maxPrice: 5000, commissionType: 'PERCENTAGE' },
      // Vendor special fixed fee: ₹150 for price <= ₹1,000
      { _id: id(), scope: 'VENDOR', vendorId: vendId, rate: 0, minPrice: 0, maxPrice: 1000, commissionType: 'FIXED', fixedAmount: 150, fixedAmountPaise: 15000 },
      // Specific product promo: 5% flat
      { _id: id(), scope: 'PRODUCT', productId: prodId, rate: 5, minPrice: 0, maxPrice: null, commissionType: 'PERCENTAGE' },
    ];

    // 1. PRODUCT scope has highest priority (5% regardless of other matches)
    expect(commissionService.resolveFromBatch({
      productId: prodId,
      vendorId: vendId,
      categoryId: catId,
      price: 3000,
      configs,
    })).toMatchObject({
      rate: 5,
      source: 'PRODUCT',
    });

    // 2. VENDOR scope matches for price ₹800 (within 0 - 1000)
    expect(commissionService.resolveFromBatch({
      productId: id(),
      vendorId: vendId,
      categoryId: catId,
      price: 800,
      configs,
    })).toMatchObject({
      commissionType: 'FIXED',
      fixedAmount: 150,
      fixedAmountPaise: 15000,
      source: 'VENDOR',
    });

    // 3. VENDOR price ₹1,500 exceeds vendor slab (max 1000) -> falls back to CATEGORY premium slab (18%)
    expect(commissionService.resolveFromBatch({
      productId: id(),
      vendorId: vendId,
      categoryId: catId,
      price: 2500,
      configs,
    })).toMatchObject({
      rate: 18,
      source: 'CATEGORY',
    });

    // 4. CATEGORY price ₹6,000 exceeds premium slab -> falls back to CATEGORY general slab (15%)
    expect(commissionService.resolveFromBatch({
      productId: id(),
      vendorId: id(),
      categoryId: catId,
      price: 6000,
      configs,
    })).toMatchObject({
      rate: 15,
      source: 'CATEGORY',
    });

    // 5. GLOBAL price ₹6,000 matches global luxury tier (12%)
    expect(commissionService.resolveFromBatch({
      productId: id(),
      vendorId: id(),
      categoryId: id(),
      price: 6000,
      configs,
    })).toMatchObject({
      rate: 12,
      source: 'GLOBAL',
    });

    // 6. GLOBAL price ₹500 matches general global tier (10%)
    expect(commissionService.resolveFromBatch({
      productId: id(),
      vendorId: id(),
      categoryId: id(),
      price: 500,
      configs,
    })).toMatchObject({
      rate: 10,
      source: 'GLOBAL',
    });

    // 7. No matching rules -> DEFAULT 0%
    expect(commissionService.resolveFromBatch({
      productId: id(),
      vendorId: id(),
      categoryId: id(),
      price: 500,
      configs: [],
    })).toMatchObject({
      rate: 0,
      source: 'DEFAULT',
    });
  });

  it('supports toggleStatus and update on CommissionConfig', async () => {
    const configId = id();
    const mockDoc = {
      _id: configId,
      scope: 'GLOBAL',
      rate: 10,
      active: true,
      save: jest.fn().mockImplementation(function () { return Promise.resolve(this); }),
    };

    jest.spyOn(CommissionConfig, 'findById').mockResolvedValue(mockDoc);

    const toggled = await commissionService.toggleStatus(configId);
    expect(toggled.active).toBe(false);
    expect(mockDoc.save).toHaveBeenCalled();

    const updated = await commissionService.update(configId, { rate: 14 });
    expect(updated.rate).toBe(14);
  });
});
