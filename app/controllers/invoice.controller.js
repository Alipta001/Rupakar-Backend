import { Order } from '../models/order.model.js';
import { Invoice } from '../models/invoice.model.js';
import { AppError } from '../utils/app-error.js';
import { sendSuccess } from '../utils/response.js';
import { invoiceService } from '../services/invoice.service.js';
import { listInvoicesQuerySchema, invoiceIdSchema } from '../validators/invoice.validators.js';

const getMeta = (query = {}) => {
  const { page, limit } = listInvoicesQuerySchema.parse(query ?? {});
  return { page, limit, skip: (page - 1) * limit };
};

export const getOrderInvoice = async (req, res, next) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findOne({ _id: orderId, customerId: req.user.sub }).lean();
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    const invoice = await invoiceService.getInvoiceByOrderId(orderId, req.user.sub);
    if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', 'No invoice found for this order');

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

    await invoiceService.markInvoiceDownloaded(invoice._id);

    sendSuccess(res, { invoiceNumber: invoice.invoiceNumber, storageUrl: invoice.storageUrl, downloadUrl: invoice.storageUrl }, 'Invoice download link', String(req.headers['x-request-id'] ?? ''));
  } catch (error) {
    next(error);
  }
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
