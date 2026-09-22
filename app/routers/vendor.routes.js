import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  applyVendor,
  getMyVendor,
  updateMyVendor,
  getMyVendorStatus,
  getMyVendorVerification,
  addDocument,
  addBankAccount,
  getVendorDashboard,
  listAdminVendors,
  getAdminVendor,
  approveVendor,
  rejectVendor,
  suspendVendor,
  blockVendor,
  restoreVendor,
  listVendorDocuments,
  approveDocument,
  rejectDocument,
} from '../controllers/vendor.controller.js';
import { listVendorOrders, getVendorOrder } from '../controllers/order.controller.js';
import { listVendorReturns, getVendorReturn } from '../controllers/return.controller.js';
import { packVendorOrder, shipVendorOrder } from '../controllers/shipping.controller.js';
import { listVendorInvoices, downloadVendorOrderInvoice, downloadVendorPackingSlip } from '../controllers/invoice.controller.js';

const router = Router();

router.use(requireAuth);
router.post('/apply', applyVendor);
router.get('/me', getMyVendor);
router.patch('/me', updateMyVendor);
router.get('/me/status', getMyVendorStatus);
router.get('/me/verification', getMyVendorVerification);
router.get('/dashboard', getVendorDashboard);
router.post('/documents', addDocument);
router.post('/bank-account', addBankAccount);

router.get('/orders', listVendorOrders);
router.get('/orders/:id', getVendorOrder);
router.get('/orders/:orderId/invoice', downloadVendorOrderInvoice);
router.get('/orders/:orderId/packing-slip', downloadVendorPackingSlip);
router.post('/orders/:id/pack', packVendorOrder);
router.post('/orders/:id/ship', shipVendorOrder);
router.get('/returns', listVendorReturns);
router.get('/returns/:id', getVendorReturn);
router.get('/invoices', listVendorInvoices);

router.use(requireRole('admin'));
router.get('/admin', listAdminVendors);
router.get('/admin/:id', getAdminVendor);
router.get('/admin/:id/documents', listVendorDocuments);
router.patch('/admin/:id/approve', approveVendor);
router.patch('/admin/:id/reject', rejectVendor);
router.patch('/admin/:id/suspend', suspendVendor);
router.patch('/admin/:id/block', blockVendor);
router.patch('/admin/:id/restore', restoreVendor);
router.patch('/admin/:id/documents/:documentId/approve', approveDocument);
router.patch('/admin/:id/documents/:documentId/reject', rejectDocument);

export default router;
