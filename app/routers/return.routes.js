import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  getReturnDetail,
  cancelReturn,
  listCustomerReturns,
  submitCustomerPayoutDetails,
  createCustomerReplacement,
  getCustomerReplacement,
  prepareReturnReverseShipment,
  getReturnReverseShipment,
  assignReturnAwbController,
  generateReturnLabelController,
  requestReturnPickupController,
  syncReturnTrackingController,
} from '../controllers/return.controller.js';

const router = Router();

router.get('/returns', requireAuth, listCustomerReturns);
router.get('/returns/:id', requireAuth, getReturnDetail);
router.post('/returns/:id/cancel', requireAuth, cancelReturn);
router.post('/returns/:id/payout-details', requireAuth, submitCustomerPayoutDetails);
router.post('/returns/:id/replacement', requireAuth, createCustomerReplacement);
router.get('/returns/:id/replacement', requireAuth, getCustomerReplacement);
router.post('/returns/:id/reverse-shipment/prepare', requireAuth, prepareReturnReverseShipment);
router.get('/returns/:id/reverse-shipment', requireAuth, getReturnReverseShipment);
router.post('/returns/:id/reverse-shipment/assign-awb', requireAuth, assignReturnAwbController);
router.post('/returns/:id/reverse-shipment/label', requireAuth, generateReturnLabelController);
router.post('/returns/:id/reverse-shipment/pickup', requireAuth, requestReturnPickupController);
router.post('/returns/:id/reverse-shipment/sync-tracking', requireAuth, syncReturnTrackingController);

export default router;

