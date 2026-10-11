import mongoose from 'mongoose';
import { Replacement } from '../models/replacement.model.js';
import { Return } from '../models/return.model.js';
import { ReturnItem } from '../models/return-item.model.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Product } from '../models/product.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { Inventory } from '../models/inventory.model.js';
import { AppError } from '../utils/app-error.js';
import { orderService } from './order.service.js';
import { inventoryReservationService } from './inventory-reservation.service.js';
import { replacementStateService } from './replacement-state.service.js';
import { returnNotificationService } from './return-notification.service.js';

export const isReplacementOrder = (order = null, vendorOrder = null) => {
  if (!order && !vendorOrder) return false;
  if (vendorOrder?.financialSnapshot?.isReplacement === true) return true;
  if (order?.financialSnapshot?.isReplacement === true) return true;
  if (vendorOrder?.financialSnapshot?.returnId) return true;
  if (order?.financialSnapshot?.returnId) return true;
  if (order?.paymentMethod === 'replacement') return true;
  return false;
};

export class ReplacementService {
  generateReplacementNumber() {
    const stamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `RUP-REP-${stamp}-${random}`;
  }

  async getReplacementByReturnId(returnId) {
    if (!returnId) return null;
    return Replacement.findOne({ returnId });
  }

  async getReplacementByVendorOrderId(vendorOrderId) {
    if (!vendorOrderId) return null;
    return Replacement.findOne({ replacementVendorOrderId: vendorOrderId });
  }

  async getReplacementByOrderId(orderId) {
    if (!orderId) return null;
    return Replacement.findOne({ replacementOrderId: orderId });
  }

  async syncReplacementFulfillmentStatus({ vendorOrderId, status, actorId, actorType = 'SYSTEM' }) {
    if (!vendorOrderId) return null;
    const replacement = await Replacement.findOne({ replacementVendorOrderId: vendorOrderId });
    if (!replacement) return null;

    if (!Array.isArray(replacement.statusHistory)) {
      replacement.statusHistory = [];
    }

    if (status === 'PACKED' || status === 'READY_TO_SHIP') {
      if (replacement.status === 'PENDING_FULFILLMENT' || replacement.status === 'APPROVED') {
        replacement.status = 'FULFILLMENT_STARTED';
        replacement.statusHistory.push({
          status: 'FULFILLMENT_STARTED',
          changedAt: new Date(),
          changedBy: actorId,
          actorType,
          notes: `Seller updated replacement vendor order to ${status}`,
        });
        await replacement.save();
      }
    } else if (status === 'SHIPPED') {
      if (['PENDING_FULFILLMENT', 'FULFILLMENT_STARTED', 'APPROVED'].includes(replacement.status)) {
        replacement.status = 'SHIPPED';
        replacement.statusHistory.push({
          status: 'SHIPPED',
          changedAt: new Date(),
          changedBy: actorId,
          actorType,
          notes: 'Replacement order carrier shipment dispatched',
        });
        await replacement.save();

        Return.findById(replacement.returnId).then((rDoc) => {
          if (rDoc) returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_REPLACEMENT_SHIPPED', returnDoc: rDoc }).catch(() => null);
        }).catch(() => null);
      }
    } else if (status === 'DELIVERED') {
      if (replacement.status === 'SHIPPED' || replacement.status === 'FULFILLMENT_STARTED') {
        replacement.status = 'DELIVERED';
        replacement.completedAt = new Date();
        replacement.statusHistory.push({
          status: 'DELIVERED',
          changedAt: new Date(),
          changedBy: actorId,
          actorType,
          notes: 'Replacement order delivered to customer',
        });
        await replacement.save();

        Return.findById(replacement.returnId).then((rDoc) => {
          if (rDoc) returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_REPLACEMENT_DELIVERED', returnDoc: rDoc }).catch(() => null);
        }).catch(() => null);
      }
    }
    return replacement;
  }

  async createReplacementOrder({
    returnId,
    actorId,
    actorType = 'CUSTOMER',
    idempotencyKey = null,
  }) {
    if (!returnId) {
      throw new AppError(400, 'INVALID_RETURN_ID', 'Return id is required');
    }

    // 1. Fetch return
    const returnDoc = await Return.findById(returnId);
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    // 2. Authorization & RBAC
    if (actorType === 'CUSTOMER' && String(returnDoc.customerId) !== String(actorId)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this return');
    }
    if (actorType === 'VENDOR') {
      throw new AppError(403, 'FORBIDDEN', 'Vendors are not permitted to create replacement orders');
    }

    // 3. Return status and Admin approval verification
    const isReplacementResolution = returnDoc.resolution?.action === 'REPLACEMENT';
    const isEligibleStatus =
      returnDoc.status === 'REPLACEMENT_PENDING' ||
      (returnDoc.status === 'INSPECTION_PASSED' && isReplacementResolution);

    if (returnDoc.resolution?.action && returnDoc.resolution.action !== 'REPLACEMENT') {
      throw new AppError(
        400,
        'REPLACEMENT_NOT_ALLOWED',
        `Return resolution is ${returnDoc.resolution.action}, not REPLACEMENT`,
      );
    }

    if (!isEligibleStatus || !isReplacementResolution) {
      throw new AppError(
        400,
        'REPLACEMENT_NOT_APPROVED',
        'Replacement requires Admin-approved resolution in REPLACEMENT_PENDING state',
      );
    }

    // 4. Database-backed Idempotency check
    const existingReplacement = await Replacement.findOne({ returnId: returnDoc._id });
    if (existingReplacement) {
      return existingReplacement;
    }

    if (idempotencyKey) {
      const existingKeyDoc = await Replacement.findOne({
        customerId: returnDoc.customerId,
        idempotencyKey,
      });
      if (existingKeyDoc) {
        return existingKeyDoc;
      }
    }

    // 5. Fetch Original Order & VendorOrder
    const originalOrder = await Order.findById(returnDoc.orderId);
    if (!originalOrder) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Original order not found');
    }

    let originalVendorOrder = null;
    if (returnDoc.vendorOrderId) {
      originalVendorOrder = await VendorOrder.findById(returnDoc.vendorOrderId);
    }
    if (!originalVendorOrder) {
      originalVendorOrder = await VendorOrder.findOne({
        parentOrderId: originalOrder._id,
        vendorId: returnDoc.vendorId,
      });
    }

    // 6. Fetch return items
    const rawItems = await ReturnItem.find({ _id: { $in: returnDoc.items || [] } });
    const returnItems = Array.isArray(rawItems) ? rawItems : [];
    if (returnItems.length === 0) {
      throw new AppError(400, 'NO_RETURN_ITEMS', 'No return items found for replacement');
    }

    const firstReturnItem = returnItems[0];
    const targetProductId = firstReturnItem.productId;
    const targetVariantId = firstReturnItem.variantId;
    const requestedQuantity = Number(firstReturnItem.quantity || 1);

    if (!Number.isInteger(requestedQuantity) || requestedQuantity <= 0) {
      throw new AppError(400, 'INVALID_QUANTITY', 'Replacement quantity must be a positive integer');
    }

    // 7. Quantity protection & verification against original purchase
    const originalOrderItem = (originalOrder.items || []).find(
      (item) =>
        String(item.productId) === String(targetProductId) &&
        (!targetVariantId || String(item.variantId) === String(targetVariantId)),
    );

    if (!originalOrderItem) {
      throw new AppError(404, 'ITEM_NOT_FOUND_IN_ORDER', 'Original purchased item not found in order');
    }

    const purchasedQuantity = Number(originalOrderItem.quantity || 0);
    if (requestedQuantity > purchasedQuantity) {
      throw new AppError(
        400,
        'QUANTITY_EXCEEDS_PURCHASED',
        `Replacement quantity (${requestedQuantity}) exceeds purchased quantity (${purchasedQuantity})`,
      );
    }

    // Prevent: existing replacement quantity + new replacement quantity > eligible purchased quantity
    const otherReplacements = await Replacement.find({
      originalOrderId: originalOrder._id,
      productId: targetProductId,
      variantId: targetVariantId || null,
      status: { $nin: ['ORDER_CREATION_FAILED', 'CANCELLED'] },
      returnId: { $ne: returnDoc._id },
    });
    const totalPriorReplacementQuantity = otherReplacements.reduce(
      (sum, rep) => sum + Number(rep.quantity || 0),
      0,
    );

    if (totalPriorReplacementQuantity + requestedQuantity > purchasedQuantity) {
      throw new AppError(
        400,
        'TOTAL_REPLACEMENT_QUANTITY_EXCEEDED',
        `Total replacement quantity (${totalPriorReplacementQuantity + requestedQuantity}) would exceed purchased quantity (${purchasedQuantity})`,
      );
    }

    // 8. Product / Variant live check & policy
    const product = await Product.findOne({ _id: targetProductId, deletedAt: null });
    if (!product) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found or has been removed');
    }

    if (targetVariantId) {
      const variant = await ProductVariant.findById(targetVariantId);
      if (!variant) {
        throw new AppError(404, 'VARIANT_NOT_FOUND', 'Product variant not found');
      }
    }

    // 9. Live Inventory check
    if (targetVariantId) {
      const inventory = await Inventory.findOne({ variantId: targetVariantId, deletedAt: null });
      if (!inventory) {
        throw new AppError(404, 'INVENTORY_NOT_FOUND', 'Inventory record not found for variant');
      }
      if (Number(inventory.availableQuantity || 0) < requestedQuantity) {
        throw new AppError(
          409,
          'INSUFFICIENT_STOCK',
          `Insufficient inventory: only ${inventory.availableQuantity || 0} items available for replacement`,
        );
      }
    }

    // 10. Replacement Order Creation (Zero customer payment)
    const replacementOrderNumber = orderService.generateOrderNumber();
    const orderItems = [
      {
        productId: targetProductId,
        variantId: targetVariantId,
        vendorId: returnDoc.vendorId,
        productName: originalOrderItem.productName,
        sku: originalOrderItem.sku,
        quantity: requestedQuantity,
        unitPrice: 0,
        lineTotal: 0,
        categoryId: originalOrderItem.categoryId || null,
        productSnapshot: originalOrderItem.productSnapshot || {},
      },
    ];

    let createdOrder = null;
    let createdVendorOrder = null;
    let reservedItem = null;

    try {
      createdOrder = await Order.create({
        customerId: returnDoc.customerId,
        orderNumber: replacementOrderNumber,
        subtotal: 0,
        discount: 0,
        tax: 0,
        shipping: 0,
        total: 0,
        currency: originalOrder.currency || 'INR',
        items: orderItems,
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
        paymentMethod: 'replacement',
        idempotencyKey: idempotencyKey ? `rep-order-${idempotencyKey}` : null,
        shippingAddressSnapshot: originalOrder.shippingAddressSnapshot || {},
        billingAddressSnapshot: originalOrder.billingAddressSnapshot || {},
        financialSnapshot: {
          isReplacement: true,
          originalOrderId: originalOrder._id,
          returnId: returnDoc._id,
          originalItemUnitPrice: originalOrderItem.unitPrice,
          originalItemLineTotal: originalOrderItem.lineTotal,
        },
      });

      // 11. Reserve inventory atomically
      if (targetVariantId) {
        reservedItem = await inventoryReservationService.createReservation({
          orderId: createdOrder._id,
          variantId: targetVariantId,
          productId: targetProductId,
          quantity: requestedQuantity,
          createdBy: actorId,
        });
      }

      // 12. Create replacement VendorOrder
      createdVendorOrder = await VendorOrder.create({
        parentOrderId: createdOrder._id,
        vendorId: returnDoc.vendorId,
        customerId: returnDoc.customerId,
        status: 'CONFIRMED',
        items: [
          {
            productId: targetProductId,
            variantId: targetVariantId,
            productName: originalOrderItem.productName,
            sku: originalOrderItem.sku,
            quantity: requestedQuantity,
            unitPrice: 0,
            lineTotal: 0,
            productSnapshot: originalOrderItem.productSnapshot || {},
          },
        ],
        subtotal: 0,
        discount: 0,
        tax: 0,
        shipping: 0,
        total: 0,
        currency: originalOrder.currency || 'INR',
        financialSnapshot: {
          isReplacement: true,
          originalOrderId: originalOrder._id,
          originalVendorOrderId: originalVendorOrder ? originalVendorOrder._id : null,
          returnId: returnDoc._id,
        },
      });

      createdOrder.vendorOrders = [createdVendorOrder._id];
      await createdOrder.save();

      // 13. Create Replacement Record
      const replacementNumber = this.generateReplacementNumber();
      const replacementDoc = await Replacement.create({
        replacementNumber,
        returnId: returnDoc._id,
        originalOrderId: originalOrder._id,
        originalVendorOrderId: originalVendorOrder ? originalVendorOrder._id : null,
        customerId: returnDoc.customerId,
        vendorId: returnDoc.vendorId,
        productId: targetProductId,
        variantId: targetVariantId,
        quantity: requestedQuantity,
        productSnapshot: originalOrderItem.productSnapshot || {},
        status: 'PENDING_FULFILLMENT',
        replacementOrderId: createdOrder._id,
        replacementVendorOrderId: createdVendorOrder._id,
        idempotencyKey,
        approvedAt: returnDoc.resolution?.resolvedAt || new Date(),
        createdBy: actorId,
        statusHistory: [
          {
            status: 'APPROVED',
            changedAt: new Date(),
            changedBy: actorId,
            actorType,
            notes: 'Replacement approved for order creation',
          },
          {
            status: 'ORDER_CREATED',
            changedAt: new Date(),
            changedBy: actorId,
            actorType,
            notes: `Replacement order created: ${createdOrder.orderNumber}`,
          },
          {
            status: 'PENDING_FULFILLMENT',
            changedAt: new Date(),
            changedBy: actorId,
            actorType,
            notes: 'Replacement order confirmed and awaiting fulfillment',
          },
        ],
      });

      // Update Return status history
      if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
      returnDoc.statusHistory.push({
        status: returnDoc.status,
        changedAt: new Date(),
        changedBy: actorId,
        actorType,
        notes: `Replacement order #${createdOrder.orderNumber} created`,
      });
      await returnDoc.save();

      returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_REPLACEMENT_APPROVED', returnDoc }).catch(() => null);

      return replacementDoc;
    } catch (creationError) {
      // Failure rollback: compensate inventory reservation & cleanup
      if (reservedItem && targetVariantId && createdOrder) {
        await inventoryReservationService
          .releaseReservation({
            orderId: createdOrder._id,
            variantId: targetVariantId,
            reason: 'Rollback due to replacement creation failure',
            actorId,
          })
          .catch((releaseErr) => {
            console.error('Failed to release reservation during compensation:', releaseErr);
          });
      }

      if (createdOrder) {
        await Order.findByIdAndUpdate(createdOrder._id, {
          $set: { status: 'FAILED' },
        }).catch(() => null);
      }

      if (createdVendorOrder) {
        await VendorOrder.findByIdAndUpdate(createdVendorOrder._id, {
          $set: { status: 'FAILED' },
        }).catch(() => null);
      }

      // If race condition on replacement uniqueness
      if (creationError?.code === 11000) {
        const found = await Replacement.findOne({ returnId: returnDoc._id });
        if (found) return found;
      }

      throw creationError;
    }
  }
}

export const replacementService = new ReplacementService();
