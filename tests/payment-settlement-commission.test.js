import mongoose from 'mongoose';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { toPaise, toRupees, calcPercentagePaise, allocateProportionallyPaise } from '../app/utils/money.js';
import { financialSettingsService } from '../app/services/financial-settings.service.js';
import { commissionService } from '../app/services/commission.service.js';
import { vendorLedgerService } from '../app/services/vendor-ledger.service.js';
import { settlementService } from '../app/services/settlement.service.js';
import { reconciliationService } from '../app/services/reconciliation.service.js';
import { razorpayRouteProvider } from '../app/services/settlement-providers/razorpay-route.provider.js';
import { FinancialSettings } from '../app/models/financial-settings.model.js';
import { VendorLedgerEntry } from '../app/models/vendor-ledger-entry.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Order } from '../app/models/order.model.js';
import { Payment } from '../app/models/payment.model.js';
import { VendorPayout } from '../app/models/vendor-payout.model.js';
import { SettlementBatch } from '../app/models/settlement-batch.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorBankAccount } from '../app/models/vendor-bank.model.js';
import { Refund } from '../app/models/refund.model.js';

const id = () => new mongoose.Types.ObjectId();
const chain = (value) => ({
  sort: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('1. Monetary Math & Proportional Allocation (Integer Paise)', () => {
  it('converts correctly between Rupees and Paise without floating-point drift', () => {
    expect(toPaise(1299.99)).toBe(129999);
    expect(toPaise('49.50')).toBe(4950);
    expect(toPaise(0)).toBe(0);
    expect(toPaise(null)).toBe(0);
    expect(toRupees(129999)).toBe(1299.99);
    expect(toRupees(4950)).toBe(49.5);
  });

  it('calculates percentage in paise with rounding', () => {
    // 15% of ₹100.00 (10000 paise) = 1500 paise
    expect(calcPercentagePaise(10000, 15)).toBe(1500);
    // 12.5% of ₹33.33 (3333 paise) = round(416.625) = 417 paise
    expect(calcPercentagePaise(3333, 12.5)).toBe(417);
  });

  it('allocates total amount across multiple vendors with ZERO remainder drift (Hare-Niemeyer method)', () => {
    // Parent discount of ₹100.00 (10000 paise) across 3 vendors with unequal subtotals
    const totalPaise = 10000;
    const vendorWeights = [
      { key: 'vendorA', weight: 3333 },
      { key: 'vendorB', weight: 3333 },
      { key: 'vendorC', weight: 3334 },
    ];

    const allocation = allocateProportionallyPaise(totalPaise, vendorWeights);
    const sumAllocated = (allocation.get('vendorA') || 0) + (allocation.get('vendorB') || 0) + (allocation.get('vendorC') || 0);

    expect(sumAllocated).toBe(totalPaise);
    expect(Number.isInteger(allocation.get('vendorA'))).toBe(true);
    expect(Number.isInteger(allocation.get('vendorB'))).toBe(true);
    expect(Number.isInteger(allocation.get('vendorC'))).toBe(true);
  });
});

describe('2. Versioned Financial Settings & Commission Hierarchy', () => {
  it('calculates delivery charges based on threshold and payment method', async () => {
    const mockSettings = {
      version: 1,
      delivery: {
        baseDeliveryFeePaise: 6000, // ₹60
        freeDeliveryThresholdPaise: 99900, // ₹999
        codFeePaise: 4000, // ₹40
        stateRules: [{ state: 'Assam', additionalFeePaise: 2000 }],
      },
      fees: {
        platformFeePaise: 1500, // ₹15
        packagingFeePaise: 500, // ₹5
      },
      settlement: { returnProtectionDays: 7, minPayoutThresholdPaise: 100000 },
    };

    jest.spyOn(financialSettingsService, 'getCurrentSettings').mockResolvedValue(mockSettings);

    // Below threshold order with COD in Assam
    const charges = await financialSettingsService.calculateMarketplaceCharges({
      subtotalPaise: 50000, // ₹500
      paymentMethod: 'cod',
      state: 'Assam',
    });

    expect(charges.deliveryFeePaise).toBe(8000); // 6000 + 2000
    expect(charges.codFeePaise).toBe(4000);
    expect(charges.platformFeePaise).toBe(1500);
    expect(charges.packagingFeePaise).toBe(500);
    expect(charges.totalMarketplaceFeesPaise).toBe(8000 + 4000 + 1500 + 500);

    // Above threshold order
    const freeDeliveryCharges = await financialSettingsService.calculateMarketplaceCharges({
      subtotalPaise: 150000, // ₹1500
      paymentMethod: 'razorpay',
    });
    expect(freeDeliveryCharges.deliveryFeePaise).toBe(0);
    expect(freeDeliveryCharges.codFeePaise).toBe(0);
  });

  it('updates financial settings to a new version without mutating historical rules', async () => {
    const current = { version: 1, delivery: { baseDeliveryFeePaise: 6000 }, fees: {}, settlement: {}, commission: {} };
    jest.spyOn(financialSettingsService, 'getCurrentSettings').mockResolvedValue(current);
    jest.spyOn(FinancialSettings, 'updateMany').mockResolvedValue({ modifiedCount: 1 });
    const createSpy = jest.spyOn(FinancialSettings, 'create').mockImplementation((data) => Promise.resolve(data));

    const updated = await financialSettingsService.updateSettings({
      delivery: { baseDeliveryFeePaise: 8000 },
    }, id());

    expect(updated.version).toBe(2);
    expect(updated.delivery.baseDeliveryFeePaise).toBe(8000);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ version: 2, isCurrent: true }));
  });

  it('resolves commission strictly in order: PRODUCT -> VENDOR -> CATEGORY -> GLOBAL -> DEFAULT', () => {
    const prodId = id();
    const vendId = id();
    const catId = id();

    const configs = [
      { _id: id(), scope: 'GLOBAL', rate: 10 },
      { _id: id(), scope: 'CATEGORY', categoryId: catId, rate: 12 },
      { _id: id(), scope: 'VENDOR', vendorId: vendId, rate: 15 },
      { _id: id(), scope: 'PRODUCT', productId: prodId, rate: 18 },
    ];

    expect(commissionService.resolveFromBatch({ productId: prodId, vendorId: vendId, categoryId: catId, configs })).toMatchObject({
      rate: 18,
      source: 'PRODUCT',
    });

    expect(commissionService.resolveFromBatch({ productId: id(), vendorId: vendId, categoryId: catId, configs })).toMatchObject({
      rate: 15,
      source: 'VENDOR',
    });

    expect(commissionService.resolveFromBatch({ productId: id(), vendorId: id(), categoryId: catId, configs })).toMatchObject({
      rate: 12,
      source: 'CATEGORY',
    });

    expect(commissionService.resolveFromBatch({ productId: id(), vendorId: id(), categoryId: id(), configs })).toMatchObject({
      rate: 10,
      source: 'GLOBAL',
    });

    expect(commissionService.resolveFromBatch({ productId: id(), vendorId: id(), categoryId: id(), configs: [] })).toMatchObject({
      rate: 0,
      source: 'DEFAULT',
    });
  });
});

describe('3. Vendor Ledger & Settlement Lifecycle', () => {
  it('creates immutable sale capture ledger entries with integer paise and financial snapshots', async () => {
    const orderId = id();
    const vendorId = id();
    const paymentId = id();
    const vendorOrderId = id();

    const mockOrder = {
      _id: orderId,
      orderNumber: 'RP-ORD-101',
      subtotal: 1000,
      discount: 100,
      tax: 50,
      shipping: 60,
      total: 1010,
      paymentStatus: 'PAID',
      currency: 'INR',
    };

    const mockVendorOrder = {
      _id: vendorOrderId,
      parentOrderId: orderId,
      vendorId,
      items: [{ productId: id(), lineTotal: 1000 }],
      currency: 'INR',
    };

    jest.spyOn(Order, 'findById').mockReturnValue(chain(mockOrder));
    jest.spyOn(VendorOrder, 'find').mockReturnValue(chain([mockVendorOrder]));
    jest.spyOn(VendorLedgerEntry, 'findOne').mockReturnValue(chain(null));
    jest.spyOn(VendorLedgerEntry, 'find').mockReturnValue(chain([]));
    jest.spyOn(commissionService, 'resolve').mockResolvedValue({ rate: 10, source: 'GLOBAL' });
    jest.spyOn(financialSettingsService, 'getCurrentSettings').mockResolvedValue({
      version: 1,
      settlement: { returnProtectionDays: 7 },
    });

    const createLedgerSpy = jest.spyOn(VendorLedgerEntry, 'create').mockResolvedValue({ _id: id() });
    jest.spyOn(VendorOrder, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    jest.spyOn(Order, 'updateOne').mockResolvedValue({ modifiedCount: 1 });

    const result = await vendorLedgerService.recordCapturedPayment({
      orderId,
      paymentId,
      payment: { status: 'CAPTURED', currency: 'INR' },
    });

    expect(result.created).toBe(1);
    expect(createLedgerSpy).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'SALE_CAPTURE',
      status: 'POSTED',
      eligibilityStatus: 'PENDING',
      grossAmountPaise: 101000, // Total allocated to vendor order in paise
      commissionAmountPaise: 10000, // 10% of 100000 = 10000 paise
      netAmountPaise: 91000, // 101000 - 10000 = 91000 paise
      grossAmount: 1010,
      commissionAmount: 100,
      netAmount: 910,
    }));
  });

  it('records a refund adjustment compensating entry and tracks refund-after-settlement', async () => {
    const refundId = id();
    const vendorOrderId = id();
    const vendorId = id();

    // Mock existing settled sale entry
    jest.spyOn(VendorLedgerEntry, 'findOne').mockReturnValue(chain({
      vendorOrderId,
      transactionType: 'SALE_CAPTURE',
      eligibilityStatus: 'SETTLED',
    }));
    jest.spyOn(VendorLedgerEntry, 'find').mockReturnValue(chain([{ runningBalancePaise: 91000 }]));
    const createSpy = jest.spyOn(VendorLedgerEntry, 'create').mockResolvedValue({ _id: id() });
    jest.spyOn(VendorOrder, 'updateOne').mockResolvedValue({ modifiedCount: 1 });

    const res = await vendorLedgerService.recordRefundAdjustment({
      refundId,
      parentOrderId: id(),
      vendorOrderId,
      vendorId,
      paymentId: id(),
      amount: 500, // ₹500
    });

    expect(res.created).toBe(true);
    expect(res.refundAfterSettlement).toBe(true);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      transactionType: 'REFUND_ADJUSTMENT',
      adjustmentAmountPaise: -50000,
      netAmountPaise: -50000,
      runningBalancePaise: 41000, // 91000 - 50000
      metadata: expect.objectContaining({ refundAfterSettlement: true }),
    }));
  });

  it('promotes PENDING ledger entries to ELIGIBLE only after return period passes with no disputes', async () => {
    const pastDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
    const entryId = id();
    const voId = id();
    const pOrderId = id();

    jest.spyOn(VendorLedgerEntry, 'find').mockReturnValue(chain([
      {
        _id: entryId,
        vendorOrderId: voId,
        parentOrderId: pOrderId,
        eligibleAt: pastDate,
      },
    ]));

    jest.spyOn(VendorOrder, 'findById').mockReturnValue(chain({ _id: voId, status: 'DELIVERED', parentOrderId: pOrderId }));
    jest.spyOn(Order, 'findById').mockReturnValue(chain({ _id: pOrderId, paymentStatus: 'PAID', status: 'DELIVERED' }));
    const updateEntrySpy = jest.spyOn(VendorLedgerEntry, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
    const updateVoSpy = jest.spyOn(VendorOrder, 'updateOne').mockResolvedValue({ modifiedCount: 1 });

    const result = await settlementService.evaluateSettlementEligibility();

    expect(result.promoted).toBe(1);
    expect(updateEntrySpy).toHaveBeenCalledWith(
      { _id: entryId },
      { $set: { eligibilityStatus: 'ELIGIBLE', holdReason: null } }
    );
    expect(updateVoSpy).toHaveBeenCalledWith(
      { _id: voId },
      { $set: { settlementStatus: 'ELIGIBLE' } }
    );
  });
});

describe('4. Provider Safety (No Fake Transfers When Unconfigured)', () => {
  it('leaves payouts safely in READY status when Razorpay Route is not configured', async () => {
    const vendorId = id();

    jest.spyOn(financialSettingsService, 'getCurrentSettings').mockResolvedValue({
      settlement: { minPayoutThresholdPaise: 10000 },
    });

    jest.spyOn(VendorLedgerEntry, 'aggregate').mockResolvedValue([
      { _id: vendorId, totalNetPaise: 50000, entryIds: [id()] },
    ]);

    jest.spyOn(settlementService, 'readiness').mockResolvedValue({
      payoutRequestsEnabled: true,
      eligible: false, // Provider unconfigured
      hasRouteAccount: false,
      reason: 'Razorpay Route provider transfer credentials not configured',
    });

    jest.spyOn(VendorBankAccount, 'findOne').mockReturnValue(chain({ accountNumber: '1234567890', ifsc: 'HDFC0001234' }));
    jest.spyOn(Vendor, 'findById').mockReturnValue(chain({ businessName: 'Artisan Store' }));

    const mockBatch = { _id: id(), batchNumber: 'SB-TEST', save: jest.fn().mockResolvedValue(true) };
    jest.spyOn(SettlementBatch, 'create').mockResolvedValue(mockBatch);

    const mockPayout = {
      _id: id(),
      status: 'PROCESSING',
      amountPaise: 50000,
      save: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(VendorPayout, 'create').mockResolvedValue(mockPayout);
    jest.spyOn(VendorLedgerEntry, 'updateMany').mockResolvedValue({ modifiedCount: 1 });

    const result = await settlementService.createSettlementBatch();

    expect(result.created).toBe(true);
    // Payout must NOT be marked PAID; it must safely remain READY
    expect(mockPayout.status).toBe('READY');
    expect(mockPayout.providerTransferId).toBeUndefined();
  });

  it('provider abstraction reports configured=false without environment credentials', () => {
    expect(razorpayRouteProvider.isConfigured()).toBe(false);
  });
});

describe('5. Reconciliation Engine', () => {
  it('detects discrepancies when payment amount does not match order total', async () => {
    const orderId = id();
    const mockOrder = {
      _id: orderId,
      orderNumber: 'RP-ORD-999',
      total: 1500, // ₹1,500 = 150000 paise
      paymentStatus: 'CAPTURED',
      createdAt: new Date(),
    };

    const mockPayment = {
      orderId,
      amount: 1400, // ₹1,400 = 140000 paise (mismatch!)
      status: 'CAPTURED',
    };

    jest.spyOn(Order, 'find').mockReturnValue(chain([mockOrder]));
    jest.spyOn(Payment, 'findOne').mockReturnValue(chain(mockPayment));
    jest.spyOn(VendorOrder, 'find').mockReturnValue(chain([]));
    jest.spyOn(VendorPayout, 'find').mockReturnValue(chain([]));
    jest.spyOn(Refund, 'find').mockReturnValue(chain([]));

    const report = await reconciliationService.runReconciliation({ limit: 10 });

    expect(report.passed).toBe(false);
    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0].type).toBe('PAYMENT_AMOUNT_MISMATCH');
    expect(report.discrepancies[0].differencePaise).toBe(-10000); // 100 rupees difference
  });
});
