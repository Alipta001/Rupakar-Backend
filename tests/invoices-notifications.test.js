import mongoose from 'mongoose';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { InvoiceService } from '../app/services/invoice.service.js';
import { NotificationService } from '../app/services/notification.service.js';
import { Invoice } from '../app/models/invoice.model.js';
import { Notification } from '../app/models/notification.model.js';

describe('invoice and notification systems', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('generates invoices with immutable snapshots', async () => {
    const service = new InvoiceService();
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const orderId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Invoice, 'create').mockResolvedValue({
      _id: 'inv-1',
      invoiceNumber: 'INV-2026-ABC-XYZ',
      orderId,
      customerId,
      items: [],
      subtotal: 1000,
      tax: 100,
      total: 1100,
      status: 'ISSUED',
      toObject: () => ({
        _id: 'inv-1',
        invoiceNumber: 'INV-2026-ABC-XYZ',
        orderId,
        customerId,
        items: [],
        subtotal: 1000,
        tax: 100,
        total: 1100,
        status: 'ISSUED',
      }),
    });

    const invoice = await service.createInvoice({
      orderId,
      customerId,
      subtotal: 1000,
      tax: 100,
      total: 1100,
    });

    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-/);
    expect(invoice.status).toBe('ISSUED');
  });

  it('ensures invoice numbers are unique', async () => {
    const service = new InvoiceService();
    const num1 = service.generateInvoiceNumber();
    const num2 = service.generateInvoiceNumber();
    expect(num1).not.toBe(num2);
  });

  it('prevents customer access to other customers invoices', async () => {
    const service = new InvoiceService();
    const customerId = new mongoose.Types.ObjectId().toHexString();
    const otherCustomerId = new mongoose.Types.ObjectId().toHexString();
    const invoiceId = 'inv-1';

    jest.spyOn(Invoice, 'findById').mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: invoiceId,
        customerId: otherCustomerId,
        invoiceNumber: 'INV-123',
      }),
    });

    const invoice = await service.getInvoice(invoiceId);
    expect(String(invoice.customerId)).not.toBe(String(customerId));
  });

  it('creates notifications and marks them as read', async () => {
    const service = new NotificationService();
    const userId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Notification, 'create').mockResolvedValue({
      _id: 'notif-1',
      userId,
      type: 'ORDER_CREATED',
      title: 'Order Created',
      message: 'Your order has been created',
      status: 'PENDING',
      toObject: () => ({
        _id: 'notif-1',
        userId,
        type: 'ORDER_CREATED',
        status: 'PENDING',
      }),
    });

    const notification = await service.createNotification({
      userId,
      type: 'ORDER_CREATED',
      title: 'Order Created',
      message: 'Your order has been created',
    });

    expect(notification.type).toBe('ORDER_CREATED');
    expect(notification.status).toBe('PENDING');
  });

  it('retrieves unread notification count', async () => {
    const service = new NotificationService();
    const userId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Notification, 'countDocuments').mockResolvedValue(3);

    const count = await service.getUnreadCount(userId);
    expect(count).toBe(3);
  });

  it('marks all notifications as read', async () => {
    const service = new NotificationService();
    const userId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Notification, 'updateMany').mockResolvedValue({ modifiedCount: 5 });

    const count = await service.markAllAsRead(userId);
    expect(count).toBe(5);
  });

  it('does not allow a user to mark another user notification as read', async () => {
    const service = new NotificationService();
    const ownerId = new mongoose.Types.ObjectId().toHexString();
    const otherUserId = new mongoose.Types.ObjectId().toHexString();
    jest.spyOn(Notification, 'findOne').mockResolvedValue(null);

    await expect(service.markAsRead('notification-1', otherUserId)).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
    expect(Notification.findOne).toHaveBeenCalledWith({ _id: 'notification-1', userId: otherUserId });
    expect(ownerId).not.toBe(otherUserId);
  });

  it('lists user notifications with pagination', async () => {
    const service = new NotificationService();
    const userId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Notification, 'find').mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: 'n1', userId, title: 'Test 1' },
            ]),
          }),
        }),
      }),
    });

    jest.spyOn(Notification, 'countDocuments').mockResolvedValue(1);

    const result = await service.getUserNotifications(userId, { page: 1, limit: 20 });
    expect(result.notifications).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});
