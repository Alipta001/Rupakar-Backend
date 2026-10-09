import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import crypto from 'node:crypto';
import {
  ShiprocketProvider,
  SHIPROCKET_STATUS_MAP,
  selectDeterministicCourier,
  getDeliveryProvider,
  deliveryProvider,
  isAuthenticAwb,
} from '../app/services/delivery-provider.service.js';
import { ShippingService, shippingService } from '../app/services/shipping.service.js';
import { Shipment } from '../app/models/shipment.model.js';
import { Order } from '../app/models/order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { InventoryReservation } from '../app/models/inventory-reservation.model.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { orderService } from '../app/services/order.service.js';
import { settlementService } from '../app/services/settlement.service.js';
import { shipmentStateService } from '../app/services/shipment-state.service.js';
import { ShipmentTrackingEvent } from '../app/models/shipment-tracking-event.model.js';
import { User } from '../app/models/user.model.js';
import { vendorService } from '../app/services/vendor.service.js';
import { env } from '../app/config/env.js';

jest.unstable_mockModule('../app/jobs/queues.js', () => ({
  scheduleNotification: jest.fn().mockResolvedValue('notif-1'),
  scheduleEmail: jest.fn().mockResolvedValue('email-1'),
  scheduleInvoiceGeneration: jest.fn().mockResolvedValue('invoice-1'),
  schedulePackingSlipGeneration: jest.fn().mockResolvedValue('slip-1'),
  scheduleVendorOrderPackReminder: jest.fn().mockResolvedValue('pack-reminder-1'),
  scheduleVendorOrderAutoCancel: jest.fn().mockResolvedValue('auto-cancel-1'),
}));

const {
  readyVendorOrder,
  retryVendorShipment,
  retryAdminFulfillment,
  assignAdminAwb,
  generateAdminLabel,
  deliveryWebhook,
  downloadVendorShippingLabel,
} = await import('../app/controllers/shipping.controller.js');

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.redirect = jest.fn().mockReturnValue(res);
  return res;
};

describe('Shiprocket Automatic Fulfillment Workflow (Section 18)', () => {
  const testEmail = 'api-user@rupakar.in';
  const testPassword = 'secure_password_123';
  const testApiUrl = 'https://apiv2.shiprocket.in';

  let provider;
  let originalFetch;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);
    jest.spyOn(settlementService, 'handleVendorOrderDelivered').mockResolvedValue(true);
    jest.spyOn(inventoryService, 'decreaseStock').mockResolvedValue({});
    jest.spyOn(inventoryService, 'increaseStock').mockResolvedValue({});
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
    jest.spyOn(ShipmentTrackingEvent, 'create').mockResolvedValue({});

    provider = new ShiprocketProvider({
      email: testEmail,
      password: testPassword,
      apiUrl: testApiUrl,
      mode: 'mock',
    });

    originalFetch = global.fetch;
  });

  const setupMockVendorOrder = ({
    adminStatus = 'APPROVED',
    registrationStatus = 'REGISTERED',
    pickupLocationName = 'Vendor_Wh_1',
    isCod = false,
  } = {}) => {
    const vendorUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();
    const vendorOrderId = new mongoose.Types.ObjectId();
    const variantId = new mongoose.Types.ObjectId();

    const vendorDoc = {
      _id: vendorId,
      ownerUserId: vendorUserId,
      storeName: 'Handloom Crafts',
      status: 'APPROVED',
      pickupAddress: {
        nickname: pickupLocationName,
        pickupLocationName,
        registrationStatus,
        adminStatus,
        contactPerson: 'Vendor Master',
        phone: '9876543210',
        addressLine1: 'Craft Hub, Lane 4',
        city: 'Kolkata',
        state: 'WB',
        pincode: '700001',
      },
    };

    const vendorOrderDoc = {
      _id: vendorOrderId,
      vendorId,
      parentOrderId,
      status: 'PACKED',
      inventoryDecremented: false,
      totalAmount: 1499,
      items: [
        {
          variantId,
          title: 'Handmade Silk Scarf',
          quantity: 2,
          price: 700,
          sku: 'SCARF-SILK-01',
        },
      ],
      packageDetails: {
        weight: 0.5,
        length: 20,
        width: 15,
        height: 5,
      },
      save: jest.fn().mockResolvedValue(true),
    };

    const parentOrderDoc = {
      _id: parentOrderId,
      orderNumber: 'RUP-2026-9001',
      customerId: new mongoose.Types.ObjectId(),
      paymentStatus: isCod ? 'PENDING' : 'PAID',
      paymentMethod: isCod ? 'COD' : 'RAZORPAY',
      shippingAddress: {
        fullName: 'Ananya Sharma',
        phone: '9123456780',
        addressLine1: 'Flat 402, Lotus Tower',
        city: 'Bengaluru',
        state: 'KA',
        pincode: '560001',
        country: 'India',
      },
      user: {
        _id: new mongoose.Types.ObjectId(),
        email: 'ananya@example.com',
      },
    };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(vendorDoc);
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vendorOrderDoc);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue(parentOrderDoc),
      populate: jest.fn().mockReturnThis(),
    });

    return {
      vendorUserId,
      vendorId,
      parentOrderId,
      vendorOrderId,
      variantId,
      vendorDoc,
      vendorOrderDoc,
      parentOrderDoc,
    };
  };

  // 1. Approved pickup location allows automatic shipment
  it('1. Approved pickup location allows automatic shipment', async () => {
    const { vendorUserId, vendorOrderId } = setupMockVendorOrder({
      adminStatus: 'APPROVED',
      registrationStatus: 'REGISTERED',
    });

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);

    const createdShipmentDoc = {
      _id: new mongoose.Types.ObjectId(),
      vendorOrderId,
      shipmentNumber: 'SHP-9001',
      status: 'PICKUP_REQUESTED',
      trackingNumber: 'AWB-TEST-12345',
      carrier: 'Blue Dart Express',
      provider: 'shiprocket',
      providerShipmentId: 'SR-SHIP-8899',
      metadata: {
        stagesCompleted: ['ORDER_CREATED', 'COURIER_ASSIGNED', 'AWB_GENERATED', 'LABEL_GENERATED', 'PICKUP_REQUESTED'],
      },
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(shippingService, 'createShipment').mockResolvedValue(createdShipmentDoc);

    const res = mockResponse();
    await readyVendorOrder(
      {
        params: { id: vendorOrderId.toHexString() },
        user: { sub: vendorUserId },
        body: { weight: 0.5, length: 20, width: 15, height: 5 },
        headers: {},
      },
      res,
      (err) => { throw err; }
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          shipment: expect.objectContaining({
            status: 'PICKUP_REQUESTED',
            trackingNumber: 'AWB-TEST-12345',
          }),
        }),
      })
    );
  });

  // 2. Pending pickup location blocks shipment
  it('2. Pending pickup location blocks shipment', async () => {
    const { vendorUserId, vendorOrderId } = setupMockVendorOrder({
      adminStatus: 'PENDING',
      registrationStatus: 'REGISTERED',
    });

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);

    const res = mockResponse();
    await expect(
      readyVendorOrder(
        {
          params: { id: vendorOrderId.toHexString() },
          user: { sub: vendorUserId },
          body: { weight: 0.5, length: 20, width: 15, height: 5 },
          headers: {},
        },
        res,
        (err) => { throw err; }
      )
    ).rejects.toThrow('awaiting admin approval');
  });

  // 3. Deactivated pickup location blocks shipment
  it('3. Deactivated pickup location blocks shipment', async () => {
    const { vendorUserId, vendorOrderId } = setupMockVendorOrder({
      adminStatus: 'DEACTIVATED',
      registrationStatus: 'REGISTERED',
    });

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);

    const res = mockResponse();
    await expect(
      readyVendorOrder(
        {
          params: { id: vendorOrderId.toHexString() },
          user: { sub: vendorUserId },
          body: { weight: 0.5, length: 20, width: 15, height: 5 },
          headers: {},
        },
        res,
        (err) => { throw err; }
      )
    ).rejects.toThrow('deactivated');
  });

  // 4. Archived pickup location blocks shipment
  it('4. Archived pickup location blocks shipment', async () => {
    const { vendorUserId, vendorOrderId } = setupMockVendorOrder({
      adminStatus: 'ARCHIVED',
      registrationStatus: 'REGISTERED',
    });

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);

    const res = mockResponse();
    await expect(
      readyVendorOrder(
        {
          params: { id: vendorOrderId.toHexString() },
          user: { sub: vendorUserId },
          body: { weight: 0.5, length: 20, width: 15, height: 5 },
          headers: {},
        },
        res,
        (err) => { throw err; }
      )
    ).rejects.toThrow('archived');
  });

  // 5. Shiprocket order creation succeeds
  it('5. Shiprocket order creation succeeds', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          order_id: 10101,
          shipment_id: 20202,
          status: 'NEW',
          status_code: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            available_courier_companies: [
              {
                courier_company_id: 10,
                courier_name: 'Fast Courier',
                rate: 65,
                etd: '2',
                rating: 4.5,
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            data: {
              awb_code: 'AWB-55555',
              courier_name: 'Fast Courier',
              courier_company_id: 10,
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          label_url: 'https://shiprocket.co/label/55555.pdf',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            pickup_token_number: 'PKP-55555',
            pickup_scheduled_date: '2026-10-10',
          },
        }),
      });

    const result = await provider.createShipment({
      shipmentNumber: 'SHP-005',
      orderNumber: 'RUP-005',
      orderDate: new Date().toISOString(),
      pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
      channelId: 'custom',
      deliveryAddress: {
        fullName: 'Rahul Roy',
        phone: '9876543210',
        email: 'rahul@example.com',
        addressLine1: 'Street 1',
        city: 'Kolkata',
        state: 'WB',
        pincode: '700001',
      },
      items: [{ name: 'Item 1', sku: 'SKU1', units: 1, sellingPrice: 500 }],
      packageInfo: { weight: 0.5, length: 10, width: 10, height: 10 },
      payment: { method: 'PREPAID', total: 500 },
    });

    expect(result.providerShipmentId).toBe('20202');
    expect(result.shipmentId).toBe(20202);
    expect(result.stagesCompleted).toContain('ORDER_CREATED');
  });

  // 6. Shipment ID is persisted
  it('6. Shipment ID is persisted in MongoDB shipment model', async () => {
    const { vendorOrderId, parentOrderId, vendorId } = setupMockVendorOrder();

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(Shipment, 'create').mockImplementation(async (data) => ({
      ...data,
      save: jest.fn().mockResolvedValue(true),
    }));

    jest.spyOn(ShiprocketProvider.prototype, 'createShipment').mockResolvedValue({
      shipmentNumber: 'SHP-PERSIST-999',
      trackingNumber: 'AWB-PERSIST-999',
      carrier: 'Reliable Express',
      courierId: 14,
      providerShipmentId: 'SR-SHIP-PERSIST-12345',
      shipmentId: 'SR-SHIP-PERSIST-12345',
      providerOrderId: 'SR-ORD-999',
      status: 'PICKUP_REQUESTED',
      labelUrl: 'https://shiprocket.co/label/persist.pdf',
      pickupToken: 'PKP-PERSIST-11',
      stagesCompleted: ['ORDER_CREATED', 'COURIER_ASSIGNED', 'AWB_GENERATED', 'LABEL_GENERATED', 'PICKUP_REQUESTED'],
      metadata: {},
    });

    const shipment = await shippingService.createShipment({
      orderId: parentOrderId,
      vendorOrderId,
      vendorId,
      customerId: new mongoose.Types.ObjectId(),
      packageInfo: { weight: 0.5, length: 15, width: 10, height: 5 },
      pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
      deliveryAddress: { fullName: 'Customer', phone: '9876543210', pincode: '700001' },
    });

    expect(shipment.providerShipmentId).toBe('SR-SHIP-PERSIST-12345');
    expect(shipment.trackingNumber).toBe('AWB-PERSIST-999');
    expect(shipment.carrier).toBe('Reliable Express');
  });

  // 7. Courier options are retrieved
  it('7. Courier options are retrieved from Shiprocket serviceability endpoint', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            available_courier_companies: [
              {
                courier_company_id: 1,
                courier_name: 'Delhivery Surface',
                rate: 55,
                etd: '3',
                rating: 4.2,
                is_serviceable: true,
              },
              {
                courier_company_id: 2,
                courier_name: 'Blue Dart Air',
                rate: 95,
                etd: '1',
                rating: 4.8,
                is_serviceable: true,
              },
            ],
          },
        }),
      });

    const couriers = await provider.getAvailableCouriers({
      pickupPincode: '700001',
      deliveryPincode: '560001',
      weight: 0.5,
      cod: false,
    });

    expect(couriers.availableCouriers).toHaveLength(2);
    expect(couriers.availableCouriers[0].courier_name).toBe('Delhivery Surface');
    expect(couriers.availableCouriers[1].courier_name).toBe('Blue Dart Air');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/external/courier/serviceability/'),
      expect.anything()
    );
  });

  // 8. Courier is automatically selected deterministically
  it('8. Courier is automatically selected deterministically without hardcoding names', () => {
    const candidateCouriers = [
      {
        courier_company_id: 101,
        courier_name: 'Slow Expensive Courier',
        rate: 120,
        etd: '5',
        rating: 3.0,
        is_serviceable: true,
      },
      {
        courier_company_id: 102,
        courier_name: 'Fast High-Rated Courier',
        rate: 70,
        etd: '2',
        rating: 4.7,
        is_serviceable: true,
      },
      {
        courier_company_id: 103,
        courier_name: 'Cheapest Courier',
        rate: 40,
        etd: '4',
        rating: 3.8,
        is_serviceable: true,
      },
    ];

    const selected = selectDeterministicCourier(candidateCouriers, { cod: false });
    expect(selected).toBeDefined();
    expect([102, 103]).toContain(selected.courier_company_id);

    // If recommendedCourierId is passed, it receives highest boost
    const recommended = selectDeterministicCourier(candidateCouriers, {
      recommendedCourierId: 101,
    });
    expect(recommended.courier_company_id).toBe(101);
  });

  // 9. AWB is automatically assigned
  it('9. AWB is automatically assigned via Shiprocket courier assign endpoint', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            data: {
              awb_code: 'AWB-ASSIGN-777',
              courier_name: 'Express Wings',
              courier_company_id: 33,
            },
          },
        }),
      });

    const awbRes = await provider.assignAwb({
      shipmentId: 99,
      courierId: 33,
    });

    expect(awbRes.awb).toBe('AWB-ASSIGN-777');
    expect(awbRes.courierName).toBe('Express Wings');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://apiv2.shiprocket.in/v1/external/courier/assign/awb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ shipment_id: 99, courier_id: 33 }),
      })
    );
  });

  // 10. Label is automatically generated/retrieved
  it('10. Label is automatically generated/retrieved via Shiprocket generate label endpoint', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          label_created: 1,
          label_url: 'https://s3.ap-south-1.amazonaws.com/shiprocket-labels/label-10.pdf',
        }),
      });

    const labelRes = await provider.generateLabel({
      shipmentId: 10,
    });

    expect(labelRes.labelUrl).toBe('https://s3.ap-south-1.amazonaws.com/shiprocket-labels/label-10.pdf');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://apiv2.shiprocket.in/v1/external/courier/generate/label',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ shipment_id: [10] }),
      })
    );
  });

  // 11. Pickup is automatically requested
  it('11. Pickup is automatically requested via Shiprocket pickup endpoint', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            pickup_token_number: 'PKP-TOKEN-1111',
            pickup_scheduled_date: '2026-10-12',
            status: 1,
          },
        }),
      });

    const pickupRes = await provider.requestPickup({
      shipmentId: 11,
      pickupDate: '2026-10-12',
    });

    expect(pickupRes.pickupToken).toBe('PKP-TOKEN-1111');
    expect(pickupRes.scheduledDate).toBe('2026-10-12');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://apiv2.shiprocket.in/v1/external/courier/generate/pickup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ shipment_id: [11], pickup_date: '2026-10-12' }),
      })
    );
  });

  // 12. Full successful flow completes without Shiprocket dashboard interaction
  it('12. Full successful flow completes without Shiprocket dashboard interaction', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      // 1. Create order
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          order_id: 9901,
          shipment_id: 8801,
          status: 'NEW',
        }),
      })
      // 2. Courier serviceability
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            available_courier_companies: [
              {
                courier_company_id: 12,
                courier_name: 'Smart Delivery',
                rate: 58,
                etd: '2',
                rating: 4.6,
                is_serviceable: true,
              },
            ],
          },
        }),
      })
      // 3. Assign AWB
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            data: {
              awb_code: 'AWB-SMART-8801',
              courier_name: 'Smart Delivery',
              courier_company_id: 12,
            },
          },
        }),
      })
      // 4. Generate Label
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          label_url: 'https://shiprocket.cdn/labels/8801.pdf',
        }),
      })
      // 5. Request Pickup
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            pickup_token_number: 'PKP-8801',
            pickup_scheduled_date: '2026-10-10',
          },
        }),
      });

    const flowResult = await provider.createShipment({
      shipmentNumber: 'SHP-FULL-01',
      orderNumber: 'RUP-FULL-01',
      orderDate: new Date().toISOString(),
      pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
      channelId: 'custom',
      deliveryAddress: {
        fullName: 'Pooja Hegde',
        phone: '9876543210',
        email: 'pooja@example.com',
        addressLine1: 'Villa 12',
        city: 'Mumbai',
        state: 'MH',
        pincode: '400001',
      },
      items: [{ name: 'Item Full', sku: 'SKU-F', units: 1, sellingPrice: 999 }],
      packageInfo: { weight: 1.0, length: 15, width: 15, height: 10 },
      payment: { method: 'PREPAID', total: 999 },
    });

    expect(flowResult.providerOrderId).toBe(9901);
    expect(flowResult.providerShipmentId).toBe('8801');
    expect(flowResult.trackingNumber).toBe('AWB-SMART-8801');
    expect(flowResult.carrier).toBe('Smart Delivery');
    expect(flowResult.labelUrl).toBe('https://shiprocket.cdn/labels/8801.pdf');
    expect(flowResult.pickupToken).toBe('PKP-8801');
    expect(flowResult.stagesCompleted).toEqual([
      'ORDER_CREATED',
      'COURIER_ASSIGNED',
      'AWB_GENERATED',
      'LABEL_GENERATED',
      'PICKUP_REQUESTED',
    ]);
  });

  // 13. Duplicate Ready-to-Ship does not create duplicate Shiprocket orders
  it('13. Duplicate Ready-to-Ship does not create duplicate Shiprocket orders', async () => {
    const { vendorUserId, vendorOrderId, parentOrderId } = setupMockVendorOrder();

    const existingShipmentDoc = {
      _id: new mongoose.Types.ObjectId(),
      vendorOrderId,
      shipmentNumber: 'SHP-DUP-01',
      status: 'READY_TO_SHIP',
      trackingNumber: 'AWB-EXISTING-123',
      carrier: 'Courier X',
      provider: 'shiprocket',
      providerOrderId: 'SR-ORD-111',
      providerShipmentId: 'SR-SHIP-222',
      labelUrl: 'https://cdn/label.pdf',
      pickupScheduledAt: new Date(),
      toObject: () => ({ trackingNumber: 'AWB-EXISTING-123', status: 'READY_TO_SHIP' }),
    };

    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({
      _id: vendorOrderId,
      parentOrderId,
      status: 'READY_TO_SHIP',
      toObject: () => ({ _id: vendorOrderId, status: 'READY_TO_SHIP' }),
    });

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipmentDoc);

    const providerSpy = jest.spyOn(ShiprocketProvider.prototype, 'createShipment');

    const res = mockResponse();
    await readyVendorOrder(
      {
        params: { id: vendorOrderId.toHexString() },
        user: { sub: vendorUserId },
        body: { weight: 0.5, length: 15, width: 10, height: 5 },
        headers: {},
      },
      res,
      (err) => { throw err; }
    );

    expect(providerSpy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          isIdempotent: true,
        }),
      })
    );
  });

  // 14. Existing Shiprocket order is recovered after timeout/duplicate response
  it('14. Existing Shiprocket order is recovered after timeout/duplicate response', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      // Order create returns 409 duplicate
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          message: 'Order with channel_order_id already exists in Shiprocket',
        }),
      })
      // Recovery call via channel_order_id lookup
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 70001,
              channel_order_id: 'RUP-RECOVER-01',
              shipments: [
                {
                  id: 80001,
                  awb: 'AWB-RECOVERED-80001',
                  courier_name: 'Recovered Courier',
                  courier_id: 15,
                },
              ],
            },
          ],
        }),
      })
      // Label generation
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          label_url: 'https://cdn/label-recovered.pdf',
        }),
      })
      // Pickup generation
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            pickup_token_number: 'PKP-RECOVERED',
          },
        }),
      });

    const result = await provider.createShipment({
      shipmentNumber: 'SHP-REC-01',
      orderNumber: 'RUP-RECOVER-01',
      orderDate: new Date().toISOString(),
      pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
      channelId: 'custom',
      deliveryAddress: {
        fullName: 'Recover User',
        phone: '9876543210',
        email: 'rec@example.com',
        addressLine1: 'St 2',
        city: 'Kolkata',
        state: 'WB',
        pincode: '700001',
      },
      items: [{ name: 'Item', sku: 'SKU1', units: 1, sellingPrice: 500 }],
      packageInfo: { weight: 0.5, length: 10, width: 10, height: 10 },
      payment: { method: 'PREPAID', total: 500 },
    });

    expect(String(result.providerOrderId)).toBe('70001');
    expect(String(result.providerShipmentId)).toBe('80001');
    expect(result.trackingNumber).toBe('AWB-RECOVERED-80001');
  });

  // 15. Existing AWB is reused
  it('15. Existing AWB is reused without calling AWB assignment API', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      // Label generation
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          label_url: 'https://cdn/label-reused.pdf',
        }),
      })
      // Pickup generation
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            pickup_token_number: 'PKP-REUSED',
          },
        }),
      });

    const result = await provider.createShipment({
      shipmentNumber: 'SHP-REUSE-01',
      orderNumber: 'RUP-REUSE-01',
      existingShipmentId: 'SR-SHIP-999',
      existingAwb: 'AWB-EXISTING-999',
      existingCourier: 'Existing Carrier',
      existingCourierId: 25,
      pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
      deliveryAddress: {
        fullName: 'Existing User',
        phone: '9876543210',
        pincode: '700001',
      },
      packageInfo: { weight: 0.5 },
      payment: { method: 'PREPAID', total: 500 },
    });

    expect(result.trackingNumber).toBe('AWB-EXISTING-999');
    expect(result.carrier).toBe('Existing Carrier');
    // Ensure courier assign was NOT called
    expect(global.fetch).not.toHaveBeenCalledWith(
      'https://apiv2.shiprocket.in/v1/external/courier/assign/awb',
      expect.anything()
    );
  });

  // 16. Label failure can be retried without creating another order
  it('16. Label failure can be retried without creating another order', async () => {
    // Stage 1: Order creation + AWB succeed, but label fails
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      // Order create
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          order_id: 4001,
          shipment_id: 5001,
          status: 'NEW',
        }),
      })
      // Courier serviceability
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            available_courier_companies: [
              {
                courier_company_id: 15,
                courier_name: 'Carrier 15',
                rate: 50,
                etd: '2',
                rating: 4.5,
              },
            ],
          },
        }),
      })
      // Assign AWB
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            data: {
              awb_code: 'AWB-5001',
              courier_name: 'Carrier 15',
              courier_company_id: 15,
            },
          },
        }),
      })
      // Label generation fails!
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Label generation temporary error' }),
      })
      // Pickup generation
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: { pickup_token_number: 'PKP-5001' },
        }),
      });

    const partialResult = await provider.createShipment({
      shipmentNumber: 'SHP-PARTIAL-01',
      orderNumber: 'RUP-PARTIAL-01',
      pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
      deliveryAddress: { fullName: 'Partial', phone: '9876543210', pincode: '700001' },
      items: [{ name: 'Item', sku: 'SKU', units: 1, sellingPrice: 500 }],
      packageInfo: { weight: 0.5 },
      payment: { method: 'PREPAID', total: 500 },
    });

    expect(partialResult.providerShipmentId).toBe('5001');
    expect(partialResult.trackingNumber).toBe('AWB-5001');
    expect(partialResult.labelError).toBeDefined();

    // Now retry label only - provider token is already cached so only label endpoint is called
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        label_url: 'https://cdn/label-retry-success.pdf',
      }),
    });

    const retryLabelRes = await provider.generateLabel({
      shipmentId: partialResult.providerShipmentId,
    });

    expect(retryLabelRes.labelUrl).toBe('https://cdn/label-retry-success.pdf');
    // Ensure order create was NOT called during retry
    expect(global.fetch).not.toHaveBeenCalledWith(
      'https://apiv2.shiprocket.in/v1/external/orders/create/adhoc',
      expect.anything()
    );
  });

  // 17. Pickup failure can be retried without creating another order
  it('17. Pickup failure can be retried without creating another order', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            pickup_token_number: 'PKP-RETRY-OK-99',
            pickup_scheduled_date: '2026-10-15',
          },
        }),
      });

    const pickupRetryRes = await provider.requestPickup({
      shipmentId: 5001,
      pickupDate: '2026-10-15',
    });

    expect(pickupRetryRes.pickupToken).toBe('PKP-RETRY-OK-99');
    expect(global.fetch).not.toHaveBeenCalledWith(
      'https://apiv2.shiprocket.in/v1/external/orders/create/adhoc',
      expect.anything()
    );
  });

  // 18. Multi-vendor shipments remain isolated
  it('18. Multi-vendor shipments remain isolated with separate pickup locations and shipments', async () => {
    const vendorUserId1 = new mongoose.Types.ObjectId().toHexString();
    const vendorUserId2 = new mongoose.Types.ObjectId().toHexString();
    const vendorId1 = new mongoose.Types.ObjectId();
    const vendorId2 = new mongoose.Types.ObjectId();
    const vendorOrderId1 = new mongoose.Types.ObjectId();
    const vendorOrderId2 = new mongoose.Types.ObjectId();

    // Vendor 2 tries to access Vendor 1's shipping label
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId2,
      ownerUserId: vendorUserId2,
      status: 'APPROVED',
      pickupAddress: {
        pickupLocationName: 'Vendor_2_Loc',
        registrationStatus: 'REGISTERED',
        adminStatus: 'APPROVED',
      },
    });

    // Query for vendorOrderId1 belonging to vendorId2 returns null
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);

    const res = mockResponse();
    await expect(
      downloadVendorShippingLabel(
        {
          params: { orderId: vendorOrderId1.toHexString() },
          user: { sub: vendorUserId2 },
          headers: {},
        },
        res,
        (err) => { throw err; }
      )
    ).rejects.toThrow('Vendor order not found');
  });

  // 19. COD shipment works
  it('19. COD shipment works with is_cod=1 and authoritative vendor order total passed to Shiprocket', async () => {
    let adhocPayload = null;
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: 'mock-jwt-token' }),
      })
      .mockImplementationOnce((url, opts) => {
        adhocPayload = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            order_id: 3001,
            shipment_id: 3002,
            status: 'NEW',
          }),
        });
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            available_courier_companies: [
              {
                courier_company_id: 20,
                courier_name: 'COD Express',
                rate: 80,
                etd: '3',
                rating: 4.4,
                cod: 1,
                is_serviceable: true,
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: {
            data: {
              awb_code: 'AWB-COD-3002',
              courier_name: 'COD Express',
              courier_company_id: 20,
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          label_url: 'https://cdn/label-cod.pdf',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: { pickup_token_number: 'PKP-COD-3002' },
        }),
      });

    const codResult = await provider.createShipment({
      shipmentNumber: 'SHP-COD-01',
      orderNumber: 'RUP-COD-01',
      orderDate: new Date().toISOString(),
      pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
      deliveryAddress: {
        fullName: 'COD Buyer',
        phone: '9876543210',
        pincode: '700001',
      },
      items: [{ name: 'Item', sku: 'SKU', units: 1, sellingPrice: 1499 }],
      packageInfo: { weight: 0.8 },
      payment: {
        method: 'COD',
        total: 1499,
      },
    });

    expect(adhocPayload.payment_method).toBe('COD');
    expect(adhocPayload.sub_total).toBe(1499);
    expect(codResult.trackingNumber).toBe('AWB-COD-3002');
  });

  // 20. Existing Shiprocket webhook tracking remains functional
  it('20. Existing Shiprocket webhook tracking remains functional and updates shipment state', async () => {
    const parentOrderId = new mongoose.Types.ObjectId();
    const vendorOrderId = new mongoose.Types.ObjectId();
    const shipmentId = new mongoose.Types.ObjectId();

    const mockShipmentDoc = {
      _id: shipmentId,
      orderId: parentOrderId,
      vendorOrderId,
      trackingNumber: 'AWB-WEBHOOK-99',
      carrier: 'Shiprocket Express',
      provider: 'shiprocket',
      status: 'SHIPPED',
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipmentDoc);
    jest.spyOn(ShipmentTrackingEvent, 'create').mockResolvedValue({});
    jest.spyOn(VendorOrder, 'updateOne').mockResolvedValue(true);
    jest.spyOn(Shipment, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ status: 'IN_TRANSIT' }]) }),
    });
    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ status: 'IN_TRANSIT' }]) }),
    });
    jest.spyOn(Order, 'updateOne').mockResolvedValue(true);
    jest.spyOn(Order, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ orderNumber: 'RUP-SR-1' }) }),
    });
    jest.spyOn(Vendor, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ownerUserId: new mongoose.Types.ObjectId() }) }),
    });
    jest.spyOn(User, 'findById').mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ email: 'seller@rupakar.in', phone: '9999999999' }) }),
    });

    const req = {
      body: {
        awb: 'AWB-WEBHOOK-99',
        current_status: 'IN TRANSIT',
        current_status_id: 17,
        courier_name: 'Shiprocket Express',
        location: 'Hub Bengaluru',
        scans: [
          {
            activity: 'Shipment received at hub',
            location: 'Bengaluru',
            date: new Date().toISOString(),
          },
        ],
      },
      get: (header) => (header === 'x-api-key' ? (env.DELIVERY_WEBHOOK_SECRET || 'test_webhook_secret') : null),
    };

    const res = mockResponse();
    await deliveryWebhook(req, res, (err) => { throw err; });

    expect(mockShipmentDoc.status).toBe('IN_TRANSIT');
    expect(mockShipmentDoc.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
      })
    );
  });

  // Section 21: Focused Pickup Failure & Stage-Resuming Retry
  describe('Focused Pickup Failure & Stage-Resuming Retry', () => {
    const fixedAwb = 'AWB-LIVE-TEST-7788';
    const fixedShipmentId = 998877;
    const fixedLabelUrl = 'https://shiprocket.co/pdf/label-998877.pdf';

    it('A. AWB + label successful, pickup fails -> stages preserved without fake pickup', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock-jwt-token' }),
        })
        // 1. adhoc order creation
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            shipment_id: fixedShipmentId,
            order_id: 112233,
            status: 'NEW',
          }),
        })
        // 2. serviceability
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              available_courier_companies: [
                { id: 196, courier_company_id: 196, courier_name: 'DTDC Air 500gm', rate: 133, etd: 3 },
              ],
            },
          }),
        })
        // 3. AWB assignment
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              data: {
                awb_code: fixedAwb,
                courier_name: 'DTDC Air 500gm',
                courier_company_id: 196,
              },
            },
          }),
        })
        // 4. Label generation
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            label_url: fixedLabelUrl,
            label_created: true,
          }),
        })
        // 5. Pickup request fails
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({
            message: 'Courier pickup slots currently full',
            status_code: 400,
          }),
        });

      const shipmentResult = await provider.createShipment({
        shipmentNumber: 'SHIP-TEST-PICKUP-FAIL-1',
        pickupAddress: { pickupLocationName: 'Barrackpore Warehouse', pincode: '700122' },
        deliveryAddress: { postalCode: '700122' },
        packageInfo: { weight: 0.5 },
      });

      expect(shipmentResult.stagesCompleted).toContain('ORDER_CREATED');
      expect(shipmentResult.stagesCompleted).toContain('COURIER_ASSIGNED');
      expect(shipmentResult.stagesCompleted).toContain('AWB_GENERATED');
      expect(shipmentResult.stagesCompleted).toContain('LABEL_GENERATED');
      expect(shipmentResult.stagesCompleted).not.toContain('PICKUP_REQUESTED');

      expect(shipmentResult.trackingNumber).toBe(fixedAwb);
      expect(shipmentResult.labelUrl).toBe(fixedLabelUrl);
      expect(shipmentResult.pickupStatus).toBe('FAILED');
      expect(shipmentResult.pickupError).toBe('Courier pickup slots currently full');
    });

    it('B, C, D, E. Retry after pickup failure calls only pickup, preserving existing AWB and label without second AWB call', async () => {
      const fetchCalls = [];
      global.fetch = jest.fn((url, opts) => {
        fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
        if (url.includes('/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ token: 'mock-jwt-token' }),
          });
        }
        if (url.includes('/courier/generate/pickup')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              response: {
                pickup_token_number: 'PKP-RETRY-SUCCESS-99',
                pickup_scheduled_date: '2026-10-18',
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      });

      const retryResult = await provider.createShipment({
        shipmentNumber: 'SHIP-TEST-PICKUP-FAIL-1',
        existingShipmentId: fixedShipmentId,
        existingAwb: fixedAwb,
        existingLabelUrl: fixedLabelUrl,
        existingPickupStatus: 'FAILED',
        existingCourierCompanyId: 196,
        existingCourierName: 'DTDC Air 500gm',
        pickupAddress: { pickupLocationName: 'Barrackpore Warehouse', pincode: '700122' },
        deliveryAddress: { postalCode: '700122' },
        packageInfo: { weight: 0.5 },
      });

      const awbCall = fetchCalls.find((c) => c.url.includes('/courier/assign/awb'));
      expect(awbCall).toBeUndefined();

      const labelCall = fetchCalls.find((c) => c.url.includes('/courier/generate/label'));
      expect(labelCall).toBeUndefined();

      const pickupCall = fetchCalls.find((c) => c.url.includes('/courier/generate/pickup'));
      expect(pickupCall).toBeDefined();
      expect(pickupCall.body).toEqual({ shipment_id: [fixedShipmentId] });

      expect(retryResult.trackingNumber).toBe(fixedAwb);
      expect(retryResult.labelUrl).toBe(fixedLabelUrl);
      expect(retryResult.pickupStatus).toBe('SCHEDULED');
      expect(retryResult.pickupToken).toBe('PKP-RETRY-SUCCESS-99');
      expect(retryResult.stagesCompleted).toContain('PICKUP_REQUESTED');
    });
  });

  // Section 22: Authentic AWB Verification & Safe State Transitions (Cases A - E)
  describe('Section 22: Authentic AWB Verification & Safe State Transitions (Cases A - E)', () => {
    const srShipmentId = 1637532193;
    const realAwb = '143400987654';

    // CASE A:
    // AWB assignment returns wallet/balance error
    // -> stagesCompleted does NOT contain AWB_GENERATED
    // -> no pickup request
    // -> no fake AWB.
    it('CASE A: AWB assignment returns wallet/balance error -> stagesCompleted does NOT contain AWB_GENERATED, no pickup request, no fake AWB', async () => {
      const fetchCalls = [];
      global.fetch = jest.fn((url, opts) => {
        fetchCalls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
        if (url.includes('/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ token: 'mock-jwt-token' }),
          });
        }
        if (url.includes('/orders/create/adhoc')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ shipment_id: srShipmentId, order_id: 887766, status: 'NEW' }),
          });
        }
        if (url.includes('/courier/serviceability')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                available_courier_companies: [
                  { id: 196, courier_company_id: 196, courier_name: 'DTDC Air 500gm', rate: 120, etd: 3 },
                ],
              },
            }),
          });
        }
        if (url.includes('/courier/assign/awb')) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({
              status_code: 350,
              message: 'Please recharge your ShipRocket wallet. The minimum required balance is Rs 100',
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res = await provider.createShipment({
        shipmentNumber: 'SHIP-TEST-WALLET-ERR',
        pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
        deliveryAddress: { postalCode: '560001' },
        packageInfo: { weight: 0.5 },
      });

      expect(res.stagesCompleted).not.toContain('AWB_GENERATED');
      expect(res.stagesCompleted).toContain('ORDER_CREATED');
      expect(res.stagesCompleted).toContain('COURIER_ASSIGNED');

      const pickupCall = fetchCalls.find((c) => c.url.includes('/courier/generate/pickup'));
      expect(pickupCall).toBeUndefined();
      expect(res.stagesCompleted).not.toContain('PICKUP_REQUESTED');

      expect(res.trackingNumber).toBeNull();
      expect(res.trackingNumber).not.toBe(`SR${srShipmentId}`);

      expect(res.metadata?.awbError).toBe('Please recharge your ShipRocket wallet. The minimum required balance is Rs 100');
    });

    // CASE B:
    // Shiprocket shipment lookup returns awb=null
    // -> AWB is considered unassigned.
    it('CASE B: Shiprocket shipment lookup returns awb=null -> AWB is considered unassigned', async () => {
      global.fetch = jest.fn((url) => {
        if (url.includes('/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ token: 'mock-jwt-token' }),
          });
        }
        if (url.includes(`/shipments/${srShipmentId}`)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: srShipmentId,
                order_id: 887766,
                awb: null,
                status: 'NEW',
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const shipmentDetails = await provider.getShipmentDetails(srShipmentId);
      expect(shipmentDetails.awb).toBeNull();
      expect(shipmentDetails.rawAwb).toBeNull();

      expect(isAuthenticAwb(shipmentDetails.awb, srShipmentId)).toBe(false);
      expect(isAuthenticAwb(`SR${srShipmentId}`, srShipmentId)).toBe(false);
      expect(isAuthenticAwb('TRK-12345', srShipmentId)).toBe(false);
    });

    // CASE C:
    // Shiprocket returns real AWB
    // -> AWB_GENERATED is recorded.
    it('CASE C: Shiprocket returns real AWB -> AWB_GENERATED is recorded', async () => {
      global.fetch = jest.fn((url) => {
        if (url.includes('/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ token: 'mock-jwt-token' }),
          });
        }
        if (url.includes('/courier/assign/awb')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              response: {
                data: {
                  awb_code: realAwb,
                  courier_name: 'Delhivery Surface',
                  courier_company_id: 10,
                },
              },
            }),
          });
        }
        if (url.includes('/courier/generate/label')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ label_url: 'https://shiprocket.co/label/123.pdf', label_created: true }),
          });
        }
        if (url.includes('/courier/generate/pickup')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              response: { pickup_token_number: 'PKP-1234', pickup_scheduled_date: '2026-10-15' },
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res = await provider.createShipment({
        shipmentNumber: 'SHIP-TEST-REAL-AWB',
        existingShipmentId: srShipmentId,
        existingCourierCompanyId: 10,
        pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
        deliveryAddress: { postalCode: '560001' },
        packageInfo: { weight: 0.5 },
      });

      expect(res.stagesCompleted).toContain('AWB_GENERATED');
      expect(res.trackingNumber).toBe(realAwb);
      expect(res.metadata.awbError).toBeNull();
    });

    // CASE D:
    // Real AWB exists + pickup fails
    // -> only pickup is retried.
    it('CASE D: Real AWB exists + pickup fails -> only pickup is retried', async () => {
      const fetchCalls = [];
      global.fetch = jest.fn((url, opts) => {
        fetchCalls.push({ url, opts });
        if (url.includes('/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ token: 'mock-jwt-token' }),
          });
        }
        if (url.includes('/courier/generate/pickup')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              response: { pickup_token_number: 'PKP-RETRY-OK', pickup_scheduled_date: '2026-10-16' },
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res = await provider.createShipment({
        shipmentNumber: 'SHIP-TEST-RETRY-PICKUP',
        existingShipmentId: srShipmentId,
        existingAwb: realAwb,
        existingLabelUrl: 'https://shiprocket.co/label/123.pdf',
        existingPickupStatus: 'FAILED',
        existingCourierCompanyId: 10,
        pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
        deliveryAddress: { postalCode: '560001' },
        packageInfo: { weight: 0.5 },
      });

      expect(fetchCalls.some((c) => c.url.includes('/orders/create/adhoc'))).toBe(false);
      expect(fetchCalls.some((c) => c.url.includes('/courier/assign/awb'))).toBe(false);
      expect(fetchCalls.some((c) => c.url.includes('/courier/generate/label'))).toBe(false);

      expect(fetchCalls.some((c) => c.url.includes('/courier/generate/pickup'))).toBe(true);
      expect(res.trackingNumber).toBe(realAwb);
      expect(res.pickupStatus).toBe('SCHEDULED');
      expect(res.stagesCompleted).toContain('PICKUP_REQUESTED');
    });

    // CASE E:
    // Retry after AWB assignment failure
    // -> calls AWB assignment again
    // -> does not call pickup before AWB exists.
    it('CASE E: Retry after AWB assignment failure -> calls AWB assignment again, does not call pickup before AWB exists', async () => {
      const fetchCalls = [];
      global.fetch = jest.fn((url, opts) => {
        fetchCalls.push({ url, opts });
        if (url.includes('/auth/login')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ token: 'mock-jwt-token' }),
          });
        }
        if (url.includes(`/shipments/${srShipmentId}`)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: { id: srShipmentId, awb: null } }),
          });
        }
        if (url.includes('/courier/assign/awb')) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({
              status_code: 350,
              message: 'Please recharge your ShipRocket wallet. The minimum required balance is Rs 100',
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res = await provider.createShipment({
        shipmentNumber: 'SHIP-TEST-RETRY-AWB',
        existingShipmentId: srShipmentId,
        existingAwb: null,
        existingCourierCompanyId: 10,
        pickupAddress: { pickupLocationName: 'Vendor_Wh_1', pincode: '700001' },
        deliveryAddress: { postalCode: '560001' },
        packageInfo: { weight: 0.5 },
      });

      expect(fetchCalls.some((c) => c.url.includes('/courier/assign/awb'))).toBe(true);
      expect(fetchCalls.some((c) => c.url.includes('/courier/generate/pickup'))).toBe(false);
      expect(res.stagesCompleted).not.toContain('AWB_GENERATED');
      expect(res.stagesCompleted).not.toContain('PICKUP_REQUESTED');
      expect(res.trackingNumber).toBeNull();
      expect(res.metadata.awbError).toBe('Please recharge your ShipRocket wallet. The minimum required balance is Rs 100');
    });
  });
});
