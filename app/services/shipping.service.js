import { Shipment } from '../models/shipment.model.js';
import { AppError } from '../utils/app-error.js';
import { env } from '../config/env.js';
import { deliveryProvider, getDeliveryProvider, isAuthenticAwb } from './delivery-provider.service.js';

export class ShippingService {
  calculateShipping({ subtotal = 0, items = [], shippingAddress = null, vendors = [] } = {}) {
    if (!env.SHIPPING_ENABLED) {
      return {
        amount: 0,
        currency: 'INR',
        method: 'disabled',
        vendorBreakdown: {},
      };
    }

    const safeItems = Array.isArray(items) ? items : [];
    if (safeItems.length === 0) {
      return {
        amount: 0,
        currency: 'INR',
        method: 'standard',
        vendorBreakdown: {},
      };
    }

    // Index vendors by string ID
    const vendorMap = new Map();
    if (Array.isArray(vendors)) {
      vendors.forEach((v) => {
        if (v && (v._id || v.id)) vendorMap.set(String(v._id || v.id), v);
      });
    } else if (vendors instanceof Map) {
      vendors.forEach((v, k) => vendorMap.set(String(k), v));
    } else if (vendors && typeof vendors === 'object') {
      Object.entries(vendors).forEach(([k, v]) => vendorMap.set(String(k), v));
    }

    // Group items by vendor
    const vendorGroups = new Map();
    let hasIdentifiedVendors = false;

    for (const item of safeItems) {
      const vId = item.vendorId || item.product?.vendorId;
      if (vId) {
        hasIdentifiedVendors = true;
        const key = String(vId);
        if (!vendorGroups.has(key)) {
          vendorGroups.set(key, []);
        }
        vendorGroups.get(key).push(item);
      }
    }

    // If items have vendor association, calculate seller-aware fees independently
    if (hasIdentifiedVendors) {
      const vendorBreakdown = {};
      let totalAmount = 0;

      for (const [vId, groupItems] of vendorGroups.entries()) {
        const vendorDoc = vendorMap.get(vId);
        const settings = vendorDoc?.shippingSettings
          || groupItems[0]?.vendor?.shippingSettings
          || groupItems[0]?.product?.vendor?.shippingSettings
          || null;

        const groupSubtotal = groupItems.reduce((acc, curr) => {
          const itemTotal = Number(curr.lineTotal ?? (Number(curr.unitPrice || 0) * Number(curr.quantity || 1))) || 0;
          return acc + itemTotal;
        }, 0);

        const allFreeShipping = groupItems.length > 0 && groupItems.every(
          (curr) => curr.product?.shipping?.freeShipping === true || curr.freeShipping === true
        );

        let vendorFee = 0;
        const enabled = Boolean(settings?.enabled);
        const configuredFee = Number(settings?.fee || 0);
        const threshold = Number(settings?.freeDeliveryThreshold || 0);

        if (enabled && configuredFee > 0) {
          if (threshold > 0 && groupSubtotal >= threshold) {
            vendorFee = 0;
          } else if (allFreeShipping) {
            vendorFee = 0;
          } else {
            vendorFee = configuredFee;
          }
        }

        vendorBreakdown[vId] = {
          vendorId: vId,
          subtotal: groupSubtotal,
          shippingFee: vendorFee,
          isFree: vendorFee === 0,
          freeDeliveryThreshold: threshold,
        };

        totalAmount += vendorFee;
      }

      return {
        amount: Math.max(0, totalAmount),
        currency: 'INR',
        method: 'standard',
        vendorBreakdown,
      };
    }

    // Fallback when items have no vendor mapping (e.g. legacy standalone unit tests)
    const itemCount = safeItems.length;
    const safeSubtotal = Number(subtotal) || 0;

    let amount = Number(env.SHIPPING_BASE_FEE) || 0;
    if (amount > 0 && itemCount > 2) amount += env.SHIPPING_EXTRA_ITEM_FEE;
    if (safeSubtotal >= env.FREE_SHIPPING_THRESHOLD) amount = 0;
    if (amount > 0 && shippingAddress && shippingAddress.state && /west bengal|wb/i.test(shippingAddress.state)) {
      amount = Math.max(0, amount - env.WEST_BENGAL_SHIPPING_DISCOUNT);
    }

    return {
      amount: Math.max(0, amount),
      currency: 'INR',
      method: 'standard',
      vendorBreakdown: {},
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

    const hasValidAwb = isAuthenticAwb(existing?.trackingNumber, existing?.providerShipmentId);
    const isFullyFulfilled = Boolean(
      existing &&
      existing.providerShipmentId &&
      hasValidAwb &&
      (existing.pickupStatus === 'SCHEDULED' || existing.pickupStatus === 'REQUESTED') &&
      existing.labelUrl &&
      !existing.labelUrl.includes('/api/v1/vendors/orders/')
    );

    if (existing && isFullyFulfilled) {
      return existing;
    }

    const selectedOption = await this.determineBestShippingOption({
      pickupAddress: existing?.pickupAddress && Object.keys(existing.pickupAddress).length > 0 ? existing.pickupAddress : pickupAddress,
      deliveryAddress: existing?.deliveryAddress && Object.keys(existing.deliveryAddress).length > 0 ? existing.deliveryAddress : deliveryAddress,
      packageInfo: existing?.packageInfo && Object.keys(existing.packageInfo).length > 0 ? existing.packageInfo : packageInfo,
      cod,
    });

    const activeCarrier = carrier || existing?.carrier || selectedOption.carrier;
    const activeProvider = provider || (activeCarrier && activeCarrier.includes('mock') ? 'mock' : null) || existing?.provider || env.DELIVERY_PROVIDER || selectedOption.provider;
    const activeMethod = shippingMethod || existing?.shippingMethod || selectedOption.serviceCode;
    const activeCost = selectedOption.cost || existing?.shippingCost || 0;

    const shipmentNumber = existing?.shipmentNumber || `SHIP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const effectivePickup = (existing?.pickupAddress && Object.keys(existing.pickupAddress).length > 0 && existing.pickupAddress.pickupLocationName)
      ? existing.pickupAddress
      : pickupAddress;
    const effectiveDelivery = (existing?.deliveryAddress && Object.keys(existing.deliveryAddress).length > 0)
      ? existing.deliveryAddress
      : deliveryAddress;
    const effectivePackageInfo = (existing?.packageInfo && Object.keys(existing.packageInfo).length > 0)
      ? existing.packageInfo
      : packageInfo;

    const activeDeliveryProvider = activeProvider ? getDeliveryProvider(activeProvider) : deliveryProvider;
    const providerShipment = await activeDeliveryProvider.createShipment({
      shipmentNumber,
      orderId,
      orderNumber,
      vendorOrderId,
      pickupAddress: effectivePickup,
      deliveryAddress: effectiveDelivery,
      packageInfo: effectivePackageInfo,
      items,
      cod,
      serviceOption: selectedOption,
      existingShipmentId: existing?.providerShipmentId || null,
      existingAwb: hasValidAwb ? existing.trackingNumber : null,
      existingLabelUrl: existing?.labelUrl && !existing.labelUrl.includes('/api/v1/vendors/orders/') ? existing.labelUrl : null,
      existingPickupStatus: existing?.pickupStatus || null,
      existingCourierCompanyId: existing?.metadata?.courierCompanyId || null,
      existingCourierName: existing?.carrier || null,
    });

    const providerShipmentId = providerShipment.providerShipmentId || providerShipment.shipmentId || existing?.providerShipmentId || null;
    const trackingNumber = isAuthenticAwb(providerShipment.trackingNumber, providerShipmentId)
      ? providerShipment.trackingNumber
      : (hasValidAwb ? existing.trackingNumber : null);
    const trackingUrl = providerShipment.trackingUrl || (trackingNumber ? `https://shiprocket.co/tracking/${trackingNumber}` : null);
    const labelUrl = providerShipment.labelUrl || existing?.labelUrl || `/api/v1/vendors/orders/${vendorOrderId}/shipping-label`;

    let pickupStatus = providerShipment.pickupStatus || existing?.pickupStatus || 'PENDING';
    let pickupToken = providerShipment.pickupToken || existing?.pickupToken || null;
    let pickupScheduledAt = providerShipment.pickupScheduledAt || existing?.pickupScheduledAt || null;

    const currentAwbValid = isAuthenticAwb(trackingNumber, providerShipmentId);
    if (pickupStatus === 'PENDING' && providerShipmentId && currentAwbValid) {
      try {
        const pickupResult = await activeDeliveryProvider.requestPickup({
          shipmentNumber,
          trackingNumber,
          shipmentId: providerShipmentId,
          pickupAddress: effectivePickup,
          packageCount: 1,
          totalWeight: effectivePackageInfo.weight || 0.5,
        });
        if (pickupResult?.status === 'SUCCESS' || pickupResult?.status === 'SCHEDULED' || pickupResult?.pickupToken) {
          pickupStatus = 'SCHEDULED';
          pickupToken = pickupResult.pickupToken;
          pickupScheduledAt = pickupResult.pickupDate ? new Date(pickupResult.pickupDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
      } catch {
        pickupStatus = 'PENDING';
      }
    }

    const estimatedDeliveryAt = providerShipment.estimatedDeliveryAt || new Date(Date.now() + (selectedOption.estimatedDays || 3) * 24 * 60 * 60 * 1000);

    if (existing) {
      existing.carrier = providerShipment.carrier || activeCarrier;
      existing.provider = providerShipment.provider || activeProvider;
      existing.shippingMethod = providerShipment.shippingMethod || activeMethod;
      existing.shippingCost = providerShipment.shippingCost ?? activeCost;
      existing.trackingNumber = trackingNumber;
      existing.trackingUrl = trackingUrl;
      existing.providerShipmentId = providerShipmentId;
      existing.labelUrl = labelUrl;
      existing.pickupStatus = pickupStatus;
      if (pickupToken) existing.pickupToken = pickupToken;
      if (pickupScheduledAt) existing.pickupScheduledAt = pickupScheduledAt;
      if (estimatedDeliveryAt) existing.estimatedDeliveryAt = estimatedDeliveryAt;
      existing.metadata = {
        ...existing.metadata,
        ...providerShipment.metadata,
        serviceName: selectedOption.serviceName,
        carrierOption: selectedOption,
      };
      await existing.save();
      return existing;
    }

    const shipment = await Shipment.create({
      orderId,
      vendorOrderId,
      vendorId,
      customerId,
      shipmentNumber,
      carrier: providerShipment.carrier || activeCarrier,
      provider: providerShipment.provider || activeProvider,
      trackingNumber,
      trackingUrl,
      shippingMethod: providerShipment.shippingMethod || activeMethod,
      shippingCost: providerShipment.shippingCost ?? activeCost,
      status: 'PENDING',
      pickupAddress: effectivePickup,
      deliveryAddress: effectiveDelivery,
      packageInfo: effectivePackageInfo,
      providerShipmentId,
      labelUrl,
      pickupStatus,
      pickupToken,
      pickupScheduledAt,
      estimatedDeliveryAt,
      metadata: {
        ...metadata,
        ...providerShipment.metadata,
        serviceName: selectedOption.serviceName,
        carrierOption: selectedOption,
      },
    });

    return shipment;
  }

  async requestPickup({ shipmentId, pickupDate = null }) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    const hasAwb = isAuthenticAwb(shipment.trackingNumber, shipment.providerShipmentId);
    if (!hasAwb) {
      throw new AppError(400, 'AWB_NOT_ASSIGNED', 'Cannot request pickup: AWB has not been assigned by carrier');
    }

    const pickupResult = await deliveryProvider.requestPickup({
      shipmentNumber: shipment.shipmentNumber,
      trackingNumber: shipment.trackingNumber,
      shipmentId: shipment.providerShipmentId,
      pickupAddress: shipment.pickupAddress,
      packageCount: 1,
      totalWeight: shipment.packageInfo?.weight || 0.5,
      pickupDate,
    });

    const isSuccess = pickupResult?.status === 'SUCCESS' || pickupResult?.status === 'SCHEDULED' || pickupResult?.pickupToken;
    shipment.pickupStatus = isSuccess ? 'SCHEDULED' : (pickupResult?.status === 'FAILED' ? 'FAILED' : 'REQUESTED');
    if (pickupResult?.pickupToken) shipment.pickupToken = pickupResult.pickupToken;
    if (pickupResult?.pickupDate) shipment.pickupScheduledAt = new Date(pickupResult.pickupDate);
    const rawPickupErr = isSuccess ? null : (pickupResult?.message || 'Pickup request failed');
    shipment.metadata = {
      ...shipment.metadata,
      pickupError: rawPickupErr,
      pickupRequestedAt: new Date().toISOString(),
    };
    await shipment.save();

    return shipment.toObject ? shipment.toObject() : shipment;
  }

  async assignAwb({ shipmentId, courierId = null }) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
    if (!shipment.providerShipmentId) throw new AppError(400, 'PROVIDER_SHIPMENT_ID_REQUIRED', 'Shipment ID not found on provider');

    const result = await deliveryProvider.assignAwb({
      shipmentId: shipment.providerShipmentId,
      courierId: courierId || shipment.metadata?.courierCompanyId || null,
    });

    if (result?.awbCode) {
      shipment.trackingNumber = result.awbCode;
      shipment.trackingUrl = `https://shiprocket.co/tracking/${result.awbCode}`;
      if (result.courierName) shipment.carrier = result.courierName;
      shipment.metadata = {
        ...shipment.metadata,
        courierCompanyId: result.courierCompanyId || shipment.metadata?.courierCompanyId,
        awbError: null,
        awbAssignedAt: new Date().toISOString(),
      };
      await shipment.save();
    }
    return shipment.toObject ? shipment.toObject() : shipment;
  }

  async generateLabel({ shipmentId }) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');
    if (!shipment.providerShipmentId) throw new AppError(400, 'PROVIDER_SHIPMENT_ID_REQUIRED', 'Shipment ID not found on provider');

    const result = await deliveryProvider.generateLabel({
      shipmentId: shipment.providerShipmentId,
    });

    if (result?.labelUrl) {
      shipment.labelUrl = result.labelUrl;
      shipment.metadata = {
        ...shipment.metadata,
        labelError: null,
        labelGeneratedAt: new Date().toISOString(),
      };
      await shipment.save();
    }
    return shipment.toObject ? shipment.toObject() : shipment;
  }

  async fulfillShipment({ shipmentId }) {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Shipment not found');

    return this.createShipment({
      orderId: shipment.orderId,
      vendorOrderId: shipment.vendorOrderId,
      vendorId: shipment.vendorId,
      customerId: shipment.customerId,
      pickupAddress: shipment.pickupAddress,
      deliveryAddress: shipment.deliveryAddress,
      packageInfo: shipment.packageInfo,
      shippingMethod: shipment.shippingMethod,
      carrier: shipment.carrier,
      provider: shipment.provider,
      metadata: shipment.metadata,
    });
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
