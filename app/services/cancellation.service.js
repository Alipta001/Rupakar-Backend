import { CancellationRequest } from '../models/cancellation-request.model.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Payment } from '../models/payment.model.js';
import { Vendor } from '../models/vendor.model.js';
import { User } from '../models/user.model.js';
import { InventoryReservation } from '../models/inventory-reservation.model.js';
import { inventoryService } from './inventory.service.js';
import { inventoryReservationService } from './inventory-reservation.service.js';
import { refundService } from './refund.service.js';
import { notificationService } from './notification.service.js';
import { emailService } from './email.service.js';
import { smsService } from './sms.service.js';
import { AppError } from '../utils/app-error.js';

export class CancellationService {
  /**
   * Customer submits a cancellation request for a product/item in an order.
   */
  async createRequest({ customerId, orderId, variantId, quantity, reason, customerNote }) {
    if (!customerId || !orderId || !variantId || !reason) {
      throw new AppError(400, 'INVALID_CANCELLATION_PAYLOAD', 'Customer, order, variant, and reason are required');
    }

    const order = await Order.findById(orderId);
    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    if (String(order.customerId) !== String(customerId)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this order');
    }

    if (['DELIVERED', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED', 'CANCELLED', 'FAILED'].includes(order.status)) {
      throw new AppError(400, 'ORDER_NOT_ELIGIBLE', `Order status ${order.status} is not eligible for cancellation`);
    }

    // Find the item in order
    const orderItem = (order.items || []).find((item) => String(item.variantId) === String(variantId));
    if (!orderItem) {
      throw new AppError(404, 'ITEM_NOT_FOUND', 'Item variant not found in order');
    }

    const cancelQty = Math.min(Math.max(Number(quantity || orderItem.quantity), 1), orderItem.quantity);

    // Find corresponding vendor order
    const vendorOrder = await VendorOrder.findOne({
      parentOrderId: order._id,
      vendorId: orderItem.vendorId,
    });
    if (!vendorOrder) {
      throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found for this item');
    }

    if (['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(vendorOrder.status)) {
      throw new AppError(400, 'VENDOR_ORDER_NOT_ELIGIBLE', `Item has already progressed to ${vendorOrder.status} and cannot be cancelled`);
    }

    // Check for existing pending request
    const existingPending = await CancellationRequest.findOne({
      orderId: order._id,
      variantId,
      status: 'PENDING',
    });
    if (existingPending) {
      throw new AppError(409, 'DUPLICATE_CANCELLATION_REQUEST', 'A cancellation request is already pending for this item');
    }

    const unitPrice = Number(orderItem.unitPrice || 0);
    const refundAmount = Math.min(Number((unitPrice * cancelQty).toFixed(2)), Number(vendorOrder.total || unitPrice * cancelQty));
    const requestNumber = `CAN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

    const cancellationRequest = await CancellationRequest.create({
      requestNumber,
      orderId: order._id,
      vendorOrderId: vendorOrder._id,
      customerId: order.customerId,
      vendorId: vendorOrder.vendorId,
      productId: orderItem.productId,
      variantId: orderItem.variantId,
      productName: orderItem.productName,
      sku: orderItem.sku,
      quantity: cancelQty,
      unitPrice,
      refundAmount,
      reason,
      customerNote: customerNote || null,
      status: 'PENDING',
    });

    // Notify vendor asynchronously
    this.notifyVendorNewRequest({ cancellationRequest, order, vendorOrder }).catch((err) => {
      console.error('Failed to notify vendor of cancellation request:', err?.message);
    });

    return cancellationRequest.toObject ? cancellationRequest.toObject() : cancellationRequest;
  }

  /**
   * Seller approves a cancellation request.
   * Cancels item/portion, releases/restores inventory, triggers real refund, updates orders, notifies customer.
   */
  async approveRequest({ requestId, vendorId, reviewerUserId }) {
    if (!requestId || !vendorId) {
      throw new AppError(400, 'INVALID_REQUEST', 'Request ID and vendor ID are required');
    }

    const request = await CancellationRequest.findById(requestId);
    if (!request) {
      throw new AppError(404, 'REQUEST_NOT_FOUND', 'Cancellation request not found');
    }

    if (String(request.vendorId) !== String(vendorId)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this cancellation request');
    }

    if (request.status !== 'PENDING') {
      throw new AppError(400, 'INVALID_STATE', `Cancellation request is already ${request.status}`);
    }

    const vendorOrder = await VendorOrder.findById(request.vendorOrderId);
    if (!vendorOrder) {
      throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');
    }

    const order = await Order.findById(request.orderId);
    if (!order) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Parent order not found');
    }

    // 1. Inventory restoration
    if (vendorOrder.inventoryDecremented) {
      await inventoryService.increaseStock(request.variantId, request.quantity, {
        referenceType: 'CANCELLATION_APPROVED',
        referenceId: String(request._id),
        reason: 'Seller approved item cancellation',
      }).catch((err) => console.error('Restock on cancellation error:', err?.message));
    } else {
      const released = await inventoryReservationService.releaseReservation({
        orderId: order._id,
        variantId: request.variantId,
        reason: 'CANCELLATION_APPROVED',
        actorId: String(reviewerUserId || vendorId),
      }).catch(() => null);

      if (!released) {
        const consumed = await InventoryReservation.findOne({
          orderId: order._id,
          variantId: request.variantId,
          status: 'CONSUMED',
        });
        if (consumed) {
          await InventoryReservation.updateOne({ _id: consumed._id }, { $set: { status: 'CANCELLED' } });
          await inventoryService.increaseStock(request.variantId, request.quantity, {
            referenceType: 'CANCELLATION_APPROVED',
            referenceId: String(request._id),
            reason: 'Restock consumed reservation upon cancellation approval',
          }).catch((err) => console.error('Restock on consumed reservation error:', err?.message));
        }
      }
    }

    // 2. Real refund initiation
    let createdRefund = null;
    const payment = await Payment.findOne({ orderId: order._id });
    if (payment && ['CAPTURED', 'PAID'].includes(payment.status) && request.refundAmount > 0) {
      createdRefund = await refundService.createRefund({
        refundData: {
          orderId: order._id,
          vendorOrderId: vendorOrder._id,
          paymentId: payment._id,
          cancellationRequestId: request._id,
          customerId: order.customerId,
          vendorId: vendorOrder.vendorId,
          amount: request.refundAmount,
          reason: `CANCELLATION_APPROVED: ${request.reason}`,
        },
      });
      request.refundId = createdRefund._id;
    }

    // 3. Mark request as APPROVED
    request.status = 'APPROVED';
    request.reviewedAt = new Date();
    request.reviewedBy = reviewerUserId || null;
    await request.save();

    // 4. Update vendorOrder and parent order
    // Check if all items in vendorOrder are now cancelled
    const allApprovedRequests = await CancellationRequest.find({
      vendorOrderId: vendorOrder._id,
      status: 'APPROVED',
    }).lean();

    const cancelledVariantIds = new Set(allApprovedRequests.map((r) => String(r.variantId)));
    const allItemsCancelled = (vendorOrder.items || []).every((item) => cancelledVariantIds.has(String(item.variantId)));

    if (allItemsCancelled) {
      vendorOrder.status = 'CANCELLED';
      if (vendorOrder.inventoryDecremented) {
        vendorOrder.inventoryDecremented = false;
      }
    }
    await vendorOrder.save();

    // Update parent order
    const siblingVendorOrders = await VendorOrder.find({ parentOrderId: order._id }).lean();
    const allVoCancelled = siblingVendorOrders.length > 0 && siblingVendorOrders.every((vo) => vo.status === 'CANCELLED');
    const allVoRefunded = siblingVendorOrders.every((vo) => ['CANCELLED', 'REFUNDED'].includes(vo.status));

    if (allVoCancelled) {
      order.status = 'CANCELLED';
      order.paymentStatus = allVoRefunded ? 'REFUNDED' : 'REFUND_PENDING';
      order.cancelledAt = new Date();
      order.cancelledReason = `Customer cancelled: ${request.reason}`;
    } else {
      order.paymentStatus = 'PARTIALLY_REFUNDED';
    }
    await order.save();

    // 5. Notify customer and seller
    this.notifyPartiesApproval({ request, order, refundAmount: request.refundAmount }).catch((err) => {
      console.error('Failed to notify parties of cancellation approval:', err?.message);
    });

    return {
      request: request.toObject ? request.toObject() : request,
      refund: createdRefund,
      vendorOrderStatus: vendorOrder.status,
      orderStatus: order.status,
    };
  }

  /**
   * Seller rejects a cancellation request.
   */
  async rejectRequest({ requestId, vendorId, reviewerUserId, rejectionReason }) {
    if (!requestId || !vendorId) {
      throw new AppError(400, 'INVALID_REQUEST', 'Request ID and vendor ID are required');
    }

    const request = await CancellationRequest.findById(requestId);
    if (!request) {
      throw new AppError(404, 'REQUEST_NOT_FOUND', 'Cancellation request not found');
    }

    if (String(request.vendorId) !== String(vendorId)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this cancellation request');
    }

    if (request.status !== 'PENDING') {
      throw new AppError(400, 'INVALID_STATE', `Cancellation request is already ${request.status}`);
    }

    request.status = 'REJECTED';
    request.rejectionReason = rejectionReason || 'Seller rejected cancellation request';
    request.reviewedAt = new Date();
    request.reviewedBy = reviewerUserId || null;
    await request.save();

    // Notify customer
    this.notifyCustomerRejection({ request }).catch((err) => {
      console.error('Failed to notify customer of cancellation rejection:', err?.message);
    });

    return request.toObject ? request.toObject() : request;
  }

  async listForVendor(vendorId, { status, page = 1, limit = 20 } = {}) {
    const filter = { vendorId };
    if (status) filter.status = status;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      CancellationRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CancellationRequest.countDocuments(filter),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async listForCustomer(customerId, { orderId, status } = {}) {
    const filter = { customerId };
    if (orderId) filter.orderId = orderId;
    if (status) filter.status = status;

    return CancellationRequest.find(filter).sort({ createdAt: -1 }).lean();
  }

  async notifyVendorNewRequest({ cancellationRequest, order, vendorOrder }) {
    const vendor = await Vendor.findById(vendorOrder.vendorId).select('ownerUserId email phone').lean();
    if (!vendor) return;

    const owner = vendor.ownerUserId ? await User.findById(vendor.ownerUserId).select('email phone').lean() : null;
    const targetEmail = owner?.email || vendor.email;
    const targetPhone = owner?.phone || vendor.phone;
    const orderNumber = order.orderNumber || String(order._id).slice(-8);

    if (vendor.ownerUserId) {
      await notificationService.createNotification({
        userId: vendor.ownerUserId,
        type: 'CANCELLATION_REQUEST_SUBMITTED',
        title: 'New Cancellation Request - Action Required',
        message: `Customer requested cancellation for "${cancellationRequest.productName}" in Order #${orderNumber}. Reason: ${cancellationRequest.reason}. Action required: Please review and approve or reject from your seller dashboard.`,
        channel: 'IN_APP',
        metadata: {
          idempotencyKey: `cancel_req_${cancellationRequest._id}_vendor_inapp`,
          requestId: cancellationRequest._id,
          orderId: order._id,
          vendorOrderId: vendorOrder._id,
        },
      }).catch(() => null);
    }

    if (targetEmail) {
      await emailService.sendEmail({
        to: targetEmail,
        subject: `Cancellation Request for Order #${orderNumber} - Action Required`,
        html: `<p>A customer has requested cancellation for <strong>${cancellationRequest.productName}</strong> in order #${orderNumber}.</p><p>Reason: ${cancellationRequest.reason}</p><p>Action is required: Please review and approve or reject this request from your seller dashboard.</p>`,
        text: `Customer requested cancellation for ${cancellationRequest.productName} in order #${orderNumber}. Reason: ${cancellationRequest.reason}. Action required: Please review and approve or reject from your seller dashboard.`,
      }).catch(() => null);
    }

    const rawPhone = String(targetPhone || '').trim();
    const digitsOnly = rawPhone.replace(/[^\d+]/g, '');
    if (/^\+?[0-9]{10,15}$/.test(digitsOnly)) {
      await smsService.sendSms({
        to: rawPhone,
        message: `Rupakar: Customer requested cancellation for order #${orderNumber} (${cancellationRequest.productName}). Action required: Please check your seller dashboard.`,
      }).catch(() => null);
    }
  }

  async notifyPartiesApproval({ request, order, refundAmount }) {
    const orderNumber = order?.orderNumber || String(request.orderId).slice(-8);
    const customer = await User.findById(request.customerId).select('email phone name').lean();

    // Customer notification
    await notificationService.createNotification({
      userId: request.customerId,
      type: 'CANCELLATION_APPROVED',
      title: 'Cancellation Approved',
      message: `Your cancellation request for "${request.productName}" in Order #${orderNumber} has been approved. A refund of INR ${refundAmount} has been initiated.`,
      channel: 'IN_APP',
      metadata: {
        idempotencyKey: `cancel_appr_${request._id}_customer_inapp`,
        requestId: request._id,
        orderId: request.orderId,
        refundAmount,
      },
    }).catch(() => null);

    if (customer?.email) {
      await emailService.sendEmail({
        to: customer.email,
        subject: `Cancellation Approved - Order #${orderNumber}`,
        html: `<p>Your cancellation request for <strong>${request.productName}</strong> in order #${orderNumber} has been approved by the seller.</p><p>A refund of INR ${refundAmount} has been processed via your original payment method.</p>`,
        text: `Your cancellation request for ${request.productName} in order #${orderNumber} has been approved. A refund of INR ${refundAmount} has been initiated.`,
      }).catch(() => null);
    }

    const rawPhone = String(customer?.phone || '').trim();
    const digitsOnly = rawPhone.replace(/[^\d+]/g, '');
    if (/^\+?[0-9]{10,15}$/.test(digitsOnly)) {
      await smsService.sendSms({
        to: rawPhone,
        message: `Rupakar: Your cancellation request for "${request.productName}" in Order #${orderNumber} has been approved. Refund of INR ${refundAmount} initiated.`,
      }).catch(() => null);
    }
  }

  async notifyCustomerRejection({ request }) {
    const customer = await User.findById(request.customerId).select('email phone name').lean();
    const order = await Order.findById(request.orderId).select('orderNumber').lean();
    const orderNumber = order?.orderNumber || String(request.orderId).slice(-8);
    const reasonText = request.rejectionReason || request.vendorRejectionReason || 'Seller rejected cancellation request';

    await notificationService.createNotification({
      userId: request.customerId,
      type: 'CANCELLATION_REJECTED',
      title: 'Cancellation Request Rejected',
      message: `Your cancellation request for "${request.productName}" in Order #${orderNumber} was not approved. Reason: ${reasonText}`,
      channel: 'IN_APP',
      metadata: {
        idempotencyKey: `cancel_rej_${request._id}_customer_inapp`,
        requestId: request._id,
        orderId: request.orderId,
        rejectionReason: reasonText,
      },
    }).catch(() => null);

    if (customer?.email) {
      await emailService.sendEmail({
        to: customer.email,
        subject: `Cancellation Request Rejected - Order #${orderNumber}`,
        html: `<p>Your cancellation request for <strong>${request.productName}</strong> in order #${orderNumber} could not be approved by the seller.</p><p>Reason: ${reasonText}</p>`,
        text: `Your cancellation request for ${request.productName} in order #${orderNumber} was rejected. Reason: ${reasonText}`,
      }).catch(() => null);
    }

    const rawPhone = String(customer?.phone || '').trim();
    const digitsOnly = rawPhone.replace(/[^\d+]/g, '');
    if (/^\+?[0-9]{10,15}$/.test(digitsOnly)) {
      await smsService.sendSms({
        to: rawPhone,
        message: `Rupakar: Your cancellation request for "${request.productName}" in Order #${orderNumber} was not approved. Reason: ${reasonText}`,
      }).catch(() => null);
    }
  }
}

export const cancellationService = new CancellationService();
