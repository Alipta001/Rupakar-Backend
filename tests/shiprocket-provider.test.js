import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import crypto from 'node:crypto';
import { ShiprocketProvider, SHIPROCKET_STATUS_MAP, getDeliveryProvider } from '../app/services/delivery-provider.service.js';
import { ShippingService } from '../app/services/shipping.service.js';
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
  deliveryWebhook,
  downloadVendorShippingLabel,
} = await import('../app/controllers/shipping.controller.js');

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

describe('ShiprocketProvider & Multi-Provider Delivery System', () => {
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

    provider = new ShiprocketProvider({
      email: testEmail,
      password: testPassword,
      apiUrl: testApiUrl,
      mode: 'mock',
    });

    originalFetch = global.fetch;
  });

  // 1. Authentication success
  it('1. authenticates successfully with Shiprocket API and returns JWT token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 12345,
        email: testEmail,
        token: 'sr_jwt_mock_token_abc123',
      }),
    });

    const token = await provider.getToken();
    expect(token).toBe('sr_jwt_mock_token_abc123');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://apiv2.shiprocket.in/v1/external/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      })
    );
  });

  // 2. Authentication failure
  it('2. handles authentication failure safely and throws AppError without logging password', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid credentials or user inactive' }),
    });

    await expect(provider.getToken()).rejects.toThrow('Invalid credentials or user inactive');
  });

  // 3. Token reuse / expiration handling
  it('3. reuses cached token and handles 401 token expiration by re-authenticating seamlessly', async () => {
    let loginCalls = 0;
    global.fetch = jest.fn().mockImplementation((url, opts) => {
      if (url.includes('/auth/login')) {
        loginCalls++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: `sr_token_gen_${loginCalls}` }),
        });
      }

      if (url.includes('/courier/serviceability')) {
        // First time serviceability is called, simulate 401 token expired
        if (opts.headers.Authorization === 'Bearer sr_token_gen_1') {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: async () => ({ message: 'Token has expired' }),
          });
        }
        // Second attempt with refreshed token succeeds
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { available_courier_companies: [{ courier_name: 'Bluedart', rate: 75 }] },
          }),
        });
      }

      return Promise.reject(new Error('Unknown url'));
    });

    // Initial token fetch
    const token1 = await provider.getToken();
    expect(token1).toBe('sr_token_gen_1');
    expect(loginCalls).toBe(1);

    // Second call reuses cached token
    const token2 = await provider.getToken();
    expect(token2).toBe('sr_token_gen_1');
    expect(loginCalls).toBe(1); // No new network call for login

    // Request that triggers 401 and auto-refreshes token
    const rates = await provider.getShippingRates({ pickupPincode: '700001', deliveryPincode: '110001' });
    expect(rates.length).toBe(1);
    expect(rates[0].carrier).toBe('Bluedart');
    expect(loginCalls).toBe(2); // Refreshed token after 401
  });

  // 4. Serviceability and rate lookup
  it('4. checks serviceability and retrieves courier rates, identifying recommended courier', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/auth/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock_token' }),
        });
      }
      if (url.includes('/courier/serviceability')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            status: 200,
            data: {
              available_courier_companies: [
                {
                  courier_company_id: 10,
                  courier_name: 'Bluedart Air',
                  rate: '95.00',
                  estimated_delivery_days: '2',
                  cod: 1,
                  rating: 4.8,
                },
                {
                  courier_company_id: 20,
                  courier_name: 'Delhivery Surface',
                  rate: '55.00',
                  estimated_delivery_days: '4',
                  cod: 1,
                  rating: 4.2,
                },
              ],
              recommended_courier_company_id: 20,
            },
          }),
        });
      }
      return Promise.reject(new Error('Not found'));
    });

    const serviceability = await provider.checkServiceability({
      pickupPincode: '700001',
      deliveryPincode: '400001',
    });
    expect(serviceability.serviceable).toBe(true);
    expect(serviceability.codAvailable).toBe(true);
    expect(serviceability.provider).toBe('shiprocket');

    const rates = await provider.getShippingRates({
      pickupPincode: '700001',
      deliveryPincode: '400001',
      weight: 1.2,
    });

    expect(rates.length).toBe(2);
    const recommended = rates.find((r) => r.recommended);
    expect(recommended.carrier).toBe('Delhivery Surface');
    expect(recommended.cost).toBe(55);
    expect(recommended.provider).toBe('shiprocket');
  });

  // 5. Shipment creation
  it('5. creates shipment with Shiprocket ad-hoc order, assigns AWB, generates label, and schedules pickup', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/auth/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock_token' }),
        });
      }
      if (url.includes('/orders/create/adhoc')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            order_id: 991122,
            shipment_id: 882233,
            status: 'NEW',
          }),
        });
      }
      if (url.includes('/courier/assign/awb')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              data: {
                awb_code: 'SR774411IN',
                courier_name: 'Delhivery Surface Express',
              },
            },
          }),
        });
      }
      if (url.includes('/courier/generate/label')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            label_created: 1,
            label_url: 'https://shiprocket.co/labels/882233.pdf',
          }),
        });
      }
      if (url.includes('/courier/generate/pickup') || url.includes('/couriers/generate/pickup')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            pickup_status: 1,
            response: {
              pickup_token_number: 'PKP-SR-882233',
              pickup_scheduled_date: '2026-10-06',
            },
          }),
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const result = await provider.createShipment({
      shipmentNumber: 'SHIP-TEST-SR',
      orderId: new mongoose.Types.ObjectId(),
      orderNumber: 'RUP-2026-001',
      vendorOrderId: new mongoose.Types.ObjectId(),
      pickupAddress: { city: 'Kolkata Hub', postalCode: '700001' },
      deliveryAddress: { name: 'Customer One', street: '123 Park Street', city: 'Mumbai', postalCode: '400001' },
      packageInfo: { weight: 1.5, length: 20, width: 15, height: 10 },
      items: [{ productName: 'Kantha Saree', sku: 'SKU-KANTHA-1', quantity: 1, unitPrice: 1500 }],
    });

    expect(result.trackingNumber).toBe('SR774411IN');
    expect(result.providerShipmentId).toBe('882233');
    expect(result.carrier).toBe('Delhivery Surface Express');
    expect(result.labelUrl).toBe('https://shiprocket.co/labels/882233.pdf');
    expect(result.pickupStatus).toBe('SCHEDULED');
    expect(result.pickupToken).toBe('PKP-SR-882233');
    expect(result.provider).toBe('shiprocket');
    expect(result.status).toBe('READY_TO_SHIP');
  });

  // 6. AWB / Courier assignment
  it('6. generates and assigns AWB explicitly through Shiprocket courier assign endpoint', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/auth/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock_token' }),
        });
      }
      if (url.includes('/courier/assign/awb')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              data: {
                awb_code: 'SR-EXPLICIT-AWB-001',
                courier_company_id: 10,
              },
            },
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    const awb = await provider.generateAwb({ shipmentId: 882233, courierId: 10 });
    expect(awb).toBe('SR-EXPLICIT-AWB-001');
  });

  // 7. Pickup request
  it('7. requests carrier pickup from Shiprocket and returns scheduled token and date', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/auth/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock_token' }),
        });
      }
      if (url.includes('/courier/generate/pickup') || url.includes('/couriers/generate/pickup')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            pickup_status: 1,
            response: {
              pickup_token_number: 'PKP-TOKEN-9988',
              pickup_scheduled_date: '2026-10-07 14:00:00',
            },
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    const pickup = await provider.requestPickup({ shipmentId: 882233, trackingNumber: 'SR774411IN' });
    expect(pickup.scheduled).toBe(true);
    expect(pickup.pickupToken).toBe('PKP-TOKEN-9988');
    expect(pickup.status).toBe('SCHEDULED');
    expect(pickup.provider).toBe('shiprocket');
  });

  // 8. Tracking mapping
  it('8. tracks shipment and normalizes Shiprocket transit activities into Rupakar status model', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/auth/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock_token' }),
        });
      }
      if (url.includes('/courier/track/awb/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            tracking_data: {
              track_status: 1,
              shipment_track: [
                {
                  id: 882233,
                  awb_code: 'SR774411IN',
                  current_status: 'DELIVERED',
                  courier_name: 'Delhivery Surface',
                  edd: '2026-10-08',
                },
              ],
              shipment_track_activities: [
                { date: '2026-10-06 11:00:00', status: 'PICKED UP', activity: 'Item picked up', location: 'Kolkata Hub' },
                { date: '2026-10-07 16:30:00', status: 'IN TRANSIT', activity: 'In transit to hub', location: 'Nagpur Hub' },
                { date: '2026-10-08 09:15:00', status: 'OUT FOR DELIVERY', activity: 'Out for delivery', location: 'Mumbai Hub' },
                { date: '2026-10-08 14:45:00', status: 'DELIVERED', activity: 'Package delivered', location: 'Mumbai Hub' },
              ],
            },
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    const tracking = await provider.getTracking({ trackingNumber: 'SR774411IN' });
    expect(tracking.status).toBe('DELIVERED');
    expect(tracking.carrier).toBe('Delhivery Surface');
    expect(tracking.events.length).toBe(4);
    expect(tracking.events[0].status).toBe('SHIPPED');
    expect(tracking.events[1].status).toBe('IN_TRANSIT');
    expect(tracking.events[2].status).toBe('OUT_FOR_DELIVERY');
    expect(tracking.events[3].status).toBe('DELIVERED');
  });

  // 9. Provider API failure
  it('9. handles Shiprocket API failure safely and throws AppError without creating fake shipment', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/auth/login')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ token: 'mock_token' }),
        });
      }
      if (url.includes('/orders/create/adhoc')) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({ message: 'Pickup postcode not serviceable by any registered courier' }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });

    await expect(
      provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        vendorOrderId: new mongoose.Types.ObjectId(),
        pickupAddress: { postalCode: '000000' },
        deliveryAddress: { postalCode: '000000' },
      })
    ).rejects.toThrow('Pickup postcode not serviceable by any registered courier');
  });

  // 10. Duplicate Ready-to-Ship / idempotency behavior
  it('10. prevents duplicate shipment and returns existing data on repeated Ready to Ship clicks', async () => {
    const vendorUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();
    const vendorOrderId = new mongoose.Types.ObjectId();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId, status: 'APPROVED' });
    const vo = {
      _id: vendorOrderId,
      vendorId,
      parentOrderId,
      status: 'READY_TO_SHIP', // Already Ready to Ship!
      toObject: () => ({ _id: vendorOrderId, status: 'READY_TO_SHIP' }),
    };
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
    const existingShipment = {
      _id: new mongoose.Types.ObjectId(),
      trackingNumber: 'SR-EXISTING-AWB',
      status: 'READY_TO_SHIP',
      toObject: () => ({ trackingNumber: 'SR-EXISTING-AWB', status: 'READY_TO_SHIP' }),
    };
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipment);
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: parentOrderId }) });

    const res = mockResponse();
    await readyVendorOrder(
      { params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, body: {}, headers: {} },
      res,
      (err) => { throw err; }
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        isIdempotent: true,
        shipment: expect.objectContaining({ trackingNumber: 'SR-EXISTING-AWB' }),
      }),
    }));
  });

  // 11. Inventory rollback when provider shipment creation fails
  it('11. rolls back inventory if provider shipment creation fails unexpectedly', async () => {
    const vendorUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();
    const vendorOrderId = new mongoose.Types.ObjectId();
    const variantId = new mongoose.Types.ObjectId();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId: vendorUserId,
      status: 'APPROVED',
      pickupAddress: {
        pickupLocationName: 'Hub',
        registrationStatus: 'REGISTERED',
        contactPerson: 'Vendor 1',
        phone: '9876543210',
        addressLine1: 'Road 1',
        city: 'Kolkata',
        state: 'WB',
        pincode: '700001',
      },
    });
    const vo = {
      _id: vendorOrderId,
      vendorId,
      parentOrderId,
      status: 'PACKED',
      inventoryDecremented: false,
      items: [{ variantId, quantity: 3 }],
      save: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
    jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: parentOrderId, paymentStatus: 'PAID' }) });

    // Inventory decrease succeeds
    jest.spyOn(inventoryService, 'decreaseStock').mockResolvedValue({});
    // Increase stock spy for rollback verification
    const increaseSpy = jest.spyOn(inventoryService, 'increaseStock').mockResolvedValue({});

    // Provider shipment creation fails
    const shippingService = new ShippingService();
    const createShipmentSpy = jest.spyOn(shippingService, 'createShipment').mockRejectedValue(new Error('Shiprocket API 500 Network Timeout'));

    // Also import real controller instance's shippingService
    const { shippingService: realShippingService } = await import('../app/services/shipping.service.js');
    jest.spyOn(realShippingService, 'createShipment').mockRejectedValue(new Error('Shiprocket API 500 Network Timeout'));

    const res = mockResponse();
    await expect(
      readyVendorOrder(
        {
          params: { id: vendorOrderId.toHexString() },
          user: { sub: vendorUserId },
          body: { weight: 1.0, length: 15, width: 10, height: 5 },
          headers: {},
        },
        res,
        (err) => { throw err; }
      )
    ).rejects.toThrow('Shiprocket API 500 Network Timeout');

    // Verify stock was rolled back!
    expect(increaseSpy).toHaveBeenCalledWith(
      variantId,
      3,
      expect.objectContaining({ reason: 'ROLLBACK_READY_TO_SHIP_FAILURE' })
    );
    expect(vo.inventoryDecremented).toBe(false);
  });

  // 12. Multi-vendor shipment isolation
  it('12. isolates multi-vendor shipments with independent tracking and restricts cross-vendor label access', async () => {
    const vendorUserId1 = new mongoose.Types.ObjectId().toHexString();
    const vendorUserId2 = new mongoose.Types.ObjectId().toHexString();
    const vendorId1 = new mongoose.Types.ObjectId();
    const vendorId2 = new mongoose.Types.ObjectId();
    const vendorOrderId1 = new mongoose.Types.ObjectId();
    const vendorOrderId2 = new mongoose.Types.ObjectId();

    // Vendor 2 tries to download Vendor 1's shipping label
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId2,
      ownerUserId: vendorUserId2,
      status: 'APPROVED',
    });
    // VendorOrder query for vendorOrderId1 with vendorId2 returns null
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

    // Factory test: getDeliveryProvider('shiprocket') returns ShiprocketProvider
    const srProvider = getDeliveryProvider('shiprocket');
    expect(srProvider).toBeInstanceOf(ShiprocketProvider);

    const delhiveryProvider = getDeliveryProvider('delhivery');
    expect(delhiveryProvider.apiUrl).toBeDefined();

    const mockProv = getDeliveryProvider('mock');
    expect(mockProv.checkServiceability).toBeDefined();
  });

  // 13. Webhook handling with x-api-key for Shiprocket
  it('13. processes Shiprocket tracking webhook authenticated with x-api-key and updates status', async () => {
    const parentOrderId = new mongoose.Types.ObjectId();
    const vendorOrderId = new mongoose.Types.ObjectId();
    const shipmentDoc = {
      _id: new mongoose.Types.ObjectId(),
      orderId: parentOrderId,
      vendorOrderId,
      trackingNumber: 'SR774411IN',
      providerShipmentId: '882233',
      status: 'OUT_FOR_DELIVERY',
      provider: 'shiprocket',
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Shipment, 'findOne').mockResolvedValue(shipmentDoc);
    jest.spyOn(ShipmentTrackingEvent, 'create').mockResolvedValue(true);
    jest.spyOn(VendorOrder, 'updateOne').mockResolvedValue(true);
    jest.spyOn(Shipment, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ status: 'DELIVERED' }]) }),
    });
    jest.spyOn(VendorOrder, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ status: 'DELIVERED' }]) }),
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

    const payload = {
      awb: 'SR774411IN',
      current_status: 'DELIVERED',
      shipment_id: 882233,
      location: 'Delivery Destination',
      current_timestamp: '2026-10-08 14:00:00',
    };

    const req = {
      body: payload,
      get: (header) => (header === 'x-api-key' ? env.DELIVERY_WEBHOOK_SECRET : null),
    };
    const res = mockResponse();

    await deliveryWebhook(req, res, (err) => { throw err; });

    expect(shipmentDoc.status).toBe('DELIVERED');
    expect(shipmentDoc.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, duplicate: false });
  });

  // STEP 6: Focused tests for Shiprocket phone payload generation & validation
  describe('Shiprocket Phone Validation and Payload Normalization (STEP 6)', () => {
    it('1. Customer phone "9876543210" produces valid Shiprocket phone format', async () => {
      let adhocBody = null;
      jest.spyOn(provider, 'request').mockImplementation((path, options) => {
        if (path.includes('/orders/create/adhoc')) {
          adhocBody = JSON.parse(options.body);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ order_id: 101, shipment_id: 202 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-PHONE-1',
        pickupAddress: { pickupLocationName: 'Kolkata Hub' },
        deliveryAddress: { phone: '9876543210' },
      });

      expect(adhocBody).toBeDefined();
      expect(adhocBody.billing_phone).toBe('9876543210');
      expect(adhocBody.billing_customer_phone).toBe('9876543210');
      expect(adhocBody.shipping_customer_phone).toBe('9876543210');
    });

    it('2. Customer phone "+919876543210" or "+91 98765 43210" normalized correctly to 10-digit format', async () => {
      let adhocBody = null;
      jest.spyOn(provider, 'request').mockImplementation((path, options) => {
        if (path.includes('/orders/create/adhoc')) {
          adhocBody = JSON.parse(options.body);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ order_id: 102, shipment_id: 203 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-PHONE-2',
        pickupAddress: { pickupLocationName: 'Kolkata Hub' },
        deliveryAddress: { phone: '+919876543210' },
      });

      expect(adhocBody).toBeDefined();
      expect(adhocBody.billing_phone).toBe('9876543210');
      expect(adhocBody.billing_customer_phone).toBe('9876543210');

      // Also verify +91 with spaces and dashes
      await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-PHONE-2B',
        pickupAddress: { pickupLocationName: 'Kolkata Hub' },
        deliveryAddress: { phone: '+91 98765 43210' },
      });
      expect(adhocBody.billing_phone).toBe('9876543210');
    });

    it('3. Seller pickup phone "9876543210" or "+919876543210" sends correct pickup_phone in Shiprocket payload', async () => {
      let adhocBody = null;
      jest.spyOn(provider, 'request').mockImplementation((path, options) => {
        if (path.includes('/orders/create/adhoc')) {
          adhocBody = JSON.parse(options.body);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ order_id: 103, shipment_id: 204 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-PHONE-3',
        pickupAddress: { pickupLocationName: 'Kolkata Hub', phone: '9876543210' },
        deliveryAddress: { phone: '9812345678' },
      });

      expect(adhocBody).toBeDefined();
      expect(adhocBody.pickup_phone).toBe('9876543210');

      // Test with +91 in pickup phone
      await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-PHONE-3B',
        pickupAddress: { pickupLocationName: 'Kolkata Hub', phone: '+919876543210' },
        deliveryAddress: { phone: '9812345678' },
      });
      expect(adhocBody.pickup_phone).toBe('9876543210');
    });

    it('4. Multi-vendor shipment: Seller A uses pickup phone A, Seller B uses pickup phone B, with no global phone fallback', async () => {
      const capturedPayloads = [];
      jest.spyOn(provider, 'request').mockImplementation((path, options) => {
        if (path.includes('/orders/create/adhoc')) {
          capturedPayloads.push(JSON.parse(options.body));
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ order_id: 104, shipment_id: 205 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      // Shipment for Seller A
      await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        vendorOrderId: new mongoose.Types.ObjectId(),
        pickupAddress: { pickupLocationName: 'Seller A Hub', phone: '9811111111' },
        deliveryAddress: { phone: '9800000001' },
      });

      // Shipment for Seller B
      await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        vendorOrderId: new mongoose.Types.ObjectId(),
        pickupAddress: { pickupLocationName: 'Seller B Hub', phone: '9822222222' },
        deliveryAddress: { phone: '9800000001' },
      });

      expect(capturedPayloads.length).toBe(2);
      expect(capturedPayloads[0].pickup_location).toBe('Seller A Hub');
      expect(capturedPayloads[0].pickup_phone).toBe('9811111111');
      expect(capturedPayloads[1].pickup_location).toBe('Seller B Hub');
      expect(capturedPayloads[1].pickup_phone).toBe('9822222222');
      expect(capturedPayloads[0].pickup_phone).not.toBe(capturedPayloads[1].pickup_phone);
    });

    it('5. Invalid phone fails with a clear validation error before calling Shiprocket', async () => {
      const requestSpy = jest.spyOn(provider, 'request');

      // Invalid customer phone (short)
      await expect(
        provider.createShipment({
          orderId: new mongoose.Types.ObjectId(),
          pickupAddress: { pickupLocationName: 'Hub' },
          deliveryAddress: { phone: '12345' },
        })
      ).rejects.toThrow('Customer phone number must be a valid 10-digit Indian mobile number');

      // Invalid customer phone (all zeros / starting with 0)
      await expect(
        provider.createShipment({
          orderId: new mongoose.Types.ObjectId(),
          pickupAddress: { pickupLocationName: 'Hub' },
          deliveryAddress: { phone: '0000000000' },
        })
      ).rejects.toThrow('Customer phone number must be a valid 10-digit Indian mobile number');

      // Invalid seller pickup phone
      await expect(
        provider.createShipment({
          orderId: new mongoose.Types.ObjectId(),
          pickupAddress: { pickupLocationName: 'Hub', phone: 'invalid-seller-phone' },
          deliveryAddress: { phone: '9876543210' },
        })
      ).rejects.toThrow('Seller pickup phone number must be a valid 10-digit Indian mobile number');

      // Crucial: Ensure NO network request was made to Shiprocket
      expect(requestSpy).not.toHaveBeenCalled();
    });
  });

  describe('Shiprocket Shipment ID Extraction & Safe Error Handling', () => {
    it('extracts shipment_id from alternate valid paths (response.shipment_id, data.shipment_id, shipments array)', async () => {
      // 1. response.shipment_id
      jest.spyOn(provider, 'request').mockImplementation((path) => {
        if (path.includes('/orders/create/adhoc')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              response: {
                order_id: 112233,
                shipment_id: 445566,
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res1 = await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-SR-PATH-1',
        pickupAddress: { pickupLocationName: 'Hub 1' },
        deliveryAddress: { phone: '9876543210' },
      });
      expect(res1.providerShipmentId).toBe('445566');

      // 2. data.shipment_id
      jest.spyOn(provider, 'request').mockImplementation((path) => {
        if (path.includes('/orders/create/adhoc')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                order_id: 223344,
                shipment_id: 556677,
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res2 = await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-SR-PATH-2',
        pickupAddress: { pickupLocationName: 'Hub 2' },
        deliveryAddress: { phone: '9876543210' },
      });
      expect(res2.providerShipmentId).toBe('556677');

      // 3. shipments[0].shipment_id
      jest.spyOn(provider, 'request').mockImplementation((path) => {
        if (path.includes('/orders/create/adhoc')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              order_id: 334455,
              shipments: [{ shipment_id: 667788 }],
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res3 = await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-SR-PATH-3',
        pickupAddress: { pickupLocationName: 'Hub 3' },
        deliveryAddress: { phone: '9876543210' },
      });
      expect(res3.providerShipmentId).toBe('667788');
    });

    it('exposes actual safe error instead of SHIPROCKET_SHIPMENT_ID_MISSING when Shiprocket rejects with HTTP 200', async () => {
      jest.spyOn(provider, 'request').mockImplementation((path) => {
        if (path.includes('/orders/create/adhoc')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              status_code: 422,
              message: 'Invalid pickup location',
              errors: {
                pickup_location: ['The pickup location is not registered in Shiprocket panel'],
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      await expect(
        provider.createShipment({
          orderId: new mongoose.Types.ObjectId(),
          orderNumber: 'RUP-SR-ERR-1',
          pickupAddress: { pickupLocationName: 'Unregistered Hub' },
          deliveryAddress: { phone: '9876543210' },
        })
      ).rejects.toMatchObject({
        code: 'SHIPROCKET_ORDER_FAILED',
        statusCode: 422,
        message: expect.stringContaining('The pickup location is not registered in Shiprocket panel'),
      });
    });

    it('forwards registered pickup nickname unchanged in Shiprocket adhoc payload', async () => {
      let adhocPayload = null;
      jest.spyOn(provider, 'request').mockImplementation((path, options) => {
        if (path.includes('/orders/create/adhoc')) {
          adhocPayload = JSON.parse(options.body);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              order_id: 998811,
              shipment_id: 887711,
              status_code: 1,
            }),
          });
        }
        if (path.includes('/courier/assign/awb') || path.includes('/courier/generate/pickup') || path.includes('/couriers/generate/pickup') || path.includes('/courier/generate/label')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ awb_code: 'SR-TEST-AWB' }),
          });
        }
        return Promise.reject(new Error(`Unhandled path ${path}`));
      });

      const registeredNickname = 'Bengal Artisan Warehouse #4 - Salt Lake';
      const result = await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-SR-NICK-1',
        pickupAddress: {
          pickupLocationName: registeredNickname,
          city: 'Kolkata',
          postalCode: '700091',
        },
        deliveryAddress: { phone: '9876543210' },
      });

      expect(adhocPayload).toBeDefined();
      expect(adhocPayload.pickup_location).toBe(registeredNickname);
      expect(result.providerShipmentId).toBe('887711');
    });

    it('provides clear actionable error when Shiprocket returns "Wrong Pickup location entered"', async () => {
      jest.spyOn(provider, 'request').mockImplementation((path) => {
        if (path.includes('/orders/create/adhoc')) {
          return Promise.resolve({
            ok: false,
            status: 422,
            json: async () => ({
              message: 'Wrong Pickup location entered. Please choose one location from the data given',
              status_code: 422,
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      await expect(
        provider.createShipment({
          orderId: new mongoose.Types.ObjectId(),
          orderNumber: 'RUP-SR-WRONG-LOC',
          pickupAddress: { pickupLocationName: 'Dhokra Crafts Warehouse' },
          deliveryAddress: { phone: '9876543210' },
        })
      ).rejects.toMatchObject({
        code: 'SHIPROCKET_ORDER_FAILED',
        statusCode: 422,
        message: expect.stringMatching(/Pickup location "Dhokra Crafts Warehouse" is not registered in Shiprocket: Wrong Pickup location entered.*Please ensure the pickup location nickname in Settings matches a registered pickup address nickname in your Shiprocket panel/i),
      });
    });

    it('in production mode, rejects with PICKUP_LOCATION_REQUIRED without falling back to raw city name', async () => {
      const prodProvider = new ShiprocketProvider({
        email: testEmail,
        password: testPassword,
        apiUrl: testApiUrl,
        mode: 'production',
      });

      await expect(
        prodProvider.createShipment({
          orderId: new mongoose.Types.ObjectId(),
          orderNumber: 'RUP-SR-PROD-NOPICKUP',
          pickupAddress: { pickupLocationName: '', city: 'Kolkata' },
          deliveryAddress: { phone: '9876543210' },
        })
      ).rejects.toMatchObject({
        code: 'PICKUP_LOCATION_REQUIRED',
        statusCode: 400,
        message: expect.stringContaining('Vendor pickup location nickname is required'),
      });
    });

    it('exposes field-level error messages and redacts PII like phone numbers and tokens', async () => {
      jest.spyOn(provider, 'request').mockImplementation((path) => {
        if (path.includes('/orders/create/adhoc')) {
          return Promise.resolve({
            ok: false,
            status: 422,
            json: async () => ({
              message: 'The given data was invalid.',
              errors: {
                billing_phone: ['Phone 9876543210 cannot be serviced with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_token_long_secret_signature'],
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      try {
        await provider.createShipment({
          orderId: new mongoose.Types.ObjectId(),
          orderNumber: 'RUP-SR-PII-1',
          pickupAddress: { pickupLocationName: 'Hub' },
          deliveryAddress: { phone: '9876543210' },
        });
        expect(true).toBe(false);
      } catch (err) {
        expect(err.code).toBe('SHIPROCKET_ORDER_FAILED');
        expect(err.message).toContain('[REDACTED_PHONE]');
        expect(err.message).toContain('[REDACTED_TOKEN]');
        expect(err.message).not.toContain('9876543210');
        expect(err.message).not.toContain('dummy_token_long_secret_signature');
      }
    });

    it('recovers existing shipment ID on duplicate order without creating a duplicate Shiprocket order', async () => {
      let adhocCallCount = 0;
      jest.spyOn(provider, 'request').mockImplementation((path) => {
        if (path.includes('/orders/create/adhoc')) {
          adhocCallCount++;
          return Promise.resolve({
            ok: false,
            status: 422,
            json: async () => ({
              message: 'The order_id has already been taken.',
              errors: { order_id: ['The order_id has already been taken.'] },
            }),
          });
        }
        if (path.includes('/orders?channel_order_id=')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 999111,
                  order_id: 999111,
                  channel_order_id: 'RUP-DUP-1',
                  shipment_id: 888222,
                },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res = await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP-DUP-1',
        pickupAddress: { pickupLocationName: 'Hub' },
        deliveryAddress: { phone: '9876543210' },
      });

      expect(adhocCallCount).toBe(1);
      expect(res.providerShipmentId).toBe('888222');
      expect(res.metadata.shiprocketOrderId).toBe(999111);
    });
  });

  describe('Automatic Shiprocket Pickup-Location Registration', () => {
    it('reuses existing Shiprocket pickup location when nickname matches and does not create duplicate', async () => {
      let addPickupCalled = false;
      jest.spyOn(provider, 'request').mockImplementation((path) => {
        if (path.includes('/settings/company/pickup')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                shipping_address: [
                  {
                    id: 501,
                    pickup_location: 'Kolkata Central Hub',
                    phone: '9876543210',
                    address: '10 College Street',
                    city: 'Kolkata',
                    state: 'West Bengal',
                    pin_code: '700073',
                  },
                ],
              },
            }),
          });
        }
        if (path.includes('/settings/company/addpickup')) {
          addPickupCalled = true;
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res = await provider.registerPickupLocation({
        pickupLocationName: 'Kolkata Central Hub',
        phone: '9876543210',
        city: 'Kolkata',
      });

      expect(res.success).toBe(true);
      expect(res.reused).toBe(true);
      expect(res.pickupLocation).toBe('Kolkata Central Hub');
      expect(res.pickupId).toBe('501');
      expect(addPickupCalled).toBe(false);
    });

    it('automatically creates a new pickup location in Shiprocket when nickname does not exist', async () => {
      let addPayload = null;
      jest.spyOn(provider, 'request').mockImplementation((path, options = {}) => {
        if (path.includes('/settings/company/pickup')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                shipping_address: [
                  { id: 501, pickup_location: 'Existing Hub' },
                ],
              },
            }),
          });
        }
        if (path.includes('/settings/company/addpickup')) {
          addPayload = JSON.parse(options.body);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              pickup_id: 602,
              message: 'Pickup address added successfully',
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res = await provider.registerPickupLocation({
        pickupLocationName: 'Bankura Terracotta Workshop',
        contactPerson: 'Biren Das',
        phone: '+91 98765 43210',
        addressLine1: 'Station Road',
        city: 'Bankura',
        state: 'West Bengal',
        pincode: '722101',
        email: 'artisan@rupakar.in',
      });

      expect(res.success).toBe(true);
      expect(res.reused).toBe(false);
      expect(res.pickupLocation).toBe('Bankura Terracotta Workshop');
      expect(res.pickupId).toBe('602');
      expect(addPayload).toEqual(expect.objectContaining({
        pickup_location: 'Bankura Terracotta Workshop',
        name: 'Biren Das',
        phone: '9876543210',
        address: 'Station Road',
        city: 'Bankura',
        state: 'West Bengal',
        pin_code: '722101',
      }));
    });

    it('stores verified registration status, pickup ID, and timestamp on vendor record upon pickup address update', async () => {
      const vendorUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId();

      const mockVendor = {
        _id: vendorId,
        ownerUserId: vendorUserId,
        email: 'seller@rupakar.in',
        status: 'APPROVED',
        pickupAddress: null,
        save: jest.fn().mockResolvedValue(true),
        toObject() { return { ...this }; },
      };

      jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);

      jest.spyOn(ShiprocketProvider.prototype, 'registerPickupLocation').mockResolvedValue({
        success: true,
        reused: false,
        pickupLocation: 'Shantiniketan Leather Studio',
        pickupId: '703',
      });

      const updated = await vendorService.updatePickupAddress(vendorUserId, {
        pickupLocationName: 'Shantiniketan Leather Studio',
        contactPerson: 'Kanai Mondal',
        phone: '9876543210',
        addressLine1: 'Ratan Pally',
        city: 'Bolpur',
        state: 'West Bengal',
        pincode: '731204',
      });

      expect(mockVendor.save).toHaveBeenCalled();
      expect(mockVendor.pickupAddress).toEqual(expect.objectContaining({
        pickupLocationName: 'Shantiniketan Leather Studio',
        shiprocketPickupId: '703',
        registrationStatus: 'REGISTERED',
        registrationError: null,
      }));
      expect(mockVendor.pickupAddress.registeredAt).toBeInstanceOf(Date);
      expect(updated.pickupAddress.registrationStatus).toBe('REGISTERED');
    });

    it('marks registrationStatus as FAILED and retains error message without marking registered if Shiprocket rejects creation', async () => {
      const vendorUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId();

      const mockVendor = {
        _id: vendorId,
        ownerUserId: vendorUserId,
        email: 'seller@rupakar.in',
        status: 'APPROVED',
        pickupAddress: null,
        save: jest.fn().mockResolvedValue(true),
        toObject() { return { ...this }; },
      };

      jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);

      jest.spyOn(ShiprocketProvider.prototype, 'registerPickupLocation').mockRejectedValue(
        new Error('Failed to register pickup location "Bad Pin Hub" with Shiprocket: Invalid pin code for state West Bengal')
      );

      await expect(
        vendorService.updatePickupAddress(vendorUserId, {
          pickupLocationName: 'Bad Pin Hub',
          contactPerson: 'Seller',
          phone: '9876543210',
          addressLine1: 'Road 1',
          city: 'Kolkata',
          state: 'West Bengal',
          pincode: '999999',
        })
      ).rejects.toThrow('Failed to register pickup location "Bad Pin Hub" with Shiprocket');

      expect(mockVendor.save).toHaveBeenCalled();
      expect(mockVendor.pickupAddress).toEqual(expect.objectContaining({
        pickupLocationName: 'Bad Pin Hub',
        shiprocketPickupId: null,
        registrationStatus: 'FAILED',
        registeredAt: null,
        registrationError: expect.stringContaining('Invalid pin code for state West Bengal'),
      }));
    });

    it('re-fetches and recovers existing location without creating duplicates when Shiprocket rejects creation with duplicate error', async () => {
      let getCallCount = 0;
      let addCallCount = 0;

      jest.spyOn(provider, 'request').mockImplementation((path) => {
        if (path.includes('/settings/company/pickup')) {
          getCallCount++;
          if (getCallCount === 1) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: { shipping_address: [] } }),
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                shipping_address: [
                  {
                    id: 999,
                    pickup_location: 'Handloom Depot Phulia',
                    phone: '9876543210',
                  },
                ],
              },
            }),
          });
        }
        if (path.includes('/settings/company/addpickup')) {
          addCallCount++;
          return Promise.resolve({
            ok: false,
            status: 422,
            json: async () => ({
              message: 'The pickup_location has already been taken.',
              errors: { pickup_location: ['The pickup_location has already been taken.'] },
            }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      });

      const res = await provider.registerPickupLocation({
        pickupLocationName: 'Handloom Depot Phulia',
        contactPerson: 'Weaver Ghosh',
        phone: '9876543210',
        addressLine1: 'Weavers Lane',
        city: 'Phulia',
        state: 'West Bengal',
        pincode: '741402',
      });

      expect(addCallCount).toBe(1);
      expect(getCallCount).toBe(2);
      expect(res.success).toBe(true);
      expect(res.reused).toBe(true);
      expect(res.pickupLocation).toBe('Handloom Depot Phulia');
      expect(res.pickupId).toBe('999');
    });

    it('isolates pickup locations so Seller A cannot use Seller B\'s registered pickup location or dispatch Seller B\'s order', async () => {
      const userA = new mongoose.Types.ObjectId().toHexString();
      const userB = new mongoose.Types.ObjectId().toHexString();
      const vendorA = new mongoose.Types.ObjectId();
      const vendorB = new mongoose.Types.ObjectId();
      const voB = new mongoose.Types.ObjectId();

      jest.spyOn(Vendor, 'findOne').mockImplementation(({ ownerUserId }) => {
        if (ownerUserId === userA) {
          return Promise.resolve({
            _id: vendorA,
            ownerUserId: userA,
            status: 'APPROVED',
            pickupAddress: {
              pickupLocationName: 'Location A',
              registrationStatus: 'REGISTERED',
            },
          });
        }
        if (ownerUserId === userB) {
          return Promise.resolve({
            _id: vendorB,
            ownerUserId: userB,
            status: 'APPROVED',
            pickupAddress: {
              pickupLocationName: 'Location B',
              registrationStatus: 'REGISTERED',
            },
          });
        }
        return Promise.resolve(null);
      });

      jest.spyOn(VendorOrder, 'findOne').mockImplementation(({ _id, vendorId }) => {
        if (String(_id) === String(voB) && String(vendorId) === String(vendorB)) {
          return Promise.resolve({
            _id: voB,
            vendorId: vendorB,
            status: 'PACKED',
          });
        }
        return Promise.resolve(null);
      });

      const res = mockResponse();
      await expect(
        readyVendorOrder(
          { params: { id: String(voB) }, user: { sub: userA }, body: {}, headers: {} },
          res,
          (err) => { if (err) throw err; }
        )
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'VENDOR_ORDER_NOT_FOUND',
      });
    });

    it('rejects Ready-to-Ship with PICKUP_LOCATION_NOT_REGISTERED if seller pickup location registrationStatus is PENDING or FAILED', async () => {
      const vendorUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId();
      const voId = new mongoose.Types.ObjectId();
      const parentOrderId = new mongoose.Types.ObjectId();

      const mockVendor = {
        _id: vendorId,
        ownerUserId: vendorUserId,
        status: 'APPROVED',
        pickupAddress: {
          pickupLocationName: 'Unverified Hub',
          registrationStatus: 'PENDING',
          contactPerson: 'Vendor 1',
          phone: '9876543210',
          addressLine1: 'Road 1',
          city: 'Kolkata',
          state: 'WB',
          pincode: '700001',
        },
      };

      jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({
        _id: voId,
        vendorId,
        parentOrderId,
        status: 'PACKED',
      });
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
      jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
      jest.spyOn(Order, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: parentOrderId, paymentStatus: 'PAID' }),
      });

      const adhocSpy = jest.spyOn(provider, 'request');

      const res = mockResponse();
      await expect(
        readyVendorOrder(
          { params: { id: String(voId) }, user: { sub: vendorUserId }, body: {}, headers: {} },
          res,
          (err) => { if (err) throw err; }
        )
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'PICKUP_LOCATION_NOT_REGISTERED',
      });

      expect(adhocSpy).not.toHaveBeenCalledWith(expect.stringContaining('/orders/create/adhoc'), expect.anything());

      mockVendor.pickupAddress.registrationStatus = 'FAILED';
      mockVendor.pickupAddress.registrationError = 'Pin code serviceability failed';

      await expect(
        readyVendorOrder(
          { params: { id: String(voId) }, user: { sub: vendorUserId }, body: {}, headers: {} },
          res,
          (err) => { if (err) throw err; }
        )
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'PICKUP_LOCATION_NOT_REGISTERED',
      });
    });

    it('Ready-to-Ship uses verified registered pickup location and sends exact nickname to Shiprocket adhoc payload', async () => {
      const vendorUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId();
      const voId = new mongoose.Types.ObjectId();
      const parentOrderId = new mongoose.Types.ObjectId();

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({
        _id: vendorId,
        ownerUserId: vendorUserId,
        status: 'APPROVED',
        pickupAddress: {
          pickupLocationName: 'Dokra Hub Bikna',
          shiprocketPickupId: '88812',
          registrationStatus: 'REGISTERED',
          contactPerson: 'Subhash Karmakar',
          phone: '9876543210',
          addressLine1: 'Bikna Artisan Cluster',
          city: 'Bankura',
          state: 'West Bengal',
          pincode: '722155',
        },
      });

      const vo = {
        _id: voId,
        vendorId,
        parentOrderId,
        status: 'PACKED',
        inventoryDecremented: true,
        items: [{ variantId: new mongoose.Types.ObjectId(), quantity: 1, unitPrice: 1200 }],
        save: jest.fn().mockResolvedValue(true),
      };
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
      jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
      jest.spyOn(Order, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: parentOrderId,
          orderNumber: 'RUP-SR-REG-101',
          paymentStatus: 'PAID',
          customerId: new mongoose.Types.ObjectId(),
          shippingAddressSnapshot: {
            fullName: 'Rituparna Sengupta',
            phone: '9876543210',
            addressLine1: 'Salt Lake Sector 1',
            city: 'Kolkata',
            state: 'West Bengal',
            postalCode: '700064',
          },
        }),
      });

      const { shippingService } = await import('../app/services/shipping.service.js');
      const createShipmentSpy = jest.spyOn(shippingService, 'createShipment').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        shipmentNumber: 'SHIP-SR-REG-1',
        trackingNumber: 'AWB-REG-101',
        providerShipmentId: 'SR-SHP-999',
        carrier: 'Shiprocket Surface',
        shippingMethod: 'surface',
        shippingCost: 65,
        estimatedDeliveryAt: new Date(),
        trackingUrl: 'https://shiprocket.co/track/AWB-REG-101',
        labelUrl: '/api/v1/vendors/orders/lab-1/label',
        provider: 'shiprocket',
        status: 'READY_TO_SHIP',
        metadata: {},
        save: jest.fn().mockResolvedValue(true),
        toObject() { return { ...this }; },
      });

      jest.spyOn(Shipment, 'create').mockImplementation((doc) => {
        const item = Array.isArray(doc) ? doc[0] : doc;
        return Promise.resolve({
          ...item,
          _id: new mongoose.Types.ObjectId(),
          status: 'PENDING',
          save: jest.fn().mockResolvedValue(true),
          toObject() { return { ...this }; },
        });
      });
      jest.spyOn(ShipmentTrackingEvent, 'create').mockResolvedValue({});

      const res = mockResponse();
      await readyVendorOrder(
        { params: { id: String(voId) }, user: { sub: vendorUserId }, body: { weight: 0.8, length: 15, width: 10, height: 5 }, headers: {} },
        res,
        (err) => { if (err) throw err; }
      );

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          shipment: expect.objectContaining({ trackingNumber: 'AWB-REG-101' }),
        }),
      }));

      expect(createShipmentSpy).toHaveBeenCalledWith(expect.objectContaining({
        pickupAddress: expect.objectContaining({
          pickupLocationName: 'Dokra Hub Bikna',
          registrationStatus: 'REGISTERED',
        }),
      }));
    });
  });
});
