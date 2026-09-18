import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { previewCheckout } from '../controllers/checkout.controller.js';
import { createOrder } from '../controllers/order.controller.js';

const router = Router();

router.use(requireAuth);
router.post('/preview', previewCheckout);
router.post('/', createOrder);

export default router;
