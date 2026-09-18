import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { getShipmentTracking } from '../controllers/shipping.controller.js';

const router = Router();

router.get('/shipments/:id/tracking', requireAuth, getShipmentTracking);

export default router;
