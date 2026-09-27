import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { Product } from '../app/models/product.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { productService } from '../app/services/product.service.js';
import { notificationService } from '../app/services/notification.service.js';

describe('Customer Product Visibility & Publishing End-to-End Verification', () => {
  const adminId = new mongoose.Types.ObjectId().toHexString();
  const vendorUserId = new mongoose.Types.ObjectId().toHexString();
  const vendorId = new mongoose.Types.ObjectId().toHexString();
  const categoryId = new mongoose.Types.ObjectId().toHexString();
  const productId = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('verifies complete lifecycle: SUBMITTED -> APPROVED -> PUBLISHED -> Customer Catalog & Detail', async () => {
    // 1. Initial product state: submitted by vendor
    const mockDbProduct = {
      _id: productId,
      vendorId,
      categoryId,
      name: 'Dhokra Brass Tribal Figurine',
      slug: 'dhokra-brass-tribal-figurine',
      status: 'SUBMITTED',
      deletedAt: null,
      publishedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      variants: [
        {
          _id: new mongoose.Types.ObjectId().toHexString(),
          sku: 'DHOKRA-01',
          price: 1850,
          compareAtPrice: 2200,
          stock: 15,
          availableStock: 15,
          status: 'ACTIVE',
        },
      ],
      images: [
        {
          _id: new mongoose.Types.ObjectId().toHexString(),
          url: 'https://cdn.rupakar.com/dhokra-figurine.jpg',
          isPrimary: true,
          status: 'ACTIVE',
        },
      ],
      save: jest.fn(async function () {
        return this;
      }),
      toObject: function () {
        return { ...this };
      },
    };

    jest.spyOn(Product, 'findById').mockResolvedValue(mockDbProduct);
    jest.spyOn(productService, 'getByIdForAdmin').mockImplementation(async () => ({
      ...mockDbProduct,
      status: mockDbProduct.status,
      publishedAt: mockDbProduct.publishedAt,
    }));

    jest.spyOn(Vendor, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId }),
      }),
    });

    jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

    // Step A: Admin approves the product
    await productService.setProductStatus(productId, 'APPROVED', adminId);

    // MongoDB status confirmed as APPROVED
    expect(mockDbProduct.status).toBe('APPROVED');
    expect(mockDbProduct.reviewedBy).toBe(adminId);
    expect(mockDbProduct.publishedAt).toBeNull();

    // Step B: Public catalog visibility query analysis
    // When requesting status=APPROVED explicitly, the public query honors APPROVED
    const approvedFindSpy = jest.spyOn(Product, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: productId,
          name: mockDbProduct.name,
          slug: mockDbProduct.slug,
          status: 'APPROVED',
          variants: mockDbProduct.variants,
          images: mockDbProduct.images,
        },
      ]),
    });
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(1);

    const approvedList = await productService.listPublicCatalog({ status: 'APPROVED' });
    expect(approvedFindSpy).toHaveBeenCalledWith({ status: 'APPROVED', deletedAt: null });
    expect(approvedList.data).toHaveLength(1);
    expect(approvedList.data[0].id).toBe(productId);

    // Default public catalog enforces PUBLISHED status according to business rules
    approvedFindSpy.mockClear();
    await productService.listPublicCatalog();
    expect(approvedFindSpy).toHaveBeenCalledWith({ status: 'PUBLISHED', deletedAt: null });

    // Step C: Admin publishes the product
    await productService.setProductStatus(productId, 'PUBLISHED', adminId);

    // MongoDB status confirmed as PUBLISHED with publishedAt timestamp
    expect(mockDbProduct.status).toBe('PUBLISHED');
    expect(mockDbProduct.publishedAt).toBeInstanceOf(Date);

    // Step D: Public catalog now returns the published product by default
    const publishedDoc = {
      _id: productId,
      name: mockDbProduct.name,
      slug: mockDbProduct.slug,
      status: 'PUBLISHED',
      publishedAt: mockDbProduct.publishedAt,
      variants: mockDbProduct.variants,
      images: mockDbProduct.images,
    };

    jest.spyOn(Product, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([publishedDoc]),
    });
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(1);

    const catalogResult = await productService.listPublicCatalog();
    expect(catalogResult.data).toHaveLength(1);
    const catalogItem = catalogResult.data[0];
    expect(catalogItem.id).toBe(productId);
    expect(catalogItem.price).toBe(1850);
    expect(catalogItem.image).toBe('https://cdn.rupakar.com/dhokra-figurine.jpg');

    // Step E: Direct request by slug and by ID through public API
    jest.spyOn(Product, 'findOne').mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(publishedDoc),
    });

    const bySlug = await productService.getPublicBySlug('dhokra-brass-tribal-figurine');
    const byId = await productService.getPublicBySlug(productId);

    expect(bySlug.id).toBe(productId);
    expect(byId.id).toBe(productId);
    expect(bySlug.status).toBe('PUBLISHED');
    expect(byId.status).toBe('PUBLISHED');
    expect(bySlug.price).toBe(catalogItem.price);
    expect(bySlug.image).toBe(catalogItem.image);
  });
});
