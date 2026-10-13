import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';
import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';

process.env.NODE_ENV = 'test';
process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
process.env.CLOUDINARY_API_KEY = 'demo-key';
process.env.CLOUDINARY_API_SECRET = 'demo-secret';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

jest.unstable_mockModule('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn((_options, callback) => {
        const stream = {
          end: () => callback(null, {
            public_id: 'products/bulk-demo-image',
            secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/products/bulk-demo-image.png',
            url: 'https://res.cloudinary.com/demo-cloud/image/upload/products/bulk-demo-image.png',
            width: 1200,
            height: 900,
            bytes: 44000,
            format: 'png',
            resource_type: 'image',
          }),
        };
        return stream;
      }),
      destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
    },
    url: jest.fn(() => 'https://res.cloudinary.com/demo-cloud/image/upload/products/bulk-demo-image.png'),
  },
}));

const appModule = await import('../app.js');
const app = appModule.default;
const { Product, ProductImage } = await import('../app/models/product.model.js');
const { ProductVariant } = await import('../app/models/product-variant.model.js');
const { Category } = await import('../app/models/category.model.js');
const { Brand } = await import('../app/models/brand.model.js');
const { Vendor } = await import('../app/models/vendor.model.js');
const { Inventory } = await import('../app/models/inventory.model.js');
const { BulkUploadBatch } = await import('../app/models/bulk-upload-batch.model.js');
const { inventoryService } = await import('../app/services/inventory.service.js');
const { env } = await import('../app/config/env.js');

const buildToken = (sub, role = 'vendor') => jwt.sign({ sub, role }, env.JWT_ACCESS_SECRET, { expiresIn: '5m' });

// Valid 1x1 PNG buffer with valid magic bytes
const VALID_PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// Valid JPEG buffer with valid magic bytes
const VALID_JPEG_BUFFER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

describe('Bulk Product Upload API', () => {
  const mockBatches = new Map();
  const mockProducts = [];

  beforeEach(() => {
    mockBatches.clear();
    mockProducts.length = 0;

    // In-memory mock for BulkUploadBatch
    jest.spyOn(BulkUploadBatch, 'create').mockImplementation(async (data) => {
      const doc = {
        ...data,
        _id: new mongoose.Types.ObjectId(),
        save: jest.fn().mockImplementation(async function () {
          mockBatches.set(this.batchId, this);
          return this;
        }),
      };
      mockBatches.set(doc.batchId, doc);
      return doc;
    });

    jest.spyOn(BulkUploadBatch, 'findOne').mockImplementation((filter) => {
      const batch = mockBatches.get(filter?.batchId);
      if (!batch) {
        return {
          lean: jest.fn().mockResolvedValue(null),
          then: (resolve) => resolve(null),
        };
      }
      if (filter.vendorId && String(batch.vendorId) !== String(filter.vendorId)) {
        return {
          lean: jest.fn().mockResolvedValue(null),
          then: (resolve) => resolve(null),
        };
      }
      return {
        ...batch,
        save: jest.fn().mockImplementation(async function () {
          mockBatches.set(this.batchId, this);
          return this;
        }),
        lean: jest.fn().mockResolvedValue({ ...batch }),
        then: (resolve) => resolve(batch),
      };
    });

    jest.spyOn(BulkUploadBatch, 'find').mockImplementation(() => {
      const items = Array.from(mockBatches.values());
      const chain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(items),
      };
      return chain;
    });

    jest.spyOn(BulkUploadBatch, 'countDocuments').mockImplementation(async () => mockBatches.size);

    // Mock Product creation
    jest.spyOn(Product, 'create').mockImplementation(async (data) => {
      const prod = {
        ...data,
        _id: new mongoose.Types.ObjectId(),
        save: jest.fn().mockResolvedValue(true),
      };
      mockProducts.push(prod);
      return prod;
    });

    jest.spyOn(Product, 'findOne').mockImplementation(async (filter) => {
      if (filter?.slug) {
        return mockProducts.find((p) => p.slug === filter.slug) || null;
      }
      return null;
    });

    jest.spyOn(ProductVariant, 'create').mockImplementation(async (data) => ({
      ...data,
      _id: new mongoose.Types.ObjectId(),
    }));

    jest.spyOn(ProductImage, 'create').mockImplementation(async (data) => ({
      ...data,
      _id: new mongoose.Types.ObjectId(),
    }));

    jest.spyOn(inventoryService, 'initializeInventory').mockResolvedValue(true);
    jest.spyOn(Inventory, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/v1/vendor/products/bulk/template', () => {
    it('downloads CSV template with Bengal artisan sample products and headers', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      const response = await request(app)
        .get('/api/v1/vendor/products/bulk/template?format=csv')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('rupakar-product-upload-template.csv');
      expect(response.text).toContain('Product Name');
      expect(response.text).toContain('SKU');
      expect(response.text).toContain('Category');
      expect(response.text).toContain('Price');
      expect(response.text).toContain('Bankura Terracotta');
      expect(response.text).toContain('Bishnupur Baluchari');
    });

    it('downloads XLSX template with multiple sheets and styling', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Category, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ name: 'Terracotta & Clay', slug: 'terracotta-clay' }]),
        }),
      });

      const response = await request(app)
        .get('/api/v1/vendor/products/bulk/template?format=xlsx')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('spreadsheetml');
      expect(response.headers['content-disposition']).toContain('rupakar-product-upload-template.xlsx');
    });
  });

  describe('POST /api/v1/vendor/products/bulk/validate', () => {
    it('validates a valid CSV with matching SKU images in ZIP without creating products', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const catId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
      jest.spyOn(Category, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: catId, name: 'Terracotta & Clay', slug: 'terracotta-clay', status: 'ACTIVE', deletedAt: null },
        ]),
      });
      jest.spyOn(Brand, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(ProductVariant, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });

      // Prepare ZIP with SKU images: RUP-TERR-101_1.jpg (Primary), RUP-TERR-101_2.png (Additional)
      const zip = new AdmZip();
      zip.addFile('RUP-TERR-101_1.jpg', VALID_JPEG_BUFFER);
      zip.addFile('RUP-TERR-101_2.png', VALID_PNG_BUFFER);
      const zipBuffer = zip.toBuffer();

      const csvContent = [
        'Product Name,SKU,Category,Price,Stock Quantity,Origin District,GI Reference',
        '"Bankura Terracotta Horse (10-inch)",RUP-TERR-101,"Terracotta & Clay",1250,20,"Bankura","GI-WB-01"',
      ].join('\n');

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from(csvContent), 'products.csv')
        .attach('zip', zipBuffer, 'images.zip');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.totalRows).toBe(1);
      expect(response.body.data.validRowsCount).toBe(1);
      expect(response.body.data.invalidRowsCount).toBe(0);
      expect(response.body.data.rows[0].isValid).toBe(true);
      expect(response.body.data.rows[0].sku).toBe('RUP-TERR-101');
      expect(response.body.data.rows[0].matchedImages).toHaveLength(2);
      expect(response.body.data.rows[0].matchedImages[0].isPrimary).toBe(true);
      expect(response.body.data.rows[0].matchedImages[0].filename).toBe('RUP-TERR-101_1.jpg');

      // Verify no Product was created during preview/validation
      expect(mockProducts).toHaveLength(0);
    });

    it('validates a valid XLSX spreadsheet buffer', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const catId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
      jest.spyOn(Category, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: catId, name: 'Dokra Craft', slug: 'dokra-craft', status: 'ACTIVE', deletedAt: null },
        ]),
      });
      jest.spyOn(Brand, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(ProductVariant, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });

      // Build XLSX workbook
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Products');
      sheet.addRow(['Product Name', 'SKU', 'Category', 'Price', 'Stock Quantity']);
      sheet.addRow(['Bikna Dokra Owl Figurine', 'RUP-DOKR-001', 'Dokra Craft', 1800, 15]);
      const xlsxBuffer = await workbook.xlsx.writeBuffer();

      const zip = new AdmZip();
      zip.addFile('RUP-DOKR-001_1.jpg', VALID_JPEG_BUFFER);
      const zipBuffer = zip.toBuffer();

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from(xlsxBuffer), 'products.xlsx')
        .attach('zip', zipBuffer, 'images.zip');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.validRowsCount).toBe(1);
      expect(response.body.data.rows[0].sku).toBe('RUP-DOKR-001');
    });

    it('rejects legacy .xls files with helpful guidance', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from('fake xls content'), 'legacy_products.xls');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('UNSUPPORTED_FORMAT');
      expect(response.body.error.message).toContain('.xlsx or .csv');
    });

    it('flags row-level errors for missing fields, invalid price, and missing primary image', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
      jest.spyOn(Category, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(Brand, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(ProductVariant, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });

      const csvContent = [
        'Product Name,SKU,Category,Price,Stock Quantity',
        ',RUP-ERR-001,"Nonexistent Category",-50,-2',
      ].join('\n');

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from(csvContent), 'invalid.csv');

      expect(response.status).toBe(200);
      expect(response.body.data.totalRows).toBe(1);
      expect(response.body.data.invalidRowsCount).toBe(1);
      const row = response.body.data.rows[0];
      expect(row.isValid).toBe(false);
      expect(row.errors.some((e) => e.field === 'name')).toBe(true);
      expect(row.errors.some((e) => e.field === 'category')).toBe(true);
      expect(row.errors.some((e) => e.field === 'price')).toBe(true);
      expect(row.errors.some((e) => e.field === 'stock')).toBe(true);
      expect(row.errors.some((e) => e.field === 'images')).toBe(true);
    });

    it('detects duplicate SKUs within the same spreadsheet batch', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const catId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
      jest.spyOn(Category, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: catId, name: 'Kantha Stitch', slug: 'kantha-stitch', status: 'ACTIVE' },
        ]),
      });
      jest.spyOn(Brand, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(ProductVariant, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });

      const zip = new AdmZip();
      zip.addFile('RUP-DUP-001_1.jpg', VALID_JPEG_BUFFER);
      const zipBuffer = zip.toBuffer();

      const csvContent = [
        'Product Name,SKU,Category,Price,Stock Quantity',
        '"Kantha Stole Option A",RUP-DUP-001,"Kantha Stitch",950,5',
        '"Kantha Stole Option B",RUP-DUP-001,"Kantha Stitch",1100,8',
      ].join('\n');

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from(csvContent), 'duplicates.csv')
        .attach('zip', zipBuffer, 'images.zip');

      expect(response.status).toBe(200);
      expect(response.body.data.rows[0].errors.some((e) => e.message.includes('Duplicate SKU'))).toBe(true);
      expect(response.body.data.rows[1].errors.some((e) => e.message.includes('Duplicate SKU'))).toBe(true);
    });

    it('detects duplicate SKU against existing products in database', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
      jest.spyOn(Category, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(Brand, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(ProductVariant, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ sku: 'EXISTING-SKU-99' }]),
        }),
      });

      const csvContent = [
        'Product Name,SKU,Category,Price,Stock Quantity',
        '"Product with taken SKU",EXISTING-SKU-99,"Terracotta",500,10',
      ].join('\n');

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from(csvContent), 'existing.csv');

      expect(response.status).toBe(200);
      expect(response.body.data.rows[0].errors.some((e) => e.message.includes('already exists in the marketplace'))).toBe(true);
    });

    it('rejects corrupt/unsupported images with invalid magic bytes inside ZIP', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
      jest.spyOn(Category, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(Brand, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(ProductVariant, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });

      const zip = new AdmZip();
      zip.addFile('RUP-TEST-001_1.jpg', Buffer.from('NOT AN IMAGE HEADER CONTENT'));
      const zipBuffer = zip.toBuffer();

      const csvContent = [
        'Product Name,SKU,Category,Price,Stock Quantity',
        '"Valid Product",RUP-TEST-001,"Terracotta",500,10',
      ].join('\n');

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from(csvContent), 'test.csv')
        .attach('zip', zipBuffer, 'images.zip');

      expect(response.status).toBe(200);
      expect(response.body.data.extractionErrors).toHaveLength(1);
      expect(response.body.data.extractionErrors[0].error).toContain('Invalid or unsupported image format');
    });

    it('detects and flags path traversal in ZIP archive entries', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
      jest.spyOn(Category, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(Brand, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(ProductVariant, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });

      const zip = new AdmZip();
      zip.addFile('passwd.jpg', VALID_JPEG_BUFFER);
      zip.getEntries()[0].entryName = '../../etc/passwd.jpg';
      const zipBuffer = zip.toBuffer();

      const csvContent = [
        'Product Name,SKU,Category,Price,Stock Quantity',
        '"Test Product",RUP-SEC-001,"Terracotta",500,10',
      ].join('\n');

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from(csvContent), 'test.csv')
        .attach('zip', zipBuffer, 'images.zip');

      expect(response.status).toBe(200);
      expect(response.body.data.extractionErrors.some((e) => e.error.includes('Path traversal'))).toBe(true);
    });

    it('rejects unauthenticated requests to validate endpoint', async () => {
      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .attach('spreadsheet', Buffer.from('name,sku\ntest,1'), 'products.csv');

      expect(response.status).toBe(401);
    });

    it('rejects non-vendor users from validating batches', async () => {
      const customerUserId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(customerUserId, 'customer');

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from('name,sku\ntest,1'), 'products.csv');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /api/v1/vendor/products/bulk/submit', () => {
    it('supports partial submission: creates only valid products, sets SUBMITTED status and preserves admin approval workflow', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const catId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
      jest.spyOn(Category, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: catId, name: 'Terracotta & Clay', slug: 'terracotta-clay', status: 'ACTIVE' },
        ]),
      });
      jest.spyOn(Brand, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      jest.spyOn(ProductVariant, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      jest.spyOn(ProductVariant, 'findOne').mockResolvedValue(null);

      // 1. Prepare batch with 1 valid row and 1 invalid row
      const zip = new AdmZip();
      zip.addFile('RUP-VALID-01_1.jpg', VALID_JPEG_BUFFER);
      const zipBuffer = zip.toBuffer();

      const csvContent = [
        'Product Name,SKU,Category,Price,Stock Quantity',
        '"Authentic Terracotta Plate",RUP-VALID-01,"Terracotta & Clay",650,30',
        ',RUP-INVALID-02,"Terracotta & Clay",-10,0',
      ].join('\n');

      const validateRes = await request(app)
        .post('/api/v1/vendor/products/bulk/validate')
        .set('Authorization', `Bearer ${token}`)
        .attach('spreadsheet', Buffer.from(csvContent), 'partial.csv')
        .attach('zip', zipBuffer, 'images.zip');

      expect(validateRes.status).toBe(200);
      const { batchId } = validateRes.body.data;
      expect(validateRes.body.data.validRowsCount).toBe(1);
      expect(validateRes.body.data.invalidRowsCount).toBe(1);

      // 2. Submit the batch
      const submitRes = await request(app)
        .post('/api/v1/vendor/products/bulk/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ batchId });

      expect(submitRes.status).toBe(200);
      expect(submitRes.body.success).toBe(true);
      expect(submitRes.body.data.newlySubmitted).toBe(1);
      expect(submitRes.body.data.status).toBe('PARTIALLY_COMPLETED');

      // 3. Verify created product has SUBMITTED status (admin approval workflow)
      expect(mockProducts).toHaveLength(1);
      const createdProduct = mockProducts[0];
      expect(createdProduct.status).toBe('SUBMITTED');
      expect(createdProduct.name).toBe('Authentic Terracotta Plate');
      expect(createdProduct.vendorId.toString()).toBe(vendorId.toString());

      // 4. Verify idempotent retry does not re-create already submitted product
      const retryRes = await request(app)
        .post('/api/v1/vendor/products/bulk/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ batchId });

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.data.newlySubmitted).toBe(0);
      expect(mockProducts).toHaveLength(1);
    });

    it('rejects cross-vendor batch submission attempts', async () => {
      const vendorUserB = new mongoose.Types.ObjectId().toHexString();
      const vendorIdA = new mongoose.Types.ObjectId().toHexString();
      const vendorIdB = new mongoose.Types.ObjectId().toHexString();
      const tokenB = buildToken(vendorUserB, 'vendor');

      // Batch belongs to Vendor A
      mockBatches.set('bulk_test_cross_vendor', {
        batchId: 'bulk_test_cross_vendor',
        vendorId: vendorIdA,
        status: 'VALIDATED',
        totalRows: 1,
        validRowsCount: 1,
        rows: [],
      });

      // Vendor B attempts to submit Vendor A's batch
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorIdB, ownerUserId: vendorUserB, deletedAt: null, status: 'APPROVED' });

      const response = await request(app)
        .post('/api/v1/vendor/products/bulk/submit')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ batchId: 'bulk_test_cross_vendor' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('BATCH_NOT_FOUND');
    });
  });

  describe('Batch Tracking and Error Reports', () => {
    it('retrieves batch details and generates CSV error report', async () => {
      const ownerUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId().toHexString();
      const token = buildToken(ownerUserId, 'vendor');

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });

      mockBatches.set('bulk_tracking_test_123', {
        batchId: 'bulk_tracking_test_123',
        vendorId,
        originalSpreadsheetName: 'my_upload.csv',
        status: 'PARTIALLY_COMPLETED',
        totalRows: 2,
        validRowsCount: 1,
        invalidRowsCount: 1,
        submittedCount: 1,
        failedCount: 0,
        rows: [
          {
            rowNumber: 2,
            sku: 'RUP-OK-01',
            name: 'Valid Handicraft',
            isValid: true,
            status: 'SUBMITTED',
            errors: [],
          },
          {
            rowNumber: 3,
            sku: 'RUP-BAD-02',
            name: 'Invalid Handicraft',
            isValid: false,
            status: 'INVALID',
            errors: [{ field: 'price', message: 'Price must be greater than 0' }],
          },
        ],
      });

      // 1. Fetch batch details
      const detailRes = await request(app)
        .get('/api/v1/vendor/products/bulk/batches/bulk_tracking_test_123')
        .set('Authorization', `Bearer ${token}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.batchId).toBe('bulk_tracking_test_123');
      expect(detailRes.body.data.validRowsCount).toBe(1);
      expect(detailRes.body.data.invalidRowsCount).toBe(1);

      // 2. Fetch batches list
      const listRes = await request(app)
        .get('/api/v1/vendor/products/bulk/batches')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.items).toBeDefined();
      expect(listRes.body.data.items.length).toBeGreaterThan(0);

      // 3. Download error report
      const errorReportRes = await request(app)
        .get('/api/v1/vendor/products/bulk/batches/bulk_tracking_test_123/errors')
        .set('Authorization', `Bearer ${token}`);

      expect(errorReportRes.status).toBe(200);
      expect(errorReportRes.headers['content-type']).toContain('text/csv');
      expect(errorReportRes.headers['content-disposition']).toContain('bulk-upload-bulk_tracking_test_123-errors.csv');
      expect(errorReportRes.text).toContain('Row Number');
      expect(errorReportRes.text).toContain('RUP-BAD-02');
      expect(errorReportRes.text).toContain('Price must be greater than 0');
    });
  });
});
