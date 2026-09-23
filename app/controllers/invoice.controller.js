import { Order } from '../models/order.model.js';
import { Invoice } from '../models/invoice.model.js';
import { AppError } from '../utils/app-error.js';
import { sendSuccess } from '../utils/response.js';
import { invoiceService } from '../services/invoice.service.js';
import { storageService } from '../services/storage.service.js';
import { Vendor } from '../models/vendor.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { PackingSlip } from '../models/packing-slip.model.js';
import { listInvoicesQuerySchema, invoiceIdSchema } from '../validators/invoice.validators.js';
import { scheduleInvoiceGeneration, schedulePackingSlipGeneration } from '../jobs/queues.js';

const getMeta = (query = {}) => {
  const { page, limit } = listInvoicesQuerySchema.parse(query ?? {});
  return { page, limit, skip: (page - 1) * limit };
};

const queueCustomerInvoiceGeneration = async (order) => {
  try {
    await scheduleInvoiceGeneration({ orderId: order._id, customerId: order.customerId });
  } catch {
    throw new AppError(503, 'INVOICE_GENERATION_UNAVAILABLE', 'Invoice generation is temporarily unavailable');
  }
};

export const getOrderInvoice = async (req, res, next) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findOne({ _id: orderId, customerId: req.user.sub }).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    let invoice = await invoiceService.getInvoiceByOrderId(orderId, req.user.sub, null);
    if (!invoice && (['PAID', 'CAPTURED'].includes(order.paymentStatus) || order.status === 'CONFIRMED')) {
      invoice = await invoiceService.ensureCustomerInvoice(order).catch(() => null);
    }
    if (!invoice) {
      await queueCustomerInvoiceGeneration(order);
      res.status(425).json({ success: false, error: { code: 'INVOICE_NOT_READY', message: 'Invoice generation has been queued' } }); return;
    }

    await invoiceService.markInvoiceViewed(invoice._id);

    sendSuccess(res, invoice, 'Invoice loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getInvoiceDetail = async (req, res, next) => {
  try {
    const { id } = invoiceIdSchema.parse({ id: req.params.id });
    const invoice = await invoiceService.getInvoice(id);

    if (String(invoice.customerId) !== String(req.user.sub)) {
      throw new AppError(403, 'INVOICE_ACCESS_DENIED', 'You do not have access to this invoice');
    }

    await invoiceService.markInvoiceViewed(invoice._id);

    sendSuccess(res, invoice, 'Invoice detail loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listCustomerInvoices = async (req, res, next) => {
  try {
    const { page, limit } = getMeta(req.query);
    const result = await invoiceService.listInvoices({
      customerId: req.user.sub,
      page,
      limit,
    });

    sendSuccess(res, { items: result.invoices, page, limit, total: result.total }, 'Invoices loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const downloadInvoice = async (req, res, next) => {
  try {
    const { id } = invoiceIdSchema.parse({ id: req.params.id });
    const invoice = await invoiceService.getInvoice(id);

    if (String(invoice.customerId) !== String(req.user.sub)) {
      throw new AppError(403, 'INVOICE_ACCESS_DENIED', 'You do not have access to this invoice');
    }

    if (invoice.generationStatus !== 'AVAILABLE' || !invoice.storageKey) {
      res.status(invoice.generationStatus === 'FAILED' ? 409 : 425).json({ success: false, error: { code: invoice.generationStatus === 'FAILED' ? 'INVOICE_FAILED' : 'INVOICE_NOT_READY', message: 'Invoice PDF is not ready' } }); return;
    }
    const downloadUrl = await storageService.getSignedUrl(invoice.storageKey);
    await invoiceService.markInvoiceDownloaded(invoice._id);

    sendSuccess(res, { invoiceNumber: invoice.invoiceNumber, downloadUrl }, 'Invoice download link', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const downloadOrderInvoice = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.orderId).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const isAdmin = req.user.role === 'admin';
    const vendor = req.user.role === 'vendor' ? await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null }).lean() : null;
    // A vendor order has its own invoice. Select it before authorization so a
    // vendor is never evaluated against the parent customer invoice.
    let invoice = await invoiceService.getInvoiceByOrderId(
      order._id,
      isAdmin || vendor ? null : req.user.sub,
      vendor?._id ?? null,
    );
    if ((!invoice || invoice.generationStatus !== 'AVAILABLE' || !invoice.storageKey) && !vendor && !isAdmin) {
      if (['PAID', 'CAPTURED'].includes(order.paymentStatus) || ['CONFIRMED', 'PROCESSING', 'PACKED', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
        invoice = await invoiceService.ensureCustomerInvoice(order).catch(() => invoice);
      }
    }
    if (!invoice) {
      if (vendor || isAdmin) throw new AppError(404, 'INVOICE_NOT_FOUND', 'No invoice found for this order');
      await queueCustomerInvoiceGeneration(order);
      res.status(425).json({ success: false, error: { code: 'INVOICE_NOT_READY', message: 'Invoice generation has been queued' } }); return;
    }
    const isOwner = String(invoice.customerId) === String(req.user.sub);
    if (!isOwner && !isAdmin && String(vendor?._id) !== String(invoice.vendorId)) throw new AppError(403, 'INVOICE_ACCESS_DENIED', 'You do not have access to this invoice');
    if (invoice.generationStatus !== 'AVAILABLE' || !invoice.storageKey) { res.status(invoice.generationStatus === 'FAILED' ? 409 : 425).json({ success: false, error: { code: 'INVOICE_NOT_READY', message: 'Invoice PDF is not ready' } }); return; }
    const downloadUrl = await storageService.getSignedUrl(invoice.storageKey);
    await invoiceService.markInvoiceDownloaded(invoice._id);
    sendSuccess(res, { invoiceNumber: invoice.invoiceNumber, downloadUrl }, 'Invoice download link', String(req.headers['x-request-id'] ?? ''));
  } catch (error) { next(error); }
};

const getVendorForDocument = async (userId) => {
  const vendor = await Vendor.findOne({ ownerUserId: userId, deletedAt: null, status: 'APPROVED' }).lean();
  if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'An approved vendor profile is required');
  return vendor;
};

const sendDocumentUrl = async (res, document, label, requestId, queueGeneration) => {
  if (!document) {
    await queueGeneration();
    const code = label === 'Packing slip' ? 'PACKING_SLIP_NOT_READY' : 'INVOICE_NOT_READY';
    res.status(425).json({ success: false, error: { code, message: `${label} generation has been queued` } }); return;
  }
  if (document.generationStatus !== 'AVAILABLE' || !document.storageKey) {
    res.status(document.generationStatus === 'FAILED' ? 409 : 425).json({ success: false, error: { code: document.generationStatus === 'FAILED' ? 'DOCUMENT_FAILED' : 'DOCUMENT_NOT_READY', message: `${label} is not ready` } });
    return;
  }
  const downloadUrl = await storageService.getSignedUrl(document.storageKey);
  sendSuccess(res, { documentNumber: document.invoiceNumber || document.packingSlipNumber, downloadUrl }, `${label} download link`, requestId);
};

export const downloadVendorOrderInvoice = async (req, res, next) => {
  try {
    const vendor = await getVendorForDocument(req.user.sub);
    const vendorOrder = await VendorOrder.findOne({ _id: req.params.orderId, vendorId: vendor._id, deletedAt: null }).lean();
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');

    const invoice = await Invoice.findOne({
      $or: [
        { vendorOrderId: vendorOrder._id, vendorId: vendor._id },
        { orderId: vendorOrder.parentOrderId, vendorId: vendor._id, vendorOrderId: null },
      ],
      status: { $ne: 'CANCELLED' },
    }).lean();

    await sendDocumentUrl(
      res,
      invoice,
      'Vendor invoice',
      String(req.headers['x-request-id'] ?? ''),
      () => scheduleInvoiceGeneration({ orderId: vendorOrder.parentOrderId, customerId: vendorOrder.customerId, vendorId: vendor._id, vendorOrderId: vendorOrder._id }),
    );
  } catch (error) { next(error); }
};

export const downloadVendorPackingSlip = async (req, res, next) => {
  try {
    const vendor = await getVendorForDocument(req.user.sub);
    const vendorOrder = await VendorOrder.findOne({ _id: req.params.orderId, vendorId: vendor._id, deletedAt: null }).lean();
    if (!vendorOrder) throw new AppError(404, 'VENDOR_ORDER_NOT_FOUND', 'Vendor order not found');
    const packingSlip = await PackingSlip.findOne({ vendorOrderId: vendorOrder._id, vendorId: vendor._id }).lean();
    await sendDocumentUrl(
      res,
      packingSlip,
      'Packing slip',
      String(req.headers['x-request-id'] ?? ''),
      () => schedulePackingSlipGeneration({ orderId: vendorOrder.parentOrderId, vendorOrderId: vendorOrder._id, vendorId: vendor._id, customerId: vendorOrder.customerId }),
    );
  } catch (error) { next(error); }
};

export const listAdminInvoices = async (req, res, next) => {
  try {
    const { page, limit } = getMeta(req.query);
    const skip = (page - 1) * limit;

    const invoices = await Invoice.find({})
      .sort({ issuedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Invoice.countDocuments({});

    sendSuccess(res, { items: invoices, page, limit, total }, 'Admin invoices loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const getAdminInvoiceDetail = async (req, res, next) => {
  try {
    const { id } = invoiceIdSchema.parse({ id: req.params.id });
    const invoice = await invoiceService.getInvoice(id);
    sendSuccess(res, invoice, 'Invoice detail loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};

export const listVendorInvoices = async (req, res, next) => {
  try {
    const { Vendor } = await import('../models/vendor.model.js');
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null });
    if (!vendor) throw new AppError(403, 'VENDOR_ACCESS_DENIED', 'Vendor profile is required');

    const { page, limit } = getMeta(req.query);
    const skip = (page - 1) * limit;

    const invoices = await Invoice.find({ vendorId: vendor._id })
      .sort({ issuedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Invoice.countDocuments({ vendorId: vendor._id });

    sendSuccess(res, { items: invoices, page, limit, total }, 'Vendor invoices loaded', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
};
