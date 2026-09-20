import mongoose from 'mongoose';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { CommissionConfig } from '../app/models/commission-config.model.js';
import { VendorLedgerEntry } from '../app/models/vendor-ledger-entry.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Product } from '../app/models/product.model.js';
import { commissionService } from '../app/services/commission.service.js';
import { vendorLedgerService } from '../app/services/vendor-ledger.service.js';
import { listVendorLedger } from '../app/controllers/finance.controller.js';

const id = () => new mongoose.Types.ObjectId();
const chain = (value) => ({ sort: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) });

afterEach(() => jest.restoreAllMocks());

describe('commission resolution', () => {
  it('uses Product, Vendor, Category, then Global priority', async () => {
    const productId = id(); const vendorId = id(); const categoryId = id();
    const findOne = jest.spyOn(CommissionConfig, 'findOne');
    findOne.mockReturnValueOnce({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) });
    findOne.mockReturnValueOnce({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ rate: 12 }) });

    const result = await commissionService.resolve({ productId, vendorId, categoryId });

    expect(result).toMatchObject({ rate: 12, source: 'VENDOR' });
    expect(findOne).toHaveBeenNthCalledWith(2, expect.objectContaining({ scope: 'VENDOR', vendorId }));
  });
});

describe('vendor ledger', () => {
  it('creates separate vendor snapshots from one captured multi-vendor payment', async () => {
    const orderId = id(); const paymentId = id(); const vendorA = id(); const vendorB = id();
    const productA = id(); const productB = id();
    jest.spyOn(VendorOrder, 'find').mockReturnValue(chain([
      { _id: id(), parentOrderId: orderId, vendorId: vendorA, currency: 'INR', items: [{ productId: productA, lineTotal: 1000 }] },
      { _id: id(), parentOrderId: orderId, vendorId: vendorB, currency: 'INR', items: [{ productId: productB, lineTotal: 2000 }] },
    ]));
    jest.spyOn(VendorLedgerEntry, 'findOne').mockReturnValue(chain(null));
    jest.spyOn(VendorLedgerEntry, 'create').mockImplementation(async (payload) => payload);
    jest.spyOn(Product, 'findById').mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ categoryId: id() }) });
    jest.spyOn(commissionService, 'resolve').mockResolvedValue({ rate: 10, source: 'GLOBAL' });
    const create = VendorLedgerEntry.create;

    const result = await vendorLedgerService.recordCapturedPayment({ orderId, paymentId, payment: { _id: paymentId, status: 'CAPTURED', currency: 'INR' } });

    expect(result.created).toBe(2);
    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({ vendorId: vendorA, grossAmount: 1000, commissionAmount: 100, netAmount: 900 }));
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({ vendorId: vendorB, grossAmount: 2000, commissionAmount: 200, netAmount: 1800 }));
  });

  it('does not create entries for unpaid payments and does not recalculate an existing snapshot', async () => {
    const orderId = id(); const paymentId = id(); const vendorOrderId = id();
    const create = jest.spyOn(VendorLedgerEntry, 'create').mockResolvedValue({});
    await expect(vendorLedgerService.recordCapturedPayment({ orderId, paymentId, payment: { _id: paymentId, status: 'PENDING' } })).resolves.toMatchObject({ skipped: true });
    expect(create).not.toHaveBeenCalled();

    jest.spyOn(VendorOrder, 'find').mockReturnValue(chain([{ _id: vendorOrderId, parentOrderId: orderId, vendorId: id(), currency: 'INR', items: [{ productId: id(), lineTotal: 1000 }] }]));
    jest.spyOn(VendorLedgerEntry, 'findOne').mockReturnValue(chain({ _id: 'existing', commissionRate: 10, commissionAmount: 100 }));
    await vendorLedgerService.recordCapturedPayment({ orderId, paymentId, payment: { _id: paymentId, status: 'CAPTURED' } });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('vendor ledger access', () => {
  it('scopes ledger reads to the authenticated approved vendor', async () => {
    const vendorId = id();
    jest.spyOn(Vendor, 'findOne').mockReturnValue(chain({ _id: vendorId, status: 'APPROVED' }));
    jest.spyOn(vendorLedgerService, 'listForVendor').mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 });
    const json = jest.fn(); const next = jest.fn();
    await listVendorLedger({ user: { sub: id() }, query: {}, headers: {} }, { status: () => ({ json }) }, next);
    expect(next).not.toHaveBeenCalled();
    expect(vendorLedgerService.listForVendor).toHaveBeenCalledWith(vendorId, expect.any(Object));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ total: 0 }) }));
  });
});
