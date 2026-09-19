import { Product } from '../models/product.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { AppError } from '../utils/app-error.js';
import { taxService } from './tax.service.js';
import { shippingService } from './shipping.service.js';
import { couponService } from './coupon.service.js';
import { inventoryService } from './inventory.service.js';
import { userAddressService } from './user-address.service.js';
import mongoose from 'mongoose';

const toPlain = (doc) => {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
};

export class PricingService {
  async buildPriceSummary({ userId = null, items = [], shippingAddressId = null, couponCode = null, shippingAddress = null } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError(400, 'CHECKOUT_EMPTY_CART', 'Checkout requires at least one item');
    }

    const normalizedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const productId = item.productId;
      const variantId = item.variantId;
      const quantity = Number(item.quantity ?? 1);

      if (!productId || !variantId) {
        throw new AppError(400, 'INVALID_CHECKOUT_ITEM', 'Each line item requires productId and variantId');
      }

      if (!mongoose.isValidObjectId(productId)) {
        throw new AppError(400, 'INVALID_PRODUCT_ID', 'Product id is invalid');
      }
      if (!mongoose.isValidObjectId(variantId)) {
        throw new AppError(400, 'INVALID_VARIANT_ID', 'Variant id is invalid');
      }

      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new AppError(400, 'INVALID_QUANTITY', 'Each item quantity must be a positive integer');
      }

      const variantDoc = await ProductVariant.findOne({ _id: variantId, status: 'ACTIVE' });
      const variant = toPlain(variantDoc);
      if (!variant) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found for this checkout item');

      const productDoc = await Product.findOne({ _id: productId, status: 'PUBLISHED', deletedAt: null });
      const product = toPlain(productDoc);
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product is not available for checkout');

      const available = await inventoryService.getAvailableStock(variantId);
      if (quantity > available) {
        throw new AppError(409, 'INSUFFICIENT_STOCK', `Requested quantity exceeds available stock for variant ${String(variantId)}`);
      }

      if (String(product._id) !== String(variant.productId)) {
        throw new AppError(400, 'INVALID_CHECKOUT_ITEM', 'Variant does not belong to the provided product');
      }

      const lineTotal = Number(variant.price || 0) * quantity;
      subtotal += lineTotal;
      normalizedItems.push({
        productId: product._id,
        productName: product.name,
        variantId: variant._id,
        sku: variant.sku,
        quantity,
        unitPrice: Number(variant.price || 0),
        lineTotal,
        categoryId: product.categoryId,
        product,
      });
    }

    let finalShippingAddress = shippingAddress;
    if (!finalShippingAddress && shippingAddressId) {
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required to use a saved address');
      }
      finalShippingAddress = await userAddressService.getAddress(userId, shippingAddressId);
      if (!finalShippingAddress) {
        throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Shipping address not found');
      }
    }

    const tax = taxService.calculateOrderTax({ subtotal, items: normalizedItems });
    const shipping = shippingService.calculateShipping({ subtotal, items: normalizedItems, shippingAddress: finalShippingAddress });

    let discount = { amount: 0, code: null, discountType: null, coupon: null };
    if (couponCode) {
      const result = await couponService.validateCoupon({
        couponCode,
        userId,
        subtotal,
        items: normalizedItems,
      });
      discount = { amount: result.discount, code: result.code, discountType: result.discountType, coupon: result.coupon };
    }

    const total = Math.max(0, subtotal + tax.amount + shipping.amount - discount.amount);

    return {
      currency: 'INR',
      subtotal,
      tax: tax.amount,
      shipping: shipping.amount,
      discount: discount.amount,
      total,
      items: normalizedItems.map((entry) => ({
        productId: entry.productId,
        variantId: entry.variantId,
        sku: entry.sku,
        productName: entry.productName,
        quantity: entry.quantity,
        unitPrice: entry.unitPrice,
        lineTotal: entry.lineTotal,
      })),
      breakdown: {
        subtotal,
        tax: { amount: tax.amount, rate: tax.rate },
        shipping: { amount: shipping.amount, method: shipping.method },
        discount: { amount: discount.amount, code: discount.code },
      },
      shippingAddress: finalShippingAddress ?? null,
      coupon: discount.coupon ? { code: discount.code, ...discount.coupon } : null,
      taxRate: tax.rate,
    };
  }
}

export const pricingService = new PricingService();
