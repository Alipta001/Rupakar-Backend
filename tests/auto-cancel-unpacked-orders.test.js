import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { orderFulfillmentService } from '../app/services/order-fulfillment.service.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { User } from '../app/models/user.model.js';
import { Payment } from '../app/models/payment.model.js';
import { Notification } from '../app/models/notification.model.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';
import { refundService } from '../app/services/refund.service.js';
import { notificationService } from '../app/services/notification.service.js';
import { emailService } from '../app/services/email.service.js';
import { smsService } from '../app/services/sms.service.js';

const query = (val) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(val),
});

describe('Auto-Cancel Unpacked Orders & Packing Reminder', () => {
  const customerId = new mongoose.Types.ObjectId();
  const parentOrderId = new mongoose.Types.ObjectId();
  const vendorId1 = new mongoose.Types.ObjectId();
  const vendorUserId1 = new mongoose.Types.ObjectId();
  const vendorOrderId1 = new mongoose.Types.ObjectId();
  const vendorOrderId2 = new mongoose.Types.ObjectId();
  const variantId1 = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('sendPackingReminder', () => {
    it('sends reminder (in-app, email, SMS) when vendor order is unpacked', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
        total: 1200,
      };

      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
      jest.spyOn(Vendor, 'findById').mockReturnValue(query({
        _id: vendorId1,
        ownerUserId: vendorUserId1,
        email: 'artisan@rupakar.in',
        phone: '+919876543210',
      }));
      jest.spyOn(User, 'findById').mockReturnValue(query({
        _id: vendorUserId1,
        email: 'artisan@rupakar.in',
        phone: '+919876543210',
      }));
      jest.spyOn(Order, 'findById').mockReturnValue(query({
        _id: parentOrderId,
        orderNumber: 'ORD-REMIND-1',
      }));
      jest.spyOn(Notification, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const emailSpy = jest.spyOn(emailService, 'sendEmail').mockResolvedValue({});
      const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue({});

      const result = await orderFulfillmentService.sendPackingReminder(vendorOrderId1);

      expect(result.success).toBe(true);
      expect(result.reminderSent).toBe(true);
      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'VENDOR_ORDER_PACK_REMINDER',
        userId: vendorUserId1,
      }));
      expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({
        to: 'artisan@rupakar.in',
        subject: expect.stringContaining('Please pack order #ORD-REMIND-1'),
      }));
      expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({
        to: '+919876543210',
      }));
    });

    it('is idempotent and does not send duplicate reminder', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
        total: 1200,
      };

      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
      jest.spyOn(Vendor, 'findById').mockReturnValue(query({
        _id: vendorId1,
        ownerUserId: vendorUserId1,
      }));
      // Already sent
      jest.spyOn(Notification, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'notif-existing' }),
      });

      const emailSpy = jest.spyOn(emailService, 'sendEmail');
      const smsSpy = jest.spyOn(smsService, 'sendSms');

      const result = await orderFulfillmentService.sendPackingReminder(vendorOrderId1);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('REMINDER_ALREADY_SENT');
      expect(emailSpy).not.toHaveBeenCalled();
      expect(smsSpy).not.toHaveBeenCalled();
    });

    it('skips reminder if vendor order is already PACKED', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        status: 'PACKED',
      };
      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);

      const result = await orderFulfillmentService.sendPackingReminder(vendorOrderId1);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('ORDER_NOT_UNPACKED');
    });
  });

  describe('autoCancelUnpackedVendorOrder', () => {
    it('cancels unpacked order, restores inventory, and initiates refund', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
        total: 1500,
        inventoryDecremented: false,
        items: [{ variantId: variantId1, quantity: 2 }],
        save: jest.fn().mockResolvedValue(true),
      };

      const mockParentOrder = {
        _id: parentOrderId,
        customerId,
        orderNumber: 'ORD-AUTO-1',
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
      jest.spyOn(Order, 'findById').mockResolvedValue(mockParentOrder);
      jest.spyOn(Payment, 'findOne').mockResolvedValue({
        _id: paymentId,
        orderId: parentOrderId,
        status: 'CAPTURED',
      });
      jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue(true);
      jest.spyOn(refundService, 'createRefund').mockResolvedValue({ _id: 'rf-1', status: 'PROCESSING', amount: 1500 });
      jest.spyOn(VendorOrder, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: vendorOrderId1, status: 'CANCELLED' },
          { _id: vendorOrderId2, status: 'SHIPPED' }, // Sibling order still active
        ]),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue(query({ _id: vendorId1, ownerUserId: vendorUserId1, email: 'artisan@rupakar.in' }));
      jest.spyOn(User, 'findById').mockReturnValue(query({ _id: vendorUserId1, email: 'artisan@rupakar.in' }));
      jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      jest.spyOn(emailService, 'sendEmail').mockResolvedValue({});
      jest.spyOn(smsService, 'sendSms').mockResolvedValue({});

      const result = await orderFulfillmentService.autoCancelUnpackedVendorOrder(vendorOrderId1);

      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(mockVendorOrder.status).toBe('CANCELLED');
      expect(mockVendorOrder.save).toHaveBeenCalled();
      expect(inventoryReservationService.releaseReservation).toHaveBeenCalledWith(expect.objectContaining({
        orderId: parentOrderId,
        variantId: variantId1,
      }));
      expect(refundService.createRefund).toHaveBeenCalledWith(expect.objectContaining({
        refundData: expect.objectContaining({
          orderId: parentOrderId,
          vendorOrderId: vendorOrderId1,
          amount: 1500,
          reason: 'AUTO_CANCEL_SELLER_UNPACKED_2_DAYS',
        }),
      }));
      // Multi-vendor isolation: parent order is partially refunded since sibling is still shipped
      expect(mockParentOrder.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(mockParentOrder.save).toHaveBeenCalled();
    });

    it('does not cancel if order is already PACKED, READY_TO_SHIP, or SHIPPED', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        status: 'PACKED',
      };
      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);

      const refundSpy = jest.spyOn(refundService, 'createRefund');
      const invSpy = jest.spyOn(inventoryService, 'increaseStock');

      const result = await orderFulfillmentService.autoCancelUnpackedVendorOrder(vendorOrderId1);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('ALREADY_PACKED_OR_FULFILLED');
      expect(refundSpy).not.toHaveBeenCalled();
      expect(invSpy).not.toHaveBeenCalled();
    });

    it('is retry-safe and idempotent if already cancelled', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        status: 'CANCELLED',
      };
      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);

      const refundSpy = jest.spyOn(refundService, 'createRefund');

      const result = await orderFulfillmentService.autoCancelUnpackedVendorOrder(vendorOrderId1);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('ALREADY_CANCELLED');
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it('cancels parent order when all vendor orders are cancelled', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'PROCESSING',
        total: 1000,
        items: [],
        save: jest.fn().mockResolvedValue(true),
      };

      const mockParentOrder = {
        _id: parentOrderId,
        customerId,
        orderNumber: 'ORD-AUTO-2',
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
      jest.spyOn(Order, 'findById').mockResolvedValue(mockParentOrder);
      jest.spyOn(Payment, 'findOne').mockResolvedValue({ _id: paymentId, status: 'CAPTURED' });
      jest.spyOn(refundService, 'createRefund').mockResolvedValue({ _id: 'rf-2', status: 'PROCESSING', amount: 1000 });
      // All vendor orders under parent are now cancelled
      jest.spyOn(VendorOrder, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: vendorOrderId1, status: 'CANCELLED' },
        ]),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue(query({ _id: vendorId1, ownerUserId: vendorUserId1 }));
      jest.spyOn(User, 'findById').mockReturnValue(query({ _id: vendorUserId1 }));
      jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      await orderFulfillmentService.autoCancelUnpackedVendorOrder(vendorOrderId1);

      expect(mockParentOrder.status).toBe('CANCELLED');
      expect(mockParentOrder.paymentStatus).toBe('REFUND_PENDING');
    });
  });
});
