import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { getReturnDetail, cancelReturn } from '../controllers/return.controller.js';

const router = Router();

router.get('/returns/:id', requireAuth, getReturnDetail);
router.post('/returns/:id/cancel', requireAuth, cancelReturn);

export default router;
