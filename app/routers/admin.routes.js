import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listAdminOrders, getAdminOrder } from '../controllers/order.controller.js';
import { listAdminShipments, getAdminShipment, updateAdminShipmentStatus } from '../controllers/shipping.controller.js';
import { listAdminReturns, getAdminReturn, approveReturn, rejectReturn } from '../controllers/return.controller.js';
import { listAdminInvoices, getAdminInvoiceDetail } from '../controllers/invoice.controller.js';
import { listAdminNotifications } from '../controllers/notification.controller.js';
import { listAdminSupportTickets, updateAdminSupportTicket } from '../controllers/support.controller.js';

const router = Router();

router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/dashboard', (_req, res) => {
  res.status(200).json({
    success: true,
    data: { dashboard: 'admin' },
    message: 'Admin dashboard ready',
    requestId: String(_req.headers['x-request-id'] ?? ''),
  });
});

router.get('/orders', listAdminOrders);
router.get('/orders/:id', getAdminOrder);
router.get('/shipments', listAdminShipments);
router.get('/shipments/:id', getAdminShipment);
router.patch('/shipments/:id/status', updateAdminShipmentStatus);
router.get('/returns', listAdminReturns);
router.get('/returns/:id', getAdminReturn);
router.patch('/returns/:id/approve', approveReturn);
router.patch('/returns/:id/reject', rejectReturn);
router.get('/invoices', listAdminInvoices);
router.get('/invoices/:id', getAdminInvoiceDetail);
router.get('/notifications', listAdminNotifications);
router.get('/support/tickets', listAdminSupportTickets);
router.patch('/support/tickets/:ticketId', updateAdminSupportTicket);

export default router;
