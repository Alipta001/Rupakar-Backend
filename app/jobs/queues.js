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
import { packingSlipService } from '../services/packing-slip.service.js';
import { Shipment } from '../models/shipment.model.js';
import { smsService } from '../services/sms.service.js';

const isTls = env.REDIS_URL?.startsWith('rediss://');

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
});

export const getQueueConnection = () => connection;

export async function closeQueueConnection() {
  try {
    if (connection) {
      if (['ready', 'connecting', 'connect', 'reconnecting'].includes(connection.status)) {
        await connection.quit().catch(() => {
          connection.disconnect();
        });
      } else if (connection.status !== 'end') {
        connection.disconnect();
      }
    }
  } catch (_err) {
    // Ignore cleanup error
  }
}

connection.on('error', (err) => {
  // Suppress unhandled redis connection errors when Redis is not running locally
  if (env.NODE_ENV === 'production') {
    console.error('[REDIS QUEUE ERROR]', err?.message);
  }
});

export async function ensureQueueConnection() {
  if (env.NODE_ENV === 'production' && !env.REDIS_ENABLED) {
    throw new Error('Redis is required for production queue processing');
  }
  if (connection.status === 'wait' || connection.status === 'close' || connection.status === 'end') {
    await connection.connect().catch((err) => {
      console.warn('[REDIS QUEUE CONNECT FAILED]', err?.message);
    });
  }
  if (connection.status !== 'ready') {
    throw new Error(`Redis is not ready (status: ${connection.status})`);
  }
}

export function getInvoiceQueue() {
  return new Queue('invoice', { connection });
}

export function getPackingSlipQueue() {
  return new Queue('packing-slip', { connection });
}

export function getNotificationQueue() {
  return new Queue('notification', { connection });
}

export function getEmailQueue() {
  return new Queue('email', { connection });
}

export function getFulfillmentQueue() {
  return new Queue('order-fulfillment', { connection });
}

export async function scheduleVendorOrderPackReminder({ vendorOrderId, delayMs = null, reminderStep = null }) {
  if (!vendorOrderId) return null;
  try {
    const queue = getFulfillmentQueue();
    await queue.waitUntilReady().catch(() => null);

    if (delayMs !== null) {
      const step = reminderStep || 1;
      const jobId = step === 1 ? `pack-reminder:${vendorOrderId}` : `pack-reminder:${vendorOrderId}:${step}`;
      const job = await queue.add(
        'vendor-order-pack-reminder',
        { vendorOrderId, reminderStep: step },
        {
          jobId,
          delay: Math.max(0, delayMs),
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 604800 },
        },
      );
      await queue.close();
      return job.id;
    }

    const intervals = [
      { step: 1, delay: 12 * 60 * 60 * 1000 },
      { step: 2, delay: 24 * 60 * 60 * 1000 },
      { step: 3, delay: 36 * 60 * 60 * 1000 },
    ];

    let lastJobId = null;
    for (const { step, delay } of intervals) {
      const jobId = step === 1 ? `pack-reminder:${vendorOrderId}` : `pack-reminder:${vendorOrderId}:${step}`;
      const job = await queue.add(
        'vendor-order-pack-reminder',
        { vendorOrderId, reminderStep: step },
        {
          jobId,
          delay,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 604800 },
        },
      );
      lastJobId = job.id;
    }

    await queue.close();
    return lastJobId;
  } catch (_error) {
    if (env.NODE_ENV === 'production') throw _error;
    return null;
  }
}

export async function scheduleVendorOrderAutoCancel({ vendorOrderId, delayMs = 48 * 60 * 60 * 1000 }) {
  if (!vendorOrderId) return null;
  try {
    const queue = getFulfillmentQueue();
    await queue.waitUntilReady().catch(() => null);
    const jobId = `auto-cancel:${vendorOrderId}`;
    const job = await queue.add(
      'vendor-order-auto-cancel',
      { vendorOrderId },
      {
        jobId,
        delay: Math.max(0, delayMs),
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    );
    await queue.close();
    return job.id;
  } catch (_error) {
    if (env.NODE_ENV === 'production') throw _error;
    return null;
  }
}

export async function scheduleInvoiceGeneration({ orderId, customerId, vendorId = null, vendorOrderId = null }) {
  if (!orderId || !customerId) return null;

  try {
    const queue = getInvoiceQueue();
    await queue.waitUntilReady().catch(() => null);
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

export async function schedulePackingSlipGeneration({ orderId, vendorOrderId, vendorId, customerId }) {
  if (!orderId || !vendorOrderId || !vendorId || !customerId) return null;
  const queue = getPackingSlipQueue();
  try {
    await queue.waitUntilReady().catch(() => null);
    const job = await queue.add('generate-packing-slip', { orderId, vendorOrderId, vendorId, customerId }, {
      jobId: `packing-slip-${vendorOrderId}`, attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 },
    });
    return job.id;
  } finally { await queue.close(); }
}

export async function scheduleNotification({ userId, type, title, message, channel = 'IN_APP', metadata = {} }) {
  if (!userId || !type || !title || !message) return null;

  try {
    const queue = getNotificationQueue();
    await queue.waitUntilReady().catch(() => null);
    const jobId = `notification:${userId}:${type}:${metadata?.idempotencyKey || metadata?.orderId || Date.now()}:${metadata?.vendorOrderId || ''}`;
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

export async function scheduleEmail({ to, subject, html, text, jobType = 'send-email', jobId = null }) {
  if (!to || !subject) return null;

  try {
    const queue = getEmailQueue();
    await queue.waitUntilReady().catch(() => null);
    const finalJobId = jobId || `email:${to}:${subject}:${Date.now()}`;
    const job = await queue.add(jobType, { to, subject, html, text }, {
      jobId: finalJobId,
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
      let invoice = null;
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
        invoice = await invoiceService.createInvoice({
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

        if (invoice.generationStatus !== 'AVAILABLE') {
          await invoiceService.setGenerationStatus(invoice._id, 'GENERATING', { errorReason: null });
          const pdf = await pdfService.generateInvoicePdf(invoice);
          await invoiceService.setGenerationStatus(invoice._id, 'UPLOADING', { generatedAt: new Date() });
          const storageKey = `invoices/${String(orderId)}/${invoice.invoiceNumber}.pdf`;
          await storageService.upload({ key: storageKey, body: pdf.content, contentType: pdf.contentType });
          await invoiceService.setGenerationStatus(invoice._id, 'AVAILABLE', { storageProvider: 's3', storageKey, storageUrl: null, fileType: pdf.contentType, uploadedAt: new Date(), errorReason: null });
        }

        await scheduleEmail({
          to: vendor?.email || customer?.email || 'customer@example.com',
          subject: `Invoice ${invoice.invoiceNumber} Ready`,
          html: `<p>Your invoice is ready. Download it from your account.</p>`,
          jobType: 'send-notification-email',
        });

        return { invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber };
      } catch (error) {
        if (invoice?._id) await invoiceService.setGenerationStatus(invoice._id, 'FAILED', { errorReason: error.message }).catch(() => null);
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

export async function startPackingSlipWorker() {
  return new Worker('packing-slip', async (job) => {
    const { orderId, vendorOrderId, vendorId, customerId } = job.data;
    let slip;
    try {
      const [order, vendorOrder, vendor, shipment] = await Promise.all([
        Order.findById(orderId).lean(), VendorOrder.findOne({ _id: vendorOrderId, vendorId, parentOrderId: orderId }).lean(), Vendor.findById(vendorId).lean(), Shipment.findOne({ vendorOrderId }).lean(),
      ]);
      if (!order || !vendorOrder || !vendor) throw new Error('Packing slip order data is unavailable');
      slip = await packingSlipService.createOrGet({ orderId, vendorOrderId, vendorId, customerId });
      if (slip.generationStatus === 'AVAILABLE') return { packingSlipId: slip._id, reused: true };
      await packingSlipService.setGenerationStatus(slip._id, 'GENERATING', { errorReason: null });
      const pdf = await pdfService.generatePackingSlipPdf({ packingSlipNumber: slip.packingSlipNumber, order, vendorOrder, vendor, shipment });
      await packingSlipService.setGenerationStatus(slip._id, 'UPLOADING', { generatedAt: new Date() });
      const storageKey = `packing-slips/${vendorId}/${orderId}.pdf`;
      await storageService.upload({ key: storageKey, body: pdf.content, contentType: pdf.contentType });
      await packingSlipService.setGenerationStatus(slip._id, 'AVAILABLE', { storageProvider: 's3', storageKey, fileType: pdf.contentType, uploadedAt: new Date(), errorReason: null });
      return { packingSlipId: slip._id };
    } catch (error) {
      if (slip?._id) await packingSlipService.setGenerationStatus(slip._id, 'FAILED', { errorReason: error.message }).catch(() => null);
      throw error;
    }
  }, { connection });
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

        if (metadata?.email && channel !== 'EMAIL') {
          await scheduleEmail({
            to: metadata.email,
            subject: title,
            html: message,
            jobType: 'send-notification-email',
          });
        }
        if (metadata?.phone) {
          await scheduleEmail({
            to: metadata.phone,
            subject: title,
            text: message,
            jobType: 'send-notification-sms',
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
        if (job.name === 'send-notification-sms') {
          return await smsService.sendSms({ to, message: text || subject });
        }
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

export async function startOrderFulfillmentWorker() {
  const { orderFulfillmentService } = await import('../services/order-fulfillment.service.js');
  const worker = new Worker(
    'order-fulfillment',
    async (job) => {
      const { vendorOrderId } = job.data;
      console.log(`Processing fulfillment job ${job.name} (${job.id}) for vendorOrder ${vendorOrderId}`);

      if (job.name === 'vendor-order-pack-reminder') {
        return await orderFulfillmentService.sendPackingReminder(vendorOrderId, job.data?.reminderStep);
      }
      if (job.name === 'vendor-order-auto-cancel') {
        return await orderFulfillmentService.autoCancelUnpackedVendorOrder(vendorOrderId);
      }
      throw new Error(`Unknown fulfillment job name: ${job.name}`);
    },
    { connection },
  );

  worker.on('failed', (job, error) => {
    console.error(`Fulfillment job ${job?.id} failed:`, error);
  });

  return worker;
}
