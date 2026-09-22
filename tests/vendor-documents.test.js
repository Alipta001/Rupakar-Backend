import mongoose from 'mongoose';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Invoice } from '../app/models/invoice.model.js';
import { PackingSlip } from '../app/models/packing-slip.model.js';
import { Vendor } from '../app/models/vendor.model.js';
import { VendorOrder } from '../app/models/vendor-order.model.js';
import { InvoiceService } from '../app/services/invoice.service.js';
import { storageService } from '../app/services/storage.service.js';
import { PackingSlipService } from '../app/services/packing-slip.service.js';
import { PdfService } from '../app/services/pdf.service.js';

jest.unstable_mockModule('../app/jobs/queues.js', () => ({
  scheduleInvoiceGeneration: jest.fn().mockResolvedValue('invoice-job-1'),
  schedulePackingSlipGeneration: jest.fn().mockResolvedValue('packing-slip-job-1'),
}));

const { downloadVendorOrderInvoice, downloadVendorPackingSlip } = await import('../app/controllers/invoice.controller.js');
const { scheduleInvoiceGeneration, schedulePackingSlipGeneration } = await import('../app/jobs/queues.js');

const query = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

describe('vendor document lifecycle', () => {
  const vendorId = new mongoose.Types.ObjectId().toHexString();
  const customerId = new mongoose.Types.ObjectId().toHexString();
  const vendorOrderId = new mongoose.Types.ObjectId().toHexString();
  const parentOrderId = new mongoose.Types.ObjectId().toHexString();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(Vendor, 'findOne').mockReturnValue(query({ _id: vendorId, ownerUserId: 'vendor-owner', status: 'APPROVED' }));
    jest.spyOn(VendorOrder, 'findOne').mockReturnValue(query({ _id: vendorOrderId, parentOrderId, vendorId, customerId, deletedAt: null }));
  });

  it('returns a signed URL for an existing vendor invoice', async () => {
    const invoice = { _id: 'invoice-1', invoiceNumber: 'INV-1', generationStatus: 'AVAILABLE', storageKey: 'invoices/order/INV-1.pdf' };
    jest.spyOn(Invoice, 'findOne').mockReturnValue(query(invoice));
    jest.spyOn(storageService, 'getSignedUrl').mockResolvedValue('https://signed.example/invoice.pdf');
    const result = response();

    await downloadVendorOrderInvoice({ user: { sub: 'vendor-owner' }, params: { orderId: vendorOrderId }, headers: {} }, result, (error) => { throw error; });

    expect(scheduleInvoiceGeneration).not.toHaveBeenCalled();
    expect(result.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: { documentNumber: 'INV-1', downloadUrl: 'https://signed.example/invoice.pdf' } }));
  });

  it('queues a missing vendor invoice and returns 425', async () => {
    jest.spyOn(Invoice, 'findOne').mockReturnValue(query(null));
    const result = response();

    await downloadVendorOrderInvoice({ user: { sub: 'vendor-owner' }, params: { orderId: vendorOrderId }, headers: {} }, result, (error) => { throw error; });

    expect(scheduleInvoiceGeneration).toHaveBeenCalledWith({ orderId: parentOrderId, customerId, vendorId, vendorOrderId });
    expect(result.status).toHaveBeenCalledWith(425);
    expect(result.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'INVOICE_NOT_READY' }) }));
  });

  it('queues a missing packing slip and returns 425', async () => {
    jest.spyOn(PackingSlip, 'findOne').mockReturnValue(query(null));
    const result = response();

    await downloadVendorPackingSlip({ user: { sub: 'vendor-owner' }, params: { orderId: vendorOrderId }, headers: {} }, result, (error) => { throw error; });

    expect(schedulePackingSlipGeneration).toHaveBeenCalledWith({ orderId: parentOrderId, vendorOrderId, vendorId, customerId });
    expect(result.status).toHaveBeenCalledWith(425);
    expect(result.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'PACKING_SLIP_NOT_READY' }) }));
  });

  it('blocks a vendor that does not own the vendor order', async () => {
    VendorOrder.findOne.mockReturnValue(query(null));
    const result = response();
    const next = jest.fn();

    await downloadVendorOrderInvoice({ user: { sub: 'vendor-owner' }, params: { orderId: vendorOrderId }, headers: {} }, result, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'VENDOR_ORDER_NOT_FOUND' }));
    expect(scheduleInvoiceGeneration).not.toHaveBeenCalled();
  });

  it('creates idempotent packing-slip metadata and a real PDF', async () => {
    const service = new PackingSlipService();
    const created = { _id: 'packing-slip-1', packingSlipNumber: 'PS-TEST', toObject: () => ({ _id: 'packing-slip-1', packingSlipNumber: 'PS-TEST' }) };
    const createSpy = jest.spyOn(PackingSlip, 'create').mockResolvedValue(created);
    const slip = await service.createOrGet({ orderId: parentOrderId, vendorOrderId, vendorId, customerId });
    const pdf = await new PdfService().generatePackingSlipPdf({
      packingSlipNumber: slip.packingSlipNumber,
      order: { _id: parentOrderId, shippingAddressSnapshot: {} },
      vendorOrder: { _id: vendorOrderId, items: [] },
      vendor: { businessName: 'Vendor' },
    });

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ orderId: parentOrderId, vendorOrderId, vendorId, customerId }));
    expect(Buffer.isBuffer(pdf.content)).toBe(true);
    expect(pdf.content.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('creates vendor invoice metadata and a real PDF for the vendor fulfillment', async () => {
    const service = new InvoiceService();
    const created = {
      _id: 'invoice-1',
      invoiceNumber: 'INV-TEST',
      orderId: parentOrderId,
      vendorOrderId,
      vendorId,
      customerId,
      items: [],
      subtotal: 1000,
      total: 1000,
      generationStatus: 'PENDING',
      toObject: () => ({ _id: 'invoice-1', invoiceNumber: 'INV-TEST', orderId: parentOrderId, vendorOrderId, vendorId, customerId, items: [], subtotal: 1000, total: 1000 }),
    };
    jest.spyOn(Invoice, 'create').mockResolvedValue(created);
    const invoice = await service.createInvoice({ orderId: parentOrderId, customerId, vendorId, vendorOrderId, subtotal: 1000, total: 1000 });
    const pdf = await new PdfService().generateInvoicePdf(invoice);

    expect(invoice).toEqual(expect.objectContaining({ orderId: parentOrderId, vendorOrderId, vendorId, customerId }));
    expect(Buffer.isBuffer(pdf.content)).toBe(true);
    expect(pdf.content.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('reuses an existing packing-slip metadata record after a duplicate create race', async () => {
    const existing = { _id: 'packing-slip-1', sourceKey: `packing-slip:${vendorOrderId}` };
    jest.spyOn(PackingSlip, 'create').mockRejectedValue({ code: 11000 });
    jest.spyOn(PackingSlip, 'findOne').mockReturnValue(query(existing));

    await expect(new PackingSlipService().createOrGet({ orderId: parentOrderId, vendorOrderId, vendorId, customerId })).resolves.toEqual(existing);
    expect(PackingSlip.findOne).toHaveBeenCalledWith({ sourceKey: `packing-slip:${vendorOrderId}` });
  });
});