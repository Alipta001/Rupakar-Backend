import { Router } from 'express';
import { paymentWebhook, getPaymentConfig, getPaymentByOrder, getOrderPaymentStatus, confirmPayment, simulateMockPayment } from '../controllers/payment.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/webhook', paymentWebhook);
router.use(requireAuth);
router.get('/config', getPaymentConfig);
router.post('/mock/simulate', simulateMockPayment);
router.post('/confirm', confirmPayment);
router.post('/verify', confirmPayment);
router.get('/orders/:orderId', getPaymentByOrder);
router.get('/orders/:orderId/status', getOrderPaymentStatus);

export default router;
