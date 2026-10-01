import { AppError } from '../utils/app-error.js';
import { Invoice } from '../models/invoice.model.js';

const inFlightVendorInvoices = new Map();

export class InvoiceService {
  generateInvoiceNumber() {
    const stamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `INV-${new Date().getFullYear()}-${stamp}-${random}`;
  }

  async createInvoice({
    orderId,
    customerId,
    vendorId = null,
    vendorOrderId = null,
    items = [],
    subtotal = 0,
    discount = 0,
    tax = 0,
    shipping = 0,
    total = 0,
    commissionRate = 0,
    commissionAmount = 0,
    netVendorPayable = 0,
    commissionSource = null,
    currency = 'INR',
    paymentMethod = 'razorpay',
    paymentStatus = 'PENDING',
    customerSnapshot = {},
    vendorSnapshot = {},
    billingAddressSnapshot = {},
    shippingAddressSnapshot = {},
  }) {
    if (!orderId || !customerId) {
      throw new AppError(400, 'INVALID_INVOICE_DATA', 'Order and customer are required');
    }

    const sourceKey = `order:${String(orderId)}:${vendorOrderId ? `vendor:${String(vendorOrderId)}` : 'customer'}`;
    const invoiceNumber = this.generateInvoiceNumber();
    
    let invoice;
    try {
      invoice = await Invoice.create({
        invoiceNumber,
        sourceKey,
        orderId,
        customerId,
        vendorId,
        vendorOrderId,
        items,
        subtotal,
        discount,
        tax,
        shipping,
        total,
        commissionRate,
        commissionAmount,
        netVendorPayable,
        commissionSource,
        currency,
        paymentMethod,
        paymentStatus,
        status: 'ISSUED',
        customerSnapshot,
        vendorSnapshot,
        billingAddressSnapshot,
        shippingAddressSnapshot,
        issuedAt: new Date(),
      });
    } catch (error) {
      if (error?.code === 11000) {
        return Invoice.findOne({ sourceKey, status: { $ne: 'CANCELLED' } }).lean();
      }
      throw error;
    }

    return invoice.toObject ? invoice.toObject() : invoice;
  }

  async getInvoice(invoiceId) {
    if (!invoiceId) {
      throw new AppError(400, 'INVALID_INVOICE_ID', 'Invoice ID is required');
    }

    const invoice = await Invoice.findById(invoiceId).lean();
    if (!invoice) {
      throw new AppError(404, 'INVOICE_NOT_FOUND', 'Invoice not found');
    }

    return invoice;
  }

  async getInvoiceByOrderId(orderId, customerId = null, vendorId = null) {
    if (!orderId) {
      throw new AppError(400, 'INVALID_ORDER_ID', 'Order ID is required');
    }

    const filter = { orderId, status: { $ne: 'CANCELLED' } };
    if (vendorId) {
      filter.vendorId = vendorId;
    } else {
      filter.vendorId = null;
      filter.vendorOrderId = null;
    }
    if (customerId) filter.customerId = customerId;

    const invoice = await Invoice.findOne(filter).lean();
    return invoice || null;
  }

  async ensureCustomerInvoice(order) {
    if (!order) return null;
    let invoice = await this.getInvoiceByOrderId(order._id, order.customerId, null);
    if (!invoice) {
      const { User } = await import('../models/user.model.js');
      const customer = order.customerId ? await User.findById(order.customerId).select('name email').lean() : null;
      let vendorSnapshot = {};
      const firstVendorId = (order.items || []).find((i) => i.vendorId)?.vendorId;
      if (firstVendorId) {
        const { Vendor } = await import('../models/vendor.model.js');
        const v = await Vendor.findById(firstVendorId).select('businessName legalName storeName name').lean();
        if (v) vendorSnapshot = v;
      }
      invoice = await this.createInvoice({
        orderId: order._id,
        customerId: order.customerId,
        vendorId: null,
        vendorOrderId: null,
        items: (order.items || []).map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })),
        subtotal: Number(order.subtotal || 0),
        discount: Number(order.discount || 0),
        tax: Number(order.tax || 0),
        shipping: Number(order.shipping || 0),
        total: Number(order.total || 0),
        currency: order.currency || 'INR',
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        customerSnapshot: customer || {},
        vendorSnapshot,
        shippingAddressSnapshot: order.shippingAddressSnapshot || {},
        billingAddressSnapshot: order.billingAddressSnapshot || {},
      });
    }

    if (invoice && (invoice.generationStatus !== 'AVAILABLE' || !invoice.storageKey)) {
      const { pdfService } = await import('./pdf.service.js');
      const { storageService } = await import('./storage.service.js');
      await this.setGenerationStatus(invoice._id, 'GENERATING', { errorReason: null });
      const pdf = await pdfService.generateInvoicePdf(invoice);
      await this.setGenerationStatus(invoice._id, 'UPLOADING', { generatedAt: new Date() });
      const storageKey = `invoices/${String(order._id)}/${invoice.invoiceNumber}.pdf`;
      await storageService.upload({ key: storageKey, body: pdf.content, contentType: pdf.contentType });
      invoice = await this.setGenerationStatus(invoice._id, 'AVAILABLE', {
        storageProvider: 's3',
        storageKey,
        storageUrl: null,
        fileType: pdf.contentType,
        uploadedAt: new Date(),
        errorReason: null,
      });
    }

    return invoice;
  }

  async ensureVendorInvoice(vendorOrder) {
    if (!vendorOrder) return null;
    const lockKey = String(vendorOrder._id || vendorOrder.parentOrderId);
    if (inFlightVendorInvoices.has(lockKey)) {
      return inFlightVendorInvoices.get(lockKey);
    }

    const task = (async () => {
      const vendorId = vendorOrder.vendorId;
      let invoice = await Invoice.findOne({
        $or: [
          { vendorOrderId: vendorOrder._id, vendorId },
          { orderId: vendorOrder.parentOrderId, vendorId, vendorOrderId: null },
        ],
        status: { $ne: 'CANCELLED' },
      });

      if (!invoice) {
        const { Order } = await import('../models/order.model.js');
        const { Vendor } = await import('../models/vendor.model.js');
        const { User } = await import('../models/user.model.js');
        const { VendorLedgerEntry } = await import('../models/vendor-ledger-entry.model.js');

        const [order, vendor, customer, ledger] = await Promise.all([
          Order.findById(vendorOrder.parentOrderId).lean(),
          Vendor.findById(vendorId).select('businessName legalName email address gstNumber').lean(),
          User.findById(vendorOrder.customerId).select('name email').lean(),
          VendorLedgerEntry.findOne({ vendorOrderId: vendorOrder._id, transactionType: 'SALE_CAPTURE' }).lean(),
        ]);

        if (!order) return null;

        const items = (vendorOrder.items || []).map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        }));

        const total = Number(vendorOrder.total || 0);

        invoice = await this.createInvoice({
          orderId: vendorOrder.parentOrderId,
          customerId: vendorOrder.customerId,
          vendorId,
          vendorOrderId: vendorOrder._id,
          items,
          subtotal: Number(vendorOrder.subtotal || 0),
          discount: Number(vendorOrder.discount || 0),
          tax: Number(vendorOrder.tax || 0),
          shipping: Number(vendorOrder.shipping || 0),
          total,
          currency: vendorOrder.currency || order.currency || 'INR',
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
      }

      if (invoice && (invoice.generationStatus !== 'AVAILABLE' || !invoice.storageKey)) {
        const { pdfService } = await import('./pdf.service.js');
        const { storageService } = await import('./storage.service.js');
        await this.setGenerationStatus(invoice._id, 'GENERATING', { errorReason: null });
        const pdf = await pdfService.generateInvoicePdf(invoice);
        await this.setGenerationStatus(invoice._id, 'UPLOADING', { generatedAt: new Date() });
        const storageKey = `invoices/${String(vendorOrder.parentOrderId)}/${invoice.invoiceNumber}.pdf`;
        await storageService.upload({ key: storageKey, body: pdf.content, contentType: pdf.contentType });
        invoice = await this.setGenerationStatus(invoice._id, 'AVAILABLE', {
          storageProvider: 's3',
          storageKey,
          storageUrl: null,
          fileType: pdf.contentType,
          uploadedAt: new Date(),
          errorReason: null,
        });
      }

      return invoice;
    })();

    inFlightVendorInvoices.set(lockKey, task);
    try {
      return await task;
    } finally {
      inFlightVendorInvoices.delete(lockKey);
    }
  }

  async listInvoices({ customerId = null, vendorId = null, page = 1, limit = 20 }) {
    const filter = {};
    if (customerId) filter.customerId = customerId;
    if (vendorId) filter.vendorId = vendorId;

    const skip = (page - 1) * limit;
    const invoices = await Invoice.find(filter)
      .sort({ issuedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Invoice.countDocuments(filter);
    return { invoices, page, limit, total };
  }

  async markInvoiceViewed(invoiceId) {
    const invoice = await Invoice.findByIdAndUpdate(
      invoiceId,
      { viewedAt: new Date(), status: 'VIEWED' },
      { new: true },
    );
    return invoice ? (invoice.toObject ? invoice.toObject() : invoice) : null;
  }

  async markInvoiceDownloaded(invoiceId) {
    const invoice = await Invoice.findByIdAndUpdate(
      invoiceId,
      { downloadedAt: new Date(), status: 'DOWNLOADED' },
      { new: true },
    );
    return invoice ? (invoice.toObject ? invoice.toObject() : invoice) : null;
  }

  async updateInvoiceStorage(invoiceId, storageKey, storageUrl) {
    const invoice = await Invoice.findByIdAndUpdate(
      invoiceId,
      { storageKey, storageUrl },
      { new: true },
    );
    return invoice ? (invoice.toObject ? invoice.toObject() : invoice) : null;
  }

  async setGenerationStatus(invoiceId, generationStatus, fields = {}) {
    const invoice = await Invoice.findByIdAndUpdate(invoiceId, { $set: { generationStatus, ...fields } }, { new: true });
    return invoice?.toObject?.() ?? invoice;
  }
}

export const invoiceService = new InvoiceService();
