import { scheduleNotification } from '../jobs/queues.js';

export class NotificationEventHelper {
  static async onUserRegistered({ userId, email, name }) {
    return scheduleNotification({
      userId,
      type: 'USER_REGISTERED',
      title: 'Welcome to Rupakar!',
      message: `Welcome ${name}! Your account has been created successfully.`,
      channel: 'IN_APP',
      metadata: { email, name },
    });
  }

  static async onVendorApproved({ vendorId, vendorName, email }) {
    return scheduleNotification({
      userId: vendorId,
      type: 'VENDOR_APPROVED',
      title: 'Vendor Account Approved!',
      message: `Congratulations ${vendorName}! Your vendor account has been approved.`,
      channel: 'IN_APP',
      metadata: { email, vendorName },
    });
  }

  static async onVendorRejected({ vendorId, vendorName, email, reason }) {
    return scheduleNotification({
      userId: vendorId,
      type: 'VENDOR_REJECTED',
      title: 'Vendor Application Decision',
      message: `Your vendor application was not approved. Reason: ${reason}`,
      channel: 'IN_APP',
      metadata: { email, vendorName, reason },
    });
  }

  static async onProductApproved({ vendorId, productName, email }) {
    return scheduleNotification({
      userId: vendorId,
      type: 'PRODUCT_APPROVED',
      title: 'Product Approved!',
      message: `Your product "${productName}" has been approved and is now live.`,
      channel: 'IN_APP',
      metadata: { email, productName },
    });
  }

  static async onProductRejected({ vendorId, productName, email, reason }) {
    return scheduleNotification({
      userId: vendorId,
      type: 'PRODUCT_REJECTED',
      title: 'Product Review Decision',
      message: `Your product "${productName}" was not approved. Reason: ${reason}`,
      channel: 'IN_APP',
      metadata: { email, productName, reason },
    });
  }

  static async onOrderCreated({ customerId, email, orderNumber, total }) {
    return scheduleNotification({
      userId: customerId,
      type: 'ORDER_CREATED',
      title: 'Order Confirmed!',
      message: `Your order #${orderNumber} has been placed. Total: ₹${total}`,
      channel: 'IN_APP',
      metadata: { email, orderNumber, total },
    });
  }

  static async onPaymentSuccess({ customerId, email, orderNumber, amount }) {
    return scheduleNotification({
      userId: customerId,
      type: 'PAYMENT_SUCCESS',
      title: 'Payment Received',
      message: `Payment of ₹${amount} received for order #${orderNumber}`,
      channel: 'IN_APP',
      metadata: { email, orderNumber, amount },
    });
  }

  static async onPaymentFailed({ customerId, email, orderNumber, reason }) {
    return scheduleNotification({
      userId: customerId,
      type: 'PAYMENT_FAILED',
      title: 'Payment Failed',
      message: `Payment failed for order #${orderNumber}. Reason: ${reason}. Please try again.`,
      channel: 'IN_APP',
      metadata: { email, orderNumber, reason },
    });
  }

  static async onOrderShipped({ customerId, email, orderNumber, trackingNumber, trackingUrl }) {
    return scheduleNotification({
      userId: customerId,
      type: 'ORDER_SHIPPED',
      title: 'Order Shipped!',
      message: `Your order #${orderNumber} has been shipped. Tracking: ${trackingNumber}`,
      channel: 'IN_APP',
      metadata: { email, orderNumber, trackingNumber, trackingUrl },
    });
  }

  static async onOrderDelivered({ customerId, email, orderNumber }) {
    return scheduleNotification({
      userId: customerId,
      type: 'ORDER_DELIVERED',
      title: 'Order Delivered!',
      message: `Your order #${orderNumber} has been delivered. Thank you!`,
      channel: 'IN_APP',
      metadata: { email, orderNumber },
    });
  }

  static async onReturnRequested({ customerId, vendorId, email, returnNumber, orderNumber }) {
    return Promise.all([
      scheduleNotification({
        userId: customerId,
        type: 'RETURN_REQUESTED',
        title: 'Return Initiated',
        message: `Your return #${returnNumber} for order #${orderNumber} has been submitted.`,
        channel: 'IN_APP',
        metadata: { email, returnNumber, orderNumber },
      }),
      scheduleNotification({
        userId: vendorId,
        type: 'RETURN_REQUESTED_VENDOR',
        title: 'Customer Return Request',
        message: `A customer has requested a return for order #${orderNumber}. Return #${returnNumber}`,
        channel: 'IN_APP',
        metadata: { returnNumber, orderNumber },
      }),
    ]);
  }

  static async onReturnApproved({ customerId, email, returnNumber }) {
    return scheduleNotification({
      userId: customerId,
      type: 'RETURN_APPROVED',
      title: 'Return Approved',
      message: `Your return #${returnNumber} has been approved. A refund will be processed.`,
      channel: 'IN_APP',
      metadata: { email, returnNumber },
    });
  }

  static async onReturnRejected({ customerId, email, returnNumber, reason }) {
    return scheduleNotification({
      userId: customerId,
      type: 'RETURN_REJECTED',
      title: 'Return Decision',
      message: `Your return #${returnNumber} was not approved. Reason: ${reason}`,
      channel: 'IN_APP',
      metadata: { email, returnNumber, reason },
    });
  }

  static async onRefundProcessing({ customerId, email, refundNumber, amount }) {
    return scheduleNotification({
      userId: customerId,
      type: 'REFUND_PROCESSING',
      title: 'Refund Processing',
      message: `Your refund #${refundNumber} of ₹${amount} is being processed.`,
      channel: 'IN_APP',
      metadata: { email, refundNumber, amount },
    });
  }

  static async onRefundCompleted({ customerId, email, refundNumber, amount }) {
    return scheduleNotification({
      userId: customerId,
      type: 'REFUND_COMPLETED',
      title: 'Refund Completed',
      message: `Your refund #${refundNumber} of ₹${amount} has been successfully processed.`,
      channel: 'IN_APP',
      metadata: { email, refundNumber, amount },
    });
  }

  static async onRefundFailed({ customerId, email, refundNumber, reason }) {
    return scheduleNotification({
      userId: customerId,
      type: 'REFUND_FAILED',
      title: 'Refund Failed',
      message: `Your refund #${refundNumber} could not be processed. Reason: ${reason}. Please contact support.`,
      channel: 'IN_APP',
      metadata: { email, refundNumber, reason },
    });
  }

  static async onInvoiceGenerated({ customerId, email, invoiceNumber, downloadUrl }) {
    return scheduleNotification({
      userId: customerId,
      type: 'INVOICE_GENERATED',
      title: 'Invoice Ready',
      message: `Your invoice #${invoiceNumber} is ready. You can download it from your account.`,
      channel: 'IN_APP',
      metadata: { email, invoiceNumber, downloadUrl },
    });
  }
}

export const notificationEventHelper = new NotificationEventHelper();
