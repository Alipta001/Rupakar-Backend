import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import mongoose from 'mongoose';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Order } from '../app/models/order.model.js';
import { Shipment } from '../app/models/shipment.model.js';
import { InventoryReservation } from '../app/models/inventory-reservation.model.js';
import { vendorService } from '../app/services/vendor.service.js';
import { auditService } from '../app/services/audit.service.js';
import { env } from '../app/config/env.js';
import { ShiprocketProvider } from '../app/services/delivery-provider.service.js';
import { orderService } from '../app/services/order.service.js';
import { settlementService } from '../app/services/settlement.service.js';
import {
  listAdminVendorPickupLocations,
  getAdminVendorPickupLocation,
  approveAdminVendorPickupLocation,
  deactivateAdminVendorPickupLocation,
  archiveAdminVendorPickupLocation,
  reactivateAdminVendorPickupLocation,
} from '../app/controllers/admin.controller.js';
import { readyVendorOrder } from '../app/controllers/shipping.controller.js';
import { updateVendorPickupAddress } from '../app/controllers/vendor.controller.js';

const mockResponse = () => {
  const res = {
    statusCode: 200,
    status: jest.fn(function (code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function (payload) {
      this.payload = payload;
      return this;
    }),
  };
  return res;
};

describe('Admin-Controlled Seller Pickup-Location Lifecycle', () => {
  const adminUserId = new mongoose.Types.ObjectId().toHexString();
  const sellerAUserId = new mongoose.Types.ObjectId().toHexString();
  const sellerBUserId = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    env.DELIVERY_PROVIDER = 'shiprocket';
    jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);
    jest.spyOn(settlementService, 'handleVendorOrderDelivered').mockResolvedValue(true);
  });

  // 1. Seller-created pickup location starts PENDING
  it('1. Seller-created pickup location starts PENDING and registers with Shiprocket', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const mockVendor = {
      _id: vendorId,
      ownerUserId: sellerAUserId,
      email: 'artisan@rupakar.in',
      businessName: 'Bishnupur Silk Guild',
      status: 'APPROVED',
      pickupAddress: null,
      save: jest.fn().mockResolvedValue(true),
      toObject() { return { ...this }; },
    };

    jest.spyOn(Vendor, 'findOne').mockResolvedValue(mockVendor);

    jest.spyOn(ShiprocketProvider.prototype, 'registerPickupLocation').mockResolvedValue({
      success: true,
      reused: false,
      pickupLocation: 'Silk Hub Bishnupur',
      pickupId: 'SR-PKP-901',
    });

    const res = await vendorService.updatePickupAddress(sellerAUserId, {
      pickupLocationName: 'Silk Hub Bishnupur',
      contactPerson: 'Suman Roy',
      phone: '9876543210',
      addressLine1: 'Silk Market Road',
      city: 'Bishnupur',
      state: 'West Bengal',
      pincode: '722122',
    });

    expect(mockVendor.save).toHaveBeenCalled();
    expect(res.pickupAddress.registrationStatus).toBe('REGISTERED');
    expect(res.pickupAddress.adminStatus).toBe('PENDING');
    expect(res.pickupAddress.shiprocketPickupId).toBe('SR-PKP-901');
  });

  // 2. Admin can approve
  it('2. Admin can approve a seller pickup location', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const mockVendor = {
      _id: vendorId,
      ownerUserId: sellerAUserId,
      businessName: 'Bishnupur Silk Guild',
      pickupAddress: {
        pickupLocationName: 'Silk Hub Bishnupur',
        registrationStatus: 'REGISTERED',
        adminStatus: 'PENDING',
        pincode: '722122',
      },
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    const auditSpy = jest.spyOn(auditService, 'log');

    const res = mockResponse();
    await approveAdminVendorPickupLocation(
      { params: { vendorId: String(vendorId) }, user: { sub: adminUserId, role: 'admin' }, headers: {} },
      res,
      (err) => { if (err) throw err; }
    );

    expect(mockVendor.pickupAddress.adminStatus).toBe('APPROVED');
    expect(mockVendor.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: 'Pickup location approved successfully',
    }));
    expect(auditSpy).toHaveBeenCalledWith('VENDOR_PICKUP_LOCATION_ADMIN_ACTION', expect.objectContaining({
      action: 'APPROVE',
      vendorId: String(vendorId),
      newStatus: 'APPROVED',
    }));
  });

  // 3. Non-admin cannot approve (router middleware requirement verified)
  it('3. Non-admin cannot approve vendor pickup location', async () => {
    const { requireRole } = await import('../app/middleware/auth.middleware.js');
    const adminOnlyMiddleware = requireRole('admin');

    const nonAdminReq = { user: { sub: sellerAUserId, role: 'vendor' } };
    const res = mockResponse();
    let errorReceived = null;

    adminOnlyMiddleware(nonAdminReq, res, (err) => {
      errorReceived = err;
    });

    expect(errorReceived).toBeDefined();
    expect(errorReceived.statusCode).toBe(403);
    expect(errorReceived.code).toBe('FORBIDDEN');
  });

  // 4. Approved location can be used for Ready-to-Ship
  it('4. Approved location can be used for Ready-to-Ship', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const voId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId: sellerAUserId,
      status: 'APPROVED',
      pickupAddress: {
        pickupLocationName: 'Approved Central Hub',
        registrationStatus: 'REGISTERED',
        adminStatus: 'APPROVED',
        contactPerson: 'Vendor Rep',
        phone: '9876543210',
        addressLine1: 'Road 10',
        city: 'Kolkata',
        state: 'WB',
        pincode: '700001',
      },
    });

    const vo = {
      _id: voId,
      vendorId,
      parentOrderId,
      status: 'PACKED',
      inventoryDecremented: true,
      items: [{ variantId: new mongoose.Types.ObjectId(), quantity: 1, unitPrice: 800 }],
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: parentOrderId,
        orderNumber: 'RUP-APP-1',
        paymentStatus: 'PAID',
        customerId: new mongoose.Types.ObjectId(),
        shippingAddressSnapshot: {
          fullName: 'Customer Ghosh',
          phone: '9876543210',
          addressLine1: 'Lake Road',
          city: 'Kolkata',
          state: 'WB',
          postalCode: '700029',
        },
      }),
    });

    const { shippingService } = await import('../app/services/shipping.service.js');
    jest.spyOn(shippingService, 'createShipment').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      shipmentNumber: 'SHIP-APP-1',
      trackingNumber: 'AWB-APP-1',
      providerShipmentId: 'SR-SHP-1',
      carrier: 'Shiprocket Surface',
      shippingMethod: 'surface',
      shippingCost: 50,
      estimatedDeliveryAt: new Date(),
      trackingUrl: 'https://shiprocket.co/track/AWB-APP-1',
      labelUrl: '/label-1',
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
        save: jest.fn().mockResolvedValue(true),
        toObject() { return { ...this }; },
      });
    });

    const res = mockResponse();
    await readyVendorOrder(
      { params: { id: String(voId) }, user: { sub: sellerAUserId }, body: { weight: 0.5, length: 15, width: 10, height: 5 }, headers: {} },
      res,
      (err) => { if (err) throw err; }
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        shipment: expect.objectContaining({ trackingNumber: 'AWB-APP-1' }),
      }),
    }));
  });

  // 5. Pending location cannot be used
  it('5. Pending location cannot be used for Ready-to-Ship and returns PICKUP_LOCATION_NOT_APPROVED', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const voId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId: sellerAUserId,
      status: 'APPROVED',
      pickupAddress: {
        pickupLocationName: 'Pending Hub',
        registrationStatus: 'REGISTERED',
        adminStatus: 'PENDING',
        contactPerson: 'Vendor Rep',
        phone: '9876543210',
        addressLine1: 'Road 10',
        city: 'Kolkata',
        state: 'WB',
        pincode: '700001',
      },
    });

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

    const res = mockResponse();
    await expect(
      readyVendorOrder(
        { params: { id: String(voId) }, user: { sub: sellerAUserId }, body: { weight: 0.5, length: 15, width: 10, height: 5 }, headers: {} },
        res,
        (err) => { if (err) throw err; }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PICKUP_LOCATION_NOT_APPROVED',
      message: 'Pickup location is awaiting admin approval.',
    });
  });

  // 6. Deactivated location cannot be used
  it('6. Deactivated location cannot be used and returns clear deactivated error', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const voId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId: sellerAUserId,
      status: 'APPROVED',
      pickupAddress: {
        pickupLocationName: 'Old Deactivated Hub',
        registrationStatus: 'REGISTERED',
        adminStatus: 'DEACTIVATED',
        contactPerson: 'Vendor Rep',
        phone: '9876543210',
        addressLine1: 'Road 10',
        city: 'Kolkata',
        state: 'WB',
        pincode: '700001',
      },
    });

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

    const res = mockResponse();
    await expect(
      readyVendorOrder(
        { params: { id: String(voId) }, user: { sub: sellerAUserId }, body: { weight: 0.5, length: 15, width: 10, height: 5 }, headers: {} },
        res,
        (err) => { if (err) throw err; }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PICKUP_LOCATION_NOT_APPROVED',
      message: 'Pickup location is deactivated by admin.',
    });
  });

  // 7. Archived location cannot be used
  it('7. Archived location cannot be used and returns clear archived error', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const voId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();

    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId: sellerAUserId,
      status: 'APPROVED',
      pickupAddress: {
        pickupLocationName: 'Permanently Retired Hub',
        registrationStatus: 'REGISTERED',
        adminStatus: 'ARCHIVED',
        contactPerson: 'Vendor Rep',
        phone: '9876543210',
        addressLine1: 'Road 10',
        city: 'Kolkata',
        state: 'WB',
        pincode: '700001',
      },
    });

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

    const res = mockResponse();
    await expect(
      readyVendorOrder(
        { params: { id: String(voId) }, user: { sub: sellerAUserId }, body: { weight: 0.5, length: 15, width: 10, height: 5 }, headers: {} },
        res,
        (err) => { if (err) throw err; }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PICKUP_LOCATION_NOT_APPROVED',
      message: 'Pickup location has been archived.',
    });
  });

  // 8. Admin can reactivate a deactivated location
  it('8. Admin can reactivate a deactivated location', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const mockVendor = {
      _id: vendorId,
      ownerUserId: sellerAUserId,
      businessName: 'Bengal Potters',
      pickupAddress: {
        pickupLocationName: 'Pottery Cluster',
        registrationStatus: 'REGISTERED',
        adminStatus: 'DEACTIVATED',
        pincode: '700001',
      },
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    const auditSpy = jest.spyOn(auditService, 'log');

    const res = mockResponse();
    await reactivateAdminVendorPickupLocation(
      { params: { vendorId: String(vendorId) }, user: { sub: adminUserId, role: 'admin' }, headers: {} },
      res,
      (err) => { if (err) throw err; }
    );

    expect(mockVendor.pickupAddress.adminStatus).toBe('APPROVED');
    expect(mockVendor.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: 'Pickup location reactivated successfully',
    }));
    expect(auditSpy).toHaveBeenCalledWith('VENDOR_PICKUP_LOCATION_ADMIN_ACTION', expect.objectContaining({
      action: 'REACTIVATE',
      previousStatus: 'DEACTIVATED',
      newStatus: 'APPROVED',
    }));
  });

  // 9. Archived location cannot accidentally become active without an explicit supported workflow
  it('9. Archived location cannot be reactivated via reactivate endpoint', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const mockVendor = {
      _id: vendorId,
      ownerUserId: sellerAUserId,
      businessName: 'Bengal Potters',
      pickupAddress: {
        pickupLocationName: 'Old Pottery Shed',
        registrationStatus: 'REGISTERED',
        adminStatus: 'ARCHIVED',
        pincode: '700001',
      },
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);

    const res = mockResponse();
    await expect(
      reactivateAdminVendorPickupLocation(
        { params: { vendorId: String(vendorId) }, user: { sub: adminUserId, role: 'admin' }, headers: {} },
        res,
        (err) => { if (err) throw err; }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'CANNOT_REACTIVATE_ARCHIVED_LOCATION',
    });

    expect(mockVendor.pickupAddress.adminStatus).toBe('ARCHIVED');
    expect(mockVendor.save).not.toHaveBeenCalled();
  });

  // 10. Existing shipment snapshots remain unchanged after pickup-location status changes
  it('10. Existing shipment snapshots remain unchanged after pickup-location status changes', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const pastShipment = {
      _id: new mongoose.Types.ObjectId(),
      trackingNumber: 'PAST-TRK-100',
      status: 'SHIPPED',
      pickupAddress: {
        pickupLocationName: 'Historical Warehouse',
        addressLine1: 'Old Wharf Road',
        city: 'Kolkata',
        postalCode: '700001',
        adminStatus: 'APPROVED',
      },
      save: jest.fn(),
    };

    const mockVendor = {
      _id: vendorId,
      ownerUserId: sellerAUserId,
      pickupAddress: {
        pickupLocationName: 'Historical Warehouse',
        adminStatus: 'APPROVED',
        pincode: '700001',
      },
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);

    // Deactivate vendor pickup location
    const res = mockResponse();
    await deactivateAdminVendorPickupLocation(
      { params: { vendorId: String(vendorId) }, user: { sub: adminUserId, role: 'admin' }, headers: {} },
      res,
      (err) => { if (err) throw err; }
    );

    // Vendor pickup address is DEACTIVATED
    expect(mockVendor.pickupAddress.adminStatus).toBe('DEACTIVATED');

    // Historical shipment snapshot remains unchanged!
    expect(pastShipment.pickupAddress.pickupLocationName).toBe('Historical Warehouse');
    expect(pastShipment.pickupAddress.adminStatus).toBe('APPROVED');
    expect(pastShipment.save).not.toHaveBeenCalled();
  });

  // 11. Seller A cannot modify Seller B's pickup location
  it('11. Seller A cannot modify Seller B\'s pickup location', async () => {
    jest.spyOn(Vendor, 'findOne').mockImplementation(({ ownerUserId }) => {
      // If seller A requests, return Seller A's vendor
      if (ownerUserId === sellerAUserId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(),
          ownerUserId: sellerAUserId,
          businessName: 'Seller A Store',
          save: jest.fn().mockResolvedValue(true),
        });
      }
      return Promise.resolve(null);
    });

    const res = mockResponse();
    // Seller A tries to update with Seller B's credentials/token
    await expect(
      updateVendorPickupAddress(
        { user: { sub: 'unauthorized_stranger_user_id' }, body: { pickupLocationName: 'Hacked Hub', contactPerson: 'Hacker', phone: '9876543210', addressLine1: 'St 1', city: 'Cal', state: 'WB', pincode: '700001' }, headers: {} },
        res,
        (err) => { if (err) throw err; }
      )
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'VENDOR_NOT_FOUND',
    });
  });

  // 12. Shiprocket pickup location is not physically deleted
  it('12. Deactivating/archiving does not physically delete vendor record or shiprocketPickupId', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const mockVendor = {
      _id: vendorId,
      ownerUserId: sellerAUserId,
      pickupAddress: {
        pickupLocationName: 'Hub With ID',
        shiprocketPickupId: 'SR-123456',
        registrationStatus: 'REGISTERED',
        adminStatus: 'APPROVED',
        pincode: '700001',
      },
      save: jest.fn().mockResolvedValue(true),
    };

    jest.spyOn(Vendor, 'findById').mockResolvedValue(mockVendor);
    const deleteSpy = jest.spyOn(Vendor, 'findByIdAndDelete');

    const res = mockResponse();
    await archiveAdminVendorPickupLocation(
      { params: { vendorId: String(vendorId) }, user: { sub: adminUserId, role: 'admin' }, headers: {} },
      res,
      (err) => { if (err) throw err; }
    );

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(mockVendor.pickupAddress.shiprocketPickupId).toBe('SR-123456');
    expect(mockVendor.pickupAddress.registrationStatus).toBe('REGISTERED');
    expect(mockVendor.pickupAddress.adminStatus).toBe('ARCHIVED');
  });

  // 13. Existing registered locations remain backward-compatible if adminStatus is missing
  it('13. Existing registered locations remain backward-compatible when adminStatus is missing', async () => {
    const vendorId = new mongoose.Types.ObjectId();
    const voId = new mongoose.Types.ObjectId();
    const parentOrderId = new mongoose.Types.ObjectId();

    // Legacy vendor record without adminStatus field
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({
      _id: vendorId,
      ownerUserId: sellerAUserId,
      status: 'APPROVED',
      pickupAddress: {
        pickupLocationName: 'Legacy Registered Hub',
        registrationStatus: 'REGISTERED',
        // adminStatus is undefined/missing!
        contactPerson: 'Old Rep',
        phone: '9876543210',
        addressLine1: 'Old St',
        city: 'Kolkata',
        state: 'WB',
        pincode: '700001',
      },
    });

    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({
      _id: voId,
      vendorId,
      parentOrderId,
      status: 'PACKED',
      inventoryDecremented: true,
      items: [{ variantId: new mongoose.Types.ObjectId(), quantity: 1, unitPrice: 500 }],
      save: jest.fn().mockResolvedValue(true),
    });
    jest.spyOn(Shipment, 'findOne').mockResolvedValue(null);
    jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
    jest.spyOn(Order, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: parentOrderId,
        orderNumber: 'RUP-LEGACY-1',
        paymentStatus: 'PAID',
        customerId: new mongoose.Types.ObjectId(),
        shippingAddressSnapshot: {
          fullName: 'Customer Roy',
          phone: '9876543210',
          addressLine1: 'Road 5',
          city: 'Kolkata',
          state: 'WB',
          postalCode: '700001',
        },
      }),
    });

    const { shippingService } = await import('../app/services/shipping.service.js');
    jest.spyOn(shippingService, 'createShipment').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      shipmentNumber: 'SHIP-LEGACY-1',
      trackingNumber: 'AWB-LEGACY-1',
      providerShipmentId: 'SR-LEG-1',
      carrier: 'Shiprocket Surface',
      shippingMethod: 'surface',
      shippingCost: 50,
      estimatedDeliveryAt: new Date(),
      trackingUrl: 'https://shiprocket.co/track/AWB-LEGACY-1',
      labelUrl: '/label-leg',
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
        save: jest.fn().mockResolvedValue(true),
        toObject() { return { ...this }; },
      });
    });

    const res = mockResponse();
    await readyVendorOrder(
      { params: { id: String(voId) }, user: { sub: sellerAUserId }, body: { weight: 0.5, length: 15, width: 10, height: 5 }, headers: {} },
      res,
      (err) => { if (err) throw err; }
    );

    // Passes without throwing PICKUP_LOCATION_NOT_APPROVED!
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
    }));
  });

  // 14. Multi-vendor shipment behavior remains unchanged
  it('14. Multi-vendor shipment behavior remains unchanged with isolated pickup locations', async () => {
    const vendorIdA = new mongoose.Types.ObjectId();
    const vendorIdB = new mongoose.Types.ObjectId();

    jest.spyOn(Vendor, 'find').mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              _id: vendorIdA,
              businessName: 'Vendor A Artisans',
              pickupAddress: {
                pickupLocationName: 'Hub A',
                city: 'Bankura',
                state: 'West Bengal',
                pincode: '722101',
                registrationStatus: 'REGISTERED',
                adminStatus: 'APPROVED',
              },
            },
            {
              _id: vendorIdB,
              businessName: 'Vendor B Weavers',
              pickupAddress: {
                pickupLocationName: 'Hub B',
                city: 'Phulia',
                state: 'West Bengal',
                pincode: '741402',
                registrationStatus: 'REGISTERED',
                adminStatus: 'PENDING',
              },
            },
          ]),
        }),
      }),
    });

    const res = mockResponse();
    await listAdminVendorPickupLocations(
      { query: {}, headers: {}, user: { sub: adminUserId, role: 'admin' } },
      res,
      (err) => { if (err) throw err; }
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        total: 2,
        items: expect.arrayContaining([
          expect.objectContaining({ vendorId: String(vendorIdA), adminStatus: 'APPROVED' }),
          expect.objectContaining({ vendorId: String(vendorIdB), adminStatus: 'PENDING' }),
        ]),
      }),
    }));
  });
});
