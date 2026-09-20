import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listVendorLedger, getVendorLedgerSummary, getVendorBalance, listVendorPayouts, getVendorPayout, listAdminPayouts, createCommissionConfig, listCommissionConfigs } from '../controllers/finance.controller.js';

const router = Router();

router.get('/vendor/finance/ledger', requireAuth, listVendorLedger);
router.get('/vendor/finance/summary', requireAuth, getVendorLedgerSummary);
router.get('/vendor/finance/balance', requireAuth, getVendorBalance);
router.get('/vendor/finance/payouts', requireAuth, listVendorPayouts);
router.get('/vendor/finance/payouts/:id', requireAuth, getVendorPayout);
router.use('/admin/finance/commission-config', requireAuth, requireRole('admin'));
router.get('/admin/finance/commission-config', listCommissionConfigs);
router.post('/admin/finance/commission-config', createCommissionConfig);
router.get('/admin/finance/payouts', requireAuth, requireRole('admin'), listAdminPayouts);

export default router;
