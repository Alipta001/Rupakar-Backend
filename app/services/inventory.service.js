import { AppError } from '../utils/app-error.js';
import { Inventory } from '../models/inventory.model.js';
import { InventoryMovement } from '../models/inventory-movement.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { Product } from '../models/product.model.js';
import { Vendor } from '../models/vendor.model.js';

const toPlain = (doc) => {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
};

export class InventoryService {
  async ensureVendorOwnsVariant(vendorUserId, variantId) {
    const variantDoc = await ProductVariant.findById(variantId);
    const variant = toPlain(variantDoc);
    if (!variant) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found');

    const productDoc = await Product.findOne({ _id: variant.productId, deletedAt: null });
    const product = toPlain(productDoc);
    if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

    const vendorDoc = await Vendor.findOne({ ownerUserId: vendorUserId, deletedAt: null, status: 'APPROVED' });
    const vendor = toPlain(vendorDoc);
    if (!vendor) throw new AppError(403, 'FORBIDDEN', 'Vendor is not approved to manage inventory');

    if (String(product.vendorId) !== String(vendor._id) || String(vendor.ownerUserId) !== String(vendorUserId)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this product inventory');
    }

    return { variant, product, vendor };
  }

  async getInventory({ variantId, productId } = {}) {
    const query = { deletedAt: null };
    if (variantId) query.variantId = variantId;
    if (productId) query.productId = productId;

    const doc = await Inventory.findOne(query);
    return toPlain(doc);
  }

  async initializeInventory({ productId, variantId, availableQuantity = 0, lowStockThreshold = 0, actorId = 'system' }) {
    if (!productId || !variantId) throw new AppError(400, 'INVALID_INVENTORY', 'productId and variantId are required');
    if (!Number.isFinite(Number(availableQuantity)) || Number(availableQuantity) < 0) {
      throw new AppError(400, 'INVALID_QUANTITY', 'Available quantity must be non-negative');
    }

    const existing = await Inventory.findOne({ variantId, deletedAt: null });
    if (existing) return existing;

    const record = await Inventory.create({
      productId,
      variantId,
      availableQuantity: Number(availableQuantity),
      reservedQuantity: 0,
      soldQuantity: 0,
      lowStockThreshold: Number(lowStockThreshold) || 0,
      status: Number(availableQuantity) <= Number(lowStockThreshold) ? 'LOW_STOCK' : 'ACTIVE',
    });

    await InventoryMovement.create({
      productId,
      variantId,
      inventoryId: record._id,
      type: 'STOCK_IN',
      quantity: Number(availableQuantity),
      previousAvailableQuantity: 0,
      newAvailableQuantity: Number(availableQuantity),
      referenceType: 'INITIALIZATION',
      referenceId: 'bootstrap',
      reason: 'INITIALIZATION',
      actorId,
    });

    return record.toObject();
  }

  async increaseStock(variantId, quantity, { reason = 'RESTOCK', actorId = 'system', referenceType = 'RESTOCK', referenceId = null } = {}) {
    const normalized = Number(quantity);
    if (!Number.isFinite(normalized) || normalized <= 0) throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive');

    const inventory = await Inventory.findOneAndUpdate(
      { variantId, deletedAt: null },
      { $inc: { availableQuantity: normalized } },
      { new: true, runValidators: true },
    );

    if (!inventory) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found');

    await InventoryMovement.create({
      productId: inventory.productId,
      variantId,
      inventoryId: inventory._id,
      type: 'STOCK_IN',
      quantity: normalized,
      previousAvailableQuantity: Math.max(0, inventory.availableQuantity - normalized),
      newAvailableQuantity: inventory.availableQuantity,
      referenceType,
      referenceId: referenceId || String(referenceType),
      reason,
      actorId,
    });

    return inventory.toObject ? inventory.toObject() : inventory;
  }

  async decreaseStock(variantId, quantity, { reason = 'SALE', actorId = 'system', referenceType = 'SALE', referenceId = null } = {}) {
    const normalized = Number(quantity);
    if (!Number.isFinite(normalized) || normalized <= 0) throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive');

    const inventory = await Inventory.findOneAndUpdate(
      { variantId, deletedAt: null, availableQuantity: { $gte: normalized } },
      { $inc: { availableQuantity: -normalized, soldQuantity: normalized } },
      { new: true, runValidators: true },
    );

    if (!inventory) {
      const current = await Inventory.findOne({ variantId, deletedAt: null });
      if (!current) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found');
      throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock available');
    }

    await InventoryMovement.create({
      productId: inventory.productId,
      variantId,
      inventoryId: inventory._id,
      type: 'STOCK_OUT',
      quantity: normalized,
      previousAvailableQuantity: inventory.availableQuantity + normalized,
      newAvailableQuantity: inventory.availableQuantity,
      referenceType,
      referenceId: referenceId || String(referenceType),
      reason,
      actorId,
    });

    return inventory.toObject ? inventory.toObject() : inventory;
  }

  async adjustStock(variantId, delta, { reason = 'ADJUSTMENT', actorId = 'system', referenceType = 'ADJUSTMENT', referenceId = null } = {}) {
    const normalized = Number(delta);
    if (!Number.isFinite(normalized)) throw new AppError(400, 'INVALID_QUANTITY', 'Adjustment must be numeric');

    const inventory = await Inventory.findOne({ variantId, deletedAt: null });
    if (!inventory) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found');

    const nextAvailable = inventory.availableQuantity + normalized;
    if (nextAvailable < 0) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Stock cannot go below zero');

    const updated = await Inventory.findOneAndUpdate(
      { _id: inventory._id },
      { $set: { availableQuantity: nextAvailable }, $inc: { soldQuantity: normalized < 0 ? Math.abs(normalized) : 0 } },
      { new: true, runValidators: true },
    );

    await InventoryMovement.create({
      productId: updated.productId,
      variantId,
      inventoryId: updated._id,
      type: normalized >= 0 ? 'ADJUSTMENT' : 'STOCK_OUT',
      quantity: Math.abs(normalized),
      previousAvailableQuantity: inventory.availableQuantity,
      newAvailableQuantity: updated.availableQuantity,
      referenceType,
      referenceId: referenceId || String(referenceType),
      reason,
      actorId,
    });

    return updated.toObject ? updated.toObject() : updated;
  }

  async reserveStock(variantId, quantity, { reason = 'RESERVATION', actorId = 'customer', referenceType = 'RESERVATION', referenceId = null } = {}) {
    const normalized = Number(quantity);
    if (!Number.isFinite(normalized) || normalized <= 0) throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive');

    const inventory = await Inventory.findOneAndUpdate(
      {
        variantId,
        deletedAt: null,
        availableQuantity: { $gte: normalized },
      },
      {
        $inc: { availableQuantity: -normalized, reservedQuantity: normalized },
      },
      { new: true, runValidators: true },
    );

    if (!inventory) {
      const current = await Inventory.findOne({ variantId, deletedAt: null });
      if (!current) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found');
      throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock available to reserve');
    }

    await InventoryMovement.create({
      productId: inventory.productId,
      variantId,
      inventoryId: inventory._id,
      type: 'RESERVATION',
      quantity: normalized,
      previousAvailableQuantity: inventory.availableQuantity + normalized,
      newAvailableQuantity: inventory.availableQuantity,
      referenceType,
      referenceId: referenceId || String(referenceType),
      reason,
      actorId,
    });

    return inventory.toObject ? inventory.toObject() : inventory;
  }

  async releaseStock(variantId, quantity, { reason = 'RELEASE', actorId = 'system', referenceType = 'RELEASE', referenceId = null } = {}) {
    const normalized = Number(quantity);
    if (!Number.isFinite(normalized) || normalized <= 0) throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive');

    const inventory = await Inventory.findOneAndUpdate(
      { variantId, deletedAt: null, reservedQuantity: { $gte: normalized } },
      { $inc: { availableQuantity: normalized, reservedQuantity: -normalized } },
      { new: true, runValidators: true },
    );

    if (!inventory) {
      const current = await Inventory.findOne({ variantId, deletedAt: null });
      if (!current) throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory not found');
      throw new AppError(409, 'INVENTORY_UPDATE_FAILED', 'Cannot release more stock than is reserved');
    }

    await InventoryMovement.create({
      productId: inventory.productId,
      variantId,
      inventoryId: inventory._id,
      type: 'RELEASE',
      quantity: normalized,
      previousAvailableQuantity: inventory.availableQuantity - normalized,
      newAvailableQuantity: inventory.availableQuantity,
      referenceType,
      referenceId: referenceId || String(referenceType),
      reason,
      actorId,
    });

    return inventory.toObject ? inventory.toObject() : inventory;
  }

  async getAvailableStock(variantId) {
    const doc = await Inventory.findOne({ variantId, deletedAt: null });
    const inventory = toPlain(doc);
    if (!inventory) return 0;
    return Math.max(0, inventory.availableQuantity);
  }
}

export const inventoryService = new InventoryService();
