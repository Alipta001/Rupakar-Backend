import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { ReturnShipment } from '../app/models/return-shipment.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Shipment } from '../app/models/shipment.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { returnShipmentService } from '../app/services/return-shipment.service.js';
import { MockDeliveryProvider } from '../app/services/delivery-provider.service.js';
import { env } from '../app/config/env.js';
import {
  sellerApproveReturn,
  sellerMarkReturnReceived,
  buildVendorReturnDto,
} from '../app/controllers/return.controller.js';

describe('Seller Return Approval to Reverse Logistics Integration Tests', () => {
  const sellerUserId = new mongoose.Types.ObjectId().toHexString();
  const customerId = new mongoose.Types.ObjectId().toHexString();
  const vendorId = new mongoose.Types.ObjectId().toHexString();
  const returnId = new mongoose.Types.ObjectId().toHexString();
  const orderId = new mongoose.Types.ObjectId().toHexString();
  const vendorOrderId = new mongoose.Types.ObjectId().toHexString();
  const returnItemId = new mongoose.Types.ObjectId().toHexString();
  const variantId = new mongoose.Types.ObjectId().toHexString();

  const mockCustomerAddress = {
    fullName: 'Aditi Banerjee',
    phone: '9876543210',
    addressLine1: '45, Southern Avenue',
    addressLine2: 'Apt 3B',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700029',
    country: 'India',
  };

  const mockVendorPickupAddress = {
    pickupLocationName: 'Bishnupur-Hub',
    contactPerson: 'Suresh Crafts',
    phone: '9123456780',
    addressLine1: 'Station Road, Ward 4',
    addressLine2: 'Silk Cluster',
    city: 'Bishnupur',
    state: 'West Bengal',
    pincode: '722122',
    country: 'India',
  };

  const mockForwardPackageInfo = {
    weight: 0.9,
    length: 22,
    width: 18,
    height: 12,
    unit: 'kg',
    dimensionUnit: 'cm',
  };

  const mockReq = (body = {}, headers = {}) => ({
    user: { sub: sellerUserId, role: 'VENDOR', vendorId },
    params: { id: returnId },
    body,
    headers: { 'x-request-id': 'req-rev-int-test', ...headers },
  });

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const createMockVendor = () => ({
    _id: vendorId,
    ownerUserId: sellerUserId,
    businessName: 'Bengal Terracotta Hub',
    phone: '9123456780',
    pickupAddress: { ...mockVendorPickupAddress },
    toObject() {
      return { ...this };
    },
  });

  const createMockOrder = () => ({
    _id: orderId,
    orderNumber: 'RUP-ORD-2026-901',
    customerId,
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'razorpay',
    subtotal: 1800,
    total: 1800,
    shippingAddress: { ...mockCustomerAddress },
    shippingAddressSnapshot: { ...mockCustomerAddress },
    items: [
      {
        productId: new mongoose.Types.ObjectId().toHexString(),
        variantId,
        vendorId,
        productName: 'Terracotta Horse Figurine',
        sku: 'BISHNU-HORSE-01',
        quantity: 1,
        unitPrice: 1800,
        lineTotal: 1800,
      },
    ],
    toObject() {
      return { ...this };
    },
  });

  const createMockReturnItem = () => ({
    _id: returnItemId,
    productId: new mongoose.Types.ObjectId().toHexString(),
    variantId,
    quantity: 1,
    unitPrice: 1800,
    lineTotal: 1800,
    toObject() {
      return { ...this };
    },
  });

  const createMockReturn = (overrides = {}) => {
    const doc = {
      _id: returnId,
      returnNumber: 'RUP-RET-2026-INT001',
      orderId,
      vendorOrderId,
      customerId,
      vendorId,
      type: 'RETURN',
      reason: 'DAMAGED_OR_DEFECTIVE',
      status: 'UNDER_REVIEW',
      items: [returnItemId],
      statusHistory: [],
      save: jest.fn().mockImplementation(async function () {
        return this;
      }),
      toObject() {
        return { ...this };
      },
      ...overrides,
    };
    return doc;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    env.DELIVERY_PROVIDER = 'mock';

    // Default safe mocks for uncalled Mongoose collections
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(Order, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      lean: jest.fn().mockResolvedValue(null),
    });
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  });

  // TEST 1: UNDER_REVIEW → sellerApproveReturn() → APPROVED → ReturnShipment created
  it('TEST 1: UNDER_REVIEW → sellerApproveReturn() sets status APPROVED and creates ReturnShipment', async () => {
    const mockVendor = createMockVendor();
    const mockReturn = createMockReturn();
    const mockOrder = createMockOrder();
    const mockItem = createMockReturnItem();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockReturn);
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);

    // Mock forward shipment to provide authoritative package info
    jest.spyOn(Shipment, 'findOne').mockResolvedValue({
      _id: new mongoose.Types.ObjectId().toHexString(),
      orderId,
      packageInfo: mockForwardPackageInfo,
    });

    let savedReturnShipment = null;
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (data) => {
      savedReturnShipment = {
        ...data,
        _id: new mongoose.Types.ObjectId().toHexString(),
        save: jest.fn().mockResolvedValue(true),
        toObject() {
          return { ...this };
        },
      };
      return savedReturnShipment;
    });

    const req = mockReq({ notes: 'Seller approved return' });
    const res = mockRes();
    const next = jest.fn();

    await sellerApproveReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockReturn.status).toBe('APPROVED');
    expect(mockReturn.approvedBy).toBe(sellerUserId);
    expect(savedReturnShipment).not.toBeNull();
    expect(savedReturnShipment.returnId.toString()).toBe(returnId.toString());
    expect(savedReturnShipment.providerOrderId).toBeDefined();
    expect(savedReturnShipment.providerShipmentId).toBeDefined();
  });

  // TEST 2: sellerApproveReturn() → reverse workflow starts
  it('TEST 2: sellerApproveReturn() starts complete reverse workflow', async () => {
    const mockVendor = createMockVendor();
    const mockReturn = createMockReturn();
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockReturn);
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const autoProcessSpy = jest.spyOn(returnShipmentService, 'autoProcessReverseShipment').mockResolvedValue({
      shipment: { _id: 'ship-123', status: 'PICKUP_SCHEDULED' },
      success: true,
      stage: 'PICKUP_SCHEDULED',
    });

    const req = mockReq({ notes: 'Approving return', packageInfo: mockForwardPackageInfo });
    const res = mockRes();
    const next = jest.fn();

    await sellerApproveReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(autoProcessSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        returnId: mockReturn._id,
        user: expect.objectContaining({ sub: sellerUserId }),
        packageInfo: mockForwardPackageInfo,
      })
    );
  });

  // TEST 3: ReturnShipment creation uses correct customer/vendor addresses
  it('TEST 3: ReturnShipment creation takes customer address as pickup and vendor address as return destination', async () => {
    const mockVendor = createMockVendor();
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    const mockOrder = createMockOrder();
    const mockItem = createMockReturnItem();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);
    jest.spyOn(Order, 'findById').mockResolvedValue(mockOrder);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([mockItem]) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);

    let createdShipmentData = null;
    jest.spyOn(ReturnShipment, 'create').mockImplementation(async (d) => {
      createdShipmentData = d;
      return { ...d, save: jest.fn().mockResolvedValue(true), toObject() { return { ...this }; } };
    });

    await returnShipmentService.prepareReturnShipment({
      returnId,
      packageInfo: mockForwardPackageInfo,
      user: { sub: sellerUserId, role: 'VENDOR', vendorId },
    });

    expect(createdShipmentData).not.toBeNull();
    // Customer address must be pickup snapshot
    expect(createdShipmentData.pickupAddressSnapshot.name).toBe('Aditi Banerjee');
    expect(createdShipmentData.pickupAddressSnapshot.city).toBe('Kolkata');
    expect(createdShipmentData.pickupAddressSnapshot.pincode).toBe('700029');

    // Vendor address must be return destination snapshot
    expect(createdShipmentData.returnAddressSnapshot.contactPerson).toBe('Suresh Crafts');
    expect(createdShipmentData.returnAddressSnapshot.city).toBe('Bishnupur');
    expect(createdShipmentData.returnAddressSnapshot.pincode).toBe('722122');
  });

  // TEST 4: AWB failure: ReturnShipment preserved, no fake AWB, pickup not requested
  it('TEST 4: AWB failure preserves ReturnShipment with provider IDs, records awbError, and does NOT request pickup', async () => {
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    const mockShipmentDoc = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      returnId,
      status: 'READY_FOR_PICKUP',
      providerOrderId: 123456,
      providerShipmentId: 789012,
      providerAwb: null,
      awbError: null,
      save: jest.fn().mockResolvedValue(true),
      toObject() {
        return { ...this };
      },
    };
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(mockShipmentDoc);

    // Mock AWB assignment failure on provider prototype
    jest.spyOn(MockDeliveryProvider.prototype, 'assignReturnAwb').mockRejectedValue(new Error('Carrier service unavailable in pickup zone'));
    const pickupSpy = jest.spyOn(MockDeliveryProvider.prototype, 'requestReturnPickup');

    const result = await returnShipmentService.autoProcessReverseShipment({
      returnId,
      user: { sub: sellerUserId, role: 'VENDOR', vendorId },
      packageInfo: mockForwardPackageInfo,
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe('AWB_FAILED');
    expect(mockShipmentDoc.awbError).not.toBeNull();
    expect(mockShipmentDoc.awbError.message).toContain('Carrier service unavailable');
    expect(mockShipmentDoc.providerAwb).toBeNull();
    expect(pickupSpy).not.toHaveBeenCalled();
    expect(mockShipmentDoc.save).toHaveBeenCalled();
  });

  // TEST 5: AWB success: label generation can proceed
  it('TEST 5: AWB success assigns authentic AWB and allows label generation', async () => {
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    const mockShipmentDoc = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      returnId,
      status: 'READY_FOR_PICKUP',
      providerOrderId: 123456,
      providerShipmentId: 789012,
      providerAwb: null,
      save: jest.fn().mockResolvedValue(true),
      toObject() {
        return { ...this };
      },
    };
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(mockShipmentDoc);

    jest.spyOn(MockDeliveryProvider.prototype, 'assignReturnAwb').mockResolvedValue({
      awbCode: '987654321098',
      courierName: 'Delhivery Surface',
    });

    const labelSpy = jest.spyOn(MockDeliveryProvider.prototype, 'generateReturnLabel').mockResolvedValue({
      labelUrl: 'https://shiprocket.co/labels/rev-123.pdf',
    });
    jest.spyOn(MockDeliveryProvider.prototype, 'requestReturnPickup').mockResolvedValue({
      status: 'SCHEDULED',
      pickupDate: '2026-10-15',
    });

    const result = await returnShipmentService.autoProcessReverseShipment({
      returnId,
      user: { sub: sellerUserId, role: 'VENDOR', vendorId },
      packageInfo: mockForwardPackageInfo,
    });

    expect(result.success).toBe(true);
    expect(mockShipmentDoc.providerAwb).toBe('987654321098');
    expect(labelSpy).toHaveBeenCalled();
  });

  // TEST 6: label failure: authentic AWB preserved, pickup not falsely marked
  it('TEST 6: label failure preserves authentic AWB, records labelError, and does NOT request pickup', async () => {
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    const mockShipmentDoc = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      returnId,
      status: 'AWB_ASSIGNED',
      providerOrderId: 123456,
      providerShipmentId: 789012,
      providerAwb: '987654321098',
      labelUrl: null,
      labelError: null,
      save: jest.fn().mockResolvedValue(true),
      toObject() {
        return { ...this };
      },
    };
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(mockShipmentDoc);

    jest.spyOn(MockDeliveryProvider.prototype, 'generateReturnLabel').mockRejectedValue(new Error('Label generation service timeout'));
    const pickupSpy = jest.spyOn(MockDeliveryProvider.prototype, 'requestReturnPickup');

    const result = await returnShipmentService.autoProcessReverseShipment({
      returnId,
      user: { sub: sellerUserId, role: 'VENDOR', vendorId },
      packageInfo: mockForwardPackageInfo,
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe('LABEL_FAILED');
    expect(mockShipmentDoc.providerAwb).toBe('987654321098');
    expect(mockShipmentDoc.labelError).not.toBeNull();
    expect(mockShipmentDoc.labelError.message).toContain('Label generation service timeout');
    expect(pickupSpy).not.toHaveBeenCalled();
  });

  // TEST 7: pickup failure: authentic AWB preserved, label preserved, safe retry possible
  it('TEST 7: pickup failure preserves authentic AWB and label, sets pickupError, and permits safe retry', async () => {
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    const mockShipmentDoc = {
      _id: new mongoose.Types.ObjectId().toHexString(),
      returnId,
      status: 'LABEL_GENERATED',
      providerOrderId: 123456,
      providerShipmentId: 789012,
      providerAwb: '987654321098',
      labelUrl: 'https://shiprocket.co/labels/rev-123.pdf',
      pickupError: null,
      save: jest.fn().mockResolvedValue(true),
      toObject() {
        return { ...this };
      },
    };
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(mockShipmentDoc);

    jest.spyOn(MockDeliveryProvider.prototype, 'requestReturnPickup').mockRejectedValue(new Error('Pickup scheduling slots full for today'));

    const result = await returnShipmentService.autoProcessReverseShipment({
      returnId,
      user: { sub: sellerUserId, role: 'VENDOR', vendorId },
      packageInfo: mockForwardPackageInfo,
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe('PICKUP_FAILED');
    expect(mockShipmentDoc.providerAwb).toBe('987654321098');
    expect(mockShipmentDoc.labelUrl).toBe('https://shiprocket.co/labels/rev-123.pdf');
    expect(mockShipmentDoc.pickupError.message).toContain('Pickup scheduling slots full');

    // Retry should be possible and re-attempt pickup
    jest.spyOn(MockDeliveryProvider.prototype, 'requestReturnPickup').mockResolvedValue({
      status: 'SCHEDULED',
      pickupDate: '2026-10-16',
    });
    const retryResult = await returnShipmentService.autoProcessReverseShipment({
      returnId,
      user: { sub: sellerUserId, role: 'VENDOR', vendorId },
      packageInfo: mockForwardPackageInfo,
    });
    expect(retryResult.success).toBe(true);
  });

  // TEST 8: duplicate seller approval does not create duplicate ReturnShipment
  it('TEST 8: duplicate seller approval is idempotent and does not create duplicate ReturnShipment', async () => {
    const mockVendor = createMockVendor();
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockReturn);
    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const autoProcessSpy = jest.spyOn(returnShipmentService, 'autoProcessReverseShipment');

    const req = mockReq({ notes: 'Second approval call' });
    const res = mockRes();
    const next = jest.fn();

    await sellerApproveReturn(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].message).toContain('Return already approved');
    // Idempotent return approval must not re-trigger reverse workflow
    expect(autoProcessSpy).not.toHaveBeenCalled();
  });

  // TEST 9: seller UI does NOT show "Mark Return Received" immediately after APPROVED
  it('TEST 9: buildVendorReturnDto attaches reverseShipment so seller UI knows reverse carrier is in progress', async () => {
    const mockReturn = createMockReturn({ status: 'APPROVED' });
    const mockReverseShipment = {
      _id: 'rev-ship-456',
      returnId,
      shipmentNumber: 'REV-001',
      status: 'READY_FOR_PICKUP',
      carrier: 'Shiprocket / Delhivery',
      providerAwb: '987654321098',
      toObject() {
        return { ...this };
      },
    };

    jest.spyOn(ReturnItem, 'find').mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(mockReverseShipment);

    const dto = await buildVendorReturnDto(mockReturn);

    expect(dto.status).toBe('APPROVED');
    expect(dto.reverseShipment).toBeDefined();
    expect(dto.reverseShipment.status).toBe('READY_FOR_PICKUP');
    expect(dto.reverseShipment.providerAwb).toBe('987654321098');
    // Seller UI checks dto.reverseShipment && status !== 'DELIVERED' to guard "Mark Return Received"
    const canSellerMarkReceived = dto.status === 'APPROVED' && (!dto.reverseShipment || dto.reverseShipment.status === 'DELIVERED');
    expect(canSellerMarkReceived).toBe(false);
  });

  // TEST 10: reverse shipment DELIVERED causes: ReturnShipment → DELIVERED and Return → RETURN_RECEIVED
  it('TEST 10: reverse shipment DELIVERED triggers _handoffDeliveredReturn transitioning Return to RETURN_RECEIVED', async () => {
    const mockReturn = createMockReturn({ status: 'IN_TRANSIT' });
    jest.spyOn(Return, 'findById').mockResolvedValue(mockReturn);

    const mockShipment = {
      _id: 'rev-ship-789',
      returnId,
      shipmentNumber: 'REV-002',
      status: 'DELIVERED',
    };

    await returnShipmentService._handoffDeliveredReturn(mockShipment);

    expect(mockReturn.status).toBe('RETURN_RECEIVED');
    expect(mockReturn.receivedAt).toBeInstanceOf(Date);
    expect(mockReturn.save).toHaveBeenCalled();
  });

  // TEST 11: seller cannot manually bypass carrier delivery to RETURN_RECEIVED
  it('TEST 11: seller cannot manually bypass carrier delivery to mark return as received', async () => {
    const mockVendor = createMockVendor();
    const mockReturn = createMockReturn({ status: 'IN_TRANSIT' });
    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
    jest.spyOn(Return, 'findOne').mockResolvedValue(mockReturn);

    // Active carrier-managed ReturnShipment is IN_TRANSIT
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue({
      _id: 'rev-ship-active',
      returnId,
      shipmentNumber: 'REV-ACTIVE-01',
      status: 'IN_TRANSIT',
    });

    const req = mockReq({ notes: 'Trying to bypass carrier' });
    const res = mockRes();
    const next = jest.fn();

    await sellerMarkReturnReceived(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('CARRIER_DELIVERY_REQUIRED');
  });

  // TEST 12: Package information resolution hierarchy
  it('TEST 12: resolveAuthoritativePackageInfo prioritizes seller payload over forward shipment over product variant', async () => {
    const mockReturn = createMockReturn();

    // 1. Seller payload takes highest priority
    const explicitPkg = { weight: 1.5, length: 30, width: 25, height: 15, unit: 'kg', dimensionUnit: 'cm' };
    const r1 = await returnShipmentService.resolveAuthoritativePackageInfo({
      returnDoc: mockReturn,
      packageInfo: explicitPkg,
    });
    expect(r1.source).toBe('SELLER_PROVIDED');
    expect(r1.packageInfo.weight).toBe(1.5);

    // 2. Forward shipment takes second priority
    jest.spyOn(Shipment, 'findOne').mockResolvedValue({
      orderId,
      packageInfo: mockForwardPackageInfo,
    });
    const r2 = await returnShipmentService.resolveAuthoritativePackageInfo({
      returnDoc: mockReturn,
      packageInfo: null,
    });
    expect(r2.source).toBe('FORWARD_SHIPMENT');
    expect(r2.packageInfo.weight).toBe(mockForwardPackageInfo.weight);

    // 3. Variant takes third priority if forward shipment missing
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnItem, 'find').mockResolvedValue([
      { variantId, quantity: 2 },
    ]);
    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({
      weight: 0.4,
      dimensions: { length: 15, width: 12, height: 8 },
    });
    const r3 = await returnShipmentService.resolveAuthoritativePackageInfo({
      returnDoc: mockReturn,
      packageInfo: null,
    });
    expect(r3.source).toBe('PRODUCT_VARIANT');
    expect(r3.packageInfo.weight).toBe(0.8); // 0.4 * 2
    expect(r3.packageInfo.length).toBe(15);
  });
});
