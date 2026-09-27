import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { Product } from '../app/models/product.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { User } from '../app/models/user.model.js';
import { Notification } from '../app/models/notification.model.js';
import { productService } from '../app/services/product.service.js';
import { notificationService } from '../app/services/notification.service.js';
import { approveProduct, adminProductDetail, adminProductList } from '../app/controllers/product.controller.js';
import { listAdminNotifications, markNotificationAsRead } from '../app/controllers/notification.controller.js';

describe('Admin Product Approval, Dynamic Details & Notifications Flow', () => {
  const mockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const adminId = new mongoose.Types.ObjectId().toHexString();
  const vendorUserId = new mongoose.Types.ObjectId().toHexString();
  const vendorId = new mongoose.Types.ObjectId().toHexString();
  const productId = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  describe('Product Approval Workflow & Transitions', () => {
    it('allows transition from SUBMITTED directly to APPROVED without throwing HTTP 400', async () => {
      const mockProduct = {
        _id: productId,
        vendorId,
        name: 'Madhubani Hand-painted Canvas',
        slug: 'madhubani-hand-painted-canvas',
        status: 'SUBMITTED',
        deletedAt: null,
        save: jest.fn().mockResolvedValue(true),
        toObject: function () {
          return { ...this };
        },
      };

      jest.spyOn(Product, 'findById').mockResolvedValue(mockProduct);
      jest.spyOn(Vendor, 'findById').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId }),
        }),
      });

      const populatedProduct = {
        _id: productId,
        name: 'Madhubani Hand-painted Canvas',
        status: 'APPROVED',
        vendorId: {
          _id: vendorId,
          businessName: 'Mithila Crafts',
          legalName: 'Mithila Crafts Pvt Ltd',
        },
        variants: [
          {
            _id: 'var-1',
            sku: 'MADHU-001',
            price: 1500,
            stock: 25,
            availableStock: 25,
            status: 'ACTIVE',
          },
        ],
        images: [
          {
            _id: 'img-1',
            url: 'https://res.cloudinary.com/rupakar/image/upload/madhubani-real.jpg',
            isPrimary: true,
          },
        ],
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(productService, 'getByIdForAdmin').mockResolvedValue(populatedProduct);
      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      const updated = await productService.setProductStatus(productId, 'APPROVED', adminId);

      expect(mockProduct.status).toBe('APPROVED');
      expect(mockProduct.reviewedBy).toBe(adminId);
      expect(mockProduct.save).toHaveBeenCalled();
      expect(updated.status).toBe('APPROVED');
      expect(notifSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: vendorUserId,
          type: 'PRODUCT_APPROVED',
        })
      );
    });

    it('approveProduct controller handles empty or metadata body without 400 validation error', async () => {
      const req = {
        params: { id: productId },
        body: { extraFieldIgnored: true },
        user: { sub: adminId, role: 'admin' },
        headers: { 'x-request-id': 'req-approve-123' },
      };
      const res = mockResponse();
      const next = jest.fn();

      jest.spyOn(productService, 'setProductStatus').mockResolvedValue({
        id: productId,
        _id: productId,
        name: 'Terracotta Vase',
        status: 'APPROVED',
        images: [{ url: 'https://cloudinary.com/vase.jpg', isPrimary: true }],
        variants: [{ sku: 'VASE-1', price: 800, stock: 10 }],
      });

      await approveProduct(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonResponse = res.json.mock.calls[0][0];
      expect(jsonResponse.success).toBe(true);
      expect(jsonResponse.data.status).toBe('APPROVED');
      expect(jsonResponse.data.sku).toBe('VASE-1');
    });

    it('idempotently returns populated product if already in the target status', async () => {
      const mockProduct = {
        _id: productId,
        vendorId,
        status: 'APPROVED',
        deletedAt: null,
      };

      jest.spyOn(Product, 'findById').mockResolvedValue(mockProduct);
      jest.spyOn(productService, 'getByIdForAdmin').mockResolvedValue({
        _id: productId,
        status: 'APPROVED',
        name: 'Already Approved Product',
      });

      const result = await productService.setProductStatus(productId, 'APPROVED', adminId);
      expect(result.status).toBe('APPROVED');
    });
  });

  describe('Dynamic Product Details Loading', () => {
    it('adminProductDetail returns full unadulterated specifications from database without fake mock fallbacks', async () => {
      const fullDbProduct = {
        _id: productId,
        name: 'Pattachitra Hand-painted Scroll',
        slug: 'pattachitra-scroll',
        shortDescription: 'Heritage folk art scroll',
        description: 'Authentic palm leaf pattachitra painting by master artisan.',
        status: 'UNDER_REVIEW',
        vendorId: {
          _id: vendorId,
          businessName: 'Raghurajpur Heritage Co',
          legalName: 'Raghurajpur Heritage Collective',
          website: 'https://raghurajpurart.org',
          originState: 'Odisha',
          originDistrict: 'Puri',
        },
        categoryId: {
          _id: 'cat-1',
          name: 'Traditional Paintings',
          slug: 'paintings',
        },
        subcategoryId: {
          _id: 'subcat-1',
          name: 'Pattachitra',
          slug: 'pattachitra',
        },
        brandId: {
          _id: 'brand-1',
          name: 'Utkal Craft',
          slug: 'utkal-craft',
        },
        authenticity: {
          reference: 'CERT-OD-2026-9988',
          status: 'VERIFIED',
        },
        shipping: {
          originState: 'Odisha',
          originDistrict: 'Puri',
          deliveryDays: 5,
          freeShipping: true,
        },
        tax: {
          taxable: true,
          taxCode: 'HSN-9701',
          gstIncluded: true,
        },
        variants: [
          {
            _id: 'var-99',
            sku: 'PATTA-01',
            price: 4500,
            compareAtPrice: 5000,
            stock: 8,
            availableStock: 8,
            reservedStock: 0,
            weight: 0.8,
            dimensions: { length: 60, width: 30, height: 2 },
            attributes: { size: 'Large', material: 'Tussar Silk & Natural Colors' },
          },
        ],
        images: [
          {
            _id: 'img-10',
            url: 'https://res.cloudinary.com/rupakar/image/upload/v12345/pattachitra_main.jpg',
            isPrimary: true,
            sortOrder: 0,
          },
          {
            _id: 'img-11',
            url: 'https://res.cloudinary.com/rupakar/image/upload/v12345/pattachitra_detail.jpg',
            isPrimary: false,
            sortOrder: 1,
          },
        ],
        tags: ['pattachitra', 'odisha', 'folk-art'],
        createdAt: new Date('2026-09-20T10:00:00Z'),
        updatedAt: new Date('2026-09-21T12:00:00Z'),
      };

      jest.spyOn(productService, 'getByIdForAdmin').mockResolvedValue(fullDbProduct);

      const req = { params: { id: productId }, headers: {} };
      const res = mockResponse();
      const next = jest.fn();

      await adminProductDetail(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const json = res.json.mock.calls[0][0];
      const data = json.data;

      expect(data.name).toBe('Pattachitra Hand-painted Scroll');
      expect(data.sku).toBe('PATTA-01');
      expect(data.categoryName).toBe('Traditional Paintings');
      expect(data.vendor.businessName).toBe('Raghurajpur Heritage Co');
      expect(data.vendor.originState).toBe('Odisha');
      expect(data.authenticity.reference).toBe('CERT-OD-2026-9988');
      expect(data.authenticity.status).toBe('VERIFIED');
      expect(data.shipping.freeShipping).toBe(true);
      expect(data.images).toHaveLength(2);
      expect(data.images[0].url).toBe('https://res.cloudinary.com/rupakar/image/upload/v12345/pattachitra_main.jpg');
      expect(data.images[1].url).toBe('https://res.cloudinary.com/rupakar/image/upload/v12345/pattachitra_detail.jpg');
      // Verify no fake placeholder image is injected
      expect(data.images.some((i) => i.url.includes('product-vase.jpg'))).toBe(false);
      expect(data.variants[0].dimensions).toEqual({ length: 60, width: 30, height: 2 });
    });
  });

  describe('Admin Notifications Flow & Isolation', () => {
    it('notifies all active admins when a vendor submits a product for review', async () => {
      const admin1 = { _id: new mongoose.Types.ObjectId() };
      const admin2 = { _id: new mongoose.Types.ObjectId() };

      jest.spyOn(User, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([admin1, admin2]),
        }),
      });

      const notifCreateSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      await notificationService.notifyAdmins({
        type: 'ADMIN_PRODUCT_SUBMITTED',
        title: 'New Product Submitted for Review',
        message: 'Product "Dhokra Brass Figurine" has been submitted for review.',
        metadata: { productId: 'prod-dhokra-1' },
      });

      expect(notifCreateSpy).toHaveBeenCalledTimes(2);
      expect(notifCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: admin1._id,
          type: 'ADMIN_PRODUCT_SUBMITTED',
          metadata: expect.objectContaining({ forAdmin: true }),
        })
      );
      expect(notifCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: admin2._id,
          type: 'ADMIN_PRODUCT_SUBMITTED',
          metadata: expect.objectContaining({ forAdmin: true }),
        })
      );
    });

    it('listAdminNotifications isolates notifications and excludes customer/vendor-private notifications', async () => {
      const adminNotif1 = {
        _id: 'notif-adm-1',
        userId: adminId,
        title: 'New Product Submitted',
        type: 'ADMIN_PRODUCT_SUBMITTED',
        readAt: null,
        metadata: { forAdmin: true },
        createdAt: new Date(),
      };

      const findMock = jest.spyOn(Notification, 'find').mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: jest.fn().mockResolvedValue([adminNotif1]),
            }),
          }),
        }),
      });
      jest.spyOn(Notification, 'countDocuments').mockResolvedValue(1);

      const req = {
        user: { sub: adminId, role: 'admin' },
        query: { page: '1', limit: '20' },
        headers: {},
      };
      const res = mockResponse();
      const next = jest.fn();

      await listAdminNotifications(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const callFilter = findMock.mock.calls[0][0];

      // Verify that isolation filter ensures only notifications intended for admins are returned
      expect(callFilter.$or).toEqual(
        expect.arrayContaining([
          { userId: adminId },
          { 'metadata.forAdmin': true },
          { type: { $regex: /^ADMIN_/i } },
        ])
      );

      const json = res.json.mock.calls[0][0];
      expect(json.data.items).toHaveLength(1);
      expect(json.data.items[0].type).toBe('ADMIN_PRODUCT_SUBMITTED');
    });

    it('markNotificationAsRead updates readAt in database for admin', async () => {
      const notifId = new mongoose.Types.ObjectId().toHexString();
      jest.spyOn(Notification, 'findOne').mockResolvedValue({ _id: notifId });
      const updateSpy = jest.spyOn(Notification, 'findByIdAndUpdate').mockResolvedValue({});

      const req = {
        params: { id: notifId },
        user: { sub: adminId, role: 'admin' },
        headers: {},
      };
      const res = mockResponse();
      const next = jest.fn();

      await markNotificationAsRead(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(updateSpy).toHaveBeenCalledWith(
        notifId,
        expect.objectContaining({ readAt: expect.any(Date) })
      );
    });
  });
});
