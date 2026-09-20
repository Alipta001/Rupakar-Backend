import mongoose from 'mongoose';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorBankAccount } from '../app/models/vendor-bank.model.js';
import { VendorLedgerEntry } from '../app/models/vendor-ledger-entry.model.js';
import { VendorPayout } from '../app/models/vendor-payout.model.js';
import { settlementService } from '../app/services/settlement.service.js';
import { getVendorBalance, getVendorPayout } from '../app/controllers/finance.controller.js';

const id = () => new mongoose.Types.ObjectId();
const chain = (value) => ({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) });

afterEach(() => jest.restoreAllMocks());

describe('settlement balance', () => {
  it('derives available balance from eligible ledger net minus paid and reserved payouts', async () => {
    const vendorId = id();
    jest.spyOn(Vendor, 'findById').mockReturnValue(chain({ status: 'APPROVED', verificationStatus: 'VERIFIED' }));
    jest.spyOn(VendorBankAccount, 'findOne').mockReturnValue(chain({ _id: id() }));
    jest.spyOn(VendorLedgerEntry, 'aggregate')
      .mockResolvedValueOnce([{ amount: 1000 }])
      .mockResolvedValueOnce([{ amount: 200 }])
      .mockResolvedValueOnce([{ amount: 800 }]);
    jest.spyOn(VendorPayout, 'aggregate')
      .mockResolvedValueOnce([{ amount: 300 }])
      .mockResolvedValueOnce([{ amount: 100 }]);

    const result = await settlementService.balanceForVendor(vendorId);

    expect(result).toMatchObject({ ledgerNet: 1000, pendingAmount: 200, eligibleAmount: 800, settledAmount: 300, reservedAmount: 100, availableAmount: 400 });
    expect(result.readiness.payoutRequestsEnabled).toBe(false);
  });
});

describe('settlement access', () => {
  it('returns only the authenticated approved vendor balance', async () => {
    const vendorId = id();
    jest.spyOn(Vendor, 'findOne').mockReturnValue(chain({ _id: vendorId, status: 'APPROVED' }));
    jest.spyOn(settlementService, 'balanceForVendor').mockResolvedValue({ availableAmount: 0 });
    const json = jest.fn(); const next = jest.fn();
    await getVendorBalance({ user: { sub: id() }, headers: {} }, { status: () => ({ json }) }, next);
    expect(next).not.toHaveBeenCalled();
    expect(settlementService.balanceForVendor).toHaveBeenCalledWith(vendorId);
    expect(json).toHaveBeenCalled();
  });

  it('does not allow a seller to access another vendor payout', async () => {
    const vendorId = id();
    jest.spyOn(Vendor, 'findOne').mockReturnValue(chain({ _id: vendorId, status: 'APPROVED' }));
    jest.spyOn(VendorPayout, 'findOne').mockReturnValue(chain(null));
    const json = jest.fn(); const next = jest.fn();
    await getVendorPayout({ user: { sub: id() }, params: { id: id() }, headers: {} }, { status: () => ({ json }) }, next);
    expect(json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYOUT_NOT_FOUND' }));
  });
});
