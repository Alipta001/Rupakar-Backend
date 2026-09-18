import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { getOrderInvoice, getInvoiceDetail, listCustomerInvoices, downloadInvoice, listAdminInvoices, getAdminInvoiceDetail, listVendorInvoices } from '../controllers/invoice.controller.js';

const router = Router();

router.get('/', requireAuth, listCustomerInvoices);
router.get('/:id', requireAuth, getInvoiceDetail);
router.post('/:id/download', requireAuth, downloadInvoice);

router.use(requireAuth, requireRole('admin'));
router.get('/admin/list', listAdminInvoices);
router.get('/admin/:id', getAdminInvoiceDetail);

export default router;
