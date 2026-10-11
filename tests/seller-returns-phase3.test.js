import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { returnStateService } from '../app/services/return-state.service.js';
import {
  listVendorReturns,
  getVendorReturn,
  sellerReviewReturn,
  sellerApproveReturn,
  sellerMarkReturnReceived,
  sellerReadyForInspection,
  sellerSubmitInspection,
  sellerRaiseDispute,
  sellerResolveDispute,
  getReturnDetail,
} from '../app/controllers/return.controller.js';

describe('Phase 3: Seller Returns + Inspection + Dispute Backend Tests', () => {
  const sellerAUserId = new mongoose.Types.ObjectId().toHexString();
  const sellerBUserId = new mongoose.Types.ObjectId().toHexString();
  const customerId = new mongoose.Types.ObjectId().toHexString();

  const vendorAId = new mongoose.Types.ObjectId().toHexString();
  const vendorBId = new mongoose.Types.ObjectId().toHexString();

  const returnAId = new mongoose.Types.ObjectId().toHexString();
  const returnBId = new mongoose.Types.ObjectId().toHexString();

  const orderId = new mongoose.Types.ObjectId().toHexString();
  const vendorOrderId = new mongoose.Types.ObjectId().toHexString();
  const returnItemId = new mongoose.Types.ObjectId().toHexString();
  const variantId = new mongoose.Types.ObjectId().toHexString();

  const mockReq = (user, params = {}, body = {}, query = {}) => ({
    user: { sub: user },
    params,
    body,
    query,
    headers: { 'x-request-id': 'req-test-p3' },
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

  // 1. Seller can list own returns.
  it('1. Seller can list own returns', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockFind = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([
        {
          _id: returnAId,
          returnNumber: 'RUP-RET-AAA-1001',
          vendorId: vendorAId,
          orderId,
          status: 'REQUESTED',
          items: [returnItemId],
          toObject: () => ({
            _id: returnAId,
            returnNumber: 'RUP-RET-AAA-1001',
            vendorId: vendorAId,
            orderId,
            status: 'REQUESTED',
            items: [returnItemId],
          }),
        },
      ]),
    };
    jest.spyOn(Return, 'find').mockReturnValue(mockFind);
    jest.spyOn(Return, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: returnItemId, quantity: 1 }]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: orderId, orderNumber: 'ORD-1001' }) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, {}, {}, { page: '1', limit: '20' });
    const res = mockRes();
    const next = jest.fn();

    await listVendorReturns(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.items.length).toBe(1);
    expect(body.data.items[0].returnNumber).toBe('RUP-RET-AAA-1001');
    expect(body.data.items[0].vendorId).toBe(vendorAId);
  });

  // 2. Seller cannot see another seller's return in list.
  it("2. Seller cannot see another seller's returns in list (scoped by vendorId)", async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    let capturedFilter = null;
    jest.spyOn(Return, 'countDocuments').mockImplementation((filter) => {
      capturedFilter = filter;
      return Promise.resolve(0);
    });
    const mockFind = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };
    jest.spyOn(Return, 'find').mockReturnValue(mockFind);

    const req = mockReq(sellerAUserId, {}, {}, {});
    const res = mockRes();
    const next = jest.fn();

    await listVendorReturns(req, res, next);

    expect(capturedFilter.vendorId).toEqual(vendorAId);
    expect(capturedFilter.vendorId).not.toEqual(vendorBId);
  });

  // 3. Seller can retrieve own return detail.
  it('3. Seller can retrieve own return detail', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    jest.spyOn(Return, 'findOne').mockResolvedValue({
      _id: returnAId,
      returnNumber: 'RUP-RET-AAA-1001',
      vendorId: vendorAId,
      orderId,
      status: 'REQUESTED',
      items: [returnItemId],
      toObject: () => ({
        _id: returnAId,
        returnNumber: 'RUP-RET-AAA-1001',
        vendorId: vendorAId,
        orderId,
        status: 'REQUESTED',
        items: [returnItemId],
      }),
    });
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: returnItemId, quantity: 1 }]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: orderId, orderNumber: 'ORD-1001' }) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, { id: returnAId });
    const res = mockRes();
    const next = jest.fn();

    await getVendorReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data._id).toBe(returnAId);
    expect(body.data.order.orderNumber).toBe('ORD-1001');
  });

  // 4. Wrong seller receives 403 error when accessing another seller's return.
  it("4. Wrong seller receives 403 when trying to access another seller's return", async () => {
    // Seller B tries to access Return A (which belongs to Vendor A)
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorBId, ownerUserId: sellerBUserId });
    // findOne with vendorBId returns null
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    // But return exists for vendorAId
    jest.spyOn(Return, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: returnAId, vendorId: vendorAId }),
    });

    const req = mockReq(sellerBUserId, { id: returnAId });
    const res = mockRes();
    const next = jest.fn();

    await getVendorReturn(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  // 5. REQUESTED → UNDER_REVIEW works.
  it('5. REQUESTED → UNDER_REVIEW works via seller review action', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'REQUESTED',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, { id: returnAId }, { notes: 'Checking return reason' });
    const res = mockRes();
    const next = jest.fn();

    await sellerReviewReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDoc.status).toBe('UNDER_REVIEW');
    expect(mockDoc.reviewedBy).toBe(sellerAUserId);
    expect(mockDoc.save).toHaveBeenCalled();
  });

  // 6. Invalid status transition is rejected.
  it('6. Invalid status transition is rejected', async () => {
    await expect(
      returnStateService.transitionReturnStatus('REJECTED', 'APPROVED', { actorType: 'VENDOR' })
    ).rejects.toThrow('Cannot transition from REJECTED to APPROVED');

    await expect(
      returnStateService.transitionReturnStatus('REQUESTED', 'APPROVED_FOR_REFUND', { actorType: 'VENDOR' })
    ).rejects.toThrow();
  });

  // 7. APPROVED → RETURN_RECEIVED works.
  it('7. APPROVED → RETURN_RECEIVED works via seller receive action', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'APPROVED',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, { id: returnAId }, { notes: 'Package arrived at seller facility' });
    const res = mockRes();
    const next = jest.fn();

    await sellerMarkReturnReceived(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDoc.status).toBe('RETURN_RECEIVED');
    expect(mockDoc.receivedBy).toBe(sellerAUserId);
    expect(mockDoc.receivedAt).toBeInstanceOf(Date);
  });

  // 8. RETURN_RECEIVED → INSPECTION_PENDING works.
  it('8. RETURN_RECEIVED → INSPECTION_PENDING works', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'RETURN_RECEIVED',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, { id: returnAId });
    const res = mockRes();
    const next = jest.fn();

    await sellerReadyForInspection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDoc.status).toBe('INSPECTION_PENDING');
  });

  // 9. Inspection PASS records correctly.
  it('9. Inspection PASS records correctly (INSPECTION_PENDING → INSPECTION_PASSED)', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'INSPECTION_PENDING',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASSED',
      condition: 'INTACT',
      notes: 'Item in original condition with tags',
      proofImages: ['https://example.com/proof-pass.jpg'],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDoc.status).toBe('INSPECTION_PASSED');
    expect(mockDoc.inspection.result).toBe('PASSED');
    expect(mockDoc.inspection.condition).toBe('INTACT');
    expect(mockDoc.inspection.inspectedBy).toBe(sellerAUserId);
    expect(mockDoc.inspection.proofImages).toEqual(['https://example.com/proof-pass.jpg']);
  });

  // 10. Inspection FAIL requires a reason.
  it('10. Inspection FAIL requires a reason/notes', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'INSPECTION_PENDING',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn(),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    // Empty notes
    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'FAILED',
      condition: 'DAMAGED',
      notes: '',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(400);
  });

  // 11. Seller cannot mark return REFUNDED.
  it('11. Seller cannot mark return REFUNDED', async () => {
    await expect(
      returnStateService.transitionReturnStatus('INSPECTION_PASSED', 'REFUNDED', { actorType: 'VENDOR' })
    ).rejects.toThrow();

    await expect(
      returnStateService.transitionReturnStatus('INSPECTION_PASSED', 'APPROVED_FOR_REFUND', { actorType: 'VENDOR' })
    ).rejects.toThrow('Vendors are not permitted to transition return to APPROVED_FOR_REFUND');
  });

  // 12. Seller cannot change refund amount.
  it('12. Seller inspection and review endpoints do not allow changing refund amounts', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'INSPECTION_PENDING',
      vendorId: vendorAId,
      refundDetails: { amount: 500 },
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    // Attacker passes custom refundAmount in body - strict schema rejects arbitrary parameters
    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASSED',
      condition: 'INTACT',
      notes: 'Pass notes',
      refundAmount: 999999,
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.name).toBe('ZodError');
    expect(mockDoc.refundDetails.amount).toBe(500); // Unchanged
  });

  // 13. Seller cannot modify inventory.
  it('13. Seller inspection PASS does NOT modify inventory (Section 10)', async () => {
    const invUpdateSpy = jest.spyOn(Inventory, 'findOneAndUpdate');
    const invSaveSpy = jest.spyOn(Inventory.prototype, 'save');

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'INSPECTION_PENDING',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASSED',
      condition: 'INTACT',
      notes: 'Passed inspection',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(invUpdateSpy).not.toHaveBeenCalled();
    expect(invSaveSpy).not.toHaveBeenCalled();
  });

  // 14. Seller can raise dispute.
  it('14. Seller can raise dispute (INSPECTION_FAILED → DISPUTED)', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'INSPECTION_FAILED',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      reason: 'WRONG_ITEM_RETURNED',
      description: 'Customer returned a completely different brand shirt.',
      evidence: ['https://example.com/wrong-item.jpg'],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerRaiseDispute(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDoc.status).toBe('DISPUTED');
    expect(mockDoc.dispute.reason).toBe('WRONG_ITEM_RETURNED');
    expect(mockDoc.dispute.disputedBy).toBe(sellerAUserId);
    expect(mockDoc.dispute.status).toBe('PENDING_ADMIN_REVIEW');
  });

  // 15. Seller cannot resolve dispute.
  it('15. Seller cannot resolve dispute (403 forbidden)', async () => {
    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerResolveDispute(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  // 16. Customer ownership remains unaffected.
  it('16. Customer ownership remains unaffected on customer return detail API', async () => {
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);

    // Another customer tries to access returnAId
    const wrongCustomerId = new mongoose.Types.ObjectId().toHexString();
    const req = mockReq(wrongCustomerId, { id: returnAId });
    const res = mockRes();
    const next = jest.fn();

    await getReturnDetail(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(404);
  });

  // 17. Multi-vendor seller isolation works.
  it('17. Multi-vendor seller isolation works across actions', async () => {
    // Seller A has Vendor A; Return B belongs to Vendor B
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(Return, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: returnBId, vendorId: vendorBId }),
    });

    const reqReview = mockReq(sellerAUserId, { id: returnBId }, { notes: 'Hack' });
    const resReview = mockRes();
    const nextReview = jest.fn();
    await sellerReviewReturn(reqReview, resReview, nextReview);
    expect(nextReview.mock.calls[0][0].statusCode).toBe(403);

    const reqReceive = mockReq(sellerAUserId, { id: returnBId }, {});
    const resReceive = mockRes();
    const nextReceive = jest.fn();
    await sellerMarkReturnReceived(reqReceive, resReceive, nextReceive);
    expect(nextReceive.mock.calls[0][0].statusCode).toBe(403);

    const reqInspect = mockReq(sellerAUserId, { id: returnBId }, { result: 'PASSED' });
    const resInspect = mockRes();
    const nextInspect = jest.fn();
    await sellerSubmitInspection(reqInspect, resInspect, nextInspect);
    expect(nextInspect.mock.calls[0][0].statusCode).toBe(403);

    const reqDispute = mockReq(sellerAUserId, { id: returnBId }, { reason: 'ITEM_USED', description: 'Used' });
    const resDispute = mockRes();
    const nextDispute = jest.fn();
    await sellerRaiseDispute(reqDispute, resDispute, nextDispute);
    expect(nextDispute.mock.calls[0][0].statusCode).toBe(403);
  });

  // 18. Existing Phase 1/2 return tests still pass.
  it('18. Existing Phase 1/2 return transitions and statuses remain compatible', async () => {
    const state = await returnStateService.transitionReturnStatus('REQUESTED', 'UNDER_REVIEW');
    expect(state.nextStatus).toBe('UNDER_REVIEW');
    const stateApprove = await returnStateService.transitionReturnStatus('UNDER_REVIEW', 'APPROVED');
    expect(stateApprove.nextStatus).toBe('APPROVED');
  });

  // 19. Seller can approve own UNDER_REVIEW return
  it('19. Seller can approve own UNDER_REVIEW return', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'UNDER_REVIEW',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, { id: returnAId }, { notes: 'Return looks valid, approved' });
    const res = mockRes();
    const next = jest.fn();

    await sellerApproveReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDoc.status).toBe('APPROVED');
    expect(mockDoc.approvedBy).toBe(sellerAUserId);
    expect(mockDoc.approvedAt).toBeInstanceOf(Date);
    expect(mockDoc.statusHistory).toHaveLength(1);
    expect(mockDoc.statusHistory[0].status).toBe('APPROVED');
    expect(mockDoc.statusHistory[0].actorType).toBe('VENDOR');
    expect(mockDoc.statusHistory[0].changedBy).toBe(sellerAUserId);
    expect(mockDoc.statusHistory[0].notes).toBe('Return looks valid, approved');
    expect(mockDoc.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  // 20. Wrong seller receives 403
  it('20. Wrong seller receives 403 when trying to approve another seller return', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(Return, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: returnBId, vendorId: vendorBId }),
    });

    const req = mockReq(sellerAUserId, { id: returnBId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerApproveReturn(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  // 21. REQUESTED cannot be approved directly by seller
  it('21. REQUESTED return cannot be approved directly by seller', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'REQUESTED',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerApproveReturn(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('INVALID_RETURN_TRANSITION');
    expect(mockDoc.save).not.toHaveBeenCalled();
  });

  // 22. APPROVED return cannot be approved again / idempotent safe behavior
  it('22. APPROVED return returns idempotent 200 without duplicate save', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'APPROVED',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerApproveReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDoc.save).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    const jsonOutput = res.json.mock.calls[0][0];
    expect(jsonOutput.message).toBe('Return already approved');
  });

  // 23. Payment, refund, and inventory remain untouched on seller approve
  it('23. Payment, refund, and inventory remain unchanged during seller approval', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = {
      _id: returnAId,
      status: 'UNDER_REVIEW',
      vendorId: vendorAId,
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const inventorySpy = jest.spyOn(Inventory, 'updateOne');

    const req = mockReq(sellerAUserId, { id: returnAId }, {});
    const res = mockRes();
    const next = jest.fn();

    await sellerApproveReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(inventorySpy).not.toHaveBeenCalled();
    expect(mockDoc.status).toBe('APPROVED');
  });

  // 24. Seller cannot reject (vendor restriction on REJECTED preserved)
  it('24. Seller cannot transition return to REJECTED (vendor restriction preserved)', async () => {
    await expect(
      returnStateService.transitionReturnStatus('UNDER_REVIEW', 'REJECTED', { actorType: 'VENDOR' })
    ).rejects.toThrow('Vendors are not permitted to transition return to REJECTED');
  });

  // 25. Existing admin approve and reject behavior remains unchanged
  it('25. Existing admin approve and reject transitions remain intact', async () => {
    const adminApproveState = await returnStateService.transitionReturnStatus('UNDER_REVIEW', 'APPROVED', {
      actorType: 'ADMIN',
      actorId: 'admin-user-id',
    });
    expect(adminApproveState.nextStatus).toBe('APPROVED');

    const adminRejectState = await returnStateService.transitionReturnStatus('UNDER_REVIEW', 'REJECTED', {
      actorType: 'ADMIN',
      actorId: 'admin-user-id',
    });
    expect(adminRejectState.nextStatus).toBe('REJECTED');
  });
});
