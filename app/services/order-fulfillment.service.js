import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Vendor } from '../models/vendor.model.js';
import { User } from '../models/user.model.js';
import { Payment } from '../models/payment.model.js';
import { Notification } from '../models/notification.model.js';
import { InventoryReservation } from '../models/inventory-reservation.model.js';
import { inventoryReservationService } from './inventory-reservation.service.js';
import { inventoryService } from './inventory.service.js';
import { refundService } from './refund.service.js';
import { notificationService } from './notification.service.js';
import { emailService } from './email.service.js';
import { smsService } from './sms.service.js';

export class OrderFulfillmentService {
  /**
   * Send a packing reminder to the vendor if the order is still unpacked within the deadline window.
   */
  async sendPackingReminder(vendorOrderId) {
    if (!vendorOrderId) return { skipped: true, reason: 'INVALID_ID' };

    const vendorOrder = await VendorOrder.findById(vendorOrderId);
    if (!vendorOrder) return { skipped: true, reason: 'VENDOR_ORDER_NOT_FOUND' };

    // Only send reminder if order is still unpacked
    if (!['CONFIRMED', 'PROCESSING'].includes(vendorOrder.status)) {
      return { skipped: true, reason: 'ORDER_NOT_UNPACKED', status: vendorOrder.status };
    }

    const idempotencyKey = `vendor-order-pack-reminder:${vendorOrder._id}`;
    const vendor = await Vendor.findById(vendorOrder.vendorId).select('ownerUserId email phone businessName').lean();
    if (!vendor) return { skipped: true, reason: 'VENDOR_NOT_FOUND' };

    const recipientUserId = vendor.ownerUserId;
    if (recipientUserId) {
      const existingNotif = await Notification.findOne({
        userId: recipientUserId,
        'metadata.idempotencyKey': idempotencyKey,
      }).lean();
      if (existingNotif) {
        return { skipped: true, reason: 'REMINDER_ALREADY_SENT' };
      }
    }

    const owner = vendor.ownerUserId ? await User.findById(vendor.ownerUserId).select('email phone name').lean() : null;
    const targetEmail = owner?.email || vendor.email;
    const targetPhone = owner?.phone || vendor.phone;
    const parentOrder = await Order.findById(vendorOrder.parentOrderId).select('orderNumber').lean();
    const orderNumber = parentOrder?.orderNumber || String(vendorOrder.parentOrderId).slice(-8);

    try {
      if (recipientUserId) {
        await notificationService.createNotification({
          userId: recipientUserId,
          type: 'VENDOR_ORDER_PACK_REMINDER',
          title: 'Action required: Please pack order',
          message: `Order #${orderNumber} must be packed within 24 hours to avoid automatic cancellation.`,
          channel: 'IN_APP',
          metadata: {
            orderId: vendorOrder.parentOrderId,
            vendorOrderId: vendorOrder._id,
            email: targetEmail,
            phone: targetPhone,
            idempotencyKey,
          },
        }).catch(() => null);
      }

      if (targetEmail) {
        await emailService.sendEmail({
          to: targetEmail,
          subject: `Urgent Reminder: Please pack order #${orderNumber}`,
          html: `<div style="font-family:sans-serif;padding:16px;"><h2 style="color:#6B3E26;">Urgent: Action Required</h2><p>Your order <strong>#${orderNumber}</strong> has not been packed yet. Please pack it within 24 hours on your seller dashboard to avoid automatic order cancellation and customer refund.</p><p>Total: ₹${vendorOrder.total}</p></div>`,
          text: `Urgent: Please pack order #${orderNumber} within 24 hours to avoid automatic cancellation. Total: ₹${vendorOrder.total}.`,
        }).catch((err) => console.error('Failed to send vendor reminder email:', err?.message));
      }

      const rawPhone = String(targetPhone || '').trim();
      const digitsOnly = rawPhone.replace(/[^\d+]/g, '');
      const isValidPhone = /^\+?[0-9]{10,15}$/.test(digitsOnly);
      if (isValidPhone) {
        await smsService.sendSms({
          to: rawPhone,
          message: `Rupakar Urgent: Please pack order #${orderNumber} within 24h to avoid automatic cancellation.`,
        }).catch((err) => console.error('Failed to send vendor reminder SMS:', err?.message));
      }

      return { success: true, reminderSent: true, vendorOrderId: vendorOrder._id };
    } catch (err) {
      console.error('Error sending packing reminder:', err?.message);
      return { success: false, error: err?.message };
    }
  }

  /**
   * Automatically cancels a vendor order if not packed within the 2-day deadline.
   * Releases inventory, initiates refund for the vendor order portion, and notifies parties.
   */
  async autoCancelUnpackedVendorOrder(vendorOrderId) {
    if (!vendorOrderId) return { skipped: true, reason: 'INVALID_ID' };

    const vendorOrder = await VendorOrder.findById(vendorOrderId);
    if (!vendorOrder) return { skipped: true, reason: 'VENDOR_ORDER_NOT_FOUND' };

    // Re-check status: Do NOT cancel if already packed, ready to ship, shipped, or delivered
    if (['PACKED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(vendorOrder.status)) {
      return { skipped: true, reason: 'ALREADY_PACKED_OR_FULFILLED', status: vendorOrder.status };
    }

    if (vendorOrder.status === 'CANCELLED') {
      return { skipped: true, reason: 'ALREADY_CANCELLED', status: vendorOrder.status };
    }

    // Only unpacked statuses can be auto-cancelled
    if (!['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING'].includes(vendorOrder.status)) {
      return { skipped: true, reason: 'INVALID_STATUS_FOR_CANCELLATION', status: vendorOrder.status };
    }

    const cancelReason = 'AUTO_CANCEL_SELLER_UNPACKED_2_DAYS';
    vendorOrder.status = 'CANCELLED';

    // 1. Restore / release inventory
    for (const item of vendorOrder.items || []) {
      if (vendorOrder.inventoryDecremented) {
        await inventoryService.increaseStock(item.variantId, item.quantity, {
          referenceType: 'AUTO_CANCEL_DEADLINE',
          referenceId: String(vendorOrder._id),
          reason: 'Restock unpacked auto-cancelled order',
        }).catch(() => null);
      } else {
        const released = await inventoryReservationService.releaseReservation({
          orderId: vendorOrder.parentOrderId,
          variantId: item.variantId,
          reason: cancelReason,
          actorId: 'SYSTEM_AUTO_CANCEL',
        }).catch(() => null);

        if (!released) {
          const consumed = await InventoryReservation.findOne({
            orderId: vendorOrder.parentOrderId,
            variantId: item.variantId,
            status: 'CONSUMED',
          });
          if (consumed) {
            await InventoryReservation.updateOne({ _id: consumed._id }, { $set: { status: 'CANCELLED' } });
            await inventoryService.increaseStock(item.variantId, item.quantity, {
              referenceType: 'AUTO_CANCEL_DEADLINE',
              referenceId: String(vendorOrder._id),
              reason: 'Restock consumed reservation upon auto-cancel',
            }).catch(() => null);
          }
        }
      }
    }

    vendorOrder.inventoryDecremented = false;
    await vendorOrder.save();

    // 2. Refund vendor order portion if payment was captured
    const parentOrder = await Order.findById(vendorOrder.parentOrderId);
    let refundResult = null;
    if (parentOrder) {
      const payment = await Payment.findOne({ orderId: parentOrder._id });
      if (payment && ['CAPTURED', 'PAID'].includes(payment.status)) {
        const refundAmount = Number(vendorOrder.total || 0);
        if (refundAmount > 0) {
          try {
            refundResult = await refundService.createRefund({
              refundData: {
                orderId: parentOrder._id,
                vendorOrderId: vendorOrder._id,
                paymentId: payment._id,
                customerId: parentOrder.customerId,
                vendorId: vendorOrder.vendorId,
                amount: refundAmount,
                reason: cancelReason,
              },
            });
          } catch (refundError) {
            console.error('Failed to create refund on auto-cancel:', refundError?.message);
          }
        }
      }

      // Check if all sibling vendor orders under parent order are cancelled
      const siblingVendorOrders = await VendorOrder.find({ parentOrderId: parentOrder._id }).lean();
      const allCancelled = siblingVendorOrders.length > 0 && siblingVendorOrders.every((vo) => vo.status === 'CANCELLED');
      const allRefunded = siblingVendorOrders.every((vo) => ['CANCELLED', 'REFUNDED'].includes(vo.status));

      if (allCancelled) {
        parentOrder.status = 'CANCELLED';
        parentOrder.paymentStatus = allRefunded ? 'REFUNDED' : 'REFUND_PENDING';
        parentOrder.cancelledAt = new Date();
        parentOrder.cancelledReason = cancelReason;
      } else {
        parentOrder.paymentStatus = 'PARTIALLY_REFUNDED';
      }
      await parentOrder.save();
    }

    // 3. Notifications (isolated)
    try {
      const vendor = await Vendor.findById(vendorOrder.vendorId).select('ownerUserId email phone').lean();
      const owner = vendor?.ownerUserId ? await User.findById(vendor.ownerUserId).select('email phone').lean() : null;
      const targetEmail = owner?.email || vendor?.email;
      const targetPhone = owner?.phone || vendor?.phone;
      const orderNumber = parentOrder?.orderNumber || String(vendorOrder.parentOrderId).slice(-8);
      const idempotencyKey = `vendor-order-auto-cancel:${vendorOrder._id}`;

      if (vendor?.ownerUserId) {
        await notificationService.createNotification({
          userId: vendor.ownerUserId,
          type: 'VENDOR_ORDER_AUTO_CANCELLED',
          title: 'Order auto-cancelled',
          message: `Order #${orderNumber} was automatically cancelled because it was not packed within 2 days.`,
          channel: 'IN_APP',
          metadata: {
            orderId: vendorOrder.parentOrderId,
            vendorOrderId: vendorOrder._id,
            idempotencyKey,
          },
        }).catch(() => null);
      }

      if (targetEmail) {
        await emailService.sendEmail({
          to: targetEmail,
          subject: `Order #${orderNumber} auto-cancelled (2-day packing deadline expired)`,
          html: `<p>Your order #${orderNumber} was automatically cancelled and refunded because it was not packed within the 2-day fulfillment window.</p>`,
          text: `Your order #${orderNumber} was automatically cancelled and refunded because it was not packed within 2 days.`,
        }).catch(() => null);
      }

      const rawPhone = String(targetPhone || '').trim();
      const digitsOnly = rawPhone.replace(/[^\d+]/g, '');
      if (/^\+?[0-9]{10,15}$/.test(digitsOnly)) {
        await smsService.sendSms({
          to: rawPhone,
          message: `Rupakar: Order #${orderNumber} was auto-cancelled as it was not packed within 2 days.`,
        }).catch(() => null);
      }

      // Notify customer as well
      if (parentOrder?.customerId) {
        await notificationService.createNotification({
          userId: parentOrder.customerId,
          type: 'ORDER_ITEM_CANCELLED',
          title: 'Order item cancelled and refund initiated',
          message: `Items from vendor in order #${orderNumber} could not be packed in time. A refund of ₹${vendorOrder.total} has been initiated.`,
          channel: 'IN_APP',
          metadata: { orderId: parentOrder._id, vendorOrderId: vendorOrder._id, idempotencyKey: `cust-${idempotencyKey}` },
        }).catch(() => null);
      }
    } catch (notifErr) {
      console.error('Notification error on auto-cancel:', notifErr?.message);
    }

    return { success: true, cancelled: true, vendorOrderId: vendorOrder._id, refund: refundResult };
  }
}

export const orderFulfillmentService = new OrderFulfillmentService();
