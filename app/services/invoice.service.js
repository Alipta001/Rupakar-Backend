import { AppError } from '../utils/app-error.js';
import { Invoice } from '../models/invoice.model.js';

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

  async getInvoiceByOrderId(orderId, customerId, vendorId = null) {
    if (!orderId) {
      throw new AppError(400, 'INVALID_ORDER_ID', 'Order ID is required');
    }

    const filter = { orderId, status: { $ne: 'CANCELLED' } };
    if (customerId) filter.customerId = customerId;
    if (vendorId) filter.vendorId = vendorId;

    const invoice = await Invoice.findOne(filter).lean();
    return invoice || null;
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
