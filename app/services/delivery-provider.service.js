import crypto from 'node:crypto';
import { env } from '../config/env.js';

export class MockDeliveryProvider {
  async createShipment({ shipmentNumber }) {
    const trackingNumber = `MOCK-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    return { shipmentNumber, trackingNumber, trackingUrl: `${env.FRONTEND_URL}/track/${trackingNumber}`, provider: 'mock' };
  }

  async schedulePickup() { return { scheduled: false, mode: 'mock' }; }
  async getTracking({ trackingNumber }) { return { trackingNumber, status: 'SHIPPED', events: [] }; }
  async getTrackingEvents({ trackingNumber }) { return this.getTracking({ trackingNumber }); }
  async cancelShipment({ trackingNumber }) { return { trackingNumber, cancelled: true }; }
  async getShippingLabel({ trackingNumber }) { return { trackingNumber, labelUrl: null }; }
}

export class DelhiveryProvider extends MockDeliveryProvider {
  async createShipment(payload) {
    if (!env.DELIVERY_API_URL || !env.DELIVERY_API_TOKEN) return super.createShipment(payload);
    throw new Error('Delhivery provider is configured but API integration is not enabled in this build');
  }
}

export const deliveryProvider = env.DELIVERY_MODE === 'delhivery' ? new DelhiveryProvider() : new MockDeliveryProvider();