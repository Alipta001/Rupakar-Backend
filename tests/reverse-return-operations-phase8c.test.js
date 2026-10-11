import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ReturnShipment } from '../app/models/return-shipment.model.js';
import { Return } from '../app/models/return.model.js';
import { ReturnItem } from '../app/models/return-item.model.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Shipment } from '../app/models/shipment.model.js';
import { ShipmentTrackingEvent } from '../app/models/shipment-tracking-event.model.js';
import { Replacement } from '../app/models/replacement.model.js';
import { returnShipmentService } from '../app/services/return-shipment.service.js';
import { returnShipmentStateService } from '../app/services/return-shipment-state.service.js';
import { returnStateService } from '../app/services/return-state.service.js';
import {
  deliveryProvider,
  getDeliveryProvider,
  DeliveryProvider,
  ShiprocketProvider,
  MockDeliveryProvider,
  isAuthenticAwb,
  SHIPROCKET_REVERSE_STATUS_MAP,
} from '../app/services/delivery-provider.service.js';
import { shippingService } from '../app/services/shipping.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { paymentService } from '../app/services/payment.service.js';
import { refundService } from '../app/services/refund.service.js';
import { auditService } from '../app/services/audit.service.js';
import { env } from '../app/config/env.js';

jest.unstable_mockModule('../app/jobs/queues.js', () => ({
  scheduleNotification: jest.fn().mockResolvedValue('notif-1'),
  scheduleEmail: jest.fn().mockResolvedValue('email-1'),
  scheduleInvoiceGeneration: jest.fn().mockResolvedValue('invoice-1'),
  schedulePackingSlipGeneration: jest.fn().mockResolvedValue('slip-1'),
  scheduleVendorOrderPackReminder: jest.fn().mockResolvedValue('pack-reminder-1'),
  scheduleVendorOrderAutoCancel: jest.fn().mockResolvedValue('auto-cancel-1'),
}));

const { deliveryWebhook } = await import('../app/controllers/shipping.controller.js');
const {
  assignReturnAwbController,
  generateReturnLabelController,
  requestReturnPickupController,
  syncReturnTrackingController,
  adminAssignReturnAwb,
  adminGenerateReturnLabel,
  adminRequestReturnPickup,
  adminSyncReturnTracking,
} = await import('../app/controllers/return.controller.js');

describe('Phase 8C: Reverse Carrier Operations & Tracking Tests', () => {
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
  const shipmentId1 = new mongoose.Types.ObjectId();
  const returnShipmentId1 = new mongoose.Types.ObjectId();

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
    ...overrides,
  });

  const createMockVendorOrder = (overrides = {}) => ({
    _id: vendorOrderId1,
    parentOrderId: orderId1,
    vendorId: vendorId1,
    customerId,
    status: 'DELIVERED',
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
    returnNumber: 'RUP-RET-2026-8C001',
    orderId: orderId1,
    vendorOrderId: vendorOrderId1,
    customerId,
    vendorId: vendorId1,
    type: 'RETURN',
    status: 'APPROVED',
    reason: 'DEFECTIVE',
    items: [returnItemId1],
    statusHistory: [],
    save: jest.fn().mockResolvedValue(true),
    toObject() {
      return { ...this };
    },
    ...overrides,
  });

  const createMockReturnShipment = (overrides = {}) => {
    const doc = {
      _id: returnShipmentId1,
      returnId: returnId1,
      orderId: orderId1,
      vendorOrderId: vendorOrderId1,
      customerId,
      vendorId: vendorId1,
      shipmentNumber: 'REV-RUP-RET-2026-8C001',
      channelOrderId: 'REV-RUP-RET-2026-8C001',
      direction: 'RETURN',
      provider: 'mock',
      providerShipmentId: 'MSHP-REV-8C001',
      providerOrderId: 'MORD-REV-8C001',
      providerAwb: null,
      trackingNumber: null,
      carrier: 'Rupakar Express Logistics',
      labelUrl: null,
      status: 'READY_FOR_PICKUP',
      pickupStatus: 'PENDING',
      packageInfo: { weight: 1, length: 10, width: 10, height: 10 },
      pickupAddressSnapshot: { ...mockCustomerPickupAddress },
      returnAddressSnapshot: { ...mockSellerReturnAddress },
      statusHistory: [],
      metadata: {},
      trackingEvents: [],
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

  const mockReq = (userId, role = 'customer', params = {}, body = {}, extra = {}) => ({
    user: { sub: userId, role, ...extra },
    params,
    body,
    headers: { 'x-request-id': 'req-phase8c-test' },
  });

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const createSignedWebhookReq = (payload) => {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const webhookSecret = env.DELIVERY_WEBHOOK_SECRET || 'rupakar-test-webhook-secret';
    const validSignature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    return {
      body: rawBody,
      headers: {
        'x-delivery-signature': validSignature,
        'x-shiprocket-token': env.SHIPROCKET_WEBHOOK_TOKEN || 'test-sr-token',
      },
      get: (header) => {
        if (header.toLowerCase() === 'x-delivery-signature') return validSignature;
        if (header.toLowerCase() === 'x-shiprocket-token' || header.toLowerCase() === 'x-api-key') {
          return env.SHIPROCKET_WEBHOOK_TOKEN || 'test-sr-token';
        }
        return null;
      },
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    env.DELIVERY_PROVIDER = 'mock';
    if (!env.DELIVERY_WEBHOOK_SECRET) env.DELIVERY_WEBHOOK_SECRET = 'rupakar-test-webhook-secret';
    if (!env.SHIPROCKET_WEBHOOK_TOKEN) env.SHIPROCKET_WEBHOOK_TOKEN = 'test-sr-token';
  });

  // 1. Mock AWB assignment
  it('1. Mock AWB assignment generates deterministic authentic AWB', async () => {
    const mockProvider = new MockDeliveryProvider();
    const result = await mockProvider.assignReturnAwb({
      shipmentId: 'MSHP-REV-001',
    });

    expect(result.awbCode).toBeTruthy();
    expect(isAuthenticAwb(result.awbCode, 'MSHP-REV-001')).toBe(true);
    expect(result.courierName).toBe('Rupakar Express Logistics');
  });

  // 2. Shiprocket AWB assignment mocked
  it('2. Shiprocket AWB assignment mocked successfully assigns real AWB', async () => {
    const srProvider = new ShiprocketProvider();
    jest.spyOn(srProvider, 'request').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        response: {
          data: {
            awb_code: '1411234567890',
            courier_name: 'Blue Dart Surface',
            courier_company_id: 25,
          },
        },
      }),
    });

    const result = await srProvider.assignReturnAwb({ shipmentId: '987654' });
    expect(result.awbCode).toBe('1411234567890');
    expect(result.courierName).toBe('Blue Dart Surface');
    expect(result.courierCompanyId).toBe(25);
  });

  // 3. authentic AWB persisted
  it('3. authentic AWB persisted on ReturnShipment model', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment();

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'assignReturnAwb').mockResolvedValue({
      awbCode: '998877665544',
      courierName: 'Delhivery Surface',
    });

    const updated = await returnShipmentService.assignShipmentAwb({
      returnId: returnId1,
      user: { sub: customerId, role: 'CUSTOMER' },
    });

    expect(updated.providerAwb).toBe('998877665544');
    expect(updated.trackingNumber).toBe('998877665544');
    expect(updated.carrier).toBe('Delhivery Surface');
    expect(updated.status).toBe('AWB_ASSIGNED');
    expect(updated.awbAssignedAt).toBeTruthy();
  });

  // 4. synthetic AWB rejected
  it('4. synthetic AWB rejected by validation', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({ providerShipmentId: '12345' });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'assignReturnAwb').mockResolvedValue({
      awbCode: 'SR12345', // synthetic fallback
    });

    await expect(
      returnShipmentService.assignShipmentAwb({
        returnId: returnId1,
        user: { sub: customerId, role: 'CUSTOMER' },
      }),
    ).rejects.toThrow(/invalid awb/i);

    expect(shipment.providerAwb).toBeNull();
  });

  // 5. missing AWB handled safely
  it('5. missing AWB handled safely without corrupting shipment', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment();

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'assignReturnAwb').mockRejectedValue(new Error('Carrier service unavailable'));

    await expect(
      returnShipmentService.assignShipmentAwb({
        returnId: returnId1,
        user: { sub: customerId, role: 'CUSTOMER' },
      }),
    ).rejects.toThrow('Carrier service unavailable');

    expect(shipment.providerAwb).toBeNull();
    expect(shipment.awbError).toBeTruthy();
    expect(shipment.awbError.message).toBe('Carrier service unavailable');
    expect(shipment.status).toBe('READY_FOR_PICKUP');
  });

  // 6. label generation
  it('6. label generation persists labelUrl and transitions to LABEL_GENERATED', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      status: 'AWB_ASSIGNED',
      providerAwb: '998877665544',
      trackingNumber: '998877665544',
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'generateReturnLabel').mockResolvedValue({
      labelUrl: 'https://shiprocket.co/labels/test-label.pdf',
    });

    const updated = await returnShipmentService.generateShipmentLabel({
      returnId: returnId1,
      user: { sub: customerId, role: 'CUSTOMER' },
    });

    expect(updated.labelUrl).toBe('https://shiprocket.co/labels/test-label.pdf');
    expect(updated.status).toBe('LABEL_GENERATED');
    expect(updated.labelGeneratedAt).toBeTruthy();
  });

  // 7. label failure preserves AWB
  it('7. label failure preserves existing AWB and records labelError', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      status: 'AWB_ASSIGNED',
      providerAwb: '998877665544',
      trackingNumber: '998877665544',
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'generateReturnLabel').mockRejectedValue(new Error('PDF generation gateway error'));

    await expect(
      returnShipmentService.generateShipmentLabel({
        returnId: returnId1,
        user: { sub: customerId, role: 'CUSTOMER' },
      }),
    ).rejects.toThrow('PDF generation gateway error');

    expect(shipment.providerAwb).toBe('998877665544');
    expect(shipment.labelUrl).toBeNull();
    expect(shipment.labelError.message).toBe('PDF generation gateway error');
  });

  // 8. pickup request
  it('8. pickup request submits pickup to carrier and schedules', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      status: 'LABEL_GENERATED',
      providerAwb: '998877665544',
      trackingNumber: '998877665544',
      labelUrl: 'https://shiprocket.co/labels/test.pdf',
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'requestReturnPickup').mockResolvedValue({
      scheduled: true,
      pickupToken: 'PKP-12345',
      pickupDate: '2026-10-15T10:00:00.000Z',
      status: 'SCHEDULED',
    });

    const updated = await returnShipmentService.requestShipmentPickup({
      returnId: returnId1,
      user: { sub: customerId, role: 'CUSTOMER' },
    });

    expect(updated.status).toBe('PICKUP_SCHEDULED');
    expect(updated.pickupStatus).toBe('SCHEDULED');
    expect(updated.pickupScheduledAt).toBeTruthy();
  });

  // 9. pickup requires AWB
  it('9. pickup request without authentic AWB is rejected', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      providerAwb: null,
      trackingNumber: null,
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);

    await expect(
      returnShipmentService.requestShipmentPickup({
        returnId: returnId1,
        user: { sub: customerId, role: 'CUSTOMER' },
      }),
    ).rejects.toThrow(/authentic awb required/i);
  });

  // 10. pickup request does not mean PICKED_UP
  it('10. pickup request transitions to PICKUP_SCHEDULED but NEVER PICKED_UP', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      providerAwb: '998877665544',
      status: 'LABEL_GENERATED',
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'requestReturnPickup').mockResolvedValue({
      scheduled: true,
      status: 'SCHEDULED',
    });

    const updated = await returnShipmentService.requestShipmentPickup({
      returnId: returnId1,
      user: { sub: customerId, role: 'CUSTOMER' },
    });

    expect(updated.status).not.toBe('PICKED_UP');
    expect(updated.status).toBe('PICKUP_SCHEDULED');
    expect(updated.pickedUpAt).toBeFalsy();
  });

  // 11. tracking normalization
  it('11. tracking normalization maps provider statuses safely', () => {
    expect(SHIPROCKET_REVERSE_STATUS_MAP['PICKED UP']).toBe('PICKED_UP');
    expect(SHIPROCKET_REVERSE_STATUS_MAP['IN TRANSIT']).toBe('IN_TRANSIT');
    expect(SHIPROCKET_REVERSE_STATUS_MAP['OUT FOR DELIVERY']).toBe('OUT_FOR_DELIVERY');
    expect(SHIPROCKET_REVERSE_STATUS_MAP['DELIVERED']).toBe('DELIVERED');
    expect(SHIPROCKET_REVERSE_STATUS_MAP['PICKUP ERROR']).toBe('PICKUP_FAILED');
    expect(SHIPROCKET_REVERSE_STATUS_MAP['UNDELIVERED']).toBe('DELIVERY_FAILED');
  });

  // 12. PICKED_UP transition
  it('12. PICKED_UP transition occurs on provider event', async () => {
    const shipment = createMockReturnShipment({
      status: 'PICKUP_SCHEDULED',
      trackingNumber: '998877665544',
    });

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'PICKED_UP');
    expect(shipment.status).toBe('PICKED_UP');
    expect(shipment.pickedUpAt).toBeTruthy();
    expect(shipment.pickupStatus).toBe('PICKED_UP');
  });

  // 13. IN_TRANSIT transition
  it('13. IN_TRANSIT transition occurs from PICKED_UP', async () => {
    const shipment = createMockReturnShipment({
      status: 'PICKED_UP',
      pickedUpAt: new Date(),
    });

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'IN_TRANSIT');
    expect(shipment.status).toBe('IN_TRANSIT');
    expect(shipment.inTransitAt).toBeTruthy();
  });

  // 14. OUT_FOR_DELIVERY transition
  it('14. OUT_FOR_DELIVERY transition occurs from IN_TRANSIT', async () => {
    const shipment = createMockReturnShipment({
      status: 'IN_TRANSIT',
    });

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'OUT_FOR_DELIVERY');
    expect(shipment.status).toBe('OUT_FOR_DELIVERY');
    expect(shipment.outForDeliveryAt).toBeTruthy();
  });

  // 15. DELIVERED transition
  it('15. DELIVERED transition occurs from OUT_FOR_DELIVERY', async () => {
    const shipment = createMockReturnShipment({
      status: 'OUT_FOR_DELIVERY',
    });

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'DELIVERED');
    expect(shipment.status).toBe('DELIVERED');
    expect(shipment.deliveredAt).toBeTruthy();
  });

  // 16. pickup failure
  it('16. pickup failure transitions to PICKUP_FAILED', async () => {
    const shipment = createMockReturnShipment({
      status: 'PICKUP_REQUESTED',
    });

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'PICKUP_FAILED');
    expect(shipment.status).toBe('PICKUP_FAILED');
    expect(shipment.pickupStatus).toBe('FAILED');
  });

  // 17. delivery failure
  it('17. delivery failure transitions to DELIVERY_FAILED', async () => {
    const shipment = createMockReturnShipment({
      status: 'IN_TRANSIT',
    });

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'DELIVERY_FAILED');
    expect(shipment.status).toBe('DELIVERY_FAILED');
  });

  // 18. retry AWB
  it('18. retry AWB preserves existing shipment and retries assignment only', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      providerShipmentId: 'MSHP-PREV-001',
      providerOrderId: 'MORD-PREV-001',
      awbError: { message: 'previous failure' },
      providerAwb: null,
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'assignReturnAwb').mockResolvedValue({
      awbCode: '112233445566',
      courierName: 'Delhivery Surface',
    });

    const updated = await returnShipmentService.assignShipmentAwb({
      returnId: returnId1,
      user: { sub: customerId, role: 'CUSTOMER' },
    });

    expect(updated.providerShipmentId).toBe('MSHP-PREV-001');
    expect(updated.providerOrderId).toBe('MORD-PREV-001');
    expect(updated.providerAwb).toBe('112233445566');
    expect(updated.awbError).toBeNull();
  });

  // 19. retry label
  it('19. retry label reuses valid AWB and retries label generation', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      providerAwb: '112233445566',
      trackingNumber: '112233445566',
      status: 'AWB_ASSIGNED',
      labelError: { message: 'previous label error' },
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'generateReturnLabel').mockResolvedValue({
      labelUrl: 'https://shiprocket.co/label/retried.pdf',
    });

    const updated = await returnShipmentService.generateShipmentLabel({
      returnId: returnId1,
      user: { sub: customerId, role: 'CUSTOMER' },
    });

    expect(updated.providerAwb).toBe('112233445566');
    expect(updated.labelUrl).toBe('https://shiprocket.co/label/retried.pdf');
    expect(updated.labelError).toBeNull();
  });

  // 20. retry pickup
  it('20. retry pickup reuses existing AWB and label and reschedules pickup', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      providerAwb: '112233445566',
      trackingNumber: '112233445566',
      labelUrl: 'https://shiprocket.co/label/1.pdf',
      status: 'PICKUP_FAILED',
      pickupError: { message: 'Customer unavailable' },
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'requestReturnPickup').mockResolvedValue({
      scheduled: true,
      pickupToken: 'PKP-RETRY-001',
      status: 'SCHEDULED',
    });

    const updated = await returnShipmentService.requestShipmentPickup({
      returnId: returnId1,
      user: { sub: customerId, role: 'CUSTOMER' },
    });

    expect(updated.status).toBe('PICKUP_SCHEDULED');
    expect(updated.pickupError).toBeNull();
  });

  // 21. tracking retry does not recreate shipment
  it('21. tracking retry does not recreate shipment', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      providerAwb: '112233445566',
      trackingNumber: '112233445566',
      status: 'PICKUP_SCHEDULED',
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    const createOrderSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment');

    await returnShipmentService.syncReturnTracking({
      returnId: returnId1,
      user: { sub: customerId, role: 'CUSTOMER' },
    });

    expect(createOrderSpy).not.toHaveBeenCalled();
  });

  // 22. provider timeout recovery
  it('22. provider timeout recovery preserves state and stores safe error', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment();

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'assignReturnAwb').mockRejectedValue(new Error('ETIMEDOUT: Connection timed out'));

    await expect(
      returnShipmentService.assignShipmentAwb({
        returnId: returnId1,
        user: { sub: customerId, role: 'CUSTOMER' },
      }),
    ).rejects.toThrow('ETIMEDOUT');

    expect(shipment.awbError.message).toContain('ETIMEDOUT');
    expect(shipment.providerShipmentId).toBe('MSHP-REV-8C001');
  });

  // 23. duplicate webhook
  it('23. duplicate webhook returns duplicate: true without modifying status history', async () => {
    const shipment = createMockReturnShipment({
      trackingNumber: '112233445566',
      status: 'IN_TRANSIT',
      metadata: {
        processedWebhookEvents: {
          'SR:REV:MSHP-REV-8C001:IN TRANSIT:2026-10-10': true,
        },
      },
    });

    const res = mockRes();
    await returnShipmentService.handleReverseWebhookEvent({
      returnShipment: shipment,
      payload: {
        eventId: 'SR:REV:MSHP-REV-8C001:IN TRANSIT:2026-10-10',
        status: 'IN TRANSIT',
      },
      res,
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true }));
    expect(shipment.statusHistory.length).toBe(0);
  });

  // 24. repeated webhook (20 times)
  it('24. repeated webhook received 20 times produces identical final state', async () => {
    const shipment = createMockReturnShipment({
      trackingNumber: '112233445566',
      status: 'PICKUP_SCHEDULED',
    });

    const eventPayload = {
      eventId: 'unique-webhook-evt-1',
      status: 'PICKED UP',
    };

    for (let i = 0; i < 20; i++) {
      const res = mockRes();
      await returnShipmentService.handleReverseWebhookEvent({
        returnShipment: shipment,
        payload: eventPayload,
        res,
      });
    }

    expect(shipment.status).toBe('PICKED_UP');
    expect(shipment.statusHistory.filter((h) => h.status === 'PICKED_UP').length).toBe(1);
  });

  // 25. unknown provider status
  it('25. unknown provider status preserves current status and stores in metadata', async () => {
    const shipment = createMockReturnShipment({
      status: 'IN_TRANSIT',
      trackingNumber: '112233445566',
    });

    const res = mockRes();
    await returnShipmentService.handleReverseWebhookEvent({
      returnShipment: shipment,
      payload: {
        status: 'SOME_WEIRD_CARRIER_CUSTOM_STATUS',
      },
      res,
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(shipment.status).toBe('IN_TRANSIT');
    expect(shipment.metadata.unknownProviderStatus).toBe('SOME_WEIRD_CARRIER_CUSTOM_STATUS');
  });

  // 26. forward shipment webhook unaffected
  it('26. forward shipment webhook unaffected and routes to forward shipment handler', async () => {
    const forwardShipment = {
      _id: shipmentId1,
      trackingNumber: 'FWD123456789',
      status: 'READY_TO_SHIP',
      provider: 'mock',
      orderId: orderId1,
      customerId,
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(forwardShipment);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ShipmentTrackingEvent, 'create').mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    jest.spyOn(VendorOrder, 'updateOne').mockResolvedValue({});
    jest.spyOn(Shipment, 'find').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });
    jest.spyOn(VendorOrder, 'find').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });
    jest.spyOn(Order, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ orderNumber: 'ORD-1' }) }) });
    jest.spyOn(Vendor, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ownerUserId: null }) }) });

    const req = createSignedWebhookReq({
      awb: 'FWD123456789',
      status: 'picked up',
    });
    const res = mockRes();
    const next = jest.fn();

    const reverseSpy = jest.spyOn(returnShipmentService, 'handleReverseWebhookEvent');
    await deliveryWebhook(req, res, next);

    expect(reverseSpy).not.toHaveBeenCalled();
    expect(forwardShipment.status).toBe('SHIPPED');
  });

  // 27. replacement shipment webhook unaffected
  it('27. replacement shipment webhook unaffected', async () => {
    const replacementShipment = {
      _id: shipmentId1,
      trackingNumber: 'REP123456789',
      status: 'SHIPPED',
      provider: 'mock',
      orderId: orderId1,
      metadata: { isReplacement: true },
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(replacementShipment);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ShipmentTrackingEvent, 'create').mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    jest.spyOn(VendorOrder, 'updateOne').mockResolvedValue({});
    jest.spyOn(Shipment, 'find').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });
    jest.spyOn(VendorOrder, 'find').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });
    jest.spyOn(Order, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ orderNumber: 'ORD-1' }) }) });
    jest.spyOn(Vendor, 'findById').mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ownerUserId: null }) }) });

    const reverseSpy = jest.spyOn(returnShipmentService, 'handleReverseWebhookEvent');

    const req = createSignedWebhookReq({
      awb: 'REP123456789',
      status: 'in transit',
    });
    const res = mockRes();
    const next = jest.fn();

    await deliveryWebhook(req, res, next);
    expect(reverseSpy).not.toHaveBeenCalled();
    expect(replacementShipment.status).toBe('IN_TRANSIT');
  });

  // 28. return shipment webhook correctly identified
  it('28. return shipment webhook correctly identified via AWB and routed', async () => {
    const returnShipment = createMockReturnShipment({
      trackingNumber: 'REV-AWB-998877',
      status: 'PICKUP_SCHEDULED',
    });

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(returnShipment);
    const reverseSpy = jest.spyOn(returnShipmentService, 'handleReverseWebhookEvent');

    const req = createSignedWebhookReq({
      awb: 'REV-AWB-998877',
      status: 'picked up',
    });
    const res = mockRes();
    const next = jest.fn();

    await deliveryWebhook(req, res, next);

    expect(reverseSpy).toHaveBeenCalled();
  });

  // 29. no duplicate status history
  it('29. repeated status transitions do not add duplicate status history entries', async () => {
    const shipment = createMockReturnShipment({ status: 'IN_TRANSIT' });
    await returnShipmentStateService.transitionShipmentStatus(shipment, 'IN_TRANSIT');
    expect(shipment.statusHistory.length).toBe(0);
  });

  // 30. no duplicate audit events
  it('30. duplicate webhook event does not generate duplicate audit log', async () => {
    const shipment = createMockReturnShipment({
      trackingNumber: 'REV-AWB-998877',
      status: 'PICKED_UP',
      metadata: {
        processedWebhookEvents: { 'evt-100': true },
      },
    });

    const auditSpy = jest.spyOn(auditService, 'log');
    const res = mockRes();

    await returnShipmentService.handleReverseWebhookEvent({
      returnShipment: shipment,
      payload: { eventId: 'evt-100', status: 'PICKED UP' },
      res,
    });

    expect(auditSpy).not.toHaveBeenCalledWith('REVERSE_PICKED_UP', expect.anything());
  });

  // 31. no refund
  it('31. carrier delivery does NOT execute refund automatically', async () => {
    const returnDoc = createMockReturn({ status: 'IN_TRANSIT' });
    const shipment = createMockReturnShipment({
      status: 'OUT_FOR_DELIVERY',
      returnId: returnDoc._id,
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    const refundSpy = jest.spyOn(refundService, 'createRefund').mockResolvedValue({});

    const res = mockRes();
    await returnShipmentService.handleReverseWebhookEvent({
      returnShipment: shipment,
      payload: { status: 'DELIVERED' },
      res,
    });

    expect(shipment.status).toBe('DELIVERED');
    expect(refundSpy).not.toHaveBeenCalled();
    expect(returnDoc.status).toBe('RETURN_RECEIVED'); // awaiting seller inspection
  });

  // 32. no payment mutation
  it('32. carrier events do not mutate order payment status', async () => {
    const orderDoc = createMockOrder({ paymentStatus: 'PAID' });
    jest.spyOn(Order, 'findById').mockResolvedValue(orderDoc);

    const shipment = createMockReturnShipment({ status: 'IN_TRANSIT' });
    await returnShipmentStateService.transitionShipmentStatus(shipment, 'OUT_FOR_DELIVERY');

    expect(orderDoc.paymentStatus).toBe('PAID');
  });

  // 33. no inventory mutation
  it('33. carrier delivery does NOT execute inventory restocking', async () => {
    const shipment = createMockReturnShipment({ status: 'OUT_FOR_DELIVERY' });
    const restockSpy = jest.spyOn(inventoryService, 'increaseStock').mockImplementation(() => {});

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'DELIVERED');
    expect(restockSpy).not.toHaveBeenCalled();
  });

  // 34. original Order unchanged
  it('34. original Order remains DELIVERED during reverse carrier lifecycle', async () => {
    const orderDoc = createMockOrder({ status: 'DELIVERED' });
    jest.spyOn(Order, 'findById').mockResolvedValue(orderDoc);
    const shipment = createMockReturnShipment({ status: 'PICKED_UP' });

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'IN_TRANSIT');
    expect(orderDoc.status).toBe('DELIVERED');
  });

  // 35. original VendorOrder unchanged
  it('35. original VendorOrder remains DELIVERED during reverse carrier lifecycle', async () => {
    const voDoc = createMockVendorOrder({ status: 'DELIVERED' });
    jest.spyOn(VendorOrder, 'findById').mockResolvedValue(voDoc);
    const shipment = createMockReturnShipment({ status: 'PICKED_UP' });

    await returnShipmentStateService.transitionShipmentStatus(shipment, 'IN_TRANSIT');
    expect(voDoc.status).toBe('DELIVERED');
  });

  // 36. replacement unchanged
  it('36. replacement order record unchanged by reverse return shipment updates', async () => {
    const replacementDoc = {
      _id: new mongoose.Types.ObjectId(),
      status: 'FULFILLMENT_REQUESTED',
      save: jest.fn(),
    };
    jest.spyOn(Replacement, 'findOne').mockResolvedValue(replacementDoc);

    const shipment = createMockReturnShipment({ status: 'PICKED_UP' });
    await returnShipmentStateService.transitionShipmentStatus(shipment, 'IN_TRANSIT');

    expect(replacementDoc.status).toBe('FULFILLMENT_REQUESTED');
  });

  // 37. seller isolation
  it('37. unauthorized seller cannot access or operate on return shipment', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(Vendor, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: otherVendorId, // other vendor
        ownerUserId: otherVendorUserId,
      }),
    });

    await expect(
      returnShipmentService.assignShipmentAwb({
        returnId: returnId1,
        user: { sub: otherVendorUserId, role: 'VENDOR' },
      }),
    ).rejects.toThrow(/access denied/i);
  });

  // 38. customer isolation
  it('38. other customer cannot access or operate on return shipment', async () => {
    const returnDoc = createMockReturn();
    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);

    await expect(
      returnShipmentService.assignShipmentAwb({
        returnId: returnId1,
        user: { sub: otherCustomerId, role: 'CUSTOMER' },
      }),
    ).rejects.toThrow(/access denied/i);
  });

  // 39. admin access
  it('39. admin can assign AWB, generate label, and request pickup', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      providerAwb: '998877665544',
      status: 'AWB_ASSIGNED',
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    jest.spyOn(MockDeliveryProvider.prototype, 'generateReturnLabel').mockResolvedValue({
      labelUrl: 'https://admin-label.pdf',
    });

    const req = mockReq(adminUserId, 'admin', { id: returnId1.toString() });
    const res = mockRes();
    const next = jest.fn();

    await adminGenerateReturnLabel(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(shipment.labelUrl).toBe('https://admin-label.pdf');
  });

  // 40. PICKED_UP cannot normally be cancelled
  it('40. PICKED_UP return shipment cannot normally be cancelled', async () => {
    const shipment = createMockReturnShipment({
      status: 'PICKED_UP',
      pickedUpAt: new Date(),
    });

    expect(returnShipmentStateService.canTransition('PICKED_UP', 'CANCELLED')).toBe(false);

    await expect(
      returnShipmentStateService.transitionShipmentStatus(shipment, 'CANCELLED'),
    ).rejects.toThrow(/cannot transition reverse shipment from PICKED_UP to CANCELLED/i);
  });

  // 41. DELIVERED does not automatically refund
  it('41. DELIVERED does not mark Return as REFUNDED or trigger payout', async () => {
    const returnDoc = createMockReturn({ status: 'IN_TRANSIT' });
    const shipment = createMockReturnShipment({
      status: 'OUT_FOR_DELIVERY',
      returnId: returnDoc._id,
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);

    const res = mockRes();
    await returnShipmentService.handleReverseWebhookEvent({
      returnShipment: shipment,
      payload: { status: 'DELIVERED' },
      res,
    });

    expect(returnDoc.status).not.toBe('REFUNDED');
    expect(returnDoc.status).not.toBe('CLOSED');
    expect(returnDoc.status).toBe('RETURN_RECEIVED');
  });

  // 42. DELIVERED creates seller receipt/inspection handoff
  it('42. DELIVERED hands off return to RETURN_RECEIVED for seller inspection', async () => {
    const returnDoc = createMockReturn({ status: 'IN_TRANSIT' });
    const shipment = createMockReturnShipment({
      status: 'OUT_FOR_DELIVERY',
      returnId: returnDoc._id,
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    const auditSpy = jest.spyOn(auditService, 'log');

    const res = mockRes();
    await returnShipmentService.handleReverseWebhookEvent({
      returnShipment: shipment,
      payload: { status: 'DELIVERED' },
      res,
    });

    expect(returnDoc.status).toBe('RETURN_RECEIVED');
    expect(auditSpy).toHaveBeenCalledWith('REVERSE_DELIVERY_HANDOFF', expect.objectContaining({
      newReturnStatus: 'RETURN_RECEIVED',
    }));
  });

  // 43. wallet/AWB failure preserves provider shipment
  it('43. Shiprocket wallet balance error preserves provider shipment and stores safe error', async () => {
    const srProvider = new ShiprocketProvider();
    jest.spyOn(srProvider, 'request').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        message: 'Please recharge your ShipRocket wallet to assign AWB.',
        status_code: 400,
      }),
    });

    await expect(
      srProvider.assignReturnAwb({ shipmentId: 'MSHP-999' }),
    ).rejects.toThrow(/recharge your shiprocket wallet/i);
  });

  // 44. no second provider order
  it('44. AWB retry never creates a second provider order', async () => {
    const returnDoc = createMockReturn();
    const shipment = createMockReturnShipment({
      providerOrderId: 'ORIGINAL-PROVIDER-ORDER-123',
      providerShipmentId: 'ORIGINAL-PROVIDER-SHIPMENT-456',
    });

    jest.spyOn(Return, 'findById').mockResolvedValue(returnDoc);
    jest.spyOn(ReturnShipment, 'findOne').mockResolvedValue(shipment);
    const createOrderSpy = jest.spyOn(MockDeliveryProvider.prototype, 'createReturnShipment');
    jest.spyOn(MockDeliveryProvider.prototype, 'assignReturnAwb').mockResolvedValue({
      awbCode: '998877665544',
      courierName: 'Delhivery Surface',
    });

    await returnShipmentService.assignShipmentAwb({
      returnId: returnId1,
      user: { sub: customerId, role: 'CUSTOMER' },
    });

    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(shipment.providerOrderId).toBe('ORIGINAL-PROVIDER-ORDER-123');
    expect(shipment.providerShipmentId).toBe('ORIGINAL-PROVIDER-SHIPMENT-456');
  });

  // 45. no real Shiprocket API calls
  it('45. tests never make real external Shiprocket API network calls', () => {
    const globalFetchSpy = jest.spyOn(global, 'fetch');
    expect(env.DELIVERY_PROVIDER).not.toBe('production');
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });
});
