import mongoose from 'mongoose';
import { beforeEach, afterAll, describe, expect, it, jest } from '@jest/globals';
import { orderFulfillmentService } from '../app/services/order-fulfillment.service.js';
import { scheduleVendorOrderPackReminder, scheduleVendorOrderAutoCancel, closeQueueConnection } from '../app/jobs/queues.js';
import { Order } from '../app/models/order.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { User } from '../app/models/user.model.js';
import { Payment } from '../app/models/payment.model.js';
import { Notification } from '../app/models/notification.model.js';
import { notificationService } from '../app/services/notification.service.js';
import { emailService } from '../app/services/email.service.js';
import { smsService } from '../app/services/sms.service.js';
import { refundService } from '../app/services/refund.service.js';
import { inventoryService } from '../app/services/inventory.service.js';
import { inventoryReservationService } from '../app/services/inventory-reservation.service.js';

const query = (val) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(val),
});

describe('Seller Packing Deadline & Reminder Automation', () => {
  const customerId = new mongoose.Types.ObjectId();
  const parentOrderId = new mongoose.Types.ObjectId();
  const vendorId1 = new mongoose.Types.ObjectId();
  const vendorUserId1 = new mongoose.Types.ObjectId();
  const vendorOrderId1 = new mongoose.Types.ObjectId();
  const vendorId2 = new mongoose.Types.ObjectId();
  const vendorOrderId2 = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await closeQueueConnection();
  });

  describe('1. Reminder scheduling and 12-hour interval handling', () => {
    it('schedules reminders across 12-hour intervals for the 2-day period', async () => {
      const vendorOrder = { _id: vendorOrderId1 };
      const jobId = await scheduleVendorOrderPackReminder({ vendorOrderId: vendorOrder._id, delayMs: 12 * 60 * 60 * 1000, reminderStep: 1 });
      expect(jobId).toBeDefined();

      const cancelJobId = await scheduleVendorOrderAutoCancel({ vendorOrderId: vendorOrder._id, delayMs: 48 * 60 * 60 * 1000 });
      expect(cancelJobId).toBeDefined();
    });

    it('sends reminder with dynamic remaining hours for each step (36h, 24h, 12h)', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
        total: 1500,
      };

      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
      jest.spyOn(Vendor, 'findById').mockReturnValue(query({
        _id: vendorId1,
        ownerUserId: vendorUserId1,
        email: 'seller@rupakar.in',
        phone: '+919876543210',
      }));
      jest.spyOn(User, 'findById').mockReturnValue(query({
        _id: vendorUserId1,
        email: 'seller@rupakar.in',
        phone: '+919876543210',
      }));
      jest.spyOn(Order, 'findById').mockReturnValue(query({
        _id: parentOrderId,
        orderNumber: 'ORD-PACK-100',
      }));
      jest.spyOn(Notification, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const emailSpy = jest.spyOn(emailService, 'sendEmail').mockResolvedValue({});
      const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue({});

      // Step 1: 12h elapsed, 36h remaining
      const step1Result = await orderFulfillmentService.sendPackingReminder(vendorOrderId1, 1);
      expect(step1Result.success).toBe(true);
      expect(step1Result.remainingHours).toBe(36);
      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringContaining('36h remaining'),
      }));

      // Step 2: 24h elapsed, 24h remaining
      const step2Result = await orderFulfillmentService.sendPackingReminder(vendorOrderId1, 2);
      expect(step2Result.success).toBe(true);
      expect(step2Result.remainingHours).toBe(24);

      // Step 3: 36h elapsed, 12h remaining
      const step3Result = await orderFulfillmentService.sendPackingReminder(vendorOrderId1, 3);
      expect(step3Result.success).toBe(true);
      expect(step3Result.remainingHours).toBe(12);
    });

    it('enforces idempotency per reminder step so duplicates are rejected', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
      };
      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
      jest.spyOn(Vendor, 'findById').mockReturnValue(query({
        _id: vendorId1,
        ownerUserId: vendorUserId1,
      }));
      // Already exists for step 1
      jest.spyOn(Notification, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'existing-notif' }),
      });

      const emailSpy = jest.spyOn(emailService, 'sendEmail');
      const result = await orderFulfillmentService.sendPackingReminder(vendorOrderId1, 1);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('REMINDER_ALREADY_SENT');
      expect(emailSpy).not.toHaveBeenCalled();
    });
  });

  describe('2. Packing before deadline & auto-cancellation', () => {
    it('prevents reminder if vendor order is already PACKED', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        status: 'PACKED',
      };
      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);

      const result = await orderFulfillmentService.sendPackingReminder(vendorOrderId1, 1);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('ORDER_NOT_UNPACKED');
    });

    it('prevents auto-cancellation if order was packed before 2-day deadline', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        status: 'PACKED',
      };
      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);

      const result = await orderFulfillmentService.autoCancelUnpackedVendorOrder(vendorOrderId1);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('ALREADY_PACKED_OR_FULFILLED');
    });

    it('prevents auto-cancellation if order is already cancelled', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        status: 'CANCELLED',
      };
      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);

      const result = await orderFulfillmentService.autoCancelUnpackedVendorOrder(vendorOrderId1);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('ALREADY_CANCELLED');
    });

    it('auto-cancels unpacked order after 2 days, restores inventory, and refunds customer', async () => {
      const mockVendorOrder = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
        total: 2500,
        items: [{ variantId: 'var-1', quantity: 2 }],
        inventoryDecremented: true,
        save: jest.fn().mockResolvedValue(true),
      };

      const mockParentOrder = {
        _id: parentOrderId,
        customerId,
        orderNumber: 'ORD-CANCEL-200',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        save: jest.fn().mockResolvedValue(true),
      };

      const mockPayment = {
        _id: paymentId,
        status: 'CAPTURED',
      };

      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder);
      jest.spyOn(Order, 'findById').mockResolvedValue(mockParentOrder);
      jest.spyOn(Payment, 'findOne').mockResolvedValue(mockPayment);
      jest.spyOn(VendorOrder, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([mockVendorOrder]),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue(query({
        _id: vendorId1,
        ownerUserId: vendorUserId1,
        email: 'seller@rupakar.in',
      }));
      jest.spyOn(User, 'findById').mockReturnValue(query({
        _id: vendorUserId1,
        email: 'seller@rupakar.in',
        phone: '+919876543210',
      }));

      const stockSpy = jest.spyOn(inventoryService, 'increaseStock').mockResolvedValue({});
      const refundSpy = jest.spyOn(refundService, 'createRefund').mockResolvedValue({ refundId: 'rf-123' });
      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const emailSpy = jest.spyOn(emailService, 'sendEmail').mockResolvedValue({});

      const result = await orderFulfillmentService.autoCancelUnpackedVendorOrder(vendorOrderId1);

      expect(result.success).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(mockVendorOrder.status).toBe('CANCELLED');
      expect(mockVendorOrder.save).toHaveBeenCalled();
      expect(stockSpy).toHaveBeenCalledWith('var-1', 2, expect.objectContaining({
        referenceType: 'AUTO_CANCEL_DEADLINE',
      }));
      expect(refundSpy).toHaveBeenCalledWith(expect.objectContaining({
        refundData: expect.objectContaining({
          amount: 2500,
          reason: 'AUTO_CANCEL_SELLER_UNPACKED_2_DAYS',
        }),
      }));
      expect(mockParentOrder.status).toBe('CANCELLED');
      expect(mockParentOrder.paymentStatus).toBe('REFUND_PENDING');
      expect(mockParentOrder.save).toHaveBeenCalled();
      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'VENDOR_ORDER_AUTO_CANCELLED',
      }));
      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ORDER_ITEM_CANCELLED',
        userId: customerId,
      }));
    });
  });

  describe('3. Multi-vendor order isolation', () => {
    it('cancels one vendor order while preserving sibling packed vendor order', async () => {
      const mockVendorOrder1 = {
        _id: vendorOrderId1,
        parentOrderId,
        vendorId: vendorId1,
        status: 'CONFIRMED',
        total: 1000,
        items: [{ variantId: 'var-1', quantity: 1 }],
        save: jest.fn().mockResolvedValue(true),
      };

      const mockVendorOrder2 = {
        _id: vendorOrderId2,
        parentOrderId,
        vendorId: vendorId2,
        status: 'PACKED',
        total: 1500,
      };

      const mockParentOrder = {
        _id: parentOrderId,
        customerId,
        orderNumber: 'ORD-MULTIVENDOR-300',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        save: jest.fn().mockResolvedValue(true),
      };

      jest.spyOn(VendorOrder, 'findById').mockResolvedValue(mockVendorOrder1);
      jest.spyOn(Order, 'findById').mockResolvedValue(mockParentOrder);
      jest.spyOn(Payment, 'findOne').mockResolvedValue({ _id: paymentId, status: 'CAPTURED' });
      jest.spyOn(VendorOrder, 'find').mockReturnValue({
        lean: jest.fn().mockResolvedValue([mockVendorOrder1, mockVendorOrder2]),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue(query({ _id: vendorId1, ownerUserId: vendorUserId1 }));
      jest.spyOn(User, 'findById').mockReturnValue(query({ _id: vendorUserId1, email: 'seller@rupakar.in' }));
      jest.spyOn(inventoryReservationService, 'releaseReservation').mockResolvedValue(true);
      jest.spyOn(refundService, 'createRefund').mockResolvedValue({ refundId: 'rf-part' });
      jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      jest.spyOn(emailService, 'sendEmail').mockResolvedValue({});

      const result = await orderFulfillmentService.autoCancelUnpackedVendorOrder(vendorOrderId1);

      expect(result.success).toBe(true);
      expect(mockVendorOrder1.status).toBe('CANCELLED');
      // Parent order is NOT cancelled because vendorOrder2 is PACKED
      expect(mockParentOrder.status).toBe('CONFIRMED');
      expect(mockParentOrder.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(mockParentOrder.save).toHaveBeenCalled();
    });
  });
});
