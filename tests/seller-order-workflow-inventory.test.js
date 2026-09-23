import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Order } from '../app/models/order.model.js';
import { Shipment } from '../app/models/shipment.model.js';
import { InventoryReservation } from '../app/models/inventory-reservation.model.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { shipmentStateService } from '../app/services/shipment-state.service.js';
import { orderService } from '../app/services/order.service.js';
import {
  processVendorOrder,
  packVendorOrder,
  readyVendorOrder,
} from '../app/controllers/shipping.controller.js';

const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

describe('Seller Order Workflow & Inventory Decrement at READY_TO_SHIP', () => {
  const vendorUserId = new mongoose.Types.ObjectId().toHexString();
  const vendorId = new mongoose.Types.ObjectId();
  const parentOrderId = new mongoose.Types.ObjectId();
  const vendorOrderId = new mongoose.Types.ObjectId();
  const variantId1 = new mongoose.Types.ObjectId();
  const variantId2 = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('Workflow Progression & Transition Guards', () => {
    it('processVendorOrder moves CONFIRMED vendor order to PROCESSING', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId, status: 'APPROVED' });
      const vo = {
        _id: vendorOrderId,
        vendorId,
        parentOrderId,
        status: 'CONFIRMED',
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ _id: vendorOrderId, status: 'PROCESSING' }),
      };
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
      jest.spyOn(VendorOrder, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ ...vo, status: 'PROCESSING' }) });
      jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

      const res = response();
      await processVendorOrder({ params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, headers: {} }, res, (err) => { throw err; });

      expect(vo.status).toBe('PROCESSING');
      expect(vo.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ vendorOrder: expect.objectContaining({ status: 'PROCESSING' }) }),
      }));
    });

    it('packVendorOrder rejects transitions if order is not in PROCESSING', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId, status: 'APPROVED' });
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({
        _id: vendorOrderId,
        vendorId,
        parentOrderId,
        status: 'CONFIRMED', // Not PROCESSING
      });
      jest.spyOn(Order, 'findById').mockResolvedValue({ paymentStatus: 'PAID' });

      const res = response();
      await expect(
        packVendorOrder({ params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, headers: {} }, res, (err) => { throw err; })
      ).rejects.toThrow('Order is not ready to be packed');
    });

    it('rejects unapproved vendor from managing orders', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue(null); // Unapproved or not found

      const res = response();
      await expect(
        packVendorOrder({ params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, headers: {} }, res, (err) => { throw err; })
      ).rejects.toThrow('Only approved vendors can manage orders');
    });
  });

  describe('Inventory Decrement at READY_TO_SHIP', () => {
    it('decrements stock for single item when reaching READY_TO_SHIP', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId, status: 'APPROVED' });
      const vo = {
        _id: vendorOrderId,
        vendorId,
        parentOrderId,
        status: 'PACKED',
        inventoryDecremented: false,
        items: [{ variantId: variantId1, quantity: 2 }],
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ _id: vendorOrderId, status: 'READY_TO_SHIP', inventoryDecremented: true }),
      };
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
      const mockShipment = {
        _id: new mongoose.Types.ObjectId(),
        status: 'PACKED',
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ status: 'READY_TO_SHIP' }),
      };
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);
      jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
      const decreaseSpy = jest.spyOn(inventoryService, 'decreaseStock').mockResolvedValue({});
      jest.spyOn(shipmentStateService, 'transitionShipmentStatus').mockResolvedValue(true);
      jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: parentOrderId }) });
      jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

      const res = response();
      await readyVendorOrder({ params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, headers: {} }, res, (err) => { throw err; });

      expect(decreaseSpy).toHaveBeenCalledWith(variantId1, 2, expect.objectContaining({ reason: 'READY_TO_SHIP' }));
      expect(vo.inventoryDecremented).toBe(true);
      expect(vo.status).toBe('READY_TO_SHIP');
      expect(vo.save).toHaveBeenCalled();
    });

    it('decrements stock for multiple items atomically', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId, status: 'APPROVED' });
      const vo = {
        _id: vendorOrderId,
        vendorId,
        parentOrderId,
        status: 'PACKED',
        inventoryDecremented: false,
        items: [
          { variantId: variantId1, quantity: 3 },
          { variantId: variantId2, quantity: 5 },
        ],
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ _id: vendorOrderId, status: 'READY_TO_SHIP', inventoryDecremented: true }),
      };
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
      const mockShipment = {
        _id: new mongoose.Types.ObjectId(),
        status: 'PACKED',
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ status: 'READY_TO_SHIP' }),
      };
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);
      jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);
      const decreaseSpy = jest.spyOn(inventoryService, 'decreaseStock').mockResolvedValue({});
      jest.spyOn(shipmentStateService, 'transitionShipmentStatus').mockResolvedValue(true);
      jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: parentOrderId }) });
      jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

      const res = response();
      await readyVendorOrder({ params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, headers: {} }, res, (err) => { throw err; });

      expect(decreaseSpy).toHaveBeenCalledTimes(2);
      expect(decreaseSpy).toHaveBeenCalledWith(variantId1, 3, expect.anything());
      expect(decreaseSpy).toHaveBeenCalledWith(variantId2, 5, expect.anything());
      expect(vo.inventoryDecremented).toBe(true);
    });

    it('rolls back previous item decrements if subsequent item has insufficient stock', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId, status: 'APPROVED' });
      const vo = {
        _id: vendorOrderId,
        vendorId,
        parentOrderId,
        status: 'PACKED',
        inventoryDecremented: false,
        items: [
          { variantId: variantId1, quantity: 2 },
          { variantId: variantId2, quantity: 999 },
        ],
        save: jest.fn(),
      };
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
      const mockShipment = {
        _id: new mongoose.Types.ObjectId(),
        status: 'PACKED',
        save: jest.fn(),
      };
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);
      jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue(null);

      jest.spyOn(inventoryService, 'decreaseStock')
        .mockResolvedValueOnce({}) // item 1 succeeds
        .mockRejectedValueOnce(new Error('INSUFFICIENT_STOCK')); // item 2 fails

      const increaseSpy = jest.spyOn(inventoryService, 'increaseStock').mockResolvedValue({});

      const res = response();
      await expect(
        readyVendorOrder({ params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, headers: {} }, res, (err) => { throw err; })
      ).rejects.toThrow('INSUFFICIENT_STOCK');

      // Verify item 1 was rolled back
      expect(increaseSpy).toHaveBeenCalledWith(variantId1, 2, expect.objectContaining({ reason: 'ROLLBACK_READY_TO_SHIP_FAILURE' }));
      // Verify vendorOrder did not advance
      expect(vo.status).toBe('PACKED');
      expect(vo.inventoryDecremented).toBe(false);
      expect(vo.save).not.toHaveBeenCalled();
    });

    it('retry-safe: does NOT double decrement if inventoryDecremented is already true', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId, status: 'APPROVED' });
      const vo = {
        _id: vendorOrderId,
        vendorId,
        parentOrderId,
        status: 'PACKED',
        inventoryDecremented: true, // Already decremented!
        items: [{ variantId: variantId1, quantity: 2 }],
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ _id: vendorOrderId, status: 'READY_TO_SHIP' }),
      };
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
      const mockShipment = {
        _id: new mongoose.Types.ObjectId(),
        status: 'PACKED',
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ status: 'READY_TO_SHIP' }),
      };
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);
      const decreaseSpy = jest.spyOn(inventoryService, 'decreaseStock');
      jest.spyOn(shipmentStateService, 'transitionShipmentStatus').mockResolvedValue(true);
      jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: parentOrderId }) });
      jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

      const res = response();
      await readyVendorOrder({ params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, headers: {} }, res, (err) => { throw err; });

      // decreaseStock must NOT be called again
      expect(decreaseSpy).not.toHaveBeenCalled();
    });

    it('consumes active reservation without double-decrementing available stock', async () => {
      jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: vendorId, ownerUserId: vendorUserId, status: 'APPROVED' });
      const vo = {
        _id: vendorOrderId,
        vendorId,
        parentOrderId,
        status: 'PACKED',
        inventoryDecremented: false,
        items: [{ variantId: variantId1, quantity: 2 }],
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ _id: vendorOrderId, status: 'READY_TO_SHIP' }),
      };
      jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(vo);
      const mockShipment = {
        _id: new mongoose.Types.ObjectId(),
        status: 'PACKED',
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ status: 'READY_TO_SHIP' }),
      };
      jest.spyOn(Shipment, 'findOne').mockResolvedValue(mockShipment);
      jest.spyOn(InventoryReservation, 'findOne').mockResolvedValue({ _id: 'res-1', status: 'ACTIVE' });
      const consumeSpy = jest.spyOn(inventoryReservationService, 'consumeReservation').mockResolvedValue({});
      const decreaseSpy = jest.spyOn(inventoryService, 'decreaseStock');
      jest.spyOn(shipmentStateService, 'transitionShipmentStatus').mockResolvedValue(true);
      jest.spyOn(Order, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: parentOrderId }) });
      jest.spyOn(orderService, 'syncParentOrderStatus').mockResolvedValue(true);

      const res = response();
      await readyVendorOrder({ params: { id: vendorOrderId.toHexString() }, user: { sub: vendorUserId }, headers: {} }, res, (err) => { throw err; });

      expect(consumeSpy).toHaveBeenCalledWith({ orderId: parentOrderId, variantId: variantId1 });
      expect(decreaseSpy).not.toHaveBeenCalled();
      expect(vo.inventoryDecremented).toBe(true);
    });
  });
});
