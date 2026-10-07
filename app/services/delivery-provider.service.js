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

export class DeliveryProvider {
  async checkServiceability(_params) {
    throw new Error('checkServiceability must be implemented by provider');
  }
  async getShippingRates(_params) {
    throw new Error('getShippingRates must be implemented by provider');
  }
  async createShipment(_params) {
    throw new Error('createShipment must be implemented by provider');
  }
  async generateAwb(_params) {
    throw new Error('generateAwb must be implemented by provider');
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

  async generateAwb({ count = 1 } = {}) {
    const awbs = [];
    for (let i = 0; i < count; i++) {
      awbs.push(`RUP${Date.now().toString().slice(-7)}${crypto.randomBytes(3).toString('hex').toUpperCase()}IN`);
    }
    return count === 1 ? awbs[0] : awbs;
  }

  async createShipment({ shipmentNumber, order = {}, vendorOrder = {}, packageInfo = {}, serviceOption = null } = {}) {
    const finalShipmentNumber = shipmentNumber || `SHIP-${Date.now().toString(36).toUpperCase()}`;
    const trackingNumber = await this.generateAwb({ count: 1 });
    const carrier = serviceOption?.carrier || 'Rupakar Express Logistics';
    const shippingMethod = serviceOption?.serviceCode || 'standard_surface';
    const shippingCost = serviceOption?.cost ?? (env.SHIPPING_BASE_FEE || 50);
    const estimatedDays = serviceOption?.estimatedDays || 3;
    const estimatedDeliveryAt = new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000);

    return {
      shipmentNumber: finalShipmentNumber,
      trackingNumber,
      providerShipmentId: `MSHP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      carrier,
      shippingMethod,
      shippingCost,
      estimatedDeliveryAt,
      trackingUrl: `${env.FRONTEND_URL || 'http://localhost:3000'}/account/orders/${order?._id || ''}`,
      labelUrl: `/api/v1/vendors/orders/${vendorOrder?._id || ''}/shipping-label`,
      provider: 'mock',
      status: 'READY_TO_SHIP',
      metadata: {
        packageInfo,
        simulatedAt: new Date().toISOString(),
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

  async generateAwb({ shipmentId, courierId = null } = {}) {
    if (!shipmentId) throw new AppError(400, 'SHIPMENT_ID_REQUIRED', 'Shipment ID required to generate Shiprocket AWB');
    const res = await this.request('/v1/external/courier/assign/awb', {
      method: 'POST',
      body: JSON.stringify({
        shipment_id: shipmentId,
        ...(courierId ? { courier_id: courierId } : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new AppError(res.status, 'SHIPROCKET_AWB_FAILED', err?.message || 'Shiprocket AWB assignment failed');
    }
    const data = await res.json();
    return data?.response?.data?.awb_code || data?.awb_code || null;
  }

  async createShipment(payload = {}) {
    const {
      shipmentNumber,
      orderId,
      orderNumber,
      vendorOrderId,
      pickupAddress = {},
      deliveryAddress = {},
      packageInfo = {},
      items = [],
      cod = false,
      serviceOption = null,
    } = payload;

    const finalShipmentNumber = shipmentNumber || `SHIP-${Date.now().toString(36).toUpperCase()}`;
    const weightKg = Math.max(0.1, Number(packageInfo?.weight) || 0.5);
    const lengthCm = Math.max(1, Number(packageInfo?.length) || 15);
    const widthCm = Math.max(1, Number(packageInfo?.width) || 10);
    const heightCm = Math.max(1, Number(packageInfo?.height) || 5);

    const orderItems = (Array.isArray(items) && items.length > 0
      ? items
      : [{ productName: 'Artisan Handicraft', quantity: 1, unitPrice: 500 }]
    ).map((it, idx) => ({
      name: it.productName || it.title || it.name || `Item ${idx + 1}`,
      sku: it.sku || `SKU-${it.variantId || idx + 1}`,
      units: Number(it.quantity) || 1,
      selling_price: Number(it.unitPrice || it.price) || 100,
    }));

    const subTotal = orderItems.reduce((acc, it) => acc + (it.units * it.selling_price), 0);
    const orderIdStr = String(orderNumber || orderId || Date.now());
    const srOrderIdCustom = vendorOrderId ? `${orderIdStr}-VO-${String(vendorOrderId).slice(-6)}` : orderIdStr;

    const resolvedPickupLocation = (pickupAddress.pickupLocationName || '').trim() || (pickupAddress.city || '').trim() || (this.mode === 'production' ? '' : 'Primary');
    if (!resolvedPickupLocation) {
      throw new AppError(400, 'PICKUP_LOCATION_REQUIRED', 'Vendor pickup location nickname is required for Shiprocket shipment creation');
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

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new AppError(createRes.status, 'SHIPROCKET_ORDER_FAILED', err?.message || `Shiprocket order creation failed with status ${createRes.status}`);
    }

    const createData = await createRes.json();
    const srOrderId = createData.order_id;
    const srShipmentId = createData.shipment_id;

    if (!srShipmentId) {
      throw new AppError(502, 'SHIPROCKET_SHIPMENT_ID_MISSING', 'Shiprocket response did not include shipment_id');
    }

    // Step 2: Assign Courier & AWB
    let awbCode = null;
    let courierName = serviceOption?.carrier || null;
    const courierCompanyId = serviceOption?.courierCompanyId || (serviceOption?.serviceCode && !isNaN(Number(serviceOption.serviceCode)) ? Number(serviceOption.serviceCode) : null);

    try {
      const awbRes = await this.request('/v1/external/courier/assign/awb', {
        method: 'POST',
        body: JSON.stringify({
          shipment_id: srShipmentId,
          ...(courierCompanyId ? { courier_id: courierCompanyId } : {}),
        }),
      });

      if (awbRes.ok) {
        const awbData = await awbRes.json();
        awbCode = awbData?.response?.data?.awb_code || awbData?.awb_code || null;
        courierName = awbData?.response?.data?.courier_name || courierName;
      }
    } catch {
      // Continue if AWB assignment is async/pending
    }

    // Step 3: Fetch label if available
    let labelUrl = null;
    try {
      const labelRes = await this.request('/v1/external/courier/generate/label', {
        method: 'POST',
        body: JSON.stringify({ shipment_id: [srShipmentId] }),
      });
      if (labelRes.ok) {
        const labelData = await labelRes.json();
        labelUrl = labelData?.label_url || null;
      }
    } catch {
      // Fallback to internal PDF
    }

    // Step 4: Request pickup
    let pickupStatus = 'PENDING';
    let pickupToken = null;
    let pickupScheduledAt = null;
    try {
      const pickupRes = await this.request('/v1/external/couriers/generate/pickup', {
        method: 'POST',
        body: JSON.stringify({ shipment_id: [srShipmentId] }),
      });
      if (pickupRes.ok) {
        const pickupData = await pickupRes.json();
        if (pickupData?.pickup_status === 1 || pickupData?.response?.pickup_token_number) {
          pickupStatus = 'SCHEDULED';
          pickupToken = String(pickupData.response?.pickup_token_number || `PKP-SR-${srShipmentId}`);
          pickupScheduledAt = pickupData.response?.pickup_scheduled_date ? new Date(pickupData.response.pickup_scheduled_date) : new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
      }
    } catch {
      // Pickup remains pending for retry
    }

    return {
      shipmentNumber: finalShipmentNumber,
      trackingNumber: awbCode || `SR${srShipmentId}`,
      providerShipmentId: String(srShipmentId),
      carrier: courierName || 'Shiprocket Courier',
      shippingMethod: serviceOption?.serviceCode || 'standard',
      shippingCost: serviceOption?.cost || 50,
      estimatedDeliveryAt: new Date(Date.now() + (serviceOption?.estimatedDays || 3) * 24 * 60 * 60 * 1000),
      trackingUrl: awbCode ? `https://shiprocket.co/tracking/${awbCode}` : null,
      labelUrl: labelUrl || `/api/v1/vendors/orders/${vendorOrderId}/shipping-label`,
      provider: 'shiprocket',
      status: 'READY_TO_SHIP',
      pickupStatus,
      pickupToken,
      pickupScheduledAt,
      metadata: {
        shiprocketOrderId: srOrderId,
        shiprocketShipmentId: srShipmentId,
        courierCompanyId,
        packageInfo,
      },
    };
  }

  async requestPickup({ shipmentNumber, trackingNumber, shipmentId, pickupAddress = {}, expectedPackageCount = 1 } = {}) {
    const targetShipmentId = shipmentId || (trackingNumber && trackingNumber.startsWith('SR') ? trackingNumber.replace(/^SR/, '') : null);
    if (!targetShipmentId) {
      return {
        scheduled: false,
        status: 'FAILED',
        message: 'Shipment ID required for Shiprocket pickup',
        provider: 'shiprocket',
      };
    }

    const res = await this.request('/v1/external/couriers/generate/pickup', {
      method: 'POST',
      body: JSON.stringify({ shipment_id: [Number(targetShipmentId)] }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new AppError(res.status, 'SHIPROCKET_PICKUP_FAILED', err?.message || 'Shiprocket pickup request failed');
    }

    const data = await res.json();
    const pickupToken = String(data?.response?.pickup_token_number || `PKP-SR-${targetShipmentId}`);
    const pickupDate = data?.response?.pickup_scheduled_date || new Date().toISOString();

    return {
      scheduled: true,
      pickupToken,
      pickupDate,
      expectedPackageCount,
      trackingNumber,
      status: 'SCHEDULED',
      message: 'Shiprocket pickup scheduled successfully',
      provider: 'shiprocket',
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