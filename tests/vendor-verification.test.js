import { afterEach, describe, expect, it, jest } from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../app.js';
import { getMyVendorVerification } from '../app/controllers/vendor.controller.js';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorDocument } from '../app/models/vendor-document.model.js';
import { VendorBankAccount } from '../app/models/vendor-bank.model.js';
import { vendorVerificationService } from '../app/services/vendor-verification.service.js';
import { vendorService } from '../app/services/vendor.service.js';

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

  it('protects the vendor dashboard endpoint behind authentication', async () => {
    const response = await request(app).get('/api/v1/vendor/dashboard');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  describe('vendorService document operations', () => {
    it('creates a vendor document and links it without ReferenceError', async () => {
      const vendorObjectId = id();
      const docObjectId = id();
      const mockVendor = { _id: vendorObjectId, ownerUserId: id() };
      const mockDoc = { _id: docObjectId, vendorId: vendorObjectId, documentType: 'GST', status: 'PENDING' };

      jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
      jest.spyOn(VendorDocument, 'create').mockResolvedValue(mockDoc);
      jest.spyOn(Vendor, 'updateOne').mockResolvedValue({ modifiedCount: 1 });

      const created = await vendorService.createDocument(vendorObjectId.toHexString(), {
        documentType: 'GST',
        fileName: 'gst_certificate.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        storageKey: 'vendors/docs/gst.pdf',
        storageProvider: 's3',
      });

      expect(created).toBeDefined();
      expect(created._id).toEqual(docObjectId);
      expect(VendorDocument.create).toHaveBeenCalledWith(expect.objectContaining({
        vendorId: vendorObjectId,
        documentType: 'GST',
        storageKey: 'vendors/docs/gst.pdf',
      }));
      expect(Vendor.updateOne).toHaveBeenCalledWith(
        { _id: vendorObjectId },
        { $addToSet: { documents: docObjectId } }
      );
    });

    it('lists vendor documents without ReferenceError', async () => {
      const vendorObjectId = id();
      const mockVendor = { _id: vendorObjectId };
      jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
      jest.spyOn(VendorDocument, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: id(), documentType: 'GST' }]),
      });

      const list = await vendorService.listDocuments(vendorObjectId.toHexString());
      expect(list).toHaveLength(1);
      expect(list[0].documentType).toBe('GST');
    });
  });
});
