import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listCategories, getCategoryBySlug, createCategory, updateCategory, deleteCategory } from '../controllers/category.controller.js';

const router = Router();

router.get('/', listCategories);
router.get('/categories', listCategories);
router.get('/:slug', getCategoryBySlug);
router.get('/categories/:slug', getCategoryBySlug);
router.post('/admin/categories', requireAuth, requireRole('admin'), createCategory);
router.patch('/admin/categories/:id', requireAuth, requireRole('admin'), updateCategory);
router.delete('/admin/categories/:id', requireAuth, requireRole('admin'), deleteCategory);

export default router;
