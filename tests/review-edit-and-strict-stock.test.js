import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import app from '../app.js';
import { env } from '../app/config/env.js';
import { Review } from '../app/models/review.model.js';
import { Product } from '../app/models/product.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { Order } from '../app/models/order.model.js';
import { Cart } from '../app/models/cart.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { InventoryReservation } from '../app/models/inventory-reservation.model.js';
import { cartService } from '../app/services/cart.service.js';
import { pricingService } from '../app/services/pricing.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { orderService } from '../app/services/order.service.js';

afterEach(() => {
  jest.restoreAllMocks();
});

const createCustomerToken = (customerId) => {
  return jwt.sign({ sub: customerId, role: 'customer' }, env.JWT_ACCESS_SECRET, { expiresIn: '10m' });
};

describe('Amazon/Flipkart Review Editing & Separate Order Reviews', () => {
  it('allows customer to edit their existing review rating, title, and comment', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const reviewId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    const mockReview = {
      _id: reviewId,
      customerId,
      productId: new mongoose.Types.ObjectId().toHexString(),
      orderId: new mongoose.Types.ObjectId().toHexString(),
      vendorId: new mongoose.Types.ObjectId().toHexString(),
      rating: 4,
      title: 'Original Title',
      comment: 'Original comment',
      status: 'PUBLISHED',
      save: jest.fn().mockResolvedValue(true),
      toObject() {
        return {
          _id: this._id,
          customerId: this.customerId,
          productId: this.productId,
          orderId: this.orderId,
          vendorId: this.vendorId,
          rating: this.rating,
          title: this.title,
          comment: this.comment,
          status: this.status,
        };
      },
    };

    jest.spyOn(Review, 'findById').mockResolvedValue(mockReview);

    const res = await request(app)
      .put(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        rating: 5,
        title: 'Updated Excellent Product',
        comment: 'Updated long detailed positive review after using for 2 weeks.',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.title).toBe('Updated Excellent Product');
    expect(mockReview.save).toHaveBeenCalled();
  });

  it('rejects editing another customer’s review with 403 FORBIDDEN', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const otherCustomerId = new mongoose.Types.ObjectId().toHexString();
    const reviewId = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    const mockReview = {
      _id: reviewId,
      customerId: otherCustomerId,
      productId: new mongoose.Types.ObjectId().toHexString(),
      orderId: new mongoose.Types.ObjectId().toHexString(),
      rating: 3,
      title: 'Other Title',
      comment: 'Other comment',
      save: jest.fn(),
    };

    jest.spyOn(Review, 'findById').mockResolvedValue(mockReview);

    const res = await request(app)
      .put(`/api/v1/reviews/${reviewId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        rating: 5,
        title: 'Malicious Hijack',
        comment: 'Attempting to change someone else review.',
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockReview.save).not.toHaveBeenCalled();
  });

  it('allows separate reviews for separate delivered orders of the same product', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderId1 = new mongoose.Types.ObjectId().toHexString();
    const orderId2 = new mongoose.Types.ObjectId().toHexString();
    const token = createCustomerToken(customerId);

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      vendorId,
      name: 'Madhubani Handpainted Box',
      status: 'PUBLISHED',
      deletedAt: null,
    });

    // Customer has 2 orders: order 1 is already reviewed; order 2 is delivered and not yet reviewed
    const order2 = {
      _id: orderId2,
      customerId,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      items: [{ productId, vendorId, quantity: 1 }],
      deletedAt: null,
    };
    const order1 = {
      _id: orderId1,
      customerId,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      items: [{ productId, vendorId, quantity: 1 }],
      deletedAt: null,
    };

    jest.spyOn(Order, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([order2, order1]),
      }),
    });

    // Mock existing review for order1, but null for order2
    jest.spyOn(Review, 'findOne').mockImplementation(({ orderId }) => {
      if (String(orderId) === String(orderId1)) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId().toHexString(),
          customerId,
          productId,
          orderId: orderId1,
          rating: 4,
          title: 'Review for order 1',
          comment: 'Good product in first order',
          toObject: () => ({ _id: 'r1' }),
        });
      }
      return Promise.resolve(null);
    });

    // Check eligibility: should detect order2 is eligible and unreviewed!
    const eligRes = await request(app)
      .get(`/api/v1/reviews/eligibility/${productId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(eligRes.status).toBe(200);
    expect(eligRes.body.data.canReview).toBe(true);
    expect(eligRes.body.data.eligibleOrderId).toBe(orderId2);
    expect(eligRes.body.data.alreadyReviewed).toBe(false);

    // Create review for order2
    jest.spyOn(Order, 'findOne').mockResolvedValue(order2);
    jest.spyOn(Review, 'create').mockResolvedValue({
      _id: new mongoose.Types.ObjectId().toHexString(),
      customerId,
      productId,
      orderId: orderId2,
      vendorId,
      rating: 5,
      title: 'Review for order 2',
      comment: 'Second purchase was even better',
      toObject() {
        return {
          _id: this._id,
          customerId,
          productId,
          orderId: orderId2,
          vendorId,
          rating: 5,
          title: 'Review for order 2',
          comment: 'Second purchase was even better',
        };
      },
    });

    const createRes = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({
        productId,
        orderId: orderId2,
        rating: 5,
        title: 'Review for order 2',
        comment: 'Second purchase was even better',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data.orderId).toBe(orderId2);
  });
});

describe('Strict Stock & Quantity Enforcement Across All Flows', () => {
  it('rejects adding to cart when requested quantity exceeds available stock with "Only X items are available."', async () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      status: 'PUBLISHED',
      deletedAt: null,
      name: 'Blue Pottery Vase',
    });
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      sku: 'BPV-01',
      status: 'ACTIVE',
      price: 1200,
    });
    // Available stock = 2
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(2);

    // Requested = 3
    await expect(
      cartService.addItem({ userId, productId, variantId, quantity: 3 })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: 'Only 2 items are available.',
    });
  });

  it('rejects adding to cart when (cart quantity + newly requested quantity) exceeds available stock', async () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      status: 'PUBLISHED',
      deletedAt: null,
      name: 'Blue Pottery Vase',
    });
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      sku: 'BPV-01',
      status: 'ACTIVE',
      price: 1200,
    });
    // Available stock = 2
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(2);

    // Cart already has 1 item
    jest.spyOn(Cart, 'findOne').mockResolvedValue({
      userId,
      items: [{ productId, variantId, quantity: 1 }],
      save: jest.fn(),
    });

    // Trying to add 2 more (1 existing + 2 requested = 3 > 2 available)
    await expect(
      cartService.addItem({ userId, productId, variantId, quantity: 2 })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: 'Only 2 items are available.',
    });
  });

  it('rejects cart quantity update when exceeding available stock', async () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      status: 'ACTIVE',
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(2);

    jest.spyOn(Cart, 'findOne').mockResolvedValue({
      userId,
      items: [{ variantId, quantity: 1 }],
      save: jest.fn(),
    });

    // Update quantity to 4 when stock is 2
    await expect(
      cartService.updateItemQuantity({ userId, variantId, quantity: 4 })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: 'Only 2 items are available.',
    });
  });

  it('rejects checkout price summary when stock changed and is now insufficient', async () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      status: 'ACTIVE',
      price: 500,
      sku: 'SKU-1',
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      status: 'PUBLISHED',
      deletedAt: null,
      name: 'Handcrafted Lamp',
    });
    // Stock is 1, but checkout item quantity is 2
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(1);

    await expect(
      pricingService.buildPriceSummary({
        userId,
        items: [{ productId, variantId, quantity: 2 }],
      })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: 'Only 1 items are available.',
    });
  });

  it('rejects order creation if stock dropped before order placement', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();

    // pricing service says 2 available, but inventory dropped to 1 right after
    jest.spyOn(pricingService, 'buildPriceSummary').mockResolvedValue({
      subtotal: 1000,
      discount: 0,
      tax: 50,
      shipping: 0,
      total: 1050,
      currency: 'INR',
      items: [{ productId, variantId, quantity: 2 }],
      breakdown: {},
    });

    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      name: 'Lamp',
      vendorId: new mongoose.Types.ObjectId().toHexString(),
    });
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      sku: 'SKU-1',
      price: 500,
    });
    // Live inventory check finds only 1 left
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({
      variantId,
      availableQuantity: 1,
      deletedAt: null,
    });

    await expect(
      orderService.createOrder({
        customerId,
        items: [{ productId, variantId, quantity: 2 }],
        paymentMethod: 'cod',
      })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: 'Only 1 items are available.',
    });
  });

  it('prevents overselling during concurrent reservation via atomic findOneAndUpdate', async () => {
    const variantId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const orderIdA = new mongoose.Types.ObjectId().toHexString();
    const orderIdB = new mongoose.Types.ObjectId().toHexString();

    // Inventory has stock 2
    const mockInventoryDoc = {
      _id: new mongoose.Types.ObjectId(),
      variantId,
      availableQuantity: 2,
      reservedQuantity: 0,
      lowStockThreshold: 1,
      deletedAt: null,
    };

    jest.spyOn(Inventory, 'findOne').mockResolvedValue(mockInventoryDoc);
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);

    // Customer A reserves 2: atomic update succeeds
    jest.spyOn(Inventory, 'findOneAndUpdate')
      .mockResolvedValueOnce({
        ...mockInventoryDoc,
        availableQuantity: 0,
        reservedQuantity: 2,
        save: jest.fn(),
      })
      // Customer B simultaneously attempts to reserve 2: atomic filter { availableQuantity: { $gte: 2 } } returns null!
      .mockResolvedValueOnce(null);

    jest.spyOn(InventoryReservation, 'create').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      orderId: orderIdA,
      variantId,
      quantity: 2,
      status: 'ACTIVE',
      toObject: () => ({ orderId: orderIdA, quantity: 2 }),
    });

    // Customer A reservation succeeds
    const resA = await inventoryReservationService.createReservation({
      orderId: orderIdA,
      variantId,
      productId,
      quantity: 2,
    });
    expect(resA.quantity).toBe(2);

    // Customer B reservation fails atomically without overselling
    await expect(
      inventoryReservationService.createReservation({
        orderId: orderIdB,
        variantId,
        productId,
        quantity: 2,
      })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      message: 'Inventory changed while reserving stock',
    });
  });

  it('rolls back partial reservations and marks order FAILED if a concurrent reservation fails in multi-item order', async () => {
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const productId1 = new mongoose.Types.ObjectId().toHexString();
    const variantId1 = new mongoose.Types.ObjectId().toHexString();
    const productId2 = new mongoose.Types.ObjectId().toHexString();
    const variantId2 = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(pricingService, 'buildPriceSummary').mockResolvedValue({
      subtotal: 2000,
      discount: 0,
      tax: 100,
      shipping: 0,
      total: 2100,
      currency: 'INR',
      items: [
        { productId: productId1, variantId: variantId1, quantity: 1 },
        { productId: productId2, variantId: variantId2, quantity: 1 },
      ],
      breakdown: {},
    });

    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId1,
      name: 'Item',
      vendorId: new mongoose.Types.ObjectId().toHexString(),
    });
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId1,
      sku: 'SKU',
      price: 1000,
    });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({
      availableQuantity: 5,
      deletedAt: null,
    });

    const mockOrderDoc = {
      _id: orderId,
      customerId,
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
      toObject: () => ({ _id: orderId }),
    };
    jest.spyOn(Order, 'create').mockResolvedValue(mockOrderDoc);
    const findByIdAndUpdateSpy = jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({ ...mockOrderDoc, status: 'FAILED' });

    // Item 1 reservation succeeds, item 2 reservation fails with INSUFFICIENT_STOCK
    const releaseSpy = jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue(true);
    jest.spyOn(inventoryReservationService, 'createReservation')
      .mockResolvedValueOnce({
        _id: 'res-1',
        orderId,
        variantId: variantId1,
        quantity: 1,
      })
      .mockRejectedValueOnce({
        code: 'INSUFFICIENT_STOCK',
        message: 'Inventory changed while reserving stock',
      });

    await expect(
      orderService.createOrder({
        customerId,
        items: [
          { productId: productId1, variantId: variantId1, quantity: 1 },
          { productId: productId2, variantId: variantId2, quantity: 1 },
        ],
        paymentMethod: 'razorpay',
      })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });

    // Compensation: partial reservation for item 1 must be released and order marked FAILED
    expect(releaseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ orderId, variantId: variantId1 })
    );
    expect(findByIdAndUpdateSpy).toHaveBeenCalledWith(
      orderId,
      { $set: { status: 'FAILED', paymentStatus: 'FAILED' } }
    );
  });
});
