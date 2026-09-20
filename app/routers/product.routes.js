import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../utils/app-error.js';
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
  uploadVendorProductImage,
  deleteVendorProductImage,
  updateVendorProductImage,
} from '../controllers/product.controller.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
    if (!file || !allowed.includes(file.mimetype)) {
      cb(new AppError(400, 'INVALID_IMAGE_FILE', 'Only JPG, PNG, WEBP, GIF, and BMP images up to 2 MB are allowed'));
      return;
    }
    cb(null, true);
  },
});

router.get('/products', publicProductList);
router.get('/products/:slug', publicProductDetail);

router.use('/vendor', requireAuth);
router.get('/vendor/products', listVendorProducts);
router.post('/vendor/products', createVendorProduct);
router.get('/vendor/products/:id', getVendorProduct);
router.patch('/vendor/products/:id', updateVendorProduct);
router.post('/vendor/products/:id/submit', submitVendorProduct);
router.post('/vendor/products/:id/images', requireAuth, requireRole('vendor'), upload.single('image'), uploadVendorProductImage);
router.delete('/vendor/products/:id/images/:imageId', requireAuth, requireRole('vendor'), deleteVendorProductImage);
router.patch('/vendor/products/:id/images/:imageId', requireAuth, requireRole('vendor'), updateVendorProductImage);

router.use('/admin', requireAuth, requireRole('admin'));
router.get('/admin/products', adminProductList);
router.get('/admin/products/:id', adminProductDetail);
router.post('/admin/products/:id/approve', approveProduct);
router.post('/admin/products/:id/reject', rejectProduct);
router.post('/admin/products/:id/publish', publishProduct);
router.post('/admin/products/:id/unpublish', unpublishProduct);
router.post('/admin/products/:id/archive', archiveProduct);

export default router;
