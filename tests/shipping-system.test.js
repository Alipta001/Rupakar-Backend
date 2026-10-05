import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import crypto from 'node:crypto';
import { ShippingService } from '../app/services/shipping.service.js';
import { DeliveryProvider, MockDeliveryProvider, deliveryProvider } from '../app/services/delivery-provider.service.js';
import { ShipmentStateService } from '../app/services/shipment-state.service.js';
import { Shipment } from '../app/models/shipment.model.js';
import { Order } from '../app/models/order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { ShipmentTrackingEvent } from '../app/models/shipment-tracking-event.model.js';
import { User } from '../app/models/user.model.js';
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
  packVendorOrder,
  downloadVendorShippingLabel,
  deliveryWebhook,
} = await import('../app/controllers/shipping.controller.js');
import { pdfService } from '../app/services/pdf.service.js';
import { env } from '../app/config/env.js';
import { settlementService } from '../app/services/settlement.service.js';
import { orderService } from '../app/services/order.service.js';

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

describe('Comprehensive Production Shipping System', () => {
  const vendorUserId1 = new mongoose.Types.ObjectId().toHexString();
  const vendorUserId2 = new mongoose.Types.ObjectId().toHexString();
  const vendorId1 = new mongoose.Types.ObjectId();
  const vendorId2 = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const parentOrderId = new mongoose.Types.ObjectId();
  const vendorOrderId1 = new mongoose.Types.ObjectId();
  const vendorOrderId2 = new mongoose.Types.ObjectId();
  const variantId1 = new mongoose.Types.ObjectId();
  const variantId2 = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);
    jest.spyOn(settlementService, 'handleVendorOrderDelivered').mockResolvedValue(true);
  });

  describe('1. Shipping Rates & Automatic Carrier Selection', () => {
    it('calculates customer checkout shipping cost respecting thresholds and WB discount', () => {
      const shippingService = new ShippingService();
      const origEnabled = env.SHIPPING_ENABLED;
      env.SHIPPING_ENABLED = true;

      try {
        // Standard outside WB
        const rate1 = shippingService.calculateShipping({
          subtotal: 500,
          items: [{ id: '1' }, { id: '2' }],
          shippingAddress: { state: 'Maharashtra', postalCode: '400001' },
        });
        expect(rate1.amount).toBe(env.SHIPPING_BASE_FEE);

        // Free shipping threshold
        const rateFree = shippingService.calculateShipping({
          subtotal: env.FREE_SHIPPING_THRESHOLD + 100,
          items: [{ id: '1' }],
          shippingAddress: { state: 'Delhi', postalCode: '110001' },
        });
        expect(rateFree.amount).toBe(0);

        // West Bengal discount
        const rateWB = shippingService.calculateShipping({
          subtotal: 500,
          items: [{ id: '1' }],
          shippingAddress: { state: 'West Bengal', postalCode: '700001' },
        });
        expect(rateWB.amount).toBe(Math.max(0, env.SHIPPING_BASE_FEE - env.WEST_BENGAL_SHIPPING_DISCOUNT));
      } finally {
        env.SHIPPING_ENABLED = origEnabled;
      }
    });

    it('checks serviceability and auto-selects best shipping option from provider rates', async () => {
      const mockProvider = new MockDeliveryProvider();
      const serviceability = await mockProvider.checkServiceability({
        pickupPincode: '700001',
        deliveryPincode: '110001',
      });
      expect(serviceability.serviceable).toBe(true);
      expect(serviceability.provider).toBe('mock');

      const shippingService = new ShippingService();
      const best = await shippingService.determineBestShippingOption({
        pickupAddress: { postalCode: '700001' },
        deliveryAddress: { postalCode: '110001' },
        packageInfo: { weight: 1.2, length: 20, width: 15, height: 10 },
      });

      expect(best).toHaveProperty('carrier');
      expect(best).toHaveProperty('serviceCode');
      expect(best.cost).toBeGreaterThan(0);
    });
  });

  describe('2. Package Information & Validation', () => {
    it('rejects ready-to-ship when weight <= 0 or exceeds 100kg', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId1, ownerUserId: vendorUserId1, status: 'APPROVED' });
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({
        _id: vendorOrderId1,
        vendorId: vendorId1,
        parentOrderId,
        status: 'PACKED',
      });
      jest.spyOn(Order, 'findById').mockResolvedValue({
        _id: parentOrderId,
        paymentStatus: 'PAID',
        shippingAddress: { postalCode: '700001' },
      });

      const res = mockResponse();
      // Zero weight
      await expect(
        readyVendorOrder({
          params: { id: vendorOrderId1.toHexString() },
          user: { sub: vendorUserId1 },
          body: { weight: 0, length: 10, width: 10, height: 10 },
          headers: {},
        }, res, (err) => { throw err; })
      ).rejects.toThrow();

      // Negative weight
      await expect(
        readyVendorOrder({
          params: { id: vendorOrderId1.toHexString() },
          user: { sub: vendorUserId1 },
          body: { weight: -5, length: 10, width: 10, height: 10 },
          headers: {},
        }, res, (err) => { throw err; })
      ).rejects.toThrow();

      // Weight > 100 kg
      await expect(
        readyVendorOrder({
          params: { id: vendorOrderId1.toHexString() },
          user: { sub: vendorUserId1 },
          body: { weight: 150, length: 10, width: 10, height: 10 },
          headers: {},
        }, res, (err) => { throw err; })
      ).rejects.toThrow();
    });

    it('rejects ready-to-ship when dimensions are <= 0 or exceed 300cm', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId1, ownerUserId: vendorUserId1, status: 'APPROVED' });
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({
        _id: vendorOrderId1,
        vendorId: vendorId1,
        parentOrderId,
        status: 'PACKED',
      });
      jest.spyOn(Order, 'findById').mockResolvedValue({
        _id: parentOrderId,
        paymentStatus: 'PAID',
        shippingAddress: { postalCode: '700001' },
      });

      const res = mockResponse();
      // Invalid length 0
      await expect(
        readyVendorOrder({
          params: { id: vendorOrderId1.toHexString() },
          user: { sub: vendorUserId1 },
          body: { weight: 1.5, length: 0, width: 10, height: 10 },
          headers: {},
        }, res, (err) => { throw err; })
      ).rejects.toThrow();

      // Excessive width > 300
      await expect(
        readyVendorOrder({
          params: { id: vendorOrderId1.toHexString() },
          user: { sub: vendorUserId1 },
          body: { weight: 1.5, length: 20, width: 350, height: 10 },
          headers: {},
        }, res, (err) => { throw err; })
      ).rejects.toThrow();
    });
  });

  describe('3. Shipment Creation, AWB, Label, and Pickup Flow', () => {
    it('creates shipment, assigns AWB, schedules pickup and transitions to READY_TO_SHIP', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({
        _id: vendorId1,
        ownerUserId: vendorUserId1,
        status: 'APPROVED',
        pickupAddress: { street: 'Artisan Hub 1', city: 'Kolkata', postalCode: '700001' },
      });

      const vo = {
        _id: vendorOrderId1,
        vendorId: vendorId1,
        parentOrderId,
        status: 'PACKED',
        inventoryDecremented: true,
        items: [{ variantId: variantId1, quantity: 1 }],
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ _id: vendorOrderId1, status: 'READY_TO_SHIP' }),
      };
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);

      const shipmentDoc = {
        _id: new mongoose.Types.ObjectId(),
        orderId: parentOrderId,
        vendorOrderId: vendorOrderId1,
        vendorId: vendorId1,
        customerId,
        shipmentNumber: 'SHIP-TEST-1',
        status: 'PACKED',
        pickupStatus: 'PENDING',
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({
          _id: 'ship-1',
          trackingNumber: 'TRK-TEST-1',
          status: 'READY_TO_SHIP',
          carrier: 'Rupakar Express Logistics',
          pickupStatus: 'REQUESTED',
        }),
      };
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(shipmentDoc);
      const mockOrderQuery = {
        _id: parentOrderId,
        paymentStatus: 'PAID',
        shippingAddress: { street: 'Customer Road', city: 'Mumbai', postalCode: '400001' },
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: parentOrderId,
          status: 'PROCESSING',
          paymentStatus: 'PAID',
          shippingAddress: { street: 'Customer Road', city: 'Mumbai', postalCode: '400001' },
        }),
      };
      jest.spyOn(Order, 'findById').mockReturnValue(mockOrderQuery);
      jest.spyOn(VendorOrder, 'findOneAndUpdate').mockResolvedValue(vo);
      jest.spyOn(VendorOrder, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue(vo),
      });
      jest.spyOn(VendorOrder, 'find').mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ status: 'READY_TO_SHIP' }]),
        }),
      });
      jest.spyOn(Order, 'updateOne').mockResolvedValue(true);
      jest.spyOn(Order, 'findOneAndUpdate').mockResolvedValue(true);
      jest.spyOn(ShipmentTrackingEvent, 'create').mockResolvedValue(true);

      const res = mockResponse();
      await readyVendorOrder({
        params: { id: vendorOrderId1.toHexString() },
        user: { sub: vendorUserId1 },
        body: { weight: 1.5, length: 25, width: 18, height: 12 },
        headers: {},
      }, res, (err) => { throw err; });

      expect(shipmentDoc.status).toBe('READY_TO_SHIP');
      expect(shipmentDoc.save).toHaveBeenCalled();
      expect(vo.status).toBe('READY_TO_SHIP');
      expect(vo.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Order ready to ship',
      }));
    });

    it('prevents duplicate shipment creation on repeated Ready to Ship clicks (idempotency)', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId1, ownerUserId: vendorUserId1, status: 'APPROVED' });
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({
        _id: vendorOrderId1,
        vendorId: vendorId1,
        parentOrderId,
        status: 'READY_TO_SHIP', // Already ready to ship
        toObject: () => ({ _id: vendorOrderId1, status: 'READY_TO_SHIP' }),
      });
      jest.spyOn(Shipment, 'findOne').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        status: 'READY_TO_SHIP',
        trackingNumber: 'TRK-ALREADY-ASSIGNED',
        toObject: () => ({ status: 'READY_TO_SHIP', trackingNumber: 'TRK-ALREADY-ASSIGNED' }),
      });
      jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: parentOrderId }) });

      const res = mockResponse();
      await readyVendorOrder({
        params: { id: vendorOrderId1.toHexString() },
        user: { sub: vendorUserId1 },
        body: { weight: 1.0, length: 15, width: 10, height: 5 },
        headers: {},
      }, res, (err) => { throw err; });

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ isIdempotent: true }),
      }));
    });
  });

  describe('4. Multi-Vendor Order Independent Shipments', () => {
    it('creates 2 distinct shipments with independent tracking and pickup for 2 vendors', async () => {
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
      jest.spyOn(Shipment, 'create').mockImplementation(async (data) => ({
        ...data,
        _id: new mongoose.Types.ObjectId(),
        toObject: () => ({ ...data }),
      }));

      const shippingService = new ShippingService();

      const shipment1 = await shippingService.createShipment({
        orderId: parentOrderId,
        orderNumber: 'RUP-MULTI-1',
        vendorOrderId: vendorOrderId1,
        vendorId: vendorId1,
        customerId,
        pickupAddress: { street: 'Kolkata Studio', postalCode: '700001' },
        deliveryAddress: { street: 'Buyer Home', postalCode: '560001' },
        packageInfo: { weight: 0.8, length: 20, width: 15, height: 8 },
      });

      const shipment2 = await shippingService.createShipment({
        orderId: parentOrderId,
        orderNumber: 'RUP-MULTI-1',
        vendorOrderId: vendorOrderId2,
        vendorId: vendorId2,
        customerId,
        pickupAddress: { street: 'Shantiniketan Workshop', postalCode: '731204' },
        deliveryAddress: { street: 'Buyer Home', postalCode: '560001' },
        packageInfo: { weight: 2.5, length: 40, width: 30, height: 20 },
      });

      expect(shipment1.vendorOrderId).not.toEqual(shipment2.vendorOrderId);
      expect(shipment1.shipmentNumber).not.toEqual(shipment2.shipmentNumber);
      expect(shipment1.trackingNumber).not.toEqual(shipment2.trackingNumber);
      expect(shipment1.packageInfo.weight).toBe(0.8);
      expect(shipment2.packageInfo.weight).toBe(2.5);
    });
  });

  describe('5. Seller Authorization & Shipping Label Access', () => {
    it('allows seller to download shipping label for their own order', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId1, ownerUserId: vendorUserId1, status: 'APPROVED' });
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({
        _id: vendorOrderId1,
        vendorId: vendorId1,
        parentOrderId,
      });
      jest.spyOn(Shipment, 'findOne').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        vendorOrderId: vendorOrderId1,
        trackingNumber: 'TRK-LABEL-1',
        shipmentNumber: 'SHIP-LABEL-1',
        carrier: 'Rupakar Express',
      });
      jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: parentOrderId, total: 1200 }) });
      jest.spyOn(pdfService, 'generateShippingLabelPdf').mockResolvedValue({
        content: Buffer.from('%PDF-1.4 dummy label'),
        contentType: 'application/pdf',
        filename: 'shipping-label-TRK-LABEL-1.pdf',
      });

      const res = mockResponse();
      await downloadVendorShippingLabel({
        params: { orderId: vendorOrderId1.toHexString() },
        user: { sub: vendorUserId1 },
        headers: {},
      }, res, (err) => { throw err; });

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.send).toHaveBeenCalled();
    });

    it('forbids seller from accessing another seller shipping label', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId2, ownerUserId: vendorUserId2, status: 'APPROVED' });
      // VendorOrder belongs to vendorId1, but requester is vendorId2
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);

      const res = mockResponse();
      await expect(
        downloadVendorShippingLabel({
          params: { orderId: vendorOrderId1.toHexString() },
          user: { sub: vendorUserId2 },
          headers: {},
        }, res, (err) => { throw err; })
      ).rejects.toThrow('Vendor order not found');
    });
  });

  describe('6. Delivery Webhook & Status Lifecycle', () => {
    const trackingNumber = 'TRK-WEBHOOK-99';

    it('rejects webhooks with invalid HMAC signature', async () => {
      const payload = { trackingNumber, status: 'shipped' };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const req = {
        body: payload,
        get: (header) => header === 'x-delivery-signature' ? 'invalid_hmac_signature' : null,
      };
      const res = mockResponse();

      await expect(
        deliveryWebhook(req, res, (err) => { throw err; })
      ).rejects.toThrow('Invalid delivery webhook signature');
    });

    it('processes valid webhook, records tracking event, and updates shipment to DELIVERED', async () => {
      const payload = {
        trackingNumber,
        status: 'delivered',
        eventId: 'EVT-DEL-01',
        location: 'Kolkata Delivery Hub',
        timestamp: new Date().toISOString(),
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const validSignature = crypto.createHmac('sha256', env.DELIVERY_WEBHOOK_SECRET).update(rawBody).digest('hex');

      const shipmentDoc = {
        _id: new mongoose.Types.ObjectId(),
        orderId: parentOrderId,
        vendorOrderId: vendorOrderId1,
        vendorId: vendorId1,
        customerId,
        trackingNumber,
        status: 'OUT_FOR_DELIVERY',
        provider: 'mock',
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
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ orderNumber: 'RUP-100' }) }),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ ownerUserId: vendorUserId1 }) }),
      });
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ email: 'vendor@example.com' }) }),
      });

      const req = {
        body: rawBody,
        get: (header) => header === 'x-delivery-signature' ? validSignature : null,
      };
      const res = mockResponse();

      await deliveryWebhook(req, res, (err) => { throw err; });

      expect(shipmentDoc.status).toBe('DELIVERED');
      expect(shipmentDoc.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, duplicate: false });
    });

    it('safely handles duplicate webhook events idempotently', async () => {
      const payload = {
        trackingNumber,
        status: 'delivered',
        eventId: 'EVT-DUP-01',
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const validSignature = crypto.createHmac('sha256', env.DELIVERY_WEBHOOK_SECRET).update(rawBody).digest('hex');

      jest.spyOn(Shipment, 'findOne').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        trackingNumber,
        status: 'DELIVERED',
        provider: 'mock',
      });
      const dupError = new Error('Duplicate key');
      dupError.code = 11000;
      jest.spyOn(ShipmentTrackingEvent, 'create').mockRejectedValue(dupError);

      const req = {
        body: rawBody,
        get: (header) => header === 'x-delivery-signature' ? validSignature : null,
      };
      const res = mockResponse();

      await deliveryWebhook(req, res, (err) => { throw err; });

      expect(res.json).toHaveBeenCalledWith({ success: true, duplicate: true });
    });
  });
});
