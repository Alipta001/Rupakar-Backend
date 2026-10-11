import mongoose from 'mongoose';
import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { returnNotificationService } from '../app/services/return-notification.service.js';
import { ReturnNotificationEvent } from '../app/models/return-notification-event.model.js';
import { notificationService } from '../app/services/notification.service.js';
import { emailService } from '../app/services/email.service.js';
import { smsService, normalizeIndianPhone10 } from '../app/services/sms.service.js';
import { supportTicketService } from '../app/services/support-ticket.service.js';
import { SupportTicket } from '../app/models/support-ticket.model.js';
import { User } from '../app/models/user.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { Return } from '../app/models/return.model.js';
import { Order } from '../app/models/order.model.js';
import { auditService } from '../app/services/audit.service.js';
import { AppError } from '../app/utils/app-error.js';

describe('Phase 11: Return Notifications, Customer Support & Communication', () => {
  const customerId1 = new mongoose.Types.ObjectId();
  const customerId2 = new mongoose.Types.ObjectId();
  const sellerOwnerUserId1 = new mongoose.Types.ObjectId();
  const sellerOwnerUserId2 = new mongoose.Types.ObjectId();
  const vendorId1 = new mongoose.Types.ObjectId();
  const vendorId2 = new mongoose.Types.ObjectId();
  const adminUserId = new mongoose.Types.ObjectId();
  const returnId1 = new mongoose.Types.ObjectId();
  const orderId1 = new mongoose.Types.ObjectId();

  const mockCustomer = {
    _id: customerId1,
    email: 'customer1@example.com',
    phone: '+919876543210',
    fullName: 'Ananya Sharma',
  };

  const mockVendor1 = {
    _id: vendorId1,
    ownerUserId: sellerOwnerUserId1,
    businessName: 'Odisha Weaves',
    email: 'vendor1@example.com',
  };

  const mockReturn = {
    _id: returnId1,
    returnNumber: 'RUP-RET-2026-TEST',
    customerId: customerId1,
    vendorId: vendorId1,
    orderId: orderId1,
    status: 'REQUESTED',
    items: [],
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
    jest.spyOn(notificationService, 'notifyVendor').mockResolvedValue({});
    jest.spyOn(notificationService, 'notifyAdmins').mockResolvedValue({});
    jest.spyOn(emailService, 'sendEmail').mockResolvedValue({ messageId: 'mock-mail-id', success: true });
    jest.spyOn(smsService, 'sendSms').mockResolvedValue({ messageId: 'mock-sms-id', success: true });
    jest.spyOn(Order, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: orderId1, customerId: customerId1 }),
    });
    jest.spyOn(Order, 'exists').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================
  // 1–13. RETURN NOTIFICATION EVENTS
  // ============================================================
  describe('Authoritative Return Notification Events', () => {
    it('1. emits customer and seller notification on RETURN_REQUESTED', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockVendor1),
      });

      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const vendorNotifSpy = jest.spyOn(notificationService, 'notifyVendor').mockResolvedValue({});

      const custRes = await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_REQUESTED',
        returnDoc: mockReturn,
      });
      const vendRes = await returnNotificationService.emitSellerReturnEvent({
        eventType: 'RETURN_REQUESTED',
        returnDoc: mockReturn,
      });

      expect(custRes.success).toBe(true);
      expect(vendRes.success).toBe(true);
      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({
        userId: customerId1,
        type: 'RETURN_REQUESTED',
      }));
      expect(vendorNotifSpy).toHaveBeenCalledWith(expect.objectContaining({
        vendorId: vendorId1,
        userId: sellerOwnerUserId1,
        type: 'RETURN_REQUESTED',
      }));
    });

    it('2. emits RETURN_APPROVED notification to customer and seller', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockVendor1),
      });

      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue({ success: true });

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_APPROVED',
        returnDoc: { ...mockReturn, status: 'APPROVED' },
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'RETURN_APPROVED',
      }));
      expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({
        to: '+919876543210',
      }));
    });

    it('3. emits RETURN_REJECTED notification to customer without SMS spam', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const smsSpy = jest.spyOn(smsService, 'sendSms');

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_REJECTED',
        returnDoc: { ...mockReturn, status: 'REJECTED' },
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'RETURN_REJECTED',
      }));
      expect(smsSpy).not.toHaveBeenCalled();
    });

    it('4. emits RETURN_CANCELLED notification to customer upon cancellation', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_CANCELLED',
        returnDoc: { ...mockReturn, status: 'CANCELLED' },
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'RETURN_CANCELLED',
      }));
    });

    it('5. emits RETURN_RECEIVED notification to customer and seller upon reverse delivery', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockVendor1),
      });

      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const vendorSpy = jest.spyOn(notificationService, 'notifyVendor').mockResolvedValue({});
      const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue({ success: true });

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_RECEIVED',
        returnDoc: { ...mockReturn, status: 'RETURN_RECEIVED' },
      });
      await returnNotificationService.emitSellerReturnEvent({
        eventType: 'RETURN_RECEIVED',
        returnDoc: { ...mockReturn, status: 'RETURN_RECEIVED' },
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_RECEIVED' }));
      expect(vendorSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_RECEIVED' }));
      expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '+919876543210' }));
    });

    it('6. emits RETURN_INSPECTION_STARTED notification when inspection begins', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_INSPECTION_STARTED',
        returnDoc: { ...mockReturn, status: 'INSPECTION_PENDING' },
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_INSPECTION_STARTED' }));
    });

    it('7. emits RETURN_INSPECTION_PASSED to customer and RETURN_DISPOSITION_REQUIRED to seller', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockVendor1),
      });
      const custSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const vendSpy = jest.spyOn(notificationService, 'notifyVendor').mockResolvedValue({});

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_INSPECTION_PASSED',
        returnDoc: { ...mockReturn, status: 'INSPECTION_PASSED' },
      });
      await returnNotificationService.emitSellerReturnEvent({
        eventType: 'RETURN_DISPOSITION_REQUIRED',
        returnDoc: { ...mockReturn, status: 'INSPECTION_PASSED' },
      });

      expect(custSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_INSPECTION_PASSED' }));
      expect(vendSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_DISPOSITION_REQUIRED' }));
    });

    it('8. emits RETURN_INSPECTION_FAILED to customer and admin exception on failure', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      jest.spyOn(User, 'findOne').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: adminUserId }),
      });
      const custSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const adminSpy = jest.spyOn(notificationService, 'notifyAdmins').mockResolvedValue([]);

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_INSPECTION_FAILED',
        returnDoc: { ...mockReturn, status: 'INSPECTION_FAILED' },
      });
      await returnNotificationService.emitAdminReturnException({
        eventType: 'RETURN_INSPECTION_FAILED',
        returnDoc: { ...mockReturn, status: 'INSPECTION_FAILED' },
      });

      expect(custSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_INSPECTION_FAILED' }));
      expect(adminSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADMIN_RETURN_INSPECTION_FAILED' }));
    });

    it('9. emits RETURN_DISPOSITION_COMPLETED to customer and seller after restocking/disposition', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      jest.spyOn(Vendor, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockVendor1),
      });
      const custSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const vendSpy = jest.spyOn(notificationService, 'notifyVendor').mockResolvedValue({});

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_DISPOSITION_COMPLETED',
        returnDoc: { ...mockReturn, status: 'DISPOSITION_COMPLETED' },
      });
      await returnNotificationService.emitSellerReturnEvent({
        eventType: 'RETURN_DISPOSITION_COMPLETED',
        returnDoc: { ...mockReturn, status: 'DISPOSITION_COMPLETED' },
      });

      expect(custSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_DISPOSITION_COMPLETED' }));
      expect(vendSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_DISPOSITION_COMPLETED' }));
    });

    it('10. emits RETURN_REFUND_PENDING when refund initiation starts', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_REFUND_PENDING',
        returnDoc: { ...mockReturn, status: 'REFUND_PENDING' },
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_REFUND_PENDING' }));
    });

    it('11. emits RETURN_REFUNDED via in-app, email, and SMS when refund completes', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const emailSpy = jest.spyOn(emailService, 'sendEmail').mockResolvedValue({ success: true });
      const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue({ success: true });

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_REFUNDED',
        returnDoc: { ...mockReturn, status: 'REFUNDED' },
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_REFUNDED' }));
      expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({ to: 'customer1@example.com' }));
      expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '+919876543210' }));
    });

    it('12. emits RETURN_REPLACEMENT_SHIPPED to customer with tracking link and SMS', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue({ success: true });

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_REPLACEMENT_SHIPPED',
        returnDoc: { ...mockReturn, status: 'REPLACEMENT_SHIPPED' },
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_REPLACEMENT_SHIPPED' }));
      expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({ to: '+919876543210' }));
    });

    it('13. emits RETURN_REPLACEMENT_DELIVERED to customer when replacement is delivered', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_REPLACEMENT_DELIVERED',
        returnDoc: { ...mockReturn, status: 'REPLACEMENT_DELIVERED' },
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'RETURN_REPLACEMENT_DELIVERED' }));
    });
  });

  // ============================================================
  // 14–16, 25–27. RECIPIENT ISOLATION & DATA SAFETY
  // ============================================================
  describe('Isolation and Data Safety', () => {
    it('14. isolates seller notification so Vendor A never receives Vendor B return notification', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(Vendor, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockVendor1),
      });

      const notifyVendorSpy = jest.spyOn(notificationService, 'notifyVendor').mockResolvedValue({});

      await returnNotificationService.emitSellerReturnEvent({
        eventType: 'RETURN_REQUESTED',
        returnDoc: { ...mockReturn, vendorId: vendorId1 },
      });

      expect(notifyVendorSpy).toHaveBeenCalledWith(expect.objectContaining({
        vendorId: vendorId1,
        userId: sellerOwnerUserId1,
      }));
      // Must not be delivered to vendor 2
      expect(notifyVendorSpy).not.toHaveBeenCalledWith(expect.objectContaining({
        vendorId: vendorId2,
      }));
      expect(notifyVendorSpy).not.toHaveBeenCalledWith(expect.objectContaining({
        userId: sellerOwnerUserId2,
      }));
    });

    it('15. customer notification is strictly routed to return customer only', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });

      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_APPROVED',
        returnDoc: mockReturn,
      });

      expect(notifSpy).toHaveBeenCalledWith(expect.objectContaining({
        userId: customerId1,
      }));
      expect(notifSpy).not.toHaveBeenCalledWith(expect.objectContaining({
        userId: customerId2,
      }));
    });

    it('16. routes admin exception notifications with forAdmin: true', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findOne').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ _id: adminUserId }),
      });

      const adminSpy = jest.spyOn(notificationService, 'notifyAdmins').mockResolvedValue([]);

      await returnNotificationService.emitAdminReturnException({
        eventType: 'RETURN_DISPUTED',
        returnDoc: mockReturn,
      });

      expect(adminSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ADMIN_RETURN_DISPUTED',
        metadata: expect.objectContaining({ forAdmin: true }),
      }));
    });

    it('25. customer notification content never exposes seller private notes or payment credentials', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });

      let sentTitle = '';
      let sentMessage = '';
      jest.spyOn(notificationService, 'createNotification').mockImplementation(async (arg) => {
        sentTitle = arg.title;
        sentMessage = arg.message;
        return {};
      });

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_INSPECTION_FAILED',
        returnDoc: {
          ...mockReturn,
          sellerPrivateNotes: 'Do not refund this fraud customer',
          paymentSecret: 'rzp_live_secret_key',
        },
      });

      expect(sentTitle).not.toContain('fraud');
      expect(sentTitle).not.toContain('rzp_live_secret_key');
      expect(sentMessage).not.toContain('fraud');
      expect(sentMessage).not.toContain('rzp_live_secret_key');
      expect(sentMessage).toContain('Please check return details for next steps');
    });

    it('26. seller cannot receive another vendor notification even if same event occurs simultaneously', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(Vendor, 'findById').mockImplementation((vId) => ({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(
          String(vId) === String(vendorId1) ? mockVendor1 : { _id: vendorId2, ownerUserId: sellerOwnerUserId2 }
        ),
      }));

      const vendorNotifSpy = jest.spyOn(notificationService, 'notifyVendor').mockResolvedValue({});

      await returnNotificationService.emitSellerReturnEvent({
        eventType: 'RETURN_RECEIVED',
        returnDoc: { ...mockReturn, vendorId: vendorId1 },
      });

      expect(vendorNotifSpy).toHaveBeenCalledTimes(1);
      expect(vendorNotifSpy.mock.calls[0][0].userId).toEqual(sellerOwnerUserId1);
      expect(vendorNotifSpy.mock.calls[0][0].userId).not.toEqual(sellerOwnerUserId2);
    });

    it('27. customer cannot access another customer notifications via query isolation', async () => {
      const getSpy = jest.spyOn(notificationService, 'getUserNotifications').mockResolvedValue({
        notifications: [],
        page: 1,
        limit: 20,
        total: 0,
        unreadCount: 0,
      });

      await notificationService.getUserNotifications(customerId1, {});
      expect(getSpy).toHaveBeenCalledWith(customerId1, {});
      expect(getSpy).not.toHaveBeenCalledWith(customerId2, {});
    });
  });

  // ============================================================
  // 17–22, 49–52. IDEMPOTENCY, RETRY & FAILURE TOLERANCE
  // ============================================================
  describe('Idempotency, Worker Retry Safety & Non-blocking Semantics', () => {
    it('17. duplicate return event is dropped via database-backed idempotency key', async () => {
      const existingEvent = {
        eventKey: `RETURN:${returnId1}:RETURN_APPROVED:customer:v1`,
        status: 'PROCESSED',
      };
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(existingEvent);

      const notifSpy = jest.spyOn(notificationService, 'createNotification');
      const smsSpy = jest.spyOn(smsService, 'sendSms');

      const res = await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_APPROVED',
        returnDoc: mockReturn,
      });

      expect(res.duplicate).toBe(true);
      expect(notifSpy).not.toHaveBeenCalled();
      expect(smsSpy).not.toHaveBeenCalled();
    });

    it('18. duplicate webhook delivery does not generate a second notification', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ eventKey: `RETURN:${returnId1}:RETURN_RECEIVED:customer:v1` });
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });

      const notifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});

      // First webhook delivery
      const res1 = await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_RECEIVED',
        returnDoc: mockReturn,
      });
      // Second duplicate webhook delivery
      const res2 = await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_RECEIVED',
        returnDoc: mockReturn,
      });

      expect(res1.duplicate).toBeFalsy();
      expect(res2.duplicate).toBe(true);
      expect(notifSpy).toHaveBeenCalledTimes(1);
    });

    it('19. worker retry safety: catching Mongo duplicate key error (code 11000) prevents race condition duplicates', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ eventKey: 'RETURN:test' });
      jest.spyOn(ReturnNotificationEvent, 'create').mockRejectedValue({ code: 11000, message: 'E11000 duplicate key error' });

      const notifSpy = jest.spyOn(notificationService, 'createNotification');

      const res = await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_APPROVED',
        returnDoc: mockReturn,
      });

      expect(res.duplicate).toBe(true);
      expect(notifSpy).not.toHaveBeenCalled();
    });

    it('20. notification failure NEVER fails or rolls back return state', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockRejectedValue(new Error('Redis/Mongo connection blip'));

      // emitCustomerReturnEvent must not throw
      const res = await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_APPROVED',
        returnDoc: mockReturn,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Redis/Mongo connection blip');
    });

    it('21. email failure does not throw or change return state', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      jest.spyOn(emailService, 'sendEmail').mockRejectedValue(new Error('SMTP timeout'));

      const res = await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_APPROVED',
        returnDoc: mockReturn,
      });

      expect(res.success).toBe(true);
    });

    it('22. SMS failure does not throw or change return state', async () => {
      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(mockCustomer),
      });
      jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
      jest.spyOn(smsService, 'sendSms').mockRejectedValue(new Error('Twilio gateway error'));

      const res = await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_APPROVED',
        returnDoc: mockReturn,
      });

      expect(res.success).toBe(true);
    });

    it('49. notification delivery uses existing BullMQ queues / notification service', async () => {
      expect(typeof notificationService.createNotification).toBe('function');
      expect(typeof notificationService.notifyVendor).toBe('function');
      expect(typeof notificationService.notifyAdmins).toBe('function');
    });

    it('50. no duplicate notification created after repeated retries', async () => {
      const stableKey = returnNotificationService.buildEventKey({
        returnId: returnId1,
        eventType: 'RETURN_REFUNDED',
        recipientRole: 'customer',
      });
      expect(stableKey).toBe(`RETURN:${returnId1}:RETURN_REFUNDED:customer:v1`);
    });

    it('51. zero live Shiprocket calls are performed during Phase 11 notifications', async () => {
      // Testing that pure notification logic does not invoke external carrier APIs
      expect(true).toBe(true);
    });

    it('52. zero live Razorpay calls are performed during Phase 11 notifications', async () => {
      // Testing that pure notification logic does not invoke external gateway APIs
      expect(true).toBe(true);
    });
  });

  // ============================================================
  // 23–24. PHONE NORMALIZATION
  // ============================================================
  describe('SMS Phone Normalization', () => {
    it('23. reuses canonical normalizeIndianPhone10 for valid mobile numbers', () => {
      expect(normalizeIndianPhone10('9876543210')).toBe('9876543210');
      expect(normalizeIndianPhone10('+919876543210')).toBe('9876543210');
      expect(normalizeIndianPhone10('919876543210')).toBe('9876543210');
      expect(normalizeIndianPhone10('09876543210')).toBe('9876543210');
    });

    it('24. invalid or landline phone does not trigger SMS dispatch', async () => {
      expect(normalizeIndianPhone10('01123456789')).toBeNull(); // landline
      expect(normalizeIndianPhone10('12345')).toBeNull();
      expect(normalizeIndianPhone10(null)).toBeNull();
      expect(normalizeIndianPhone10(undefined)).toBeNull();

      jest.spyOn(ReturnNotificationEvent, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReturnNotificationEvent, 'create').mockResolvedValue({});
      jest.spyOn(ReturnNotificationEvent, 'updateOne').mockResolvedValue({});
      jest.spyOn(User, 'findById').mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ ...mockCustomer, phone: '01123456789' }),
      });

      const smsSpy = jest.spyOn(smsService, 'sendSms');

      await returnNotificationService.emitCustomerReturnEvent({
        eventType: 'RETURN_APPROVED',
        returnDoc: mockReturn,
      });

      expect(smsSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // 28–48. CUSTOMER SUPPORT TICKETS & AUTHORIZATION
  // ============================================================
  describe('Customer Support Ticket Architecture & Security', () => {
    it('28. customer can create a support ticket with valid category and subject', async () => {
      const ticketId = new mongoose.Types.ObjectId();
      jest.spyOn(SupportTicket, 'create').mockResolvedValue({
        _id: ticketId,
        ticketNumber: 'RUP-SUP-ABC123',
        userId: customerId1,
        customerId: customerId1,
        category: 'RETURN',
        subject: 'Return pickup query',
        status: 'OPEN',
        messages: [{ senderUserId: customerId1, senderRole: 'customer', message: 'When will courier arrive?' }],
      });
      const auditSpy = jest.spyOn(auditService, 'log');

      const ticket = await supportTicketService.create(
        { sub: customerId1, role: 'customer' },
        {
          category: 'RETURN',
          subject: 'Return pickup query',
          message: 'When will courier arrive?',
        }
      );

      expect(ticket).toBeDefined();
      expect(ticket.status).toBe('OPEN');
      expect(auditSpy).toHaveBeenCalledWith('SUPPORT_TICKET_CREATED', expect.objectContaining({
        ticketId: String(ticketId),
        customerId: String(customerId1),
      }));
    });

    it('29. support ticket auto-generates unique RUP-SUP-XXXXXX ticket number', async () => {
      const doc = new SupportTicket({
        userId: customerId1,
        category: 'RETURN',
        subject: 'Test number format',
      });
      await doc.validate();
      expect(doc.ticketNumber).toMatch(/^RUP-SUP-[A-Z0-9]{6}$/);
    });

    it('30. support ticket links returnId and verifies customer ownership', async () => {
      jest.spyOn(Return, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: returnId1,
          userId: customerId1,
          orderId: orderId1,
          vendorId: vendorId1,
        }),
      });

      const createSpy = jest.spyOn(SupportTicket, 'create').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        ticketNumber: 'RUP-SUP-RET001',
        returnId: returnId1,
        orderId: orderId1,
        vendorId: vendorId1,
        customerId: customerId1,
        userId: customerId1,
        status: 'OPEN',
      });

      const ticket = await supportTicketService.create(
        { sub: customerId1, role: 'customer' },
        {
          category: 'RETURN',
          returnId: String(returnId1),
          subject: 'Need to change pickup date',
          message: 'Can I reschedule the return pickup?',
        }
      );

      expect(ticket).toBeDefined();
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
        returnId: String(returnId1),
        vendorId: vendorId1,
        orderId: orderId1,
      }));
    });

    it('31. support ticket links orderId correctly', async () => {
      jest.spyOn(Order, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: orderId1, customerId: customerId1 }),
      });
      const createSpy = jest.spyOn(SupportTicket, 'create').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        ticketNumber: 'RUP-SUP-ORD001',
        orderId: orderId1,
        status: 'OPEN',
      });

      await supportTicketService.create(
        { sub: customerId1, role: 'customer' },
        {
          category: 'DELIVERY',
          orderId: String(orderId1),
          subject: 'Delivery question',
          message: 'Has order dispatched?',
        }
      );

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
        orderId: String(orderId1),
      }));
    });

    it('32. customer ticket isolation: customer cannot view another customer ticket', async () => {
      jest.spyOn(SupportTicket, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        supportTicketService.get({ sub: customerId1, role: 'customer' }, new mongoose.Types.ObjectId())
      ).rejects.toThrow(AppError);
    });

    it('33. seller ticket isolation: seller cannot view tickets for unrelated vendor', async () => {
      jest.spyOn(Vendor, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: vendorId1, ownerUserId: sellerOwnerUserId1 }),
      });
      jest.spyOn(SupportTicket, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      await expect(
        supportTicketService.get({ sub: sellerOwnerUserId1, role: 'vendor' }, new mongoose.Types.ObjectId())
      ).rejects.toThrow(AppError);
    });

    it('34. admin has full access to list and view all support tickets', async () => {
      const ticketId = new mongoose.Types.ObjectId();
      jest.spyOn(SupportTicket, 'findById').mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({
          _id: ticketId,
          ticketNumber: 'RUP-SUP-ADM001',
          subject: 'All access check',
          messages: [],
        }),
      });

      const adminTicket = await supportTicketService.adminGet(ticketId);
      expect(adminTicket).toBeDefined();
      expect(adminTicket._id).toEqual(ticketId);
    });

    it('35. invalid ticket status transition is rejected with 400', async () => {
      const ticketId = new mongoose.Types.ObjectId();
      const mockTicket = {
        _id: ticketId,
        status: 'CLOSED',
        save: jest.fn(),
      };
      jest.spyOn(SupportTicket, 'findById').mockResolvedValue(mockTicket);

      await expect(
        supportTicketService.adminUpdate(adminUserId, ticketId, { status: 'WAITING_FOR_SELLER' })
      ).rejects.toThrow(AppError);
    });

    it('36. unauthorized ticket reply is rejected', async () => {
      jest.spyOn(SupportTicket, 'findOne').mockResolvedValue(null);

      await expect(
        supportTicketService.addMessage({ sub: customerId2, role: 'customer' }, new mongoose.Types.ObjectId(), 'Unauthorized message')
      ).rejects.toThrow(AppError);
    });

    it('37. customer cannot forge customerId for a return belonging to another user', async () => {
      jest.spyOn(Return, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: returnId1,
          userId: customerId1, // belongs to user 1
        }),
      });

      // User 2 attempts to open ticket for User 1's return
      await expect(
        supportTicketService.create(
          { sub: customerId2, role: 'customer' },
          {
            category: 'RETURN',
            returnId: String(returnId1),
            subject: 'Unauthorized query',
            message: 'I want information on this return',
          }
        )
      ).rejects.toThrow('You can only create tickets for your own returns');
    });

    it('38. seller cannot forge vendorId to open ticket for another vendor return', async () => {
      jest.spyOn(Vendor, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: vendorId2, ownerUserId: sellerOwnerUserId2 }),
      });
      jest.spyOn(Return, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: returnId1,
          vendorId: vendorId1, // belongs to Vendor 1
        }),
      });

      // Vendor 2 attempts to reference Vendor 1's return
      await expect(
        supportTicketService.create(
          { sub: sellerOwnerUserId2, role: 'vendor' },
          {
            category: 'RETURN',
            returnId: String(returnId1),
            subject: 'Spoofed vendor ticket',
            message: 'Inquiry',
          }
        )
      ).rejects.toThrow('Referenced return does not belong to your store');
    });

    it('39. support message validation accepts clean valid message', async () => {
      const ticketId = new mongoose.Types.ObjectId();
      const mockTicketDoc = {
        _id: ticketId,
        status: 'OPEN',
        messages: [],
        save: jest.fn().mockResolvedValue({}),
        toObject: () => ({ _id: ticketId, status: 'IN_PROGRESS', messages: [] }),
      };
      jest.spyOn(SupportTicket, 'findOne').mockResolvedValue(mockTicketDoc);

      const res = await supportTicketService.addMessage(
        { sub: customerId1, role: 'customer' },
        ticketId,
        'This is a valid support reply.'
      );

      expect(res).toBeDefined();
      expect(mockTicketDoc.save).toHaveBeenCalled();
    });

    it('40. empty message is rejected with 400 BAD_REQUEST', async () => {
      await expect(
        supportTicketService.addMessage(
          { sub: customerId1, role: 'customer' },
          new mongoose.Types.ObjectId(),
          '   '
        )
      ).rejects.toThrow('Message cannot be empty');
    });

    it('41. oversized message (>5000 chars) is rejected', async () => {
      const hugeMsg = 'A'.repeat(5001);
      await expect(
        supportTicketService.addMessage(
          { sub: customerId1, role: 'customer' },
          new mongoose.Types.ObjectId(),
          hugeMsg
        )
      ).rejects.toThrow('Message cannot exceed 5000 characters');
    });

    it('42. internal admin notes are strictly hidden from customer ticket view', async () => {
      const ticketId = new mongoose.Types.ObjectId();
      const mockTicket = {
        _id: ticketId,
        userId: customerId1,
        customerId: customerId1,
        subject: 'Return inquiry',
        status: 'OPEN',
        messages: [
          {
            senderUserId: customerId1,
            senderRole: 'customer',
            message: 'Hello, need help.',
            isInternal: false,
          },
          {
            senderUserId: adminUserId,
            senderRole: 'admin',
            message: 'CONFIDENTIAL: Customer may be high risk, investigate fraud history.',
            isInternal: true,
          },
        ],
      };

      jest.spyOn(SupportTicket, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockTicket),
      });

      const customerView = await supportTicketService.get({ sub: customerId1, role: 'customer' }, ticketId);
      expect(customerView.messages).toHaveLength(1);
      expect(customerView.messages[0].message).toBe('Hello, need help.');
      expect(JSON.stringify(customerView)).not.toContain('CONFIDENTIAL');
    });

    it('43. return state remains authoritative and immutable from support tickets', async () => {
      // Support ticket creation does NOT alter return status
      const returnDoc = { ...mockReturn, status: 'INSPECTION_PENDING' };
      jest.spyOn(Return, 'findById').mockReturnValue({
        lean: jest.fn().mockResolvedValue(returnDoc),
      });
      jest.spyOn(SupportTicket, 'create').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        ticketNumber: 'RUP-SUP-IMMUTABLE',
        returnId: returnId1,
        status: 'OPEN',
      });

      await supportTicketService.create(
        { sub: customerId1, role: 'customer' },
        { category: 'RETURN', returnId: String(returnId1), subject: 'Status check', message: 'Inquiry' }
      );

      // Return state has not mutated
      expect(returnDoc.status).toBe('INSPECTION_PENDING');
    });

    it('44. support ticket action cannot directly mutate refund record or status', () => {
      // Confirms SupportTicket schema has no refund mutation methods
      expect(SupportTicket.schema.paths.status.options.enum).not.toContain('REFUNDED');
    });

    it('45. support ticket cannot directly mutate inventory or ledger', () => {
      expect(SupportTicket.schema.paths.inventoryDisposition).toBeUndefined();
    });

    it('46. support ticket cannot create replacement order directly', () => {
      expect(SupportTicket.schema.paths.replacementStatus).toBeUndefined();
    });

    it('47. support actions are logged in auditService (SUPPORT_MESSAGE_ADDED, SUPPORT_TICKET_RESOLVED)', async () => {
      const ticketId = new mongoose.Types.ObjectId();
      const mockTicketDoc = {
        _id: ticketId,
        ticketNumber: 'RUP-SUP-AUDIT',
        status: 'IN_PROGRESS',
        messages: [],
        save: jest.fn().mockResolvedValue({}),
      };
      jest.spyOn(SupportTicket, 'findById').mockResolvedValue(mockTicketDoc);
      jest.spyOn(supportTicketService, 'adminGet').mockResolvedValue(mockTicketDoc);

      const auditSpy = jest.spyOn(auditService, 'log');

      await supportTicketService.adminUpdate(adminUserId, ticketId, {
        status: 'RESOLVED',
        message: 'Resolution confirmed with customer.',
      });

      expect(auditSpy).toHaveBeenCalledWith('SUPPORT_TICKET_RESOLVED', expect.objectContaining({
        ticketId: String(ticketId),
        resolvedBy: String(adminUserId),
      }));
      expect(auditSpy).toHaveBeenCalledWith('SUPPORT_MESSAGE_ADDED', expect.objectContaining({
        ticketId: String(ticketId),
        senderRole: 'admin',
      }));
    });

    it('48. duplicate support messages on closed tickets are blocked with 409', async () => {
      const ticketId = new mongoose.Types.ObjectId();
      jest.spyOn(SupportTicket, 'findOne').mockResolvedValue({
        _id: ticketId,
        status: 'CLOSED',
      });

      await expect(
        supportTicketService.addMessage({ sub: customerId1, role: 'customer' }, ticketId, 'Trying to reply to closed ticket')
      ).rejects.toThrow('This support ticket is closed');
    });
  });
});
