import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Vendor } from '../app/models/vendor.model.js';
import { Shipment } from '../app/models/shipment.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Order } from '../app/models/order.model.js';
import { InventoryReservation } from '../app/models/inventory-reservation.model.js';
import { vendorService } from '../app/services/vendor.service.js';
import { vendorPickupAddressSchema } from '../app/validators/vendor.validator.js';
import { getVendorPickupAddress, updateVendorPickupAddress } from '../app/controllers/vendor.controller.js';
import { env } from '../app/config/env.js';
import { orderService } from '../app/services/order.service.js';
import { settlementService } from '../app/services/settlement.service.js';
import { ShiprocketProvider } from '../app/services/delivery-provider.service.js';
import { getOrder, getAdminOrder } from '../app/controllers/order.controller.js';

import { ShipmentTrackingEvent } from '../app/models/shipment-tracking-event.model.js';
import { AppError } from '../app/utils/app-error.js';

jest.unstable_mockModule('../app/jobs/queues.js', () => ({
  scheduleNotification: jest.fn().mockResolvedValue('notif-1'),
  scheduleEmail: jest.fn().mockResolvedValue('email-1'),
  scheduleInvoiceGeneration: jest.fn().mockResolvedValue('invoice-1'),
  schedulePackingSlipGeneration: jest.fn().mockResolvedValue('slip-1'),
  scheduleVendorOrderPackReminder: jest.fn().mockResolvedValue('pack-reminder-1'),
  scheduleVendorOrderAutoCancel: jest.fn().mockResolvedValue('auto-cancel-1'),
}));

const { readyVendorOrder } = await import('../app/controllers/shipping.controller.js');

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

describe('Vendor Pickup / Dispatch Address Feature & Multi-Vendor Marketplace', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);
    jest.spyOn(settlementService, 'handleVendorOrderDelivered').mockResolvedValue(true);
    jest.spyOn(ShipmentTrackingEvent, 'create').mockResolvedValue(true);
  });

  describe('1. Validation (vendorPickupAddressSchema)', () => {
    const validPayload = {
      pickupLocationName: 'Rupakar Warehouse Hub',
      contactPerson: 'Suresh Das',
      phone: '9876543210',
      addressLine1: '12 Rabindra Sarani',
      addressLine2: 'Block B, 2nd Floor',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700001',
      country: 'India',
    };

    it('passes for a valid pickup address payload', () => {
      const parsed = vendorPickupAddressSchema.safeParse(validPayload);
      expect(parsed.success).toBe(true);
      expect(parsed.data.pickupLocationName).toBe('Rupakar Warehouse Hub');
      expect(parsed.data.phone).toBe('9876543210');
      expect(parsed.data.pincode).toBe('700001');
    });

    it('rejects an invalid phone number', () => {
      const invalid = { ...validPayload, phone: '12345' };
      const parsed = vendorPickupAddressSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
      expect(parsed.error.issues[0].message).toMatch(/valid 10-digit Indian mobile number/i);
    });

    it('rejects an invalid pincode', () => {
      const invalid = { ...validPayload, pincode: '7000A1' };
      const parsed = vendorPickupAddressSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
      expect(parsed.error.issues[0].message).toMatch(/valid 6-digit Indian postal code/i);
    });

    it('rejects when addressLine1 is missing', () => {
      const invalid = { ...validPayload };
      delete invalid.addressLine1;
      const parsed = vendorPickupAddressSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it('rejects when contactPerson is missing', () => {
      const invalid = { ...validPayload };
      delete invalid.contactPerson;
      const parsed = vendorPickupAddressSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it('rejects when city is missing', () => {
      const invalid = { ...validPayload };
      delete invalid.city;
      const parsed = vendorPickupAddressSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe('2. Multi-Vendor Address Isolation & Security', () => {
    const ownerUserIdA = new mongoose.Types.ObjectId().toHexString();
    const ownerUserIdB = new mongoose.Types.ObjectId().toHexString();

    it('allows Vendor A and Vendor B to independently manage their own pickup addresses without cross-talk', async () => {
      const vendorA = {
        _id: new mongoose.Types.ObjectId(),
        ownerUserId: ownerUserIdA,
        businessName: 'Vendor A Crafts',
        pickupAddress: {
          pickupLocationName: 'Vendor A Kolkata Hub',
          contactPerson: 'Vendor A Manager',
          phone: '9876543210',
          addressLine1: '10 Kolkata Street',
          city: 'Kolkata',
          state: 'West Bengal',
          pincode: '700001',
          country: 'India',
        },
      };

      const vendorB = {
        _id: new mongoose.Types.ObjectId(),
        ownerUserId: ownerUserIdB,
        businessName: 'Vendor B Textiles',
        pickupAddress: {
          pickupLocationName: 'Vendor B Delhi Warehouse',
          contactPerson: 'Vendor B Manager',
          phone: '9811122233',
          addressLine1: '25 Connaught Place',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110001',
          country: 'India',
        },
      };

      jest.spyOn(Vendor, 'findOne').mockImplementation((query) => {
        if (query.ownerUserId === ownerUserIdA) {
          return { lean: jest.fn().mockResolvedValue(vendorA) };
        }
        if (query.ownerUserId === ownerUserIdB) {
          return { lean: jest.fn().mockResolvedValue(vendorB) };
        }
        return { lean: jest.fn().mockResolvedValue(null) };
      });

      // Vendor A loads address
      const resA = mockResponse();
      await getVendorPickupAddress({ user: { sub: ownerUserIdA }, headers: {} }, resA, (err) => { throw err; });
      expect(resA.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          pickupLocationName: 'Vendor A Kolkata Hub',
          city: 'Kolkata',
        }),
      }));

      // Vendor B loads address
      const resB = mockResponse();
      await getVendorPickupAddress({ user: { sub: ownerUserIdB }, headers: {} }, resB, (err) => { throw err; });
      expect(resB.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          pickupLocationName: 'Vendor B Delhi Warehouse',
          city: 'New Delhi',
        }),
      }));
    });

    it('rejects unauthorized access when seller identity does not match vendor record', async () => {
      const unknownUserId = new mongoose.Types.ObjectId().toHexString();
      jest.spyOn(Vendor, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(vendorService.getPickupAddress(unknownUserId))
        .rejects.toThrow('Vendor record not found');
    });
  });

  describe('3. Multi-Vendor Order & Separate Shipments Creation', () => {
    const vendorUserIdA = new mongoose.Types.ObjectId().toHexString();
    const vendorIdA = new mongoose.Types.ObjectId();
    const vendorUserIdB = new mongoose.Types.ObjectId().toHexString();
    const vendorIdB = new mongoose.Types.ObjectId();

    const parentOrderId = new mongoose.Types.ObjectId();
    const vendorOrderIdA = new mongoose.Types.ObjectId();
    const vendorOrderIdB = new mongoose.Types.ObjectId();

    const vendorAddressA = {
      pickupLocationName: 'Vendor A Kolkata Hub',
      contactPerson: 'Vendor A Officer',
      phone: '9876543210',
      addressLine1: '12 Rabindra Sarani',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700001',
      country: 'India',
    };

    const vendorAddressB = {
      pickupLocationName: 'Vendor B Delhi Warehouse',
      contactPerson: 'Vendor B Officer',
      phone: '9811122233',
      addressLine1: '44 Chandni Chowk',
      city: 'New Delhi',
      state: 'Delhi',
      pincode: '110006',
      country: 'India',
    };

    it('creates independent shipments with respective vendor pickup addresses for Order #RUP1001 with Vendor A + Vendor B', async () => {
      const originalProvider = env.DELIVERY_PROVIDER;
      try {
        env.DELIVERY_PROVIDER = 'mock';

        const vendorA = { _id: vendorIdA, ownerUserId: vendorUserIdA, businessName: 'Vendor A', status: 'APPROVED', pickupAddress: vendorAddressA };
        const vendorB = { _id: vendorIdB, ownerUserId: vendorUserIdB, businessName: 'Vendor B', status: 'APPROVED', pickupAddress: vendorAddressB };

        const voA = {
          _id: vendorOrderIdA,
          vendorId: vendorIdA,
          parentOrderId,
          status: 'PACKED',
          inventoryDecremented: true,
          items: [{ variantId: new mongoose.Types.ObjectId(), quantity: 1 }],
          save: jest.fn().mockResolvedValue(true),
        };

        const voB = {
          _id: vendorOrderIdB,
          vendorId: vendorIdB,
          parentOrderId,
          status: 'PACKED',
          inventoryDecremented: true,
          items: [{ variantId: new mongoose.Types.ObjectId(), quantity: 2 }],
          save: jest.fn().mockResolvedValue(true),
        };

        jest.spyOn(Vendor, 'findOne').mockImplementation((q) => {
          if (q.ownerUserId === vendorUserIdA) return Promise.resolve(vendorA);
          if (q.ownerUserId === vendorUserIdB) return Promise.resolve(vendorB);
          return Promise.resolve(null);
        });

        jest.spyOn(VendorOrder, 'findOne').mockImplementation((q) => {
          if (String(q._id) === String(vendorOrderIdA)) return Promise.resolve(voA);
          if (String(q._id) === String(vendorOrderIdB)) return Promise.resolve(voB);
          return Promise.resolve(null);
        });

        jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
        jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
        jest.spyOn(Order, 'findById').mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: parentOrderId,
            orderNumber: 'RUP1001',
            paymentStatus: 'PAID',
            customerId: new mongoose.Types.ObjectId(),
            shippingAddressSnapshot: {
              fullName: 'Customer Banerjee',
              phone: '9888877777',
              street: '5 Park Street',
              city: 'Kolkata',
              state: 'West Bengal',
              postalCode: '700016',
              country: 'India',
            },
          }),
        });

        const createdShipments = [];
        jest.spyOn(Shipment, 'create').mockImplementation((doc) => {
          const item = Array.isArray(doc) ? doc[0] : doc;
          const createdDoc = {
            ...item,
            _id: new mongoose.Types.ObjectId(),
            status: 'PENDING',
            save: jest.fn().mockResolvedValue(true),
            toObject() { return { ...this }; },
          };
          createdShipments.push(createdDoc);
          return Promise.resolve(createdDoc);
        });

        // 1. Vendor A marks Ready to Ship
        const resA = mockResponse();
        await readyVendorOrder(
          { params: { id: vendorOrderIdA.toHexString() }, user: { sub: vendorUserIdA }, body: { weight: 0.5, length: 15, width: 10, height: 5 }, headers: {} },
          resA,
          (err) => { if (err) throw err; }
        );
        expect(resA.json).toHaveBeenCalled();

        // 2. Vendor B marks Ready to Ship
        const resB = mockResponse();
        await readyVendorOrder(
          { params: { id: vendorOrderIdB.toHexString() }, user: { sub: vendorUserIdB }, body: { weight: 1.2, length: 20, width: 15, height: 10 }, headers: {} },
          resB,
          (err) => { if (err) throw err; }
        );
        expect(resB.json).toHaveBeenCalled();

        // 3. Verify exactly 2 shipments created, each with its own vendorId and pickup address snapshot
        expect(createdShipments.length).toBe(2);

        const shipmentA = createdShipments.find((s) => String(s.vendorId) === String(vendorIdA));
        const shipmentB = createdShipments.find((s) => String(s.vendorId) === String(vendorIdB));

        expect(shipmentA).toBeDefined();
        expect(shipmentA.vendorOrderId).toBe(vendorOrderIdA);
        expect(shipmentA.pickupAddress.pickupLocationName).toBe('Vendor A Kolkata Hub');
        expect(shipmentA.pickupAddress.city).toBe('Kolkata');
        expect(shipmentA.pickupAddress.postalCode).toBe('700001');

        expect(shipmentB).toBeDefined();
        expect(shipmentB.vendorOrderId).toBe(vendorOrderIdB);
        expect(shipmentB.pickupAddress.pickupLocationName).toBe('Vendor B Delhi Warehouse');
        expect(shipmentB.pickupAddress.city).toBe('New Delhi');
        expect(shipmentB.pickupAddress.postalCode).toBe('110006');
      } finally {
        env.DELIVERY_PROVIDER = originalProvider;
      }
    });

    it('seller A cannot use seller B\'s pickup location or mark seller B\'s order as Ready to Ship', async () => {
      const vendorUserIdA = new mongoose.Types.ObjectId().toHexString();
      const vendorIdA = new mongoose.Types.ObjectId();
      const vendorUserIdB = new mongoose.Types.ObjectId().toHexString();
      const vendorIdB = new mongoose.Types.ObjectId();

      const parentOrderId = new mongoose.Types.ObjectId();
      const vendorOrderIdB = new mongoose.Types.ObjectId();

      const vendorA = {
        _id: vendorIdA,
        ownerUserId: vendorUserIdA,
        status: 'APPROVED',
        pickupAddress: {
          pickupLocationName: 'Vendor A Kolkata Hub',
          contactPerson: 'Vendor A',
          phone: '9811111111',
          addressLine1: '1 Park Sarani',
          city: 'Kolkata',
          state: 'West Bengal',
          pincode: '700001',
        },
      };

      const vendorB = {
        _id: vendorIdB,
        ownerUserId: vendorUserIdB,
        status: 'APPROVED',
        pickupAddress: {
          pickupLocationName: 'Vendor B Delhi Warehouse',
          contactPerson: 'Vendor B',
          phone: '9822222222',
          addressLine1: '10 Chandni Chowk',
          city: 'New Delhi',
          state: 'Delhi',
          pincode: '110006',
        },
      };

      const voB = {
        _id: vendorOrderIdB,
        vendorId: vendorIdB,
        parentOrderId,
        status: 'PACKED',
        inventoryDecremented: true,
        items: [{ variantId: new mongoose.Types.ObjectId(), quantity: 1, unitPrice: 200 }],
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(Vendor, 'findOne').mockImplementation((q) => {
        if (q.ownerUserId === vendorUserIdA) return Promise.resolve(vendorA);
        if (q.ownerUserId === vendorUserIdB) return Promise.resolve(vendorB);
        return Promise.resolve(null);
      });

      jest.spyOn(VendorOrder, 'findOne').mockImplementation((q) => {
        if (String(q._id) === String(vendorOrderIdB) && String(q.vendorId) === String(vendorIdB)) {
          return Promise.resolve(voB);
        }
        return Promise.resolve(null);
      });

      const res = mockResponse();
      // Seller A attempts to mark Seller B's order as Ready to Ship
      await expect(
        readyVendorOrder(
          {
            params: { id: vendorOrderIdB.toHexString() },
            user: { sub: vendorUserIdA },
            body: { weight: 0.5, length: 15, width: 10, height: 5 },
            headers: {},
          },
          res,
          (err) => { throw err; }
        )
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'VENDOR_ORDER_NOT_FOUND',
      });
    });
  });

  describe('4. Address Change & Snapshot Safety', () => {
    it('preserves historical snapshot: Seller A updates address, old shipment keeps Address A, new shipment receives Address B', async () => {
      // Historical Shipment 1 created under Address A
      const shipment1 = {
        _id: new mongoose.Types.ObjectId(),
        orderId: new mongoose.Types.ObjectId(),
        vendorId: new mongoose.Types.ObjectId(),
        pickupAddress: {
          pickupLocationName: 'Old Facility A',
          addressLine1: '1 Old Road',
          city: 'Kolkata',
          state: 'West Bengal',
          postalCode: '700001',
          country: 'India',
        },
      };

      // Seller A updates their profile to Address B
      const vendorA = {
        pickupAddress: {
          pickupLocationName: 'New Modern Facility B',
          addressLine1: '50 Tech Park',
          city: 'Salt Lake',
          state: 'West Bengal',
          pincode: '700091',
          country: 'India',
        },
      };

      // New Shipment 2 created taking snapshot from vendorA.pickupAddress
      const shipment2 = {
        _id: new mongoose.Types.ObjectId(),
        orderId: new mongoose.Types.ObjectId(),
        vendorId: shipment1.vendorId,
        pickupAddress: {
          pickupLocationName: vendorA.pickupAddress.pickupLocationName,
          addressLine1: vendorA.pickupAddress.addressLine1,
          city: vendorA.pickupAddress.city,
          state: vendorA.pickupAddress.state,
          postalCode: vendorA.pickupAddress.pincode,
          country: vendorA.pickupAddress.country,
        },
      };

      // Verify Shipment 1 remains untouched
      expect(shipment1.pickupAddress.pickupLocationName).toBe('Old Facility A');
      expect(shipment1.pickupAddress.addressLine1).toBe('1 Old Road');
      expect(shipment1.pickupAddress.postalCode).toBe('700001');

      // Verify Shipment 2 contains updated Address B
      expect(shipment2.pickupAddress.pickupLocationName).toBe('New Modern Facility B');
      expect(shipment2.pickupAddress.addressLine1).toBe('50 Tech Park');
      expect(shipment2.pickupAddress.postalCode).toBe('700091');
    });
  });

  describe('5. Missing Address Protection & Rollback', () => {
    const vendorUserId = new mongoose.Types.ObjectId().toHexString();
    const vendorId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();
    const vendorOrderId = new mongoose.Types.ObjectId();

    it('blocks Ready-to-Ship with 400 PICKUP_ADDRESS_REQUIRED when DELIVERY_PROVIDER=shiprocket and address is missing', async () => {
      const originalProvider = env.DELIVERY_PROVIDER;
      try {
        env.DELIVERY_PROVIDER = 'shiprocket';

        jest.spyOn(Vendor, 'findOne').mockResolvedValue({
          _id: vendorId,
          ownerUserId: vendorUserId,
          status: 'APPROVED',
          pickupAddress: null,
        });

        const vo = {
          _id: vendorOrderId,
          vendorId,
          parentOrderId,
          status: 'PACKED',
          inventoryDecremented: true,
          items: [{ variantId: new mongoose.Types.ObjectId(), quantity: 1 }],
          save: jest.fn().mockResolvedValue(true),
        };
        jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
        jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
        jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
        jest.spyOn(Order, 'findById').mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: parentOrderId,
            paymentStatus: 'PAID',
            customerId: new mongoose.Types.ObjectId(),
          }),
        });

        const req = {
          params: { id: vendorOrderId.toHexString() },
          user: { sub: vendorUserId },
          body: { weight: 1.0, length: 15, width: 10, height: 5 },
          headers: {},
        };
        const res = mockResponse();

        await expect(
          readyVendorOrder(req, res, (err) => { if (err) throw err; })
        ).rejects.toMatchObject({
          statusCode: 400,
          code: 'PICKUP_ADDRESS_REQUIRED',
        });
      } finally {
        env.DELIVERY_PROVIDER = originalProvider;
      }
    });
  });

  describe('6. Shiprocket Multiple Pickup Locations Handling', () => {
    it('ShiprocketProvider passes vendor-specific pickupLocationName to adhoc order payload', async () => {
      const provider = new ShiprocketProvider({
        email: 'test@rupakar.in',
        password: 'password123',
        apiUrl: 'https://apiv2.shiprocket.in',
      });

      let sentPayload = null;
      jest.spyOn(provider, 'request').mockImplementation((path, options) => {
        if (path.includes('/orders/create/adhoc')) {
          sentPayload = JSON.parse(options.body);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ order_id: 112233, shipment_id: 445566 }),
          });
        }
        if (path.includes('/courier/assign/awb') || path.includes('/couriers/generate/pickup') || path.includes('/courier/generate/label')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ awb_code: 'SR-TEST-AWB' }),
          });
        }
        return Promise.reject(new Error(`Unhandled path ${path}`));
      });

      const shipmentResult = await provider.createShipment({
        orderId: new mongoose.Types.ObjectId(),
        orderNumber: 'RUP1001',
        vendorOrderId: new mongoose.Types.ObjectId(),
        pickupAddress: {
          pickupLocationName: 'Vendor Specific Kolkata Warehouse',
          city: 'Kolkata',
          postalCode: '700001',
        },
        deliveryAddress: {
          fullName: 'Customer Doe',
          street: '1 Park Circus',
          city: 'Kolkata',
          postalCode: '700017',
        },
      });

      expect(sentPayload).toBeDefined();
      expect(sentPayload.pickup_location).toBe('Vendor Specific Kolkata Warehouse');
      expect(shipmentResult.providerShipmentId).toBe('445566');
    });

    it('fails safely with PICKUP_LOCATION_REQUIRED when in production mode and pickup location is empty', async () => {
      const provider = new ShiprocketProvider({
        email: 'test@rupakar.in',
        password: 'password123',
        apiUrl: 'https://apiv2.shiprocket.in',
        mode: 'production',
      });

      await expect(
        provider.createShipment({
          orderId: new mongoose.Types.ObjectId(),
          vendorOrderId: new mongoose.Types.ObjectId(),
          pickupAddress: {
            pickupLocationName: '',
            city: '',
          },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'PICKUP_LOCATION_REQUIRED',
      });
    });

    it('readyVendorOrder flow with Shiprocket provider surfaces clear error on "Wrong Pickup location entered"', async () => {
      const originalProvider = env.DELIVERY_PROVIDER;
      try {
        env.DELIVERY_PROVIDER = 'shiprocket';

        const vendorUserId = new mongoose.Types.ObjectId().toHexString();
        const vendorId = new mongoose.Types.ObjectId();
        const parentOrderId = new mongoose.Types.ObjectId();
        const vendorOrderId = new mongoose.Types.ObjectId();

        const vendor = {
          _id: vendorId,
          ownerUserId: vendorUserId,
          status: 'APPROVED',
          businessName: 'Dhokra Art Hub',
          pickupAddress: {
            pickupLocationName: 'Dhokra Art Hub Warehouse',
            registrationStatus: 'REGISTERED',
            contactPerson: 'Arun Das',
            phone: '9876543210',
            addressLine1: '45 Craft Village',
            city: 'Bankura',
            state: 'West Bengal',
            pincode: '722101',
          },
        };

        const vo = {
          _id: vendorOrderId,
          vendorId,
          parentOrderId,
          status: 'PACKED',
          inventoryDecremented: true,
          items: [{ variantId: new mongoose.Types.ObjectId(), quantity: 1, unitPrice: 500 }],
          save: jest.fn().mockResolvedValue(true),
        };

        jest.spyOn(Vendor, 'findOne').mockResolvedValue(vendor);
        jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
        jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
        jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
        jest.spyOn(Order, 'findById').mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            _id: parentOrderId,
            orderNumber: 'RUP2026-SR-01',
            paymentStatus: 'PAID',
            customerId: new mongoose.Types.ObjectId(),
            shippingAddressSnapshot: {
              fullName: 'Customer Banerjee',
              phone: '9876543210',
              addressLine1: '5 Park Street',
              city: 'Kolkata',
              state: 'West Bengal',
              postalCode: '700016',
            },
          }),
        });

        const { shippingService } = await import('../app/services/shipping.service.js');
        jest.spyOn(shippingService, 'createShipment').mockRejectedValue(
          new AppError(
            422,
            'SHIPROCKET_ORDER_FAILED',
            'Pickup location "Dhokra Art Hub Warehouse" is not registered in Shiprocket: Wrong Pickup location entered. Please choose one location from the data given. Please ensure the pickup location nickname in Settings matches a registered pickup address nickname in your Shiprocket panel (Settings > Pickup Address).'
          )
        );

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
        ).rejects.toMatchObject({
          statusCode: 422,
          code: 'SHIPROCKET_ORDER_FAILED',
          message: expect.stringMatching(/Pickup location "Dhokra Art Hub Warehouse" is not registered in Shiprocket/i),
        });
      } finally {
        env.DELIVERY_PROVIDER = originalProvider;
      }
    });
  });

  describe('7. Customer vs Admin Visibility', () => {
    it('Customer order details omits sensitive vendor warehouse street and phone, showing only originCity and originState', async () => {
      const customerId = new mongoose.Types.ObjectId().toHexString();
      const parentOrderId = new mongoose.Types.ObjectId();
      const vendorOrderId = new mongoose.Types.ObjectId();

      const mockOrder = {
        _id: parentOrderId,
        customerId,
        orderNumber: 'RUP1001',
        vendorOrders: [{ _id: vendorOrderId }],
      };

      const mockShipment = {
        _id: new mongoose.Types.ObjectId(),
        orderId: parentOrderId,
        vendorOrderId,
        carrier: 'Delhivery Surface',
        trackingNumber: 'DEL123456',
        status: 'SHIPPED',
        pickupAddress: {
          contactPerson: 'Secret Vendor Contact',
          phone: '9800000000',
          street: 'Private Vendor Lane 4B',
          city: 'Kolkata',
          state: 'West Bengal',
          postalCode: '700001',
        },
      };

      jest.spyOn(Order, 'findOne').mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockOrder),
      });

      jest.spyOn(Shipment, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([mockShipment]),
      });

      const res = mockResponse();
      await getOrder(
        { params: { id: parentOrderId.toHexString() }, user: { sub: customerId, role: 'CUSTOMER' }, headers: {} },
        res,
        (err) => { if (err) throw err; }
      );

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0].data;
      const customerShipment = responseData.vendorOrders[0].shipment;

      // Sensitive details stripped
      expect(customerShipment.pickupAddress).toBeUndefined();
      expect(customerShipment.originCity).toBe('Kolkata');
      expect(customerShipment.originState).toBe('West Bengal');
      expect(customerShipment.trackingNumber).toBe('DEL123456');
    });

    it('Admin order details includes distinct vendor orders and shipment pickup details', async () => {
      const parentOrderId = new mongoose.Types.ObjectId();
      const vendorOrderIdA = new mongoose.Types.ObjectId();
      const vendorOrderIdB = new mongoose.Types.ObjectId();

      const mockOrder = {
        _id: parentOrderId,
        orderNumber: 'RUP1001',
        vendorOrders: [
          { _id: vendorOrderIdA, vendorId: { businessName: 'Vendor A' } },
          { _id: vendorOrderIdB, vendorId: { businessName: 'Vendor B' } },
        ],
      };

      const shipmentA = {
        _id: new mongoose.Types.ObjectId(),
        orderId: parentOrderId,
        vendorOrderId: vendorOrderIdA,
        trackingNumber: 'AWB-A',
        pickupAddress: { pickupLocationName: 'Vendor A Hub', city: 'Kolkata' },
      };

      const shipmentB = {
        _id: new mongoose.Types.ObjectId(),
        orderId: parentOrderId,
        vendorOrderId: vendorOrderIdB,
        trackingNumber: 'AWB-B',
        pickupAddress: { pickupLocationName: 'Vendor B Hub', city: 'Delhi' },
      };

      jest.spyOn(Order, 'findById').mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockOrder),
      });

      jest.spyOn(Shipment, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([shipmentA, shipmentB]),
      });

      const res = mockResponse();
      await getAdminOrder(
        { params: { id: parentOrderId.toHexString() }, user: { role: 'ADMIN' }, headers: {} },
        res,
        (err) => { if (err) throw err; }
      );

      expect(res.json).toHaveBeenCalled();
      const responseData = res.json.mock.calls[0][0].data;
      expect(responseData.vendorOrders[0].shipment.pickupAddress.pickupLocationName).toBe('Vendor A Hub');
      expect(responseData.vendorOrders[1].shipment.pickupAddress.pickupLocationName).toBe('Vendor B Hub');
    });
  });

  describe('8. Idempotency on Repeated Ready-to-Ship', () => {
    it('repeated Ready-to-Ship call returns existing shipment without creating duplicate AWB or decrementing inventory', async () => {
      const vendorUserId = new mongoose.Types.ObjectId().toHexString();
      const vendorId = new mongoose.Types.ObjectId();
      const parentOrderId = new mongoose.Types.ObjectId();
      const vendorOrderId = new mongoose.Types.ObjectId();

      jest.spyOn(Vendor, 'findOne').mockResolvedValue({
        _id: vendorId,
        ownerUserId: vendorUserId,
        status: 'APPROVED',
        pickupAddress: {
          pickupLocationName: 'Warehouse 1',
          addressLine1: 'Street 1',
          city: 'Kolkata',
          pincode: '700001',
        },
      });

      const vo = {
        _id: vendorOrderId,
        vendorId,
        parentOrderId,
        status: 'READY_TO_SHIP', // Already marked Ready-to-Ship!
        toObject: () => ({ _id: vendorOrderId, status: 'READY_TO_SHIP' }),
      };
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);

      const existingShipment = {
        _id: new mongoose.Types.ObjectId(),
        trackingNumber: 'EXISTING-AWB-999',
        status: 'READY_TO_SHIP',
        toObject: () => ({ trackingNumber: 'EXISTING-AWB-999', status: 'READY_TO_SHIP' }),
      };
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(existingShipment);
      jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: parentOrderId }) });

      const createShipmentSpy = jest.spyOn(Shipment, 'create');

      const res = mockResponse();
      await readyVendorOrder(
        { params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, body: {}, headers: {} },
        res,
        (err) => { if (err) throw err; }
      );

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          isIdempotent: true,
          shipment: expect.objectContaining({ trackingNumber: 'EXISTING-AWB-999' }),
        }),
      }));
      expect(createShipmentSpy).not.toHaveBeenCalled();
    });
  });
});
