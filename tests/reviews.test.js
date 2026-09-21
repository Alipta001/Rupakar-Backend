import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import app from '../app.js';
import { env } from '../app/config/env.js';
import { Review } from '../app/models/review.model.js';
import { Product } from '../app/models/product.model.js';
import { Order } from '../app/models/order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { reviewService } from '../app/services/review.service.js';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('review API', () => {
  it('lists published product reviews publicly with a rating summary', async () => {
    const productId = new mongoose.Types.ObjectId().toHexString();
    const reviewRow = {
      _id: new mongoose.Types.ObjectId(),
      customerId: { name: 'Asha Customer' },
      productId,
      orderId: new mongoose.Types.ObjectId(),
      vendorId: new mongoose.Types.ObjectId(),
      rating: 5,
      title: 'Beautiful piece',
      comment: 'The finish is lovely.',
      status: 'PUBLISHED',
      createdAt: new Date(),
      toObject: function toObject() { return this; },
    };

    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId, status: 'PUBLISHED', deletedAt: null });
    jest.spyOn(Review, 'find').mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([reviewRow]) }),
    });
    jest.spyOn(Review, 'countDocuments').mockImplementation(async (filter) => filter.rating ? (filter.rating === 5 ? 1 : 0) : 1);

    const response = await request(app).get(`/api/v1/reviews/product/${productId}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      total: 1,
      averageRating: 5,
      items: [expect.objectContaining({ reviewerName: 'Asha Customer', rating: 5 })],
    });
  });

  it('allows authenticated customers to create a review after purchase', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const token = jwt.sign({ sub: customerId, role: 'customer' }, env.JWT_ACCESS_SECRET, { expiresIn: '1m' });

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      vendorId,
      status: 'PUBLISHED',
      deletedAt: null,
    });
    jest.spyOn(Order, 'findOne').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      items: [{ productId, vendorId, quantity: 1 }],
    });
    jest.spyOn(Review, 'findOne').mockResolvedValue(null);
    jest.spyOn(Review, 'create').mockResolvedValue({
      _id: 'review_1',
      customerId,
      productId,
      orderId,
      rating: 5,
      title: 'Beautiful craft',
      comment: 'Loved the handmade quality',
      status: 'PUBLISHED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        orderId,
        rating: 5,
        title: 'Beautiful craft',
        comment: 'Loved the handmade quality',
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      customerId,
      productId,
      orderId,
      rating: 5,
      title: 'Beautiful craft',
    });
    expect(Review.create).toHaveBeenCalledWith(expect.objectContaining({
      customerId,
      productId,
      orderId,
      rating: 5,
      status: 'PUBLISHED',
    }));
  });

  it('rejects unauthenticated access to review endpoints', async () => {
    const response = await request(app)
      .get('/api/v1/reviews');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('vendor listing only includes reviews for the vendor\'s own products', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const ownProductId = new mongoose.Types.ObjectId().toHexString();
    const otherVendorProductId = new mongoose.Types.ObjectId().toHexString();
    const reviewRow = {
      _id: 'review_2',
      customerId: new mongoose.Types.ObjectId().toHexString(),
      productId: ownProductId,
      orderId: new mongoose.Types.ObjectId().toHexString(),
      rating: 4,
      title: 'Good quality',
      comment: 'Well crafted',
      status: 'PUBLISHED',
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject: () => ({
        _id: 'review_2',
        customerId: new mongoose.Types.ObjectId().toHexString(),
        productId: ownProductId,
        orderId: new mongoose.Types.ObjectId().toHexString(),
        rating: 4,
        title: 'Good quality',
        comment: 'Well crafted',
        status: 'PUBLISHED',
      }),
    };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId,
      status: 'APPROVED',
      deletedAt: null,
    });
    jest.spyOn(Product, 'find').mockReturnValue({
      distinct: jest.fn().mockResolvedValue([ownProductId]),
    });
    jest.spyOn(Review, 'find').mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([reviewRow]),
      lean: jest.fn().mockResolvedValue([reviewRow]),
    });
    jest.spyOn(Review, 'countDocuments').mockResolvedValue(1);

    const result = await reviewService.listVendorReviews(ownerUserId, { page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].productId).toBe(String(ownProductId));
    expect(Review.find).toHaveBeenCalledWith(expect.objectContaining({
      productId: { $in: [ownProductId] },
    }));
    expect(String(Review.find.mock.calls[0][0].productId.$in[0])).not.toBe(String(otherVendorProductId));
  });

  it('applies pagination to vendor review lists', async () => {
    const ownerUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const ownProductId = new mongoose.Types.ObjectId().toHexString();
    const query = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId,
      status: 'APPROVED',
      deletedAt: null,
    });
    jest.spyOn(Product, 'find').mockReturnValue({
      distinct: jest.fn().mockResolvedValue([ownProductId]),
    });
    jest.spyOn(Review, 'find').mockReturnValue(query);
    jest.spyOn(Review, 'countDocuments').mockResolvedValue(2);

    const result = await reviewService.listVendorReviews(ownerUserId, { page: 2, limit: 10 });

    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(2);
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.limit).toHaveBeenCalledWith(10);
  });
});
