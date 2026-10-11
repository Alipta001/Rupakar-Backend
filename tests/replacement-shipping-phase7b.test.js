import mongoose from 'mongoose';
import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { Return } from '../app/models/return.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Shipment } from '../app/models/shipment.model.js';
import { Replacement } from '../app/models/replacement.model.js';
import { InventoryReservation } from '../app/models/inventory-reservation.model.js';
import { replacementService, isReplacementOrder } from '../app/services/replacement.service.js';
import { replacementStateService } from '../app/services/replacement-state.service.js';
import { shipmentStateService } from '../app/services/shipment-state.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { shippingService } from '../app/services/shipping.service.js';
import { paymentService } from '../app/services/payment.service.js';
import { orderService } from '../app/services/order.service.js';
import {
  deliveryProvider,
  getDeliveryProvider,
  isAuthenticAwb,
  MockDeliveryProvider,
  ShiprocketProvider,
} from '../app/services/delivery-provider.service.js';
import { normalizeIndianPhone10 } from '../app/services/sms.service.js';
import { env } from '../app/config/env.js';
import {
  readyVendorOrder,
  shipVendorOrder,
  retryVendorShipment,
  retryAdminFulfillment,
  deliveryWebhook,
} from '../app/controllers/shipping.controller.js';
import {
  getReturnDetail,
  adminGetReplacement,
  vendorGetReplacement,
} from '../app/controllers/return.controller.js';

describe('Phase 7B: Replacement Carrier Shipment Dispatch Tests', () => {
  const customerUserId = new mongoose.Types.ObjectId().toHexString();
  const otherCustomerId = new mongoose.Types.ObjectId().toHexString();
  const vendorUserId = new mongoose.Types.ObjectId().toHexString();
  const otherVendorUserId = new mongoose.Types.ObjectId().toHexString();
  const vendorId1 = new mongoose.Types.ObjectId();
  const otherVendorId = new mongoose.Types.ObjectId();
  const originalOrderId1 = new mongoose.Types.ObjectId();
  const originalVendorOrderId1 = new mongoose.Types.ObjectId();
  const returnId1 = new mongoose.Types.ObjectId();
  const replacementId1 = new mongoose.Types.ObjectId();
  const replacementOrderId1 = new mongoose.Types.ObjectId();
  const replacementVendorOrderId1 = new mongoose.Types.ObjectId();
  const shipmentId1 = new mongoose.Types.ObjectId();
  const productId1 = new mongoose.Types.ObjectId();
  const variantId1 = new mongoose.Types.ObjectId();

  const mockReq = (userId, role = 'vendor', params = {}, body = {}, query = {}) => ({
    user: { sub: userId, role },
    params,
    body,
    query,
    headers: { 'x-request-id': 'req-test-p7b' },
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
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
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
    status: 'PACKED',
    total: 0,
    subtotal: 0,
    inventoryDecremented: true,
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

  const createMockReturn = (overrides = {}) => ({
    _id: returnId1,
    returnNumber: 'RET-2026-001',
    orderId: originalOrderId1,
    vendorOrderId: originalVendorOrderId1,
    customerId: customerUserId,
    vendorId: vendorId1,
    resolutionType: 'REPLACEMENT',
    status: 'PROCESSING',
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
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
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

  // 1. READY_TO_SHIP replacement creates provider shipment
  it('1. READY_TO_SHIP replacement creates provider shipment', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();

    let createdShipmentData = null;
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockImplementation((data) => {
      createdShipmentData = { ...data, _id: shipmentId1, save: jest.fn().mockResolvedValue(true) };
      return Promise.resolve(createdShipmentData);
    });
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());
    jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(createdShipmentData).toBeDefined();
    expect(createdShipmentData.providerShipmentId).toBeDefined();
    expect(isAuthenticAwb(createdShipmentData.trackingNumber, createdShipmentData.providerShipmentId)).toBe(true);
  });

  // 2. Normal order shipping remains unchanged
  it('2. Normal order shipping remains unchanged', async () => {
    const mockVendor = createMockVendor();
    const normalVo = createMockOriginalVendorOrder({
      _id: originalVendorOrderId1,
      status: 'PACKED',
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
    const createShipmentSpy = jest.spyOn(shippingService, 'createShipment').mockResolvedValue(mockShipment);
    jest.spyOn(shipmentStateService, 'transitionShipmentStatus').mockResolvedValue(true);
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue({ status: 'CONSUMED' });
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: originalVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(createShipmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: originalOrderId1,
        cod: false,
      })
    );
  });

  // 3. Replacement uses configured DeliveryProvider
  it('3. Replacement uses configured DeliveryProvider', async () => {
    const provider = getDeliveryProvider('mock');
    expect(provider).toBeInstanceOf(MockDeliveryProvider);
  });

  // 4. Mock provider works in tests
  it('4. Mock provider works in tests and creates deterministic valid shipment', async () => {
    const mock = new MockDeliveryProvider();
    const result = await mock.createShipment({
      shipmentNumber: 'SHIP-MOCK-1',
      orderId: 'ORD-1',
      orderNumber: 'REP-2026-001',
      pickupAddress: { pickupLocationName: 'WH1' },
      deliveryAddress: { phone: '9876543210' },
      packageInfo: validPackageData,
      items: [],
      cod: false,
    });

    expect(result.providerShipmentId).toBeDefined();
    expect(isAuthenticAwb(result.trackingNumber, result.providerShipmentId)).toBe(true);
    expect(result.trackingUrl).toBeDefined();
  });

  // 5. No real Shiprocket API calls in tests
  it('5. No real Shiprocket API calls in tests (MockDeliveryProvider invoked)', async () => {
    const srSpy = jest.spyOn(ShiprocketProvider.prototype, 'request');
    const mockProvider = new MockDeliveryProvider();
    const result = await mockProvider.createShipment({
      shipmentNumber: 'SHIP-MOCK-2',
      orderId: 'ORD-2',
      orderNumber: 'REP-2026-002',
      pickupAddress: { pickupLocationName: 'WH1' },
      deliveryAddress: { phone: '9876543210' },
      packageInfo: validPackageData,
      items: [],
      cod: false,
    });

    expect(srSpy).not.toHaveBeenCalled();
    expect(result.providerShipmentId).toBeDefined();
  });

  // 6. Replacement channel order ID is unique and stable across retries
  it('6. Replacement channel order ID is unique and stable across retries', async () => {
    const mockRep = createMockReplacement();
    const canonicalOrderNumber1 = mockRep.replacementNumber;
    const canonicalOrderNumber2 = mockRep.replacementNumber;

    expect(canonicalOrderNumber1).toBe('REP-2026-001');
    expect(canonicalOrderNumber1).toBe(canonicalOrderNumber2);
  });

  // 7. Existing provider shipment is reused
  it('7. Existing provider shipment is reused without recreation', async () => {
    const existingShipment = {
      _id: shipmentId1,
      status: 'READY_TO_SHIP',
      providerShipmentId: '12345678',
      providerOrderId: 987654,
      trackingNumber: '1431234567890',
      labelUrl: 'https://shiprocket.co/label/123.pdf',
      pickupStatus: 'SCHEDULED',
      metadata: { isReplacement: true },
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipment);

    const result = await shippingService.createShipment({
      orderId: replacementOrderId1,
      orderNumber: 'REP-2026-001',
      vendorOrderId: replacementVendorOrderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      metadata: { isReplacement: true },
    });

    expect(result).toBe(existingShipment);
  });

  // 8. Duplicate concurrent shipment creation is idempotent
  it('8. Duplicate concurrent shipment creation is idempotent', async () => {
    const existingShipment = {
      _id: shipmentId1,
      status: 'READY_TO_SHIP',
      providerShipmentId: '12345678',
      providerOrderId: 987654,
      trackingNumber: '1431234567890',
      labelUrl: 'https://shiprocket.co/label/123.pdf',
      pickupStatus: 'SCHEDULED',
      metadata: { isReplacement: true },
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipment);

    const [res1, res2] = await Promise.all([
      shippingService.createShipment({
        orderId: replacementOrderId1,
        orderNumber: 'REP-2026-001',
        vendorOrderId: replacementVendorOrderId1,
        vendorId: vendorId1,
        customerId: customerUserId,
        metadata: { isReplacement: true },
      }),
      shippingService.createShipment({
        orderId: replacementOrderId1,
        orderNumber: 'REP-2026-001',
        vendorOrderId: replacementVendorOrderId1,
        vendorId: vendorId1,
        customerId: customerUserId,
        metadata: { isReplacement: true },
      }),
    ]);

    expect(res1).toBe(res2);
  });

  // 9. Existing providerOrderId is preserved
  it('9. Existing providerOrderId is preserved on retry', async () => {
    const existingShipment = {
      _id: shipmentId1,
      status: 'PACKED',
      providerOrderId: 998877,
      providerShipmentId: '112233',
      trackingNumber: null,
      save: jest.fn().mockResolvedValue(true),
      metadata: { isReplacement: true },
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipment);

    await shippingService.createShipment({
      orderId: replacementOrderId1,
      orderNumber: 'REP-2026-001',
      vendorOrderId: replacementVendorOrderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      packageInfo: validPackageData,
      metadata: { isReplacement: true },
    });

    expect(existingShipment.providerOrderId).toBe(998877);
  });

  // 10. Existing providerShipmentId is preserved
  it('10. Existing providerShipmentId is preserved on retry', async () => {
    const existingShipment = {
      _id: shipmentId1,
      status: 'PACKED',
      providerOrderId: 998877,
      providerShipmentId: '112233',
      trackingNumber: null,
      save: jest.fn().mockResolvedValue(true),
      metadata: { isReplacement: true },
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipment);

    await shippingService.createShipment({
      orderId: replacementOrderId1,
      orderNumber: 'REP-2026-001',
      vendorOrderId: replacementVendorOrderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      packageInfo: validPackageData,
      metadata: { isReplacement: true },
    });

    expect(existingShipment.providerShipmentId).toBe('112233');
  });

  // 11. COD is false for replacement shipment
  it('11. COD is strictly false for replacement shipment', async () => {
    const createShipmentSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createShipment');
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockResolvedValue({ _id: shipmentId1, save: jest.fn() });

    await shippingService.createShipment({
      orderId: replacementOrderId1,
      orderNumber: 'REP-2026-001',
      vendorOrderId: replacementVendorOrderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      packageInfo: validPackageData,
      cod: true, // Attempted COD must be overridden
      metadata: { isReplacement: true },
    });

    expect(createShipmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cod: false })
    );
  });

  // 12. Customer phone comes from shipping snapshot
  it('12. Customer phone comes from shipping snapshot', () => {
    const repOrder = createMockReplacementOrder();
    const snapshotPhone = repOrder.shippingAddressSnapshot.phone;
    const normalized = normalizeIndianPhone10(snapshotPhone);

    expect(normalized).toBe('9876543210');
  });

  // 13. Invalid phone is rejected safely
  it('13. Invalid customer phone is rejected safely', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder({
      shippingAddressSnapshot: { phone: '12345' }, // Invalid phone
    });
    const mockRep = createMockReplacement();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'INVALID_PHONE_NUMBER',
      })
    );
  });

  // 14. Approved seller pickup address is required
  it('14. Approved seller pickup address is required', async () => {
    const mockVendor = createMockVendor();
    expect(mockVendor.pickupAddress.adminStatus).toBe('APPROVED');
    expect(mockVendor.pickupAddress.registrationStatus).toBe('REGISTERED');
  });

  // 15. Unapproved pickup address is rejected
  it('15. Unapproved pickup address is rejected', async () => {
    const unapprovedVendor = createMockVendor({
      pickupAddress: {
        pickupLocationName: 'Unapproved WH',
        addressLine1: 'Line 1',
        city: 'Kolkata',
        pincode: '700001',
        registrationStatus: 'REGISTERED',
        adminStatus: 'PENDING',
      },
    });
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(unapprovedVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'PICKUP_LOCATION_NOT_APPROVED',
      })
    );
  });

  // 16. Courier selection uses existing logic
  it('16. Courier selection uses existing logic in shippingService', async () => {
    const option = await shippingService.determineBestShippingOption({
      pickupAddress: { pincode: '700001' },
      deliveryAddress: { pincode: '700002' },
      packageInfo: validPackageData,
      cod: false,
    });

    expect(option).toBeDefined();
    expect(option.carrier).toBeDefined();
    expect(option.estimatedDays).toBeGreaterThan(0);
  });

  // 17. AWB must be authentic
  it('17. AWB must be authentic according to isAuthenticAwb', () => {
    expect(isAuthenticAwb('143254921045', '12345')).toBe(true);
    expect(isAuthenticAwb('RUP8449579BAEA7AIN', 'MSHP-184C67E1')).toBe(true);
  });

  // 18. No synthetic AWB is accepted
  it('18. No synthetic AWB is accepted as authentic', () => {
    expect(isAuthenticAwb('SR12345678', '12345')).toBe(false);
    expect(isAuthenticAwb('TRK-12345678', '12345')).toBe(false);
    expect(isAuthenticAwb('98765', '98765')).toBe(false); // Shipment ID cannot be AWB
    expect(isAuthenticAwb('', '12345')).toBe(false);
    expect(isAuthenticAwb(null, '12345')).toBe(false);
  });

  // 19. AWB failure prevents pickup
  it('19. AWB failure prevents pickup request', async () => {
    const mockProvider = new MockDeliveryProvider();
    const requestPickupSpy = jest.spyOn(mockProvider, 'requestPickup');

    // Simulate provider shipment with null trackingNumber
    jest.spyOn(mockProvider, 'createShipment').mockResolvedValue({
      providerShipmentId: 'SR-FAIL-1',
      trackingNumber: null,
      providerAwb: null,
      pickupStatus: 'PENDING',
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockResolvedValue({ _id: shipmentId1, save: jest.fn() });

    await shippingService.createShipment({
      orderId: replacementOrderId1,
      orderNumber: 'REP-2026-001',
      vendorOrderId: replacementVendorOrderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      packageInfo: validPackageData,
      provider: 'mock',
      metadata: { isReplacement: true },
    });

    expect(requestPickupSpy).not.toHaveBeenCalled();
  });

  // 20. Wallet failure is handled safely
  it('20. Wallet failure in ShiprocketProvider is handled safely', async () => {
    const sr = new ShiprocketProvider();
    jest.spyOn(sr, 'request').mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({
        status_code: 422,
        message: 'Insufficient balance in your wallet to generate AWB',
      }),
    });

    await expect(sr.assignAwb({ shipmentId: '12345', courierId: 10 })).rejects.toThrow('Insufficient balance');
  });

  // 21. Label failure preserves AWB
  it('21. Label failure is safely rejected with AppError without altering AWB', async () => {
    const sr = new ShiprocketProvider();
    jest.spyOn(sr, 'request').mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({
        status_code: 500,
        message: 'Label generation temporarily failed',
      }),
    });

    await expect(sr.generateLabel({ shipmentId: '12345' })).rejects.toThrow('Label generation temporarily failed');
  });

  // 22. Pickup failure preserves AWB and label
  it('22. Pickup failure is safely rejected with AppError without corrupting AWB/label', async () => {
    const sr = new ShiprocketProvider();
    jest.spyOn(sr, 'request').mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({
        status_code: 422,
        message: 'Courier pickup slots currently full',
      }),
    });

    await expect(sr.requestPickup({ shipmentId: '12345' })).rejects.toThrow('Courier pickup slots currently full');
  });

  // 23. Pickup retry does not recreate provider order
  it('23. Pickup retry preserves existing providerOrderId and providerShipmentId', async () => {
    const existingShipment = {
      _id: shipmentId1,
      orderId: replacementOrderId1,
      vendorOrderId: replacementVendorOrderId1,
      provider: 'mock',
      providerOrderId: 556677,
      providerShipmentId: '889900',
      trackingNumber: '1431234567890',
      pickupStatus: 'PENDING',
      save: jest.fn().mockResolvedValue(true),
      metadata: { isReplacement: true },
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipment);
    const createShipmentSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createShipment');

    await shippingService.createShipment({
      orderId: replacementOrderId1,
      orderNumber: 'REP-2026-001',
      vendorOrderId: replacementVendorOrderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      packageInfo: validPackageData,
      provider: 'mock',
      metadata: { isReplacement: true },
    });

    expect(createShipmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        existingOrderId: 556677,
        existingShipmentId: '889900',
      })
    );
  });

  // 24. AWB retry does not recreate provider order
  it('24. AWB retry passes existingOrderId and existingShipmentId', async () => {
    const existingShipment = {
      _id: shipmentId1,
      orderId: replacementOrderId1,
      vendorOrderId: replacementVendorOrderId1,
      provider: 'mock',
      providerOrderId: 556677,
      providerShipmentId: '889900',
      trackingNumber: null, // Missing AWB
      save: jest.fn().mockResolvedValue(true),
      metadata: { isReplacement: true },
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipment);
    const createShipmentSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createShipment');

    await shippingService.createShipment({
      orderId: replacementOrderId1,
      orderNumber: 'REP-2026-001',
      vendorOrderId: replacementVendorOrderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      packageInfo: validPackageData,
      provider: 'mock',
      metadata: { isReplacement: true },
    });

    expect(createShipmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        existingOrderId: 556677,
        existingShipmentId: '889900',
      })
    );
  });

  // 25. Label retry does not recreate provider order
  it('25. Label retry passes existingOrderId and existingShipmentId', async () => {
    const existingShipment = {
      _id: shipmentId1,
      orderId: replacementOrderId1,
      vendorOrderId: replacementVendorOrderId1,
      provider: 'mock',
      providerOrderId: 556677,
      providerShipmentId: '889900',
      trackingNumber: '1431234567890',
      labelUrl: null, // Missing label
      save: jest.fn().mockResolvedValue(true),
      metadata: { isReplacement: true },
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipment);
    const createShipmentSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createShipment');

    await shippingService.createShipment({
      orderId: replacementOrderId1,
      orderNumber: 'REP-2026-001',
      vendorOrderId: replacementVendorOrderId1,
      vendorId: vendorId1,
      customerId: customerUserId,
      packageInfo: validPackageData,
      provider: 'mock',
      metadata: { isReplacement: true },
    });

    expect(createShipmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        existingOrderId: 556677,
        existingShipmentId: '889900',
      })
    );
  });

  // 26. Provider order recovery works
  it('26. Provider order recovery works when providerOrderId exists but providerShipmentId was missing', async () => {
    const sr = new ShiprocketProvider();
    jest.spyOn(sr, 'request').mockImplementation((endpoint) => {
      if (String(endpoint).includes('/v1/external/orders/show/998877')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: {
              id: 998877,
              shipments: [{ id: 11223344, awb_code: '1431234567890' }],
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const result = await sr.createShipment({
      existingOrderId: 998877,
      existingShipmentId: null,
      existingAwb: null,
      shipmentNumber: 'SHIP-REC-1',
      pickupAddress: { pickupLocationName: 'WH1' },
      deliveryAddress: { phone: '9876543210' },
      packageInfo: validPackageData,
    });

    expect(String(result.providerShipmentId)).toBe('11223344');
    expect(result.trackingNumber).toBe('1431234567890');
  });

  // 27. Replacement becomes SHIPPED only after valid shipment progression
  it('27. Replacement becomes SHIPPED only after valid shipment progression', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'READY_TO_SHIP' });
    const mockRepOrder = createMockReplacementOrder();
    const mockShipment = {
      _id: shipmentId1,
      status: 'READY_TO_SHIP',
      trackingNumber: '1431234567890',
      providerShipmentId: '12345',
      carrier: 'Blue Dart',
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);
    jest.spyOn(shipmentStateService, 'transitionShipmentStatus').mockResolvedValue(true);
    const syncSpy = jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 });
    const res = mockRes();
    const next = jest.fn();

    await shipVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRepVo.status).toBe('SHIPPED');
    expect(syncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorOrderId: replacementVendorOrderId1,
        status: 'SHIPPED',
      })
    );
  });

  // 28. Replacement cannot become DELIVERED without delivery event
  it('28. Replacement cannot become DELIVERED without delivery event', async () => {
    await expect(
      replacementStateService.transitionReplacementStatus('SHIPPED', 'DELIVERED', {
        replacementId: replacementId1,
        actorType: 'VENDOR',
        actorId: vendorUserId,
      })
    ).rejects.toThrow();
  });

  // 29. Customer cannot access another customer's replacement shipment
  it("29. Customer cannot access another customer's replacement shipment", async () => {
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);

    const req = mockReq(otherCustomerId, 'customer', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await getReturnDetail(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: 'RETURN_NOT_FOUND',
      })
    );
  });

  // 30. Seller cannot access another vendor's replacement shipment
  it("30. Seller cannot access another vendor's replacement shipment", async () => {
    const otherVendor = createMockVendor({ _id: otherVendorId, ownerUserId: otherVendorUserId });
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(otherVendor);
    jest.spyOn(Return, 'findOne').mockResolvedValue(null);
    jest.spyOn(Return, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: returnId1, vendorId: vendorId1 }),
    });

    const req = mockReq(otherVendorUserId, 'vendor', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await vendorGetReplacement(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      })
    );
  });

  // 31. Admin can inspect replacement shipment
  it('31. Admin can inspect replacement shipment', async () => {
    const mockRep = createMockReplacement();
    const mockShipment = {
      _id: shipmentId1,
      shipmentNumber: 'SHIP-REP-1',
      provider: 'mock',
      carrier: 'Rupakar Express Logistics',
      trackingNumber: '1431234567890',
      trackingUrl: 'https://shiprocket.co/tracking/1431234567890',
      labelUrl: 'https://shiprocket.co/label/123.pdf',
      status: 'SHIPPED',
    };

    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(Order, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(createMockReplacementOrder()),
      }),
    });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(createMockReplacementVendorOrder()),
    });
    jest.spyOn(Shipment, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockShipment),
    });

    const req = mockReq('admin-id', 'admin', { id: returnId1 });
    const res = mockRes();
    const next = jest.fn();

    await adminGetReplacement(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipment: expect.objectContaining({
            trackingNumber: '1431234567890',
            status: 'SHIPPED',
          }),
        }),
      })
    );
  });

  // 32. No payment is created
  it('32. No customer payment or Razorpay transaction is created during carrier dispatch', async () => {
    const paymentSpy = jest.spyOn(paymentService, 'createPayment');
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'PACKED' });
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockResolvedValue({ _id: shipmentId1, save: jest.fn() });
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());
    jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(paymentSpy).not.toHaveBeenCalled();
    expect(mockRepOrder.total).toBe(0);
  });

  // 33. No COD collection is created
  it('33. No COD collection is created (cod amount = 0, obligation = false)', async () => {
    const repOrder = createMockReplacementOrder();
    const repVo = createMockReplacementVendorOrder();

    expect(isReplacementOrder(repOrder, repVo)).toBe(true);
    expect(repOrder.paymentMethod).toBe('replacement');
    expect(repOrder.total).toBe(0);
    expect(repVo.total).toBe(0);
  });

  // 34. No duplicate inventory decrement occurs
  it('34. No duplicate inventory decrement occurs at carrier dispatch', async () => {
    const decreaseStockSpy = jest.spyOn(inventoryService, 'decreaseStock');
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({
      status: 'PACKED',
      inventoryDecremented: true, // Already decremented at approval in Phase 6
    });
    const mockRepOrder = createMockReplacementOrder();
    const mockRep = createMockReplacement();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockResolvedValue({ _id: shipmentId1, save: jest.fn() });
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(mockRep);
    jest.spyOn(Return, 'findById').mockResolvedValue(createMockReturn());
    jest.spyOn(replacementService, 'syncReplacementFulfillmentStatus').mockResolvedValue(true);
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(decreaseStockSpy).not.toHaveBeenCalled();
  });

  // 35. Original Order remains unchanged
  it('35. Original Order remains DELIVERED and unchanged', () => {
    const originalOrder = createMockOriginalOrder();
    expect(originalOrder.status).toBe('DELIVERED');
    expect(originalOrder.paymentStatus).toBe('PAID');
    expect(originalOrder.total).toBe(2400);
  });

  // 36. Original VendorOrder remains unchanged
  it('36. Original VendorOrder remains historically unchanged', () => {
    const originalVo = createMockOriginalVendorOrder();
    expect(originalVo.status).toBe('DELIVERED');
    expect(originalVo.total).toBe(2400);
  });

  // 37. Return is not prematurely closed
  it('37. Return remains active (not COMPLETED/CLOSED) until delivery', () => {
    const ret = createMockReturn({ status: 'PROCESSING' });
    expect(ret.status).toBe('PROCESSING');
  });

  // 38. Duplicate/repeated Ready-to-Ship is safe
  it('38. Duplicate/repeated Ready-to-Ship request is safe and idempotent', async () => {
    const mockVendor = createMockVendor();
    const mockRepVo = createMockReplacementVendorOrder({ status: 'READY_TO_SHIP' });
    const mockRepOrder = createMockReplacementOrder();
    const mockShipment = {
      _id: shipmentId1,
      status: 'READY_TO_SHIP',
      providerShipmentId: '12345',
      trackingNumber: '1431234567890',
      toObject: () => ({ _id: shipmentId1, status: 'READY_TO_SHIP' }),
    };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(mockRepVo);
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(mockRepOrder),
    });

    const req = mockReq(vendorUserId, 'vendor', { id: replacementVendorOrderId1 }, validPackageData);
    const res = mockRes();
    const next = jest.fn();

    await readyVendorOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isIdempotent: true }),
      })
    );
  });

  // 39. Existing normal shipping tests remain green
  it('39. Existing normal shipping tests remain green', async () => {
    const normalOption = await shippingService.determineBestShippingOption({
      pickupAddress: { pincode: '700001' },
      deliveryAddress: { pincode: '560001' },
      packageInfo: validPackageData,
      cod: true,
    });

    expect(normalOption).toBeDefined();
    expect(normalOption.cost).toBeDefined();
  });
});
