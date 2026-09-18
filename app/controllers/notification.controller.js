import { Notification } from '../models/notification.model.js';
import { sendSuccess } from '../utils/response.js';
import { notificationService } from '../services/notification.service.js';
import { listNotificationsQuerySchema, notificationIdSchema } from '../validators/notification.validators.js';

const getMeta = (query = {}) => {
  const { page, limit, unreadOnly } = listNotificationsQuerySchema.parse(query ?? {});
  return { page, limit, skip: (page - 1) * limit, unreadOnly };
};

export const listNotifications = async (req, res, next) => {
  try {
    const { page, limit, unreadOnly } = getMeta(req.query);
    const result = await notificationService.getUserNotifications(req.user.sub, {
      page,
      limit,
      unreadOnly,
    });

    sendSuccess(res, {
      items: result.notifications,
      page: result.page,
      limit: result.limit,
      total: result.total,
      unreadCount: result.unreadCount,
    }, 'Notifications loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await notificationService.getUnreadCount(req.user.sub);
    sendSuccess(res, { unreadCount }, 'Unread count retrieved', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const markNotificationAsRead = async (req, res, next) => {
  try {
    const { id } = notificationIdSchema.parse({ id: req.params.id });
    await notificationService.markAsRead(id, req.user.sub);
    sendSuccess(res, { success: true }, 'Notification marked as read', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    const count = await notificationService.markAllAsRead(req.user.sub);
    sendSuccess(res, { markedCount: count }, 'All notifications marked as read', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listAdminNotifications = async (req, res, next) => {
  try {
    const { page, limit } = getMeta(req.query);
    const skip = (page - 1) * limit;

    const notifications = await Notification.find({})
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Notification.countDocuments({});

    sendSuccess(res, { items: notifications, page, limit, total }, 'Admin notifications loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};
