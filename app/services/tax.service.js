import { AppError } from '../utils/app-error.js';

const DEFAULT_GST_RATE = 5;
const GST_RATE_BY_CODE = {
  GST_5: 5,
  GST_12: 12,
  GST_18: 18,
  GST_28: 28,
};

export class TaxService {
  getRateForProduct(product = {}) {
    const taxMeta = product?.tax ?? {};
    if (taxMeta.taxable === false) return 0;
    const code = String(taxMeta.taxCode || '').toUpperCase();
    const mapped = GST_RATE_BY_CODE[code] ?? DEFAULT_GST_RATE;
    return Number(mapped) || 0;
  }

  calculateTax({ subtotal = 0, items = [], product = null }) {
    const safeSubtotal = Number(subtotal) || 0;
    if (safeSubtotal <= 0) {
      return { amount: 0, rate: 0, currency: 'INR', method: 'GST' };
    }

    if (product) {
      const rate = this.getRateForProduct(product);
      if (rate <= 0) {
        return { amount: 0, rate: 0, currency: 'INR', method: 'GST' };
      }
      const amount = Math.round((safeSubtotal * rate) / 100);
      return { amount, rate, currency: 'INR', method: 'GST' };
    }

    const rate = items.reduce((sum, item) => {
      const candidate = item?.product?.tax ?? {};
      if (candidate.taxable === false) return sum;
      const itemRate = this.getRateForProduct({ tax: candidate });
      return sum + itemRate;
    }, 0) / Math.max(items.length, 1);

    const amount = Math.round((safeSubtotal * rate) / 100);
    return { amount, rate: Number(rate.toFixed(2)), currency: 'INR', method: 'GST' };
  }

  calculateOrderTax({ subtotal = 0, items = [] }) {
    if (!Array.isArray(items) || items.length === 0) {
      return { amount: 0, rate: 0, currency: 'INR', method: 'GST' };
    }

    const rate = items.reduce((sum, item) => {
      const product = item?.product ?? {};
      if (product.tax && product.tax.taxable === false) return sum;
      return sum + this.getRateForProduct(product);
    }, 0) / items.length;

    const amount = Math.round((Number(subtotal || 0) * rate) / 100);
    return { amount: Math.max(0, amount), rate: Number(rate.toFixed(2)), currency: 'INR', method: 'GST' };
  }
}

export const taxService = new TaxService();
