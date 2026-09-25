import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CategoryService } from '../app/services/category.service.js';
import { BrandService } from '../app/services/brand.service.js';
import { ProductService } from '../app/services/product.service.js';
import { Category } from '../app/models/category.model.js';
import { Brand } from '../app/models/brand.model.js';
import { Product, ProductVariant } from '../app/models/product.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { inventoryService } from '../app/services/inventory.service.js';

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

  it('resolves category slug to categoryId in public catalog filtering', async () => {
    const findSpy = jest.spyOn(Product, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ status: 'PUBLISHED', categoryId: '65f1a2b3c4d5e6f7a8b9c0d1' }]),
    });
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(Category, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: '65f1a2b3c4d5e6f7a8b9c0d1', slug: 'terracotta' }),
    });

    const service = new ProductService();
    const result = await service.listPublicCatalog({ category: 'terracotta', limit: 10 });

    expect(findSpy).toHaveBeenCalledWith({
      status: 'PUBLISHED',
      deletedAt: null,
      categoryId: '65f1a2b3c4d5e6f7a8b9c0d1',
    });
    expect(result.data).toHaveLength(1);
  });

  it('queries categoryId directly when a 24-character ObjectId is provided', async () => {
    const categoryObjectId = '65f1a2b3c4d5e6f7a8b9c0d1';
    const findSpy = jest.spyOn(Product, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ status: 'PUBLISHED', categoryId: categoryObjectId }]),
    });
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(1);
    const categoryFindSpy = jest.spyOn(Category, 'findOne');

    const service = new ProductService();
    const result = await service.listPublicCatalog({ category: categoryObjectId, limit: 10 });

    expect(categoryFindSpy).not.toHaveBeenCalled();
    expect(findSpy).toHaveBeenCalledWith({
      status: 'PUBLISHED',
      deletedAt: null,
      categoryId: categoryObjectId,
    });
    expect(result.data).toHaveLength(1);
  });

  it('returns zero products and does not use regex fallback when category does not exist', async () => {
    const findSpy = jest.spyOn(Product, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest.spyOn(Product, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(Category, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const service = new ProductService();
    const result = await service.listPublicCatalog({ category: 'NonexistentCraft', limit: 10 });

    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PUBLISHED',
        deletedAt: null,
        categoryId: expect.any(Object),
      })
    );
    const calledFilter = findSpy.mock.calls[0][0];
    expect(calledFilter.$or).toBeUndefined();
    expect(result.data).toHaveLength(0);
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

  it('generates a unique SKU when the seller omits it', async () => {
    const service = new ProductService();
    const createdSkus = [];
    jest.spyOn(service, 'resolveVendorIdForUser').mockResolvedValue('vendor-1');
    jest.spyOn(service, 'ensureVendor').mockResolvedValue({ _id: 'vendor-1' });
    jest.spyOn(Category, 'findOne').mockResolvedValue({ _id: 'cat-1', name: 'Terracotta', status: 'ACTIVE', deletedAt: null });
    jest.spyOn(Product, 'findOne').mockResolvedValue(null);
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue(null);
    jest.spyOn(Product, 'create').mockResolvedValue({ _id: 'product-1', save: jest.fn(), variants: [], images: [] });
    jest.spyOn(ProductVariant, 'create').mockImplementation(async (payload) => { createdSkus.push(payload.sku); return { ...payload, _id: `variant-${createdSkus.length}` }; });
    jest.spyOn(Product, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'product-1', variants: [{ sku: createdSkus[0] }] }) });
    jest.spyOn(inventoryService, 'initializeInventory').mockResolvedValue({});

    await service.createProduct('user-1', { name: 'Hand Painted Horse', categoryId: 'cat-1', variants: [{ price: 1000 }] });

    expect(createdSkus[0]).toMatch(/^RPK-TER-HPH-[A-Z0-9]{6}$/);
  });

  it('preserves a manually supplied SKU', async () => {
    const service = new ProductService();
    jest.spyOn(service, 'resolveVendorIdForUser').mockResolvedValue('vendor-1');
    jest.spyOn(service, 'ensureVendor').mockResolvedValue({ _id: 'vendor-1' });
    jest.spyOn(Category, 'findOne').mockResolvedValue({ _id: 'cat-1', name: 'Terracotta', status: 'ACTIVE', deletedAt: null });
    jest.spyOn(Product, 'findOne').mockResolvedValue(null);
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue(null);
    jest.spyOn(Product, 'create').mockResolvedValue({ _id: 'product-1', save: jest.fn(), variants: [], images: [] });
    const createVariant = jest.spyOn(ProductVariant, 'create').mockResolvedValue({ _id: 'variant-1', sku: 'SELLER-001' });
    jest.spyOn(Product, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'product-1' }) });
    jest.spyOn(inventoryService, 'initializeInventory').mockResolvedValue({});

    await service.createProduct('user-1', { name: 'Horse', categoryId: 'cat-1', variants: [{ sku: 'seller-001', price: 1000 }] });

    expect(createVariant).toHaveBeenCalledWith(expect.objectContaining({ sku: 'SELLER-001' }));
  });

  it('generates distinct SKUs for variants and retries generated collisions', async () => {
    const service = new ProductService();
    const createdSkus = [];
    jest.spyOn(service, 'resolveVendorIdForUser').mockResolvedValue('vendor-1');
    jest.spyOn(service, 'ensureVendor').mockResolvedValue({ _id: 'vendor-1' });
    jest.spyOn(Category, 'findOne').mockResolvedValue({ _id: 'cat-1', name: 'Terracotta', status: 'ACTIVE', deletedAt: null });
    jest.spyOn(Product, 'findOne').mockResolvedValue(null);
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue(null);
    jest.spyOn(Product, 'create').mockResolvedValue({ _id: 'product-1', save: jest.fn(), variants: [], images: [] });
    jest.spyOn(ProductVariant, 'create')
      .mockRejectedValueOnce({ code: 11000, keyPattern: { sku: 1 } })
      .mockImplementation(async (payload) => { createdSkus.push(payload.sku); return { ...payload, _id: `variant-${createdSkus.length}` }; });
    jest.spyOn(Product, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'product-1' }) });
    jest.spyOn(inventoryService, 'initializeInventory').mockResolvedValue({});

    await service.createProduct('user-1', { name: 'Horse', categoryId: 'cat-1', variants: [{ price: 1000, attributes: { size: 'S' } }, { price: 1100, attributes: { size: 'M' } }] });

    expect(createdSkus).toHaveLength(2);
    expect(new Set(createdSkus).size).toBe(2);
    expect(createdSkus.every((sku) => /^RPK-TER-HOR-[SM]-[A-Z0-9]{6}$/.test(sku))).toBe(true);
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
