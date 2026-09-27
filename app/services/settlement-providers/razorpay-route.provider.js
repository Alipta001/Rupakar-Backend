import Razorpay from 'razorpay';
import { env } from '../../config/env.js';

export class RazorpayRouteProvider {
  constructor() {
    this.keyId = env.RAZORPAY_KEY_ID || null;
    this.keySecret = env.RAZORPAY_KEY_SECRET || null;
    this.merchantAccountId = process.env.RAZORPAY_ACCOUNT_NUMBER || null;
    this.client = (this.keyId && this.keySecret)
      ? new Razorpay({ key_id: this.keyId, key_secret: this.keySecret })
      : null;
  }

  /**
   * Checks whether Razorpay Route marketplace transfer capability is configured.
   * Never reports true unless credentials exist.
   * @returns {boolean}
   */
  isConfigured() {
    const routeEnabled = env.RAZORPAY_ROUTE_ENABLED === 'true' || process.env.RAZORPAY_ROUTE_ENABLED === 'true';
    return Boolean(this.client && this.keyId && this.keySecret && (routeEnabled || Boolean(this.merchantAccountId)));
  }

  /**
   * Creates an external transfer to a vendor's linked Razorpay Route account.
   * If Route is not configured or vendor account ID is missing, safely returns configured: false
   * and leaves the payout in a READY state without inventing mock success or IDs.
   *
   * @param {Object} params
   * @param {string} params.destinationAccountId Vendor's Razorpay linked account ID (e.g. acc_xxx)
   * @param {number} params.amountPaise Exact amount in paise to transfer
   * @param {string} [params.paymentId] Razorpay captured payment ID (for direct payment transfer)
   * @param {string} [params.currency='INR']
   * @param {Object} [params.notes={}]
   * @param {string} params.idempotencyKey
   * @returns {Promise<Object>}
   */
  async createTransfer({ destinationAccountId, amountPaise, paymentId = null, currency = 'INR', notes = {}, idempotencyKey }) {
    if (!this.isConfigured()) {
      return {
        success: false,
        configured: false,
        status: 'READY',
        providerTransferId: null,
        error: 'Razorpay Route credentials are not configured in environment',
      };
    }

    if (!destinationAccountId) {
      return {
        success: false,
        configured: true,
        status: 'READY',
        providerTransferId: null,
        error: 'Vendor does not have a linked Razorpay Route account',
      };
    }

    const payload = {
      account: destinationAccountId,
      amount: Math.round(Number(amountPaise)),
      currency,
      notes,
    };

    try {
      let response;
      if (paymentId && this.client.payments?.transfer) {
        response = await this.client.payments.transfer(paymentId, {
          transfers: [payload],
        }, { 'X-Payout-Idempotency': idempotencyKey });
      } else if (this.client.transfers?.create) {
        response = await this.client.transfers.create(payload, {
          'X-Payout-Idempotency': idempotencyKey,
        });
      } else {
        return {
          success: false,
          configured: true,
          status: 'READY',
          providerTransferId: null,
          error: 'Razorpay Route transfer API method unavailable on client',
        };
      }

      const transfer = Array.isArray(response?.items) ? response.items[0] : response;
      return {
        success: true,
        configured: true,
        status: 'PAID',
        providerTransferId: transfer?.id || null,
        raw: transfer,
      };
    } catch (err) {
      console.error('[RAZORPAY_ROUTE_TRANSFER_ERROR]:', err?.message || err);
      return {
        success: false,
        configured: true,
        status: 'FAILED',
        providerTransferId: null,
        error: err?.error?.description || err?.message || 'Razorpay Route transfer execution failed',
      };
    }
  }

  /**
   * Retrieves transfer status from Razorpay Route.
   * @param {string} transferId
   * @returns {Promise<Object|null>}
   */
  async getTransfer(transferId) {
    if (!this.isConfigured() || !transferId) return null;
    try {
      return await this.client.transfers.fetch(transferId);
    } catch (err) {
      console.error('[RAZORPAY_ROUTE_FETCH_ERROR]:', err?.message || err);
      return null;
    }
  }

  /**
   * Reverses an existing Razorpay Route transfer.
   * @param {string} transferId
   * @param {Object} params
   * @param {number} [params.amountPaise]
   * @param {Object} [params.notes]
   * @returns {Promise<Object>}
   */
  async reverseTransfer(transferId, { amountPaise = null, notes = {} } = {}) {
    if (!this.isConfigured() || !transferId) {
      return { success: false, error: 'Provider unconfigured or transferId missing' };
    }
    try {
      const data = {};
      if (amountPaise) data.amount = Math.round(Number(amountPaise));
      if (notes) data.notes = notes;
      const result = await this.client.transfers.reverse(transferId, data);
      return { success: true, result };
    } catch (err) {
      console.error('[RAZORPAY_ROUTE_REVERSAL_ERROR]:', err?.message || err);
      return {
        success: false,
        error: err?.error?.description || err?.message || 'Transfer reversal failed',
      };
    }
  }
}

export const razorpayRouteProvider = new RazorpayRouteProvider();
