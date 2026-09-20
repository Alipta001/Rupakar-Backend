import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

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
            public_id: 'products/demo-image',
            secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/products/demo-image.png',
            url: 'https://res.cloudinary.com/demo-cloud/image/upload/products/demo-image.png',
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
    url: jest.fn(() => 'https://res.cloudinary.com/demo-cloud/image/upload/products/demo-image.png'),
  },
}));

const appModule = await import('../app.js');
const app = appModule.default;
const { Product } = await import('../app/models/product.model.js');
const { ProductImage } = await import('../app/models/product.model.js');
const { Vendor } = await import('../app/models/vendor.model.js');
const { env } = await import('../app/config/env.js');

const buildToken = (sub, role = 'vendor') => jwt.sign({ sub, role }, env.JWT_ACCESS_SECRET, { expiresIn: '5m' });

afterEach(() => {
  jest.restoreAllMocks();
});

describe('product image API', () => {
  it('uploads a valid vendor product image to Cloudinary and persists metadata', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const token = buildToken(ownerUserId, 'vendor');

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
    const product = {
      _id: productId,
      vendorId,
      deletedAt: null,
      images: [],
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Product, 'findOne').mockResolvedValue(product);
    jest.spyOn(ProductImage, 'countDocuments').mockResolvedValue(0);
    jest.spyOn(ProductImage, 'findOne').mockResolvedValue(null);
    jest.spyOn(ProductImage, 'create').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      productId,
      vendorId,
      storageKey: 'products/demo-image',
      url: 'https://res.cloudinary.com/demo-cloud/image/upload/products/demo-image.png',
      altText: 'Product image',
      sortOrder: 0,
      isPrimary: true,
      width: 1200,
      height: 900,
      fileSize: 44000,
      mimeType: 'image/png',
      status: 'ACTIVE',
      toObject: () => ({
        _id: 'img_1',
        productId,
        storageKey: 'products/demo-image',
        url: 'https://res.cloudinary.com/demo-cloud/image/upload/products/demo-image.png',
        altText: 'Product image',
        sortOrder: 0,
        isPrimary: true,
        width: 1200,
        height: 900,
        fileSize: 44000,
        mimeType: 'image/png',
        status: 'ACTIVE',
      }),
    });
    jest.spyOn(Product, 'findByIdAndUpdate').mockResolvedValue({ _id: productId });

    const response = await request(app)
      .post(`/api/v1/vendor/products/${productId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('fake-image-content'), { filename: 'demo.png', contentType: 'image/png' })
      .field('altText', 'Product image');

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      storageKey: 'products/demo-image',
      url: expect.stringContaining('cloudinary.com'),
      isPrimary: true,
      status: 'ACTIVE',
    });
  });

  it('rejects unauthenticated image uploads', async () => {
    const productId = new mongoose.Types.ObjectId().toHexString();
    const response = await request(app)
      .post(`/api/v1/vendor/products/${productId}/images`)
      .attach('image', Buffer.from('fake-image-content'), { filename: 'demo.png', contentType: 'image/png' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects non-vendor image uploads', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const token = buildToken(ownerUserId, 'customer');

    const response = await request(app)
      .post(`/api/v1/vendor/products/${productId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('fake-image-content'), { filename: 'demo.png', contentType: 'image/png' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects cross-vendor image upload attempts', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const token = buildToken(ownerUserId, 'vendor');

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId: new mongoose.Types.ObjectId().toHexString(),
      deletedAt: null,
      images: [],
    });

    const response = await request(app)
      .post(`/api/v1/vendor/products/${productId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('fake-image-content'), { filename: 'demo.png', contentType: 'image/png' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('VENDOR_PRODUCT_MISMATCH');
  });

  it('rejects invalid MIME types', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const token = buildToken(ownerUserId, 'vendor');

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId,
      deletedAt: null,
      images: [],
    });

    const response = await request(app)
      .post(`/api/v1/vendor/products/${productId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('not-an-image'), { filename: 'demo.txt', contentType: 'text/plain' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_IMAGE_FILE');
  });

  it('rejects oversize images', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const token = buildToken(ownerUserId, 'vendor');

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId,
      deletedAt: null,
      images: [],
    });

    const largeBuffer = Buffer.alloc(3 * 1024 * 1024, 'a');
    const response = await request(app)
      .post(`/api/v1/vendor/products/${productId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', largeBuffer, { filename: 'huge.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_IMAGE_FILE');
  });

  it('rejects uploads when the product already has 20 images', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const token = buildToken(ownerUserId, 'vendor');

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId,
      deletedAt: null,
      images: new Array(20).fill('img'),
    });
    jest.spyOn(ProductImage, 'countDocuments').mockResolvedValue(20);

    const response = await request(app)
      .post(`/api/v1/vendor/products/${productId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('fake-image-content'), { filename: 'demo.png', contentType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IMAGE_LIMIT_REACHED');
  });

  it('deletes an image after vendor ownership validation', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const imageId = new mongoose.Types.ObjectId().toHexString();
    const token = buildToken(ownerUserId, 'vendor');

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId,
      deletedAt: null,
      images: [imageId],
    });
    const product = {
      _id: productId,
      vendorId,
      deletedAt: null,
      images: [imageId],
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Product, 'findOne').mockResolvedValue(product);
    jest.spyOn(ProductImage, 'findOne').mockResolvedValue({
      _id: imageId,
      productId,
      storageKey: 'products/demo-image',
      url: 'https://res.cloudinary.com/demo-cloud/image/upload/products/demo-image.png',
      status: 'ACTIVE',
      remove: jest.fn().mockResolvedValue(true),
    });
    jest.spyOn(ProductImage, 'deleteOne').mockResolvedValue({ acknowledged: true, deletedCount: 1 });

    const response = await request(app)
      .delete(`/api/v1/vendor/products/${productId}/images/${imageId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('rejects cross-vendor image deletion attempts', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const imageId = new mongoose.Types.ObjectId().toHexString();
    const token = buildToken(ownerUserId, 'vendor');

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId: new mongoose.Types.ObjectId().toHexString(),
      deletedAt: null,
      images: [imageId],
    });

    const response = await request(app)
      .delete(`/api/v1/vendor/products/${productId}/images/${imageId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('VENDOR_PRODUCT_MISMATCH');
  });

  it('updates primary image state and preserves only one primary image', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const primaryImageId = new mongoose.Types.ObjectId().toHexString();
    const secondaryImageId = new mongoose.Types.ObjectId().toHexString();
    const token = buildToken(ownerUserId, 'vendor');

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId, deletedAt: null, status: 'APPROVED' });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      vendorId,
      deletedAt: null,
      images: [primaryImageId, secondaryImageId],
    });
    const product = {
      _id: productId,
      vendorId,
      deletedAt: null,
      images: [primaryImageId, secondaryImageId],
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Product, 'findOne').mockResolvedValue(product);
    jest.spyOn(ProductImage, 'findOne').mockResolvedValue({
      _id: secondaryImageId,
      productId,
      isPrimary: false,
      save: jest.fn().mockResolvedValue(true),
    });
    jest.spyOn(ProductImage, 'updateMany').mockResolvedValue({ acknowledged: true, modifiedCount: 1 });

    const response = await request(app)
      .patch(`/api/v1/vendor/products/${productId}/images/${secondaryImageId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isPrimary: true, altText: 'Updated alt for hero image', sortOrder: 2 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.isPrimary).toBe(true);
  });
});
