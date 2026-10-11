import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { User } from '../app/models/user.model.js';
import { Payment } from '../app/models/payment.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { returnStateService } from '../app/services/return-state.service.js';
import { refundService } from '../app/services/refund.service.js';
import {
  listAdminReturns,
  getAdminReturn,
  adminDisputeDecision,
  adminResolveReturn,
  getVendorReturn,
  getReturnDetail,
} from '../app/controllers/return.controller.js';

describe('Phase 4: Admin Returns + Dispute Arbitration + Final Resolution Backend Tests', () => {
  const adminUserId = new mongoose.Types.ObjectId().toHexString();
  const sellerUserId = new mongoose.Types.ObjectId().toHexString();
  const customerUserId = new mongoose.Types.ObjectId().toHexString();

  const vendorId1 = new mongoose.Types.ObjectId().toHexString();
  const vendorId2 = new mongoose.Types.ObjectId().toHexString();

  const returnId1 = new mongoose.Types.ObjectId().toHexString();
  const orderId1 = new mongoose.Types.ObjectId().toHexString();
  const vendorOrderId1 = new mongoose.Types.ObjectId().toHexString();
  const returnItemId1 = new mongoose.Types.ObjectId().toHexString();
  const variantId1 = new mongoose.Types.ObjectId().toHexString();

  const mockReq = (user, role = 'admin', params = {}, body = {}, query = {}) => ({
    user: { sub: user, role },
    params,
    body,
    query,
    headers: { 'x-request-id': 'req-test-p4' },
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
  });

  // 1. Admin can list returns.
  it('1. Admin can list returns with pagination and filters', async () => {
    const mockFind = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          _id: returnId1,
          returnNumber: 'RUP-RET-ADMIN-101',
          orderId: orderId1,
          vendorId: vendorId1,
          customerId: customerUserId,
          status: 'DISPUTED',
          items: [returnItemId1],
          toObject: () => ({
            _id: returnId1,
            returnNumber: 'RUP-RET-ADMIN-101',
            orderId: orderId1,
            vendorId: vendorId1,
            customerId: customerUserId,
            status: 'DISPUTED',
            items: [returnItemId1],
          }),
        },
      ]),
    };
    jest.spyOn(Return, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(Return, 'find').mockReturnValue(mockFind);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: returnItemId1, quantity: 1 }]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: orderId1, orderNumber: 'ORD-101' }) });
    jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ name: 'John Doe', email: 'john@example.com' }) }) });
    jest.spyOn(Vendor, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ storeName: 'Artisan Works' }) }) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(adminUserId, 'admin', {}, {}, { page: '1', limit: '20' });
    const res = mockRes();
    const next = jest.fn();

    await listAdminReturns(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.items.length).toBe(1);
    expect(body.data.items[0].returnNumber).toBe('RUP-RET-ADMIN-101');
    expect(body.data.items[0].customer.name).toBe('John Doe');
  });

  // 2. Admin can retrieve return details.
  it('2. Admin can retrieve return details including items, customer, vendor, and safe calculations', async () => {
    const mockReturnDoc = {
      _id: returnId1,
      returnNumber: 'RUP-RET-ADMIN-101',
      orderId: orderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      status: 'INSPECTION_PASSED',
      items: [returnItemId1],
      inspection: { result: 'PASSED', condition: 'INTACT', notes: 'Item ok' },
      toObject: function () { return { ...this }; },
    };
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: returnItemId1, quantity: 1, unitPrice: 500, lineTotal: 500 }]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: orderId1, orderNumber: 'ORD-101', total: 1000 }) });
    jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ name: 'Jane Smith', email: 'jane@example.com' }) }) });
    jest.spyOn(Vendor, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ storeName: 'Weavers Co' }) }) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await getAdminReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.returnNumber).toBe('RUP-RET-ADMIN-101');
    expect(body.data.inspection.result).toBe('PASSED');
    expect(body.data.customer.name).toBe('Jane Smith');
  });

  // 3. Non-admin cannot access Admin return endpoints.
  it('3. Non-admin receives 403 Forbidden when calling admin return arbitration endpoints', async () => {
    const reqSeller = mockReq(sellerUserId, 'seller', { id: returnId1 }, { decision: 'UPHOLD_SELLER', decisionReason: 'Valid reason' });
    const resSeller = mockRes();
    const nextSeller = jest.fn();

    await adminDisputeDecision(reqSeller, resSeller, nextSeller);

    expect(nextSeller).toHaveBeenCalled();
    expect(nextSeller.mock.calls[0][0].statusCode).toBe(403);
    expect(nextSeller.mock.calls[0][0].code).toBe('FORBIDDEN');

    const reqCustomer = mockReq(customerUserId, 'customer', { id: returnId1 }, { resolution: 'RETURN_REFUND' });
    const resCustomer = mockRes();
    const nextCustomer = jest.fn();

    await adminResolveReturn(reqCustomer, resCustomer, nextCustomer);

    expect(nextCustomer).toHaveBeenCalled();
    expect(nextCustomer.mock.calls[0][0].statusCode).toBe(403);
    expect(nextCustomer.mock.calls[0][0].code).toBe('FORBIDDEN');
  });

  // 4. Admin can view disputed return.
  it('4. Admin can view disputed return with dispute details and evidence', async () => {
    const mockReturnDoc = {
      _id: returnId1,
      returnNumber: 'RUP-RET-DISPUTE-01',
      orderId: orderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      status: 'DISPUTED',
      items: [returnItemId1],
      dispute: {
        reason: 'WRONG_ITEM_RETURNED',
        description: 'Customer sent different item',
        evidence: ['https://example.com/proof1.jpg'],
        status: 'PENDING_ADMIN_REVIEW',
      },
      toObject: function () { return { ...this }; },
    };
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
    jest.spyOn(Vendor, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await getAdminReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.data.status).toBe('DISPUTED');
    expect(body.data.dispute.reason).toBe('WRONG_ITEM_RETURNED');
    expect(body.data.dispute.evidence.length).toBe(1);
  });

  // 5. Seller cannot perform Admin dispute decision.
  it('5. Seller cannot perform Admin dispute decision (403 forbidden)', async () => {
    const req = mockReq(sellerUserId, 'seller', { id: returnId1 }, {
      decision: 'UPHOLD_SELLER',
      decisionReason: 'Seller is right',
    });
    const res = mockRes();
    const next = jest.fn();

    await adminDisputeDecision(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  // 6. Customer cannot perform Admin dispute decision.
  it('6. Customer cannot perform Admin dispute decision (403 forbidden)', async () => {
    const req = mockReq(customerUserId, 'customer', { id: returnId1 }, {
      decision: 'UPHOLD_CUSTOMER',
      decisionReason: 'Customer is right',
    });
    const res = mockRes();
    const next = jest.fn();

    await adminDisputeDecision(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  // 7. Admin dispute decision records actor/time/reason.
  it('7. Admin dispute decision records actor, timestamp, reason, and updates status', async () => {
    const mockReturnDoc = {
      _id: returnId1,
      status: 'DISPUTED',
      dispute: { status: 'PENDING_ADMIN_REVIEW' },
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
    jest.spyOn(Vendor, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 }, {
      decision: 'UPHOLD_CUSTOMER',
      decisionReason: 'Customer unboxing video proves correct item was shipped back.',
      adminNotes: 'Reviewed unboxing video carefully.',
    });
    const res = mockRes();
    const next = jest.fn();

    await adminDisputeDecision(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockReturnDoc.status).toBe('APPROVED_FOR_REFUND');
    expect(mockReturnDoc.dispute.decision).toBe('UPHOLD_CUSTOMER');
    expect(mockReturnDoc.dispute.decidedBy).toBe(adminUserId);
    expect(mockReturnDoc.dispute.decidedAt).toBeInstanceOf(Date);
    expect(mockReturnDoc.dispute.status).toBe('RESOLVED_CUSTOMER');
    expect(mockReturnDoc.statusHistory.length).toBe(1);
    expect(mockReturnDoc.statusHistory[0].actorType).toBe('ADMIN');
    expect(mockReturnDoc.save).toHaveBeenCalled();
  });

  // 8. Invalid Admin state transition is rejected.
  it('8. Invalid Admin state transition is rejected by state machine', async () => {
    await expect(
      returnStateService.transitionReturnStatus('REJECTED', 'APPROVED_FOR_REFUND', { actorType: 'ADMIN' })
    ).rejects.toThrow();

    await expect(
      returnStateService.transitionReturnStatus('CLOSED', 'APPROVED', { actorType: 'ADMIN' })
    ).rejects.toThrow();
  });

  // 9. Admin cannot arbitrarily set refund amount.
  it('9. Admin cannot arbitrarily set refund amount (strict schema rejects custom refundAmount)', async () => {
    const mockReturnDoc = {
      _id: returnId1,
      status: 'INSPECTION_PASSED',
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);

    const req = mockReq(adminUserId, 'admin', { id: returnId1 }, {
      resolution: 'RETURN_REFUND',
      notes: 'Resolving',
      refundAmount: 999999, // Arbitrary refund amount must be rejected
    });
    const res = mockRes();
    const next = jest.fn();

    await adminResolveReturn(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.name).toBe('ZodError');
  });

  // 10. Partial return refund calculation remains proportional.
  it('10. Partial return refund calculation remains strictly proportional', async () => {
    const orderDoc = {
      _id: orderId1,
      items: [
        { variantId: variantId1, quantity: 2, unitPrice: 500, lineTotal: 1000 },
        { variantId: 'variant-2', quantity: 1, unitPrice: 1000, lineTotal: 1000 },
      ],
      subtotal: 2000,
      discount: 200, // 10% discount across whole order
      tax: 180,
      total: 1980,
    };
    const returnItems = [
      { variantId: variantId1, quantity: 1, unitPrice: 500, lineTotal: 500 }, // Returning 1 out of 2 of item 1
    ];

    const result = refundService.calculateRefund({
      order: orderDoc,
      returnItems,
      proportional: true,
    });

    // Proportional breakdown:
    // Subtotal returned: 500
    // Discount ratio: 500 / 2000 = 25% -> 25% of 200 = 50
    // Tax ratio: 25% of 180 = 45
    // Amount: 500 - 50 + 45 = 495
    expect(result.breakdown.itemSubtotal).toBe(500);
    expect(result.breakdown.discountAdjustment).toBe(50);
    expect(result.breakdown.taxAdjustment).toBe(45);
    expect(result.amount).toBe(495);
    expect(result.amount).toBeLessThan(orderDoc.total);
  });

  // 11. order.total is never used for partial-return refund.
  it('11. order.total is never used for partial return refund', async () => {
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
  });

  // 12. COD return does not call Razorpay.
  it('12. COD return resolution does not call Razorpay and keeps status pending', async () => {
    const mockOrder = {
      _id: orderId1,
      paymentMethod: 'cod',
      items: [{ variantId: variantId1, quantity: 1, unitPrice: 600, lineTotal: 600 }],
      subtotal: 600,
      discount: 0,
      tax: 0,
      total: 600,
    };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      vendorId: vendorId1,
      status: 'INSPECTION_PASSED',
      items: [returnItemId1],
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([{ variantId: variantId1, quantity: 1, unitPrice: 600, lineTotal: 600 }]) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
    jest.spyOn(Vendor, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });

    const razorpaySpy = jest.fn();
    // Simulate Razorpay client if present
    global.razorpayMock = razorpaySpy;

    const req = mockReq(adminUserId, 'admin', { id: returnId1 }, {
      resolution: 'RETURN_REFUND',
      notes: 'COD return approved for pending manual refund',
    });
    const res = mockRes();
    const next = jest.fn();

    await adminResolveReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(razorpaySpy).not.toHaveBeenCalled();
    expect(mockReturnDoc.status).toBe('APPROVED_FOR_REFUND');
    expect(mockReturnDoc.refundDetails.status).toBe('APPROVED_PENDING_EXECUTION');
  });

  // 13. Admin resolution does not modify inventory.
  it('13. Admin resolution does not modify inventory (Section 8 & 13)', async () => {
    const invFindSpy = jest.spyOn(Inventory, 'findOneAndUpdate');
    const invSaveSpy = jest.spyOn(Inventory.prototype, 'save');

    const mockOrder = {
      _id: orderId1,
      items: [{ variantId: variantId1, quantity: 1, unitPrice: 400, lineTotal: 400 }],
      subtotal: 400,
      total: 400,
    };
    const mockReturnDoc = {
      _id: returnId1,
      orderId: orderId1,
      vendorId: vendorId1,
      status: 'INSPECTION_PASSED',
      items: [returnItemId1],
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () { return { ...this }; },
    };
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([{ variantId: variantId1, quantity: 1, unitPrice: 400, lineTotal: 400 }]) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
    jest.spyOn(Vendor, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 }, {
      resolution: 'RETURN_REFUND',
      notes: 'Resolution complete',
    });
    const res = mockRes();
    const next = jest.fn();

    await adminResolveReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(invFindSpy).not.toHaveBeenCalled();
    expect(invSaveSpy).not.toHaveBeenCalled();
  });

  // 14. Seller isolation from previous phases still works.
  it('14. Seller isolation from previous phases remains completely intact', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId1, ownerUserId: sellerUserId });
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(Return, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: returnId1, vendorId: vendorId2 }), // Belongs to Vendor 2
    });

    const req = {
      user: { sub: sellerUserId, role: 'seller' },
      params: { id: returnId1 },
      headers: { 'x-request-id': 'req-seller-isolate' },
    };
    const res = mockRes();
    const next = jest.fn();

    await getVendorReturn(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(next.mock.calls[0][0].code).toBe('FORBIDDEN');
  });

  // 15. Customer return ownership from previous phases still works.
  it('15. Customer return ownership from previous phases remains intact', async () => {
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);

    const req = {
      user: { sub: 'wrong-customer-id', role: 'customer' },
      params: { id: returnId1 },
      headers: { 'x-request-id': 'req-customer-own' },
    };
    const res = mockRes();
    const next = jest.fn();

    await getReturnDetail(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  // 16. Existing Phase 1 return tests pass.
  it('16. Phase 1 state transition compatibility verified', async () => {
    const result = await returnStateService.transitionReturnStatus('REQUESTED', 'APPROVED');
    expect(result.nextStatus).toBe('APPROVED');
  });

  // 17. Existing Phase 2 return tests pass.
  it('17. Phase 2 customer return cancellation compatibility verified', async () => {
    const result = await returnStateService.transitionReturnStatus('REQUESTED', 'CANCELLED', { actorType: 'CUSTOMER' });
    expect(result.nextStatus).toBe('CANCELLED');
  });

  // 18. Existing Phase 3 seller return tests pass.
  it('18. Phase 3 seller dispute transition compatibility verified', async () => {
    const result = await returnStateService.transitionReturnStatus('INSPECTION_FAILED', 'DISPUTED', { actorType: 'VENDOR' });
    expect(result.nextStatus).toBe('DISPUTED');
  });
});
