import { afterEach, describe, expect, it, jest } from '@jest/globals';
import mongoose from 'mongoose';
import { getMyVendorVerification } from '../app/controllers/vendor.controller.js';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorDocument } from '../app/models/vendor-document.model.js';
import { VendorBankAccount } from '../app/models/vendor-bank.model.js';
import { vendorVerificationService } from '../app/services/vendor-verification.service.js';

const id = () => new mongoose.Types.ObjectId();
const chain = (value) => ({ select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) });
const response = () => { const json = jest.fn(); return { response: { status: () => ({ json }) }, json, next: jest.fn() }; };

afterEach(() => jest.restoreAllMocks());

describe('seller verification access', () => {
  it('returns only the authenticated owner verification state without document keys or bank numbers', async () => {
    const vendorId = id();
    jest.spyOn(Vendor, 'findOne').mockReturnValue(chain({ _id: vendorId, businessName: 'Studio', status: 'UNDER_REVIEW', verificationStatus: 'PENDING' }));
    jest.spyOn(VendorDocument, 'find').mockReturnValue(chain([{ _id: id(), vendorId, documentType: 'IDENTITY', status: 'PENDING', storageKey: 'secret/key' }]));
    jest.spyOn(VendorBankAccount, 'findOne').mockReturnValue(chain({ _id: id(), vendorId, accountNumber: '123456789', maskedAccountNumber: '****6789', bankName: 'Bank' }));
    const result = response();

    await getMyVendorVerification({ user: { sub: id() }, headers: {} }, result.response, result.next);

    expect(result.next).not.toHaveBeenCalled();
    const payload = result.json.mock.calls[0][0].data;
    expect(payload.vendor.status).toBe('UNDER_REVIEW');
    expect(payload.documents[0]).not.toHaveProperty('storageKey');
    expect(payload.bankAccount).not.toHaveProperty('accountNumber');
    expect(payload.bankAccount.maskedAccountNumber).toBe('****6789');
  });

  it('rejects missing vendor verification state', async () => {
    jest.spyOn(vendorVerificationService, 'getForOwner').mockRejectedValue(Object.assign(new Error('not found'), { code: 'VENDOR_NOT_FOUND' }));
    const result = response();
    await getMyVendorVerification({ user: { sub: id() }, headers: {} }, result.response, result.next);
    expect(result.next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VENDOR_NOT_FOUND' }));
  });
});
