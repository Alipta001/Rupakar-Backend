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
  getVendorAnalytics,
  listAdminVendors,
  getAdminVendor,
  approveVendor,
  rejectVendor,
  suspendVendor,
  blockVendor,
  restoreVendor,
  listVendorDocuments,
  getAdminVendorDocumentDownload,
  approveDocument,
  rejectDocument,
  getAdminVendorBankAccount,
  verifyBankAccount,
  rejectBankAccount,
} from '../controllers/vendor.controller.js';
import multer from 'multer';
import { AppError } from '../utils/app-error.js';

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      cb(new AppError(400, 'INVALID_FILE_TYPE', 'Only PDF, JPEG, PNG, and WEBP documents up to 5MB are allowed'));
      return;
    }
    cb(null, true);
  },
});

const handleDocumentUpload = (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return documentUpload.single('file')(req, res, next);
  }
  return next();
};
import { listVendorOrders, getVendorOrder } from '../controllers/order.controller.js';
import { listVendorReturns, getVendorReturn } from '../controllers/return.controller.js';
import { packVendorOrder, processVendorOrder, readyVendorOrder, shipVendorOrder } from '../controllers/shipping.controller.js';
import { listVendorInvoices, downloadVendorOrderInvoice, downloadVendorPackingSlip } from '../controllers/invoice.controller.js';
import {
  listVendorCancellationRequests,
  approveVendorCancellationRequest,
  rejectVendorCancellationRequest,
} from '../controllers/cancellation.controller.js';

const router = Router();

router.use(requireAuth);
router.post('/apply', applyVendor);
router.get('/me', getMyVendor);
router.patch('/me', updateMyVendor);
router.get('/me/status', getMyVendorStatus);
router.get('/me/verification', getMyVendorVerification);
router.get('/dashboard', getVendorDashboard);
router.get('/analytics', getVendorAnalytics);
router.post('/documents', handleDocumentUpload, addDocument);
router.post('/bank-account', addBankAccount);

router.get('/orders', listVendorOrders);
router.get('/orders/:id', getVendorOrder);
router.get('/orders/:orderId/invoice', downloadVendorOrderInvoice);
router.get('/orders/:orderId/packing-slip', downloadVendorPackingSlip);
router.post('/orders/:id/pack', packVendorOrder);
router.post('/orders/:id/process', processVendorOrder);
router.post('/orders/:id/ready-to-ship', readyVendorOrder);
router.post('/orders/:id/ship', shipVendorOrder);
router.get('/returns', listVendorReturns);
router.get('/returns/:id', getVendorReturn);
router.get('/cancellation-requests', listVendorCancellationRequests);
router.post('/cancellation-requests/:id/approve', approveVendorCancellationRequest);
router.post('/cancellation-requests/:id/reject', rejectVendorCancellationRequest);
router.get('/invoices', listVendorInvoices);

router.use(requireRole('admin'));
router.get('/admin', listAdminVendors);
router.get('/admin/:id', getAdminVendor);
router.get('/admin/:id/documents', listVendorDocuments);
router.get('/admin/:id/documents/:documentId/download', getAdminVendorDocumentDownload);
router.patch('/admin/:id/approve', approveVendor);
router.patch('/admin/:id/reject', rejectVendor);
router.patch('/admin/:id/suspend', suspendVendor);
router.patch('/admin/:id/block', blockVendor);
router.patch('/admin/:id/restore', restoreVendor);
router.patch('/admin/:id/documents/:documentId/approve', approveDocument);
router.patch('/admin/:id/documents/:documentId/reject', rejectDocument);
router.get('/admin/:id/bank-account', getAdminVendorBankAccount);
router.patch('/admin/:id/bank-account/verify', verifyBankAccount);
router.patch('/admin/:id/bank-account/reject', rejectBankAccount);

export default router;
