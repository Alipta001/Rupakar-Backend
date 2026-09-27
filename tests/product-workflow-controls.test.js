import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { Product } from '../app/models/product.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { InventoryMovement } from '../app/models/inventory-movement.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { productService } from '../app/services/product.service.js';
import { notificationService } from '../app/services/notification.service.js';

describe('Product Workflow Controls, Admin Moderation & Seller Operations', () => {
  const adminId = new mongoose.Types.ObjectId().toHexString();
  const vendorUserId = new mongoose.Types.ObjectId().toHexString();
  const vendorId = new mongoose.Types.ObjectId().toHexString();
  const productId = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
    jest.spyOn(notificationService, 'notifyAdmins').mockResolvedValue([]);
  });

  describe('Admin Product Transitions & Reject Rules', () => {
    it('blocks rejection from UNPUBLISHED status with 400 INVALID_PRODUCT_STATUS', async () => {
      const mockProduct = {
        _id: productId,
        name: 'Sambalpuri Silk Saree',
        status: 'UNPUBLISHED',
        deletedAt: null,
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(Product, 'findById').mockResolvedValue(mockProduct);

      await expect(
        productService.setProductStatus(productId, 'REJECTED', adminId, 'Quality standards issue')
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PRODUCT_STATUS',
      });
    });

    it('blocks rejection from PUBLISHED status with 400 INVALID_PRODUCT_STATUS', async () => {
      const mockProduct = {
        _id: productId,
        name: 'Sambalpuri Silk Saree',
        status: 'PUBLISHED',
        deletedAt: null,
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(Product, 'findById').mockResolvedValue(mockProduct);

      await expect(
        productService.setProductStatus(productId, 'REJECTED', adminId, 'Quality standards issue')
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_PRODUCT_STATUS',
      });
    });

    it('requires a reason when rejecting a product', async () => {
      const mockProduct = {
        _id: productId,
        name: 'Sambalpuri Silk Saree',
        status: 'SUBMITTED',
        deletedAt: null,
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(Product, 'findById').mockResolvedValue(mockProduct);

      await expect(
        productService.setProductStatus(productId, 'REJECTED', adminId, '   ')
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'PRODUCT_REJECTION_REASON_REQUIRED',
      });
    });

    it('successfully transitions from SUBMITTED, UNDER_REVIEW, APPROVED, and EDITED to REJECTED', async () => {
      for (const validStatus of ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'EDITED']) {
        const mockProduct = {
          _id: productId,
          vendorId,
          name: 'Handcrafted Item',
          status: validStatus,
          deletedAt: null,
          save: jest.fn().mockResolvedValue(true),
        };
        jest.spyOn(Product, 'findById').mockResolvedValue(mockProduct);
        jest.spyOn(productService, 'getByIdForAdmin').mockResolvedValue({
          ...mockProduct,
          status: 'REJECTED',
        });
        jest.spyOn(Vendor, 'findById').mockReturnValue({
          select: () => ({ lean: async () => ({ ownerUserId: vendorUserId }) }),
        });

        const updated = await productService.setProductStatus(productId, 'REJECTED', adminId, 'Inadequate photos');
        expect(mockProduct.status).toBe('REJECTED');
        expect(mockProduct.rejectionReason).toBe('Inadequate photos');
        expect(mockProduct.reviewedBy).toBe(adminId);
        expect(mockProduct.publishedAt).toBeNull();
      }
    });
  });

  describe('Admin Delete Rejected Product', () => {
    it('successfully soft-deletes a product if status is REJECTED', async () => {
      const mockProduct = {
        _id: productId,
        status: 'REJECTED',
        deletedAt: null,
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(Product, 'findOne').mockResolvedValue(mockProduct);
      jest.spyOn(ProductVariant, 'updateMany').mockResolvedValue({ modifiedCount: 1 });

      const result = await productService.adminDeleteProduct(productId, adminId);
      expect(result.success).toBe(true);
      expect(mockProduct.deletedAt).toBeInstanceOf(Date);
      expect(mockProduct.deletedBy).toBe(adminId);
    });

    it('rejects deletion if product status is NOT REJECTED', async () => {
      const mockProduct = {
        _id: productId,
        status: 'PUBLISHED',
        deletedAt: null,
      };
      jest.spyOn(Product, 'findOne').mockResolvedValue(mockProduct);

      await expect(
        productService.adminDeleteProduct(productId, adminId)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_DELETE_STATUS',
      });
    });
  });

  describe('Seller Edit Approved / Published Product', () => {
    it('allows vendor to edit approved or published product, setting status to EDITED and unpublishing it', async () => {
      const mockProduct = {
        _id: productId,
        vendorId,
        name: 'Terracotta Vase',
        slug: 'terracotta-vase',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        deletedAt: null,
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(productService, 'resolveVendorIdForUser').mockResolvedValue(vendorId);
      jest.spyOn(Product, 'findOne').mockResolvedValue(mockProduct);
      jest.spyOn(Product, 'findById').mockReturnValue({
        populate: () => ({ populate: () => ({ populate: () => ({ populate: () => ({ lean: async () => ({ ...mockProduct, status: 'EDITED' }) }) }) }) }),
      });

      const updated = await productService.updateProduct(vendorUserId, productId, {
        shortDescription: 'Updated artisan handcrafted terracotta vase',
      });

      expect(mockProduct.status).toBe('EDITED');
      expect(mockProduct.publishedAt).toBeNull();
      expect(mockProduct.lastEditedBy).toBe(vendorUserId);
      expect(mockProduct.lastEditedAt).toBeInstanceOf(Date);
      expect(mockProduct.shortDescription).toBe('Updated artisan handcrafted terracotta vase');
    });
  });

  describe('Seller Delete Product', () => {
    it('allows vendor to delete own product in DRAFT, REJECTED, or UNPUBLISHED status', async () => {
      for (const validStatus of ['DRAFT', 'REJECTED', 'UNPUBLISHED']) {
        const mockProduct = {
          _id: productId,
          vendorId,
          status: validStatus,
          deletedAt: null,
          save: jest.fn().mockResolvedValue(true),
        };

        jest.spyOn(productService, 'assertVendorOwnsProduct').mockResolvedValue({ vendorId, product: mockProduct });
        jest.spyOn(VendorOrder, 'exists').mockResolvedValue(null);
        jest.spyOn(Order, 'exists').mockResolvedValue(null);
        jest.spyOn(ProductVariant, 'updateMany').mockResolvedValue({ modifiedCount: 1 });

        const result = await productService.vendorDeleteProduct(vendorUserId, productId);
        expect(result.success).toBe(true);
        expect(mockProduct.deletedAt).toBeInstanceOf(Date);
        expect(mockProduct.deletedBy).toBe(vendorUserId);
      }
    });

    it('blocks vendor from deleting a product in PUBLISHED or APPROVED status', async () => {
      const mockProduct = {
        _id: productId,
        vendorId,
        status: 'PUBLISHED',
        deletedAt: null,
      };

      jest.spyOn(productService, 'assertVendorOwnsProduct').mockResolvedValue({ vendorId, product: mockProduct });

      await expect(
        productService.vendorDeleteProduct(vendorUserId, productId)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'CANNOT_DELETE_ACTIVE_PRODUCT',
      });
    });

    it('blocks vendor from deleting a product that has existing orders', async () => {
      const mockProduct = {
        _id: productId,
        vendorId,
        status: 'UNPUBLISHED',
        deletedAt: null,
      };

      jest.spyOn(productService, 'assertVendorOwnsProduct').mockResolvedValue({ vendorId, product: mockProduct });
      jest.spyOn(VendorOrder, 'exists').mockResolvedValue({ _id: 'order-123' });
      jest.spyOn(Order, 'exists').mockResolvedValue(null);

      await expect(
        productService.vendorDeleteProduct(vendorUserId, productId)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'PRODUCT_HAS_ORDERS',
      });
    });
  });

  describe('Seller Out of Stock Operation', () => {
    it('sets available inventory to 0, status to OUT_OF_STOCK, and records InventoryMovement', async () => {
      const variantId = new mongoose.Types.ObjectId().toHexString();
      const mockProduct = {
        _id: productId,
        vendorId,
      };

      const mockVariant = {
        _id: variantId,
        productId,
        status: 'ACTIVE',
      };

      const mockInventory = {
        _id: new mongoose.Types.ObjectId().toHexString(),
        productId,
        variantId,
        availableQuantity: 25,
        status: 'ACTIVE',
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(productService, 'assertVendorOwnsProduct').mockResolvedValue({ vendorId, product: mockProduct });
      jest.spyOn(ProductVariant, 'find').mockResolvedValue([mockVariant]);
      jest.spyOn(Inventory, 'findOne').mockResolvedValue(mockInventory);
      jest.spyOn(InventoryMovement, 'create').mockResolvedValue({});

      const result = await productService.setProductOutOfStock(vendorUserId, productId);
      expect(result.success).toBe(true);
      expect(mockInventory.availableQuantity).toBe(0);
      expect(mockInventory.status).toBe('OUT_OF_STOCK');
      expect(InventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
        productId,
        variantId,
        type: 'STOCK_OUT',
        quantity: 25,
        previousAvailableQuantity: 25,
        newAvailableQuantity: 0,
        reason: 'SELLER_MARKED_OUT_OF_STOCK',
      }));
    });
  });
});
