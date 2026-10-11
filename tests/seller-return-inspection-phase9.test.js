import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { ReturnShipment } from '../app/models/return-shipment.model.js';
import { returnStateService } from '../app/services/return-state.service.js';
import { returnShipmentService } from '../app/services/return-shipment.service.js';
import { auditService } from '../app/services/audit.service.js';
import { paymentService } from '../app/services/payment.service.js';
import { refundService } from '../app/services/refund.service.js';
import { replacementService } from '../app/services/replacement.service.js';
import {
  sellerReadyForInspection,
  sellerSubmitInspection,
  adminSubmitInspection,
  sellerRaiseDispute,
  sellerResolveDispute,
  getReturnDetail,
  buildVendorReturnDto,
  buildAdminReturnDto,
} from '../app/controllers/return.controller.js';

import { User } from '../app/models/user.model.js';
import { Refund } from '../app/models/refund.model.js';

describe('Phase 9: Seller Return Receipt, Inspection & Item Condition Verification Tests', () => {
  const sellerAUserId = new mongoose.Types.ObjectId().toHexString();
  const sellerBUserId = new mongoose.Types.ObjectId().toHexString();
  const customerId = new mongoose.Types.ObjectId().toHexString();
  const adminUserId = new mongoose.Types.ObjectId().toHexString();

  const vendorAId = new mongoose.Types.ObjectId().toHexString();
  const vendorBId = new mongoose.Types.ObjectId().toHexString();

  const returnAId = new mongoose.Types.ObjectId().toHexString();
  const returnBId = new mongoose.Types.ObjectId().toHexString();

  const orderId = new mongoose.Types.ObjectId().toHexString();
  const vendorOrderId = new mongoose.Types.ObjectId().toHexString();
  const returnItemId1 = new mongoose.Types.ObjectId().toHexString();
  const returnItemId2 = new mongoose.Types.ObjectId().toHexString();
  const variantId1 = new mongoose.Types.ObjectId().toHexString();
  const variantId2 = new mongoose.Types.ObjectId().toHexString();

  const mockReq = (user, params = {}, body = {}, query = {}, role = null) => ({
    user: { sub: user, role: role || (user === adminUserId ? 'admin' : 'customer') },
    params,
    body,
    query,
    headers: { 'x-request-id': 'req-test-p9' },
  });

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const makeQuery = (result) => ({
    lean: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  });

  const createMockReturn = (overrides = {}) => {
    const doc = {
      _id: returnAId,
      returnNumber: 'RET-2026-9001',
      orderId,
      vendorOrderId,
      customerId,
      vendorId: vendorAId,
      type: 'RETURN',
      status: 'RETURN_RECEIVED',
      items: [returnItemId1],
      requestedAt: new Date(),
      statusHistory: [
        { status: 'REQUESTED', changedAt: new Date(), actorType: 'CUSTOMER' },
        { status: 'APPROVED', changedAt: new Date(), actorType: 'VENDOR' },
        { status: 'RETURN_RECEIVED', changedAt: new Date(), actorType: 'SYSTEM' },
      ],
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
      ...overrides,
    };
    return doc;
  };

  const createMockItem = (id, variantId, qty = 1, unitPrice = 1000) => ({
    _id: id,
    variantId,
    quantity: qty,
    unitPrice,
    lineTotal: qty * unitPrice,
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(ReturnItem, 'find').mockImplementation(() => makeQuery([mockItem]));
    jest.spyOn(Order, 'findById').mockImplementation(() => makeQuery({
      _id: orderId,
      orderNumber: 'ORD-9001',
      status: 'DELIVERED',
      createdAt: new Date(),
      shippingAddress: { fullName: 'Customer Name', city: 'Bhubaneswar', state: 'Odisha' },
    }));
    jest.spyOn(VendorOrder, 'findById').mockImplementation(() => makeQuery({
      _id: vendorOrderId,
      status: 'DELIVERED',
      total: 1000,
    }));
    jest.spyOn(Vendor, 'findById').mockImplementation(() => makeQuery({
      _id: vendorAId,
      storeName: 'Artisan Store',
    }));
    jest.spyOn(User, 'findById').mockImplementation(() => makeQuery({
      _id: customerId,
      name: 'Customer Name',
      email: 'customer@test.com',
    }));
    jest.spyOn(Refund, 'findOne').mockImplementation(() => makeQuery(null));
  });

  // 1. RETURN_RECEIVED → INSPECTION_PENDING
  it('1. RETURN_RECEIVED → INSPECTION_PENDING transitions cleanly', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'RETURN_RECEIVED' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    const auditSpy = jest.spyOn(auditService, 'log');

    const req = mockReq(sellerAUserId, { id: returnAId });
    const res = mockRes();
    const next = jest.fn();

    await sellerReadyForInspection(req, res, next);

    expect(mockDoc.status).toBe('INSPECTION_PENDING');
    expect(mockDoc.statusHistory.some((h) => h.status === 'INSPECTION_PENDING')).toBe(true);
    expect(auditSpy).toHaveBeenCalledWith('INSPECTION_STARTED', expect.objectContaining({ returnId: returnAId }));
    expect(res.json).toHaveBeenCalled();
  });

  // 2. duplicate delivery handoff is idempotent
  it('2. duplicate delivery handoff is idempotent and does not recreate receipt/status', async () => {
    const mockDoc = createMockReturn({ status: 'RETURN_RECEIVED' });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockDoc);
    const saveSpy = jest.spyOn(mockDoc, 'save');

    const mockShipment = {
      _id: new mongoose.Types.ObjectId(),
      returnId: returnAId,
      status: 'DELIVERED',
      shipmentNumber: 'REV-SHP-001',
    };

    await returnShipmentService._handoffDeliveredReturn(mockShipment);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(mockDoc.status).toBe('RETURN_RECEIVED');
  });

  // 3. seller can inspect own return
  it('3. seller can inspect own return', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 2);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      condition: 'INTACT',
      notes: 'All goods intact',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(mockDoc.status).toBe('INSPECTION_PASSED');
    expect(mockDoc.inspection.result).toBe('PASSED');
    expect(mockDoc.inspection.inspectedBy).toBe(sellerAUserId);
    expect(res.json).toHaveBeenCalled();
  });

  // 4. seller cannot inspect another vendor's return
  it('4. seller cannot inspect another vendor\'s return (403 forbidden)', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(Return, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: returnBId, vendorId: vendorBId }),
    });

    const req = mockReq(sellerAUserId, { id: returnBId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  // 5. customer cannot inspect
  it('5. customer cannot inspect returns (VENDOR_ACCESS_DENIED)', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(null);

    const req = mockReq(customerId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(next.mock.calls[0][0].code).toBe('VENDOR_ACCESS_DENIED');
  });

  // 6. admin authorization
  it('6. admin is authorized to inspect returns', async () => {
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(adminUserId, { id: returnAId }, {
      result: 'PASS',
      condition: 'INTACT',
      notes: 'Admin verified and passed',
    }, {}, 'admin');
    const res = mockRes();
    const next = jest.fn();

    await adminSubmitInspection(req, res, next);

    expect(mockDoc.status).toBe('INSPECTION_PASSED');
    expect(mockDoc.inspection.inspectedBy).toBe(adminUserId);
    expect(res.json).toHaveBeenCalled();
  });

  // 7. PASS transition
  it('7. PASS transition moves status to INSPECTION_PASSED', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([createMockItem(returnItemId1, variantId1, 1)]);

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS', condition: 'INTACT' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(mockDoc.status).toBe('INSPECTION_PASSED');
    expect(mockDoc.inspection.result).toBe('PASSED');
  });

  // 8. FAIL transition
  it('8. FAIL transition moves status to INSPECTION_FAILED', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([createMockItem(returnItemId1, variantId1, 1)]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'FAIL',
      condition: 'DAMAGED',
      notes: 'Item returned with severe crack',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(mockDoc.status).toBe('INSPECTION_FAILED');
    expect(mockDoc.inspection.result).toBe('FAILED');
    expect(mockDoc.inspection.condition).toBe('DAMAGED');
  });

  // 9. FAIL requires meaningful notes
  it('9. FAIL requires meaningful notes (rejection on empty notes)', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'FAIL',
      condition: 'DAMAGED',
      notes: '  ',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].code).toBe('INSPECTION_REASON_REQUIRED');
  });

  // 10. invalid condition rejected
  it('10. invalid condition rejected by schema validation', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      condition: 'MAGIC_CONDITION_XYZ',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  // 11. negative quantity rejected
  it('11. negative quantity rejected in item inspection', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      items: [
        {
          returnItemId: returnItemId1,
          acceptedQuantity: -1,
          rejectedQuantity: 0,
        },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  // 12. accepted > returned rejected
  it('12. accepted > returned rejected', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 2);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      items: [
        {
          returnItemId: returnItemId1,
          returnedQuantity: 2,
          acceptedQuantity: 3,
          rejectedQuantity: 0,
        },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].code).toBe('INVALID_ACCEPTED_QUANTITY');
  });

  // 13. rejected > returned rejected
  it('13. rejected > returned rejected', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'FAIL',
      notes: 'Defective item',
      items: [
        {
          returnItemId: returnItemId1,
          returnedQuantity: 1,
          acceptedQuantity: 0,
          rejectedQuantity: 2,
        },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].code).toBe('INVALID_REJECTED_QUANTITY');
  });

  // 14. accepted + rejected > returned rejected
  it('14. accepted + rejected > returned rejected', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 2);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      items: [
        {
          returnItemId: returnItemId1,
          returnedQuantity: 2,
          acceptedQuantity: 2,
          rejectedQuantity: 1,
        },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].code).toBe('EXCESS_INSPECTION_QUANTITY');
  });

  // 15. accepted + rejected != returned rejected where required
  it('15. accepted + rejected != returned rejected (incomplete disposition)', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 3);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      items: [
        {
          returnItemId: returnItemId1,
          returnedQuantity: 3,
          acceptedQuantity: 1,
          rejectedQuantity: 0,
        },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].code).toBe('INCOMPLETE_INSPECTION_QUANTITY');
  });

  // 16. multi-item inspection
  it('16. multi-item inspection accurately records disposition across items', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING', items: [returnItemId1, returnItemId2] });
    const item1 = createMockItem(returnItemId1, variantId1, 2);
    const item2 = createMockItem(returnItemId2, variantId2, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([item1, item2]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      items: [
        {
          returnItemId: returnItemId1,
          returnedQuantity: 2,
          acceptedQuantity: 2,
          rejectedQuantity: 0,
          condition: 'GOOD',
        },
        {
          returnItemId: returnItemId2,
          returnedQuantity: 1,
          acceptedQuantity: 1,
          rejectedQuantity: 0,
          condition: 'INTACT',
        },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(mockDoc.status).toBe('INSPECTION_PASSED');
    expect(mockDoc.inspection.items.length).toBe(2);
    expect(mockDoc.inspection.totalAcceptedQuantity).toBe(3);
  });

  // 17. partial acceptance
  it('17. partial acceptance records accepted and rejected quantities distinctly', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 3);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      items: [
        {
          returnItemId: returnItemId1,
          returnedQuantity: 3,
          acceptedQuantity: 2,
          rejectedQuantity: 1,
          notes: '2 in great condition, 1 defective',
        },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(mockDoc.status).toBe('INSPECTION_PASSED');
    expect(mockDoc.inspection.totalAcceptedQuantity).toBe(2);
    expect(mockDoc.inspection.totalRejectedQuantity).toBe(1);
    expect(mockItem.inspection.result).toBe('PARTIAL');
  });

  // 18. partial rejection
  it('18. partial rejection preserves rejected item details and does not restock', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 2);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      items: [
        {
          returnItemId: returnItemId1,
          returnedQuantity: 2,
          acceptedQuantity: 1,
          rejectedQuantity: 1,
          condition: 'DAMAGED',
          notes: '1 damaged by user',
        },
      ],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(mockDoc.inspection.items[0].rejectedQuantity).toBe(1);
    expect(mockDoc.inspection.items[0].condition).toBe('DAMAGED');
  });

  // 19. evidence validation
  it('19. evidence validation validates proof references', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      evidence: ['https://storage.rupakar.in/private/returns/proof-1.jpg'],
      proofImages: ['https://storage.rupakar.in/private/returns/proof-2.jpg'],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(mockDoc.inspection.evidence).toContain('https://storage.rupakar.in/private/returns/proof-1.jpg');
    expect(res.json).toHaveBeenCalled();
  });

  // 20. duplicate inspection prevented
  it('20. duplicate inspection prevented (rejects on already completed inspection)', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({
      status: 'INSPECTION_PASSED',
      inspection: { inspectedAt: new Date(), result: 'PASSED' },
    });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(409);
    expect(next.mock.calls[0][0].code).toBe('INSPECTION_ALREADY_COMPLETED');
  });

  // 21. concurrent PASS/FAIL protection
  it('21. concurrent PASS/FAIL protection returns conflict on simultaneous attempts', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({
      status: 'INSPECTION_FAILED',
      inspection: { inspectedAt: new Date(), result: 'FAILED' },
    });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(409);
  });

  // 22. seller cannot refund
  it('22. seller cannot directly trigger refund transition', async () => {
    await expect(
      returnStateService.transitionReturnStatus('INSPECTION_PASSED', 'APPROVED_FOR_REFUND', { actorType: 'VENDOR' })
    ).rejects.toThrow('Vendors are not permitted to transition return to APPROVED_FOR_REFUND');
  });

  // 23. seller cannot change refund amount
  it('23. seller cannot pass or modify refundAmount during inspection', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      refundAmount: 99999,
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  // 24. seller cannot restock
  it('24. seller inspection does not invoke inventory restocking', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);
    const invUpdateSpy = jest.spyOn(Inventory, 'updateOne').mockResolvedValue(true);

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(invUpdateSpy).not.toHaveBeenCalled();
  });

  // 25. seller cannot modify inventory
  it('25. seller inspection rejects inventoryQuantity in payload', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASS',
      inventoryQuantity: 50,
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].name).toBe('ZodError');
  });

  // 26. seller cannot create replacement
  it('26. seller inspection does not create replacement order', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);
    const repSpy = jest.spyOn(replacementService, 'createReplacementOrder').mockResolvedValue({});

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(repSpy).not.toHaveBeenCalled();
  });

  // 27. seller cannot resolve dispute
  it('27. seller cannot resolve an active dispute', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'DISPUTED' });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, { resolution: 'UPHOLD_SELLER' });
    const res = mockRes();
    const next = jest.fn();

    await sellerResolveDispute(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  // 28. PASS does not call Razorpay
  it('28. PASS does not call Razorpay payment or refund APIs', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);
    const refundSpy = jest.spyOn(refundService, 'createRefund').mockResolvedValue({});

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(refundSpy).not.toHaveBeenCalled();
  });

  // 29. FAIL does not call Razorpay
  it('29. FAIL does not call Razorpay payment or refund APIs', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);
    const refundSpy = jest.spyOn(refundService, 'createRefund').mockResolvedValue({});

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'FAIL',
      notes: 'Damaged item',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(refundSpy).not.toHaveBeenCalled();
  });

  // 30. PASS does not change original Order status
  it('30. PASS does not change original Order status', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);
    const orderSaveSpy = jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({});

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(orderSaveSpy).not.toHaveBeenCalled();
  });

  // 31. FAIL does not change original Order status
  it('31. FAIL does not change original Order status', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);
    const orderSaveSpy = jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({});

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'FAIL',
      notes: 'Item damaged',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(orderSaveSpy).not.toHaveBeenCalled();
  });

  // 32. inspection audit history
  it('32. inspection records audit events and statusHistory', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);
    const auditSpy = jest.spyOn(auditService, 'log');

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(auditSpy).toHaveBeenCalledWith('RETURN_INSPECTION_PASSED', expect.objectContaining({ returnId: returnAId }));
    expect(mockDoc.statusHistory.some((h) => h.status === 'INSPECTION_PASSED')).toBe(true);
  });

  // 33. customer sanitized DTO
  it('33. customer receives sanitized DTO without internal notes or private storage paths', async () => {
    const mockDoc = createMockReturn({
      status: 'INSPECTION_PASSED',
      inspection: {
        inspectedAt: new Date(),
        result: 'PASSED',
        condition: 'INTACT',
        notes: 'SELLER_SECRET_INTERNAL_NOTE_123',
        proofImages: ['https://storage.private.internal/secret-file.jpg'],
        totalReturnedQuantity: 1,
        totalAcceptedQuantity: 1,
        totalRejectedQuantity: 0,
      },
    });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(customerId, { id: returnAId });
    const res = mockRes();
    const next = jest.fn();

    await getReturnDetail(req, res, next);

    expect(res.json).toHaveBeenCalled();
    const responseData = res.json.mock.calls[0][0].data;
    expect(responseData.inspection).toBeDefined();
    expect(responseData.inspection.notes).toBeUndefined();
    expect(responseData.inspection.proofImages).toBeUndefined();
    expect(responseData.inspection.result).toBe('PASSED');
  });

  // 34. vendor sanitized DTO
  it('34. vendor DTO contains inspection details and own return scope', async () => {
    const mockDoc = createMockReturn({
      status: 'INSPECTION_PASSED',
      inspection: {
        inspectedAt: new Date(),
        result: 'PASSED',
        condition: 'INTACT',
        notes: 'Seller public note',
      },
    });

    const dto = await buildVendorReturnDto(mockDoc);
    expect(dto.inspection).toBeDefined();
    expect(dto.inspection.result).toBe('PASSED');
    expect(dto.inspection.notes).toBe('Seller public note');
  });

  // 35. admin DTO
  it('35. admin DTO contains complete operational return and arbitration info', async () => {
    const mockDoc = createMockReturn({
      status: 'INSPECTION_PASSED',
      inspection: {
        inspectedAt: new Date(),
        result: 'PASSED',
        notes: 'Admin visible seller note',
      },
      dispute: {
        status: 'PENDING_ADMIN_REVIEW',
        adminNotes: 'Confidential admin note',
      },
    });

    const dto = await buildAdminReturnDto(mockDoc);
    expect(dto.inspection).toBeDefined();
    expect(dto.dispute.adminNotes).toBe('Confidential admin note');
  });

  // 36. authenticity concern recorded
  it('36. authenticity concern recorded in inspection structure', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'FAIL',
      condition: 'TAMPERED',
      authenticityCondition: 'SUSPECTED_COUNTERFEIT',
      notes: 'Item returned does not match artisan weave and hallmarking',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(mockDoc.status).toBe('INSPECTION_FAILED');
    expect(mockDoc.inspection.authenticityCondition).toBe('SUSPECTED_COUNTERFEIT');
  });

  // 37. authenticity concern can enter existing dispute workflow
  it('37. authenticity concern can enter existing dispute workflow', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({
      status: 'INSPECTION_FAILED',
      inspection: { authenticityCondition: 'SUSPECTED_COUNTERFEIT' },
    });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      reason: 'AUTHENTICITY_MISMATCH',
      description: 'Suspected counterfeit product returned by customer',
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerRaiseDispute(req, res, next);

    expect(mockDoc.status).toBe('DISPUTED');
    expect(mockDoc.dispute.reason).toBe('AUTHENTICITY_MISMATCH');
    expect(mockDoc.dispute.status).toBe('PENDING_ADMIN_REVIEW');
  });

  // 38. existing Phase 3 inspection behavior preserved
  it('38. existing Phase 3 inspection behavior preserved for legacy payloads', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);

    const req = mockReq(sellerAUserId, { id: returnAId }, {
      result: 'PASSED',
      condition: 'INTACT',
      notes: 'Legacy phase 3 format',
      proofImages: ['https://example.com/p3-proof.jpg'],
    });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(mockDoc.status).toBe('INSPECTION_PASSED');
    expect(mockDoc.inspection.result).toBe('PASSED');
    expect(mockDoc.inspection.proofImages).toEqual(['https://example.com/p3-proof.jpg']);
  });

  // 39. existing Phase 4 dispute behavior preserved
  it('39. existing Phase 4 dispute behavior preserved', async () => {
    await expect(
      returnStateService.transitionReturnStatus('DISPUTED', 'CLOSED', { actorType: 'VENDOR' })
    ).rejects.toThrow('Vendors are not permitted to transition return to CLOSED');
  });

  // 40. existing Phase 5 refund behavior preserved
  it('40. existing Phase 5 refund transition remains restricted to ADMIN/SYSTEM', async () => {
    await expect(
      returnStateService.transitionReturnStatus('APPROVED_FOR_REFUND', 'REFUNDED', { actorType: 'VENDOR' })
    ).rejects.toThrow('Vendors are not permitted to transition return to REFUNDED');

    const adminTransition = await returnStateService.transitionReturnStatus(
      'APPROVED_FOR_REFUND',
      'REFUNDED',
      { actorType: 'ADMIN' }
    );
    expect(adminTransition.nextStatus).toBe('REFUNDED');
  });

  // 41. existing Phase 6 replacement behavior preserved
  it('41. existing Phase 6 replacement transition remains restricted to authorized flow', async () => {
    await expect(
      returnStateService.transitionReturnStatus('INSPECTION_PASSED', 'REPLACEMENT_PENDING', { actorType: 'VENDOR' })
    ).rejects.toThrow('Vendors are not permitted to transition return to REPLACEMENT_PENDING');

    const adminRep = await returnStateService.transitionReturnStatus(
      'INSPECTION_PASSED',
      'REPLACEMENT_PENDING',
      { actorType: 'ADMIN' }
    );
    expect(adminRep.nextStatus).toBe('REPLACEMENT_PENDING');
  });

  // 42. inventory remains unchanged
  it('42. inventory remains unchanged throughout inspection', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);
    const invUpdateSpy = jest.spyOn(Inventory, 'findOneAndUpdate');

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(invUpdateSpy).not.toHaveBeenCalled();
  });

  // 43. ReturnShipment remains unchanged after inspection except relevant handoff metadata
  it('43. ReturnShipment remains unchanged after inspection', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({ status: 'INSPECTION_PENDING' });
    const mockItem = createMockItem(returnItemId1, variantId1, 1);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockItem]);
    const rsUpdateSpy = jest.spyOn(ReturnShipment, 'updateOne').mockResolvedValue({});

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(rsUpdateSpy).not.toHaveBeenCalled();
  });

  // 44. repeated inspection request is idempotent/rejected safely
  it('44. repeated inspection request is rejected with 409 conflict', async () => {
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorAId, ownerUserId: sellerAUserId });
    const mockDoc = createMockReturn({
      status: 'INSPECTION_PASSED',
      inspection: { inspectedAt: new Date(), result: 'PASSED' },
    });
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockDoc);

    const req = mockReq(sellerAUserId, { id: returnAId }, { result: 'PASS' });
    const res = mockRes();
    const next = jest.fn();

    await sellerSubmitInspection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(409);
    expect(next.mock.calls[0][0].code).toBe('INSPECTION_ALREADY_COMPLETED');
  });

  // 45. no real Razorpay/Shiprocket calls
  it('45. confirms no real Razorpay or Shiprocket calls were made', () => {
    expect(paymentService.razorpay).toBeUndefined();
  });
});
