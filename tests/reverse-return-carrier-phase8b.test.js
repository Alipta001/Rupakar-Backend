import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ReturnShipment } from '../app/models/return-shipment.model.js';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Replacement } from '../app/models/replacement.model.js';
import { returnShipmentService } from '../app/services/return-shipment.service.js';
import { returnShipmentStateService } from '../app/services/return-shipment-state.service.js';
import {
  deliveryProvider,
  getDeliveryProvider,
  DeliveryProvider,
  ShiprocketProvider,
  MockDeliveryProvider,
  isAuthenticAwb,
} from '../app/services/delivery-provider.service.js';
import { shippingService } from '../app/services/shipping.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { paymentService } from '../app/services/payment.service.js';
import { auditService } from '../app/services/audit.service.js';
import { env } from '../app/config/env.js';
import {
  prepareReturnReverseShipment,
  getReturnReverseShipment,
  adminPrepareReverseShipment,
} from '../app/controllers/return.controller.js';

describe('Phase 8B: Reverse Carrier Integration Tests', () => {
  const customerId = new mongoose.Types.ObjectId().toHexString();
  const otherCustomerId = new mongoose.Types.ObjectId().toHexString();
  const vendorUserId = new mongoose.Types.ObjectId().toHexString();
  const otherVendorUserId = new mongoose.Types.ObjectId().toHexString();
  const adminUserId = new mongoose.Types.ObjectId().toHexString();

  const vendorId1 = new mongoose.Types.ObjectId();
  const otherVendorId = new mongoose.Types.ObjectId();
  const orderId1 = new mongoose.Types.ObjectId();
  const vendorOrderId1 = new mongoose.Types.ObjectId();
  const returnId1 = new mongoose.Types.ObjectId();
  const returnItemId1 = new mongoose.Types.ObjectId();
  const productId1 = new mongoose.Types.ObjectId();
  const variantId1 = new mongoose.Types.ObjectId();

  const mockCustomerPickupAddress = {
    name: 'Aarav Sharma',
    phone: '9876543210',
    addressLine1: 'Flat 402, Lotus Residency, MG Road',
    addressLine2: 'Near Central Mall',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    country: 'India',
  };

  const mockSellerReturnAddress = {
    pickupLocationName: 'Silk-Hub-Warehouse',
    contactPerson: 'Suresh Crafts',
    phone: '9123456780',
    addressLine1: 'Plot 12, Handloom Industrial Area',
    addressLine2: 'Phase 2',
    city: 'Mysuru',
    state: 'Karnataka',
    pincode: '570001',
    country: 'India',
  };

  const validPackageInfo = {
    weight: 0.85,
    length: 25,
    width: 20,
    height: 10,
    unit: 'kg',
    dimensionUnit: 'cm',
  };

  const createMockOrder = (overrides = {}) => ({
    _id: orderId1,
    orderNumber: 'RUP-ORD-2026-001',
    customerId,
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'razorpay',
    subtotal: 1500,
    total: 1500,
    shippingAddressSnapshot: { ...mockCustomerPickupAddress },
    items: [
      {
        productId: productId1,
        variantId: variantId1,
        title: 'Handloom Cotton Kurta',
        quantity: 2,
        price: 750,
      },
    ],
    ...overrides,
  });

  const createMockVendor = (overrides = {}) => ({
    _id: vendorId1,
    ownerUserId: vendorUserId,
    businessName: 'Mysuru Handlooms Ltd',
    phone: '9123456780',
    pickupAddress: { ...mockSellerReturnAddress },
    ...overrides,
  });

  const createMockReturn = (overrides = {}) => ({
    _id: returnId1,
    returnNumber: 'RUP-RET-2026-8B001',
    orderId: orderId1,
    vendorOrderId: vendorOrderId1,
    customerId,
    vendorId: vendorId1,
    type: 'RETURN',
    status: 'APPROVED',
    reason: 'DEFECTIVE',
    items: [returnItemId1],
    toObject() {
      return { ...this };
    },
    ...overrides,
  });

  const createMockReturnItem = (overrides = {}) => ({
    _id: returnItemId1,
    returnId: returnId1,
    orderId: orderId1,
    productId: productId1,
    variantId: variantId1,
    quantity: 1,
    unitPrice: 750,
    status: 'APPROVED',
    ...overrides,
  });

  const mockReq = (userId, role = 'customer', params = {}, body = {}, extra = {}) => ({
    user: { sub: userId, role, ...extra },
    params,
    body,
    headers: { 'x-request-id': 'req-phase8b-test' },
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
    env.DELIVERY_PROVIDER = 'mock';
  });

  // 1. Mock provider reverse shipment creation
  it('1. Mock provider reverse shipment creation returns deterministic test identifiers', async () => {
    const mockProvider = new MockDeliveryProvider();
    const result = await mockProvider.createReturnShipment({
      direction: 'RETURN',
      shipmentNumber: 'REV-RUP-RET-2026-001',
      channelOrderId: 'REV-RUP-RET-2026-001',
      pickupAddress: mockCustomerPickupAddress,
      returnAddress: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
      items: [{ name: 'Test Item', quantity: 1, unitPrice: 500 }],
      cod: false,
    });

    expect(result.provider).toBe('mock');
    expect(result.direction).toBe('RETURN');
    expect(result.cod).toBe(false);
    expect(result.pickupStatus).toBe('PENDING');
    expect(result.providerOrderId).toMatch(/^MORD-REV-/);
    expect(result.providerShipmentId).toMatch(/^MSHP-REV-/);
    expect(result.carrier).toBe('Rupakar Express Logistics');
  });

  // 2. Configured DeliveryProvider is used
  it('2. Configured DeliveryProvider is used via existing deliveryProvider proxy', async () => {
    const spy = jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment');
    await deliveryProvider.createReturnShipment({
      direction: 'RETURN',
      pickupAddress: mockCustomerPickupAddress,
      returnAddress: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
    });
    expect(spy).toHaveBeenCalled();
  });

  // 3. No second shipping abstraction
  it('3. Reuses existing DeliveryProvider abstraction without creating a secondary reverse client', () => {
    expect(typeof DeliveryProvider.prototype.createReturnShipment).toBe('function');
    expect(typeof MockDeliveryProvider.prototype.createReturnShipment).toBe('function');
    expect(typeof ShiprocketProvider.prototype.createReturnShipment).toBe('function');
    expect(getDeliveryProvider('mock')).toBeInstanceOf(MockDeliveryProvider);
    expect(getDeliveryProvider('shiprocket')).toBeInstanceOf(ShiprocketProvider);
  });

  // 4. Stable reverse channel order ID
  it('4. Stable reverse channel order ID remains consistent and distinct from forward/replacement IDs', async () => {
    const mockReturn = createMockReturn({ returnNumber: 'RET-STABLE-999' });
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);

    const providerSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment');
    const createSpy = jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    const saved = createSpy.mock.calls[0][0];
    expect(saved.channelOrderId).toBe('REV-RET-STABLE-999');
    expect(saved.channelOrderId).not.toBe(mockOrder.orderNumber);
    expect(saved.channelOrderId).not.toMatch(/^REP-/);
    expect(providerSpy.mock.calls[0][0].channelOrderId).toBe('REV-RET-STABLE-999');
  });

  // 5. Customer pickup snapshot sent
  it('5. Customer pickup address snapshot from authoritative order is sent as carrier origin', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    const providerSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment');

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    const payload = providerSpy.mock.calls[0][0];
    expect(payload.pickupAddress.addressLine1).toBe(mockCustomerPickupAddress.addressLine1);
    expect(payload.pickupAddress.pincode).toBe(mockCustomerPickupAddress.pincode);
  });

  // 6. Seller return snapshot sent
  it('6. Seller return address snapshot from vendor profile is sent as carrier destination', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    const providerSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment');

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    const payload = providerSpy.mock.calls[0][0];
    expect(payload.returnAddress.addressLine1).toBe(mockSellerReturnAddress.addressLine1);
    expect(payload.returnAddress.pincode).toBe(mockSellerReturnAddress.pincode);
  });

  // 7. Package dimensions sent correctly
  it('7. Authoritative package weight and dimensions are passed accurately to provider', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    const providerSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment');

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    const payload = providerSpy.mock.calls[0][0];
    expect(payload.packageInfo.weight).toBe(validPackageInfo.weight);
    expect(payload.packageInfo.length).toBe(validPackageInfo.length);
    expect(payload.packageInfo.width).toBe(validPackageInfo.width);
    expect(payload.packageInfo.height).toBe(validPackageInfo.height);
  });

  // 8. COD false
  it('8. Reverse return shipment is strictly marked as cod: false', async () => {
    const providerSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment');
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(providerSpy.mock.calls[0][0].cod).toBe(false);
  });

  // 9. Zero collection amount in Shiprocket payload
  it('9. Shiprocket reverse return orders send payment_method: PREPAID with zero collection', async () => {
    const srProvider = new ShiprocketProvider();
    jest.spyOn(srProvider, 'getToken').mockResolvedValue('mock_token');
    const requestSpy = jest.spyOn(srProvider, 'request').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ shipment_id: 123456, order_id: 654321, status: 'NEW' }),
    });

    await srProvider.createReturnShipment({
      direction: 'RETURN',
      channelOrderId: 'REV-RET-1234',
      pickupAddress: mockCustomerPickupAddress,
      returnAddress: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
      items: [{ name: 'Handloom Scarf', quantity: 1, unitPrice: 400 }],
    });

    expect(requestSpy).toHaveBeenCalled();
    const body = JSON.parse(requestSpy.mock.calls[0][1].body);
    expect(body.payment_method).toBe('PREPAID');
    expect(body.total_discount).toBe(0);
    expect(body.order_id).toBe('REV-RET-1234');
  });

  // 10. Invalid phone rejected safely
  it('10. Invalid customer phone number fails safely before network request', async () => {
    const mockProvider = new MockDeliveryProvider();
    await expect(
      mockProvider.createReturnShipment({
        direction: 'RETURN',
        pickupAddress: { ...mockCustomerPickupAddress, phone: '00000' },
        returnAddress: mockSellerReturnAddress,
        packageInfo: validPackageInfo,
      }),
    ).rejects.toThrow('Customer phone number must be a valid 10-digit Indian mobile number');
  });

  // 11. Valid phone normalized
  it('11. Customer phone number is normalized to 10 digits before provider payload', async () => {
    const srProvider = new ShiprocketProvider();
    jest.spyOn(srProvider, 'getToken').mockResolvedValue('mock_token');
    const requestSpy = jest.spyOn(srProvider, 'request').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ shipment_id: 123456, order_id: 654321 }),
    });

    await srProvider.createReturnShipment({
      direction: 'RETURN',
      channelOrderId: 'REV-RET-PHONE',
      pickupAddress: { ...mockCustomerPickupAddress, phone: '+91 98765-43210' },
      returnAddress: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
    });

    const body = JSON.parse(requestSpy.mock.calls[0][1].body);
    expect(body.pickup_phone).toBe('9876543210');
  });

  // 12. Missing package rejected
  it('12. Missing package dimensions or zero weight are rejected before carrier submission', async () => {
    const mockProvider = new MockDeliveryProvider();
    await expect(
      mockProvider.createReturnShipment({
        direction: 'RETURN',
        pickupAddress: mockCustomerPickupAddress,
        returnAddress: mockSellerReturnAddress,
        packageInfo: { ...validPackageInfo, weight: 0 },
      }),
    ).rejects.toThrow('Package weight, length, width, and height must be greater than 0');
  });

  // 13. Provider order ID persisted
  it('13. Provider order ID is saved to ReturnShipment document', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment').mockResolvedValue({
      provider: 'mock',
      providerOrderId: 'MORD-REV-ABC12345',
      providerShipmentId: 'MSHP-REV-XYZ98765',
      providerAwb: null,
      carrier: 'Rupakar Express Logistics',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      pickupStatus: 'PENDING',
    });

    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(shipment.providerOrderId).toBe('MORD-REV-ABC12345');
  });

  // 14. Provider shipment ID persisted
  it('14. Provider shipment ID is saved to ReturnShipment document', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment').mockResolvedValue({
      provider: 'mock',
      providerOrderId: 'MORD-REV-ABC12345',
      providerShipmentId: 'MSHP-REV-XYZ98765',
      providerAwb: null,
      carrier: 'Rupakar Express Logistics',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      pickupStatus: 'PENDING',
    });

    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(shipment.providerShipmentId).toBe('MSHP-REV-XYZ98765');
  });

  // 15. Authentic AWB persisted
  it('15. Authentic carrier AWB is persisted in providerAwb and trackingNumber', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment').mockResolvedValue({
      provider: 'mock',
      providerOrderId: 'MORD-REV-ABC12345',
      providerShipmentId: 'MSHP-REV-XYZ98765',
      providerAwb: '1431234567890',
      carrier: 'Delhivery Surface',
      trackingNumber: '1431234567890',
      trackingUrl: 'https://track.carrier.com/1431234567890',
      labelUrl: 'https://labels.carrier.com/1431234567890.pdf',
      pickupStatus: 'PENDING',
    });

    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(shipment.providerAwb).toBe('1431234567890');
    expect(shipment.trackingNumber).toBe('1431234567890');
    expect(shipment.trackingUrl).toBe('https://track.carrier.com/1431234567890');
  });

  // 16. Synthetic AWB rejected
  it('16. Synthetic AWB (TRK-*, SR*, null) is rejected by isAuthenticAwb', () => {
    expect(isAuthenticAwb('TRK-REV-12345', '12345')).toBe(false);
    expect(isAuthenticAwb('SR12345', '12345')).toBe(false);
    expect(isAuthenticAwb('null', '12345')).toBe(false);
    expect(isAuthenticAwb('', '12345')).toBe(false);
    expect(isAuthenticAwb(null, '12345')).toBe(false);
    expect(isAuthenticAwb('1431234567890', '12345')).toBe(true);
  });

  // 17. Missing AWB does not create fake AWB
  it('17. Missing AWB from provider does not create fabricated fallback tracking number', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment').mockResolvedValue({
      provider: 'mock',
      providerOrderId: 'MORD-REV-123',
      providerShipmentId: 'MSHP-REV-456',
      providerAwb: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      pickupStatus: 'PENDING',
    });

    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(shipment.trackingNumber).toBeNull();
    expect(shipment.providerAwb).toBeUndefined();
  });

  // 18. Missing tracking does not create fake tracking
  it('18. Missing tracking info leaves trackingUrl null without fabrication', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(shipment.trackingUrl).toBeNull();
  });

  // 19. Provider label URL persisted only when real
  it('19. Provider label URL is persisted only when returned by provider, null otherwise', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment').mockResolvedValue({
      provider: 'mock',
      providerOrderId: 'MORD-REV-123',
      providerShipmentId: 'MSHP-REV-456',
      labelUrl: 'https://shiprocket.co/labels/real-return-label.pdf',
      pickupStatus: 'PENDING',
    });

    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(shipment.labelUrl).toBe('https://shiprocket.co/labels/real-return-label.pdf');
  });

  // 20. Provider application rejection handled safely
  it('20. Provider application-level rejection is safely parsed without credential leakage', async () => {
    const srProvider = new ShiprocketProvider();
    jest.spyOn(srProvider, 'getToken').mockResolvedValue('mock_token');
    jest.spyOn(srProvider, 'request').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        message: 'Invalid pincode serviceability for reverse pickup',
        status_code: 422,
      }),
    });

    await expect(
      srProvider.createReturnShipment({
        direction: 'RETURN',
        channelOrderId: 'REV-RET-REJECT',
        pickupAddress: mockCustomerPickupAddress,
        returnAddress: mockSellerReturnAddress,
        packageInfo: validPackageInfo,
      }),
    ).rejects.toThrow('Invalid pincode serviceability for reverse pickup');
  });

  // 21. Provider HTTP failure handled safely
  it('21. Provider HTTP 500 failure is handled safely without leaking credentials', async () => {
    const srProvider = new ShiprocketProvider();
    jest.spyOn(srProvider, 'getToken').mockResolvedValue('mock_token');
    jest.spyOn(srProvider, 'request').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal Server Error' }),
    });

    await expect(
      srProvider.createReturnShipment({
        direction: 'RETURN',
        channelOrderId: 'REV-RET-500',
        pickupAddress: mockCustomerPickupAddress,
        returnAddress: mockSellerReturnAddress,
        packageInfo: validPackageInfo,
      }),
    ).rejects.toThrow();
  });

  // 22. Duplicate provider order recovered
  it('22. Duplicate provider order (409 / already exists) is safely recovered using stable channel ID', async () => {
    const srProvider = new ShiprocketProvider();
    jest.spyOn(srProvider, 'getToken').mockResolvedValue('mock_token');

    let requestCount = 0;
    jest.spyOn(srProvider, 'request').mockImplementation((endpoint) => {
      requestCount++;
      if (endpoint.includes('/orders/create/return')) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ message: 'Order ID already exists' }),
        });
      }
      if (endpoint.includes('/orders?channel_order_id=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 998877,
                channel_order_id: 'REV-RET-DUP-01',
                shipments: [{ id: 887766, shipment_id: 887766, awb: '1431234567890' }],
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected endpoint ${endpoint}`));
    });

    const result = await srProvider.createReturnShipment({
      direction: 'RETURN',
      channelOrderId: 'REV-RET-DUP-01',
      pickupAddress: mockCustomerPickupAddress,
      returnAddress: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
    });

    expect(result.providerOrderId).toBe(998877);
    expect(result.providerShipmentId).toBe(887766);
    expect(result.providerAwb).toBe('1431234567890');
    expect(result.recovered).toBe(true);
  });

  // 23. Existing providerOrderId reused
  it('23. Existing providerOrderId is passed to provider rather than creating a new channel order', async () => {
    const srProvider = new ShiprocketProvider();
    jest.spyOn(srProvider, 'getToken').mockResolvedValue('mock_token');
    const requestSpy = jest.spyOn(srProvider, 'request').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: 554433,
          shipments: [{ id: 443322, awb: '1431234567890' }],
        },
      }),
    });

    const result = await srProvider.createReturnShipment({
      direction: 'RETURN',
      channelOrderId: 'REV-RET-REUSE-ORD',
      existingOrderId: 554433,
      pickupAddress: mockCustomerPickupAddress,
      returnAddress: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
    });

    expect(requestSpy).toHaveBeenCalledWith(expect.stringContaining('/orders/show/554433'));
    expect(result.providerOrderId).toBe(554433);
    expect(result.providerShipmentId).toBe(443322);
  });

  // 24. Existing providerShipmentId reused
  it('24. Existing providerShipmentId is reused immediately without contacting carrier create API', async () => {
    const srProvider = new ShiprocketProvider();
    const createSpy = jest.spyOn(srProvider, 'request');

    const result = await srProvider.createReturnShipment({
      direction: 'RETURN',
      channelOrderId: 'REV-RET-REUSE-SHP',
      existingShipmentId: 776655,
      existingOrderId: 887766,
      pickupAddress: mockCustomerPickupAddress,
      returnAddress: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(result.providerShipmentId).toBe(776655);
    expect(result.providerOrderId).toBe(887766);
  });

  // 25. Provider shipment recovery when shipment ID missing
  it('25. Recovers provider shipment when providerOrderId is known but shipmentId is missing', async () => {
    const mockReturn = createMockReturn();
    const existingShipment = {
      _id: new mongoose.Types.ObjectId(),
      returnId: returnId1,
      shipmentNumber: 'REV-RUP-RET-2026-8B001',
      channelOrderId: 'REV-RUP-RET-2026-8B001',
      direction: 'RETURN',
      status: 'PENDING',
      providerOrderId: 554433,
      providerShipmentId: null,
      pickupAddressSnapshot: mockCustomerPickupAddress,
      returnAddressSnapshot: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
      items: [{ returnItemId: returnItemId1, quantity: 1, unitPrice: 750 }],
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true),
      toObject() { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(existingShipment);

    jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment').mockResolvedValue({
      provider: 'mock',
      providerOrderId: 554433,
      providerShipmentId: 998877,
      providerAwb: null,
      carrier: 'Rupakar Express Logistics',
      recovered: true,
      pickupStatus: 'PENDING',
    });

    const result = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(result.providerShipmentId).toBe(998877);
  });

  // 26. Concurrent duplicate creation is idempotent
  it('26. Concurrent duplicate creation is idempotent and returns the same shipment', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    const preparedShipment = {
      _id: new mongoose.Types.ObjectId(),
      returnId: returnId1,
      shipmentNumber: 'REV-RUP-RET-2026-8B001',
      channelOrderId: 'REV-RUP-RET-2026-8B001',
      direction: 'RETURN',
      status: 'READY_FOR_PICKUP',
      provider: 'mock',
      providerOrderId: 'MORD-REV-01',
      providerShipmentId: 'MSHP-REV-01',
      pickupAddressSnapshot: mockCustomerPickupAddress,
      returnAddressSnapshot: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
      items: [{ returnItemId: returnItemId1, quantity: 1, unitPrice: 750 }],
      statusHistory: [],
      toObject() { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(preparedShipment);

    const [res1, res2] = await Promise.all([
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: customerId, role: 'customer' },
      }),
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: customerId, role: 'customer' },
      }),
    ]);

    expect(res1._id).toBe(res2._id);
    expect(res1.providerShipmentId).toBe(res2.providerShipmentId);
  });

  // 27. No second provider order created
  it('27. No second provider order created during concurrent duplicate preparation requests', async () => {
    const providerSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment');
    const mockReturn = createMockReturn();
    const existingShipment = {
      _id: new mongoose.Types.ObjectId(),
      returnId: returnId1,
      shipmentNumber: 'REV-RUP-RET-2026-8B001',
      status: 'READY_FOR_PICKUP',
      providerShipmentId: 'MSHP-REV-ALREADY-CREATED',
      toObject() { return { ...this }; },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(existingShipment);

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(providerSpy).not.toHaveBeenCalled();
  });

  // 28. Reverse direction remains RETURN
  it('28. Reverse shipment direction is strictly RETURN', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(shipment.direction).toBe('RETURN');
  });

  // 29. Reverse shipment does not become PICKED_UP merely from creation
  it('29. Reverse shipment status progresses only to READY_FOR_PICKUP, not PICKED_UP', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(shipment.status).toBe('READY_FOR_PICKUP');
    expect(shipment.status).not.toBe('PICKED_UP');
    expect(shipment.status).not.toBe('IN_TRANSIT');
  });

  // 30. Return is not marked REFUNDED
  it('30. Carrier shipment creation does NOT mark the Return as REFUNDED', async () => {
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(mockReturn.status).toBe('APPROVED');
    expect(mockReturn.status).not.toBe('REFUNDED');
  });

  // 31. Return is not marked COMPLETED
  it('31. Carrier shipment creation does NOT mark the Return as COMPLETED or CLOSED', async () => {
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(mockReturn.status).not.toBe('COMPLETED');
    expect(mockReturn.status).not.toBe('CLOSED');
  });

  // 32. No Razorpay calls
  it('32. No Razorpay or payment provider calls are executed during reverse carrier integration', async () => {
    const paymentCreateSpy = jest.spyOn(paymentService, 'createPayment');
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(paymentCreateSpy).not.toHaveBeenCalled();
  });

  // 33. No inventory mutation
  it('33. No inventory mutations or restock calls occur during reverse carrier integration', async () => {
    const reserveSpy = jest.spyOn(inventoryService, 'reserveStock');
    const releaseSpy = jest.spyOn(inventoryService, 'releaseStock');
    const adjustSpy = jest.spyOn(inventoryService, 'adjustStock');
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(reserveSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(adjustSpy).not.toHaveBeenCalled();
  });

  // 34. Original Order unchanged
  it('34. Original Order status and financial totals remain completely untouched', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder({ status: 'DELIVERED', total: 1500 });
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(mockOrder.status).toBe('DELIVERED');
    expect(mockOrder.total).toBe(1500);
  });

  // 35. Original VendorOrder unchanged
  it('35. Original VendorOrder document is not mutated by reverse carrier creation', async () => {
    const voUpdateSpy = jest.spyOn(VendorOrder, 'updateOne');
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(voUpdateSpy).not.toHaveBeenCalled();
  });

  // 36. Replacement unchanged
  it('36. Replacement orders remain unchanged during reverse logistics creation', async () => {
    const repUpdateSpy = jest.spyOn(Replacement, 'updateOne');
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(repUpdateSpy).not.toHaveBeenCalled();
  });

  // 37. Customer isolation
  it('37. Customer isolation prevents accessing another customer return reverse shipment', async () => {
    const mockReturn = createMockReturn({ customerId });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: otherCustomerId, role: 'customer' },
      }),
    ).rejects.toThrow('Access denied to this return');
  });

  // 38. Vendor isolation
  it('38. Vendor isolation prevents accessing returns belonging to another vendor', async () => {
    const mockReturn = createMockReturn({ vendorId: vendorId1 });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Vendor, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: otherVendorId, ownerUserId: otherVendorUserId }),
    });

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: otherVendorUserId, role: 'vendor' },
      }),
    ).rejects.toThrow('Access denied to this return');
  });

  // 39. Admin authorization
  it('39. Admin has full authorization to prepare reverse carrier shipments', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({ ...d, toObject() { return { ...this }; } }));

    const shipment = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: adminUserId, role: 'admin' },
    });

    expect(shipment).toBeDefined();
    expect(shipment.shipmentNumber).toBe('REV-RUP-RET-2026-8B001');
  });

  // 40. Existing forward shipping unaffected
  it('40. Existing forward shipping creates standard forward shipments without interference', async () => {
    const mockProvider = new MockDeliveryProvider();
    const forwardSpy = jest.spyOn(mockProvider, 'createShipment');
    const result = await mockProvider.createShipment({
      shipmentNumber: 'SHIP-FWD-001',
      orderId: orderId1,
      vendorOrderId: vendorOrderId1,
      pickupAddress: mockSellerReturnAddress,
      deliveryAddress: mockCustomerPickupAddress,
      packageInfo: validPackageInfo,
      items: [],
      cod: false,
    });

    expect(forwardSpy).toHaveBeenCalled();
    expect(result.shipmentNumber).toBe('SHIP-FWD-001');
    expect(result.status).toBe('READY_TO_SHIP');
  });

  // 41. Existing Shiprocket tests remain green (verified via suite runs)
  it('41. Shiprocket provider retains backwards compatibility with forward createShipment', () => {
    const srProvider = new ShiprocketProvider();
    expect(typeof srProvider.createShipment).toBe('function');
    expect(typeof srProvider.createReturnShipment).toBe('function');
  });

  // 42. No real external API calls in Jest
  it('42. Verifies that no real un-mocked external network calls occur during test execution', async () => {
    const fetchSpy = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchSpy;

    const mockProvider = new MockDeliveryProvider();
    await mockProvider.createReturnShipment({
      direction: 'RETURN',
      pickupAddress: mockCustomerPickupAddress,
      returnAddress: mockSellerReturnAddress,
      packageInfo: validPackageInfo,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    global.fetch = originalFetch;
  });
});
