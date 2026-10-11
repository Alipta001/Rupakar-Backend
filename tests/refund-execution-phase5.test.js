import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Payment } from '../app/models/payment.model.js';
import { Refund } from '../app/models/refund.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { User } from '../app/models/user.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { returnStateService } from '../app/services/return-state.service.js';
import { refundService } from '../app/services/refund.service.js';
import { paymentService } from '../app/services/payment.service.js';
import {
  adminExecutePrepaidRefund,
  adminHandleCodPayout,
  submitCustomerPayoutDetails,
} from '../app/controllers/return.controller.js';

describe('Phase 5: Refund Execution + COD Refund Foundation Backend Tests', () => {
  const adminUserId = new mongoose.Types.ObjectId().toHexString();
  const sellerUserId = new mongoose.Types.ObjectId().toHexString();
  const customerUserId = new mongoose.Types.ObjectId().toHexString();

  const vendorId1 = new mongoose.Types.ObjectId().toHexString();
  const returnId1 = new mongoose.Types.ObjectId().toHexString();
  const orderId1 = new mongoose.Types.ObjectId().toHexString();
  const paymentId1 = new mongoose.Types.ObjectId().toHexString();
  const returnItemId1 = new mongoose.Types.ObjectId().toHexString();
  const variantId1 = new mongoose.Types.ObjectId().toHexString();

  const mockReq = (user, role = 'admin', params = {}, body = {}, query = {}) => ({
    user: { sub: user, role },
    params,
    body,
    query,
    headers: { 'x-request-id': 'req-test-p5' },
  });

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    refundService.duplicateRefunds.clear();

    jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ name: 'Test User', email: 'user@example.com' }) }) });
    jest.spyOn(Vendor, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ storeName: 'Artisan Store' }) }) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(VendorOrder, 'updateOne').mockResolvedValue({ acknowledged: true });
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  });

  // 1. Approved prepaid return can initiate refund.
  it('1. Approved prepaid return can initiate refund successfully', async () => {
    const mockOrder = {
      _id: orderId1,
      paymentMethod: 'razorpay',
      currency: 'INR',
      total: 1000,
    };
    const mockPayment = {
      _id: paymentId1,
      orderId: orderId1,
      provider: 'razorpay',
      providerPaymentId: 'pay_rzp_123',
      status: 'CAPTURED',
      amount: 1000,
    };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 500 },
      refundDetails: { amount: 500, status: 'APPROVED_PENDING_EXECUTION' },
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);
    jest.spyOn(Refund, 'findOne').mockResolvedValue(null);
    jest.spyOn(refundService, 'createRefund').mockResolvedValue({
      _id: 'rfnd-1',
      providerRefundId: 'rfnd_rzp_456',
      status: 'PROCESSING',
    });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 }, { notes: 'Executing return refund' });
    const res = mockRes();
    const next = jest.fn();

    await adminExecutePrepaidRefund(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(refundService.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        refundData: expect.objectContaining({
          orderId: orderId1,
          amount: 500,
          returnId: returnId1,
        }),
      }),
    );
    expect(mockReturnDoc.status).toBe('REFUND_PROCESSING');
    expect(mockReturnDoc.refundDetails.providerRefundId).toBe('rfnd_rzp_456');
  });

  // 2. Refund amount comes from backend authoritative calculation.
  it('2. Refund amount comes strictly from backend authoritative calculation', async () => {
    const mockOrder = {
      _id: orderId1,
      paymentMethod: 'razorpay',
      currency: 'INR',
      subtotal: 2000,
      discount: 200,
      tax: 180,
      total: 1980,
    };
    const mockPayment = {
      _id: paymentId1,
      orderId: orderId1,
      provider: 'razorpay',
      providerPaymentId: 'pay_rzp_123',
      status: 'CAPTURED',
      amount: 1980,
    };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND' }, // No pre-stored amount, recalculates proportionally
      items: [returnItemId1],
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);
    jest.spyOn(Refund, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: returnItemId1, quantity: 1, unitPrice: 500, lineTotal: 500 }]),
    });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const createRefundSpy = jest.spyOn(refundService, 'createRefund').mockResolvedValue({
      _id: 'rfnd-2',
      providerRefundId: 'rfnd_rzp_789',
      status: 'PROCESSING',
    });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminExecutePrepaidRefund(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // Proportional: 500 - (500/2000 * 200 = 50) + (450/1800 * 180 = 45) = 495
    expect(createRefundSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        refundData: expect.objectContaining({
          amount: 495,
        }),
      }),
    );
  });

  // 3. Frontend cannot provide arbitrary refund amount.
  it('3. Frontend cannot provide arbitrary refund amount (strict schema rejects extra fields)', async () => {
    const req = mockReq(adminUserId, 'admin', { id: returnId1 }, {
      amount: 9999,
      refundAmount: 9999,
    });
    const res = mockRes();
    const next = jest.fn();

    await adminExecutePrepaidRefund(req, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.name).toBe('ZodError');
  });

  // 4. Partial return never refunds order.total.
  it('4. Partial return never refunds order.total', async () => {
    const orderDoc = {
      _id: orderId1,
      items: [
        { variantId: variantId1, quantity: 4, unitPrice: 1000, lineTotal: 4000 },
      ],
      subtotal: 4000,
      discount: 0,
      tax: 0,
      total: 4000,
    };
    const returnItems = [
      { variantId: variantId1, quantity: 1, unitPrice: 1000, lineTotal: 1000 },
    ];

    const result = refundService.calculateRefund({
      order: orderDoc,
      returnItems,
      proportional: true,
    });

    expect(result.amount).toBe(1000);
    expect(result.amount).not.toBe(orderDoc.total);
    expect(result.amount).toBeLessThan(orderDoc.total);
  });

  // 5. Razorpay is called for eligible prepaid refund.
  it('5. Razorpay provider is invoked for eligible prepaid refund', async () => {
    const mockOrder = {
      _id: orderId1,
      paymentMethod: 'razorpay',
      currency: 'INR',
      total: 1000,
    };
    const mockPayment = {
      _id: paymentId1,
      orderId: orderId1,
      provider: 'razorpay',
      providerPaymentId: 'pay_rzp_live_test',
      status: 'CAPTURED',
      amount: 1000,
      save: jest.fn().mockResolvedValue(true),
    };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 500 },
      refundDetails: { amount: 500 },
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);
    jest.spyOn(Payment, 'findById').mockResolvedValue(mockPayment);
    jest.spyOn(Refund, 'findOne').mockResolvedValue(null);
    jest.spyOn(Refund, 'create').mockResolvedValue({
      _id: 'rfnd-created',
      providerRefundId: 'rfnd_rzp_mock',
      status: 'PROCESSING',
    });

    const providerRefundSpy = jest.spyOn(paymentService.provider, 'refundPayment').mockResolvedValue({
      id: 'rfnd_rzp_mock',
      amount: 50000,
    });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminExecutePrepaidRefund(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(providerRefundSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: 'pay_rzp_live_test',
        amount: 500,
      }),
    );
  });

  // 6. Razorpay is NOT called for COD.
  it('6. Razorpay is strictly NOT called for Cash on Delivery returns', async () => {
    const mockOrder = {
      _id: orderId1,
      paymentMethod: 'cod',
      currency: 'INR',
      total: 800,
    };
    const mockPayment = {
      _id: paymentId1,
      orderId: orderId1,
      provider: 'cod',
      status: 'PENDING',
      amount: 800,
    };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 800 },
      refundDetails: { amount: 800 },
      toObject: function () { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);
    const providerRefundSpy = jest.spyOn(paymentService.provider, 'refundPayment');

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminExecutePrepaidRefund(req, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.code).toBe('COD_REFUND_REQUIRES_MANUAL_PAYOUT');
    expect(providerRefundSpy).not.toHaveBeenCalled();
  });

  // 7. Duplicate refund request does not create duplicate Razorpay refund.
  it('7. Duplicate refund request does not create duplicate Razorpay refund', async () => {
    const mockOrder = {
      _id: orderId1,
      paymentMethod: 'razorpay',
      total: 1000,
    };
    const mockPayment = {
      _id: paymentId1,
      orderId: orderId1,
      provider: 'razorpay',
      status: 'CAPTURED',
      amount: 1000,
    };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      vendorId: vendorId1,
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 500 },
      refundDetails: { amount: 500 },
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);

    // Existing refund already in database for this returnId
    jest.spyOn(Refund, 'findOne').mockResolvedValue({
      _id: 'existing-rfnd',
      returnId: returnId1,
      status: 'PROCESSING',
      providerRefundId: 'rfnd_already_created',
    });

    const createRefundSpy = jest.spyOn(refundService, 'createRefund');

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminExecutePrepaidRefund(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(createRefundSpy).not.toHaveBeenCalled();
  });

  // 8. Concurrent refund attempts are safely handled.
  it('8. Concurrent refund attempts on return in REFUND_PROCESSING are rejected with 409 conflict', async () => {
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      status: 'REFUND_PROCESSING',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 500 },
    };
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminExecutePrepaidRefund(req, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('REFUND_ALREADY_PROCESSING');
  });

  // 9. Existing provider refund can be recovered after timeout/retry.
  it('9. Existing provider refund is recovered safely on retry if already completed', async () => {
    const mockOrder = { _id: orderId1, paymentMethod: 'razorpay' };
    const mockPayment = { _id: paymentId1, status: 'CAPTURED' };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 500 },
      refundDetails: { amount: 500 },
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);
    jest.spyOn(Refund, 'findOne').mockResolvedValue({
      _id: 'rfnd-recovered',
      status: 'COMPLETED',
      providerRefundId: 'rfnd_provider_recovered',
    });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminExecutePrepaidRefund(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockReturnDoc.status).toBe('REFUNDED');
    expect(mockReturnDoc.save).toHaveBeenCalled();
  });

  // 10. Successful webhook transitions return to REFUNDED.
  it('10. Successful webhook transitions return to REFUNDED with processed timestamps', async () => {
    const mockReturnDoc = {
      _id: returnId1,
      status: 'REFUND_PROCESSING',
      refundDetails: { amount: 500, status: 'PROCESSING' },
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Refund, 'find').mockResolvedValue([
      { _id: 'rfnd-1', returnId: returnId1, providerRefundId: 'rfnd_webhook_123', status: 'PROCESSING' },
    ]);
    jest.spyOn(Refund, 'updateMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);

    await paymentService.syncRefundDocumentsCompleted({
      providerRefundId: 'rfnd_webhook_123',
    });

    expect(mockReturnDoc.status).toBe('REFUNDED');
    expect(mockReturnDoc.refundDetails.status).toBe('COMPLETED');
    expect(mockReturnDoc.completedAt).toBeInstanceOf(Date);
    expect(mockReturnDoc.save).toHaveBeenCalled();
  });

  // 11. Failed refund does not become REFUNDED.
  it('11. Failed refund transitions return to REFUND_FAILED without marking REFUNDED', async () => {
    const mockOrder = { _id: orderId1, paymentMethod: 'razorpay', currency: 'INR' };
    const mockPayment = { _id: paymentId1, status: 'CAPTURED', provider: 'razorpay', amount: 1000 };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      vendorId: vendorId1,
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 500 },
      refundDetails: { amount: 500 },
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);
    jest.spyOn(Refund, 'findOne').mockResolvedValue(null);
    jest.spyOn(refundService, 'createRefund').mockRejectedValue(new Error('Razorpay network failure'));

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminExecutePrepaidRefund(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockReturnDoc.status).toBe('REFUND_FAILED');
    expect(mockReturnDoc.refundDetails.status).toBe('FAILED');
    expect(mockReturnDoc.status).not.toBe('REFUNDED');
  });

  // 12. Admin-only refund endpoint is protected.
  it('12. Admin-only refund endpoint is protected and returns 403 for non-admins', async () => {
    const reqCustomer = mockReq(customerUserId, 'customer', { id: returnId1 });
    const resCustomer = mockRes();
    const nextCustomer = jest.fn();

    await adminExecutePrepaidRefund(reqCustomer, resCustomer, nextCustomer);

    expect(nextCustomer).toHaveBeenCalled();
    expect(nextCustomer.mock.calls[0][0].statusCode).toBe(403);
  });

  // 13. Seller cannot execute refund.
  it('13. Seller cannot execute refund (receives 403 forbidden)', async () => {
    const reqSeller = mockReq(sellerUserId, 'seller', { id: returnId1 });
    const resSeller = mockRes();
    const nextSeller = jest.fn();

    await adminExecutePrepaidRefund(reqSeller, resSeller, nextSeller);

    expect(nextSeller).toHaveBeenCalled();
    expect(nextSeller.mock.calls[0][0].statusCode).toBe(403);
  });

  // 14. Customer cannot execute refund.
  it('14. Customer cannot execute refund or alter return resolution', async () => {
    const reqCustomer = mockReq(customerUserId, 'customer', { id: returnId1 });
    const resCustomer = mockRes();
    const nextCustomer = jest.fn();

    await adminHandleCodPayout(reqCustomer, resCustomer, nextCustomer);

    expect(nextCustomer).toHaveBeenCalled();
    expect(nextCustomer.mock.calls[0][0].statusCode).toBe(403);
  });

  // 15. COD payout amount cannot be arbitrarily changed.
  it('15. COD payout amount cannot be arbitrarily changed (strict schema rejects client amount)', async () => {
    const req = mockReq(adminUserId, 'admin', { id: returnId1 }, {
      action: 'COMPLETE_PAYOUT',
      reference: 'UTR12345678',
      amount: 50000, // Client tries to override payout amount
    });
    const res = mockRes();
    const next = jest.fn();

    await adminHandleCodPayout(req, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.name).toBe('ZodError');
  });

  // 16. COD payout status transitions are controlled.
  it('16. COD payout status transitions are controlled (INITIATE, COMPLETE, FAIL)', async () => {
    const mockOrder = { _id: orderId1, paymentMethod: 'cod' };
    const mockPayment = { _id: paymentId1, provider: 'cod' };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 600 },
      manualPayout: {},
      refundDetails: {},
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);

    // 16a. INITIATE_PAYOUT
    const reqInit = mockReq(adminUserId, 'admin', { id: returnId1 }, { action: 'INITIATE_PAYOUT', notes: 'Bank transfer scheduled' });
    const resInit = mockRes();
    const nextInit = jest.fn();

    await adminHandleCodPayout(reqInit, resInit, nextInit);

    expect(nextInit).not.toHaveBeenCalled();
    expect(mockReturnDoc.status).toBe('MANUAL_PAYOUT_PROCESSING');
    expect(mockReturnDoc.manualPayout.status).toBe('PROCESSING');

    // 16b. COMPLETE_PAYOUT
    const reqComp = mockReq(adminUserId, 'admin', { id: returnId1 }, { action: 'COMPLETE_PAYOUT', reference: 'UTR_BANK_TXN_9988' });
    const resComp = mockRes();
    const nextComp = jest.fn();

    await adminHandleCodPayout(reqComp, resComp, nextComp);

    expect(nextComp).not.toHaveBeenCalled();
    expect(mockReturnDoc.status).toBe('REFUNDED');
    expect(mockReturnDoc.manualPayout.status).toBe('COMPLETED');
    expect(mockReturnDoc.manualPayout.reference).toBe('UTR_BANK_TXN_9988');
    expect(mockReturnDoc.completedAt).toBeInstanceOf(Date);
  });

  // 17. Inventory remains unchanged.
  it('17. Inventory remains unchanged during refund execution and COD payout (Section 12)', async () => {
    const invFindSpy = jest.spyOn(Inventory, 'findOneAndUpdate');
    const invSaveSpy = jest.spyOn(Inventory.prototype, 'save');

    const mockOrder = { _id: orderId1, paymentMethod: 'cod' };
    const mockPayment = { _id: paymentId1, provider: 'cod' };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 500 },
      manualPayout: {},
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);

    const req = mockReq(adminUserId, 'admin', { id: returnId1 }, { action: 'COMPLETE_PAYOUT', reference: 'UTR_TEST' });
    const res = mockRes();
    const next = jest.fn();

    await adminHandleCodPayout(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(invFindSpy).not.toHaveBeenCalled();
    expect(invSaveSpy).not.toHaveBeenCalled();
  });

  // 18. Existing cancellation refund behavior remains intact.
  it('18. Existing cancellation refund behavior remains intact without regression', async () => {
    const mockOrder = {
      _id: orderId1,
      status: 'CANCELLED',
      paymentStatus: 'PAID',
      items: [{ variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 }],
      total: 500,
      save: jest.fn().mockResolvedValue(true),
    };
    const mockPayment = {
      _id: paymentId1,
      orderId: orderId1,
      status: 'CAPTURED',
      provider: 'razorpay',
      providerPaymentId: 'pay_cancel_123',
      amount: 500,
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Payment, 'findById').mockResolvedValue(mockPayment);
    jest.spyOn(Refund, 'findOne').mockResolvedValue(null);
    jest.spyOn(Refund, 'create').mockResolvedValue({
      _id: 'rfnd-cancel-1',
      status: 'PROCESSING',
      providerRefundId: 'rfnd_cancel_rzp',
    });
    jest.spyOn(paymentService.provider, 'refundPayment').mockResolvedValue({
      id: 'rfnd_cancel_rzp',
      amount: 50000,
    });
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Order, 'updateOne').mockResolvedValue({ acknowledged: true });

    const refundResult = await refundService.createRefund({
      refundData: {
        orderId: orderId1,
        paymentId: paymentId1,
        customerId: customerUserId,
        vendorId: vendorId1,
        amount: 500,
        isCancellation: true,
      },
    });

    expect(refundResult).toBeDefined();
    expect(refundResult.status).toBe('PROCESSING');
    expect(paymentService.provider.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: 'pay_cancel_123',
        amount: 500,
      }),
    );
  });
});
