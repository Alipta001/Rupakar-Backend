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
import { deliveryProvider, ShiprocketProvider, MockDeliveryProvider } from '../app/services/delivery-provider.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { paymentService, MockPaymentProvider } from '../app/services/payment.service.js';
import { refundService } from '../app/services/refund.service.js';
import {
  prepareReturnReverseShipment,
  getReturnReverseShipment,
  vendorGetReverseShipment,
  adminGetReverseShipment,
  adminPrepareReverseShipment,
} from '../app/controllers/return.controller.js';

describe('Phase 8A: Reverse Return Logistics Foundation Tests', () => {
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
    fullName: 'Aarav Sharma',
    phone: '9876543210',
    addressLine1: 'Flat 402, Lotus Residency, MG Road',
    addressLine2: 'Near Central Mall',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    country: 'India',
  };

  const mockSellerPickupAddress = {
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

  const mockReq = (userId, role = 'customer', params = {}, body = {}, query = {}, extra = {}) => ({
    user: { sub: userId, role, ...extra },
    params,
    body,
    query,
    headers: { 'x-request-id': 'req-phase8a-test' },
  });

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
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
        vendorId: vendorId1,
        productName: 'Chanderi Silk Stole',
        sku: 'SILK-STOLE-01',
        quantity: 3,
        unitPrice: 500,
        lineTotal: 1500,
      },
    ],
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  const createMockVendor = (overrides = {}) => ({
    _id: vendorId1,
    ownerUserId: vendorUserId,
    businessName: 'Varanasi Weavers Co.',
    phone: '9123456780',
    pickupAddress: { ...mockSellerPickupAddress },
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
    unitPrice: 500,
    lineTotal: 500,
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  const createMockReturn = (overrides = {}) => ({
    _id: returnId1,
    returnNumber: 'RUP-RET-2026-8A001',
    orderId: orderId1,
    vendorOrderId: vendorOrderId1,
    customerId,
    vendorId: vendorId1,
    type: 'RETURN',
    reason: 'DAMAGED_OR_DEFECTIVE',
    status: 'APPROVED',
    items: [returnItemId1],
    save: jest.fn().mockResolvedValue(true),
    toObject: function () {
      return { ...this };
    },
    ...overrides,
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // 1. ReturnShipment model creation
  it('1. ReturnShipment model creation validates schema and default values', () => {
    const shipment = new ReturnShipment({
      returnId: returnId1,
      orderId: orderId1,
      vendorOrderId: vendorOrderId1,
      customerId,
      vendorId: vendorId1,
      shipmentNumber: 'REV-RUP-RET-2026-8A001',
      packageInfo: validPackageInfo,
      pickupAddressSnapshot: mockCustomerPickupAddress,
      returnAddressSnapshot: mockSellerPickupAddress,
    });

    expect(shipment.direction).toBe('RETURN');
    expect(shipment.status).toBe('PENDING');
    expect(shipment.pickupStatus).toBe('PENDING');
    expect(shipment.trackingNumber).toBeNull();
    expect(shipment.trackingUrl).toBeNull();
    expect(shipment.labelUrl).toBeNull();
    expect(shipment.packageInfo.weight).toBe(0.85);
  });

  // 2. Reverse shipment linked to correct Return
  it('2. Reverse shipment is linked to correct Return and preserves order/vendor IDs', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    const createSpy = jest.spyOn(ReturnShipment, 'create').mockImplementation(async (data) => ({
      ...data,
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() {
        return { ...this };
      },
    }));

    const result = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(createSpy).toHaveBeenCalled();
    const payload = createSpy.mock.calls[0][0];
    expect(String(payload.returnId)).toBe(String(returnId1));
    expect(String(payload.orderId)).toBe(String(orderId1));
    expect(String(payload.vendorOrderId)).toBe(String(vendorOrderId1));
    expect(String(payload.customerId)).toBe(String(customerId));
    expect(String(payload.vendorId)).toBe(String(vendorId1));
    expect(result.shipmentNumber).toBe('REV-RUP-RET-2026-8A001');
  });

  // 3. Customer isolation
  it('3. Customer isolation prevents accessing another customer return', async () => {
    const mockReturn = createMockReturn({ customerId });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: otherCustomerId, role: 'customer' },
      }),
    ).rejects.toThrow('Access denied to this return');

    await expect(
      returnShipmentService.getReturnShipment({
        returnId: returnId1,
        user: { sub: otherCustomerId, role: 'customer' },
      }),
    ).rejects.toThrow('Access denied to this return');
  });

  // 4. Vendor isolation
  it('4. Vendor isolation prevents accessing returns belonging to another vendor', async () => {
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

    await expect(
      returnShipmentService.getReturnShipment({
        returnId: returnId1,
        user: { sub: otherVendorUserId, role: 'vendor' },
      }),
    ).rejects.toThrow('Access denied to this return');
  });

  // 5. Admin access
  it('5. Admin has authorized access to inspect and prepare reverse shipments', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (data) => ({
      ...data,
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() {
        return { ...this };
      },
    }));

    const result = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: adminUserId, role: 'admin' },
    });

    expect(result.shipmentNumber).toBe('REV-RUP-RET-2026-8A001');
    expect(result.statusHistory[0].actorRole).toBe('ADMIN');
  });

  // 6. Invalid Return rejected
  it('6. Non-existent return is rejected with 404', async () => {
    jest.spyOn(Return, 'findById').mockResolvedValue(null);

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: new mongoose.Types.ObjectId(),
        packageInfo: validPackageInfo,
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('Return not found');
  });

  // 7. Cancelled Return rejected
  it('7. Cancelled return is rejected from reverse shipment preparation', async () => {
    const mockReturn = createMockReturn({ status: 'CANCELLED' });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('not eligible for reverse shipment');
  });

  // 8. Closed Return rejected
  it('8. Closed and completed returns are rejected from reverse shipment preparation', async () => {
    const mockClosedReturn = createMockReturn({ status: 'CLOSED' });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockClosedReturn);

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('not eligible for reverse shipment');

    const mockCompletedReturn = createMockReturn({ status: 'COMPLETED' });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockCompletedReturn);

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('not eligible for reverse shipment');
  });

  // 9. Invalid quantity rejected
  it('9. Invalid quantity in return item is rejected', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem({ quantity: 0 });

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('Return item quantity must be greater than 0');
  });

  // 10. Partial return quantity preserved
  it('10. Partial return quantity is preserved in reverse logistics', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder({
      items: [
        {
          productId: productId1,
          variantId: variantId1,
          quantity: 4, // Purchased 4
          unitPrice: 500,
        },
      ],
    });
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem({ quantity: 2 }); // Returning 2

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    const createSpy = jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      _id: new mongoose.Types.ObjectId(),
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    const saved = createSpy.mock.calls[0][0];
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0].quantity).toBe(2);
    expect(mockOrder.items[0].quantity).toBe(4); // Original order quantity unchanged!
  });

  // 11. Cumulative return quantity protection preserved
  it('11. Cumulative return quantity protection prevents return exceeding purchased quantity', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder({
      items: [
        {
          productId: productId1,
          variantId: variantId1,
          quantity: 1, // Only 1 purchased
          unitPrice: 500,
        },
      ],
    });
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem({ quantity: 5 }); // Attempting 5

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: validPackageInfo,
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('Return quantity cannot exceed purchased quantity');
  });

  // 12. Customer pickup snapshot captured
  it('12. Captures customer pickup address snapshot from authoritative order shipping snapshot', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    const createSpy = jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      _id: new mongoose.Types.ObjectId(),
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    const snapshot = createSpy.mock.calls[0][0].pickupAddressSnapshot;
    expect(snapshot.name).toBe('Aarav Sharma');
    expect(snapshot.phone).toBe('9876543210');
    expect(snapshot.addressLine1).toBe('Flat 402, Lotus Residency, MG Road');
    expect(snapshot.city).toBe('Bengaluru');
    expect(snapshot.state).toBe('Karnataka');
    expect(snapshot.pincode).toBe('560001');
  });

  // 13. Seller receiving address snapshot captured
  it('13. Captures seller receiving address snapshot from authoritative vendor profile', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    const createSpy = jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      _id: new mongoose.Types.ObjectId(),
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    const snapshot = createSpy.mock.calls[0][0].returnAddressSnapshot;
    expect(snapshot.contactPerson).toBe('Suresh Crafts');
    expect(snapshot.addressLine1).toBe('Plot 12, Handloom Industrial Area');
    expect(snapshot.city).toBe('Mysuru');
    expect(snapshot.state).toBe('Karnataka');
    expect(snapshot.pincode).toBe('570001');
  });

  // 14. Address changes do not mutate snapshot
  it('14. Subsequent mutations on original order or vendor do not mutate saved address snapshots', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);

    let savedShipment = null;
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => {
      savedShipment = JSON.parse(JSON.stringify(d));
      return {
        ...d,
        _id: new mongoose.Types.ObjectId(),
        toObject() {
          return { ...this };
        },
      };
    });

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    // Mutate order shipping address and vendor address
    mockOrder.shippingAddressSnapshot.city = 'New City';
    mockVendor.pickupAddress.city = 'Another City';

    expect(savedShipment.pickupAddressSnapshot.city).toBe('Bengaluru');
    expect(savedShipment.returnAddressSnapshot.city).toBe('Mysuru');
  });

  // 15. Package weight validation
  it('15. Rejects package weight <= 0 or non-numeric', async () => {
    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: { ...validPackageInfo, weight: 0 },
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('Weight must be greater than 0');

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: { ...validPackageInfo, weight: -1 },
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('Weight must be greater than 0');
  });

  // 16. Package dimension validation
  it('16. Rejects non-positive package dimensions', async () => {
    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: { ...validPackageInfo, length: 0 },
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('Length must be greater than 0');

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: { ...validPackageInfo, width: -5 },
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('Width must be greater than 0');

    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: { ...validPackageInfo, height: 0 },
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('Height must be greater than 0');
  });

  // 17. Missing package data rejected
  it('17. Rejects missing package information', async () => {
    await expect(
      returnShipmentService.prepareReturnShipment({
        returnId: returnId1,
        packageInfo: null,
        user: { sub: customerId, role: 'customer' },
      }),
    ).rejects.toThrow('Valid package weight and dimensions are required');
  });

  // 18. Duplicate reverse shipment prevented
  it('18. Duplicate reverse shipment is prevented and returns existing shipment idempotently', async () => {
    const mockReturn = createMockReturn();
    const existing = {
      _id: new mongoose.Types.ObjectId(),
      returnId: returnId1,
      shipmentNumber: 'REV-RUP-RET-2026-8A001',
      status: 'PENDING',
      toObject() {
        return { ...this };
      },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(existing);
    const createSpy = jest.spyOn(ReturnShipment, 'create');

    const result = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(result._id).toBe(existing._id);
  });

  // 19. Concurrent duplicate creation handled safely
  it('19. Concurrent duplicate creation race condition (Mongo duplicate key 11000) is handled safely', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();
    const existing = {
      _id: new mongoose.Types.ObjectId(),
      returnId: returnId1,
      shipmentNumber: 'REV-RUP-RET-2026-8A001',
      status: 'PENDING',
      toObject() {
        return { ...this };
      },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });

    // First findOne returns null, but concurrent race hits create -> throws 11000 -> second findOne returns existing
    jest
      .spyOn(ReturnShipment, 'findOne')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);

    const dupError = new Error('E11000 duplicate key error collection: returnshipments index: returnId_1');
    dupError.code = 11000;
    jest.spyOn(ReturnShipment, 'create').mockRejectedValue(dupError);

    const result = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(result._id).toBe(existing._id);
  });

  // 20. Reverse shipment has explicit RETURN direction
  it('20. Reverse shipment has explicit direction: RETURN', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    const createSpy = jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(createSpy.mock.calls[0][0].direction).toBe('RETURN');
  });

  // 21. Stable reverse identifier
  it('21. Generates deterministic and stable reverse shipment identifier', async () => {
    const mockReturn = createMockReturn({ returnNumber: 'RET-FIXED-1234' });
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    const createSpy = jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    const saved = createSpy.mock.calls[0][0];
    expect(saved.shipmentNumber).toBe('REV-RET-FIXED-1234');
    expect(saved.channelOrderId).toBe('REV-RET-FIXED-1234');
  });

  // 22. No Shiprocket API call
  it('22. Does NOT make any Shiprocket carrier API calls', async () => {
    const shiprocketSpy = jest.spyOn(ShiprocketProvider.prototype, 'createShipment');
    const mockProviderSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createShipment');

    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(shiprocketSpy).not.toHaveBeenCalled();
    expect(mockProviderSpy).not.toHaveBeenCalled();
  });

  // 23. No Razorpay call
  it('23. Does NOT invoke Razorpay or refund execution during reverse shipment preparation', async () => {
    const refundSpy = jest.spyOn(refundService, 'createRefund');
    const paymentCreateSpy = jest.spyOn(paymentService, 'createPayment');
    const mockProviderRefundSpy = jest.spyOn(MockPaymentProvider.prototype, 'refundPayment');

    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(refundSpy).not.toHaveBeenCalled();
    expect(paymentCreateSpy).not.toHaveBeenCalled();
    expect(mockProviderRefundSpy).not.toHaveBeenCalled();
  });

  // 24. No inventory mutation
  it('24. Does NOT mutate product inventory or stock levels during reverse shipment preparation', async () => {
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
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(reserveSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(adjustSpy).not.toHaveBeenCalled();
  });

  // 25. Original Order unchanged
  it('25. Leaves original Order status and payment untouched', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const orderSaveSpy = mockOrder.save;
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(mockOrder.status).toBe('DELIVERED');
    expect(mockOrder.paymentStatus).toBe('PAID');
    expect(orderSaveSpy).not.toHaveBeenCalled();
  });

  // 26. Original VendorOrder unchanged
  it('26. Leaves original VendorOrder untouched', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();
    const voSaveSpy = jest.fn();
    const mockVendorOrder = {
      _id: vendorOrderId1,
      status: 'DELIVERED',
      save: voSaveSpy,
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(voSaveSpy).not.toHaveBeenCalled();
    expect(mockVendorOrder.status).toBe('DELIVERED');
  });

  // 27. Replacement order unchanged
  it('27. Leaves replacement order records unchanged', async () => {
    const mockReturn = createMockReturn({ type: 'REPLACEMENT' });
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    const repSaveSpy = jest.fn();
    jest.spyOn(Replacement, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        status: 'PENDING',
        save: repSaveSpy,
      }),
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(repSaveSpy).not.toHaveBeenCalled();
  });

  // 28. Return not prematurely completed
  it('28. Creating reverse shipment does NOT prematurely mark Return as REFUNDED, COMPLETED, or CLOSED', async () => {
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(mockReturn.status).toBe('APPROVED');
    expect(mockReturn.status).not.toBe('REFUNDED');
    expect(mockReturn.status).not.toBe('COMPLETED');
    expect(mockReturn.status).not.toBe('CLOSED');
  });

  // 29. State transition validation
  it('29. State transition service validates transitions and blocks illegal state jumps', async () => {
    const shipment = new ReturnShipment({
      returnId: returnId1,
      orderId: orderId1,
      customerId,
      vendorId: vendorId1,
      shipmentNumber: 'REV-TEST-01',
      packageInfo: validPackageInfo,
      pickupAddressSnapshot: mockCustomerPickupAddress,
      returnAddressSnapshot: mockSellerPickupAddress,
      status: 'PENDING',
    });
    shipment.save = jest.fn().mockResolvedValue(true);

    // Illegal jump PENDING -> DELIVERED
    await expect(
      returnShipmentStateService.transitionShipmentStatus(shipment, 'DELIVERED', {
        actorRole: 'ADMIN',
      }),
    ).rejects.toThrow('Cannot transition reverse shipment from PENDING to DELIVERED');

    // Legal transition PENDING -> READY_FOR_PICKUP
    await returnShipmentStateService.transitionShipmentStatus(shipment, 'READY_FOR_PICKUP', {
      actorRole: 'VENDOR',
      reason: 'Seller packed return instruction label',
    });
    expect(shipment.status).toBe('READY_FOR_PICKUP');

    // Legal transition READY_FOR_PICKUP -> PICKUP_REQUESTED
    await returnShipmentStateService.transitionShipmentStatus(shipment, 'PICKUP_REQUESTED', {
      actorRole: 'SYSTEM',
    });
    expect(shipment.status).toBe('PICKUP_REQUESTED');
    expect(shipment.pickupStatus).toBe('REQUESTED');

    // Legal transition PICKUP_REQUESTED -> PICKUP_FAILED
    await returnShipmentStateService.transitionShipmentStatus(shipment, 'PICKUP_FAILED', {
      actorRole: 'SYSTEM',
      reason: 'Customer premises closed',
    });
    expect(shipment.status).toBe('PICKUP_FAILED');
    expect(shipment.pickupStatus).toBe('FAILED');

    // Retry transition PICKUP_FAILED -> READY_FOR_PICKUP
    await returnShipmentStateService.transitionShipmentStatus(shipment, 'READY_FOR_PICKUP', {
      actorRole: 'ADMIN',
      reason: 'Admin initiated retry after contacting customer',
    });
    expect(shipment.status).toBe('READY_FOR_PICKUP');
  });

  // 30. Status history records actor/action
  it('30. Status history records actor, role, previousStatus, and optional reason', async () => {
    const shipment = new ReturnShipment({
      returnId: returnId1,
      orderId: orderId1,
      customerId,
      vendorId: vendorId1,
      shipmentNumber: 'REV-TEST-02',
      packageInfo: validPackageInfo,
      pickupAddressSnapshot: mockCustomerPickupAddress,
      returnAddressSnapshot: mockSellerPickupAddress,
      status: 'PENDING',
      statusHistory: [],
    });
    shipment.save = jest.fn().mockResolvedValue(true);

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'READY_FOR_PICKUP', {
      actorId: adminUserId,
      actorRole: 'ADMIN',
      reason: 'Admin confirmed return pickup readiness',
    });

    expect(shipment.statusHistory).toHaveLength(1);
    const entry = shipment.statusHistory[0];
    expect(entry.previousStatus).toBe('PENDING');
    expect(entry.status).toBe('READY_FOR_PICKUP');
    expect(String(entry.actorId)).toBe(String(adminUserId));
    expect(entry.actorRole).toBe('ADMIN');
    expect(entry.reason).toBe('Admin confirmed return pickup readiness');
  });

  // 31. Fake AWB is never generated
  it('31. Tracking number and tracking URL remain null in Phase 8A (no fake AWBs)', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => ({
      ...d,
      toObject() {
        return { ...this };
      },
    }));

    const result = await returnShipmentService.prepareReturnShipment({
      returnId: returnId1,
      packageInfo: validPackageInfo,
      user: { sub: customerId, role: 'customer' },
    });

    expect(result.trackingNumber).toBeNull();
    expect(result.trackingUrl).toBeNull();
    expect(result.labelUrl).toBeNull();
  });

  // 32. API endpoints verification
  it('32. Endpoints prepareReturnReverseShipment and getReturnReverseShipment return structured DTOs with tenant isolation', async () => {
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockVendor = createMockVendor();
    const mockItem = createMockReturnItem();
    const createdShipment = {
      _id: new mongoose.Types.ObjectId(),
      returnId: returnId1,
      orderId: orderId1,
      vendorOrderId: vendorOrderId1,
      customerId,
      vendorId: vendorId1,
      shipmentNumber: 'REV-RUP-RET-2026-8A001',
      channelOrderId: 'REV-RUP-RET-2026-8A001',
      direction: 'RETURN',
      status: 'PENDING',
      pickupStatus: 'PENDING',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      packageInfo: validPackageInfo,
      pickupAddressSnapshot: mockCustomerPickupAddress,
      returnAddressSnapshot: mockSellerPickupAddress,
      items: [{ returnItemId: returnItemId1, quantity: 1 }],
      statusHistory: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject() {
        return { ...this };
      },
    };

    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([mockItem]),
    });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(createdShipment);
    jest.spyOn(ReturnShipment, 'create').mockResolvedValue(createdShipment);

    // Customer prepare endpoint
    const req = mockReq(customerId, 'customer', { id: returnId1.toHexString() }, { packageInfo: validPackageInfo });
    const res = mockRes();
    const next = jest.fn();

    await prepareReturnReverseShipment(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const customerDto = res.json.mock.calls[0][0].data;
    expect(customerDto.shipmentNumber).toBe('REV-RUP-RET-2026-8A001');
    expect(customerDto.nextExpectedStep).toBe('Reverse shipment record created. Ready for pickup arrangement.');
    expect(customerDto.returnAddressSnapshot).toBeUndefined(); // Sensitive vendor data hidden from customer DTO

    // Admin get endpoint
    const adminReq = mockReq(adminUserId, 'admin', { id: returnId1.toHexString() });
    const adminRes = mockRes();
    const adminNext = jest.fn();

    await adminGetReverseShipment(adminReq, adminRes, adminNext);
    expect(adminNext).not.toHaveBeenCalled();
    expect(adminRes.status).toHaveBeenCalledWith(200);
    const adminDto = adminRes.json.mock.calls[0][0].data;
    expect(adminDto.returnAddressSnapshot).toBeDefined(); // Admin gets operational snapshots
  });
});
