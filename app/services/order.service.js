import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { OrderStatusHistory } from '../models/order-status-history.model.js';
import { Cart } from '../models/cart.model.js';
import { Product } from '../models/product.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { Inventory } from '../models/inventory.model.js';
import { Payment } from '../models/payment.model.js';
import { AppError } from '../utils/app-error.js';
import { pricingService } from './pricing.service.js';
import { inventoryReservationService } from './inventory-reservation.service.js';
import { paymentService } from './payment.service.js';
import { env } from '../config/env.js';



const ORDER_STATUS_TRANSITIONS = {
  PENDING_PAYMENT: ['PAID', 'FAILED', 'CANCELLED'],
  PAID: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  FAILED: [],
  CANCELLED: [],
};

export class OrderService {
  generateOrderNumber() {
    const stamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 10).toUpperCase();
    return `ORD-${new Date().getFullYear()}-${stamp}-${random}`;
  }

  async getExistingOrderForIdempotency(customerId, idempotencyKey) {
    if (!customerId || !idempotencyKey) return null;
    const doc = await Order.findOne({ customerId, idempotencyKey });
    if (!doc) return null;
    return typeof doc.toObject === 'function' ? doc.toObject() : doc;
  }

  async transitionOrderStatus(currentStatus, nextStatus, { orderId = null, actorType = 'SYSTEM', actorId = null, reason = null } = {}) {
    if (!currentStatus || !nextStatus) {
      throw new AppError(400, 'INVALID_ORDER_TRANSITION', 'Order status transition is invalid');
    }

    const allowed = ORDER_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(400, 'INVALID_ORDER_TRANSITION', `Cannot transition from ${currentStatus} to ${nextStatus}`);
    }

    if (orderId) {
      await OrderStatusHistory.create({
        orderId,
        previousStatus: currentStatus,
        newStatus: nextStatus,
        reason,
        actorType,
        actorId,
      });
    }

    return { previousStatus: currentStatus, nextStatus };
  }

  async compensatePaymentCreationFailure({ orderId, orderItems = [], vendorOrderIds = [], reason = 'Payment creation failed' }) {
    await Promise.allSettled(
      orderItems.map((item) => inventoryReservationService.releaseReservation({
        orderId,
        variantId: item.variantId,
        reason,
      })),
    );

    if (vendorOrderIds.length > 0) {
      await VendorOrder.updateMany(
        { _id: { $in: vendorOrderIds } },
        { $set: { status: 'FAILED' } },
      );
    }

    await this.transitionOrderStatus('PENDING_PAYMENT', 'FAILED', {
      orderId,
      actorType: 'SYSTEM',
      reason,
    });
    await Order.findByIdAndUpdate(orderId, {
      $set: { status: 'FAILED', paymentStatus: 'FAILED' },
    });
  }

  async cancelOrder({ orderId, customerId, reason = 'Customer cancelled', actorType = 'CUSTOMER', actorId = null }) {
    if (!orderId) {
      throw new AppError(400, 'INVALID_ORDER_ID', 'Order id is required');
    }

    const order = await Order.findById(orderId);
    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    if (customerId && String(order.customerId) !== String(customerId)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this order');
    }

    if (order.status === 'CANCELLED') {
      return { ...order.toObject(), status: 'CANCELLED', paymentStatus: order.paymentStatus || 'CANCELLED' };
    }

    const currentOrderStatus = order.status;
    await this.transitionOrderStatus(currentOrderStatus, 'CANCELLED', {
      orderId: order._id,
      actorType,
      actorId,
      reason,
    });

    for (const item of order.items || []) {
      await inventoryReservationService.releaseReservation({
        orderId: order._id,
        variantId: item.variantId,
        reason,
        actorId,
      });
    }

    const payment = await paymentService.getPaymentForOrder(order._id);
    if (payment) {
      const currentPaymentStatus = payment.status || 'PENDING';
      await paymentService.transitionPaymentStatus(currentPaymentStatus, 'CANCELLED', {
        paymentId: payment._id,
        orderId: order._id,
        actorType,
        actorId,
        reason,
      });
      await Payment.findOneAndUpdate({ _id: payment._id }, {
        $set: { status: 'CANCELLED', failureReason: reason, paidAt: payment.status === 'CAPTURED' ? payment.paidAt : null },
      }, { new: true });
    }

    await VendorOrder.updateMany({ parentOrderId: order._id }, { $set: { status: 'CANCELLED' } });

    const updatedOrder = await Order.findByIdAndUpdate(order._id, {
      $set: {
        status: 'CANCELLED',
        paymentStatus: payment?.status === 'CAPTURED' ? 'CANCELLED' : 'CANCELLED',
        cancelledAt: new Date(),
        cancelledReason: reason,
      },
    }, { new: true });

    return updatedOrder ? updatedOrder.toObject ? updatedOrder.toObject() : updatedOrder : { status: 'CANCELLED', paymentStatus: 'CANCELLED' };
  }

  async createOrder({
    customerId,
    shippingAddressId,
    shippingAddress,
    billingAddressId,
    couponCode,
    paymentMethod = 'razorpay',
    idempotencyKey,
  }) {
    if (!customerId) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required');
    }

    const normalizedPaymentMethod = String(paymentMethod).toLowerCase();
    if (!['cod', 'razorpay', 'mock'].includes(normalizedPaymentMethod)) {
      throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'Unsupported payment method');
    }
    if (normalizedPaymentMethod === 'mock' && !env.PAYMENT_MOCK_ENABLED) {
      throw new AppError(503, 'PAYMENT_MOCK_UNAVAILABLE', 'Mock payments are disabled');
    }
    if (normalizedPaymentMethod === 'razorpay' && !paymentService.isRazorpayEnabled()) {
      throw new AppError(503, 'RAZORPAY_UNAVAILABLE', 'Online payment is currently unavailable');
    }

    if (idempotencyKey) {
      const duplicate = await this.getExistingOrderForIdempotency(customerId, idempotencyKey);
      if (duplicate) {
        return { ...duplicate, duplicate: true };
      }
    }

    const cartDoc = await Cart.findOne({ userId: customerId });
    if (!cartDoc || !Array.isArray(cartDoc.items) || cartDoc.items.length === 0) {
      throw new AppError(400, 'EMPTY_CART', 'Cart is empty');
    }

    const items = cartDoc.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: Number(item.quantity ?? 1),
    }));

    const summary = await pricingService.buildPriceSummary({
      userId: customerId,
      items,
      shippingAddressId,
      couponCode,
      shippingAddress,
    });

    const orderItems = [];
    const vendorGroups = new Map();

    for (const item of summary.items) {
      let productQuery = Product.findOne({ _id: item.productId, status: 'PUBLISHED', deletedAt: null });
      // Product.images stores references; populate them before taking the order
      // snapshot so Cloudinary URLs survive independently of later catalogue edits.
      if (typeof productQuery.populate === 'function') productQuery = productQuery.populate({ path: 'images', match: { status: 'ACTIVE' } });
      const productDoc = await productQuery;
      const variantDoc = await ProductVariant.findOne({ _id: item.variantId, status: 'ACTIVE' });
      if (!productDoc || !variantDoc) {
        throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product or variant unavailable');
      }
      const product = typeof productDoc.toObject === 'function' ? productDoc.toObject() : productDoc;
      const variant = typeof variantDoc.toObject === 'function' ? variantDoc.toObject() : variantDoc;

      const inventory = await Inventory.findOne({ variantId: item.variantId, deletedAt: null });
      if (!inventory || inventory.availableQuantity < item.quantity) {
        throw new AppError(409, 'INSUFFICIENT_STOCK', 'Insufficient stock available');
      }

      const vendorId = product.vendorId;
      // Keep the product presentation needed to render a historical order.  The
      // product itself can be edited or unpublished after checkout, so resolving
      // images from the live catalogue in the customer order view is unreliable.
      const productImages = Array.isArray(product.images)
        ? product.images
          .filter((image) => image?.status !== 'INACTIVE' && image?.url)
          .sort((left, right) => Number(Boolean(right.isPrimary)) - Number(Boolean(left.isPrimary)) || Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
          .map((image) => ({ url: image.url, altText: image.altText || product.name, variantId: image.variantId ? String(image.variantId) : null, isPrimary: Boolean(image.isPrimary) }))
        : [];
      const variantImage = productImages.find((image) => image.variantId === String(item.variantId));
      const primaryImage = variantImage?.url || productImages[0]?.url || null;
      const productSnapshot = {
        name: product.name,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice ?? null,
        attributes: variant.attributes || {},
        categoryId: product.categoryId || null,
        image: primaryImage,
        images: productImages,
      };
      if (!vendorGroups.has(String(vendorId))) {
        vendorGroups.set(String(vendorId), { vendorId, items: [], subtotal: 0, discount: 0, tax: 0, shipping: 0, total: 0 });
      }

      const group = vendorGroups.get(String(vendorId));
      const unitPrice = Number(variant.price || 0);
      const lineTotal = unitPrice * item.quantity;
      group.items.push({
        productId: item.productId,
        variantId: item.variantId,
        productName: product.name,
        sku: variant.sku,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
        productSnapshot,
      });
      group.subtotal += lineTotal;
      vendorGroups.set(String(vendorId), group);

      orderItems.push({
        productId: item.productId,
        variantId: item.variantId,
        vendorId,
        productName: product.name,
        sku: variant.sku,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
        categoryId: product.categoryId,
        productSnapshot,
      });
    }

    const orderNumber = this.generateOrderNumber();
    const orderDoc = await Order.create({
      customerId,
      orderNumber,
      subtotal: summary.subtotal,
      discount: summary.discount,
      tax: summary.tax,
      shipping: summary.shipping,
      total: summary.total,
      currency: summary.currency,
      items: orderItems,
      paymentStatus: 'PENDING',
      status: 'PENDING_PAYMENT',
      paymentMethod: normalizedPaymentMethod,
      idempotencyKey,
      shippingAddressSnapshot: summary.shippingAddress || shippingAddress || {},
      billingAddressSnapshot: {},
    });

    const reservationRecords = [];
    for (const item of orderItems) {
      const reservation = await inventoryReservationService.createReservation({
        orderId: orderDoc._id,
        variantId: item.variantId,
        productId: item.productId,
        quantity: item.quantity,
        createdBy: customerId,
      });
      reservationRecords.push(reservation);
    }

    let payment;
    try {
      payment = await paymentService.createPayment({
        order: orderDoc.toObject ? orderDoc.toObject() : orderDoc,
        customerId,
        amount: summary.total,
        method: paymentMethod,
        idempotencyKey,
        provider: normalizedPaymentMethod === 'razorpay' ? 'razorpay' : normalizedPaymentMethod,
      });
    } catch (error) {
      try {
        await this.compensatePaymentCreationFailure({
          orderId: orderDoc._id,
          orderItems,
          vendorOrderIds: [],
        });
      } catch (compensationError) {
        error.compensationError = compensationError;
      }
      throw error;
    }

    if (normalizedPaymentMethod === 'cod') {
      await Cart.updateOne({ userId: customerId }, { $pull: { items: { variantId: { $in: orderItems.map((item) => item.variantId) } } } });
    }

    return {
      ...orderDoc.toObject(),
      payment,
      vendorOrders: [],
      reservationRecords,
    };
  }
}

export const orderService = new OrderService();
