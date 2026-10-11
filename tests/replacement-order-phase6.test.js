import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Product } from '../app/models/product.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { Inventory } from '../app/models/inventory.model.js';
import { User } from '../app/models/user.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Replacement } from '../app/models/replacement.model.js';
import { replacementService } from '../app/services/replacement.service.js';
import { replacementStateService } from '../app/services/replacement-state.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { paymentService } from '../app/services/payment.service.js';
import {
  createCustomerReplacement,
  getCustomerReplacement,
  adminCreateReplacement,
  adminGetReplacement,
  vendorGetReplacement,
} from '../app/controllers/return.controller.js';

describe('Phase 6: Replacement Order Foundation Backend Tests', () => {
  const adminUserId = new mongoose.Types.ObjectId().toHexString();
  const customerUserId = new mongoose.Types.ObjectId().toHexString();
  const customerUser2Id = new mongoose.Types.ObjectId().toHexString();
  const vendorUserId = new mongoose.Types.ObjectId().toHexString();
  const vendorUser2Id = new mongoose.Types.ObjectId().toHexString();

  const vendorId1 = new mongoose.Types.ObjectId().toHexString();
  const vendorId2 = new mongoose.Types.ObjectId().toHexString();
  const returnId1 = new mongoose.Types.ObjectId().toHexString();
  const orderId1 = new mongoose.Types.ObjectId().toHexString();
  const vendorOrderId1 = new mongoose.Types.ObjectId().toHexString();
  const returnItemId1 = new mongoose.Types.ObjectId().toHexString();
  const productId1 = new mongoose.Types.ObjectId().toHexString();
  const variantId1 = new mongoose.Types.ObjectId().toHexString();
  const replacementOrderId1 = new mongoose.Types.ObjectId().toHexString();

  const mockReq = (user, role = 'customer', params = {}, body = {}, query = {}) => ({
    user: { sub: user, role },
    params,
    body,
    query,
    headers: { 'x-request-id': 'req-test-p6' },
  });

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const createMockOriginalOrder = (overrides = {}) => ({
    _id: orderId1,
    orderNumber: 'ORD-2026-ORIG-001',
    customerId: customerUserId,
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'razorpay',
    total: 2400,
    subtotal: 2400,
    items: [
      {
        productId: productId1,
        variantId: variantId1,
        vendorId: vendorId1,
        productName: 'Handloom Cotton Kurta',
        sku: 'KURTA-COTTON-L',
        quantity: 2,
        unitPrice: 1200,
        lineTotal: 2400,
        productSnapshot: { name: 'Handloom Cotton Kurta', sku: 'KURTA-COTTON-L' },
      },
    ],
    shippingAddressSnapshot: { fullName: 'Alipta Jena', city: 'Bhubaneswar', state: 'Odisha' },
    billingAddressSnapshot: { fullName: 'Alipta Jena', city: 'Bhubaneswar', state: 'Odisha' },
    financialSnapshot: { total: 2400 },
    ...overrides,
  });

  const createMockOriginalVendorOrder = (overrides = {}) => ({
    _id: vendorOrderId1,
    parentOrderId: orderId1,
    vendorId: vendorId1,
    customerId: customerUserId,
    status: 'DELIVERED',
    items: [
      {
        productId: productId1,
        variantId: variantId1,
        productName: 'Handloom Cotton Kurta',
        sku: 'KURTA-COTTON-L',
        quantity: 2,
        unitPrice: 1200,
        lineTotal: 2400,
      },
    ],
    total: 2400,
    ...overrides,
  });

  const createMockReturn = (overrides = {}) => ({
    _id: returnId1,
    returnNumber: 'RUP-RET-2026-001',
    orderId: orderId1,
    vendorOrderId: vendorOrderId1,
    customerId: customerUserId,
    vendorId: vendorId1,
    type: 'REPLACEMENT',
    status: 'REPLACEMENT_PENDING',
    items: [returnItemId1],
    resolution: {
      action: 'REPLACEMENT',
      resolvedBy: adminUserId,
      resolvedAt: new Date(),
      notes: 'Approved for equal item replacement',
    },
    statusHistory: [],
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  const createMockReturnItem = (overrides = {}) => ({
    _id: returnItemId1,
    productId: productId1,
    variantId: variantId1,
    quantity: 1,
    unitPrice: 1200,
    lineTotal: 1200,
    productSnapshot: { name: 'Handloom Cotton Kurta', sku: 'KURTA-COTTON-L' },
    ...overrides,
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // 1. Eligible replacement can be created
  it('1. Eligible replacement can be created successfully', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOriginalOrder();
    const mockVendorOrder = createMockOriginalVendorOrder();
    const mockReturnItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockReturn);
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockVendorOrder);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockReturnItem]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1, name: 'Handloom Kurta' });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1, sku: 'KURTA-COTTON-L' });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 10 });

    const mockCreatedOrder = {
      _id: replacementOrderId1,
      orderNumber: 'ORD-2026-REP-999',
      total: 0,
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
      save: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(Order, 'create').mockResolvedValue(mockCreatedOrder);

    const mockCreatedVendorOrder = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      parentOrderId: replacementOrderId1,
      vendorId: vendorId1,
      status: 'CONFIRMED',
      total: 0,
    };
    jest.spyOn(VendorOrder, 'create').mockResolvedValue(mockCreatedVendorOrder);

    const reservationSpy = jest
      .spyOn(inventoryReservationService, 'createReservation')
      .mockResolvedValue({ _id: 'res-1', quantity: 1, status: 'ACTIVE' });

    const mockReplacementDoc = {
      _id: 'rep-doc-1',
      replacementNumber: 'RUP-REP-2026-001',
      returnId: returnId1,
      status: 'PENDING_FULFILLMENT',
      replacementOrderId: replacementOrderId1,
      quantity: 1,
      save: jest.fn().mockResolvedValue(true),
      toObject: function () {
        return { ...this };
      },
    };
    jest.spyOn(Replacement, 'create').mockResolvedValue(mockReplacementDoc);

    const req = mockReq(customerUserId, 'customer', { id: returnId1 }, { notes: 'Create replacement' });
    const res = mockRes();

    await createCustomerReplacement(req, res, (err) => {
      if (err) throw err;
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(reservationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: replacementOrderId1,
        variantId: variantId1,
        quantity: 1,
      }),
    );
    expect(mockReturn.save).toHaveBeenCalled();
  });

  // 2. Customer cannot create replacement for another customer's return
  it("2. Customer cannot create replacement for another customer's return", async () => {
    const mockReturn = createMockReturn({ customerId: customerUserId });
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    const req = mockReq(customerUser2Id, 'customer', { id: returnId1 }, {});
    const res = mockRes();
    const next = jest.fn();

    await createCustomerReplacement(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );
  });

  // 3. Seller cannot create replacement
  it('3. Seller cannot create replacement', async () => {
    const mockReturn = createMockReturn({ vendorId: vendorId1 });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    await expect(
      replacementService.createReplacementOrder({
        returnId: returnId1,
        actorId: vendorUserId,
        actorType: 'VENDOR',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  // 4. Admin can view replacement
  it('4. Admin can view replacement and its linkage', async () => {
    const mockReplacement = {
      _id: 'rep-doc-1',
      replacementNumber: 'RUP-REP-2026-001',
      returnId: returnId1,
      originalOrderId: orderId1,
      replacementOrderId: replacementOrderId1,
      status: 'PENDING_FULFILLMENT',
      toObject: function () {
        return { ...this };
      },
    };

    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockReplacement);
    jest.spyOn(Order, 'findById').mockResolvedValue({
      _id: replacementOrderId1,
      orderNumber: 'ORD-2026-REP-999',
      status: 'CONFIRMED',
      total: 0,
    });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();

    await adminGetReplacement(req, res, (err) => {
      if (err) throw err;
    });

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.replacementOrder.orderNumber).toBe('ORD-2026-REP-999');
  });

  // 5. Replacement requires Admin-approved resolution
  it('5. Replacement requires Admin-approved resolution in REPLACEMENT_PENDING state', async () => {
    const unapprovedReturn = createMockReturn({
      status: 'UNDER_REVIEW',
      resolution: null,
    });
    jest.spyOn(Return, 'findById').mockResolvedValue(unapprovedReturn);

    await expect(
      replacementService.createReplacementOrder({
        returnId: returnId1,
        actorId: customerUserId,
        actorType: 'CUSTOMER',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'REPLACEMENT_NOT_APPROVED',
    });
  });

  // 6. Replacement cannot be created from a refund resolution
  it('6. Replacement cannot be created from a refund resolution', async () => {
    const refundResolvedReturn = createMockReturn({
      status: 'APPROVED_FOR_REFUND',
      resolution: { action: 'RETURN_REFUND', calculatedRefundAmount: 1200 },
    });
    jest.spyOn(Return, 'findById').mockResolvedValue(refundResolvedReturn);

    await expect(
      replacementService.createReplacementOrder({
        returnId: returnId1,
        actorId: customerUserId,
        actorType: 'CUSTOMER',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'REPLACEMENT_NOT_ALLOWED',
    });
  });

  // 7. Replacement quantity cannot exceed purchased quantity
  it('7. Replacement quantity cannot exceed purchased quantity', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOriginalOrder(); // quantity purchased = 2
    const mockReturnItem = createMockReturnItem({ quantity: 5 }); // requesting 5

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockReturnItem]);

    await expect(
      replacementService.createReplacementOrder({
        returnId: returnId1,
        actorId: customerUserId,
        actorType: 'CUSTOMER',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'QUANTITY_EXCEEDS_PURCHASED',
    });
  });

  // 8. Duplicate replacement request is idempotent
  it('8. Duplicate replacement request is idempotent and returns existing record', async () => {
    const mockReturn = createMockReturn();
    const existingReplacement = {
      _id: 'rep-existing-1',
      replacementNumber: 'RUP-REP-2026-EX',
      returnId: returnId1,
      status: 'PENDING_FULFILLMENT',
      replacementOrderId: replacementOrderId1,
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(existingReplacement);

    const orderSpy = jest.spyOn(Order, 'create');

    const result = await replacementService.createReplacementOrder({
      returnId: returnId1,
      actorId: customerUserId,
      actorType: 'CUSTOMER',
      idempotencyKey: 'idemp-123',
    });

    expect(result).toBe(existingReplacement);
    expect(orderSpy).not.toHaveBeenCalled();
  });

  // 9. Concurrent replacement requests recover from duplicate key collision
  it('9. Concurrent replacement requests recover from duplicate key collision', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOriginalOrder();
    const mockReturnItem = createMockReturnItem();

    const existingReplacement = {
      _id: 'rep-race-won',
      replacementNumber: 'RUP-REP-RACE',
      returnId: returnId1,
      status: 'PENDING_FULFILLMENT',
    };

    let findCount = 0;
    jest.spyOn(Replacement, 'findOne').mockImplementation(async () => {
      findCount++;
      return findCount === 1 ? null : existingReplacement;
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockReturnItem]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 5 });

    jest.spyOn(Order, 'create').mockResolvedValue({ _id: 'ord-race-2', save: jest.fn().mockResolvedValue(true) });
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-race' });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: 'vo-race-2' });

    const duplicateError = new Error('E11000 duplicate key error');
    duplicateError.code = 11000;
    jest.spyOn(Replacement, 'create').mockRejectedValue(duplicateError);
    const releaseSpy = jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({});

    const result = await replacementService.createReplacementOrder({
      returnId: returnId1,
      actorId: customerUserId,
      actorType: 'CUSTOMER',
    });

    expect(result).toBe(existingReplacement);
    expect(releaseSpy).toHaveBeenCalled();
  });

  // 10. Replacement uses current inventory
  it('10. Replacement uses current inventory and reserves sellable stock', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOriginalOrder();
    const mockReturnItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockReturnItem]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });

    const inventorySpy = jest
      .spyOn(Inventory, 'findOne')
      .mockResolvedValue({ _id: 'inv-1', variantId: variantId1, availableQuantity: 8 });

    jest.spyOn(Order, 'create').mockResolvedValue({ _id: 'ord-new', save: jest.fn().mockResolvedValue(true) });
    const reserveSpy = jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-stock' });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: 'vo-new' });
    jest.spyOn(Replacement, 'create').mockResolvedValue({ _id: 'rep-stock', status: 'PENDING_FULFILLMENT' });

    await replacementService.createReplacementOrder({
      returnId: returnId1,
      actorId: customerUserId,
      actorType: 'CUSTOMER',
    });

    expect(inventorySpy).toHaveBeenCalledWith({ variantId: variantId1, deletedAt: null });
    expect(reserveSpy).toHaveBeenCalled();
  });

  // 11. Insufficient inventory fails safely
  it('11. Insufficient inventory fails safely without creating replacement order', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOriginalOrder();
    const mockReturnItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockReturnItem]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 0 }); // out of stock

    const orderCreateSpy = jest.spyOn(Order, 'create');

    await expect(
      replacementService.createReplacementOrder({
        returnId: returnId1,
        actorId: customerUserId,
        actorType: 'CUSTOMER',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'INSUFFICIENT_STOCK',
    });

    expect(orderCreateSpy).not.toHaveBeenCalled();
  });

  // 12. Failed creation does not leave inventory reserved
  it('12. Failed creation does not leave inventory reserved and rolls back', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOriginalOrder();
    const mockReturnItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([mockReturnItem]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 5 });

    const mockCreatedOrder = { _id: 'ord-fail', save: jest.fn().mockResolvedValue(true) };
    jest.spyOn(Order, 'create').mockResolvedValue(mockCreatedOrder);
    jest.spyOn(Order, 'findByIdAndUpdate').mockResolvedValue({});
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-fail' });
    const releaseSpy = jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue({});

    // VendorOrder creation crashes
    jest.spyOn(VendorOrder, 'create').mockRejectedValue(new Error('VendorOrder DB failure'));

    await expect(
      replacementService.createReplacementOrder({
        returnId: returnId1,
        actorId: customerUserId,
        actorType: 'CUSTOMER',
      }),
    ).rejects.toThrow('VendorOrder DB failure');

    expect(releaseSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-fail',
        variantId: variantId1,
      }),
    );
  });

  // 13. Original Order remains unchanged
  it('13. Original Order remains completely unchanged', async () => {
    const mockOrder = createMockOriginalOrder();
    const originalSnapshot = JSON.stringify(mockOrder);

    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([createMockReturnItem()]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 5 });

    jest.spyOn(Order, 'create').mockResolvedValue({ _id: 'ord-rep', save: jest.fn().mockResolvedValue(true) });
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-1' });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: 'vo-rep' });
    jest.spyOn(Replacement, 'create').mockResolvedValue({ _id: 'rep-1', status: 'PENDING_FULFILLMENT' });

    await replacementService.createReplacementOrder({
      returnId: returnId1,
      actorId: customerUserId,
      actorType: 'CUSTOMER',
    });

    expect(JSON.stringify(mockOrder)).toBe(originalSnapshot);
  });

  // 14. Original VendorOrder remains historically correct
  it('14. Original VendorOrder remains historically correct', async () => {
    const mockVendorOrder = createMockOriginalVendorOrder();
    const originalVoSnapshot = JSON.stringify(mockVendorOrder);

    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(createMockOriginalOrder());
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([createMockReturnItem()]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 5 });

    jest.spyOn(Order, 'create').mockResolvedValue({ _id: 'ord-rep', save: jest.fn().mockResolvedValue(true) });
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-1' });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: 'vo-rep' });
    jest.spyOn(Replacement, 'create').mockResolvedValue({ _id: 'rep-1', status: 'PENDING_FULFILLMENT' });

    await replacementService.createReplacementOrder({
      returnId: returnId1,
      actorId: customerUserId,
      actorType: 'CUSTOMER',
    });

    expect(JSON.stringify(mockVendorOrder)).toBe(originalVoSnapshot);
  });

  // 15. Replacement links to original Return
  it('15. Replacement links to original Return', async () => {
    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(createMockOriginalOrder());
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([createMockReturnItem()]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 5 });

    jest.spyOn(Order, 'create').mockResolvedValue({ _id: 'ord-link', save: jest.fn().mockResolvedValue(true) });
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-link' });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: 'vo-link' });

    const replacementCreateSpy = jest
      .spyOn(Replacement, 'create')
      .mockResolvedValue({ _id: 'rep-link', returnId: returnId1, status: 'PENDING_FULFILLMENT' });

    await replacementService.createReplacementOrder({
      returnId: returnId1,
      actorId: customerUserId,
      actorType: 'CUSTOMER',
    });

    expect(replacementCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        returnId: returnId1,
        originalOrderId: orderId1,
      }),
    );
  });

  // 16. Replacement order links back to original order/return
  it('16. Replacement order links back to original order and return', async () => {
    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(createMockOriginalOrder());
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([createMockReturnItem()]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 5 });

    const orderCreateSpy = jest
      .spyOn(Order, 'create')
      .mockResolvedValue({ _id: 'ord-backlink', save: jest.fn().mockResolvedValue(true) });
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-link' });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: 'vo-backlink' });
    jest.spyOn(Replacement, 'create').mockResolvedValue({ _id: 'rep-backlink', status: 'PENDING_FULFILLMENT' });

    await replacementService.createReplacementOrder({
      returnId: returnId1,
      actorId: customerUserId,
      actorType: 'CUSTOMER',
    });

    expect(orderCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        financialSnapshot: expect.objectContaining({
          isReplacement: true,
          originalOrderId: orderId1,
          returnId: returnId1,
        }),
      }),
    );
  });

  // 17. Replacement does not create a new Razorpay charge
  it('17. Replacement does not create a new Razorpay charge or transaction', async () => {
    const paymentSpy = jest.spyOn(paymentService, 'createPayment');

    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(createMockOriginalOrder());
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([createMockReturnItem()]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 5 });

    jest.spyOn(Order, 'create').mockResolvedValue({ _id: 'ord-free', save: jest.fn().mockResolvedValue(true) });
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-free' });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: 'vo-free' });
    jest.spyOn(Replacement, 'create').mockResolvedValue({ _id: 'rep-free', status: 'PENDING_FULFILLMENT' });

    await replacementService.createReplacementOrder({
      returnId: returnId1,
      actorId: customerUserId,
      actorType: 'CUSTOMER',
    });

    expect(paymentSpy).not.toHaveBeenCalled();
  });

  // 18. Replacement COD does not create another COD payment obligation
  it('18. Replacement COD does not create another COD payment obligation', async () => {
    const codOriginalOrder = createMockOriginalOrder({ paymentMethod: 'cod' });

    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'find').mockResolvedValue([]);
    jest.spyOn(Order, 'findById').mockResolvedValue(codOriginalOrder);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(createMockOriginalVendorOrder());
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([createMockReturnItem()]);
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId1 });
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId1 });
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({ availableQuantity: 5 });

    const orderCreateSpy = jest
      .spyOn(Order, 'create')
      .mockResolvedValue({ _id: 'ord-cod-rep', save: jest.fn().mockResolvedValue(true) });
    jest.spyOn(inventoryReservationService, 'createReservation').mockResolvedValue({ _id: 'res-cod' });
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: 'vo-cod-rep' });
    jest.spyOn(Replacement, 'create').mockResolvedValue({ _id: 'rep-cod', status: 'PENDING_FULFILLMENT' });

    await replacementService.createReplacementOrder({
      returnId: returnId1,
      actorId: customerUserId,
      actorType: 'CUSTOMER',
    });

    expect(orderCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 0,
        subtotal: 0,
        paymentStatus: 'PAID',
      }),
    );
  });

  // 19. Seller sees only their own replacement
  it('19. Seller sees only their own replacement and is blocked from other vendors', async () => {
    const mockVendor = { _id: vendorId2, ownerUserId: vendorUser2Id };
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn({ vendorId: vendorId1 }));

    const req = mockReq(vendorUser2Id, 'vendor', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await vendorGetReplacement(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );
  });

  // 20. Customer sees only their own replacement
  it('20. Customer sees only their own replacement', async () => {
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn({ customerId: customerUserId }));

    const req = mockReq(customerUser2Id, 'customer', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await getCustomerReplacement(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );
  });

  // 21. Invalid replacement state transition is rejected
  it('21. Invalid replacement state transition is rejected', async () => {
    await expect(
      replacementStateService.transitionReplacementStatus('COMPLETED', 'APPROVED', {
        actorType: 'ADMIN',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_REPLACEMENT_TRANSITION',
    });

    await expect(
      replacementStateService.transitionReplacementStatus('APPROVED', 'ORDER_CREATED', {
        actorType: 'VENDOR',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'VENDOR_FORBIDDEN_TRANSITION',
    });
  });

  // 22. Admin / customer / seller RBAC remains strictly enforced
  it('22. Admin / customer / seller RBAC remains strictly enforced', async () => {
    const req = mockReq(customerUserId, 'customer', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminCreateReplacement(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );
  });
});
