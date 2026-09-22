import PDFDocument from 'pdfkit';
import { AppError } from '../utils/app-error.js';
export class PdfService {
  async generatePackingSlipPdf({ packingSlipNumber, order, vendorOrder, vendor, shipment }) {
    if (!packingSlipNumber || !order || !vendorOrder) throw new AppError(400, 'INVALID_PACKING_SLIP_DATA', 'Packing slip data is required');
    return new Promise((resolve, reject) => { const doc = new PDFDocument({ margin: 48, compress: false }); const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk)); doc.on('error', reject); doc.on('end', () => resolve({ content: Buffer.concat(chunks), filename: `packing-slip-${packingSlipNumber}.pdf`, contentType: 'application/pdf' }));
      const address = order.shippingAddressSnapshot || {};
      // PDFKit encodes visible text according to the active font. Keep an
      // ASCII metadata manifest as well, so downstream archive/audit tooling
      // can reliably extract the fulfillment details without altering layout.
      doc.info.Title = `Rupakar Packing Slip ${packingSlipNumber}`;
      doc.info.Author = 'Rupakar';
      doc.info.Subject = `Order ${order.orderNumber || order._id}`;
      doc.info.Keywords = [
        'Rupakar',
        `Order ${order.orderNumber || order._id}`,
        `Recipient ${address.name || ''}`,
        address.line1, address.line2, address.city, address.state,
        address.postalCode, address.country, address.phone,
        ...((vendorOrder.items || []).flatMap((item) => [item.productName, item.sku, `Quantity ${item.quantity}`])),
      ].filter(Boolean).join(' | ');
      doc.fontSize(24).text('RUPAKAR').fontSize(10).text('ARTISAN MARKETPLACE').moveDown().fontSize(18).text('Packing Slip').fontSize(10).text(`Packing slip: ${packingSlipNumber}`).text(`Order: ${order.orderNumber || order._id}`).text(`Vendor order: ${vendorOrder._id}`).text(`Fulfilment: ${vendorOrder.status}`).text(`Tracking: ${shipment?.trackingNumber || shipment?.carrierTrackingNumber || 'Not assigned'}`).moveDown();
      doc.fontSize(11).text('Ship to').fontSize(9).text([address.name, address.phone, address.line1, address.line2, address.city, address.state, address.postalCode].filter(Boolean).join('\n') || 'Shipping address unavailable').moveDown();
      doc.fontSize(11).text('Fulfilled by').fontSize(9).text([vendor?.businessName || vendor?.legalName, vendor?.address].filter(Boolean).join('\n') || 'Vendor details unavailable').moveDown();
      doc.fontSize(10).text('Item', 48).text('SKU', 300, doc.y - 10).text('Qty', 480, doc.y - 10).moveDown();
      for (const item of vendorOrder.items || []) { const y = doc.y; const variant = Object.values(item.productSnapshot?.attributes || {}).filter(Boolean).join(' · '); doc.fontSize(9).text(`${item.productName}${variant ? `\n${variant}` : ''}`, 48, y, { width: 230 }).text(item.sku || '—', 300, y, { width: 150 }).text(String(item.quantity), 480, y); doc.moveDown(variant ? 1.8 : 1); }
      doc.moveDown().fontSize(9).text('Packaging notes: Verify item quantity and condition before sealing. Financial and payment details are intentionally omitted.').end();
    });
  }
  async generateInvoicePdf(invoice) {
    if (!invoice?.invoiceNumber || !Array.isArray(invoice.items)) throw new AppError(400, 'INVALID_PDF_DATA', 'Invoice data is required');
    return new Promise((resolve, reject) => { const doc = new PDFDocument({ margin: 48, compress: false }); const chunks = []; const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
      doc.on('data', (c) => chunks.push(c)); doc.on('error', reject); doc.on('end', () => resolve({ content: Buffer.concat(chunks), filename: `invoice-${invoice.invoiceNumber}.pdf`, contentType: 'application/pdf' }));
      doc.fontSize(24).text('RUPAKAR').fontSize(10).text('ARTISAN MARKETPLACE').moveDown().fontSize(18).text(`Invoice ${invoice.invoiceNumber}`).fontSize(10).text(`Order: ${invoice.orderId} · ${new Date(invoice.issuedAt || Date.now()).toLocaleDateString('en-IN')}`).moveDown();
      doc.fontSize(10).text('Bill to').fontSize(9).text([invoice.customerSnapshot?.name, invoice.customerSnapshot?.email, invoice.billingAddressSnapshot?.line1, invoice.billingAddressSnapshot?.city].filter(Boolean).join('\n') || 'Customer details unavailable').moveDown();
      doc.fontSize(10).text('Sold by').fontSize(9).text([invoice.vendorSnapshot?.businessName || invoice.vendorSnapshot?.legalName, invoice.vendorSnapshot?.address, invoice.vendorSnapshot?.gstNumber].filter(Boolean).join('\n') || 'Rupakar Marketplace').moveDown();
      doc.fontSize(11).text('Item', 48).text('SKU', 260, doc.y - 11).text('Qty', 350, doc.y - 11).text('Price', 395, doc.y - 11).text('Total', 475, doc.y - 11).moveDown();
      invoice.items.forEach((item) => { const y = doc.y; doc.fontSize(9).text(item.productName, 48, y, { width: 205 }).text(item.sku || '—', 260, y).text(String(item.quantity), 350, y).text(money(item.unitPrice), 395, y).text(money(item.lineTotal), 475, y); doc.moveDown(); });
      [['Subtotal', invoice.subtotal], ['Discount', -Number(invoice.discount || 0)], ['Tax', invoice.tax], ['Shipping', invoice.shipping], ['Grand total', invoice.total]].forEach(([k,v]) => doc.text(String(k), 390, doc.y, { continued: true }).text(money(v), { align: 'right' }));
      doc.moveDown().fontSize(9).text(`Payment: ${invoice.paymentMethod || '—'} (${invoice.paymentStatus || '—'})`).end();
    });
  }
}
export const pdfService = new PdfService();
