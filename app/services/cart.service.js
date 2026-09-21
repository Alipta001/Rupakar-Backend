import { AppError } from '../utils/app-error.js';
import { Cart } from '../models/cart.model.js';
import { Product } from '../models/product.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { inventoryService } from './inventory.service.js';
import mongoose from 'mongoose';

const MAX_CART_QUANTITY = 20;
const toPlain = (doc) => {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
};

export class CartService {
  async formatCart(doc) {
    if (!doc) return { items: [], subtotal: 0, total: 0, itemCount: 0 };
    const plain = toPlain(doc);
    const rawItems = Array.isArray(plain.items) ? plain.items : [];

    let subtotal = 0;
    const items = await Promise.all(
      rawItems.map(async (entry) => {
        let pQuery = Product.findOne({ _id: entry.productId, deletedAt: null });
        if (typeof pQuery.populate === 'function') pQuery = pQuery.populate('images');
        const product = typeof pQuery.lean === 'function' ? await pQuery.lean() : await pQuery;

        let vQuery = ProductVariant.findOne({ _id: entry.variantId });
        const variant = typeof vQuery.lean === 'function' ? await vQuery.lean() : await vQuery;

        const price = Number(variant?.price ?? 0);
        const quantity = Number(entry.quantity ?? 1);
        const lineTotal = price * quantity;
        subtotal += lineTotal;

        const primaryImage =
          product?.images?.find((i) => i.isPrimary)?.url ??
          product?.images?.[0]?.url ??
          '/images/product-vase.jpg';

        return {
          id: String(entry._id || entry.variantId),
          productId: String(entry.productId),
          variantId: String(entry.variantId),
          quantity,
          price,
          unitPrice: price,
          compareAtPrice: variant?.compareAtPrice ?? null,
          name: product?.name ?? 'Artisan Handcraft',
          slug: product?.slug ?? 'product',
          craft: product?.craft ?? product?.tags?.[0] ?? 'Handcrafted',
          image: primaryImage,
          sku: variant?.sku ?? '',
          lineTotal,
        };
      }),
    );

    return {
      ...plain,
      items,
      subtotal,
      total: subtotal,
      itemCount: items.reduce((sum, it) => sum + it.quantity, 0),
    };
  }

  async getCartForUser(userId) {
    const doc = await Cart.findOne({ userId });
    if (!doc) return { userId, items: [], subtotal: 0, total: 0, itemCount: 0 };
    return this.formatCart(doc);
  }

  async getGuestCart(sessionId) {
    const doc = await Cart.findOne({ guestSessionId: sessionId });
    if (!doc) return { guestSessionId: sessionId, items: [], subtotal: 0, total: 0, itemCount: 0 };
    return this.formatCart(doc);
  }

  async normalizeCartItem(productId, variantId, quantity) {
    const normalizedQuantity = Number(quantity);
    if (!Number.isInteger(normalizedQuantity) || normalizedQuantity <= 0 || normalizedQuantity > MAX_CART_QUANTITY) {
      throw new AppError(400, 'INVALID_QUANTITY', `Quantity must be a positive integer no greater than ${MAX_CART_QUANTITY}`);
    }

    if (!mongoose.isValidObjectId(productId)) {
      throw new AppError(400, 'INVALID_PRODUCT_ID', 'Product id is invalid');
    }
    if (!mongoose.isValidObjectId(variantId)) {
      throw new AppError(400, 'INVALID_VARIANT_ID', 'Variant id is invalid');
    }

    const productDoc = await Product.findOne({ _id: productId, status: 'PUBLISHED', deletedAt: null });
    const product = toPlain(productDoc);
    if (!product) throw new AppError(404, 'PRODUCT_UNAVAILABLE', 'Product is not available for cart');

    const variantDoc = await ProductVariant.findOne({ _id: variantId, productId, status: 'ACTIVE' });
    const variant = toPlain(variantDoc);
    if (!variant) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found for this product');

    const available = await inventoryService.getAvailableStock(variantId);
    if (normalizedQuantity > available) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${available} left in stock`);
    }

    return {
      productId: product._id,
      variantId: variant._id,
      quantity: normalizedQuantity,
      productName: product.name,
      sku: variant.sku,
      price: variant.price,
    };
  }

  async addItem({ userId, guestSessionId, productId, variantId, quantity }) {
    const normalized = await this.normalizeCartItem(productId, variantId, quantity);
    const cartQuery = userId ? { userId } : { guestSessionId };
    const cart = await Cart.findOne(cartQuery);

    if (!cart) {
      const newCart = await Cart.create({
        ...(userId ? { userId } : { guestSessionId }),
        items: [{ productId: normalized.productId, variantId: normalized.variantId, quantity: normalized.quantity }],
      });
      return this.formatCart(newCart);
    }

    const existingItem = cart.items.find((item) => String(item.variantId) === String(normalized.variantId));
    if (existingItem) {
      throw new AppError(409, 'CART_ITEM_EXISTS', 'This product is already in your cart');
    } else {
      cart.items.push({ productId: normalized.productId, variantId: normalized.variantId, quantity: normalized.quantity });
    }

    await cart.save();
    return this.formatCart(cart);
  }

  async updateItemQuantity({ userId, guestSessionId, variantId, quantity }) {
    const cart = await Cart.findOne(userId ? { userId } : { guestSessionId });
    if (!cart) throw new AppError(404, 'CART_NOT_FOUND', 'Cart not found');

    const item = cart.items.find((entry) => String(entry.variantId) === String(variantId));
    if (!item) throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found');

    const normalized = Number(quantity);
    if (!Number.isInteger(normalized) || normalized <= 0) throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be a positive integer');
    if (normalized > MAX_CART_QUANTITY) throw new AppError(400, 'INVALID_QUANTITY', `Quantity cannot exceed ${MAX_CART_QUANTITY}`);

    const variantDoc = await ProductVariant.findOne({ _id: variantId });
    const variant = toPlain(variantDoc);
    if (!variant) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found');

    const available = await inventoryService.getAvailableStock(variantId);
    if (normalized > available) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Requested quantity exceeds available stock');

    item.quantity = normalized;
    await cart.save();
    return this.formatCart(cart);
  }

  async removeItem({ userId, guestSessionId, variantId }) {
    const cart = await Cart.findOne(userId ? { userId } : { guestSessionId });
    if (!cart) throw new AppError(404, 'CART_NOT_FOUND', 'Cart not found');

    const beforeLength = cart.items.length;
    cart.items = cart.items.filter((item) => String(item.variantId) !== String(variantId));
    if (cart.items.length === beforeLength) throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found');

    await cart.save();
    return this.formatCart(cart);
  }

  async clearCart({ userId, guestSessionId }) {
    const cart = await Cart.findOne(userId ? { userId } : { guestSessionId });
    if (!cart) throw new AppError(404, 'CART_NOT_FOUND', 'Cart not found');
    cart.items = [];
    await cart.save();
    return this.formatCart(cart);
  }

  async mergeGuestCart({ userId, guestSessionId, items = [] }) {
    const guestCart = await Cart.findOne({ guestSessionId });
    const userCart = await Cart.findOne({ userId });

    const mergedItems = [...(userCart?.items ?? [])];

    for (const item of guestCart?.items ?? []) {
      const existing = mergedItems.find((entry) => String(entry.variantId) === String(item.variantId));
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        mergedItems.push({ ...item });
      }
    }

    const normalized = [];
    for (const entry of mergedItems) {
      const variantDoc = await ProductVariant.findOne({ _id: entry.variantId });
      const variant = toPlain(variantDoc);
      if (!variant) continue;

      const productDoc = await Product.findOne({ _id: variant.productId, status: 'PUBLISHED', deletedAt: null });
      const product = toPlain(productDoc);
      if (!product) continue;

      const available = await inventoryService.getAvailableStock(entry.variantId);
      const nextQuantity = Math.min(entry.quantity, available, MAX_CART_QUANTITY);
      normalized.push({ productId: variant.productId, variantId: entry.variantId, quantity: nextQuantity });
    }

    if (!userCart) {
      const cart = await Cart.create({ userId, items: normalized, status: 'ACTIVE' });
      if (guestCart) await Cart.deleteOne({ _id: guestCart._id });
      return { merged: true, cart: cart.toObject() };
    }

    userCart.items = normalized;
    if (typeof userCart.save === 'function') {
      await userCart.save();
    }
    if (guestCart) await Cart.deleteOne({ _id: guestCart._id });
    return { merged: true, cart: userCart.toObject ? userCart.toObject() : userCart };
  }
}

export const cartService = new CartService();
