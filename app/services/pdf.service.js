import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { AppError } from '../utils/app-error.js';

const NAVY = '#16263d';
const GREEN = '#2f6f5c';
const GREEN_SOFT = '#edf7f2';
const TEXT = '#1d2a39';
const MUTED = '#5f6b7a';
const LINE = '#e7edf3';
const CARD = '#ffffff';

// Fix 1: Replace ₹ (U+20B9, outside WinAnsi / Helvetica codepage) with ASCII "INR " prefix.
const money = (value) => `INR ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const safeText = (value, fallback = '—') => (value === undefined || value === null || value === '' ? fallback : String(value));
const formatShortDate = (value) => new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const formatStamp = (value) => new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// A4 usable height in PDFKit points: 841.89 pt total, 36 pt top + 36 pt bottom margins.
const PAGE_MARGIN = 36;
const TOTALS_BLOCK_HEIGHT = 118; // height of the order-totals rounded-rect + labels

export class PdfService {
  async getLogoBuffer() {
    try {
      const fs = await import('node:fs/promises');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      return await fs.readFile(path.join(__dirname, '..', '..', 'public', 'Rupakar-logo.jpeg'));
    } catch {
      return null;
    }
  }

  async generatePackingSlipPdf({ packingSlipNumber, order, vendorOrder, vendor, shipment }) {
    if (!packingSlipNumber || !order || !vendorOrder) throw new AppError(400, 'INVALID_PACKING_SLIP_DATA', 'Packing slip data is required');

    const logoBuffer = await this.getLogoBuffer();

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', bufferPages: true, compress: false, margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN } });
      const chunks = [];
      const address = order.shippingAddressSnapshot || {};
      const items = Array.isArray(vendorOrder.items) ? vendorOrder.items : [];
      const pageHeight = doc.page.height;
      const left = PAGE_MARGIN;
      const right = doc.page.width - PAGE_MARGIN;
      const innerWidth = right - left; // 595.28 - 72 = 523.28 pt

      // Fix 2 (packing slip): header right-side text anchored with explicit width so long
      // slip/order IDs never escape the navy bar or the page boundary.
      const HEADER_RIGHT_WIDTH = 160;
      const HEADER_RIGHT_X = right - HEADER_RIGHT_WIDTH;

      const drawHeader = () => {
        const headerTop = PAGE_MARGIN;
        doc.fillColor(NAVY).rect(left, headerTop, innerWidth, 56).fill();
        if (logoBuffer) {
          doc.image(logoBuffer, left + 18, headerTop + 12, { fit: [30, 30], align: 'left' });
        }
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('RUPAKAR', left + 58, headerTop + 12);
        doc.fillColor('#dfeaf2').font('Helvetica').fontSize(8).text('ARTISAN MARKETPLACE', left + 58, headerTop + 32);
        // Fix 2: bounded width + ellipsis prevents bleed past right margin
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text('PACKING SLIP', HEADER_RIGHT_X, headerTop + 8, { align: 'right', width: HEADER_RIGHT_WIDTH });
        doc.fillColor('#dfeaf2').font('Helvetica').fontSize(8).text(`Slip ${packingSlipNumber}`, HEADER_RIGHT_X, headerTop + 28, { align: 'right', width: HEADER_RIGHT_WIDTH, ellipsis: true });
        doc.fillColor('#dfeaf2').font('Helvetica').fontSize(8).text(`Order ${safeText(order.orderNumber || order._id, 'N/A')}`, HEADER_RIGHT_X, headerTop + 40, { align: 'right', width: HEADER_RIGHT_WIDTH, ellipsis: true });
      };

      const drawInfoRow = (yPos) => {
        const cardWidth = (innerWidth - 12) / 2;
        const base = 90;
        const packedBy = shipment?.packedBy || 'Warehouse team';
        const shippingMethod = order.shippingMethod || vendorOrder.shippingMethod || shipment?.shippingMethod || 'Standard';
        const dateValue = order.createdAt || order.orderedAt || vendorOrder.createdAt || new Date();

        doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(left, yPos, cardWidth, base, 8).fillAndStroke();
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('ORDER', left + 14, yPos + 10);
        doc.fillColor(TEXT).font('Helvetica').fontSize(8.5).text(`No: ${safeText(order.orderNumber || order._id, 'N/A')}`, left + 14, yPos + 24, { width: cardWidth - 24, ellipsis: true });
        doc.text(`Vendor order: ${safeText(vendorOrder.vendorOrderNumber || vendorOrder._id, 'N/A')}`, left + 14, yPos + 36, { width: cardWidth - 24, ellipsis: true });
        doc.text(`Date: ${formatShortDate(dateValue)}`, left + 14, yPos + 48, { width: cardWidth - 24 });

        doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(left + cardWidth + 12, yPos, cardWidth, base, 8).fillAndStroke();
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('FULFILMENT', left + cardWidth + 26, yPos + 10);
        doc.fillColor(TEXT).font('Helvetica').fontSize(8.5).text(`Shipping: ${safeText(shippingMethod)}`, left + cardWidth + 26, yPos + 24, { width: cardWidth - 30, ellipsis: true });
        doc.text(`Tracking: ${safeText(shipment?.trackingNumber || shipment?.carrierTrackingNumber || 'Not assigned')}`, left + cardWidth + 26, yPos + 36, { width: cardWidth - 30, ellipsis: true });
        doc.text(`Packed by: ${packedBy}`, left + cardWidth + 26, yPos + 48, { width: cardWidth - 30, ellipsis: true });
      };

      const drawAddressCards = (yPos) => {
        const cardWidth = (innerWidth - 12) / 2;
        const ship = [address.name, address.phone, address.line1, address.line2, [address.city, address.state, address.postalCode].filter(Boolean).join(' '), address.country].filter(Boolean);
        const vendorName = vendor?.businessName || vendor?.legalName || 'Rupakar Marketplace';
        const vendorInfo = [vendorName, vendor?.address || 'Vendor address unavailable', vendor?.email || '', vendor?.phone || ''];

        doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(left, yPos, cardWidth, 90, 8).fillAndStroke();
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('SHIP TO', left + 14, yPos + 10);
        doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
        ship.forEach((line, index) => doc.text(line, left + 14, yPos + 28 + index * 12, { width: cardWidth - 24, ellipsis: true }));

        doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(left + cardWidth + 12, yPos, cardWidth, 90, 8).fillAndStroke();
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('VENDOR', left + cardWidth + 26, yPos + 10);
        doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
        vendorInfo.filter(Boolean).forEach((line, index) => doc.text(line, left + cardWidth + 26, yPos + 28 + index * 12, { width: cardWidth - 30, ellipsis: true }));
      };

      // Fix 4: Column layout for the packing-slip table.
      // Total inner width = 523 pt. Column widths must sum to <= 523.
      // #    x=left+8   w=215   ITEM
      // SKU  x=left+231 w=148   SKU / VARIANT
      // QTY  x=left+387 w=36    QTY
      // WGT  x=left+431 w=44    WEIGHT
      // RMK  x=left+483 w=right-(left+483)=40  REMARKS
      const COL = {
        name:    { x: left + 8,   w: 215 },
        sku:     { x: left + 231, w: 148 },
        qty:     { x: left + 387, w: 36  },
        weight:  { x: left + 431, w: 44  },
        remarks: { x: left + 483, w: right - (left + 483) }, // ~40 pt
      };

      const drawTableHeader = (yPos) => {
        doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(8);
        doc.text('ITEM',        COL.name.x,    yPos, { width: COL.name.w    });
        doc.text('SKU / VARIANT', COL.sku.x,   yPos, { width: COL.sku.w     });
        doc.text('QTY',         COL.qty.x,     yPos, { width: COL.qty.w     });
        doc.text('WEIGHT',      COL.weight.x,  yPos, { width: COL.weight.w  });
        doc.text('REMARKS',     COL.remarks.x, yPos, { width: COL.remarks.w, align: 'right' });
        doc.moveTo(left, yPos + 14).lineTo(right, yPos + 14).strokeColor(LINE).stroke();
      };

      const drawFooter = (pageIndex, totalPages) => {
        // Stay 10 pt above the bottom margin so text never triggers continueOnNewPage.
        const footerY = pageHeight - PAGE_MARGIN - 10;
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Rupakar • hello@rupakar.com • @rupakar.in', left, footerY, { width: 260, lineBreak: false });
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`Page ${pageIndex + 1} of ${totalPages}`, right - 90, footerY, { align: 'right', width: 90, lineBreak: false });
      };

      const finalizePages = () => {
        const range = doc.bufferedPageRange();
        const totalPages = range.count;
        for (let i = range.start; i < totalPages; i += 1) {
          doc.switchToPage(i);
          drawFooter(i, totalPages);
        }
      };

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve({ content: Buffer.concat(chunks), filename: `packing-slip-${packingSlipNumber}.pdf`, contentType: 'application/pdf' }));

      doc.info.Title = `Rupakar Packing Slip ${packingSlipNumber}`;
      doc.info.Author = 'Rupakar';
      doc.info.Subject = `Order ${order.orderNumber || order._id}`;

      drawHeader();
      drawInfoRow(106);
      drawAddressCards(206);

      // Item table starts just below the address cards (206 + 90 + 10 = 306)
      let tableY = 306;
      drawTableHeader(tableY);
      tableY += 20;

      // pageLimit: leave room for footer (22 pt) + summary cards section
      const SUMMARY_HEIGHT = 48; // summary cards height
      const NOTES_HEIGHT   = 80; // notes + stamp block
      const SIG_HEIGHT     = 70; // signature block
      const BOTTOM_RESERVE = SUMMARY_HEIGHT + NOTES_HEIGHT + SIG_HEIGHT + 36;
      const pageLimit = pageHeight - BOTTOM_RESERVE;

      for (const item of items) {
        const name    = item.productName || 'Product';
        const variant = item.variantName || Object.values(item.productSnapshot?.attributes || {}).filter(Boolean).join(' • ') || item.variant || 'Standard';
        const sku     = item.sku || '—';
        const qty     = Number(item.quantity || 0);
        const weight  = item.weight || item.productWeight || shipment?.weight || '—';

        // Measure actual text heights inside each column to get a true row height
        doc.font('Helvetica').fontSize(8.5);
        const nameH    = doc.heightOfString(name,                           { width: COL.name.w,    lineGap: 2 });
        const skuH     = doc.heightOfString(`${sku} / ${variant}`,          { width: COL.sku.w,     lineGap: 2 });
        const rowHeight = Math.max(20, nameH, skuH);

        if (tableY + rowHeight > pageLimit) {
          doc.addPage();
          drawHeader();
          drawInfoRow(106);
          drawAddressCards(206);
          tableY = 306;
          drawTableHeader(tableY);
          tableY += 20;
        }

        // Fix 4: Every column gets explicit width + ellipsis
        doc.fillColor(TEXT).font('Helvetica').fontSize(8.5);
        doc.text(name,                                          COL.name.x,    tableY + 4, { width: COL.name.w,    lineGap: 2, ellipsis: true });
        doc.text(`${sku} / ${variant}`,                         COL.sku.x,     tableY + 4, { width: COL.sku.w,     lineGap: 2, ellipsis: true });
        doc.text(String(qty),                                   COL.qty.x,     tableY + 4, { width: COL.qty.w     });
        doc.text(String(weight),                                COL.weight.x,  tableY + 4, { width: COL.weight.w  });
        doc.text(safeText(item.notes || item.remarks || 'Ready for dispatch'), COL.remarks.x, tableY + 4, { width: COL.remarks.w, align: 'right', ellipsis: true });

        doc.moveTo(left, tableY + rowHeight + 2).lineTo(right, tableY + rowHeight + 2).strokeColor(LINE).stroke();
        tableY += rowHeight + 6;
      }

      // Fix 5: Summary cards drawn AFTER items at the actual bottom of the table, not at a
      // fixed Y=308 that could collide with dynamic row growth.
      const summaryY = tableY + 10;
      const summaryCards = [
        { label: 'Total items', value: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) },
        { label: 'Weight',      value: `${safeText(vendorOrder.totalWeight || shipment?.weight || '—')}${vendorOrder.totalWeight || shipment?.weight ? ' kg' : ''}` },
        { label: 'Method',      value: safeText(order.shippingMethod || vendorOrder.shippingMethod || shipment?.shippingMethod || 'Standard') },
      ];
      summaryCards.forEach((entry, index) => {
        const x = left + (index * 190);
        doc.fillColor(GREEN_SOFT).strokeColor(LINE).lineWidth(1).roundedRect(x, summaryY, 170, SUMMARY_HEIGHT, 6).fillAndStroke();
        doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(entry.label, x + 10, summaryY + 8);
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text(String(entry.value), x + 10, summaryY + 18, { width: 150 });
      });

      const notesY = summaryY + SUMMARY_HEIGHT + 14;
      doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(left, notesY, innerWidth * 0.7, 48, 8).fillAndStroke();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('SPECIAL INSTRUCTIONS', left + 12, notesY + 10);
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.4).text('Verify item count and packaging quality before sealing. Payment details are intentionally omitted on this packing document.', left + 12, notesY + 24, { width: innerWidth * 0.66 });

      const stampY = notesY;
      doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(left + innerWidth * 0.72 + 12, stampY, innerWidth * 0.28 - 12, 48, 8).fillAndStroke();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('PACKING CONFIRMATION', left + innerWidth * 0.72 + 20, stampY + 10);
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.4).text('Packed and verified', left + innerWidth * 0.72 + 20, stampY + 24);

      const signatureY = notesY + 62;
      doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(left, signatureY, innerWidth / 2 - 6, 56, 8).fillAndStroke();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('PACKED BY', left + 14, signatureY + 10);
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5).text(safeText(shipment?.packedBy || 'Warehouse team'), left + 14, signatureY + 24, { width: innerWidth / 2 - 26 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(safeText(formatStamp(new Date()), '—'), left + 14, signatureY + 38, { width: innerWidth / 2 - 26 });

      doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(left + innerWidth / 2 + 6, signatureY, innerWidth / 2 - 6, 56, 8).fillAndStroke();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('SIGNATURE', left + innerWidth / 2 + 20, signatureY + 10);
      doc.moveTo(left + innerWidth / 2 + 20, signatureY + 36).lineTo(left + innerWidth - 20, signatureY + 36).strokeColor('#bcc8d3').stroke();
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Authorized by', left + innerWidth / 2 + 20, signatureY + 40, { width: innerWidth / 2 - 30 });

      finalizePages();
      doc.end();
    });
  }

  async generateInvoicePdf(invoice) {
    if (!invoice?.invoiceNumber || !Array.isArray(invoice.items)) throw new AppError(400, 'INVALID_PDF_DATA', 'Invoice data is required');

    const logoBuffer = await this.getLogoBuffer();

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', bufferPages: true, compress: false, margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN } });
      const chunks = [];
      const items = invoice.items || [];
      const addressLine = (address = {}) => [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ');
      const subtotal = Number(invoice.subtotal || 0);
      const discount = Number(invoice.discount || 0);
      const tax      = Number(invoice.tax      || 0);
      const shipping = Number(invoice.shipping  || 0);
      const total    = Number(invoice.total     || subtotal + tax + shipping - discount);
      const summaryLines = [
        ['Subtotal',    subtotal],
        ['Discount',   -discount],
        ['Shipping',    shipping],
        ['Tax',         tax],
        ['Grand Total', total],
      ];
      const left       = PAGE_MARGIN;
      const right      = doc.page.width - PAGE_MARGIN;
      const innerWidth = right - left;

      // Extract vendor/business name only from existing available data (never hardcoded)
      const resolveVendorName = (inv) => {
        const v = inv.vendorSnapshot || inv.vendor || {};
        const name = v.businessName || v.storeName || v.name || v.legalName || inv.vendorName;
        if (name && typeof name === 'string' && name.trim()) return name.trim();
        if (Array.isArray(inv.items)) {
          for (const it of inv.items) {
            const itName = it.vendorName || it.vendor?.businessName || it.vendor?.storeName || it.vendor?.name;
            if (itName && typeof itName === 'string' && itName.trim()) return itName.trim();
          }
        }
        return '';
      };

      const HEADER_RIGHT_WIDTH = 160;
      const HEADER_RIGHT_X     = right - HEADER_RIGHT_WIDTH;
      const headerTop          = PAGE_MARGIN;

      const drawHeader = () => {
        doc.fillColor(NAVY).rect(left, headerTop, innerWidth, 62).fill();
        if (logoBuffer) {
          doc.image(logoBuffer, left + 18, headerTop + 12, { fit: [28, 28] });
        }
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19).text('RUPAKAR', left + 58, headerTop + 12);
        doc.fillColor('#dfeaf2').font('Helvetica').fontSize(8).text('ARTISAN MARKETPLACE', left + 58, headerTop + 32);
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', HEADER_RIGHT_X, headerTop + 12, { align: 'right', width: HEADER_RIGHT_WIDTH });
        doc.fillColor('#dfeaf2').font('Helvetica').fontSize(8).text(`Invoice ${safeText(invoice.invoiceNumber)}`, HEADER_RIGHT_X, headerTop + 32, { align: 'right', width: HEADER_RIGHT_WIDTH, ellipsis: true });
        doc.fillColor('#dfeaf2').font('Helvetica').fontSize(8).text(`Order ${safeText(invoice.orderNumber || invoice.orderId || 'N/A')}`, HEADER_RIGHT_X, headerTop + 44, { align: 'right', width: HEADER_RIGHT_WIDTH, ellipsis: true });
      };

      const drawCard = (x, y, width, height, title, contentRenderer) => {
        doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(x, y, width, height, 7).fillAndStroke();
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5).text(title, x + 10, y + 9);
        if (typeof contentRenderer === 'function') {
          contentRenderer(x + 10, y + 25, width - 20);
        }
      };

      const drawSummaryGrid = (yPos) => {
        const cols = [
          { label: 'ORDER DATE', value: formatShortDate(invoice.issuedAt || Date.now()) },
          { label: 'PAYMENT',    value: safeText(invoice.paymentMethod  || '—')          },
          { label: 'SHIPPING',   value: safeText(invoice.shippingMethod || 'Standard')   },
          { label: 'CURRENCY',   value: safeText(invoice.currency       || 'INR')        },
        ];
        const gap = 8;
        const cardW = (innerWidth - gap * 3) / 4;
        cols.forEach((column, index) => {
          const x = left + index * (cardW + gap);
          doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(x, yPos, cardW, 38, 7).fillAndStroke();
          doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(column.label, x + 8, yPos + 7);
          doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5).text(column.value, x + 8, yPos + 20, { width: cardW - 16, ellipsis: true });
        });
      };

      const COL = {
        num:        { x: left + 6,   w: 18,  align: 'left',  label: '#' },
        product:    { x: left + 28,  w: 162, align: 'left',  label: 'PRODUCT' },
        skuVariant: { x: left + 194, w: 120, align: 'left',  label: 'SKU / VARIANT' },
        qty:        { x: left + 318, w: 32,  align: 'right', label: 'QTY' },
        unitPrice:  { x: left + 354, w: 78,  align: 'right', label: 'UNIT PRICE' },
        amount:     { x: left + 436, w: right - (left + 436) - 4, align: 'right', label: 'AMOUNT' },
      };

      const drawTableHeader = (yPos) => {
        doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5);
        Object.values(COL).forEach((col) => {
          doc.text(col.label, col.x, yPos, { width: col.w, align: col.align });
        });
        doc.moveTo(left, yPos + 12).lineTo(right, yPos + 12).strokeColor(LINE).stroke();
      };

      const drawPageFooter = (pageIndex, totalPages) => {
        const footerY = doc.page.height - PAGE_MARGIN - 10;
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Rupakar Support • hello@rupakar.com', left, footerY, { width: 300, lineBreak: false });
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`Page ${pageIndex + 1} of ${totalPages}`, right - 90, footerY, { align: 'right', width: 90, lineBreak: false });
      };

      const finalizePages = () => {
        const range = doc.bufferedPageRange();
        const totalPages = range.count;
        for (let i = range.start; i < totalPages; i += 1) {
          doc.switchToPage(i);
          drawPageFooter(i, totalPages);
        }
      };

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve({ content: Buffer.concat(chunks), filename: `invoice-${invoice.invoiceNumber}.pdf`, contentType: 'application/pdf' }));

      doc.info.Title = `Rupakar Invoice ${invoice.invoiceNumber}`;
      doc.info.Author = 'Rupakar';
      doc.info.Subject = `Order ${invoice.orderId || invoice.orderNumber || 'N/A'}`;

      drawHeader();

      // Layout: 3 cards for SELLER (vendor name only), BILL TO, and SHIP TO
      const cardGap = 10;
      const cardWidth = Math.floor((innerWidth - 2 * cardGap) / 3);

      const vendorName = resolveVendorName(invoice);

      // Card 1: Seller / Vendor - vendor/business name ONLY (no email, phone, address, bank, ID, GST/PAN)
      drawCard(left, 104, cardWidth, 84, 'SELLER', (cx, cy, cw) => {
        if (vendorName) {
          doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5).text(vendorName, cx, cy, { width: cw, lineGap: 2 });
        } else {
          doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text('—', cx, cy, { width: cw });
        }
      });

      // Card 2: Customer / Bill To
      drawCard(left + cardWidth + cardGap, 104, cardWidth, 84, 'BILL TO', (cx, cy, cw) => {
        const customerName = invoice.customerSnapshot?.name || invoice.customerSnapshot?.fullName || 'Customer';
        const customerEmail = invoice.customerSnapshot?.email || '';
        const billingAddress = addressLine(invoice.billingAddressSnapshot || {});
        doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5).text(customerName, cx, cy, { width: cw, lineGap: 1.5, ellipsis: true });
        let nextY = cy + doc.heightOfString(customerName, { width: cw, lineGap: 1.5 }) + 2;
        doc.font('Helvetica').fontSize(8);
        if (customerEmail && nextY < cy + 50) {
          doc.fillColor(MUTED).text(customerEmail, cx, nextY, { width: cw, ellipsis: true });
          nextY += 11;
        }
        if (billingAddress && nextY < cy + 55) {
          doc.fillColor(TEXT).text(billingAddress, cx, nextY, { width: cw, height: cy + 56 - nextY, lineGap: 1.5, ellipsis: true });
        }
      });

      // Card 3: Ship To
      drawCard(left + (cardWidth + cardGap) * 2, 104, cardWidth, 84, 'SHIP TO', (cx, cy, cw) => {
        const shipName = invoice.shippingAddressSnapshot?.name || invoice.customerSnapshot?.name || 'Recipient';
        const shipAddress = addressLine(invoice.shippingAddressSnapshot || {});
        const shipPhone = invoice.shippingAddressSnapshot?.phone || '';
        doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8.5).text(shipName, cx, cy, { width: cw, lineGap: 1.5, ellipsis: true });
        let nextY = cy + doc.heightOfString(shipName, { width: cw, lineGap: 1.5 }) + 2;
        doc.font('Helvetica').fontSize(8);
        if (shipPhone && nextY < cy + 50) {
          doc.fillColor(MUTED).text(`Phone: ${shipPhone}`, cx, nextY, { width: cw, ellipsis: true });
          nextY += 11;
        }
        if (shipAddress && nextY < cy + 55) {
          doc.fillColor(TEXT).text(shipAddress, cx, nextY, { width: cw, height: cy + 56 - nextY, lineGap: 1.5, ellipsis: true });
        }
      });

      drawSummaryGrid(196);

      let y = 246;
      drawTableHeader(y);
      y += 18;

      const MAX_PAGE_Y = doc.page.height - PAGE_MARGIN - 25;

      items.forEach((item, index) => {
        const lineTotal = Number(item.lineTotal != null ? item.lineTotal : (item.unitPrice || 0) * (item.quantity || 1));
        const variation = item.variantName || item.variant || Object.values(item.attributes || item.variantAttributes || {}).filter(Boolean).join(' • ') || 'Standard';
        const productText = safeText(item.productName || 'Product');
        const skuText = safeText(item.sku || '—');
        const skuVariantText = variation && variation !== 'Standard' ? `${skuText} / ${variation}` : skuText;

        doc.font('Helvetica').fontSize(8.2);
        const productHeight = doc.heightOfString(productText, { width: COL.product.w, lineGap: 1.5 });
        const skuVariantHeight = doc.heightOfString(skuVariantText, { width: COL.skuVariant.w, lineGap: 1.5 });
        const rowContentHeight = Math.max(14, productHeight, skuVariantHeight);
        const rowHeight = rowContentHeight + 8;

        if (y + rowHeight > MAX_PAGE_Y) {
          doc.addPage();
          drawHeader();
          y = 104;
          drawTableHeader(y);
          y += 18;
        }

        doc.fillColor(TEXT).font('Helvetica').fontSize(8.2);
        doc.text(String(index + 1), COL.num.x, y + 4, { width: COL.num.w, align: COL.num.align });
        doc.text(productText, COL.product.x, y + 4, { width: COL.product.w, lineGap: 1.5 });
        doc.text(skuVariantText, COL.skuVariant.x, y + 4, { width: COL.skuVariant.w, lineGap: 1.5 });
        doc.text(String(Number(item.quantity || 0)), COL.qty.x, y + 4, { width: COL.qty.w, align: 'right', lineBreak: false });
        doc.text(money(Number(item.unitPrice || 0)), COL.unitPrice.x, y + 4, { width: COL.unitPrice.w, align: 'right', lineBreak: false });
        doc.text(money(lineTotal), COL.amount.x, y + 4, { width: COL.amount.w, align: 'right', lineBreak: false });

        doc.moveTo(left, y + rowHeight + 2).lineTo(right, y + rowHeight + 2).strokeColor(LINE).stroke();
        y += rowHeight + 6;
      });

      let totalsY = y + 14;
      if (totalsY + TOTALS_BLOCK_HEIGHT > MAX_PAGE_Y) {
        doc.addPage();
        drawHeader();
        totalsY = 104;
      }

      const totalsCardW = 224;
      const totalsCardX = right - totalsCardW;

      doc.fillColor(CARD).strokeColor(LINE).lineWidth(1).roundedRect(totalsCardX, totalsY, totalsCardW, TOTALS_BLOCK_HEIGHT, 8).fillAndStroke();
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('ORDER TOTALS', totalsCardX + 14, totalsY + 10);

      summaryLines.forEach(([label, value], index) => {
        const rowY = totalsY + 28 + index * 16;
        const isGrandTotal = label === 'Grand Total';
        doc.font(isGrandTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(isGrandTotal ? 8.5 : 8.2);
        doc.fillColor(isGrandTotal ? NAVY : TEXT);
        doc.text(label, totalsCardX + 14, rowY, { width: 95 });
        doc.text(money(value), totalsCardX + 110, rowY, { align: 'right', width: 100, lineBreak: false });
      });

      const notesWidth = totalsCardX - left - 18;
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5).text(`Payment status: ${safeText(invoice.paymentStatus || 'PENDING')}`, left, totalsY + 12, { width: notesWidth });
      doc.text(`Payment method: ${safeText(invoice.paymentMethod || '—')}`, left, totalsY + 26, { width: notesWidth });
      doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(9).text('Thank you for shopping with Rupakar.', left, totalsY + 54, { width: notesWidth });

      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8).text('Notes', left, totalsY + 74);
      doc.font('Helvetica').fontSize(7.5).text('This invoice is generated for the purchase and is intended for order confirmation. Please retain it for reference.', left, totalsY + 86, { width: notesWidth, lineGap: 1.5 });

      finalizePages();
      doc.end();
    });
  }
}

export const pdfService = new PdfService();
