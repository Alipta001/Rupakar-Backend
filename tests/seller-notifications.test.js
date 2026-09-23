import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.unstable_mockModule('../app/jobs/queues.js', () => ({
  scheduleNotification: jest.fn().mockResolvedValue('notif-job-1'),
  scheduleInvoiceGeneration: jest.fn().mockResolvedValue('invoice-job-1'),
  schedulePackingSlipGeneration: jest.fn().mockResolvedValue('packing-slip-job-1'),
}));

const { paymentService } = await import('../app/services/payment.service.js');
const { notificationService } = await import('../app/services/notification.service.js');
const { emailService } = await import('../app/services/email.service.js');
const { smsService } = await import('../app/services/sms.service.js');
const { Order } = await import('../app/models/order.model.js');
const { VendorOrder } = await import('../app/models/vendor-order.model.js');
const { Vendor } = await import('../app/models/vendor.model.js');
const { User } = await import('../app/models/user.model.js');
const { Notification } = await import('../app/models/notification.model.js');
const { vendorLedgerService } = await import('../app/services/vendor-ledger.service.js');

const query = (value) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
});

describe('Seller Notifications on Order Placement/Confirmation', () => {
  const customerId = new mongoose.Types.ObjectId();
  const orderId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const vendorId1 = new mongoose.Types.ObjectId();
  const vendorId2 = new mongoose.Types.ObjectId();
  const vendorUser1 = new mongoose.Types.ObjectId();
  const vendorUser2 = new mongoose.Types.ObjectId();
  const vendorOrder1 = new mongoose.Types.ObjectId();
  const vendorOrder2 = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('notifies affected vendor via persistent in-app, email, and SMS when valid phone exists', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      orderNumber: 'ORD-1001',
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
      total: 1500,
      currency: 'INR',
      items: [
        { vendorId: vendorId1, productId: new mongoose.Types.ObjectId(), variantId: new mongoose.Types.ObjectId(), quantity: 2, lineTotal: 1500 },
      ],
    };

    jest.spyOn(Order, 'findById').mockReturnValue(query(mockOrder));
    jest.spyOn(Order, 'updateOne').mockResolvedValue({});
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({
      _id: vendorOrder1,
      parentOrderId: orderId,
      vendorId: vendorId1,
      total: 1500,
      status: 'CONFIRMED',
    });
    jest.spyOn(Vendor, 'findById').mockReturnValue(query({ _id: vendorId1, ownerUserId: vendorUser1 }));
    jest.spyOn(User, 'findById').mockReturnValue(query({
      _id: vendorUser1,
      email: 'artisan@rupakar.in',
      phone: '+919876543210',
    }));
    jest.spyOn(Notification, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(vendorLedgerService, 'recordCapturedPayment').mockResolvedValue({});

    const createNotifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
    const emailSpy = jest.spyOn(emailService, 'sendEmail').mockResolvedValue({});
    const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue({});

    await paymentService.ensureCapturedOrderArtifacts(orderId, paymentId, { status: 'CAPTURED' });

    // 1. Persistent in-app notification
    expect(createNotifSpy).toHaveBeenCalledWith(expect.objectContaining({
      userId: vendorUser1,
      type: 'VENDOR_ORDER_CONFIRMED',
      channel: 'IN_APP',
      metadata: expect.objectContaining({
        orderId,
        vendorOrderId: vendorOrder1,
        idempotencyKey: `vendor-order-confirmed:${vendorOrder1}`,
      }),
    }));

    // 2. Email dispatched
    expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({
      to: 'artisan@rupakar.in',
      subject: expect.stringContaining('ORD-1001'),
    }));

    // 3. SMS dispatched to valid phone
    expect(smsSpy).toHaveBeenCalledWith(expect.objectContaining({
      to: '+919876543210',
      message: expect.stringContaining('ORD-1001'),
    }));
  });

  it('skips SMS when phone is missing or invalid without failing the order', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      orderNumber: 'ORD-1002',
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
      total: 800,
      items: [{ vendorId: vendorId1, quantity: 1, lineTotal: 800 }],
    };

    jest.spyOn(Order, 'findById').mockReturnValue(query(mockOrder));
    jest.spyOn(Order, 'updateOne').mockResolvedValue({});
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: vendorOrder1, total: 800 });
    jest.spyOn(Vendor, 'findById').mockReturnValue(query({ _id: vendorId1, ownerUserId: vendorUser1 }));
    jest.spyOn(User, 'findById').mockReturnValue(query({
      _id: vendorUser1,
      email: 'artisan@rupakar.in',
      phone: '', // missing phone
    }));
    jest.spyOn(Notification, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(vendorLedgerService, 'recordCapturedPayment').mockResolvedValue({});

    const createNotifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
    const emailSpy = jest.spyOn(emailService, 'sendEmail').mockResolvedValue({});
    const smsSpy = jest.spyOn(smsService, 'sendSms');

    const result = await paymentService.ensureCapturedOrderArtifacts(orderId, paymentId, { status: 'CAPTURED' });

    expect(result.skipped).toBe(false);
    expect(createNotifSpy).toHaveBeenCalled();
    expect(emailSpy).toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
  });

  it('multi-vendor order notifies each affected vendor independently', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      orderNumber: 'ORD-MULTI',
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
      total: 2000,
      items: [
        { vendorId: vendorId1, quantity: 1, lineTotal: 1200 },
        { vendorId: vendorId2, quantity: 1, lineTotal: 800 },
      ],
    };

    jest.spyOn(Order, 'findById').mockReturnValue(query(mockOrder));
    jest.spyOn(Order, 'updateOne').mockResolvedValue({});
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);
    jest.spyOn(VendorOrder, 'create')
      .mockResolvedValueOnce({ _id: vendorOrder1, total: 1200 })
      .mockResolvedValueOnce({ _id: vendorOrder2, total: 800 });

    jest.spyOn(Vendor, 'findById')
      .mockReturnValueOnce(query({ _id: vendorId1, ownerUserId: vendorUser1 }))
      .mockReturnValueOnce(query({ _id: vendorId2, ownerUserId: vendorUser2 }));

    jest.spyOn(User, 'findById')
      .mockReturnValueOnce(query({ _id: vendorUser1, email: 'vendor1@rupakar.in', phone: '9876543210' }))
      .mockReturnValueOnce(query({ _id: vendorUser2, email: 'vendor2@rupakar.in', phone: '9876543211' }));

    jest.spyOn(Notification, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    jest.spyOn(vendorLedgerService, 'recordCapturedPayment').mockResolvedValue({});

    const createNotifSpy = jest.spyOn(notificationService, 'createNotification').mockResolvedValue({});
    const emailSpy = jest.spyOn(emailService, 'sendEmail').mockResolvedValue({});

    await paymentService.ensureCapturedOrderArtifacts(orderId, paymentId, { status: 'CAPTURED' });

    expect(createNotifSpy).toHaveBeenCalledTimes(2);
    expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({ to: 'vendor1@rupakar.in' }));
    expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({ to: 'vendor2@rupakar.in' }));
  });

  it('prevents duplicate notifications from retries or webhooks', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      orderNumber: 'ORD-DUP',
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
      total: 500,
      items: [{ vendorId: vendorId1, quantity: 1, lineTotal: 500 }],
    };

    jest.spyOn(Order, 'findById').mockReturnValue(query(mockOrder));
    jest.spyOn(Order, 'updateOne').mockResolvedValue({});
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue({ _id: vendorOrder1, status: 'CONFIRMED' });
    jest.spyOn(Vendor, 'findById').mockReturnValue(query({ _id: vendorId1, ownerUserId: vendorUser1 }));
    jest.spyOn(User, 'findById').mockReturnValue(query({ _id: vendorUser1, email: 'artisan@rupakar.in' }));

    // Notification already exists in DB!
    jest.spyOn(Notification, 'findOne').mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'notif-1', metadata: { idempotencyKey: `vendor-order-confirmed:${vendorOrder1}` } }),
    });
    jest.spyOn(vendorLedgerService, 'recordCapturedPayment').mockResolvedValue({});

    const createNotifSpy = jest.spyOn(notificationService, 'createNotification');
    const emailSpy = jest.spyOn(emailService, 'sendEmail');
    const smsSpy = jest.spyOn(smsService, 'sendSms');

    await paymentService.ensureCapturedOrderArtifacts(orderId, paymentId, { status: 'CAPTURED' });

    // Must NOT send again
    expect(createNotifSpy).not.toHaveBeenCalled();
    expect(emailSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
  });

  it('notification failure is isolated and does not roll back the order or payment', async () => {
    const mockOrder = {
      _id: orderId,
      customerId,
      orderNumber: 'ORD-FAIL-ISO',
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
      total: 1000,
      items: [{ vendorId: vendorId1, quantity: 1, lineTotal: 1000 }],
    };

    jest.spyOn(Order, 'findById').mockReturnValue(query(mockOrder));
    jest.spyOn(Order, 'updateOne').mockResolvedValue({});
    jest.spyOn(VendorOrder, 'findOne').mockResolvedValue(null);
    jest.spyOn(VendorOrder, 'create').mockResolvedValue({ _id: vendorOrder1, total: 1000 });
    jest.spyOn(Vendor, 'findById').mockReturnValue(query({ _id: vendorId1, ownerUserId: vendorUser1 }));
    jest.spyOn(User, 'findById').mockReturnValue(query({
      _id: vendorUser1,
      email: 'artisan@rupakar.in',
      phone: '+919876543210',
    }));
    jest.spyOn(Notification, 'findOne').mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    // Notification services throw unexpected errors
    jest.spyOn(notificationService, 'createNotification').mockRejectedValue(new Error('DB_NOTIFICATION_OUTAGE'));
    jest.spyOn(emailService, 'sendEmail').mockRejectedValue(new Error('EMAIL_SERVICE_OUTAGE'));
    jest.spyOn(smsService, 'sendSms').mockRejectedValue(new Error('SMS_GATEWAY_DOWN'));
    jest.spyOn(vendorLedgerService, 'recordCapturedPayment').mockResolvedValue({});

    // Must NOT throw despite all notification channels failing
    const result = await paymentService.ensureCapturedOrderArtifacts(orderId, paymentId, { status: 'CAPTURED' });

    expect(result.skipped).toBe(false);
    expect(result.vendorOrders).toContain(vendorOrder1);
  });
});
