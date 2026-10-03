import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  listVendorLedger,
  getVendorLedgerSummary,
  getVendorBalance,
  listVendorPayouts,
  getVendorPayout,
  getAdminFinanceOverview,
  getFinancialSettings,
  updateFinancialSettings,
  listEligibleSettlements,
  listSettlementReadinessOverview,
  triggerSettlementBatch,
  listSettlementBatches,
  getSettlementBatchDetail,
  holdSettlementEntry,
  releaseSettlementEntry,
  listAdminPayouts,
  retryPayout,
  confirmManualPayout,
  getReconciliationReport,
  listAdminVendorLedgers,
  listAdminCommissions,
  createCommissionConfig,
  listCommissionConfigs,
  updateCommissionConfig,
  toggleCommissionConfigStatus,
  deleteCommissionConfig,
} from '../controllers/finance.controller.js';

const router = Router();

// Vendor routes
router.get('/vendor/finance/ledger', requireAuth, listVendorLedger);
router.get('/vendor/finance/summary', requireAuth, getVendorLedgerSummary);
router.get('/vendor/finance/balance', requireAuth, getVendorBalance);
router.get('/vendor/finance/payouts', requireAuth, listVendorPayouts);
router.get('/vendor/finance/payouts/:id', requireAuth, getVendorPayout);

// Admin routes
router.get('/admin/commissions', requireAuth, requireRole('admin'), listAdminCommissions);

router.use('/admin/finance', requireAuth, requireRole('admin'));
router.get('/admin/finance/overview', getAdminFinanceOverview);
router.get('/admin/finance/settings', getFinancialSettings);
router.put('/admin/finance/settings', updateFinancialSettings);

router.get('/admin/finance/settlements/eligible', listEligibleSettlements);
router.get('/admin/finance/settlements/readiness-overview', listSettlementReadinessOverview);
router.post('/admin/finance/settlements/batch', triggerSettlementBatch);
router.get('/admin/finance/settlements/batches', listSettlementBatches);
router.get('/admin/finance/settlements/batches/:id', getSettlementBatchDetail);
router.post('/admin/finance/settlements/hold', holdSettlementEntry);
router.post('/admin/finance/settlements/release', releaseSettlementEntry);

router.get('/admin/finance/payouts', listAdminPayouts);
router.post('/admin/finance/payouts/:id/retry', retryPayout);
router.post('/admin/finance/payouts/:id/confirm-manual', confirmManualPayout);

router.get('/admin/finance/reconciliation', getReconciliationReport);
router.get('/admin/finance/vendor-ledgers', listAdminVendorLedgers);

router.get('/admin/finance/commission-config', listCommissionConfigs);
router.post('/admin/finance/commission-config', createCommissionConfig);
router.put('/admin/finance/commission-config/:id', updateCommissionConfig);
router.patch('/admin/finance/commission-config/:id/toggle', toggleCommissionConfigStatus);
router.delete('/admin/finance/commission-config/:id', deleteCommissionConfig);

export default router;
