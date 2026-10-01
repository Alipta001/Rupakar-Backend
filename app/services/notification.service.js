import { AppError } from '../utils/app-error.js';
import { Notification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';
import { Vendor } from '../models/vendor.model.js';
import { env } from '../config/env.js';

export class NotificationService {
  getRetentionCutoff(retentionDays = null) {
    const days = Number(retentionDays ?? env.READ_NOTIFICATION_RETENTION_DAYS ?? 15);
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  async cleanupExpiredReadNotifications({ retentionDays = null } = {}) {
    const cutoff = this.getRetentionCutoff(retentionDays);
    const result = await Notification.deleteMany({
      readAt: { $ne: null, $lt: cutoff },
    });
    return { deletedCount: result?.deletedCount ?? 0 };
  }

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

  async notifyVendor({ vendorId, userId, type, title, message, channel = 'IN_APP', metadata = {} }) {
    let targetUserId = userId;
    if (!targetUserId && vendorId) {
      const vendor = await Vendor.findById(vendorId).select('ownerUserId').lean();
      targetUserId = vendor?.ownerUserId;
    }
    if (!targetUserId) return null;

    return this.createNotification({
      userId: targetUserId,
      type,
      title,
      message,
      channel,
      metadata: { ...metadata, vendorId: vendorId ? String(vendorId) : undefined },
    }).catch(() => null);
  }

  async notifyAdmins({ type, title, message, channel = 'IN_APP', metadata = {} }) {
    const adminMetadata = { ...metadata, forAdmin: true };
    const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();

    if (!admins || admins.length === 0) {
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
    let filter = { userId, readAt: null };
    if (role === 'admin') {
      filter = {
        readAt: null,
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
    let filter;
    if (unreadOnly) {
      filter = { userId, readAt: null };
    } else {
      const cutoff = this.getRetentionCutoff();
      filter = {
        userId,
        $or: [{ readAt: null }, { readAt: { $gte: cutoff } }],
      };
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({ userId, readAt: null });

    return { notifications, page, limit, total, unreadCount };
  }

  async getAdminNotifications(adminUserId, { page = 1, limit = 20, unreadOnly = false }) {
    const skip = (page - 1) * limit;
    const adminCriteria = {
      $or: [
        { userId: adminUserId },
        { 'metadata.forAdmin': true },
        { type: { $regex: /^ADMIN_/i } },
      ],
    };

    let filter;
    if (unreadOnly) {
      filter = { ...adminCriteria, readAt: null };
    } else {
      const cutoff = this.getRetentionCutoff();
      filter = {
        ...adminCriteria,
        $nor: [{ readAt: { $ne: null, $lt: cutoff } }],
      };
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({
      ...adminCriteria,
      readAt: null,
    });

    return { notifications, page, limit, total, unreadCount };
  }

  async getUnreadCount(userId, role = null) {
    if (role === 'admin') {
      return Notification.countDocuments({
        $or: [
          { userId },
          { 'metadata.forAdmin': true },
          { type: { $regex: /^ADMIN_/i } },
        ],
        readAt: null,
      });
    }
    return Notification.countDocuments({ userId, readAt: null });
  }
}

export const notificationService = new NotificationService();
