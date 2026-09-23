import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Invoice } from '../app/models/invoice.model.js';
import { Order } from '../app/models/order.model.js';
import { invoiceService } from '../app/services/invoice.service.js';
import { storageService } from '../app/services/storage.service.js';
import { downloadOrderInvoice } from '../app/controllers/invoice.controller.js';

const query = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

describe('invoice download regression and multi-vendor isolation', () => {
  const customerId = new mongoose.Types.ObjectId().toHexString();
  const otherCustomerId = new mongoose.Types.ObjectId().toHexString();
  const vendorId1 = new mongoose.Types.ObjectId().toHexString();
  const orderId = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('customer receives the customer parent invoice and NOT a vendor sub-invoice', async () => {
    const parentInvoice = {
      _id: 'inv-parent-1',
      invoiceNumber: 'INV-2026-CUSTOMER',
      orderId,
      customerId,
      vendorId: null,
      vendorOrderId: null,
      generationStatus: 'AVAILABLE',
      storageKey: `invoices/${orderId}/INV-2026-CUSTOMER.pdf`,
    };

    jest.spyOn(Order, 'findById').mockReturnValue(query({
      _id: orderId,
      customerId,
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
    }));

    const getInvoiceSpy = jest.spyOn(invoiceService, 'getInvoiceByOrderId').mockResolvedValue(parentInvoice);
    jest.spyOn(storageService, 'getSignedUrl').mockResolvedValue('https://signed.example/customer-invoice.pdf');
    jest.spyOn(invoiceService, 'markInvoiceDownloaded').mockResolvedValue(parentInvoice);

    const res = response();
    await downloadOrderInvoice({
      params: { orderId },
      user: { sub: customerId, role: 'customer' },
      headers: {},
    }, res, (error) => { throw error; });

    expect(getInvoiceSpy).toHaveBeenCalledWith(orderId, customerId, null);
    expect(storageService.getSignedUrl).toHaveBeenCalledWith(parentInvoice.storageKey);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        invoiceNumber: 'INV-2026-CUSTOMER',
        downloadUrl: 'https://signed.example/customer-invoice.pdf',
      }),
    }));
  });

  it('invoiceService.getInvoiceByOrderId explicitly queries vendorId: null for customer', async () => {
    const findSpy = jest.spyOn(Invoice, 'findOne').mockReturnValue(query({
      _id: 'inv-1',
      orderId,
      customerId,
      vendorId: null,
      vendorOrderId: null,
    }));

    await invoiceService.getInvoiceByOrderId(orderId, customerId, null);

    expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      customerId,
      vendorId: null,
      vendorOrderId: null,
      status: { $ne: 'CANCELLED' },
    }));
  });

  it('vendor querying getInvoiceByOrderId filters strictly by vendorId', async () => {
    const findSpy = jest.spyOn(Invoice, 'findOne').mockReturnValue(query({
      _id: 'inv-v1',
      orderId,
      vendorId: vendorId1,
    }));

    await invoiceService.getInvoiceByOrderId(orderId, null, vendorId1);

    expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({
      orderId,
      vendorId: vendorId1,
      status: { $ne: 'CANCELLED' },
    }));
  });

  it('ensures missing customer invoice for paid order is generated without vendor invoice dependency', async () => {
    const orderDoc = {
      _id: orderId,
      customerId,
      paymentStatus: 'PAID',
      status: 'CONFIRMED',
      items: [{ productId: 'p1', variantId: 'v1', productName: 'Item 1', sku: 'SKU1', quantity: 1, unitPrice: 500, lineTotal: 500 }],
      subtotal: 500,
      total: 500,
    };

    jest.spyOn(Order, 'findById').mockReturnValue(query(orderDoc));
    jest.spyOn(invoiceService, 'getInvoiceByOrderId').mockResolvedValue(null);

    const generatedInvoice = {
      _id: 'inv-generated',
      invoiceNumber: 'INV-GEN-1',
      customerId,
      orderId,
      vendorId: null,
      generationStatus: 'AVAILABLE',
      storageKey: `invoices/${orderId}/INV-GEN-1.pdf`,
    };

    jest.spyOn(invoiceService, 'ensureCustomerInvoice').mockResolvedValue(generatedInvoice);
    jest.spyOn(storageService, 'getSignedUrl').mockResolvedValue('https://signed.example/generated.pdf');
    jest.spyOn(invoiceService, 'markInvoiceDownloaded').mockResolvedValue(generatedInvoice);

    const res = response();
    await downloadOrderInvoice({
      params: { orderId },
      user: { sub: customerId, role: 'customer' },
      headers: {},
    }, res, (error) => { throw error; });

    expect(invoiceService.ensureCustomerInvoice).toHaveBeenCalledWith(expect.objectContaining({ _id: orderId }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        invoiceNumber: 'INV-GEN-1',
        downloadUrl: 'https://signed.example/generated.pdf',
      }),
    }));
  });

  it('prevents customer from downloading an invoice belonging to another customer', async () => {
    const foreignInvoice = {
      _id: 'inv-other',
      invoiceNumber: 'INV-OTHER',
      orderId,
      customerId: otherCustomerId,
      vendorId: null,
      generationStatus: 'AVAILABLE',
      storageKey: 'key',
    };

    jest.spyOn(Order, 'findById').mockReturnValue(query({ _id: orderId }));
    jest.spyOn(invoiceService, 'getInvoiceByOrderId').mockResolvedValue(foreignInvoice);

    const res = response();
    const next = jest.fn();

    await downloadOrderInvoice({
      params: { orderId },
      user: { sub: customerId, role: 'customer' },
      headers: {},
    }, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      code: 'INVOICE_ACCESS_DENIED',
    }));
  });
});
