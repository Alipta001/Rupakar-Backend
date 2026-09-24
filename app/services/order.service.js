import mongoose from 'mongoose';
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
import { inventoryService } from './inventory.service.js';
import { InventoryReservation } from '../models/inventory-reservation.model.js';
import { paymentService } from './payment.service.js';
import { refundService } from './refund.service.js';
import { notificationService } from './notification.service.js';
import { emailService } from './email.service.js';
import { smsService } from './sms.service.js';
import { Vendor } from '../models/vendor.model.js';
import { User } from '../models/user.model.js';
import { env } from '../config/env.js';



const ORDER_STATUS_TRANSITIONS = {
  PENDING_PAYMENT: ['PAID', 'FAILED', 'CANCELLED'],
  PAID: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PACKED', 'CANCELLED'],
  PACKED: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT', 'DELIVERY_FAILED', 'CANCELLED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED', 'CANCELLED'],
  DELIVERED: ['RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED', 'CANCELLED'],
  RETURN_REQUESTED: ['RETURN_IN_TRANSIT', 'RETURNED', 'CANCELLED'],
  RETURN_IN_TRANSIT: ['RETURNED', 'CANCELLED'],
  RETURNED: ['REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  FAILED: [],
  REFUND_PENDING: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  REFUNDED: [],
  PARTIALLY_REFUNDED: [],
  CANCELLED: [],
};

export class OrderService {
  generateOrderNumber() {
    const stamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 10).toUpperCase();
    return `ORD-${new Date().getFullYear()}-${stamp}-${random}`;
  }

  calculateParentOrderStatus(statuses = []) {
    const normalized = Array.from(new Set((Array.isArray(statuses) ? statuses : []).filter(Boolean).map((status) => String(status).trim().toUpperCase())));
    if (normalized.length === 0) return 'PENDING_PAYMENT';
    if (normalized.every((status) => status === 'CANCELLED')) return 'CANCELLED';

    const statusPriority = ['PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'PROCESSING', 'PACKED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED', 'DELIVERY_FAILED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED', 'CANCELLED'];
    const ranked = normalized.map((status) => ({ status, rank: statusPriority.indexOf(status) === -1 ? -1 : statusPriority.indexOf(status) }));
    const latest = ranked.filter((entry) => entry.rank >= 0).sort((a, b) => b.rank - a.rank)[0];
    return latest ? latest.status : 'PENDING_PAYMENT';
  }

  async syncParentOrderStatus(orderId) {
    if (!orderId) return null;
    const [currentOrder, vendorOrders] = await Promise.all([
      Order.findById(orderId).select('status').lean(),
      VendorOrder.find({ parentOrderId: orderId }).select('status').lean(),
    ]);
    if (!currentOrder) return null;
    const nextStatus = this.calculateParentOrderStatus(vendorOrders.map((entry) => entry.status));
    if (nextStatus === currentOrder.status) return currentOrder;
    const updated = await Order.findByIdAndUpdate(orderId, { $set: { status: nextStatus } }, { new: true });
    return updated ? (typeof updated.toObject === 'function' ? updated.toObject() : updated) : { ...currentOrder, status: nextStatus };
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

  async notifyVendorsOrderCancelled({ order, vendorOrders = [], reason = 'Customer cancelled' }) {
    try {
      if (mongoose.connection && mongoose.connection.readyState !== 1) {
        return;
      }
      const orderNumber = order.orderNumber || String(order._id).slice(-8);
      for (const vo of vendorOrders) {
        if (!vo.vendorId) continue;
        const vendor = await Vendor.findById(vo.vendorId).select('ownerUserId email phone name').lean();
        if (!vendor) continue;
        const owner = vendor.ownerUserId ? await User.findById(vendor.ownerUserId).select('email phone').lean() : null;
        const targetEmail = owner?.email || vendor.email;
        const targetPhone = owner?.phone || vendor.phone;

        if (vendor.ownerUserId) {
          await notificationService.createNotification({
            userId: vendor.ownerUserId,
            type: 'ORDER_CANCELLED',
            title: 'Order Cancelled',
            message: `Customer cancelled Order #${orderNumber}. Reason: ${reason}`,
            channel: 'IN_APP',
            metadata: {
              idempotencyKey: `order_cancel_${order._id}_${vo._id}_vendor_inapp`,
              orderId: order._id,
              vendorOrderId: vo._id,
              reason,
            },
          }).catch(() => null);
        }

        if (targetEmail) {
          await emailService.sendEmail({
            to: targetEmail,
            subject: `Order #${orderNumber} Cancelled - Customer Action`,
            html: `<p>Customer has cancelled Order #${orderNumber}.</p><p>Reason: ${reason}</p>`,
            text: `Customer has cancelled Order #${orderNumber}. Reason: ${reason}`,
          }).catch(() => null);
        }

        const rawPhone = String(targetPhone || '').trim();
        const digitsOnly = rawPhone.replace(/[^\d+]/g, '');
        if (/^\+?[0-9]{10,15}$/.test(digitsOnly)) {
          await smsService.sendSms({
            to: rawPhone,
            message: `Rupakar: Order #${orderNumber} has been cancelled by customer. Reason: ${reason}.`,
          }).catch(() => null);
        }
      }

      if (order.customerId) {
        await notificationService.createNotification({
          userId: order.customerId,
          type: 'ORDER_CANCELLED',
          title: 'Order Cancelled',
          message: `Your Order #${orderNumber} has been successfully cancelled.`,
          channel: 'IN_APP',
          metadata: {
            idempotencyKey: `order_cancel_${order._id}_customer_inapp`,
            orderId: order._id,
            reason,
          },
        }).catch(() => null);

        const customer = await User.findById(order.customerId).select('email phone name').lean();
        if (customer?.email) {
          await emailService.sendEmail({
            to: customer.email,
            subject: `Order #${orderNumber} Cancelled`,
            html: `<p>Your Order #${orderNumber} has been successfully cancelled.</p>`,
            text: `Your Order #${orderNumber} has been successfully cancelled.`,
          }).catch(() => null);
        }

        const rawCustomerPhone = String(customer?.phone || '').trim();
        const digitsOnlyCustomer = rawCustomerPhone.replace(/[^\d+]/g, '');
        if (/^\+?[0-9]{10,15}$/.test(digitsOnlyCustomer)) {
          await smsService.sendSms({
            to: rawCustomerPhone,
            message: `Rupakar: Your Order #${orderNumber} has been cancelled.`,
          }).catch(() => null);
        }
      }
    } catch (err) {
      console.error('Failed to send order cancellation notifications:', err?.message || err);
    }
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

    const vendorOrdersToCancel = await VendorOrder.find({ parentOrderId: order._id });

    // Validate state conflicts: once packed or shipped, order cannot be directly cancelled by customer
    if (actorType === 'CUSTOMER') {
      if (['PACKED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)) {
        throw new AppError(409, 'ORDER_ALREADY_PACKED', 'This order can no longer be cancelled because it has already been packed');
      }
      const packedVo = vendorOrdersToCancel.find((vo) =>
        ['PACKED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(vo.status)
      );
      if (packedVo) {
        throw new AppError(409, 'ORDER_ALREADY_PACKED', 'This order can no longer be cancelled because it has already been packed');
      }
    }

    const payment = await paymentService.getPaymentForOrder(order._id);
    let targetPaymentStatus = 'CANCELLED';
    if (payment) {
      const currentPaymentStatus = payment.status || 'PENDING';
      if (['CAPTURED', 'PAID'].includes(currentPaymentStatus)) {
        await paymentService.transitionPaymentStatus(currentPaymentStatus, 'REFUND_PENDING', {
          paymentId: payment._id,
          orderId: order._id,
          actorType,
          actorId,
          reason,
        });
        if (typeof payment.save === 'function') {
          payment.status = 'REFUND_PENDING';
          await payment.save();
        } else {
          await Payment.findByIdAndUpdate(payment._id, { $set: { status: 'REFUND_PENDING' } });
        }

        // Process refunds: NEVER silently fail refunds!
        if (vendorOrdersToCancel.length > 0) {
          for (const vo of vendorOrdersToCancel) {
            const voRefundAmount = Number(vo.total || 0);
            if (voRefundAmount > 0) {
              await refundService.createRefund({
                refundData: {
                  orderId: order._id,
                  vendorOrderId: vo._id,
                  paymentId: payment._id,
                  customerId: order.customerId,
                  vendorId: vo.vendorId,
                  amount: voRefundAmount,
                  reason: `ORDER_CANCELLED: ${reason}`,
                  isCancellation: true,
                },
              });
            }
          }
        } else {
          const refundAmount = Number(order.total || payment.amount || 0);
          if (refundAmount > 0) {
            await refundService.createRefund({
              refundData: {
                orderId: order._id,
                paymentId: payment._id,
                customerId: order.customerId,
                vendorId: order.vendorId || order.customerId,
                amount: refundAmount,
                reason: `ORDER_CANCELLED: ${reason}`,
                isCancellation: true,
              },
            });
          }
        }
        targetPaymentStatus = 'REFUND_PENDING';
      } else if (['PENDING', 'AUTHORIZED', 'CREATED'].includes(currentPaymentStatus)) {
        await paymentService.transitionPaymentStatus(currentPaymentStatus, 'CANCELLED', {
          paymentId: payment._id,
          orderId: order._id,
          actorType,
          actorId,
          reason,
        });
        if (typeof payment.save === 'function') {
          payment.status = 'CANCELLED';
          payment.failureReason = reason;
          await payment.save();
        } else {
          await Payment.findByIdAndUpdate(payment._id, {
            $set: { status: 'CANCELLED', failureReason: reason },
          });
        }
        targetPaymentStatus = 'CANCELLED';
      } else if (['REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(currentPaymentStatus)) {
        targetPaymentStatus = currentPaymentStatus;
      }
    }

    const currentOrderStatus = order.status;
    await this.transitionOrderStatus(currentOrderStatus, 'CANCELLED', {
      orderId: order._id,
      actorType,
      actorId,
      reason,
    });

    for (const item of order.items || []) {
      const released = await inventoryReservationService.releaseReservation({
        orderId: order._id,
        variantId: item.variantId,
        reason,
        actorId,
      });

      if (!released) {
        const consumed = await InventoryReservation.findOne({ orderId: order._id, variantId: item.variantId, status: 'CONSUMED' });
        if (consumed) {
          await InventoryReservation.updateOne({ _id: consumed._id }, { $set: { status: 'CANCELLED' } });
          await inventoryService.increaseStock(item.variantId, item.quantity, {
            referenceType: 'ORDER_CANCELLED',
            referenceId: String(order._id),
            reason: 'Restock consumed reservation upon order cancellation',
          }).catch(() => null);
        }
      }
    }

    for (const vo of vendorOrdersToCancel) {
      if (vo.inventoryDecremented) {
        for (const item of vo.items || []) {
          const hasRes = await InventoryReservation.findOne({ orderId: order._id, variantId: item.variantId });
          if (!hasRes) {
            await inventoryService.increaseStock(item.variantId, item.quantity, {
              referenceType: 'ORDER_CANCELLED',
              referenceId: String(vo._id),
              reason: 'Restock vendor order upon order cancellation',
            }).catch(() => null);
          }
        }
        vo.inventoryDecremented = false;
        await vo.save();
      }
    }

    await VendorOrder.updateMany({ parentOrderId: order._id }, { $set: { status: 'CANCELLED' } });

    const updatedOrder = await Order.findByIdAndUpdate(order._id, {
      $set: {
        status: 'CANCELLED',
        paymentStatus: targetPaymentStatus,
        cancelledAt: new Date(),
        cancelledReason: reason,
      },
    }, { new: true });

    // Asynchronously notify vendors & customer (failure-isolated)
    this.notifyVendorsOrderCancelled({
      order: updatedOrder || order,
      vendorOrders: vendorOrdersToCancel,
      reason,
    }).catch((err) => {
      console.error('Failed to notify parties of order cancellation:', err?.message || err);
    });

    return updatedOrder ? (updatedOrder.toObject ? updatedOrder.toObject() : updatedOrder) : { status: 'CANCELLED', paymentStatus: targetPaymentStatus };
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
