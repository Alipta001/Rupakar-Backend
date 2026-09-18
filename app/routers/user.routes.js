import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  getMe,
  updateMe,
  createAddress,
  listAddresses,
  updateAddress,
  deleteAddress,
  setDefaultShipping,
  setDefaultBilling,
  changePassword,
} from '../controllers/user.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/me', getMe);
router.patch('/me', updateMe);
router.post('/change-password', changePassword);
router.post('/addresses', createAddress);
router.get('/addresses', listAddresses);
router.patch('/addresses/:addressId', updateAddress);
router.delete('/addresses/:addressId', deleteAddress);
router.patch('/addresses/:addressId/default-shipping', setDefaultShipping);
router.patch('/addresses/:addressId/default-billing', setDefaultBilling);

export default router;
