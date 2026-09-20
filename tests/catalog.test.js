import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CategoryService } from '../app/services/category.service.js';
import { BrandService } from '../app/services/brand.service.js';
import { ProductService } from '../app/services/product.service.js';
import { Category } from '../app/models/category.model.js';
import { Brand } from '../app/models/brand.model.js';
import { Product, ProductVariant } from '../app/models/product.model.js';
import { Vendor } from '../app/models/vendor.model.js';

describe('catalog services', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects duplicate category slugs', async () => {
    jest.spyOn(Category, 'findOne').mockResolvedValue({ _id: 'cat-1' });
    const service = new CategoryService();

    await expect(service.createCategory({ name: 'Handloom', parentId: null })).rejects.toMatchObject({
      code: 'CATEGORY_SLUG_EXISTS',
    });
  });

  it('rejects duplicate brand slugs', async () => {
    jest.spyOn(Brand, 'findOne').mockResolvedValue({ _id: 'brand-1' });
    const service = new BrandService();

    await expect(service.createBrand({ name: 'Rupakar' })).rejects.toMatchObject({
      code: 'BRAND_SLUG_EXISTS',
    });
  });

  it('keeps vendor product queries scoped to the vendor owner', async () => {
    const findSpy = jest.spyOn(Product, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ vendorId: 'vendor-1' }]),
    });
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(ProductService.prototype, 'resolveVendorIdForUser').mockResolvedValue('vendor-1');

    const service = new ProductService();
    const result = await service.listForVendor('user-1', { limit: 10, page: 1 });

    expect(result.data[0].vendorId).toBe('vendor-1');
    expect(findSpy).toHaveBeenCalledWith({ vendorId: 'vendor-1', deletedAt: null });
  });

  it('applies seller product status and search filters server-side', async () => {
    const findSpy = jest.spyOn(Product, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(ProductService.prototype, 'resolveVendorIdForUser').mockResolvedValue('vendor-1');

    await new ProductService().listForVendor('user-1', { status: 'DRAFT', search: 'terracotta' });

    expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'vendor-1',
      status: 'DRAFT',
      name: { $regex: 'terracotta', $options: 'i' },
    }));
  });

  it('only returns published products in the public catalog', async () => {
    const findSpy = jest.spyOn(Product, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ status: 'PUBLISHED' }]),
    });
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(1);

    const service = new ProductService();
    const result = await service.listPublicCatalog({ limit: 10, cursor: null });

    expect(result.data.every((item) => item.status === 'PUBLISHED')).toBe(true);
    expect(findSpy).toHaveBeenCalledWith({ status: 'PUBLISHED', deletedAt: null });
  });

  it('returns a paginated public catalog with metadata', async () => {
    const items = [{ _id: 'p1', status: 'PUBLISHED' }, { _id: 'p2', status: 'PUBLISHED' }];
    jest.spyOn(Product, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(items),
    });
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(2);

    const service = new ProductService();
    const result = await service.listPublicCatalog({ limit: 1, cursor: null });

    expect(result.pagination).toMatchObject({
      hasNextPage: true,
      nextCursor: expect.any(String),
    });
    expect(result.data).toHaveLength(2);
  });

  it('rejects duplicate product SKU values before creating a variant', async () => {
    const service = new ProductService();
    jest.spyOn(service, 'resolveVendorIdForUser').mockResolvedValue('vendor-1');
    jest.spyOn(service, 'ensureVendor').mockResolvedValue({ _id: 'vendor-1' });
    jest.spyOn(Category, 'findOne').mockResolvedValue({ _id: 'cat-1', status: 'ACTIVE', deletedAt: null });
    jest.spyOn(Product, 'findOne').mockResolvedValue(null);
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue(null);
    jest.spyOn(Product, 'create').mockResolvedValue({
      _id: 'product-1',
      save: jest.fn(),
      variants: [],
      images: [],
      toObject: () => ({ _id: 'product-1' }),
    });
    jest.spyOn(ProductVariant, 'create').mockRejectedValue({ code: 11000, keyPattern: { sku: 1 } });

    await expect(service.createProduct('user-1', {
      name: 'Saree',
      categoryId: 'cat-1',
      variants: [{ sku: 'SKU-1', price: 1000 }],
    })).rejects.toMatchObject({ code: 'SKU_ALREADY_EXISTS' });
  });

  it('requires an approved vendor to create products', async () => {
    const service = new ProductService();
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(null);

    await expect(service.createProduct('customer-1', { name: 'Saree' })).rejects.toMatchObject({
      code: 'VENDOR_NOT_ALLOWED',
    });
  });

  it('does not let vendors bypass product review workflow', async () => {
    const service = new ProductService();
    jest.spyOn(service, 'resolveVendorIdForUser').mockResolvedValue('vendor-1');
    const product = {
      _id: 'product-1',
      vendorId: 'vendor-1',
      status: 'DRAFT',
      save: jest.fn(),
    };
    jest.spyOn(Product, 'findOne').mockResolvedValue(product);

    await expect(service.updateProduct('user-1', 'product-1', { status: 'APPROVED' })).rejects.toMatchObject({
      code: 'INVALID_PRODUCT_STATUS',
    });
    expect(product.save).not.toHaveBeenCalled();
  });
});
