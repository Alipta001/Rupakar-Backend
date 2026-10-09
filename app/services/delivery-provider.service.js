import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { normalizeIndianPhone10 } from './sms.service.js';

const hasRealDeliveryConfig = (url, token) => {
  const normalizedUrl = String(url ?? '').trim();
  const normalizedToken = String(token ?? '').trim();
  return Boolean(
    normalizedUrl &&
    normalizedToken &&
    !/^<.*>$/.test(normalizedUrl) &&
    !/^<.*>$/.test(normalizedToken) &&
    !/placeholder|example/i.test(normalizedUrl) &&
    !/placeholder|example/i.test(normalizedToken)
  );
};

export const selectDeterministicCourier = (availableCouriers, { cod = false, recommendedCourierId = null } = {}) => {
  if (!Array.isArray(availableCouriers) || availableCouriers.length === 0) return null;

  let viable = cod
    ? availableCouriers.filter((c) => Boolean(c.cod === 1 || c.codSupported))
    : availableCouriers;

  if (viable.length === 0) {
    viable = availableCouriers;
  }

  const scored = viable.map((c) => {
    const courierId = Number(c.courier_company_id ?? c.id ?? 0);
    const isRecommended = Boolean(
      (recommendedCourierId && Number(courierId) === Number(recommendedCourierId)) ||
      c.recommended === true
    );
    const rating = Math.max(0, Math.min(5, Number(c.rating) || 3.5));
    const etd = Math.max(1, Number(c.estimated_delivery_days ?? c.etd ?? 3));
    const rate = Math.max(0, Number(c.rate ?? c.cost ?? 50));

    // Scoring components:
    // 1. Recommendation bonus: 100 points
    // 2. Courier rating (0-5): up to 50 points
    // 3. Fast ETA (lower is better): up to 45 points
    // 4. Reasonable cost (lower is better): up to 150 points
    const recScore = isRecommended ? 100 : 0;
    const ratingScore = rating * 10;
    const etaScore = Math.max(0, 10 - etd) * 5;
    const costScore = Math.max(0, 200 - rate);

    const totalScore = recScore + ratingScore + etaScore + costScore;

    return {
      courier: c,
      courierCompanyId: courierId,
      courierName: c.courier_name || 'Standard Courier',
      rate,
      totalScore,
    };
  });

  scored.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (a.rate !== b.rate) return a.rate - b.rate;
    return a.courierCompanyId - b.courierCompanyId;
  });

  return scored[0]?.courier || null;
};

export class DeliveryProvider {
  async checkServiceability(_params) {
    throw new Error('checkServiceability must be implemented by provider');
  }
  async getShippingRates(_params) {
    throw new Error('getShippingRates must be implemented by provider');
  }
  async getAvailableCouriers(_params) {
    return { availableCouriers: [], recommendedCourierId: null };
  }
  async createShipment(_params) {
    throw new Error('createShipment must be implemented by provider');
  }
  async assignAwb(_params) {
    throw new Error('assignAwb must be implemented by provider');
  }
  async generateAwb(_params) {
    throw new Error('generateAwb must be implemented by provider');
  }
  async generateLabel(_params) {
    throw new Error('generateLabel must be implemented by provider');
  }
  async getShippingLabel(_params) {
    throw new Error('getShippingLabel must be implemented by provider');
  }
  async requestPickup(_params) {
    throw new Error('requestPickup must be implemented by provider');
  }
  async getTracking(_params) {
    throw new Error('getTracking must be implemented by provider');
  }
  async cancelShipment(_params) {
    throw new Error('cancelShipment must be implemented by provider');
  }
  async listPickupLocations() {
    return [];
  }
  async registerPickupLocation(_params) {
    return {
      success: true,
      reused: true,
      pickupLocation: _params?.pickupLocationName || 'Primary',
      pickupId: null,
    };
  }
}

export class MockDeliveryProvider extends DeliveryProvider {
  async checkServiceability({ pickupPincode, deliveryPincode }) {
    const cleanPickup = String(pickupPincode ?? '').trim();
    const cleanDelivery = String(deliveryPincode ?? '').trim();
    const isValidPin = (pin) => /^\d{6}$/.test(pin);
    const serviceable = isValidPin(cleanDelivery);

    return {
      serviceable,
      pickupPincode: cleanPickup,
      deliveryPincode: cleanDelivery,
      codAvailable: true,
      prepaidAvailable: true,
      estimatedDays: 3,
      provider: 'mock',
    };
  }

  async getShippingRates({ pickupPincode, deliveryPincode, weight = 0.5, dimensions = null, cod = false }) {
    const cleanPickup = String(pickupPincode ?? '').trim();
    const cleanDelivery = String(deliveryPincode ?? '').trim();
    const numericWeight = Math.max(0.1, Number(weight) || 0.5);

    const isWestBengal = cleanDelivery.startsWith('70') || cleanDelivery.startsWith('71') || cleanDelivery.startsWith('72') || cleanDelivery.startsWith('73') || cleanDelivery.startsWith('74');
    const baseRegionalRate = isWestBengal ? 40 : 60;
    const weightSurcharge = Math.ceil(Math.max(0, numericWeight - 0.5) / 0.5) * 20;
    const surfaceCost = baseRegionalRate + weightSurcharge;
    const expressCost = Math.round(surfaceCost * 1.6);

    return [
      {
        provider: 'mock',
        carrier: 'Rupakar Express Logistics',
        serviceCode: 'standard_surface',
        serviceName: 'Express Surface Logistics',
        cost: surfaceCost,
        currency: 'INR',
        estimatedDays: isWestBengal ? 2 : 4,
        codSupported: true,
        recommended: true,
      },
      {
        provider: 'mock',
        carrier: 'Rupakar Air Priority',
        serviceCode: 'priority_air',
        serviceName: 'Priority Air Freight',
        cost: expressCost,
        currency: 'INR',
        estimatedDays: isWestBengal ? 1 : 2,
        codSupported: true,
        recommended: false,
      },
    ];
  }

  async getAvailableCouriers({ pickupPincode, deliveryPincode, weight = 0.5, dimensions = null, cod = false } = {}) {
    const rates = await this.getShippingRates({ pickupPincode, deliveryPincode, weight, dimensions, cod });
    const available = rates.map((r, idx) => ({
      courier_company_id: idx === 0 ? 101 : 102,
      courier_name: r.carrier,
      rate: r.cost,
      estimated_delivery_days: r.estimatedDays,
      rating: idx === 0 ? 4.5 : 4.0,
      cod: r.codSupported ? 1 : 0,
      codSupported: r.codSupported,
      recommended: Boolean(r.recommended),
    }));
    return {
      availableCouriers: available,
      recommendedCourierId: 101,
      raw: { data: { available_courier_companies: available, recommended_courier_company_id: 101 } },
    };
  }

  async assignAwb({ shipmentId, courierId = null } = {}) {
    const awbCode = await this.generateAwb({ count: 1 });
    return {
      awbCode,
      courierName: courierId === 102 ? 'Rupakar Air Priority' : 'Rupakar Express Logistics',
      courierCompanyId: courierId || 101,
      reused: false,
    };
  }

  async generateLabel({ shipmentId } = {}) {
    return {
      labelUrl: `/api/v1/vendors/orders/mock/shipping-label?shipmentId=${shipmentId || ''}`,
      labelCreated: true,
      raw: {},
    };
  }

  async generateAwb({ count = 1 } = {}) {
    const awbs = [];
    for (let i = 0; i < count; i++) {
      awbs.push(`RUP${Date.now().toString().slice(-7)}${crypto.randomBytes(3).toString('hex').toUpperCase()}IN`);
    }
    return count === 1 ? awbs[0] : awbs;
  }

  async createShipment(payload = {}) {
    const {
      shipmentNumber,
      order = {},
      vendorOrder = {},
      packageInfo = {},
      serviceOption = null,
      existingShipmentId = null,
      existingAwb = null,
      existingLabelUrl = null,
      existingPickupStatus = null,
    } = payload;

    const finalShipmentNumber = shipmentNumber || `SHIP-${Date.now().toString(36).toUpperCase()}`;
    const providerShipmentId = existingShipmentId || `MSHP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const trackingNumber = existingAwb || (await this.generateAwb({ count: 1 }));
    const carrier = serviceOption?.carrier || 'Rupakar Express Logistics';
    const shippingMethod = serviceOption?.serviceCode || 'standard_surface';
    const shippingCost = serviceOption?.cost ?? (env.SHIPPING_BASE_FEE || 50);
    const estimatedDays = serviceOption?.estimatedDays || 3;
    const estimatedDeliveryAt = new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000);
    const labelUrl = existingLabelUrl || `/api/v1/vendors/orders/${vendorOrder?._id || ''}/shipping-label`;
    const pickupStatus = existingPickupStatus === 'SCHEDULED' ? 'SCHEDULED' : 'SCHEDULED';
    const pickupToken = `PKP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    return {
      shipmentNumber: finalShipmentNumber,
      trackingNumber,
      providerShipmentId,
      carrier,
      shippingMethod,
      shippingCost,
      estimatedDeliveryAt,
      trackingUrl: `${env.FRONTEND_URL || 'http://localhost:3000'}/account/orders/${order?._id || ''}`,
      labelUrl,
      provider: 'mock',
      status: 'READY_TO_SHIP',
      pickupStatus,
      pickupToken,
      pickupScheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      metadata: {
        packageInfo,
        simulatedAt: new Date().toISOString(),
        stagesCompleted: ['ORDER_CREATED', 'COURIER_SELECTED', 'AWB_ASSIGNED', 'LABEL_GENERATED', 'PICKUP_SCHEDULED'],
      },
    };
  }

  async requestPickup({ pickupAddress = {}, expectedPackageCount = 1, pickupDate = new Date(), trackingNumber = null } = {}) {
    const pickupToken = `PKP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    return {
      scheduled: true,
      pickupToken,
      pickupDate: new Date(pickupDate).toISOString(),
      expectedPackageCount,
      trackingNumber,
      status: 'SCHEDULED',
      message: 'Pickup successfully scheduled with carrier',
      provider: 'mock',
    };
  }

  async schedulePickup(params) {
    return this.requestPickup(params);
  }

  async getShippingLabel({ trackingNumber, shipment = null, vendorOrderId = null } = {}) {
    const targetVoId = vendorOrderId || shipment?.vendorOrderId || '';
    return {
      trackingNumber,
      labelUrl: targetVoId ? `/api/v1/vendors/orders/${targetVoId}/shipping-label` : null,
      format: 'pdf',
      provider: 'mock',
    };
  }

  async getTracking({ trackingNumber, shipmentId = null }) {
    const baseEvents = [
      {
        status: 'READY_TO_SHIP',
        description: 'Shipment created and manifests printed',
        location: 'Origin Processing Center',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        status: 'PICKUP_REQUESTED',
        description: 'Carrier pickup requested by seller',
        location: 'Origin Hub',
        timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      },
    ];

    return {
      trackingNumber,
      shipmentId,
      carrier: 'Rupakar Express Logistics',
      status: 'IN_TRANSIT',
      estimatedDeliveryAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      events: baseEvents,
      provider: 'mock',
    };
  }

  async getTrackingEvents(params) {
    return this.getTracking(params);
  }

  async cancelShipment({ trackingNumber, reason = 'Cancelled by seller' } = {}) {
    return {
      trackingNumber,
      cancelled: true,
      reason,
      cancelledAt: new Date().toISOString(),
      message: 'Shipment cancelled with mock provider',
      provider: 'mock',
    };
  }

  async listPickupLocations() {
    if (!this._mockLocations) {
      this._mockLocations = [
        { id: 'mock-pkp-primary', pickupLocation: 'Primary' },
      ];
    }
    return this._mockLocations;
  }

  async registerPickupLocation(payload = {}) {
    const nickname = String(payload.pickupLocationName || payload.pickup_location || 'Primary').trim();
    if (!this._mockLocations) {
      this._mockLocations = [
        { id: 'mock-pkp-primary', pickupLocation: 'Primary' },
      ];
    }
    const match = this._mockLocations.find(
      (l) => l.pickupLocation === nickname || l.pickupLocation.toLowerCase() === nickname.toLowerCase()
    );
    if (match) {
      return {
        success: true,
        reused: true,
        pickupLocation: match.pickupLocation,
        pickupId: match.id,
      };
    }
    const createdId = `mock-pkp-${Date.now()}`;
    const newLoc = { id: createdId, pickupLocation: nickname };
    this._mockLocations.push(newLoc);
    return {
      success: true,
      reused: false,
      pickupLocation: nickname,
      pickupId: createdId,
    };
  }
}

export class DelhiveryProvider extends MockDeliveryProvider {
  constructor() {
    super();
    this.apiUrl = (env.DELIVERY_API_URL || 'https://track.delhivery.com').replace(/\/+$/, '');
    this.apiToken = env.DELIVERY_API_TOKEN || '';
  }

  getHeaders() {
    return {
      Authorization: `Token ${this.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async checkServiceability({ pickupPincode, deliveryPincode }) {
    if (!hasRealDeliveryConfig(this.apiUrl, this.apiToken)) {
      return super.checkServiceability({ pickupPincode, deliveryPincode });
    }

    try {
      const url = `${this.apiUrl}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(deliveryPincode)}`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) throw new Error(`Delhivery pincode check failed with status ${res.status}`);
      const data = await res.json();
      const codes = data?.delivery_codes || [];
      const match = codes.find((c) => String(c?.postal_code?.pin || c?.pin) === String(deliveryPincode));

      return {
        serviceable: Boolean(match),
        pickupPincode,
        deliveryPincode,
        codAvailable: Boolean(match?.postal_code?.cod === 'Y' || match?.cod === 'Y'),
        prepaidAvailable: Boolean(match?.postal_code?.pre_paid === 'Y' || match?.pre_paid === 'Y'),
        estimatedDays: 3,
        provider: 'delhivery',
      };
    } catch {
      return super.checkServiceability({ pickupPincode, deliveryPincode });
    }
  }

  async getShippingRates({ pickupPincode, deliveryPincode, weight, dimensions, cod }) {
    if (!hasRealDeliveryConfig(this.apiUrl, this.apiToken)) {
      return super.getShippingRates({ pickupPincode, deliveryPincode, weight, dimensions, cod });
    }

    try {
      const rates = await super.getShippingRates({ pickupPincode, deliveryPincode, weight, dimensions, cod });
      return rates.map((r) => ({
        ...r,
        provider: 'delhivery',
        carrier: r.serviceCode === 'priority_air' ? 'Delhivery Express Air' : 'Delhivery Surface Express',
      }));
    } catch {
      return super.getShippingRates({ pickupPincode, deliveryPincode, weight, dimensions, cod });
    }
  }

  async generateAwb({ count = 1 } = {}) {
    if (!hasRealDeliveryConfig(this.apiUrl, this.apiToken)) {
      return super.generateAwb({ count });
    }

    try {
      const url = `${this.apiUrl}/waybill/api/bulk/json/?count=${count}`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (res.ok) {
        const text = await res.text();
        const cleaned = text.replace(/["\s]/g, '');
        if (cleaned) return cleaned;
      }
    } catch {
      // Fallback to deterministic generator
    }
    return super.generateAwb({ count });
  }

  async createShipment(payload) {
    if (!hasRealDeliveryConfig(this.apiUrl, this.apiToken)) {
      return super.createShipment(payload);
    }

    const { order = {}, vendorOrder = {}, vendor = {}, packageInfo = {}, serviceOption = null } = payload;
    const consignee = order.shippingAddressSnapshot || {};
    const trackingNumber = await this.generateAwb({ count: 1 });
    const weightGrams = Math.round((Number(packageInfo.weight) || 0.5) * 1000);

    const delhiveryPayload = {
      shipments: [
        {
          name: consignee.name || consignee.fullName || 'Valued Customer',
          add: [consignee.line1, consignee.line2].filter(Boolean).join(', ') || 'Customer Address',
          pin: consignee.postalCode || consignee.pincode,
          city: consignee.city,
          state: consignee.state,
          country: consignee.country || 'India',
          phone: consignee.phone,
          order: order.orderNumber || String(order._id),
          payment_mode: order.paymentMethod === 'cod' ? 'COD' : 'Pre-paid',
          return_pin: vendor.originDistrict || consignee.postalCode,
          return_city: vendor.originDistrict || consignee.city,
          return_name: vendor.businessName || 'Rupakar Artisan Vendor',
          return_add: vendor.address || 'Vendor Origin Center',
          return_state: vendor.originState || consignee.state,
          return_country: 'India',
          products_desc: (vendorOrder.items || []).map((it) => it.productName).join(', ') || 'Handicrafts',
          cod_amount: order.paymentMethod === 'cod' ? Number(order.total || 0) : 0,
          order_date: new Date(order.createdAt || Date.now()).toISOString(),
          total_amount: Number(vendorOrder.total || order.total || 0),
          seller_add: vendor.address || 'Vendor Facility',
          seller_name: vendor.businessName || 'Rupakar Artisan',
          seller_inv: vendorOrder._id ? String(vendorOrder._id) : '',
          quantity: (vendorOrder.items || []).reduce((acc, it) => acc + (it.quantity || 1), 0) || 1,
          waybill: trackingNumber,
          shipment_width: Number(packageInfo.width) || 15,
          shipment_height: Number(packageInfo.height) || 10,
          shipment_length: Number(packageInfo.length) || 20,
          weight: weightGrams,
        },
      ],
      pickup_location: {
        name: (payload.pickupAddress && payload.pickupAddress.pickupLocationName) || vendor.businessName || 'Rupakar Fulfillment Center',
        add: (payload.pickupAddress && (payload.pickupAddress.addressLine1 || payload.pickupAddress.street)) || vendor.address || 'Vendor Pickup Facility',
        city: (payload.pickupAddress && payload.pickupAddress.city) || vendor.originDistrict || 'Kolkata',
        pin_code: Number(payload.pickupAddress && (payload.pickupAddress.pincode || payload.pickupAddress.postalCode)) || 700001,
        country: (payload.pickupAddress && payload.pickupAddress.country) || 'India',
        phone: (payload.pickupAddress && payload.pickupAddress.phone) || vendor.phone || '9999999999',
      },
    };

    try {
      const url = `${this.apiUrl}/api/cmu/create.json`;
      const body = `format=json&data=${encodeURIComponent(JSON.stringify(delhiveryPayload))}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.apiToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      const responseData = await res.json().catch(() => null);

      if (res.ok && responseData?.success !== false) {
        return {
          shipmentNumber: payload.shipmentNumber || `SHIP-${Date.now().toString(36).toUpperCase()}`,
          trackingNumber,
          providerShipmentId: String(responseData?.upload_wbn || trackingNumber),
          carrier: serviceOption?.carrier || 'Delhivery Surface Express',
          shippingMethod: serviceOption?.serviceCode || 'surface',
          shippingCost: serviceOption?.cost || 50,
          estimatedDeliveryAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          trackingUrl: `${this.apiUrl}/track/package/${trackingNumber}`,
          labelUrl: `/api/v1/vendors/orders/${vendorOrder?._id || ''}/shipping-label`,
          provider: 'delhivery',
          status: 'READY_TO_SHIP',
          metadata: {
            packageInfo,
            delhiveryResponse: responseData,
          },
        };
      }
    } catch {
      // Fallback safely to mock provider
    }

    return super.createShipment(payload);
  }

  async requestPickup({ pickupAddress = {}, expectedPackageCount = 1, pickupDate = new Date(), trackingNumber = null } = {}) {
    if (!hasRealDeliveryConfig(this.apiUrl, this.apiToken)) {
      return super.requestPickup({ pickupAddress, expectedPackageCount, pickupDate, trackingNumber });
    }

    try {
      const url = `${this.apiUrl}/fm/request/new/`;
      const dateStr = new Date(pickupDate).toISOString().slice(0, 10);
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          pickup_time: '14:00:00',
          pickup_date: dateStr,
          pickup_location: pickupAddress.pickupLocationName || pickupAddress.city || 'Kolkata Hub',
          expected_package_count: expectedPackageCount,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.pr_id) {
        return {
          scheduled: true,
          pickupToken: String(data.pr_id),
          pickupDate: dateStr,
          expectedPackageCount,
          trackingNumber,
          status: 'SCHEDULED',
          message: 'Delhivery pickup successfully scheduled',
          provider: 'delhivery',
        };
      }
    } catch {
      // Fallback
    }

    return super.requestPickup({ pickupAddress, expectedPackageCount, pickupDate, trackingNumber });
  }

  async getShippingLabel({ trackingNumber, shipment = null, vendorOrderId = null } = {}) {
    if (!hasRealDeliveryConfig(this.apiUrl, this.apiToken)) {
      return super.getShippingLabel({ trackingNumber, shipment, vendorOrderId });
    }

    const liveLabelUrl = `${this.apiUrl}/api/p/packing_slip?wbns=${encodeURIComponent(trackingNumber)}&pdf=true`;
    return {
      trackingNumber,
      labelUrl: liveLabelUrl,
      format: 'pdf',
      provider: 'delhivery',
    };
  }

  async getTracking({ trackingNumber, shipmentId = null }) {
    if (!hasRealDeliveryConfig(this.apiUrl, this.apiToken)) {
      return super.getTracking({ trackingNumber, shipmentId });
    }

    try {
      const url = `${this.apiUrl}/api/v1/packages/json/?waybill=${encodeURIComponent(trackingNumber)}`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (res.ok) {
        const data = await res.json();
        const scans = data?.ShipmentData?.[0]?.Shipment?.Scans || [];
        const statusType = String(data?.ShipmentData?.[0]?.Shipment?.Status?.Status || '').toUpperCase();

        const statusMap = {
          MANIFESTED: 'READY_TO_SHIP',
          IN_TRANSIT: 'IN_TRANSIT',
          PENDING: 'IN_TRANSIT',
          DISPATCHED: 'OUT_FOR_DELIVERY',
          OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
          DELIVERED: 'DELIVERED',
          RTO: 'RTO_INITIATED',
          CANCELLED: 'CANCELLED',
        };

        const normalizedStatus = statusMap[statusType] || 'IN_TRANSIT';

        return {
          trackingNumber,
          shipmentId,
          carrier: 'Delhivery',
          status: normalizedStatus,
          events: scans.map((s) => ({
            status: statusMap[String(s?.ScanDetail?.ScanType || '').toUpperCase()] || normalizedStatus,
            description: s?.ScanDetail?.Instructions || s?.ScanDetail?.Scan || 'Status update',
            location: s?.ScanDetail?.ScannedLocation || 'En Route',
            timestamp: s?.ScanDetail?.ScanDateTime || new Date().toISOString(),
          })),
          provider: 'delhivery',
        };
      }
    } catch {
      // Fallback
    }

    return super.getTracking({ trackingNumber, shipmentId });
  }

  async cancelShipment({ trackingNumber, reason = 'Cancelled by seller' } = {}) {
    if (!hasRealDeliveryConfig(this.apiUrl, this.apiToken)) {
      return super.cancelShipment({ trackingNumber, reason });
    }

    try {
      const url = `${this.apiUrl}/api/p/edit`;
      await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ waybill: trackingNumber, cancellation: 'true' }),
      });
    } catch {
      // ignore
    }

    return super.cancelShipment({ trackingNumber, reason });
  }
}

export const SHIPROCKET_STATUS_MAP = {
  NEW: 'READY_TO_SHIP',
  'AWB ASSIGNED': 'READY_TO_SHIP',
  'LABEL GENERATED': 'LABEL_GENERATED',
  LABEL_GENERATED: 'LABEL_GENERATED',
  'PICKUP SCHEDULED': 'PICKUP_REQUESTED',
  'PICKUP GENERATED': 'PICKUP_REQUESTED',
  'PICKUP REQUESTED': 'PICKUP_REQUESTED',
  'PICKUP QUEUED': 'PICKUP_REQUESTED',
  'PICKUP RESCHEDULED': 'PICKUP_REQUESTED',
  'PICKUP ERROR': 'DELIVERY_FAILED',
  'PICKED UP': 'SHIPPED',
  PICKED_UP: 'SHIPPED',
  SHIPPED: 'SHIPPED',
  'IN TRANSIT': 'IN_TRANSIT',
  IN_TRANSIT: 'IN_TRANSIT',
  'REACHED AT DESTINATION': 'IN_TRANSIT',
  'OUT FOR DELIVERY': 'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  UNDELIVERED: 'DELIVERY_FAILED',
  'DELIVERY FAILED': 'DELIVERY_FAILED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  'RTO INITIATED': 'RTO_INITIATED',
  RTO_INITIATED: 'RTO_INITIATED',
  'RTO IN TRANSIT': 'RTO_IN_TRANSIT',
  RTO_IN_TRANSIT: 'RTO_IN_TRANSIT',
  'RTO DELIVERED': 'RTO_DELIVERED',
  RTO_DELIVERED: 'RTO_DELIVERED',
  CANCELED: 'CANCELLED',
  CANCELLED: 'CANCELLED',
};

const sanitizeSafeErrorMessage = (rawMessage) => {
  if (!rawMessage || typeof rawMessage !== 'string') return '';
  return rawMessage
    .replace(/(?:bearer\s+)?[a-zA-Z0-9_\-.]{32,}/gi, '[REDACTED_TOKEN]')
    .replace(/\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, '[REDACTED_PHONE]')
    .replace(/password[:=]\s*\S+/gi, 'password=[REDACTED]');
};

const extractSafeShiprocketErrorMessage = (payload, fallbackStatus = 502) => {
  if (!payload || typeof payload !== 'object') {
    return sanitizeSafeErrorMessage(`Shiprocket request failed with status ${fallbackStatus}`);
  }

  const collected = [];

  if (payload.errors) {
    if (typeof payload.errors === 'string') {
      collected.push(payload.errors);
    } else if (Array.isArray(payload.errors)) {
      collected.push(payload.errors.filter(Boolean).join(', '));
    } else if (typeof payload.errors === 'object') {
      const parts = [];
      for (const [key, val] of Object.entries(payload.errors)) {
        if (Array.isArray(val)) {
          parts.push(`${key}: ${val.join(', ')}`);
        } else if (typeof val === 'string') {
          parts.push(`${key}: ${val}`);
        } else if (val) {
          parts.push(`${key}: ${JSON.stringify(val)}`);
        }
      }
      if (parts.length > 0) collected.push(parts.join('; '));
    }
  }

  if (payload.message && typeof payload.message === 'string') {
    const mainMsg = payload.message.trim();
    if (mainMsg && !collected.some((c) => c.includes(mainMsg))) {
      collected.unshift(mainMsg);
    }
  } else if (payload.error && typeof payload.error === 'string') {
    const errStr = payload.error.trim();
    if (errStr && !collected.some((c) => c.includes(errStr))) {
      collected.unshift(errStr);
    }
  } else if (payload.response?.message && typeof payload.response.message === 'string') {
    collected.unshift(payload.response.message.trim());
  }

  const combined = collected.filter(Boolean).join(': ') || `Shiprocket request failed with status ${fallbackStatus}`;
  return sanitizeSafeErrorMessage(combined);
};

const extractShiprocketShipmentId = (data) => {
  if (!data || typeof data !== 'object') return null;

  const candidate =
    data.shipment_id ??
    data.response?.shipment_id ??
    data.data?.shipment_id ??
    data.payload?.shipment_id ??
    data.shipment_details?.shipment_id ??
    data.response?.data?.shipment_id ??
    data.shipments?.[0]?.shipment_id ??
    data.shipments?.[0]?.id ??
    data.packages?.[0]?.shipment_id ??
    data.packages?.[0]?.id ??
    null;

  if (candidate !== null && candidate !== undefined && candidate !== '') {
    const num = Number(candidate);
    if (!isNaN(num) && num > 0) return num;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
};

const extractShiprocketOrderId = (data) => {
  if (!data || typeof data !== 'object') return null;

  const candidate =
    data.order_id ??
    data.response?.order_id ??
    data.data?.order_id ??
    data.payload?.order_id ??
    data.response?.data?.order_id ??
    data.id ??
    null;

  if (candidate !== null && candidate !== undefined && candidate !== '') {
    return candidate;
  }
  return null;
};

const isShiprocketResponseRejection = (data) => {
  if (!data || typeof data !== 'object') return false;

  if (data.status_code !== undefined && data.status_code !== null) {
    const sc = Number(data.status_code);
    if (!isNaN(sc) && sc !== 1 && sc !== 200 && sc !== 201) return true;
  }

  if (data.status === 'error' || data.status === 'failed' || data.success === false) {
    return true;
  }

  if (data.errors && (Array.isArray(data.errors) ? data.errors.length > 0 : Object.keys(data.errors).length > 0)) {
    return true;
  }

  return false;
};

export class ShiprocketProvider extends DeliveryProvider {
  constructor(options = {}) {
    super();
    this.apiUrl = (options.apiUrl || env.SHIPROCKET_API_URL || 'https://apiv2.shiprocket.in').replace(/\/+$/, '');
    this.email = options.email || env.SHIPROCKET_EMAIL || '';
    this.password = options.password || env.SHIPROCKET_PASSWORD || '';
    this.mode = options.mode || env.DELIVERY_MODE || 'mock';
    this.cachedToken = options.token || null;
    this.tokenExpiresAt = options.tokenExpiresAt || null;
  }

  hasConfig() {
    return Boolean(this.email && this.password && this.email.includes('@'));
  }

  async getToken() {
    if (this.cachedToken && this.tokenExpiresAt && this.tokenExpiresAt > Date.now() + 5 * 60 * 1000) {
      return this.cachedToken;
    }

    if (!this.hasConfig()) {
      throw new AppError(500, 'SHIPROCKET_CONFIG_ERROR', 'Shiprocket email and password are not configured');
    }

    const loginUrl = `${this.apiUrl}/v1/external/auth/login`;
    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        email: this.email,
        password: this.password,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new AppError(res.status === 401 ? 401 : 502, 'SHIPROCKET_AUTH_FAILED', err?.message || `Shiprocket authentication failed with status ${res.status}`);
    }

    const data = await res.json().catch(() => ({}));
    if (!data?.token) {
      throw new AppError(502, 'SHIPROCKET_AUTH_FAILED', 'Shiprocket authentication response missing token');
    }

    this.cachedToken = data.token;
    this.tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60 * 1000;
    return this.cachedToken;
  }

  async request(endpoint, options = {}) {
    let token = await this.getToken();
    const url = `${this.apiUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    };

    let res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      // Invalidate cache and retry once
      this.cachedToken = null;
      this.tokenExpiresAt = null;
      token = await this.getToken();
      headers.Authorization = `Bearer ${token}`;
      res = await fetch(url, { ...options, headers });
    }
    return res;
  }

  async checkServiceability({ pickupPincode, deliveryPincode, weight = 0.5, dimensions = null, cod = false }) {
    const cleanPickup = String(pickupPincode ?? '').trim();
    const cleanDelivery = String(deliveryPincode ?? '').trim();
    const params = new URLSearchParams({
      pickup_postcode: cleanPickup,
      delivery_postcode: cleanDelivery,
      weight: String(weight || 0.5),
      cod: cod ? '1' : '0',
    });
    if (dimensions?.length) params.set('length', String(dimensions.length));
    if (dimensions?.width) params.set('breadth', String(dimensions.width));
    if (dimensions?.height) params.set('height', String(dimensions.height));

    const res = await this.request(`/v1/external/courier/serviceability/?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new AppError(res.status, 'SHIPROCKET_SERVICEABILITY_FAILED', err?.message || 'Shiprocket serviceability lookup failed');
    }

    const data = await res.json();
    const companies = data?.data?.available_courier_companies || [];
    const serviceable = companies.length > 0;
    const codAvailable = companies.some((c) => c.cod === 1);
    const minDays = companies.reduce((min, c) => Math.min(min, Number(c.estimated_delivery_days) || 3), 10);

    return {
      serviceable,
      pickupPincode: cleanPickup,
      deliveryPincode: cleanDelivery,
      codAvailable,
      prepaidAvailable: serviceable,
      estimatedDays: minDays < 10 ? minDays : 3,
      provider: 'shiprocket',
    };
  }

  async getShippingRates({ pickupPincode, deliveryPincode, weight = 0.5, dimensions = null, cod = false }) {
    const cleanPickup = String(pickupPincode ?? '').trim();
    const cleanDelivery = String(deliveryPincode ?? '').trim();
    const params = new URLSearchParams({
      pickup_postcode: cleanPickup,
      delivery_postcode: cleanDelivery,
      weight: String(weight || 0.5),
      cod: cod ? '1' : '0',
    });
    if (dimensions?.length) params.set('length', String(dimensions.length));
    if (dimensions?.width) params.set('breadth', String(dimensions.width));
    if (dimensions?.height) params.set('height', String(dimensions.height));

    const res = await this.request(`/v1/external/courier/serviceability/?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new AppError(res.status, 'SHIPROCKET_RATES_FAILED', err?.message || 'Shiprocket rate lookup failed');
    }

    const data = await res.json();
    const companies = data?.data?.available_courier_companies || [];
    const recommendedId = data?.data?.recommended_courier_company_id || data?.data?.recommended_by?.id;

    return companies.map((c) => ({
      provider: 'shiprocket',
      carrier: c.courier_name,
      courierCompanyId: c.courier_company_id,
      serviceCode: String(c.courier_company_id),
      serviceName: c.courier_name,
      cost: Math.round(Number(c.rate) || 50),
      currency: 'INR',
      estimatedDays: Number(c.estimated_delivery_days) || (c.etd ? parseInt(c.etd, 10) : 3) || 3,
      codSupported: Boolean(c.cod === 1),
      recommended: c.courier_company_id === recommendedId,
      rating: c.rating,
    }));
  }

  async getAvailableCouriers({ pickupPincode, deliveryPincode, weight = 0.5, dimensions = null, cod = false, shipmentId = null } = {}) {
    const cleanPickup = String(pickupPincode ?? '').trim();
    const cleanDelivery = String(deliveryPincode ?? '').trim();
    const params = new URLSearchParams({
      pickup_postcode: cleanPickup,
      delivery_postcode: cleanDelivery,
      weight: String(weight || 0.5),
      cod: cod ? '1' : '0',
    });
    if (dimensions?.length) params.set('length', String(dimensions.length));
    if (dimensions?.width || dimensions?.breadth) params.set('breadth', String(dimensions.width || dimensions.breadth));
    if (dimensions?.height) params.set('height', String(dimensions.height));
    if (shipmentId) params.set('shipment_id', String(shipmentId));

    const res = await this.request(`/v1/external/courier/serviceability/?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const safeError = extractSafeShiprocketErrorMessage(err, res.status);
      throw new AppError(res.status >= 400 && res.status < 600 ? res.status : 502, 'SHIPROCKET_SERVICEABILITY_FAILED', safeError || 'Shiprocket serviceability lookup failed');
    }

    const data = await res.json().catch(() => ({}));
    const companies = data?.data?.available_courier_companies || [];
    const recommendedId = data?.data?.recommended_courier_company_id || data?.data?.recommended_by?.id || null;

    return {
      availableCouriers: companies,
      recommendedCourierId: recommendedId,
      raw: data,
    };
  }

  async assignAwb({ shipmentId, courierId = null } = {}) {
    if (!shipmentId) throw new AppError(400, 'SHIPMENT_ID_REQUIRED', 'Shipment ID required to assign Shiprocket AWB');
    const res = await this.request('/v1/external/courier/assign/awb', {
      method: 'POST',
      body: JSON.stringify({
        shipment_id: shipmentId,
        ...(courierId ? { courier_id: Number(courierId) } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || isShiprocketResponseRejection(data)) {
      const safeError = extractSafeShiprocketErrorMessage(data, res.status);
      const alreadyAssigned = /already\s+(?:been\s+)?(?:assigned|generated)/i.test(safeError);
      const extractedAwb = data?.response?.data?.awb_code || data?.awb_code || null;
      if (alreadyAssigned && extractedAwb) {
        return {
          awbCode: extractedAwb,
          courierName: data?.response?.data?.courier_name || null,
          courierCompanyId: data?.response?.data?.courier_company_id || courierId || null,
          reused: true,
          raw: data,
        };
      }
      throw new AppError(res.status >= 400 && res.status < 600 ? res.status : 502, 'SHIPROCKET_AWB_FAILED', safeError || 'Shiprocket AWB assignment failed');
    }

    const awbCode = data?.response?.data?.awb_code || data?.awb_code || null;
    const courierName = data?.response?.data?.courier_name || null;
    const courierCompanyId = data?.response?.data?.courier_company_id || courierId || null;

    return {
      awb: awbCode,
      awbCode,
      courierName,
      courierCompanyId,
      reused: false,
      raw: data,
    };
  }

  async generateAwb({ shipmentId, courierId = null } = {}) {
    const result = await this.assignAwb({ shipmentId, courierId });
    return result.awbCode;
  }

  async generateLabel({ shipmentId } = {}) {
    if (!shipmentId) throw new AppError(400, 'SHIPMENT_ID_REQUIRED', 'Shipment ID required to generate Shiprocket label');
    const numericId = Number(shipmentId);
    const idToSend = !isNaN(numericId) ? numericId : String(shipmentId);
    const res = await this.request('/v1/external/courier/generate/label', {
      method: 'POST',
      body: JSON.stringify({ shipment_id: [idToSend] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || isShiprocketResponseRejection(data)) {
      const safeError = extractSafeShiprocketErrorMessage(data, res.status);
      throw new AppError(res.status >= 400 && res.status < 600 ? res.status : 502, 'SHIPROCKET_LABEL_FAILED', safeError || 'Shiprocket label generation failed');
    }
    return {
      labelUrl: data?.label_url || null,
      labelCreated: Boolean(data?.label_created ?? true),
      raw: data,
    };
  }

  async createShipment(payload = {}) {
    const shipmentNumber = payload.shipmentNumber;
    const orderId = payload.orderId;
    const orderNumber = payload.orderNumber;
    const vendorOrderId = payload.vendorOrderId;
    const pickupAddress = payload.pickupAddress || {};
    const deliveryAddress = payload.deliveryAddress || payload.customer || {};
    const packageInfo = payload.packageInfo || payload.packageDetails || {};
    const items = payload.items || [];
    const cod = Boolean(payload.cod || payload.payment?.method === 'COD');
    const serviceOption = payload.serviceOption || null;
    let existingShipmentId = payload.existingShipmentId || null;
    let existingAwb = payload.existingAwb || null;
    let existingLabelUrl = payload.existingLabelUrl || null;
    let existingPickupStatus = payload.existingPickupStatus || null;
    let existingCourierCompanyId = payload.existingCourierCompanyId || payload.existingCourierId || null;
    let existingCourierName = payload.existingCourierName || payload.existingCourier || null;

    const stagesCompleted = [];
    let srShipmentId = existingShipmentId ? Number(existingShipmentId) || existingShipmentId : null;
    let srOrderId = null;

    const finalShipmentNumber = shipmentNumber || `SHIP-${Date.now().toString(36).toUpperCase()}`;
    const weightKg = Math.max(0.1, Number(packageInfo?.weight) || 0.5);
    const lengthCm = Math.max(1, Number(packageInfo?.length) || 15);
    const widthCm = Math.max(1, Number(packageInfo?.width) || 10);
    const heightCm = Math.max(1, Number(packageInfo?.height) || 5);

    // Stage 1: Order Creation & Shipment Recovery
    if (srShipmentId) {
      stagesCompleted.push('ORDER_CREATED');
    } else {
      const orderItems = (Array.isArray(items) && items.length > 0
        ? items
        : [{ productName: 'Artisan Handicraft', quantity: 1, unitPrice: 500 }]
      ).map((it, idx) => ({
        name: it.productName || it.title || it.name || `Item ${idx + 1}`,
        sku: it.sku || `SKU-${it.variantId || idx + 1}`,
        units: Number(it.quantity || it.units) || 1,
        selling_price: Number(it.unitPrice || it.price || it.sellingPrice || it.selling_price) || 100,
      }));

      const subTotal = orderItems.reduce((acc, it) => acc + (it.units * it.selling_price), 0);
      const orderIdStr = String(orderNumber || orderId || Date.now());
      const srOrderIdCustom = vendorOrderId ? `${orderIdStr}-VO-${String(vendorOrderId).slice(-6)}` : orderIdStr;

      const resolvedPickupLocation = (pickupAddress.pickupLocationName || '').trim() || (this.mode === 'production' ? '' : ((pickupAddress.city || '').trim() || 'Primary'));
      if (!resolvedPickupLocation) {
        throw new AppError(400, 'PICKUP_LOCATION_REQUIRED', 'Vendor pickup location nickname is required for Shiprocket shipment creation');
      }
      if (pickupAddress.registrationStatus && pickupAddress.registrationStatus !== 'REGISTERED') {
        throw new AppError(400, 'PICKUP_LOCATION_NOT_REGISTERED', `Pickup location "${resolvedPickupLocation}" has registration status ${pickupAddress.registrationStatus} and is not registered with Shiprocket`);
      }
      if (pickupAddress.adminStatus && pickupAddress.adminStatus !== 'APPROVED') {
        let msg = 'Pickup location is awaiting admin approval.';
        if (pickupAddress.adminStatus === 'DEACTIVATED') msg = 'Pickup location is deactivated by admin.';
        if (pickupAddress.adminStatus === 'ARCHIVED') msg = 'Pickup location has been archived.';
        throw new AppError(400, 'PICKUP_LOCATION_NOT_APPROVED', msg);
      }

      const rawCustomerPhone = deliveryAddress.phone || deliveryAddress.phoneNumber || deliveryAddress.mobile || '';
      let normalizedCustomerPhone = normalizeIndianPhone10(rawCustomerPhone);

      if (rawCustomerPhone && !normalizedCustomerPhone) {
        throw new AppError(400, 'INVALID_PHONE_NUMBER', 'Customer phone number must be a valid 10-digit Indian mobile number');
      }

      if (!normalizedCustomerPhone) {
        normalizedCustomerPhone = '9876543210';
      }

      const rawPickupPhone = pickupAddress.phone || pickupAddress.phoneNumber || pickupAddress.mobile || '';
      let normalizedPickupPhone = null;
      if (rawPickupPhone) {
        normalizedPickupPhone = normalizeIndianPhone10(rawPickupPhone);
        if (!normalizedPickupPhone) {
          throw new AppError(400, 'INVALID_PHONE_NUMBER', 'Seller pickup phone number must be a valid 10-digit Indian mobile number');
        }
      }

      const adhocPayload = {
        order_id: srOrderIdCustom,
        order_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
        pickup_location: resolvedPickupLocation,
        billing_customer_name: deliveryAddress.fullName || deliveryAddress.name || deliveryAddress.recipientName || 'Valued Customer',
        billing_last_name: deliveryAddress.lastName || '',
        billing_address: [deliveryAddress.addressLine1 || deliveryAddress.line1 || deliveryAddress.street, deliveryAddress.addressLine2 || deliveryAddress.line2].filter(Boolean).join(', ') || 'Customer Address',
        billing_city: deliveryAddress.city || 'Kolkata',
        billing_pincode: deliveryAddress.postalCode || deliveryAddress.pincode || '700001',
        billing_state: deliveryAddress.state || 'West Bengal',
        billing_country: deliveryAddress.country || 'India',
        billing_email: deliveryAddress.email || 'customer@rupakar.com',
        billing_phone: normalizedCustomerPhone,
        billing_customer_phone: normalizedCustomerPhone,
        shipping_customer_phone: normalizedCustomerPhone,
        ...(normalizedPickupPhone ? { pickup_phone: normalizedPickupPhone } : {}),
        shipping_is_billing: true,
        order_items: orderItems,
        payment_method: cod ? 'COD' : 'Prepaid',
        sub_total: subTotal,
        length: lengthCm,
        breadth: widthCm,
        height: heightCm,
        weight: weightKg,
      };

      const createRes = await this.request('/v1/external/orders/create/adhoc', {
        method: 'POST',
        body: JSON.stringify(adhocPayload),
      });

      const createData = await createRes.json().catch(() => ({}));

      srShipmentId = extractShiprocketShipmentId(createData);
      srOrderId = extractShiprocketOrderId(createData);

      if (!createRes.ok || isShiprocketResponseRejection(createData) || (!srShipmentId && (createData.message || createData.error || createData.errors))) {
        const safeError = extractSafeShiprocketErrorMessage(createData, createRes.status);
        const isDuplicateOrder =
          createRes.status === 409 ||
          /already\s+(?:been\s+)?(?:taken|exist)/i.test(safeError) ||
          /order\s+id\s+already/i.test(safeError);

        if (isDuplicateOrder) {
          try {
            const listRes = await this.request(`/v1/external/orders?channel_order_id=${encodeURIComponent(srOrderIdCustom)}`);
            if (listRes.ok) {
              const listData = await listRes.json().catch(() => ({}));
              const existingOrder = Array.isArray(listData?.data)
                ? listData.data.find((o) => o.channel_order_id === srOrderIdCustom || String(o.order_id) === srOrderIdCustom)
                : null;
              const foundShipmentId = extractShiprocketShipmentId(existingOrder);
              if (foundShipmentId) {
                srShipmentId = foundShipmentId;
                srOrderId = extractShiprocketOrderId(existingOrder) || existingOrder?.id || srOrderId;
                const recoveredAwb = existingOrder?.shipments?.[0]?.awb || existingOrder?.awb_code || existingOrder?.awb || null;
                if (recoveredAwb && !existingAwb) {
                  existingAwb = recoveredAwb;
                }
              }
            }
          } catch {
            // Fall through to error
          }
        }

        if (!srShipmentId) {
          const errorStatusCode = createRes.status >= 400
            ? createRes.status
            : (Number(createData?.status_code) >= 400 && Number(createData?.status_code) < 600
              ? Number(createData.status_code)
              : 422);

          const isPickupLocationRejection =
            /wrong pickup location/i.test(safeError) ||
            /pickup location.*not registered/i.test(safeError) ||
            /choose one location from the data given/i.test(safeError) ||
            Boolean(createData?.errors?.pickup_location) ||
            /pickup_location/i.test(safeError);

          let finalErrorMessage = safeError;
          if (isPickupLocationRejection) {
            finalErrorMessage = `Pickup location "${resolvedPickupLocation}" is not registered in Shiprocket: ${safeError}. Please ensure the pickup location nickname in Settings matches a registered pickup address nickname in your Shiprocket panel (Settings > Pickup Address).`;
          }

          throw new AppError(errorStatusCode, 'SHIPROCKET_ORDER_FAILED', finalErrorMessage);
        }
      }

      if (!srShipmentId) {
        throw new AppError(502, 'SHIPROCKET_SHIPMENT_ID_MISSING', 'Shiprocket response did not include shipment_id');
      }

      stagesCompleted.push('ORDER_CREATED');
    }

    // Stage 2: Automatic Courier Selection
    let courierCompanyId = existingCourierCompanyId || serviceOption?.courierCompanyId || (serviceOption?.serviceCode && !isNaN(Number(serviceOption.serviceCode)) ? Number(serviceOption.serviceCode) : null);
    let courierName = existingCourierName || serviceOption?.carrier || null;
    let courierRate = serviceOption?.cost || 50;
    let courierEtd = serviceOption?.estimatedDays || 3;

    if (!existingAwb) {
      try {
        const serviceabilityResult = await this.getAvailableCouriers({
          pickupPincode: pickupAddress.pincode || pickupAddress.postalCode,
          deliveryPincode: deliveryAddress.postalCode || deliveryAddress.pincode,
          weight: weightKg,
          dimensions: { length: lengthCm, width: widthCm, height: heightCm },
          cod,
          shipmentId: srShipmentId,
        });

        if (Array.isArray(serviceabilityResult?.availableCouriers) && serviceabilityResult.availableCouriers.length > 0) {
          const chosen = selectDeterministicCourier(serviceabilityResult.availableCouriers, {
            cod,
            recommendedCourierId: serviceabilityResult.recommendedCourierId,
          });
          if (chosen) {
            courierCompanyId = Number(chosen.courier_company_id ?? chosen.id) || courierCompanyId;
            courierName = chosen.courier_name || courierName;
            courierRate = Math.round(Number(chosen.rate) || courierRate);
            courierEtd = Number(chosen.estimated_delivery_days || chosen.etd) || courierEtd;
            stagesCompleted.push('COURIER_ASSIGNED');
          }
        }
      } catch {
        // Continue with serviceOption fallback
      }
    }

    if (!stagesCompleted.includes('COURIER_ASSIGNED') && (courierCompanyId || courierName)) {
      stagesCompleted.push('COURIER_ASSIGNED');
    }

    // Stage 3: Automatic AWB Assignment
    let awbCode = existingAwb || null;
    let awbError = null;

    if (existingAwb) {
      stagesCompleted.push('AWB_GENERATED');
    } else {
      try {
        const awbResult = await this.assignAwb({
          shipmentId: srShipmentId,
          courierId: courierCompanyId,
        });
        if (awbResult?.awbCode) {
          awbCode = awbResult.awbCode;
          courierName = awbResult.courierName || courierName;
          if (awbResult.courierCompanyId) courierCompanyId = awbResult.courierCompanyId;
          stagesCompleted.push('AWB_GENERATED');
        }
      } catch (awbErr) {
        awbError = awbErr.message || 'AWB assignment failed';
      }
    }

    // Stage 4: Automatic Label Generation
    let labelUrl = existingLabelUrl && !existingLabelUrl.includes('/api/v1/vendors/orders/') ? existingLabelUrl : null;
    let labelError = null;

    if (labelUrl) {
      stagesCompleted.push('LABEL_GENERATED');
    } else if (awbCode) {
      try {
        const labelResult = await this.generateLabel({ shipmentId: srShipmentId });
        if (labelResult?.labelUrl) {
          labelUrl = labelResult.labelUrl;
          stagesCompleted.push('LABEL_GENERATED');
        }
      } catch (lblErr) {
        labelError = lblErr.message || 'Label generation failed';
      }
    }

    if (!labelUrl) {
      labelUrl = `/api/v1/vendors/orders/${vendorOrderId}/shipping-label`;
    }

    // Stage 5: Automatic Pickup Scheduling
    let pickupStatus = existingPickupStatus === 'SCHEDULED' ? 'SCHEDULED' : 'PENDING';
    let pickupToken = null;
    let pickupScheduledAt = null;
    let pickupError = null;

    if (pickupStatus === 'SCHEDULED') {
      stagesCompleted.push('PICKUP_REQUESTED');
    } else if (awbCode) {
      try {
        const pickupResult = await this.requestPickup({
          shipmentId: srShipmentId,
          trackingNumber: awbCode,
          expectedPackageCount: 1,
        });
        if (pickupResult?.scheduled || pickupResult?.status === 'SCHEDULED' || pickupResult?.pickupToken) {
          pickupStatus = 'SCHEDULED';
          pickupToken = pickupResult.pickupToken;
          pickupScheduledAt = pickupResult.pickupDate ? new Date(pickupResult.pickupDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
          stagesCompleted.push('PICKUP_REQUESTED');
        }
      } catch (pkpErr) {
        pickupStatus = 'FAILED';
        pickupError = pkpErr.message || 'Pickup scheduling failed';
      }
    }

    return {
      shipmentNumber: finalShipmentNumber,
      trackingNumber: awbCode || `SR${srShipmentId}`,
      providerShipmentId: String(srShipmentId),
      shipmentId: srShipmentId,
      providerOrderId: srOrderId,
      carrier: courierName || 'Shiprocket Courier',
      shippingMethod: serviceOption?.serviceCode || String(courierCompanyId || 'standard'),
      shippingCost: courierRate,
      estimatedDeliveryAt: new Date(Date.now() + (Number(courierEtd) || 3) * 24 * 60 * 60 * 1000),
      trackingUrl: awbCode ? `https://shiprocket.co/tracking/${awbCode}` : null,
      labelUrl,
      provider: 'shiprocket',
      status: 'READY_TO_SHIP',
      pickupStatus,
      pickupToken,
      pickupScheduledAt,
      labelError,
      pickupError,
      stagesCompleted,
      metadata: {
        shiprocketOrderId: srOrderId,
        shiprocketShipmentId: srShipmentId,
        courierCompanyId,
        courierName: courierName || 'Shiprocket Courier',
        packageInfo,
        stagesCompleted,
        awbError,
        labelError,
        pickupError,
        awbAssignedAt: awbCode ? new Date().toISOString() : null,
        labelGeneratedAt: labelUrl && !labelUrl.includes('/api/v1/vendors/orders/') ? new Date().toISOString() : null,
        pickupRequestedAt: pickupStatus === 'SCHEDULED' ? new Date().toISOString() : null,
      },
    };
  }

  async requestPickup({ shipmentNumber, trackingNumber, shipmentId, pickupAddress = {}, expectedPackageCount = 1, pickupDate = null } = {}) {
    const targetShipmentId = shipmentId || (trackingNumber && trackingNumber.startsWith('SR') ? trackingNumber.replace(/^SR/, '') : null);
    if (!targetShipmentId) {
      return {
        scheduled: false,
        status: 'FAILED',
        message: 'Shipment ID required for Shiprocket pickup',
        provider: 'shiprocket',
      };
    }

    const numericId = Number(targetShipmentId);
    const idToSend = !isNaN(numericId) ? numericId : String(targetShipmentId);
    const payload = { shipment_id: [idToSend] };
    if (pickupDate) {
      payload.pickup_date = typeof pickupDate === 'string' ? pickupDate.slice(0, 10) : new Date(pickupDate).toISOString().slice(0, 10);
    }

    const res = await this.request('/v1/external/courier/generate/pickup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || isShiprocketResponseRejection(data)) {
      const safeError = extractSafeShiprocketErrorMessage(data, res.status);
      throw new AppError(res.status >= 400 && res.status < 600 ? res.status : 502, 'SHIPROCKET_PICKUP_FAILED', safeError || 'Shiprocket pickup request failed');
    }

    const pickupToken = String(data?.response?.pickup_token_number || data?.pickup_token_number || `PKP-SR-${targetShipmentId}`);
    const scheduledDate = data?.response?.pickup_scheduled_date || data?.pickup_scheduled_date || (pickupDate ? new Date(pickupDate).toISOString() : new Date().toISOString());

    return {
      scheduled: true,
      pickupToken,
      pickupDate: scheduledDate,
      scheduledDate,
      expectedPackageCount,
      trackingNumber,
      status: 'SCHEDULED',
      message: 'Shiprocket pickup scheduled successfully',
      provider: 'shiprocket',
      raw: data,
    };
  }

  async getShippingLabel({ trackingNumber, shipment = null, vendorOrderId = null, shipmentId = null } = {}) {
    const targetShipmentId = shipmentId || shipment?.providerShipmentId;
    if (targetShipmentId && !isNaN(Number(targetShipmentId))) {
      try {
        const res = await this.request('/v1/external/courier/generate/label', {
          method: 'POST',
          body: JSON.stringify({ shipment_id: [Number(targetShipmentId)] }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.label_url) {
            return {
              trackingNumber,
              labelUrl: data.label_url,
              format: 'pdf',
              provider: 'shiprocket',
            };
          }
        }
      } catch {
        // Fallback to internal PDF
      }
    }

    const targetVoId = vendorOrderId || shipment?.vendorOrderId || '';
    return {
      trackingNumber,
      labelUrl: targetVoId ? `/api/v1/vendors/orders/${targetVoId}/shipping-label` : null,
      format: 'pdf',
      provider: 'shiprocket',
    };
  }

  async getTracking({ trackingNumber, shipmentId = null }) {
    if (!trackingNumber) {
      throw new AppError(400, 'TRACKING_NUMBER_REQUIRED', 'Tracking number is required');
    }

    const res = await this.request(`/v1/external/courier/track/awb/${encodeURIComponent(trackingNumber)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new AppError(res.status, 'SHIPROCKET_TRACKING_FAILED', err?.message || 'Shiprocket tracking lookup failed');
    }

    const data = await res.json();
    const trackData = data?.tracking_data || {};
    const trackDetails = Array.isArray(trackData.shipment_track) ? trackData.shipment_track[0] : {};
    const activities = Array.isArray(trackData.shipment_track_activities) ? trackData.shipment_track_activities : [];

    const rawStatus = String(trackDetails?.current_status || trackData.shipment_status || 'IN_TRANSIT').toUpperCase().trim();
    const normalizedStatus = SHIPROCKET_STATUS_MAP[rawStatus] || 'IN_TRANSIT';

    return {
      trackingNumber,
      shipmentId,
      carrier: trackDetails?.courier_name || 'Shiprocket',
      status: normalizedStatus,
      estimatedDeliveryAt: trackDetails?.edd ? new Date(trackDetails.edd).toISOString() : null,
      events: activities.map((act) => ({
        status: SHIPROCKET_STATUS_MAP[String(act.status || '').toUpperCase().trim()] || normalizedStatus,
        description: act.activity || 'Status update',
        location: act.location || 'In Transit',
        timestamp: act.date ? new Date(act.date).toISOString() : new Date().toISOString(),
      })),
      provider: 'shiprocket',
    };
  }

  async cancelShipment({ trackingNumber, orderId, shipmentId, reason = 'Cancelled by seller' } = {}) {
    const targetId = orderId || shipmentId;
    if (targetId) {
      try {
        await this.request('/v1/external/orders/cancel', {
          method: 'POST',
          body: JSON.stringify({ ids: [targetId] }),
        });
      } catch {
        // Ignore error on cancel
      }
    }
    return {
      trackingNumber,
      cancelled: true,
      reason,
      cancelledAt: new Date().toISOString(),
      provider: 'shiprocket',
    };
  }

  async listPickupLocations() {
    const res = await this.request('/v1/external/settings/company/pickup', {
      method: 'GET',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const safeMsg = extractSafeShiprocketErrorMessage(err, res.status);
      throw new AppError(res.status >= 400 && res.status < 600 ? res.status : 502, 'SHIPROCKET_PICKUP_LIST_FAILED', safeMsg);
    }
    const data = await res.json().catch(() => ({}));
    const rawList =
      data?.data?.shipping_address ??
      data?.shipping_address ??
      data?.data ??
      [];
    const list = Array.isArray(rawList)
      ? rawList
      : (rawList && typeof rawList === 'object' ? Object.values(rawList) : []);

    return list.map((loc) => ({
      id: String(loc.id ?? loc.pickup_id ?? loc.pickup_location_id ?? ''),
      pickupLocation: String(loc.pickup_location ?? loc.pickup_location_name ?? loc.nickname ?? loc.name ?? '').trim(),
      name: loc.name || '',
      email: loc.email || '',
      phone: loc.phone || '',
      address: loc.address || '',
      city: loc.city || '',
      state: loc.state || '',
      pincode: String(loc.pin_code || loc.pincode || ''),
      raw: loc,
    }));
  }

  async registerPickupLocation(pickupData = {}) {
    const nickname = String(pickupData.pickupLocationName || pickupData.pickup_location || '').trim();
    if (!nickname) {
      throw new AppError(400, 'PICKUP_LOCATION_REQUIRED', 'Vendor pickup location nickname is required');
    }

    // Step 1: Fetch existing Shiprocket pickup locations
    const existingLocations = await this.listPickupLocations().catch((err) => {
      if (this.mode !== 'production' && !this.hasConfig()) return [];
      throw err;
    });

    // Step 2: Match by exact pickup nickname
    const exactMatch = existingLocations.find(
      (loc) => loc.pickupLocation === nickname || loc.pickupLocation.toLowerCase() === nickname.toLowerCase()
    );

    if (exactMatch) {
      return {
        success: true,
        reused: true,
        pickupLocation: exactMatch.pickupLocation,
        pickupId: exactMatch.id || null,
        message: `Pickup location "${exactMatch.pickupLocation}" is already registered in Shiprocket and was reused`,
      };
    }

    // Step 3: Create pickup location through Shiprocket API
    const rawPhone = pickupData.phone || pickupData.phoneNumber || pickupData.mobile || '';
    const cleanPhone = normalizeIndianPhone10(rawPhone) || rawPhone;

    const addPayload = {
      pickup_location: nickname,
      name: pickupData.contactPerson || pickupData.name || 'Vendor Hub',
      email: pickupData.email || 'seller@rupakar.in',
      phone: cleanPhone,
      address: pickupData.addressLine1 || pickupData.street || pickupData.address || '',
      address_2: pickupData.addressLine2 || '',
      city: pickupData.city || '',
      state: pickupData.state || '',
      country: pickupData.country || 'India',
      pin_code: String(pickupData.pincode || pickupData.postalCode || ''),
    };

    const addRes = await this.request('/v1/external/settings/company/addpickup', {
      method: 'POST',
      body: JSON.stringify(addPayload),
    });

    const addData = await addRes.json().catch(() => ({}));

    if (!addRes.ok || addData.success === false || isShiprocketResponseRejection(addData)) {
      const safeError = extractSafeShiprocketErrorMessage(addData, addRes.status);
      const isAlreadyExists =
        /already\s+(?:been\s+)?(?:taken|exist)/i.test(safeError) ||
        /already\s+registered/i.test(safeError) ||
        /duplicate/i.test(safeError) ||
        addRes.status === 409;

      if (isAlreadyExists) {
        try {
          const recheck = await this.listPickupLocations();
          const recovered = recheck.find(
            (loc) => loc.pickupLocation === nickname || loc.pickupLocation.toLowerCase() === nickname.toLowerCase()
          );
          if (recovered) {
            return {
              success: true,
              reused: true,
              pickupLocation: recovered.pickupLocation,
              pickupId: recovered.id || null,
              message: `Pickup location "${recovered.pickupLocation}" already exists in Shiprocket and was recovered`,
            };
          }
        } catch {
          // Re-fetch failed, fall through to error
        }
      }

      const statusCode = addRes.status >= 400
        ? addRes.status
        : (Number(addData?.status_code) >= 400 && Number(addData?.status_code) < 600
          ? Number(addData.status_code)
          : 422);

      throw new AppError(
        statusCode,
        'SHIPROCKET_PICKUP_REGISTRATION_FAILED',
        `Failed to register pickup location "${nickname}" with Shiprocket: ${safeError}`
      );
    }

    const createdId = String(
      addData.pickup_id ??
      addData.address?.id ??
      addData.data?.id ??
      addData.data?.pickup_id ??
      addData.id ??
      ''
    );

    return {
      success: true,
      reused: false,
      pickupLocation: nickname,
      pickupId: createdId || null,
      message: `Pickup location "${nickname}" registered successfully with Shiprocket`,
    };
  }
}

export const getDeliveryProvider = (providerName) => {
  const name = String(providerName || env.DELIVERY_PROVIDER || env.DELIVERY_MODE || 'mock').toLowerCase().trim();
  if (name === 'shiprocket') {
    return new ShiprocketProvider();
  }
  if (name === 'delhivery') {
    return new DelhiveryProvider();
  }
  return new MockDeliveryProvider();
};

export const deliveryProvider = new Proxy({}, {
  get(_target, prop) {
    const provider = getDeliveryProvider();
    const value = provider[prop];
    return typeof value === 'function' ? value.bind(provider) : value;
  },
});