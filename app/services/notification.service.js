import { AppError } from '../utils/app-error.js';
import { Notification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';

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

  async notifyAdmins({ type, title, message, channel = 'IN_APP', metadata = {} }) {
    const adminMetadata = { ...metadata, forAdmin: true };
    const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();

    if (!admins || admins.length === 0) {
      // In case no admin exists in active collection, find any user or fallback
      const anyUser = await User.findOne({}).select('_id').lean();
      if (anyUser) {
        return [await this.createNotification({
          userId: anyUser._id,
          type,
          title,
          message,
          channel,
          metadata: adminMetadata,
        }).catch(() => null)].filter(Boolean);
      }
      return [];
    }

    const created = await Promise.all(
      admins.map((admin) =>
        this.createNotification({
          userId: admin._id,
          type,
          title,
          message,
          channel,
          metadata: adminMetadata,
        }).catch(() => null)
      )
    );
    return created.filter(Boolean);
  }

  async sendNotification(notificationId) {
    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { status: 'SENT', sentAt: new Date() },
      { new: true },
    );
    return notification ? (notification.toObject ? notification.toObject() : notification) : null;
  }

  async markAsRead(notificationId, userId, role = null) {
    let query = { _id: notificationId, userId };
    if (role === 'admin') {
      query = {
        _id: notificationId,
        $or: [
          { userId },
          { 'metadata.forAdmin': true },
          { type: { $regex: /^ADMIN_/i } },
        ],
      };
    }
    const notification = await Notification.findOne(query);
    if (!notification) {
      throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    }

    await Notification.findByIdAndUpdate(notificationId, { readAt: new Date() });
    return true;
  }

  async markAllAsRead(userId, role = null) {
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    let filter = { userId, readAt: null, createdAt: { $gte: cutoff } };
    if (role === 'admin') {
      filter = {
        readAt: null,
        createdAt: { $gte: cutoff },
        $or: [
          { userId },
          { 'metadata.forAdmin': true },
          { type: { $regex: /^ADMIN_/i } },
        ],
      };
    }
    const result = await Notification.updateMany(filter, { readAt: new Date() });
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

  async getAdminNotifications(adminUserId, { page = 1, limit = 20, unreadOnly = false }) {
    const skip = (page - 1) * limit;
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const filter = {
      createdAt: { $gte: cutoff },
      $or: [
        { userId: adminUserId },
        { 'metadata.forAdmin': true },
        { type: { $regex: /^ADMIN_/i } },
      ],
    };
    if (unreadOnly) filter.readAt = null;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({
      ...filter,
      readAt: null,
    });

    return { notifications, page, limit, total, unreadCount };
  }

  async getUnreadCount(userId) {
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    return Notification.countDocuments({ userId, readAt: null, createdAt: { $gte: cutoff } });
  }
}

export const notificationService = new NotificationService();
