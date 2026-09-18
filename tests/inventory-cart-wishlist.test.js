import mongoose from 'mongoose';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { InventoryService } from '../app/services/inventory.service.js';
import { CartService } from '../app/services/cart.service.js';
import { WishlistService } from '../app/services/wishlist.service.js';
import { Inventory } from '../app/models/inventory.model.js';
import { InventoryMovement } from '../app/models/inventory-movement.model.js';
import { Cart } from '../app/models/cart.model.js';
import { Wishlist } from '../app/models/wishlist.model.js';
import { Product } from '../app/models/product.model.js';
import { ProductVariant } from '../app/models/product-variant.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { inventoryService } from '../app/services/inventory.service.js';

describe('inventory service', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('initializes inventory for a new variant', async () => {
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();
    const inventoryId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Inventory, 'findOne').mockResolvedValue(null);
    const createSpy = jest.spyOn(Inventory, 'create').mockImplementation(async (payload) => ({
      _id: inventoryId,
      ...payload,
      toObject: () => ({ _id: inventoryId, ...payload }),
    }));
    jest.spyOn(InventoryMovement, 'create').mockResolvedValue({ _id: 'move-1' });

    const service = new InventoryService();
    const result = await service.initializeInventory({
      productId,
      variantId,
      availableQuantity: 10,
      lowStockThreshold: 2,
    });

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ productId, variantId, availableQuantity: 10 }));
    expect(result.availableQuantity).toBe(10);
  });

  it('increases stock safely', async () => {
    const variantId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Inventory, 'findOneAndUpdate').mockResolvedValue({
      _id: 'inv-1',
      productId,
      variantId,
      availableQuantity: 12,
      reservedQuantity: 0,
      soldQuantity: 0,
      toObject: () => ({
        _id: 'inv-1',
        productId,
        variantId,
        availableQuantity: 12,
        reservedQuantity: 0,
        soldQuantity: 0,
      }),
    });
    jest.spyOn(InventoryMovement, 'create').mockResolvedValue({ _id: 'move-1' });

    const service = new InventoryService();
    const result = await service.increaseStock(variantId, 2, { reason: 'RESTOCK', actorId: 'admin-1' });

    expect(result.availableQuantity).toBe(12);
  });

  it('decreases stock and rejects invalid reductions', async () => {
    const variantId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Inventory, 'findOneAndUpdate')
      .mockResolvedValueOnce({
        _id: 'inv-1',
        productId,
        variantId,
        availableQuantity: 8,
        reservedQuantity: 0,
        soldQuantity: 0,
        toObject: () => ({
          _id: 'inv-1',
          productId,
          variantId,
          availableQuantity: 8,
          reservedQuantity: 0,
          soldQuantity: 0,
        }),
      })
      .mockResolvedValueOnce(null);
    jest.spyOn(Inventory, 'findOne').mockResolvedValue({
      _id: 'inv-1',
      productId,
      variantId,
      availableQuantity: 8,
      reservedQuantity: 0,
      soldQuantity: 0,
    });
    jest.spyOn(InventoryMovement, 'create').mockResolvedValue({ _id: 'move-1' });

    const service = new InventoryService();
    const decreased = await service.decreaseStock(variantId, 2, { reason: 'SALE', actorId: 'admin-1' });
    expect(decreased.availableQuantity).toBe(8);

    await expect(service.decreaseStock(variantId, 99, { reason: 'SALE', actorId: 'admin-1' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('reserves and releases stock safely', async () => {
    const variantId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Inventory, 'findOneAndUpdate')
      .mockResolvedValueOnce({
        _id: 'inv-1',
        productId,
        variantId,
        availableQuantity: 1,
        reservedQuantity: 1,
        soldQuantity: 0,
        toObject: () => ({
          _id: 'inv-1',
          productId,
          variantId,
          availableQuantity: 1,
          reservedQuantity: 1,
          soldQuantity: 0,
        }),
      })
      .mockResolvedValueOnce({
        _id: 'inv-1',
        productId,
        variantId,
        availableQuantity: 7,
        reservedQuantity: 0,
        soldQuantity: 0,
        toObject: () => ({
          _id: 'inv-1',
          productId,
          variantId,
          availableQuantity: 7,
          reservedQuantity: 0,
          soldQuantity: 0,
        }),
      });
    jest.spyOn(InventoryMovement, 'create').mockResolvedValue({ _id: 'move-1' });

    const service = new InventoryService();
    const reserved = await service.reserveStock(variantId, 1, { reason: 'RESERVATION', actorId: 'customer-1' });
    expect(reserved.availableQuantity).toBe(1);
    expect(reserved.reservedQuantity).toBe(1);

    const released = await service.releaseStock(variantId, 1, { reason: 'RELEASE', actorId: 'admin-1' });
    expect(released.availableQuantity).toBe(7);
  });

  it('rejects inventory changes from non-owner vendors', async () => {
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();
    const otherVendorId = new mongoose.Types.ObjectId().toHexString();
    const actualOwnerUserId = new mongoose.Types.ObjectId().toHexString();
    const myUserId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(ProductVariant, 'findById').mockResolvedValue({ _id: variantId, productId });
    jest.spyOn(Product, 'findOne').mockResolvedValue({ _id: productId, vendorId: otherVendorId, deletedAt: null });
    jest.spyOn(Vendor, 'findOne').mockResolvedValue({ _id: otherVendorId, ownerUserId: actualOwnerUserId, status: 'APPROVED' });

    const service = new InventoryService();
    await expect(service.ensureVendorOwnsVariant(myUserId, variantId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('cart service', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('adds an item to the cart and checks stock limits', async () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      status: 'PUBLISHED',
      deletedAt: null,
      name: 'Handloom Saree',
      vendorId: new mongoose.Types.ObjectId().toHexString(),
    });
    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      sku: 'SKU-1',
      status: 'ACTIVE',
      price: 1500,
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(10);
    jest.spyOn(Cart, 'findOne').mockResolvedValue(null);
    jest.spyOn(Cart, 'create').mockImplementation(async (payload) => ({
      _id: 'cart-1',
      ...payload,
      toObject: () => ({ _id: 'cart-1', ...payload }),
    }));

    const service = new CartService();
    const result = await service.addItem({ userId, productId, variantId, quantity: 1 });

    expect(result.items[0].variantId).toBe(variantId);
    expect(result.items[0].quantity).toBe(1);

    await expect(service.addItem({ userId, productId, variantId, quantity: 999 })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
  });

  it('merges guest cart items into the authenticated cart without exceeding stock', async () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const variantId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(ProductVariant, 'findOne').mockResolvedValue({
      _id: variantId,
      productId,
      sku: 'SKU-1',
      status: 'ACTIVE',
      price: 1000,
    });
    jest.spyOn(Product, 'findOne').mockResolvedValue({
      _id: productId,
      status: 'PUBLISHED',
      deletedAt: null,
      name: 'Cotton Kurta',
    });
    jest.spyOn(inventoryService, 'getAvailableStock').mockResolvedValue(5);
    jest.spyOn(Cart, 'findOne')
      .mockResolvedValueOnce({
        userId,
        items: [{ productId, variantId, quantity: 1 }],
        save: jest.fn().mockResolvedValue(true),
        toObject: () => ({ userId, items: [{ productId, variantId, quantity: 2 }] }),
      })
      .mockResolvedValueOnce({
        guestSessionId: 'guest-1',
        items: [{ productId, variantId, quantity: 2 }],
      });
    jest.spyOn(Cart, 'deleteOne').mockResolvedValue({ acknowledged: true });

    const service = new CartService();
    const result = await service.mergeGuestCart({ userId, guestSessionId: 'guest-1', items: [{ productId, variantId, quantity: 2 }] });

    expect(result.merged).toBe(true);
    expect(result.cart.items[0].quantity).toBe(3);
  });
});

describe('wishlist service', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('adds and lists wishlist items for a customer', async () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();

    jest.spyOn(Product, 'findById').mockResolvedValue({
      _id: productId,
      status: 'PUBLISHED',
      deletedAt: null,
      name: 'Eri Silk Saree',
    });
    jest.spyOn(Wishlist, 'findOne').mockResolvedValue(null);
    jest.spyOn(Wishlist, 'create').mockResolvedValue({
      _id: 'wish-1',
      userId,
      productId,
      toObject: () => ({ _id: 'wish-1', userId, productId }),
    });
    jest.spyOn(Wishlist, 'find').mockResolvedValue([{ productId }]);
    jest.spyOn(Wishlist, 'countDocuments').mockResolvedValue(1);
    jest.spyOn(Product, 'find').mockResolvedValue([{ _id: productId, name: 'Eri Silk Saree', status: 'PUBLISHED', deletedAt: null }]);

    const service = new WishlistService();
    const created = await service.addItem({ userId, productId });
    const list = await service.listItems(userId);

    expect(created.productId).toBe(productId);
    expect(list.items[0].productId).toBe(productId);
  });

  it('prevents duplicates and rejects invalid products', async () => {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const productId = new mongoose.Types.ObjectId().toHexString();
    const service = new WishlistService();

    jest.spyOn(Product, 'findById').mockResolvedValueOnce({
      _id: productId,
      status: 'PUBLISHED',
      deletedAt: null,
      name: 'Handloom Dupatta',
    });
    jest.spyOn(Wishlist, 'findOne').mockResolvedValueOnce({ _id: 'wish-1', userId, productId });
    await expect(service.addItem({ userId, productId })).rejects.toMatchObject({ code: 'WISHLIST_ITEM_EXISTS' });

    jest.spyOn(Product, 'findById').mockResolvedValueOnce(null);
    jest.spyOn(Wishlist, 'findOne').mockResolvedValueOnce(null);
    await expect(service.addItem({ userId, productId: new mongoose.Types.ObjectId().toHexString() })).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });
});
