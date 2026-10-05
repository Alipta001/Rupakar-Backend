import { Shipment } from '../models/shipment.model.js';
import { AppError } from '../utils/app-error.js';
import { env } from '../config/env.js';
import { deliveryProvider } from './delivery-provider.service.js';

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

  async determineBestShippingOption({ pickupAddress = {}, deliveryAddress = {}, packageInfo = {}, cod = false } = {}) {
    const pickupPincode = pickupAddress?.postalCode || pickupAddress?.pincode || '700001';
    const deliveryPincode = deliveryAddress?.postalCode || deliveryAddress?.pincode || '700001';
    const weight = Number(packageInfo?.weight) || 0.5;

    try {
      const rates = await deliveryProvider.getShippingRates({
        pickupPincode,
        deliveryPincode,
        weight,
        dimensions: packageInfo,
        cod,
      });

      if (Array.isArray(rates) && rates.length > 0) {
        // Preferred: recommended option, otherwise lowest cost
        const recommended = rates.find((r) => r.recommended) || rates.reduce((best, curr) => (curr.cost < best.cost ? curr : best), rates[0]);
        return {
          provider: recommended.provider || env.DELIVERY_PROVIDER || 'mock',
          carrier: recommended.carrier || 'Rupakar Express Logistics',
          serviceCode: recommended.serviceCode || 'standard_surface',
          serviceName: recommended.serviceName || 'Standard Express',
          cost: recommended.cost || 0,
          currency: recommended.currency || 'INR',
          estimatedDays: recommended.estimatedDays || 3,
        };
      }
    } catch (err) {
      // Fallback to sensible standard defaults if rates API fails
    }

    return {
      provider: env.DELIVERY_PROVIDER || 'mock',
      carrier: 'Rupakar Express Logistics',
      serviceCode: 'standard_surface',
      serviceName: 'Express Surface Logistics',
      cost: 50,
      currency: 'INR',
      estimatedDays: 3,
    };
  }

  async createShipment({
    orderId,
    vendorOrderId,
    vendorId,
    customerId,
    pickupAddress = {},
    deliveryAddress = {},
    packageInfo = {},
    shippingMethod,
    carrier,
    provider,
    cod = false,
    orderNumber,
    items = [],
    metadata = {},
  }) {
    if (!orderId || !vendorOrderId || !vendorId || !customerId) {
      throw new AppError(400, 'INVALID_SHIPMENT', 'Shipment payload is incomplete');
    }

    const existing = await Shipment.findOne({
      vendorOrderId,
      status: {
        $in: [
          'PENDING',
          'CREATED',
          'LABEL_GENERATED',
          'READY_TO_SHIP',
          'PACKED',
          'PICKUP_REQUESTED',
          'PICKED_UP',
          'SHIPPED',
          'IN_TRANSIT',
          'OUT_FOR_DELIVERY',
        ],
      },
    });

    if (existing) {
      return existing;
    }

    const selectedOption = await this.determineBestShippingOption({
      pickupAddress,
      deliveryAddress,
      packageInfo,
      cod,
    });

    const activeCarrier = carrier || selectedOption.carrier;
    const activeProvider = provider || env.DELIVERY_PROVIDER || selectedOption.provider;
    const activeMethod = shippingMethod || selectedOption.serviceCode;
    const activeCost = selectedOption.cost || 0;

    const shipmentNumber = `SHIP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const providerShipment = await deliveryProvider.createShipment({
      shipmentNumber,
      orderId,
      orderNumber,
      vendorOrderId,
      pickupAddress,
      deliveryAddress,
      packageInfo,
      items,
      cod,
      serviceOption: selectedOption,
    });

    const trackingNumber = providerShipment.trackingNumber || providerShipment.awb || `TRK-${Date.now().toString(36).toUpperCase()}`;
    const trackingUrl = providerShipment.trackingUrl || null;
    const providerShipmentId = providerShipment.providerShipmentId || providerShipment.shipmentId || providerShipment.id || providerShipment.orderId || null;

    // Prefer provider label URL if returned, otherwise fallback to internal 4x6 PDF label endpoint
    const labelUrl = providerShipment.labelUrl || `/api/v1/vendors/orders/${vendorOrderId}/shipping-label`;

    let pickupStatus = providerShipment.pickupStatus || 'PENDING';
    let pickupToken = providerShipment.pickupToken || null;
    let pickupScheduledAt = providerShipment.pickupScheduledAt || null;

    if (pickupStatus === 'PENDING') {
      try {
        const pickupResult = await deliveryProvider.requestPickup({
          shipmentNumber,
          trackingNumber,
          shipmentId: providerShipmentId,
          pickupAddress,
          packageCount: 1,
          totalWeight: packageInfo.weight || 0.5,
        });
        if (pickupResult?.status === 'SUCCESS' || pickupResult?.status === 'SCHEDULED' || pickupResult?.pickupToken) {
          pickupStatus = 'REQUESTED';
          pickupToken = pickupResult.pickupToken;
          pickupScheduledAt = pickupResult.pickupDate ? new Date(pickupResult.pickupDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
      } catch {
        pickupStatus = 'PENDING';
      }
    }

    const estimatedDeliveryAt = new Date(Date.now() + (selectedOption.estimatedDays || 3) * 24 * 60 * 60 * 1000);

    const shipment = await Shipment.create({
      orderId,
      vendorOrderId,
      vendorId,
      customerId,
      shipmentNumber,
      carrier: activeCarrier,
      provider: activeProvider,
      trackingNumber,
      trackingUrl,
      shippingMethod: activeMethod,
      shippingCost: activeCost,
      status: 'PENDING',
      pickupAddress,
      deliveryAddress,
      packageInfo,
      providerShipmentId,
      labelUrl,
      pickupStatus,
      pickupToken,
      pickupScheduledAt,
      estimatedDeliveryAt,
      metadata: {
        ...metadata,
        serviceName: selectedOption.serviceName,
        carrierOption: selectedOption,
      },
    });

    return shipment;
  }

  async requestPickup({ shipmentId }) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const pickupResult = await deliveryProvider.requestPickup({
      shipmentNumber: shipment.shipmentNumber,
      trackingNumber: shipment.trackingNumber,
      pickupAddress: shipment.pickupAddress,
      packageCount: 1,
      totalWeight: shipment.packageInfo?.weight || 0.5,
    });

    shipment.pickupStatus = pickupResult?.status === 'SUCCESS' || pickupResult?.pickupToken ? 'REQUESTED' : 'PENDING';
    if (pickupResult?.pickupToken) shipment.pickupToken = pickupResult.pickupToken;
    if (pickupResult?.pickupDate) shipment.pickupScheduledAt = new Date(pickupResult.pickupDate);
    await shipment.save();

    return shipment.toObject ? shipment.toObject() : shipment;
  }

  async getTracking(shipmentId) {
    const shipment = await Shipment.findById(shipmentId).lean();
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
    return deliveryProvider.getTracking({ trackingNumber: shipment.trackingNumber, shipmentId });
  }

  async cancelShipment({ shipmentId }) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) {
      throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
    }

    await deliveryProvider.cancelShipment({ trackingNumber: shipment.trackingNumber });
    shipment.status = 'CANCELLED';
    shipment.pickupStatus = 'CANCELLED';
    await shipment.save();
    return shipment.toObject ? shipment.toObject() : shipment;
  }
}

export const shippingService = new ShippingService();
