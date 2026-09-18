import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listBrands, getBrandBySlug, createBrand, updateBrand, deleteBrand } from '../controllers/brand.controller.js';

const router = Router();

router.get('/', listBrands);
router.get('/brands', listBrands);
router.get('/:slug', getBrandBySlug);
router.get('/brands/:slug', getBrandBySlug);
router.post('/admin/brands', requireAuth, requireRole('admin'), createBrand);
router.patch('/admin/brands/:id', requireAuth, requireRole('admin'), updateBrand);
router.delete('/admin/brands/:id', requireAuth, requireRole('admin'), deleteBrand);

export default router;
