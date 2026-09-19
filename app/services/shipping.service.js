import { Shipment } from '../models/shipment.model.js';
import { AppError } from '../utils/app-error.js';
import { env } from '../config/env.js';

export class ShippingService {
  calculateShipping({ subtotal = 0, items = [], shippingAddress = null }) {
    if (!env.SHIPPING_ENABLED) {
      return {
        amount: 0,
        currency: 'INR',
        method: 'disabled',
      };
    }

    const itemCount = Array.isArray(items) ? items.length : 0;
    const safeSubtotal = Number(subtotal) || 0;

    let amount = env.SHIPPING_BASE_FEE;
    if (itemCount > 2) amount += env.SHIPPING_EXTRA_ITEM_FEE;
    if (safeSubtotal >= env.FREE_SHIPPING_THRESHOLD) amount = 0;
    if (shippingAddress && shippingAddress.state && /west bengal|wb/i.test(shippingAddress.state)) {
      amount = Math.max(0, amount - env.WEST_BENGAL_SHIPPING_DISCOUNT);
    }

    return {
      amount: Math.max(0, amount),
      currency: 'INR',
      method: 'standard',
    };
  }

  async createShipment({ orderId, vendorOrderId, vendorId, customerId, shippingMethod = 'standard', carrier = 'mock-carrier', provider = 'mock-provider', metadata = {} }) {
    if (!orderId || !vendorOrderId || !vendorId || !customerId) {
      throw new AppError(400, 'INVALID_SHIPMENT', 'Shipment payload is incomplete');
    }

    const existing = await Shipment.findOne({ vendorOrderId, status: { $in: ['PENDING', 'READY_TO_SHIP', 'PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] } });
    if (existing) {
      return existing.toObject ? existing.toObject() : existing;
    }

    const shipment = await Shipment.create({
      orderId,
      vendorOrderId,
      vendorId,
      customerId,
      shipmentNumber: `SHIP-${Date.now().toString(36).toUpperCase()}`,
      carrier,
      provider,
      trackingNumber: `TRK-${Date.now().toString(36).toUpperCase()}`,
      trackingUrl: `https://mock-tracking.local/tracking/${Date.now().toString(36)}`,
      shippingMethod,
      status: 'PENDING',
      metadata,
    });

    return shipment.toObject ? shipment.toObject() : shipment;
  }

  async getTracking(shipmentId) {
    return {
      shipmentId,
      status: 'PENDING',
      trackingNumber: `TRK-${String(shipmentId).slice(-6)}`,
      trackingUrl: `https://mock-tracking.local/tracking/${shipmentId}`,
    };
  }

  async cancelShipment({ shipmentId }) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) {
      throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
    }

    shipment.status = 'CANCELLED';
    await shipment.save();
    return shipment.toObject ? shipment.toObject() : shipment;
  }
}

export const shippingService = new ShippingService();
