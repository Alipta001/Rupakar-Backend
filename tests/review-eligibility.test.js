import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import app from '../app.js';
import { env } from '../app/config/env.js';
import { Review } from '../app/models/review.model.js';
import { Product } from '../app/models/product.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';

afterEach(() => {
  jest.restoreAllMocks();
});

const createCustomerToken = (customerId) => {
  return jwt.sign({ sub: customerId, role: 'customer' }, env.JWT_ACCESS_SECRET, { expiresIn: '10m' });
};

describe('Product Review & Rating Eligibility Flow', () => {
  // Requirement 9.1: purchased + DELIVERED → review allowed
  it('allows review submission and eligibility when customer purchased product and order is DELIVERED', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      vendorId,
      name: 'Dhokra Brass Elephant',
      status: 'PUBLISHED',
      deletedAt: null,
    });
    jest.spyOn(Order, 'findOne').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      items: [{ productId, vendorId, quantity: 1 }],
      deletedAt: null,
    });
    jest.spyOn(Order, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: orderId,
            customerId,
            status: 'DELIVERED',
            paymentStatus: 'PAID',
            items: [{ productId, vendorId, quantity: 1 }],
            deletedAt: null,
          },
        ]),
      }),
    });
    jest.spyOn(Review, 'findOne').mockResolvedValue(null);
    jest.spyOn(Review, 'create').mockResolvedValue({
      _id: 'review_deliv_1',
      customerId,
      productId,
      orderId,
      vendorId,
      rating: 5,
      title: 'Superb artisan piece',
      comment: 'Arrived in great condition and beautifully made.',
      status: 'PUBLISHED',
      createdAt: new Date(),
    });

    // 1. Check eligibility endpoint
    const eligRes = await request(app)
      .get(`/api/v1/reviews/eligibility/${productId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(eligRes.status).toBe(200);
    expect(eligRes.body.data).toMatchObject({
      canReview: true,
      eligibleOrderId: orderId,
      alreadyReviewed: false,
    });

    // 2. Submit review
    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        orderId,
        rating: 5,
        title: 'Superb artisan piece',
        comment: 'Arrived in great condition and beautifully made.',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data).toMatchObject({
      customerId,
      productId,
      orderId,
      rating: 5,
    });
  });

  // Requirement 9.2: purchased + PROCESSING → review blocked
  it('blocks review submission when order is still in PROCESSING status', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      vendorId,
      name: 'Pattachitra Painting',
      status: 'PUBLISHED',
      deletedAt: null,
    });
    jest.spyOn(Order, 'findOne').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      items: [{ productId, vendorId, quantity: 1 }],
      deletedAt: null,
    });
    jest.spyOn(Order, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: orderId,
            customerId,
            status: 'PROCESSING',
            paymentStatus: 'PAID',
            items: [{ productId, vendorId, quantity: 1 }],
            deletedAt: null,
          },
        ]),
      }),
    });
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);

    // 1. Check eligibility
    const eligRes = await request(app)
      .get(`/api/v1/reviews/eligibility/${productId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(eligRes.status).toBe(200);
    expect(eligRes.body.data.canReview).toBe(false);
    expect(eligRes.body.data.reason).toBe('NOT_DELIVERED');

    // 2. Attempt create review
    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        orderId,
        rating: 5,
        title: 'Early review',
        comment: 'Has not arrived yet.',
      });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error.code).toBe('ORDER_NOT_ELIGIBLE_FOR_REVIEW');
  });

  // Requirement 9.3: purchased + SHIPPED/READY_TO_SHIP → review blocked
  it('blocks review submission when order is SHIPPED or READY_TO_SHIP', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      vendorId,
      status: 'PUBLISHED',
      deletedAt: null,
    });
    jest.spyOn(Order, 'findOne').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'SHIPPED',
      paymentStatus: 'PAID',
      items: [{ productId, vendorId, quantity: 1 }],
      deletedAt: null,
    });
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({
      parentOrderId: orderId,
      vendorId,
      status: 'SHIPPED',
    });

    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        orderId,
        rating: 4,
        title: 'Package is in transit',
        comment: 'Package shipped but not delivered yet.',
      });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error.code).toBe('ORDER_NOT_ELIGIBLE_FOR_REVIEW');
  });

  // Requirement 9.4: product not purchased → review blocked
  it('blocks review when customer has a delivered order but did not purchase this product', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const otherProductId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      vendorId,
      status: 'PUBLISHED',
      deletedAt: null,
    });
    // Order contains otherProductId, not productId
    jest.spyOn(Order, 'findOne').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      items: [{ productId: otherProductId, vendorId, quantity: 1 }],
      deletedAt: null,
    });
    jest.spyOn(Order, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });

    // 1. Eligibility check returns NOT_PURCHASED
    const eligRes = await request(app)
      .get(`/api/v1/reviews/eligibility/${productId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(eligRes.status).toBe(200);
    expect(eligRes.body.data.canReview).toBe(false);
    expect(eligRes.body.data.reason).toBe('NOT_PURCHASED');

    // 2. Submit review with this orderId
    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        orderId,
        rating: 5,
        title: 'Fake purchase review',
        comment: 'I did not buy this item.',
      });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error.code).toBe('PRODUCT_NOT_PURCHASED');
  });

  // Requirement 9.5: another customer's order → review blocked
  it('blocks customer from reviewing using an order owned by another customer', async () => {
    const customerA = new mongoose.Types.ObjectId().toHexString();
    const customerB = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const tokenB = createCustomerToken(customerB);

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      vendorId,
      status: 'PUBLISHED',
      deletedAt: null,
    });
    // Order belongs to customerA
    jest.spyOn(Order, 'findOne').mockImplementation((filter) => {
      if (filter.customerId === customerA) {
        return Promise.resolve({
          _id: orderId,
          customerId: customerA,
          status: 'DELIVERED',
          paymentStatus: 'PAID',
          items: [{ productId, vendorId, quantity: 1 }],
        });
      }
      return Promise.resolve(null);
    });

    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        productId,
        orderId,
        rating: 5,
        title: 'Reviewing customer A order',
        comment: 'Should be blocked.',
      });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error.code).toBe('ORDER_NOT_ELIGIBLE_FOR_REVIEW');
  });

  // Requirement 9.6: duplicate review → blocked
  it('blocks duplicate review submission for the same purchased product and order', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

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
      deletedAt: null,
    });
    jest.spyOn(Order, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: orderId,
            customerId,
            status: 'DELIVERED',
            paymentStatus: 'PAID',
            items: [{ productId, vendorId, quantity: 1 }],
            deletedAt: null,
          },
        ]),
      }),
    });
    // Review already exists in DB
    jest.spyOn(Review, 'findOne').mockResolvedValue({
      _id: 'existing_rev_1',
      customerId,
      productId,
      orderId,
      rating: 5,
      title: 'Previous review',
      comment: 'Already submitted.',
      toObject: function toObject() { return this; },
    });

    // 1. Eligibility reports ALREADY_REVIEWED
    const eligRes = await request(app)
      .get(`/api/v1/reviews/eligibility/${productId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(eligRes.status).toBe(200);
    expect(eligRes.body.data.canReview).toBe(false);
    expect(eligRes.body.data.alreadyReviewed).toBe(true);
    expect(eligRes.body.data.reason).toBe('ALREADY_REVIEWED');

    // 2. Submit review rejected with 409
    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        orderId,
        rating: 4,
        title: 'Duplicate review',
        comment: 'Trying to review again.',
      });

    expect(createRes.status).toBe(409);
    expect(createRes.body.error.code).toBe('REVIEW_ALREADY_EXISTS');
  });

  // Requirement 9.7: multi-vendor order with one delivered vendor → correct product eligibility
  it('allows review for delivered vendor product while blocking undelivered vendor product in multi-vendor order', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorA = new mongoose.Types.ObjectId().toHexString();
    const vendorB = new mongoose.Types.ObjectId().toHexString();
    const productA = new mongoose.Types.ObjectId().toHexString();
    const productB = new mongoose.Types.ObjectId().toHexString();
    const parentOrderId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    // Parent order has status PROCESSING because Vendor B is still preparing
    const multiVendorOrder = {
      _id: parentOrderId,
      customerId,
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      items: [
        { productId: productA, vendorId: vendorA, quantity: 1 },
        { productId: productB, vendorId: vendorB, quantity: 1 },
      ],
      deletedAt: null,
    };

    jest.spyOn(Product, 'findById').mockImplementation((id) => {
      if (String(id) === String(productA)) {
        return Promise.resolve({ _id: productA, vendorId: vendorA, name: 'Saree', status: 'PUBLISHED', deletedAt: null });
      }
      return Promise.resolve({ _id: productB, vendorId: vendorB, name: 'Clay Pot', status: 'PUBLISHED', deletedAt: null });
    });

    jest.spyOn(Order, 'findOne').mockResolvedValue(multiVendorOrder);
    jest.spyOn(Order, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([multiVendorOrder]),
      }),
    });
    jest.spyOn(Review, 'findOne').mockResolvedValue(null);
    jest.spyOn(Review, 'create').mockResolvedValue({
      _id: 'rev_mv_1',
      customerId,
      productId: productA,
      orderId: parentOrderId,
      vendorId: vendorA,
      rating: 5,
      title: 'Vendor A delivery arrived',
      comment: 'Very pleased.',
      status: 'PUBLISHED',
      createdAt: new Date(),
    });

    // VendorOrder A is DELIVERED, VendorOrder B is PROCESSING
    jest.spyOn(VendorOrder, 'findOne').mockImplementation((filter) => {
      if (String(filter.vendorId) === String(vendorA) && filter.status?.$in?.includes('DELIVERED')) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(),
          parentOrderId,
          vendorId: vendorA,
          status: 'DELIVERED',
        });
      }
      return Promise.resolve(null);
    });

    // 1. Check Product A (Vendor A - Delivered) -> Eligible!
    const eligResA = await request(app)
      .get(`/api/v1/reviews/eligibility/${productA}`)
      .set('Authorization', `Bearer ${token}`);

    expect(eligResA.status).toBe(200);
    expect(eligResA.body.data.canReview).toBe(true);

    const createResA = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId: productA,
        orderId: parentOrderId,
        rating: 5,
        title: 'Vendor A delivery arrived',
        comment: 'Very pleased.',
      });

    expect(createResA.status).toBe(201);
    expect(createResA.body.success).toBe(true);

    // 2. Check Product B (Vendor B - Processing) -> Blocked!
    const eligResB = await request(app)
      .get(`/api/v1/reviews/eligibility/${productB}`)
      .set('Authorization', `Bearer ${token}`);

    expect(eligResB.status).toBe(200);
    expect(eligResB.body.data.canReview).toBe(false);
    expect(eligResB.body.data.reason).toBe('NOT_DELIVERED');

    const createResB = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId: productB,
        orderId: parentOrderId,
        rating: 3,
        title: 'Vendor B review attempt',
        comment: 'Should be blocked.',
      });

    expect(createResB.status).toBe(403);
    expect(createResB.body.error.code).toBe('ORDER_NOT_ELIGIBLE_FOR_REVIEW');
  });

  // Requirement 9.8: manually persisted DELIVERED status → review allowed
  it('allows review when order was manually persisted to DELIVERED with PENDING payment (COD or manual update)', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      vendorId,
      name: 'Dokra Artifact',
      status: 'PUBLISHED',
      deletedAt: null,
    });
    // Manually marked DELIVERED or COD order where paymentStatus remained PENDING
    const manualOrder = {
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      paymentMethod: 'cod',
      paymentStatus: 'PENDING',
      items: [{ productId, vendorId, quantity: 1 }],
      deletedAt: null,
    };
    jest.spyOn(Order, 'findOne').mockResolvedValue(manualOrder);
    jest.spyOn(Order, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([manualOrder]),
      }),
    });
    jest.spyOn(Review, 'findOne').mockResolvedValue(null);
    jest.spyOn(Review, 'create').mockResolvedValue({
      _id: 'rev_manual_1',
      customerId,
      productId,
      orderId,
      vendorId,
      rating: 5,
      title: 'Delivered in cash',
      comment: 'Cash paid upon delivery, review accepted.',
      status: 'PUBLISHED',
      createdAt: new Date(),
    });

    const eligRes = await request(app)
      .get(`/api/v1/reviews/eligibility/${productId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(eligRes.status).toBe(200);
    expect(eligRes.body.data.canReview).toBe(true);

    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        orderId,
        rating: 5,
        title: 'Delivered in cash',
        comment: 'Cash paid upon delivery, review accepted.',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
  });

  // Requirement 9.9: backend rejects forged frontend eligibility
  it('backend rejects forged frontend review submission when order is not delivered', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      vendorId,
      status: 'PUBLISHED',
      deletedAt: null,
    });
    // Order is PACKED, not DELIVERED
    jest.spyOn(Order, 'findOne').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'PACKED',
      paymentStatus: 'PAID',
      items: [{ productId, vendorId, quantity: 1 }],
      deletedAt: null,
    });
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);

    // Malicious or forged direct POST call
    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        orderId,
        rating: 5,
        title: 'Forged review request',
        comment: 'Trying to bypass client check.',
      });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error.code).toBe('ORDER_NOT_ELIGIBLE_FOR_REVIEW');
  });
});
