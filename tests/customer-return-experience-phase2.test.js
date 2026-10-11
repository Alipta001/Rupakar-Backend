import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ReturnEligibilityService, returnEligibilityService } from '../app/services/return-eligibility.service.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { getOrderReturnEligibility, createOrderReturn } from '../app/controllers/return.controller.js';

describe('Phase 2: Customer Return Experience Backend Tests', () => {
  const customerId = new mongoose.Types.ObjectId().toHexString();
  const wrongCustomerId = new mongoose.Types.ObjectId().toHexString();
  const orderId = new mongoose.Types.ObjectId().toHexString();
  const vendorId1 = new mongoose.Types.ObjectId().toHexString();
  const vendorId2 = new mongoose.Types.ObjectId().toHexString();
  const vendorOrderId1 = new mongoose.Types.ObjectId().toHexString();
  const vendorOrderId2 = new mongoose.Types.ObjectId().toHexString();
  const variantId1 = new mongoose.Types.ObjectId().toHexString();
  const variantId2 = new mongoose.Types.ObjectId().toHexString();
  const productId1 = new mongoose.Types.ObjectId().toHexString();
  const productId2 = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // 1. Customer can retrieve eligibility.
  it('1. Customer can retrieve eligibility for their order', async () => {
    const deliveredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt,
      items: [{ productId: productId1, variantId: variantId1, quantity: 2, unitPrice: 450, lineTotal: 900, vendorId: vendorId1 }],
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: vendorOrderId1, parentOrderId: orderId, vendorId: vendorId1, status: 'DELIVERED', deliveredAt, items: [{ variantId: variantId1, quantity: 2 }] },
      ]),
    });
    jest.spyOn(Return, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    const result = await returnEligibilityService.getOrderEligibility({ customerId, orderId });

    expect(result.orderId).toBe(orderId);
    expect(result.canReturnAny).toBe(true);
    expect(result.items.length).toBe(1);
    expect(result.items[0].canReturn).toBe(true);
    expect(result.items[0].remainingQuantity).toBe(2);
    expect(result.items[0].purchasedQuantity).toBe(2);
  });

  // 2. Wrong customer cannot retrieve eligibility.
  it('2. Wrong customer cannot retrieve eligibility (ownership mismatch)', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 450 }],
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);

    await expect(
      returnEligibilityService.getOrderEligibility({ customerId: wrongCustomerId, orderId })
    ).rejects.toMatchObject({ code: 'ORDER_OWNERSHIP_MISMATCH' });
  });

  // 3. Delivered item returns eligible.
  it('3. Delivered item returns eligible', async () => {
    const deliveredAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt,
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 600, lineTotal: 600, vendorId: vendorId1 }],
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: vendorOrderId1, parentOrderId: orderId, vendorId: vendorId1, status: 'DELIVERED', deliveredAt, items: [{ variantId: variantId1, quantity: 1 }] },
      ]),
    });
    jest.spyOn(Return, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    const result = await returnEligibilityService.getOrderEligibility({ customerId, orderId });
    expect(result.items[0].isDelivered).toBe(true);
    expect(result.items[0].canReturn).toBe(true);
    expect(result.items[0].reason).toBeNull();
  });

  // 4. Undelivered item returns ineligible.
  it('4. Undelivered item returns ineligible', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'SHIPPED',
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 600, lineTotal: 600, vendorId: vendorId1 }],
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: vendorOrderId1, parentOrderId: orderId, vendorId: vendorId1, status: 'SHIPPED', items: [{ variantId: variantId1, quantity: 1 }] },
      ]),
    });
    jest.spyOn(Return, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });

    const result = await returnEligibilityService.getOrderEligibility({ customerId, orderId });
    expect(result.items[0].isDelivered).toBe(false);
    expect(result.items[0].canReturn).toBe(false);
    expect(result.items[0].reason).toBe('ITEM_NOT_DELIVERED');
  });

  // 5. Remaining quantity is correct.
  it('5. Remaining quantity is correct after prior partial returns', async () => {
    const returnItemId1 = new mongoose.Types.ObjectId().toHexString();
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      items: [{ productId: productId1, variantId: variantId1, quantity: 3, unitPrice: 300, lineTotal: 900, vendorId: vendorId1 }],
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: vendorOrderId1, parentOrderId: orderId, vendorId: vendorId1, status: 'DELIVERED', deliveredAt: new Date(), items: [{ variantId: variantId1, quantity: 3 }] },
      ]),
    });

    // Active return already exists for 1 item
    jest.spyOn(Return, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: 'ret-1', items: [returnItemId1] }]),
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ items: [returnItemId1] }]),
      }),
    });
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: returnItemId1, quantity: 1, variantId: variantId1 }]),
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ quantity: 1, variantId: variantId1 }]),
      }),
    });

    const result = await returnEligibilityService.getOrderEligibility({ customerId, orderId });
    expect(result.items[0].purchasedQuantity).toBe(3);
    expect(result.items[0].remainingQuantity).toBe(2);
    expect(result.items[0].canReturn).toBe(true);
  });

  // 6. Customer cannot submit more than remaining quantity.
  it('6. Customer cannot submit more than remaining quantity', async () => {
    const returnItemId1 = new mongoose.Types.ObjectId().toHexString();
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      items: [{ productId: productId1, variantId: variantId1, quantity: 2, unitPrice: 500, lineTotal: 1000, vendorId: vendorId1 }],
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);

    // Active return already covers 1 item (remaining is 1)
    jest.spyOn(Return, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ items: [returnItemId1] }]),
      }),
    });
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ quantity: 1, variantId: variantId1 }]),
      }),
    });

    // Requesting 2 items when remaining is 1 must be rejected
    const check = await returnEligibilityService.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 2 }],
    });

    expect(check.allowed).toBe(false);
    expect(check.canReturn).toBe(false);
    expect(check.reason).toBe('RETURN_QUANTITY_EXCEEDS_PURCHASED');
    expect(check.remainingQuantity).toBe(1);
  });

  // 7. Customer cannot submit for another vendor's item.
  it("7. Customer cannot submit for another vendor's item when vendorOrderId is provided", async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      items: [
        { productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 },
        { productId: productId2, variantId: variantId2, quantity: 1, unitPrice: 800, lineTotal: 800, vendorId: vendorId2 },
      ],
    };

    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);

    // VendorOrder 1 only contains variantId1
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: vendorOrderId1,
        parentOrderId: orderId,
        customerId,
        vendorId: vendorId1,
        status: 'DELIVERED',
        deliveredAt: new Date(),
        items: [{ productId: productId1, variantId: variantId1, quantity: 1 }],
      }),
    });

    // Submitting variantId2 against vendorOrderId1 must fail
    const check = await returnEligibilityService.canRequestReturn({
      customerId,
      orderId,
      vendorOrderId: vendorOrderId1,
      items: [{ variantId: variantId2, quantity: 1 }],
    });

    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('ITEM_DOES_NOT_BELONG_TO_VENDOR_ORDER');
  });

  // 8. Duplicate idempotent submission returns the existing request.
  it('8. Duplicate idempotent submission returns the existing request without creating a new one', async () => {
    const idempotencyKey = `idemp-test-${Date.now()}`;
    const existingReturnId = new mongoose.Types.ObjectId().toHexString();

    const mockOrder = {
      _id: orderId,
      customerId,
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 }],
    };

    const existingReturn = {
      _id: existingReturnId,
      returnNumber: 'RUP-RET-EXISTING',
      orderId,
      customerId,
      status: 'REQUESTED',
      idempotencyKey,
      items: [],
      toObject: () => ({ _id: existingReturnId, returnNumber: 'RUP-RET-EXISTING', status: 'REQUESTED' }),
    };

    jest.spyOn(Order, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(mockOrder) });
    jest.spyOn(Return, 'findOne').mockResolvedValue(existingReturn);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    const createSpy = jest.spyOn(Return, 'create');

    const req = {
      params: { id: orderId },
      user: { sub: customerId },
      body: {
        items: [{ variantId: variantId1, quantity: 1 }],
        idempotencyKey,
      },
      headers: {},
    };

    let sentData = null;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((payload) => {
        sentData = payload;
      }),
    };
    const next = jest.fn();

    await createOrderReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled(); // No new return created!
    expect(sentData.data.returnNumber).toBe('RUP-RET-EXISTING');
  });

  // 9. Return request contains correct vendorOrderId.
  it('9. Return request contains correct vendorOrderId', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 }],
    };

    jest.spyOn(Order, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(mockOrder) });
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(returnEligibilityService, 'canRequestReturn').mockResolvedValue({ allowed: true });
    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: vendorOrderId1, parentOrderId: orderId, vendorId: vendorId1 }),
    });

    const createdReturnItemId = new mongoose.Types.ObjectId().toHexString();
    jest.spyOn(ReturnItem, 'create').mockResolvedValue({ _id: createdReturnItemId });
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    let capturedCreatePayload = null;
    jest.spyOn(Return, 'create').mockImplementation(async (payload) => {
      capturedCreatePayload = payload;
      return { ...payload, _id: new mongoose.Types.ObjectId().toHexString(), toObject: () => payload };
    });

    const req = {
      params: { id: orderId },
      user: { sub: customerId },
      body: {
        items: [{ variantId: variantId1, quantity: 1, reason: 'DAMAGED' }],
        type: 'RETURN',
      },
      headers: {},
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await createOrderReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(capturedCreatePayload).not.toBeNull();
    // Must contain the correct vendorOrderId from the child vendor order
    expect(String(capturedCreatePayload.vendorOrderId)).toBe(String(vendorOrderId1));
    expect(String(capturedCreatePayload.vendorId)).toBe(String(vendorId1));
  });

  // 10. Replacement request is stored as REPLACEMENT but does not create a replacement order.
  it('10. Replacement request is stored as REPLACEMENT but does not create a replacement order', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 }],
    };

    jest.spyOn(Order, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(mockOrder) });
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(returnEligibilityService, 'canRequestReturn').mockResolvedValue({ allowed: true });
    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: vendorOrderId1, parentOrderId: orderId, vendorId: vendorId1 }),
    });

    const createdReturnItemId = new mongoose.Types.ObjectId().toHexString();
    jest.spyOn(ReturnItem, 'create').mockResolvedValue({ _id: createdReturnItemId });
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    // Assert that Order.create is NEVER called during return creation
    const orderCreateSpy = jest.spyOn(Order, 'create');

    let capturedCreatePayload = null;
    jest.spyOn(Return, 'create').mockImplementation(async (payload) => {
      capturedCreatePayload = payload;
      return { ...payload, _id: new mongoose.Types.ObjectId().toHexString(), toObject: () => payload };
    });

    const req = {
      params: { id: orderId },
      user: { sub: customerId },
      body: {
        items: [{ variantId: variantId1, quantity: 1, reason: 'DEFECTIVE' }],
        type: 'REPLACEMENT',
      },
      headers: {},
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await createOrderReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(capturedCreatePayload.type).toBe('REPLACEMENT');
    expect(orderCreateSpy).not.toHaveBeenCalled(); // CRITICAL: Does NOT create a replacement order!
  });
});
