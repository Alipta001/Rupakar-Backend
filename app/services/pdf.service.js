import PDFDocument from 'pdfkit';
import { AppError } from '../utils/app-error.js';

export class PdfService {
  async generatePackingSlipPdf({ packingSlipNumber, order, vendorOrder, vendor, shipment }) {
    if (!packingSlipNumber || !order || !vendorOrder) throw new AppError(400, 'INVALID_PACKING_SLIP_DATA', 'Packing slip data is required');
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, compress: false });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve({ content: Buffer.concat(chunks), filename: `packing-slip-${packingSlipNumber}.pdf`, contentType: 'application/pdf' }));

      const address = order.shippingAddressSnapshot || {};
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
      for (const item of vendorOrder.items || []) {
        const y = doc.y;
        const variant = Object.values(item.productSnapshot?.attributes || {}).filter(Boolean).join(' · ');
        doc.fontSize(9).text(`${item.productName}${variant ? `\n${variant}` : ''}`, 48, y, { width: 230 }).text(item.sku || '—', 300, y, { width: 150 }).text(String(item.quantity), 480, y);
        doc.moveDown(variant ? 1.8 : 1);
      }
      doc.moveDown().fontSize(9).text('Packaging notes: Verify item quantity and condition before sealing. Financial and payment details are intentionally omitted.').end();
    });
  }

  async generateInvoicePdf(invoice) {
    if (!invoice?.invoiceNumber || !Array.isArray(invoice.items)) throw new AppError(400, 'INVALID_PDF_DATA', 'Invoice data is required');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4', bufferPages: true, compress: false });
      const chunks = [];
      const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const lineItems = invoice.items || [];
      const issueDate = new Date(invoice.issuedAt || Date.now());
      const formatAddress = (address = {}) => [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ');
      const formatDate = (value) => new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve({ content: Buffer.concat(chunks), filename: `invoice-${invoice.invoiceNumber}.pdf`, contentType: 'application/pdf' }));

      const drawHeader = () => {
        doc.fillColor('#1d0f0a').font('Helvetica-Bold').fontSize(24).text('RUPAKAR', 48, 42);
        doc.fillColor('#7f6658').font('Helvetica').fontSize(8).text('PREMIUM MARKETPLACE • ARTISAN VERIFIED', 48, 70);
        doc.fillColor('#3e2a1d').font('Helvetica-Bold').fontSize(18).text('INVOICE', 420, 44, { align: 'right' });
        doc.fillColor('#6c564d').font('Helvetica').fontSize(9).text(`# ${invoice.invoiceNumber}`, 420, 68, { align: 'right' });
        doc.fillColor('#6c564d').font('Helvetica').fontSize(9).text(`Issued ${formatDate(issueDate)}`, 420, 82, { align: 'right' });
        doc.fillColor('#6c564d').font('Helvetica').fontSize(9).text(`Order ${invoice.orderId || 'N/A'}`, 420, 96, { align: 'right' });
        doc.moveTo(48, 116).lineTo(548, 116).strokeColor('#e3d4c5').stroke();
      };

      const drawPartyCard = (x, y, width, title, lines) => {
        doc.roundedRect(x, y, width, 100, 10).fillAndStroke('#f9f4ee', '#e3d0b6');
        doc.fillColor('#261812').font('Helvetica-Bold').fontSize(10).text(title, x + 16, y + 14);
        doc.fillColor('#43352d').font('Helvetica').fontSize(9);
        const content = (Array.isArray(lines) ? lines : []).filter(Boolean);
        content.forEach((line, index) => {
          doc.text(line, x + 16, y + 34 + (index * 14), { width: width - 32 });
        });
      };

      const drawTableHeader = (yPosition) => {
        doc.fillColor('#6d5748').font('Helvetica-Bold').fontSize(8);
        doc.text('ITEM', 48, yPosition);
        doc.text('SKU / VARIANT', 278, yPosition);
        doc.text('QTY', 390, yPosition);
        doc.text('UNIT PRICE', 432, yPosition);
        doc.text('LINE TOTAL', 495, yPosition, { align: 'right' });
        doc.moveTo(48, yPosition + 18).lineTo(548, yPosition + 18).strokeColor('#e4d5ca').stroke();
      };

      const drawPageFooter = (pageIndex, totalPages) => {
        const footerY = doc.page.height - 30;
        doc.fillColor('#7b675c').font('Helvetica').fontSize(8).text('Rupakar Support • hello@rupakar.com • +91 98765 43210', 48, footerY, { width: 320 });
        doc.fillColor('#7b675c').font('Helvetica').fontSize(8).text(`Page ${pageIndex + 1} of ${totalPages}`, 500, footerY, { align: 'right' });
      };

      const finalizePageNumbers = () => {
        const range = doc.bufferedPageRange();
        const totalPages = range.count;
        for (let pageIndex = range.start; pageIndex < totalPages; pageIndex += 1) {
          doc.switchToPage(pageIndex);
          drawPageFooter(pageIndex, totalPages);
        }
      };

      const customerName = invoice.customerSnapshot?.name || 'Customer details unavailable';
      const customerEmail = invoice.customerSnapshot?.email || '';
      const billingAddress = invoice.billingAddressSnapshot || {};
      const vendorName = invoice.vendorSnapshot?.businessName || invoice.vendorSnapshot?.legalName || 'Rupakar Marketplace';
      const vendorAddress = invoice.vendorSnapshot?.address || '';
      const vendorGst = invoice.vendorSnapshot?.gstNumber || '';

      const subtotal = Number(invoice.subtotal || 0);
      const discount = Number(invoice.discount || 0);
      const tax = Number(invoice.tax || 0);
      const shipping = Number(invoice.shipping || 0);
      const total = Number(invoice.total || subtotal + tax + shipping - discount);
      const summary = [
        ['Subtotal', subtotal],
        ['Discount', -discount],
        ['Tax', tax],
        ['Shipping', shipping],
        ['Final Payable', total],
      ];

      drawHeader();
      drawPartyCard(48, 134, 220, 'Seller / Vendor', [vendorName, vendorAddress, vendorGst ? `GST ${vendorGst}` : null].filter(Boolean));
      drawPartyCard(300, 134, 220, 'Customer / Billing', [customerName, customerEmail, formatAddress(billingAddress)].filter(Boolean));

      let tableY = 260;
      drawTableHeader(tableY);
      tableY += 22;

      for (const item of lineItems) {
        const itemName = item.productName || 'Product';
        const variantText = item.variantName || item.variant || item.attributes
          ? Object.values(item.attributes || item.variantAttributes || {}).filter(Boolean).join(' • ')
          : '';
        const skuText = [item.sku || '—', variantText].filter(Boolean).join(' • ');
        const quantity = Number(item.quantity || 0);
        const unitPrice = Number(item.unitPrice || item.price || 0);
        const lineTotal = Number(item.lineTotal || quantity * unitPrice);

        if (tableY > 650) {
          doc.addPage();
          drawHeader();
          tableY = 150;
          drawTableHeader(tableY);
          tableY += 22;
        }

        const rowHeight = variantText ? 28 : 18;
        doc.fillColor('#2d211d').font('Helvetica').fontSize(8);
        doc.text(itemName, 48, tableY, { width: 210, lineGap: 2 });
        doc.text(skuText || '—', 278, tableY, { width: 100, lineGap: 2 });
        doc.text(String(quantity), 390, tableY, { width: 30, align: 'left' });
        doc.text(money(unitPrice), 432, tableY, { width: 55, align: 'right' });
        doc.text(money(lineTotal), 495, tableY, { width: 55, align: 'right' });
        doc.moveTo(48, tableY + rowHeight + 4).lineTo(548, tableY + rowHeight + 4).strokeColor('#f0e6df').stroke();
        tableY += rowHeight + 12;
      }

      const summaryY = Math.max(tableY + 22, 610);
      doc.roundedRect(360, summaryY, 170, 102, 12).fillAndStroke('#f8f4ef', '#dcc9b9');
      doc.fillColor('#271910').font('Helvetica-Bold').fontSize(10).text('Payment Summary', 380, summaryY + 12);

      summary.forEach(([label, value], index) => {
        const rowY = summaryY + 30 + index * 16;
        doc.fillColor('#4d3a33').font('Helvetica').fontSize(8).text(label, 380, rowY);
        doc.fillColor('#201812').font('Helvetica-Bold').fontSize(8).text(money(value), 500, rowY, { align: 'right' });
      });

      const paymentStatus = invoice.paymentStatus || 'PENDING';
      const paymentMethod = invoice.paymentMethod || '—';
      const footerY = summaryY + 110;
      doc.fillColor('#54463d').font('Helvetica').fontSize(9).text(`Payment status: ${paymentStatus}`, 48, footerY);
      doc.fillColor('#54463d').font('Helvetica').fontSize(9).text(`Payment method: ${paymentMethod}`, 48, footerY + 14);
      doc.fillColor('#5e4d41').font('Helvetica').fontSize(9).text('Thank you for shopping with Rupakar.', 48, footerY + 36, { width: 250 });

      finalizePageNumbers();
      doc.end();
    });
  }
}

export const pdfService = new PdfService();
