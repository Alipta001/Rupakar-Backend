import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env.js';
import { invoiceService } from '../services/invoice.service.js';
import { notificationService } from '../services/notification.service.js';
import { emailService } from '../services/email.service.js';
import { storageService } from '../services/storage.service.js';
import { pdfService } from '../services/pdf.service.js';
import { Order } from '../models/order.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Vendor } from '../models/vendor.model.js';
import { User } from '../models/user.model.js';
import { VendorLedgerEntry } from '../models/vendor-ledger-entry.model.js';

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,
  retryStrategy: () => null,
});

export const getQueueConnection = () => connection;
connection.on('error', () => {
  // Suppress unhandled redis connection errors when Redis is not running locally
});

export async function ensureQueueConnection() {
  if (env.NODE_ENV === 'production' && !env.REDIS_ENABLED) {
    throw new Error('Redis is required for production queue processing');
  }
  if (connection.status === 'wait') await connection.connect();
  if (connection.status !== 'ready') {
    throw new Error(`Redis is not ready (status: ${connection.status})`);
  }
}

export function getInvoiceQueue() {
  return new Queue('invoice', { connection });
}

export function getNotificationQueue() {
  return new Queue('notification', { connection });
}

export function getEmailQueue() {
  return new Queue('email', { connection });
}

export async function scheduleInvoiceGeneration({ orderId, customerId, vendorId = null, vendorOrderId = null }) {
  if (!orderId || !customerId) return null;

  try {
    const queue = getInvoiceQueue();
    const jobId = `invoice:${orderId}:${vendorOrderId || vendorId || 'customer'}`;
    const job = await queue.add(
      'generate-invoice',
      { orderId, customerId, vendorId, vendorOrderId },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    );
    await queue.close();
    return job.id;
  } catch (_error) {
    if (env.NODE_ENV === 'production') throw _error;
    return null;
  }
}

export async function scheduleNotification({ userId, type, title, message, channel = 'IN_APP', metadata = {} }) {
  if (!userId || !type || !title || !message) return null;

  try {
    const queue = getNotificationQueue();
    const jobId = `notification:${userId}:${type}:${metadata?.orderId || metadata?.idempotencyKey || Date.now()}:${metadata?.vendorOrderId || ''}`;
    const job = await queue.add(
      'send-notification',
      { userId, type, title, message, channel, metadata },
      {
        jobId,
        attempts: 2,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    );
    await queue.close();
    return job.id;
  } catch (_error) {
    if (env.NODE_ENV === 'production') throw _error;
    return null;
  }
}

export async function scheduleEmail({ to, subject, html, text, jobType = 'send-email' }) {
  if (!to || !subject) return null;

  try {
    const queue = getEmailQueue();
    const jobId = `email:${to}:${subject}:${Date.now()}`;
    const job = await queue.add(jobType, { to, subject, html, text }, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 7200 },
      removeOnFail: { age: 604800 },
    });
    await queue.close();
    return job.id;
  } catch (_error) {
    if (env.NODE_ENV === 'production') throw _error;
    return null;
  }
}

export async function startInvoiceWorker() {
  const worker = new Worker(
    'invoice',
    async (job) => {
      const { orderId, customerId, vendorId, vendorOrderId } = job.data;
      console.log(`Processing invoice job ${job.id} for order ${orderId}`);

      try {
        const order = await Order.findById(orderId).lean();
        if (!order || order.paymentStatus !== 'PAID') throw new Error('Invoice requires a paid order');
        const vendorOrder = vendorOrderId ? await VendorOrder.findOne({ _id: vendorOrderId, parentOrderId: orderId }).lean() : null;
        const vendor = vendorOrder ? await Vendor.findById(vendorOrder.vendorId).select('businessName legalName email address gstNumber').lean() : null;
        const customer = await User.findById(customerId).select('name email').lean();
        const ledger = vendorOrder ? await VendorLedgerEntry.findOne({ vendorOrderId: vendorOrder._id, transactionType: 'SALE_CAPTURE' }).lean() : null;
        const items = vendorOrder?.items || order.items || [];
        const subtotal = Number(vendorOrder?.subtotal ?? order.subtotal ?? 0);
        const total = Number(vendorOrder?.total ?? order.total ?? 0);
        const invoice = await invoiceService.createInvoice({
          orderId,
          customerId,
          vendorId,
          vendorOrderId,
          items: items.map((item) => ({ productId: item.productId, variantId: item.variantId, productName: item.productName, sku: item.sku, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal })),
          subtotal,
          discount: Number(vendorOrder?.discount ?? order.discount ?? 0),
          tax: Number(vendorOrder?.tax ?? order.tax ?? 0),
          shipping: Number(vendorOrder?.shipping ?? order.shipping ?? 0),
          total,
          currency: vendorOrder?.currency || order.currency || 'INR',
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
          commissionRate: ledger?.commissionRate || 0,
          commissionAmount: ledger?.commissionAmount || 0,
          netVendorPayable: ledger?.netAmount || total,
          commissionSource: ledger?.commissionSource || null,
          customerSnapshot: customer || {},
          vendorSnapshot: vendor || {},
          shippingAddressSnapshot: order.shippingAddressSnapshot || {},
          billingAddressSnapshot: order.billingAddressSnapshot || {},
        });

        await scheduleEmail({
          to: vendor?.email || customer?.email || 'customer@example.com',
          subject: `Invoice ${invoice.invoiceNumber} Ready`,
          html: `<p>Your invoice is ready. Download it from your account.</p>`,
          jobType: 'send-notification-email',
        });

        return { invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber };
      } catch (error) {
        console.error(`Invoice job ${job.id} failed:`, error.message);
        throw error;
      }
    },
    { connection },
  );

  worker.on('failed', (job, error) => {
    console.error(`Invoice job ${job.id} failed:`, error);
  });

  return worker;
}

export async function startNotificationWorker() {
  const worker = new Worker(
    'notification',
    async (job) => {
      const { userId, type, title, message, channel, metadata } = job.data;
      console.log(`Processing notification job ${job.id} for user ${userId}`);

      try {
        const notification = await notificationService.createNotification({
          userId,
          type,
          title,
          message,
          channel,
          recipient: metadata?.email,
          metadata,
        });

        if (channel === 'EMAIL' && metadata?.email) {
          await scheduleEmail({
            to: metadata.email,
            subject: title,
            html: message,
            jobType: 'send-notification-email',
          });
        }

        await notificationService.sendNotification(notification._id);
        return { notificationId: notification._id };
      } catch (error) {
        console.error(`Notification job ${job.id} failed:`, error.message);
        throw error;
      }
    },
    { connection },
  );

  worker.on('failed', (job, error) => {
    console.error(`Notification job ${job.id} failed:`, error);
  });

  return worker;
}

export async function startEmailWorker() {
  const worker = new Worker(
    'email',
    async (job) => {
      const { to, subject, html, text } = job.data;
      console.log(`Processing email job ${job.id} to ${to}`);

      try {
        const result = await emailService.sendEmail({ to, subject, html, text });
        return { messageId: result.messageId, success: true };
      } catch (error) {
        console.error(`Email job ${job.id} to ${to} failed:`, error.message);
        throw error;
      }
    },
    { connection },
  );

  worker.on('failed', (job, error) => {
    console.error(`Email job ${job.id} failed:`, error);
  });

  return worker;
}
