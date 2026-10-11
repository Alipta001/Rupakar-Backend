import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ReturnEligibilityService, returnEligibilityService } from '../app/services/return-eligibility.service.js';
import { RefundService, refundService } from '../app/services/refund.service.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Shipment } from '../app/models/shipment.model.js';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { Payment } from '../app/models/payment.model.js';
import { Refund } from '../app/models/refund.model.js';
import { paymentService } from '../app/services/payment.service.js';
import { vendorLedgerService } from '../app/services/vendor-ledger.service.js';
import { approveReturn, createOrderReturn } from '../app/controllers/return.controller.js';

describe('Phase 1: Return Foundation, Eligibility & Safe Refund Calculation', () => {
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
    refundService.duplicateRefunds.clear();
  });

  // A. Delivered item can request return.
  it('A. Delivered item can request return', async () => {
    const service = new ReturnEligibilityService();
    const deliveredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt,
      items: [{ productId: productId1, variantId: variantId1, quantity: 2, unitPrice: 500, lineTotal: 1000, vendorId: vendorId1 }],
    });

    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: vendorOrderId1,
        parentOrderId: orderId,
        vendorId: vendorId1,
        status: 'DELIVERED',
        deliveredAt,
        items: [{ productId: productId1, variantId: variantId1, quantity: 2 }],
      }),
    });

    const result = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 1 }],
    });

    expect(result.allowed).toBe(true);
    expect(result.canReturn).toBe(true);
    expect(result.remainingQuantity).toBe(2);
  });

  // B. Undelivered item cannot request return.
  it('B. Undelivered item cannot request return', async () => {
    const service = new ReturnEligibilityService();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'SHIPPED',
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 }],
    });

    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: vendorOrderId1,
        parentOrderId: orderId,
        vendorId: vendorId1,
        status: 'SHIPPED',
        items: [{ productId: productId1, variantId: variantId1, quantity: 1 }],
      }),
    });

    const result = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 1 }],
    });

    expect(result.allowed).toBe(false);
    expect(result.canReturn).toBe(false);
    expect(result.reason).toBe('ITEM_NOT_DELIVERED');
  });

  // C. Return window is calculated from delivery date.
  it('C. Return window is calculated from delivery date, NOT order creation date', async () => {
    const service = new ReturnEligibilityService();
    // Order was created 25 days ago, but delivered only 2 days ago
    const orderCreatedAt = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
    const deliveredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      createdAt: orderCreatedAt,
      deliveredAt,
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 }],
    });

    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: vendorOrderId1,
        parentOrderId: orderId,
        vendorId: vendorId1,
        status: 'DELIVERED',
        deliveredAt,
        items: [{ productId: productId1, variantId: variantId1, quantity: 1 }],
      }),
    });

    const result = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 1 }],
    });

    expect(result.allowed).toBe(true);
    expect(result.canReturn).toBe(true);
    // Window ends 7 days after deliveredAt
    const expectedExpiry = new Date(deliveredAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(result.eligibleUntil.getTime()).toBe(expectedExpiry.getTime());
  });

  // D. Expired return is rejected.
  it('D. Expired return is rejected (> 7 days from delivery date)', async () => {
    const service = new ReturnEligibilityService();
    // Delivered 10 days ago (window is 7 days)
    const deliveredAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt,
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 }],
    });

    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: vendorOrderId1,
        parentOrderId: orderId,
        vendorId: vendorId1,
        status: 'DELIVERED',
        deliveredAt,
        items: [{ productId: productId1, variantId: variantId1, quantity: 1 }],
      }),
    });

    const result = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 1 }],
    });

    expect(result.allowed).toBe(false);
    expect(result.canReturn).toBe(false);
    expect(result.reason).toBe('RETURN_WINDOW_EXPIRED');
  });

  // E. Wrong customer is rejected.
  it('E. Wrong customer is rejected (order ownership mismatch)', async () => {
    const service = new ReturnEligibilityService();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 }],
    });

    const result = await service.canRequestReturn({
      customerId: wrongCustomerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 1 }],
    });

    expect(result.allowed).toBe(false);
    expect(result.canReturn).toBe(false);
    expect(result.reason).toBe('ORDER_OWNERSHIP_MISMATCH');
  });

  // F. Product not belonging to VendorOrder is rejected.
  it('F. Product not belonging to VendorOrder is rejected', async () => {
    const service = new ReturnEligibilityService();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      items: [
        { productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 },
        { productId: productId2, variantId: variantId2, quantity: 1, unitPrice: 700, lineTotal: 700, vendorId: vendorId2 },
      ],
    });

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

    // Try to return variantId2 against vendorOrderId1
    const result = await service.canRequestReturn({
      customerId,
      orderId,
      vendorOrderId: vendorOrderId1,
      items: [{ variantId: variantId2, quantity: 1 }],
    });

    expect(result.allowed).toBe(false);
    expect(result.canReturn).toBe(false);
    expect(result.reason).toBe('ITEM_DOES_NOT_BELONG_TO_VENDOR_ORDER');
  });

  // G. Multi-vendor order correctly isolates VendorOrder.
  it('G. Multi-vendor order correctly isolates VendorOrder delivery states', async () => {
    const service = new ReturnEligibilityService();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'PARTIALLY_DELIVERED',
      items: [
        { productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 },
        { productId: productId2, variantId: variantId2, quantity: 1, unitPrice: 800, lineTotal: 800, vendorId: vendorId2 },
      ],
    });

    // Vendor 1 is DELIVERED, Vendor 2 is SHIPPED
    jest.spyOn(VendorOrder, 'findOne').mockImplementation(({ vendorId }) => ({
      lean: jest.fn().mockResolvedValue(
        String(vendorId) === String(vendorId1)
          ? {
              _id: vendorOrderId1,
              parentOrderId: orderId,
              vendorId: vendorId1,
              status: 'DELIVERED',
              deliveredAt: new Date(),
              items: [{ productId: productId1, variantId: variantId1, quantity: 1 }],
            }
          : {
              _id: vendorOrderId2,
              parentOrderId: orderId,
              vendorId: vendorId2,
              status: 'SHIPPED',
              items: [{ productId: productId2, variantId: variantId2, quantity: 1 }],
            }
      ),
    }));

    // Returning Vendor 1's delivered item succeeds
    const allowedResult = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 1 }],
    });
    expect(allowedResult.allowed).toBe(true);

    // Returning Vendor 2's undelivered item fails
    const rejectedResult = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId2, quantity: 1 }],
    });
    expect(rejectedResult.allowed).toBe(false);
    expect(rejectedResult.reason).toBe('ITEM_NOT_DELIVERED');
  });

  // H. Partial quantity return works.
  it('H. Partial quantity return works (returning 1 of 3 purchased)', async () => {
    const service = new ReturnEligibilityService();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      items: [{ productId: productId1, variantId: variantId1, quantity: 3, unitPrice: 500, lineTotal: 1500, vendorId: vendorId1 }],
    });

    jest.spyOn(Return, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]), // No prior returns
      }),
    });

    const result = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 1 }],
    });

    expect(result.allowed).toBe(true);
    expect(result.remainingQuantity).toBe(3);
  });

  // I. Returning more than purchased quantity is rejected.
  it('I. Returning more than purchased quantity is rejected', async () => {
    const service = new ReturnEligibilityService();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      items: [{ productId: productId1, variantId: variantId1, quantity: 3, unitPrice: 500, lineTotal: 1500, vendorId: vendorId1 }],
    });

    jest.spyOn(Return, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });

    const result = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 4 }], // Requesting 4 when purchased 3
    });

    expect(result.allowed).toBe(false);
    expect(result.canReturn).toBe(false);
    expect(result.reason).toBe('RETURN_QUANTITY_EXCEEDS_PURCHASED');
    expect(result.remainingQuantity).toBe(3);
  });

  // J. Multiple partial returns cannot exceed purchased quantity.
  it('J. Multiple partial returns cannot exceed purchased quantity', async () => {
    const service = new ReturnEligibilityService();
    const returnItem1Id = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      items: [{ productId: productId1, variantId: variantId1, quantity: 3, unitPrice: 500, lineTotal: 1500, vendorId: vendorId1 }],
    });

    // Active return already exists for quantity 2
    jest.spyOn(Return, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ items: [returnItem1Id] }]),
      }),
    });

    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ quantity: 2, variantId: variantId1 }]),
      }),
    });

    // Requesting remaining 1 item is allowed
    const allowed = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 1 }],
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.remainingQuantity).toBe(1);

    // Requesting 2 items exceeds the 1 remaining item
    const rejected = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 2 }],
    });
    expect(rejected.allowed).toBe(false);
    expect(rejected.reason).toBe('RETURN_QUANTITY_EXCEEDS_PURCHASED');
    expect(rejected.remainingQuantity).toBe(1);
  });

  // K. Duplicate active return is rejected.
  it('K. Duplicate active return is rejected when remaining quantity is 0', async () => {
    const service = new ReturnEligibilityService();
    const returnItemId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: orderId,
      customerId,
      status: 'DELIVERED',
      deliveredAt: new Date(),
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 }],
    });

    // Active return covers full quantity 1
    jest.spyOn(Return, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ items: [returnItemId] }]),
      }),
    });

    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ quantity: 1, variantId: variantId1 }]),
      }),
    });

    const result = await service.canRequestReturn({
      customerId,
      orderId,
      items: [{ variantId: variantId1, quantity: 1 }],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('ITEM_ALREADY_RETURNED');
    expect(result.remainingQuantity).toBe(0);
  });

  // L. Single ₹500 item from ₹10,000 multi-vendor order does NOT produce ₹10,000 refund.
  it('L. Single ₹500 item from ₹10,000 multi-vendor order does NOT produce ₹10,000 refund', async () => {
    const service = new RefundService();
    const order = {
      _id: orderId,
      total: 10000,
      subtotal: 9500,
      discount: 0,
      tax: 500,
      currency: 'INR',
      items: [
        { productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500, vendorId: vendorId1 },
        { productId: productId2, variantId: variantId2, quantity: 1, unitPrice: 9000, lineTotal: 9000, vendorId: vendorId2 },
      ],
    };

    const vendorOrder = {
      _id: vendorOrderId1,
      parentOrderId: orderId,
      vendorId: vendorId1,
      subtotal: 500,
      discount: 0,
      tax: 0,
      total: 500,
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 }],
    };

    const returnItems = [
      { productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 },
    ];

    const calculation = service.calculateRefund({
      order,
      vendorOrder,
      returnItems,
      proportional: true,
    });

    // Refund must be ₹500, strictly NOT ₹10,000
    expect(calculation.amount).toBe(500);
    expect(calculation.amount).not.toBe(10000);
    expect(calculation.breakdown).toEqual({
      itemSubtotal: 500,
      discountAdjustment: 0,
      taxAdjustment: 0,
      shippingAdjustment: 0,
      refundAmount: 500,
    });
  });

  // M. Refund calculation respects item quantity.
  it('M. Refund calculation respects item quantity', async () => {
    const service = new RefundService();
    const order = {
      _id: orderId,
      total: 3000,
      subtotal: 3000,
      discount: 0,
      tax: 0,
      currency: 'INR',
      items: [{ variantId: variantId1, quantity: 3, unitPrice: 1000, lineTotal: 3000 }],
    };

    // Return 1 item -> ₹1000
    const calc1 = service.calculateRefund({
      order,
      returnItems: [{ variantId: variantId1, quantity: 1, unitPrice: 1000, lineTotal: 1000 }],
      proportional: true,
    });
    expect(calc1.amount).toBe(1000);

    // Return 2 items -> ₹2000
    const calc2 = service.calculateRefund({
      order,
      returnItems: [{ variantId: variantId1, quantity: 2, unitPrice: 1000, lineTotal: 2000 }],
      proportional: true,
    });
    expect(calc2.amount).toBe(2000);
  });

  // N. Refund calculation handles existing discount allocation correctly.
  it('N. Refund calculation handles existing discount allocation proportionally', async () => {
    const service = new RefundService();
    // Subtotal 1000 with 10% discount (100) -> net 900
    const order = {
      _id: orderId,
      subtotal: 1000,
      discount: 100,
      tax: 0,
      total: 900,
      currency: 'INR',
      items: [
        { variantId: variantId1, quantity: 1, unitPrice: 400, lineTotal: 400 },
        { variantId: variantId2, quantity: 1, unitPrice: 600, lineTotal: 600 },
      ],
    };

    // Return item 1 (40% of subtotal) -> discount share is 40, refundable is 360
    const calc = service.calculateRefund({
      order,
      returnItems: [{ variantId: variantId1, quantity: 1, unitPrice: 400, lineTotal: 400 }],
      proportional: true,
    });

    expect(calc.breakdown.itemSubtotal).toBe(400);
    expect(calc.breakdown.discountAdjustment).toBe(40);
    expect(calc.amount).toBe(360);
  });

  // O. Existing cancellation/refund regression assertions remain valid.
  it('O. Existing calculateRefund fallback interface remains fully backward compatible', async () => {
    const service = new RefundService();
    const order = {
      _id: orderId,
      total: 2000,
      subtotal: 1800,
      discount: 100,
      tax: 300,
      items: [{ variantId: variantId1, quantity: 2, unitPrice: 900, lineTotal: 1800 }],
    };

    // Standard unflagged calculateRefund call (as used by existing cancellation tests)
    const result = service.calculateRefund({
      order,
      returnItems: [{ variantId: variantId1, quantity: 1, unitPrice: 900, lineTotal: 900 }],
    });

    expect(result.amount).toBe(900);
    expect(result.currency).toBe('INR');
  });

  // P. COD return does not falsely mark refund as completed.
  it('P. COD return creates pending refund without calling Razorpay or falsely completing', async () => {
    const codPayment = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      provider: 'cod',
      status: 'CAPTURED',
      amount: 500,
    };

    jest.spyOn(Payment, 'findById').mockResolvedValue(codPayment);
    jest.spyOn(Refund, 'findOne').mockResolvedValue(null);
    jest.spyOn(Order, 'findById').mockResolvedValue(null);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(null);
    const refundPaymentSpy = jest.spyOn(paymentService.provider, 'refundPayment');
    jest.spyOn(Order, 'updateOne').mockResolvedValue({ acknowledged: true });
    jest.spyOn(VendorOrder, 'updateOne').mockResolvedValue({ acknowledged: true });
    jest.spyOn(vendorLedgerService, 'recordRefundAdjustment').mockResolvedValue(true);

    let createdRefundDoc = null;
    jest.spyOn(Refund, 'create').mockImplementation(async (payload) => {
      createdRefundDoc = { ...payload, _id: new mongoose.Types.ObjectId().toHexString() };
      return { toObject: () => createdRefundDoc, ...createdRefundDoc };
    });

    const refund = await refundService.createRefund({
      refundData: {
        orderId,
        paymentId: codPayment._id,
        customerId,
        vendorId: vendorId1,
        vendorOrderId: vendorOrderId1,
        amount: 500,
        reason: 'MANUAL_COD_REFUND_PENDING',
      },
    });

    // Must NOT call payment provider (Razorpay) for COD
    expect(refundPaymentSpy).not.toHaveBeenCalled();

    // Must NOT mark as COMPLETED
    expect(refund.status).toBe('REQUESTED');
    expect(refund.reason).toBe('MANUAL_COD_REFUND_PENDING');
  });

  // Controller approveReturn integration test: passes calculatedAmount instead of order.total
  it('Controller approveReturn passes line-item calculated refund, NEVER order.total', async () => {
    const returnId = new mongoose.Types.ObjectId().toHexString();
    const returnItemId = new mongoose.Types.ObjectId().toHexString();

    const returnDoc = {
      _id: returnId,
      orderId,
      vendorOrderId: vendorOrderId1,
      vendorId: vendorId1,
      customerId,
      status: 'UNDER_REVIEW',
      items: [returnItemId],
      save: jest.fn().mockResolvedValue(true),
      toObject: () => ({ _id: returnId, status: 'APPROVED' }),
    };

    const mockOrder = {
      _id: orderId,
      customerId,
      total: 10000, // Large order total
      currency: 'INR',
      paymentMethod: 'razorpay',
    };

    const mockPayment = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      provider: 'razorpay',
      providerPaymentId: 'pay_test_123',
    };

    const mockVendorOrder = {
      _id: vendorOrderId1,
      parentOrderId: orderId,
      vendorId: vendorId1,
      subtotal: 500,
      total: 500,
      discount: 0,
      tax: 0,
      items: [{ productId: productId1, variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 }],
    };

    const mockReturnItem = {
      _id: returnItemId,
      productId: productId1,
      variantId: variantId1,
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockReturnItem]) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(mockVendorOrder) });

    let capturedRefundPayload = null;
    jest.spyOn(refundService, 'createRefund').mockImplementation(async ({ refundData }) => {
      capturedRefundPayload = refundData;
      return { _id: 'ref-1', status: 'PROCESSING', amount: refundData.amount };
    });

    const req = {
      params: { id: returnId },
      user: { sub: 'admin-1', role: 'admin' },
      headers: {},
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await approveReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(capturedRefundPayload).not.toBeNull();
    // CRITICAL: Amount MUST be 500 (calculated item total), NOT order.total (10000)!
    expect(capturedRefundPayload.amount).toBe(500);
    expect(capturedRefundPayload.amount).not.toBe(10000);
    expect(res.json).toHaveBeenCalled();
  });
});
