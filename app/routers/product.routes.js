import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  createVendorProduct,
  listVendorProducts,
  getVendorProduct,
  updateVendorProduct,
  submitVendorProduct,
  publicProductList,
  publicProductDetail,
  adminProductList,
  adminProductDetail,
  approveProduct,
  rejectProduct,
  publishProduct,
  unpublishProduct,
  archiveProduct,
} from '../controllers/product.controller.js';

const router = Router();

router.get('/products', publicProductList);
router.get('/products/:slug', publicProductDetail);

router.use('/vendor', requireAuth);
router.get('/vendor/products', listVendorProducts);
router.post('/vendor/products', createVendorProduct);
router.get('/vendor/products/:id', getVendorProduct);
router.patch('/vendor/products/:id', updateVendorProduct);
router.post('/vendor/products/:id/submit', submitVendorProduct);

router.use('/admin', requireAuth, requireRole('admin'));
router.get('/admin/products', adminProductList);
router.get('/admin/products/:id', adminProductDetail);
router.post('/admin/products/:id/approve', approveProduct);
router.post('/admin/products/:id/reject', rejectProduct);
router.post('/admin/products/:id/publish', publishProduct);
router.post('/admin/products/:id/unpublish', unpublishProduct);
router.post('/admin/products/:id/archive', archiveProduct);

export default router;
