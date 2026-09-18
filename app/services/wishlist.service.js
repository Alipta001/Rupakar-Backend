import { AppError } from '../utils/app-error.js';
import { Wishlist } from '../models/wishlist.model.js';
import { Product } from '../models/product.model.js';
import mongoose from 'mongoose';

const toPlain = (doc) => {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
};

export class WishlistService {
  async addItem({ userId, productId }) {
    if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    if (!productId) throw new AppError(400, 'INVALID_PRODUCT', 'Product ID is required');
    if (!mongoose.isValidObjectId(productId)) {
      throw new AppError(400, 'INVALID_PRODUCT', 'Product ID is invalid');
    }

    const product = await Product.findById(productId);
    if (!product || product.deletedAt) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

    const existing = await Wishlist.findOne({ userId, productId });
    if (existing) throw new AppError(409, 'WISHLIST_ITEM_EXISTS', 'Product already in wishlist');

    try {
      const item = await Wishlist.create({ userId, productId });
      return toPlain(item);
    } catch (error) {
      if (error?.code === 11000) {
        throw new AppError(409, 'WISHLIST_ITEM_EXISTS', 'Product already in wishlist');
      }
      throw error;
    }
  }

  async removeItem({ userId, productId }) {
    if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    const result = await Wishlist.deleteOne({ userId, productId });
    if (result.deletedCount === 0) throw new AppError(404, 'WISHLIST_ITEM_NOT_FOUND', 'Wishlist item not found');
    return true;
  }

  async listItems(userId, { page = 1, limit = 20 } = {}) {
    if (!userId) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');

    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const skip = (safePage - 1) * safeLimit;
    let query = Wishlist.find({ userId });
    if (typeof query.sort === 'function') query = query.sort({ createdAt: -1, _id: -1 });
    if (typeof query.skip === 'function') query = query.skip(skip);
    if (typeof query.limit === 'function') query = query.limit(safeLimit);
    const items = await query;
    const total = typeof Wishlist.countDocuments === 'function' ? await Wishlist.countDocuments({ userId }) : items.length;
    let pQuery = Product.find({ _id: { $in: items.map((item) => item.productId) } });
    if (typeof pQuery.populate === 'function') {
      pQuery = pQuery.populate('variants').populate('images');
    }
    const rawProducts = typeof pQuery.lean === 'function' ? await pQuery.lean() : await pQuery;
    const products = Array.isArray(rawProducts) ? rawProducts : [];

    return {
      userId,
      items: products.map((product) => {
        const primaryVariant = product.variants?.[0] || null;
        const price = primaryVariant?.price ?? 0;
        const primaryImage =
          product.images?.find((i) => i.isPrimary)?.url ??
          product.images?.[0]?.url ??
          '/images/product-vase.jpg';

        return {
          productId: String(product._id),
          variantId: primaryVariant ? String(primaryVariant._id) : String(product._id),
          name: product.name,
          slug: product.slug,
          price,
          compareAtPrice: primaryVariant?.compareAtPrice ?? null,
          image: primaryImage,
          craft: product.craft ?? product.tags?.[0] ?? 'Handcrafted',
          artisan: product.artisan ?? 'Rupakar Artisan',
          status: product.status,
          available: product.status === 'PUBLISHED' && !product.deletedAt,
        };
      }),
      page: safePage,
      limit: safeLimit,
      total,
    };
  }
}

export const wishlistService = new WishlistService();
