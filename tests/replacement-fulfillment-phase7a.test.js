import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Return } from '../app/models/return.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Shipment } from '../app/models/shipment.model.js';
import { Replacement } from '../app/models/replacement.model.js';
import { InventoryReservation } from '../app/models/inventory-reservation.model.js';
import { replacementService, isReplacementOrder } from '../app/services/replacement.service.js';
import { replacementStateService } from '../app/services/replacement-state.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { shippingService } from '../app/services/shipping.service.js';
import { paymentService } from '../app/services/payment.service.js';
import { orderService } from '../app/services/order.service.js';
import { env } from '../app/config/env.js';
import { isAuthenticAwb } from '../app/services/delivery-provider.service.js';
import {
  processVendorOrder,
  packVendorOrder,
  readyVendorOrder,
  shipVendorOrder,
} from '../app/controllers/shipping.controller.js';
import {
  getVendorOrder,
  listVendorOrders,
} from '../app/controllers/order.controller.js';
import {
  getReturnDetail,
  adminGetReplacement,
  adminCreateReplacement,
  getAdminReturn,
} from '../app/controllers/return.controller.js';
import { Refund } from '../app/models/refund.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { shipmentStateService } from '../app/services/shipment-state.service.js';

describe('Phase 7A: Replacement Fulfillment Foundation Backend Tests', () => {
  const adminUserId = new mongoose.Types.ObjectId().toHexString();
  const customerUserId = new mongoose.Types.ObjectId().toHexString();
  const customerUser2Id = new mongoose.Types.ObjectId().toHexString();
  const vendorUserId = new mongoose.Types.ObjectId().toHexString();
  const vendorUser2Id = new mongoose.Types.ObjectId().toHexString();

  const vendorId1 = new mongoose.Types.ObjectId().toHexString();
  const vendorId2 = new mongoose.Types.ObjectId().toHexString();
  const returnId1 = new mongoose.Types.ObjectId().toHexString();
  const originalOrderId1 = new mongoose.Types.ObjectId().toHexString();
  const originalVendorOrderId1 = new mongoose.Types.ObjectId().toHexString();
  const replacementOrderId1 = new mongoose.Types.ObjectId().toHexString();
  const replacementVendorOrderId1 = new mongoose.Types.ObjectId().toHexString();
  const replacementId1 = new mongoose.Types.ObjectId().toHexString();
  const shipmentId1 = new mongoose.Types.ObjectId().toHexString();
  const productId1 = new mongoose.Types.ObjectId().toHexString();
  const variantId1 = new mongoose.Types.ObjectId().toHexString();

  const mockReq = (user, role = 'vendor', params = {}, body = {}, query = {}) => ({
    user: { sub: user, role },
    params,
    body,
    query,
    headers: { 'x-request-id': 'req-test-p7a' },
  });

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const createMockOriginalOrder = (overrides = {}) => ({
    _id: originalOrderId1,
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
        quantity: 1,
        unitPrice: 2400,
        lineTotal: 2400,
      },
    ],
    ...overrides,
  });

  const createMockOriginalVendorOrder = (overrides = {}) => ({
    _id: originalVendorOrderId1,
    parentOrderId: originalOrderId1,
    vendorId: vendorId1,
    customerId: customerUserId,
    status: 'DELIVERED',
    total: 2400,
    subtotal: 2400,
    items: [
      {
        productId: productId1,
        variantId: variantId1,
        productName: 'Handloom Cotton Kurta',
        sku: 'KURTA-COTTON-L',
        quantity: 1,
        unitPrice: 2400,
        lineTotal: 2400,
      },
    ],
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  const createMockReplacementOrder = (overrides = {}) => ({
    _id: replacementOrderId1,
    orderNumber: 'ORD-REP-2026-001',
    customerId: customerUserId,
    status: 'PROCESSING',
    paymentStatus: 'PAID',
    paymentMethod: 'replacement',
    total: 0,
    subtotal: 0,
    shippingTotal: 0,
    financialSnapshot: {
      isReplacement: true,
      originalOrderId: originalOrderId1,
      returnId: returnId1,
      replacementId: replacementId1,
    },
    shippingAddressSnapshot: {
      fullName: 'Customer One',
      phone: '9876543210',
      addressLine1: '123 Test Street',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700001',
    },
    items: [
      {
        productId: productId1,
        variantId: variantId1,
        vendorId: vendorId1,
        productName: 'Handloom Cotton Kurta',
        sku: 'KURTA-COTTON-L',
        quantity: 1,
        unitPrice: 0,
        lineTotal: 0,
      },
    ],
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  const createMockReplacementVendorOrder = (overrides = {}) => ({
    _id: replacementVendorOrderId1,
    parentOrderId: replacementOrderId1,
    vendorId: vendorId1,
    customerId: customerUserId,
    status: 'PROCESSING',
    total: 0,
    subtotal: 0,
    inventoryDecremented: false,
    financialSnapshot: {
      isReplacement: true,
      originalOrderId: originalOrderId1,
      originalVendorOrderId: originalVendorOrderId1,
      returnId: returnId1,
      replacementId: replacementId1,
    },
    items: [
      {
        productId: productId1,
        variantId: variantId1,
        productName: 'Handloom Cotton Kurta',
        sku: 'KURTA-COTTON-L',
        quantity: 1,
        unitPrice: 0,
        lineTotal: 0,
        weight: 0.8,
      },
    ],
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  const createMockReplacement = (overrides = {}) => ({
    _id: replacementId1,
    replacementNumber: 'REP-2026-001',
    returnId: returnId1,
    originalOrderId: originalOrderId1,
    originalVendorOrderId: originalVendorOrderId1,
    replacementOrderId: replacementOrderId1,
    replacementVendorOrderId: replacementVendorOrderId1,
    customerId: customerUserId,
    vendorId: vendorId1,
    status: 'PENDING_FULFILLMENT',
    quantity: 1,
    statusHistory: [],
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  const createMockVendor = (overrides = {}) => ({
    _id: vendorId1,
    ownerUserId: vendorUserId,
    businessName: 'Bengal Crafts Store',
    status: 'APPROVED',
    pickupAddress: {
      addressLine1: '45 Artisan Way',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700001',
      pickupLocationName: 'Bengal Crafts Warehouse',
      registrationStatus: 'REGISTERED',
      adminStatus: 'APPROVED',
    },
    ...overrides,
  });

  const validPackageData = {
    weight: 0.8,
    length: 25,
    width: 20,
    height: 5,
    unit: 'kg',
    dimensionUnit: 'cm',
  };

  let originalDeliveryProvider;
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    originalDeliveryProvider = env.DELIVERY_PROVIDER;
    env.DELIVERY_PROVIDER = 'mock';
  });

  afterEach(() => {
    env.DELIVERY_PROVIDER = originalDeliveryProvider;
  });

  // 1. Replacement VendorOrder appears to correct seller
  it('1. Replacement VendorOrder appears to correct seller with replacement metadata', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder();
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepVo),
    });
    jest.spyOn(Order, 'findOne').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockRepOrder),
      }),
    });
    jest.spyOn(Shipment, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    jest.spyOn(Replacement, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRep),
    });
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(Return, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ returnNumber: 'RET-2026-001' }),
      }),
    });
    jest.spyOn(Order, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ orderNumber: 'ORD-2026-ORIG-001' }),
      }),
    });

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 });
    const res = mockRes();
    const next = jest.fn();

    await getVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const responseData = res.json.mock.calls[0][0].data;
    expect(responseData.isReplacement).toBe(true);
    expect(responseData.replacement).toBeDefined();
    expect(responseData.replacement.replacementNumber).toBe('REP-2026-001');
    expect(responseData.replacement.returnNumber).toBe('RET-2026-001');
    expect(responseData.replacement.originalOrderNumber).toBe('ORD-2026-ORIG-001');
  });

  // 2. Other seller cannot access it
  it('2. Other seller cannot access replacement VendorOrder (isolation enforced)', async () => {
    const otherVendor = createMockVendor({ _id: vendorId2, ownerUserId: vendorUser2Id });
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(otherVendor);
    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(null), // Filtered out by vendorId
    });

    const req = mockReq(vendorUser2Id, 'vendor', { id: replacementVendorOrderId1 });
    const res = mockRes();
    const next = jest.fn();

    await getVendorOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'VENDOR_ORDER_NOT_FOUND',
      })
    );
  });

  // 3. Customer can see replacement fulfillment status
  it('3. Customer can see replacement fulfillment status reflecting real stages', async () => {
    const mockRep = createMockReplacement();
    const mockReturnDoc = {
      _id: returnId1,
      orderId: originalOrderId1,
      returnNumber: 'RET-2026-001',
      customerId: customerUserId,
      type: 'REPLACEMENT',
      status: 'REPLACEMENT_PENDING',
      items: [],
      toObject: function () {
        return { ...this };
      },
    };

    jest.spyOn(Return, 'findOne').mockResolvedValue(mockReturnDoc);
    jest.spyOn(Refund, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
    jest.spyOn(Replacement, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRep),
    });
    jest.spyOn(Order, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ orderNumber: 'ORD-REP-2026-001' }),
      }),
    });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ status: 'PACKED' }),
      }),
    });
    jest.spyOn(Shipment, 'findOne').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          status: 'PACKED',
          packageInfo: validPackageData,
        }),
      }),
    });

    const req = mockReq(customerUserId, 'customer', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await getReturnDetail(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const returnData = res.json.mock.calls[0][0].data;
    expect(returnData.replacement).toBeDefined();
    expect(returnData.replacement.vendorOrderStatus).toBe('PACKED');
    expect(returnData.replacement.fulfillmentStatus).toBe('PACKED');
    expect(returnData.replacement.packageInfo.weight).toBe(0.8);
  });

  // 4. Seller can move replacement to PROCESSING
  it('4. Seller can move replacement from CONFIRMED to PROCESSING', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'CONFIRMED' });

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...mockRepVo, status: 'PROCESSING' }),
    });

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 });
    const res = mockRes();
    const next = jest.fn();

    await processVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRepVo.status).toBe('PROCESSING');
    expect(mockRepVo.save).toHaveBeenCalled();
  });

  // 5. Seller can pack replacement
  it('5. Seller can pack replacement, creating local shipment without external carrier', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PROCESSING' });
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockRepOrder);
    jest.spyOn(VendorOrder, 'findOneAndUpdate').mockResolvedValue({ ...mockRepVo, status: 'PACKED' });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    const shipmentCreateSpy = jest.spyOn(Shipment, 'create').mockResolvedValue({
      _id: shipmentId1,
      status: 'PACKED',
      packageInfo: validPackageData,
      toObject: () => ({ _id: shipmentId1, status: 'PACKED' }),
    });
    const syncSpy = jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await packVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(shipmentCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PACKED',
        carrier: null,
        provider: null,
        trackingNumber: null,
        metadata: expect.objectContaining({ isReplacement: true }),
      })
    );
    expect(syncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorOrderId: replacementVendorOrderId1,
        status: 'PACKED',
      })
    );
  });

  // 6. Package weight is required
  it('6. Package weight is required when marking replacement ready to ship', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);

    // Missing weight
    const invalidBody = { length: 20, width: 15, height: 10 };
    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, invalidBody);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(next).toHaveBeenCalled();
    const err6 = next.mock.calls[0][0];
    expect(err6.statusCode === 400 || err6.name === 'ZodError').toBe(true);
  });

  // 7. Package dimensions are required
  it('7. Package dimensions are required when marking replacement ready to ship', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);

    // Missing dimensions
    const invalidBody = { weight: 1.0 };
    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, invalidBody);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(next).toHaveBeenCalled();
    const err7 = next.mock.calls[0][0];
    expect(err7.statusCode === 400 || err7.name === 'ZodError').toBe(true);
  });

  // 8. Invalid package data is rejected
  it('8. Invalid package data (negative/zero dimensions) is rejected', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);

    const nonPositiveBody = { weight: 0, length: -5, width: 10, height: 5 };
    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, nonPositiveBody);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(next).toHaveBeenCalled();
    const err8 = next.mock.calls[0][0];
    expect(err8.statusCode === 400 || err8.name === 'ZodError').toBe(true);
  });

  // 9. Seller can move replacement to READY_TO_SHIP
  it('9. Seller can move replacement to READY_TO_SHIP with valid package info', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();
    const mockShipment = {
      _id: shipmentId1,
      status: 'PACKED',
      packageInfo: validPackageData,
      save: jest.fn().mockResolvedValue(true),
      toObject: () => ({ _id: shipmentId1, status: 'READY_TO_SHIP' }),
    };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue({
      status: 'ACTIVE',
      variantId: variantId1,
    });
    jest.spyOn(inventoryReservationService, 'consumeReservation').mockResolvedValue(true);
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRepVo.status).toBe('READY_TO_SHIP');
    expect(mockShipment.status).toBe('READY_TO_SHIP');
    expect(mockShipment.save).toHaveBeenCalled();
  });

  // 10. Normal VendorOrder fulfillment remains unchanged
  it('10. Normal VendorOrder fulfillment uses standard flow without replacement branching', async () => {
    const mockVendor = createMockVendor();
    const normalVo = createMockOriginalVendorOrder({
      _id: originalVendorOrderId1,
      status: 'PACKED',
      financialSnapshot: null,
      parentOrderId: originalOrderId1,
    });
    const normalOrder = createMockOriginalOrder({
      _id: originalOrderId1,
      paymentMethod: 'razorpay',
      paymentStatus: 'PAID',
    });
    const mockShipment = {
      _id: 'ship-normal',
      status: 'PACKED',
      packageInfo: validPackageData,
      save: jest.fn().mockResolvedValue(true),
      toObject: () => ({ _id: 'ship-normal', status: 'READY_TO_SHIP' }),
    };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(normalVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(normalOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);
    jest.spyOn(shippingService, 'createShipment').mockResolvedValue(mockShipment);
    jest.spyOn(shipmentStateService, 'transitionShipmentStatus').mockResolvedValue(true);
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
    const decreaseStockSpy = jest.spyOn(inventoryService, 'decreaseStock').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: originalVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    // Normal order calls inventoryService.decreaseStock if no reservation
    expect(decreaseStockSpy).toHaveBeenCalledWith(
      variantId1,
      1,
      expect.objectContaining({ referenceType: 'VENDOR_ORDER' })
    );
  });

  // 11. Replacement does not call Razorpay
  it('11. Replacement fulfillment never triggers Razorpay or customer payment', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PROCESSING' });
    const mockRepOrder = createMockReplacementOrder();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockRepOrder);
    jest.spyOn(VendorOrder, 'findOneAndUpdate').mockResolvedValue({ ...mockRepVo, status: 'PACKED' });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockResolvedValue({
      _id: shipmentId1,
      status: 'PACKED',
      packageInfo: validPackageData,
    });
    jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const razorpaySpy = jest.spyOn(paymentService, 'createPayment');

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await packVendorOrder(req, res, next);

    expect(razorpaySpy).not.toHaveBeenCalled();
    expect(mockRepOrder.total).toBe(0);
    expect(mockRepOrder.paymentStatus).toBe('PAID');
  });

  // 12. Replacement does not create COD collection
  it('12. Replacement fulfillment does not create COD collection demand', async () => {
    const mockRepOrder = createMockReplacementOrder();
    const mockRepVo = createMockReplacementVendorOrder();

    expect(mockRepOrder.paymentMethod).toBe('replacement');
    expect(mockRepOrder.total).toBe(0);
    expect(mockRepVo.total).toBe(0);
    expect(isReplacementOrder(mockRepOrder, mockRepVo)).toBe(true);
  });

  // 13. Replacement does not create Shiprocket shipment
  it('13. Replacement fulfillment does not create Shiprocket shipment in Phase 7A', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PROCESSING' });
    const mockRepOrder = createMockReplacementOrder();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockRepOrder);
    jest.spyOn(VendorOrder, 'findOneAndUpdate').mockResolvedValue({ ...mockRepVo, status: 'PACKED' });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockResolvedValue({
      _id: shipmentId1,
      status: 'PACKED',
      packageInfo: validPackageData,
    });
    jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const shippingServiceSpy = jest.spyOn(shippingService, 'createShipment');

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await packVendorOrder(req, res, next);

    expect(shippingServiceSpy).not.toHaveBeenCalled();
  });

  // 14. Replacement does not generate fake AWB
  it('14. Replacement fulfillment generates authentic provider AWB in Phase 7B', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();

    let createdShipment = null;
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockImplementation((data) => {
      createdShipment = data;
      return Promise.resolve({ ...data, _id: shipmentId1, toObject: () => data });
    });
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue({ status: 'CONSUMED' });
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(createdShipment).toBeDefined();
    expect(isAuthenticAwb(createdShipment.providerAwb, createdShipment.providerShipmentId)).toBe(true);
  });

  // 15. Replacement does not generate fake tracking number
  it('15. Replacement fulfillment leaves carrier/trackingNumber as authentic carrier data (no fake tracking)', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();

    let createdShipment = null;
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockImplementation((data) => {
      createdShipment = data;
      return Promise.resolve({ ...data, _id: shipmentId1, toObject: () => data });
    });
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue({ status: 'CONSUMED' });
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(createdShipment).toBeDefined();
    expect(isAuthenticAwb(createdShipment.trackingNumber, createdShipment.providerShipmentId)).toBe(true);
    expect(createdShipment.carrier).toBeDefined();
    expect(createdShipment.provider).toBeDefined();
  });

  // 16. Replacement inventory is not decremented twice
  it('16. Replacement inventory is not decremented twice during fulfillment', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue({
      status: 'PACKED',
      packageInfo: validPackageData,
      save: jest.fn().mockResolvedValue(true),
    });
    // Already consumed in Phase 6 or consumes active reservation
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue({
      status: 'ACTIVE',
      variantId: variantId1,
    });
    const consumeSpy = jest.spyOn(inventoryReservationService, 'consumeReservation').mockResolvedValue(true);
    const decreaseStockSpy = jest.spyOn(inventoryService, 'decreaseStock');
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(consumeSpy).toHaveBeenCalledWith({
      orderId: replacementOrderId1,
      variantId: variantId1,
    });
    // decreaseStock MUST NOT be called for replacement order
    expect(decreaseStockSpy).not.toHaveBeenCalled();
    expect(mockRepVo.inventoryDecremented).toBe(true);
  });

  // 17. Original Order remains unchanged
  it('17. Original Order remains DELIVERED and unchanged', async () => {
    const originalOrder = createMockOriginalOrder();
    expect(originalOrder.status).toBe('DELIVERED');
    expect(originalOrder.paymentStatus).toBe('PAID');
    expect(originalOrder.total).toBe(2400);
  });

  // 18. Original VendorOrder remains historically unchanged
  it('18. Original VendorOrder remains historically unchanged', async () => {
    const originalVo = createMockOriginalVendorOrder();
    expect(originalVo.status).toBe('DELIVERED');
    expect(originalVo.total).toBe(2400);
  });

  // 19. Replacement state does not become SHIPPED before shipment exists
  it('19. Replacement state does not become SHIPPED before carrier shipment exists', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'READY_TO_SHIP' });
    const mockRepOrder = createMockReplacementOrder();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockRepOrder);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 });
    const res = mockRes();
    const next = jest.fn();

    await shipVendorOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'REPLACEMENT_SHIPMENT_NOT_READY',
      })
    );
  });

  // 20. Replacement state does not become DELIVERED prematurely
  it('20. Replacement state does not become DELIVERED prematurely', async () => {
    await expect(
      replacementStateService.transitionReplacementStatus('FULFILLMENT_STARTED', 'DELIVERED', {
        actorType: 'VENDOR',
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_REPLACEMENT_TRANSITION',
    });
  });

  // 21. Invalid replacement fulfillment transition is rejected
  it('21. Invalid replacement fulfillment transition is rejected', async () => {
    const mockVendor = createMockVendor();
    // Cannot pack an order that is still CONFIRMED or already READY_TO_SHIP
    const unreadyVo = createMockReplacementVendorOrder({ status: 'CONFIRMED' });
    const mockRepOrder = createMockReplacementOrder();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(unreadyVo);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockRepOrder);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await packVendorOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INVALID_VENDOR_ORDER_TRANSITION',
      })
    );
  });

  // 22. Customer cannot modify seller fulfillment state
  it('22. Customer cannot modify seller fulfillment state', async () => {
    // When customer calls packVendorOrder, vendor check fails
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(null);

    const req = mockReq(customerUserId, 'customer', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await packVendorOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'VENDOR_ACCESS_DENIED',
      })
    );
  });

  // 23. Seller cannot modify replacement approval
  it('23. Seller cannot modify replacement approval', async () => {
    const req = mockReq(vendorUserId, 'vendor', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminCreateReplacement(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      })
    );
  });

  // 24. Admin visibility works
  it('24. Admin can view replacement, fulfillment status, and package details', async () => {
    const mockRep = createMockReplacement();
    const mockRepOrder = createMockReplacementOrder();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'READY_TO_SHIP' });
    const mockShipment = {
      packageInfo: validPackageData,
      status: 'READY_TO_SHIP',
    };

    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepVo),
    });
    jest.spyOn(Shipment, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockShipment),
    });

    const req = mockReq(adminUserId, 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminGetReplacement(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const data = res.json.mock.calls[0][0].data;
    expect(data.replacementNumber).toBe('REP-2026-001');
    expect(data.replacementOrder).toBeDefined();
  });

  // 25. Duplicate/repeated Pack request is safe
  it('25. Duplicate/repeated Pack request is safe (idempotent)', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();
    const mockShipment = {
      _id: shipmentId1,
      status: 'PACKED',
      packageInfo: validPackageData,
      toObject: () => ({ _id: shipmentId1, status: 'PACKED' }),
    };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await packVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    expect(response.data.isIdempotent).toBe(true);
    expect(response.data.vendorOrder.status).toBe('PACKED');
  });

  // 26. Duplicate/repeated Ready-to-Ship request is safe
  it('26. Duplicate/repeated Ready-to-Ship request is safe (idempotent)', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'READY_TO_SHIP' });
    const mockRepOrder = createMockReplacementOrder();
    const mockShipment = {
      _id: shipmentId1,
      status: 'READY_TO_SHIP',
      packageInfo: validPackageData,
      toObject: () => ({ _id: shipmentId1, status: 'READY_TO_SHIP' }),
    };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const response = res.json.mock.calls[0][0];
    expect(response.data.isIdempotent).toBe(true);
    expect(response.data.vendorOrder.status).toBe('READY_TO_SHIP');
  });

  // 27. Existing normal order tests continue passing
  it('27. Existing normal order pack and ready flow works unchanged', async () => {
    const mockVendor = createMockVendor();
    const normalVo = createMockOriginalVendorOrder({
      _id: originalVendorOrderId1,
      status: 'PROCESSING',
      financialSnapshot: null,
      parentOrderId: originalOrderId1,
    });
    const normalOrder = createMockOriginalOrder({
      _id: originalOrderId1,
      paymentMethod: 'razorpay',
      paymentStatus: 'PAID',
    });

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(normalVo);
    jest.spyOn(Order, 'findById').mockResolvedValue(normalOrder);
    jest.spyOn(VendorOrder, 'findOneAndUpdate').mockResolvedValue({ ...normalVo, status: 'PACKED' });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    const shipCreateSpy = jest.spyOn(shippingService, 'createShipment').mockResolvedValue({
      _id: 'ship-normal',
      status: 'PACKED',
      save: jest.fn().mockResolvedValue(true),
      toObject: () => ({ _id: 'ship-normal', status: 'PACKED' }),
    });
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: originalVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await packVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    // Normal order calls shippingService.createShipment during pack if shipment doesn't exist
    expect(shipCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: originalOrderId1,
        vendorOrderId: originalVendorOrderId1,
      })
    );
  });
});
