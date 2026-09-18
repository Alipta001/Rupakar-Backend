import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listNotifications, getUnreadCount, markNotificationAsRead, markAllNotificationsAsRead, listAdminNotifications } from '../controllers/notification.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', listNotifications);
router.get('/unread-count', getUnreadCount);
router.patch('/:id/read', markNotificationAsRead);
router.patch('/read-all', markAllNotificationsAsRead);

router.use(requireRole('admin'));
router.get('/admin/list', listAdminNotifications);

export default router;
