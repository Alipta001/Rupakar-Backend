import { AppError } from '../utils/app-error.js';

export class PdfService {
  async generateInvoicePdf({ invoiceNumber, items, subtotal, tax, shipping, total, customerSnapshot, billingAddressSnapshot }) {
    if (!invoiceNumber || !items) {
      throw new AppError(400, 'INVALID_PDF_DATA', 'Invoice data is required');
    }

    const htmlContent = this.buildInvoiceHtml({
      invoiceNumber,
      items,
      subtotal,
      tax,
      shipping,
      total,
      customerSnapshot,
      billingAddressSnapshot,
    });

    return {
      content: htmlContent,
      filename: `invoice-${invoiceNumber}.pdf`,
    };
  }

  buildInvoiceHtml({ invoiceNumber, items, subtotal, tax, shipping, total, customerSnapshot, billingAddressSnapshot }) {
    const itemsHtml = items
      .map(
        (item) => `
      <tr>
        <td>${item.productName}</td>
        <td>${item.quantity}</td>
        <td>₹${item.unitPrice}</td>
        <td>₹${item.lineTotal}</td>
      </tr>
    `,
      )
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .total { font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Invoice ${invoiceNumber}</h1>
        <h3>Bill To:</h3>
        <p>${customerSnapshot?.name || 'Customer'}</p>
        <p>${billingAddressSnapshot?.street || ''}</p>
        <p>${billingAddressSnapshot?.city || ''} ${billingAddressSnapshot?.state || ''}</p>
        
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
            <tr class="total">
              <td colspan="3">Subtotal:</td>
              <td>₹${subtotal}</td>
            </tr>
            <tr>
              <td colspan="3">Tax:</td>
              <td>₹${tax}</td>
            </tr>
            <tr>
              <td colspan="3">Shipping:</td>
              <td>₹${shipping}</td>
            </tr>
            <tr class="total">
              <td colspan="3">Total:</td>
              <td>₹${total}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;
  }
}

export const pdfService = new PdfService();
