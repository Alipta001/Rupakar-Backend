import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { getVendorInventory, getVariantInventory, adjustVariantInventory } from '../controllers/inventory.controller.js';

const router = Router();

router.use('/vendor/inventory', requireAuth);
router.get('/vendor/inventory', getVendorInventory);
router.get('/vendor/inventory/:variantId', getVariantInventory);
router.patch('/vendor/inventory/:variantId', adjustVariantInventory);
router.post('/vendor/inventory/:variantId/adjust', adjustVariantInventory);

export default router;
