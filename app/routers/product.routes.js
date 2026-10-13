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
  deleteVendorProduct,
  vendorSetOutOfStock,
  publicProductList,
  publicProductDetail,
  adminProductList,
  adminProductDetail,
  approveProduct,
  rejectProduct,
  publishProduct,
  unpublishProduct,
  archiveProduct,
  adminDeleteProduct,
  uploadVendorProductImage,
  deleteVendorProductImage,
  updateVendorProductImage,
} from '../controllers/product.controller.js';
import {
  downloadTemplate,
  validateBatch,
  submitBatch,
  getBatch,
  listBatches,
  downloadErrorReport,
} from '../controllers/bulk-product.controller.js';

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

const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 55 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname || '').toLowerCase();
    const allowedExts = ['.csv', '.xlsx', '.xls', '.zip'];
    const hasValidExt = allowedExts.some((e) => ext.endsWith(e));
    if (hasValidExt) {
      cb(null, true);
      return;
    }
    cb(new AppError(400, 'INVALID_BULK_FILE', 'Only .csv, .xlsx spreadsheets and .zip archives are allowed'));
  },
});

router.get('/products', publicProductList);
router.get('/products/:slug', publicProductDetail);

router.use('/vendor', requireAuth);

// Bulk product endpoints (placed before /vendor/products/:id to avoid parameter collisions)
router.get('/vendor/products/bulk/template', downloadTemplate);
router.post(
  '/vendor/products/bulk/validate',
  requireRole('vendor'),
  bulkUpload.fields([
    { name: 'spreadsheet', maxCount: 1 },
    { name: 'zip', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'images', maxCount: 1 },
  ]),
  validateBatch,
);
router.post('/vendor/products/bulk/submit', requireRole('vendor'), submitBatch);
router.get('/vendor/products/bulk/batches', requireRole('vendor'), listBatches);
router.get('/vendor/products/bulk/batches/:batchId', requireRole('vendor'), getBatch);
router.get('/vendor/products/bulk/batches/:batchId/errors', requireRole('vendor'), downloadErrorReport);

router.get('/vendor/products', listVendorProducts);
router.post('/vendor/products', createVendorProduct);
router.get('/vendor/products/:id', getVendorProduct);
router.patch('/vendor/products/:id', updateVendorProduct);
router.delete('/vendor/products/:id', deleteVendorProduct);
router.post('/vendor/products/:id/submit', submitVendorProduct);
router.post('/vendor/products/:id/out-of-stock', vendorSetOutOfStock);
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
router.delete('/admin/products/:id', adminDeleteProduct);

export default router;
