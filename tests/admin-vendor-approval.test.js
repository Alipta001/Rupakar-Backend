import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import mongoose from 'mongoose';
import { vendorService, VENDOR_VALID_TRANSITIONS } from '../app/services/vendor.service.js';
import { Vendor } from '../app/models/vendor.model.js';
import { User } from '../app/models/user.model.js';
import { VendorBankAccount } from '../app/models/vendor-bank.model.js';
import { approveVendor, listAdminVendors } from '../app/controllers/vendor.controller.js';

const id = () => new mongoose.Types.ObjectId();
const response = () => {
  const res = {
    statusCode: 200,
    status: jest.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function (payload) {
      this.payload = payload;
      return this;
    }),
  };
  return res;
};

describe('Admin Vendor Approval and Seller Details', () => {
  const vendorId = id();
  const ownerUserId = id();
  const adminId = id();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Vendor Status Transition Matrix', () => {
    it('allows transition from PENDING to APPROVED', () => {
      expect(VENDOR_VALID_TRANSITIONS.PENDING).toContain('APPROVED');
      expect(VENDOR_VALID_TRANSITIONS.PENDING).toContain('UNDER_REVIEW');
      expect(VENDOR_VALID_TRANSITIONS.PENDING).toContain('REJECTED');
    });

    it('does not allow repeated approval from APPROVED to APPROVED', () => {
      expect(VENDOR_VALID_TRANSITIONS.APPROVED).not.toContain('APPROVED');
    });
  });

  describe('vendorService.transitionStatus', () => {
    it('approves a PENDING vendor, sets verificationStatus to VERIFIED, and updates user role to vendor', async () => {
      const mockVendor = {
        _id: vendorId,
        ownerUserId,
        businessName: 'Heritage Textiles',
        status: 'PENDING',
        verificationStatus: 'PENDING',
        metadata: {},
        save: jest.fn().mockResolvedValue(true),
      };

      const populatedVendor = {
        _id: vendorId,
        ownerUserId: {
          _id: ownerUserId,
          name: 'Priya Sharma',
          email: 'priya@example.com',
          phone: '+919876543210',
          role: 'vendor',
        },
        businessName: 'Heritage Textiles',
        status: 'APPROVED',
        verificationStatus: 'VERIFIED',
        toObject: () => ({
          _id: vendorId,
          businessName: 'Heritage Textiles',
          status: 'APPROVED',
          verificationStatus: 'VERIFIED',
          ownerUserId: {
            _id: ownerUserId,
            name: 'Priya Sharma',
            email: 'priya@example.com',
            phone: '+919876543210',
            role: 'vendor',
          },
        }),
      };

      jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
      jest.spyOn(User, 'updateOne').mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
      jest.spyOn(vendorService, 'getById').mockResolvedValue(populatedVendor);

      const result = await vendorService.transitionStatus(vendorId, 'APPROVED', adminId, 'Documents verified', {
        commissionRate: 12,
      });

      expect(mockVendor.status).toBe('APPROVED');
      expect(mockVendor.verificationStatus).toBe('VERIFIED');
      expect(mockVendor.commissionRate).toBe(12);
      expect(mockVendor.approvedBy).toEqual(adminId);
      expect(mockVendor.save).toHaveBeenCalled();
      expect(User.updateOne).toHaveBeenCalledWith({ _id: ownerUserId }, { $set: { role: 'vendor' } });
      expect(result.status).toBe('APPROVED');
    });

    it('rejects repeated approval on already APPROVED vendor with 400 error', async () => {
      const mockVendor = {
        _id: vendorId,
        ownerUserId,
        status: 'APPROVED',
        save: jest.fn(),
      };

      jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);

      await expect(
        vendorService.transitionStatus(vendorId, 'APPROVED', adminId)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_VENDOR_STATUS_TRANSITION',
      });

      expect(mockVendor.save).not.toHaveBeenCalled();
    });
  });

  describe('approveVendor Controller', () => {
    it('approves vendor successfully even if body is empty or omitted', async () => {
      const populatedVendor = {
        _id: vendorId,
        ownerUserId: {
          _id: ownerUserId,
          name: 'Aarav Patel',
          email: 'aarav@example.com',
          phone: '+919876543211',
          role: 'vendor',
        },
        businessName: 'Kutch Crafts',
        status: 'APPROVED',
        verificationStatus: 'VERIFIED',
        toObject: () => ({
          _id: vendorId,
          businessName: 'Kutch Crafts',
          status: 'APPROVED',
          ownerUserId: {
            name: 'Aarav Patel',
            email: 'aarav@example.com',
          },
        }),
      };

      jest.spyOn(vendorService, 'transitionStatus').mockResolvedValue(populatedVendor);

      const req = {
        params: { id: vendorId.toHexString() },
        user: { sub: adminId.toHexString(), role: 'admin' },
        body: undefined,
        headers: {},
      };
      const res = response();
      const next = jest.fn();

      await approveVendor(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      const data = res.json.mock.calls[0][0].data;
      expect(data.status).toBe('APPROVED');
      expect(data.sellerName).toBe('Aarav Patel');
      expect(data.sellerEmail).toBe('aarav@example.com');
      expect(data.businessName).toBe('Kutch Crafts');
    });
  });

  describe('listAdminVendors Controller', () => {
    it('returns sanitized vendor records with sellerName, sellerEmail, and businessName', async () => {
      const mockResult = {
        data: [
          {
            _id: vendorId,
            businessName: 'Kutch Crafts',
            status: 'PENDING',
            ownerUserId: {
              _id: ownerUserId,
              name: 'Aarav Patel',
              email: 'aarav@example.com',
              phone: '+919876543211',
            },
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };

      jest.spyOn(vendorService, 'listForAdmin').mockResolvedValue(mockResult);
      // Mock the bank batch-fetch used by the updated listAdminVendors
      jest.spyOn(VendorBankAccount, 'find').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });

      const req = {
        query: { page: '1', limit: '20' },
        headers: {},
      };
      const res = response();
      const next = jest.fn();

      await listAdminVendors(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0].data;
      expect(payload.items[0].businessName).toBe('Kutch Crafts');
      expect(payload.items[0].sellerName).toBe('Aarav Patel');
      expect(payload.items[0].sellerEmail).toBe('aarav@example.com');
      expect(payload.items[0].sellerPhone).toBe('+919876543211');
    });
  });
});
