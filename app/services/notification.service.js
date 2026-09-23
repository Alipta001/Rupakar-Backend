import { AppError } from '../utils/app-error.js';
import { Notification } from '../models/notification.model.js';

export class NotificationService {
  async createNotification({
    userId,
    type,
    title,
    message,
    channel = 'IN_APP',
    recipient = null,
    metadata = {},
  }) {
    if (!userId || !type || !title || !message) {
      throw new AppError(400, 'INVALID_NOTIFICATION_DATA', 'User, type, title, and message are required');
    }

    const idempotencyKey = metadata?.idempotencyKey;
    if (idempotencyKey) {
      const existing = await Notification.findOne({ userId, 'metadata.idempotencyKey': idempotencyKey }).lean();
      if (existing) return existing;
    }

    const notification = await Notification.create({
      userId,
      type,
      title,
      message,
      channel,
      recipient,
      metadata,
      status: 'PENDING',
    });

    return notification.toObject ? notification.toObject() : notification;
  }

  async sendNotification(notificationId) {
    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { status: 'SENT', sentAt: new Date() },
      { new: true },
    );
    return notification ? (notification.toObject ? notification.toObject() : notification) : null;
  }

  async markAsRead(notificationId, userId) {
    const notification = await Notification.findOne({ _id: notificationId, userId });
    if (!notification) {
      throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    }

    await Notification.findByIdAndUpdate(notificationId, { readAt: new Date() });
    return true;
  }

  async markAllAsRead(userId) {
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const result = await Notification.updateMany({ userId, readAt: null, createdAt: { $gte: cutoff } }, { readAt: new Date() });
    return result.modifiedCount;
  }

  async getUserNotifications(userId, { page = 1, limit = 20, unreadOnly = false }) {
    const skip = (page - 1) * limit;
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const filter = { userId, createdAt: { $gte: cutoff } };
    if (unreadOnly) filter.readAt = null;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ userId, readAt: null, createdAt: { $gte: cutoff } });

    return { notifications, page, limit, total, unreadCount };
  }

  async getUnreadCount(userId) {
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    return Notification.countDocuments({ userId, readAt: null, createdAt: { $gte: cutoff } });
  }
}

export const notificationService = new NotificationService();
