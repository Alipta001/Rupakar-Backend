import { Inventory } from '../models/inventory.model.js';
import { Product } from '../models/product.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { Vendor } from '../models/vendor.model.js';
import { inventoryService } from '../services/inventory.service.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/app-error.js';

export const getVendorInventory = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' }).lean();
    if (!vendor) throw new AppError(403, 'VENDOR_NOT_ALLOWED', 'Only approved vendors can manage inventory');
    const productQuery = { vendorId: vendor._id, deletedAt: null };
    const search = String(req.query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const variantProductIds = await ProductVariant.distinct('productId', { sku: { $regex: escaped, $options: 'i' } });
      productQuery.$or = [{ name: { $regex: escaped, $options: 'i' } }, { _id: { $in: variantProductIds } }];
    }
    const productIds = await Product.distinct('_id', productQuery);
    const filter = { productId: { $in: productIds }, deletedAt: null };
    if (['ACTIVE', 'INACTIVE', 'LOW_STOCK'].includes(req.query.status)) filter.status = req.query.status;
    const [items, total] = await Promise.all([
      Inventory.find(filter).populate({ path: 'productId', select: 'name slug' }).populate({ path: 'variantId', select: 'sku price attributes' }).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Inventory.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: { items, page, limit, total }, message: 'Inventory loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) {
    next(error);
  }
};

export const getVariantInventory = async (req, res, next) => {
  try {
    const { variantId } = req.params;
    await inventoryService.ensureVendorOwnsVariant(req.user.sub, variantId);
    const item = await inventoryService.getInventory({ variantId });
    if (!item) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found');
    sendSuccess(res, item, 'Inventory loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const adjustVariantInventory = async (req, res, next) => {
  try {
    const { variantId } = req.params;
    const { delta, reason } = req.body;
    const vendorId = req.user.sub;
    await inventoryService.ensureVendorOwnsVariant(vendorId, variantId);
    const item = await inventoryService.adjustStock(variantId, Number(delta), { reason, actorId: vendorId, referenceType: 'ADJUSTMENT', referenceId: `vendor:${vendorId}` });
    sendSuccess(res, item, 'Inventory adjusted', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const vendorAdjustInventory = async (req, res, next) => {
  try {
    const { variantId } = req.params;
    const { delta, reason } = req.body;
    const vendorId = req.user.sub;
    await inventoryService.ensureVendorOwnsVariant(vendorId, variantId);
    const item = await inventoryService.adjustStock(variantId, Number(delta), { reason, actorId: vendorId, referenceType: 'ADJUSTMENT', referenceId: `vendor:${vendorId}` });
    sendSuccess(res, item, 'Inventory adjusted', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};
