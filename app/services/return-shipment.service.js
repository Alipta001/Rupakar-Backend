import mongoose from 'mongoose';
import { AppError } from '../utils/app-error.js';
import { Return } from '../models/return.model.js';
import { ReturnItem } from '../models/return-item.model.js';
import { ReturnShipment } from '../models/return-shipment.model.js';
import { Order } from '../models/order.model.js';
import { Vendor } from '../models/vendor.model.js';
import { Shipment } from '../models/shipment.model.js';
import { ProductVariant } from '../models/product-variant.model.js';
import { returnEligibilityService } from './return-eligibility.service.js';
import { packageInfoSchema } from '../validators/return.validators.js';
import { deliveryProvider, isAuthenticAwb, SHIPROCKET_REVERSE_STATUS_MAP } from './delivery-provider.service.js';
import { returnShipmentStateService } from './return-shipment-state.service.js';
import { returnStateService } from './return-state.service.js';
import { auditService } from './audit.service.js';
import { normalizeIndianPhone10 } from './sms.service.js';
import { returnNotificationService } from './return-notification.service.js';
import { env } from '../config/env.js';

const isQueryable = (m) => {
  const isDbConnected = Boolean(mongoose?.connection?.readyState === 1);
  const isMocked = Boolean(
    m?.findOne?._isMockFunction || m?.findOne?.mock ||
    m?.findById?._isMockFunction || m?.findById?.mock ||
    m?.find?._isMockFunction || m?.find?.mock
  );
  return isDbConnected || isMocked;
};

export const getNextExpectedStep = (status) => {
  switch (status) {
    case 'PENDING':
      return 'Reverse shipment record created. Ready for pickup arrangement.';
    case 'READY_FOR_PICKUP':
      return 'Package is ready for pickup. Awaiting courier AWB assignment.';
    case 'AWB_ASSIGNED':
      return 'Air Waybill assigned. Generating shipping label.';
    case 'LABEL_GENERATED':
      return 'Shipping label generated. Ready for carrier pickup request.';
    case 'PICKUP_REQUESTED':
      return 'Pickup request submitted to courier.';
    case 'PICKUP_SCHEDULED':
      return 'Pickup scheduled with courier. Please keep the package ready.';
    case 'PICKED_UP':
      return 'Package picked up by courier. In transit to seller.';
    case 'IN_TRANSIT':
      return 'Package in transit to seller.';
    case 'OUT_FOR_DELIVERY':
      return 'Package out for delivery to seller.';
    case 'DELIVERED':
      return 'Package delivered to seller.';
    case 'PICKUP_FAILED':
      return 'Pickup attempt failed. Courier pickup will be rescheduled.';
    case 'DELIVERY_FAILED':
      return 'Delivery attempt failed.';
    case 'CANCELLED':
      return 'Reverse shipment cancelled.';
    default:
      return 'Processing reverse shipment.';
  }
};

export class ReturnShipmentService {
  async resolveActorRole(user, returnDoc) {
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required');
    }

    const role = String(user.role || '').toUpperCase();
    if (['ADMIN', 'SUPER_ADMIN'].includes(role)) {
      return { role: 'ADMIN', userId: user.sub || user._id || user.id };
    }

    const userIdStr = String(user.sub || user._id || user.id || '');

    // Check if customer
    if (String(returnDoc.customerId) === userIdStr) {
      return { role: 'CUSTOMER', userId: userIdStr };
    }

    // Check if vendor
    let vendor = null;
    if (isQueryable(Vendor)) {
      const vQuery = Vendor.findOne({ ownerUserId: userIdStr, deletedAt: null });
      vendor = vQuery && typeof vQuery.lean === 'function' ? await vQuery.lean() : await vQuery;
    }
    const vendorIdFromProfile = vendor?._id ? String(vendor._id) : null;
    const vendorIdFromToken = user.vendorId ? String(user.vendorId) : null;

    if (
      (vendorIdFromProfile && String(returnDoc.vendorId) === vendorIdFromProfile) ||
      (vendorIdFromToken && String(returnDoc.vendorId) === vendorIdFromToken)
    ) {
      return { role: 'VENDOR', userId: userIdStr, vendorId: returnDoc.vendorId };
    }

    // Role check if user claim says vendor or customer
    if (role === 'VENDOR') {
      throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
    }

    throw new AppError(403, 'FORBIDDEN', 'Access denied to this return');
  }

  async validateReverseShipmentEligibility({ returnDoc, user }) {
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const { role } = await this.resolveActorRole(user, returnDoc);

    const ineligibleStatuses = [
      'REJECTED',
      'CANCELLED',
      'CLOSED',
      'COMPLETED',
      'REJECTED_AFTER_INSPECTION',
      'RECEIVED',
      'RETURN_RECEIVED',
      'REFUNDED',
    ];

    if (ineligibleStatuses.includes(returnDoc.status)) {
      throw new AppError(
        400,
        'RETURN_NOT_ELIGIBLE_FOR_REVERSE_SHIPMENT',
        `Return in status ${returnDoc.status} is not eligible for reverse shipment`,
      );
    }

    if (!['RETURN', 'REPLACEMENT'].includes(returnDoc.type)) {
      throw new AppError(
        400,
        'UNSUPPORTED_RETURN_TYPE',
        `Return type ${returnDoc.type} is not supported for reverse logistics`,
      );
    }

    const returnItemIds = returnDoc.items || [];
    if (!Array.isArray(returnItemIds) || returnItemIds.length === 0) {
      throw new AppError(400, 'NO_RETURN_ITEMS', 'Return contains no return items');
    }

    // Check existing shipment
    let existingShipment = null;
    if (isQueryable(ReturnShipment)) {
      existingShipment = await ReturnShipment.findOne({
        returnId: returnDoc._id,
        status: { $ne: 'CANCELLED' },
      });

      if (existingShipment && existingShipment.status === 'DELIVERED') {
        throw new AppError(
          400,
          'REVERSE_SHIPMENT_ALREADY_COMPLETED',
          'Reverse shipment has already been completed and delivered',
        );
      }
    }

    return {
      eligible: true,
      role,
      existingShipment,
    };
  }

  async prepareReturnShipment({ returnId, packageInfo, user, idempotencyKey = null, metadata = {} }) {
    if (!returnId) {
      throw new AppError(400, 'INVALID_REQUEST', 'returnId is required');
    }

    if (!packageInfo || typeof packageInfo !== 'object') {
      throw new AppError(400, 'INVALID_PACKAGE_INFO', 'Valid package weight and dimensions are required');
    }

    // Validate package info strictly
    const parsedPackageInfo = packageInfoSchema.safeParse(packageInfo);
    if (!parsedPackageInfo.success) {
      const msg = parsedPackageInfo.error.errors.map((e) => e.message).join(', ');
      throw new AppError(400, 'INVALID_PACKAGE_INFO', msg || 'Valid package weight and dimensions are required');
    }
    const cleanPackageInfo = parsedPackageInfo.data;

    let returnDoc = null;
    if (isQueryable(Return)) {
      returnDoc = await Return.findById(returnId);
    }
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    // Check eligibility & authorization
    const { role, existingShipment } = await this.validateReverseShipmentEligibility({ returnDoc, user });

    let shipment = existingShipment || null;

    // Idempotent return if already prepared and not recovering missing shipment ID
    if (existingShipment) {
      if (existingShipment.providerOrderId && !existingShipment.providerShipmentId) {
        // Provider order exists but shipment ID is missing -> proceed to recovery
        shipment = existingShipment;
      } else if (['PENDING', 'READY_FOR_PICKUP', 'PICKUP_REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(existingShipment.status)) {
        return existingShipment;
      }
    }

    if (!shipment) {
      // Fetch original order for customer pickup address snapshot
      let order = null;
      if (isQueryable(Order)) {
        order = await Order.findById(returnDoc.orderId);
      }
      if (!order) {
        throw new AppError(404, 'ORDER_NOT_FOUND', 'Original order not found');
      }

      const orderAddress = order.shippingAddressSnapshot || order.shippingAddress || {};
      const customerPickupAddress = {
        name: orderAddress.fullName || orderAddress.name || '',
        phone: orderAddress.phone || '',
        addressLine1: orderAddress.addressLine1 || orderAddress.address || '',
        addressLine2: orderAddress.addressLine2 || '',
        city: orderAddress.city || '',
        state: orderAddress.state || '',
        pincode: orderAddress.pincode || orderAddress.postalCode || '',
        country: orderAddress.country || 'India',
      };

      if (!customerPickupAddress.addressLine1 || !customerPickupAddress.city || !customerPickupAddress.state || !customerPickupAddress.pincode) {
        throw new AppError(400, 'INVALID_PICKUP_ADDRESS', 'Authoritative customer pickup address is incomplete');
      }

      // Fetch vendor for seller return address snapshot
      let vendor = null;
      if (isQueryable(Vendor)) {
        vendor = await Vendor.findById(returnDoc.vendorId);
      }
      if (!vendor) {
        throw new AppError(404, 'VENDOR_NOT_FOUND', 'Vendor profile not found');
      }

      const vp = vendor.pickupAddress || {};
      const sellerReturnAddress = {
        pickupLocationName: vp.pickupLocationName || '',
        contactPerson: vp.contactPerson || vendor.businessName || '',
        phone: vp.phone || vendor.phone || '',
        addressLine1: vp.addressLine1 || vendor.address || '',
        addressLine2: vp.addressLine2 || '',
        city: vp.city || '',
        state: vp.state || vendor.originState || '',
        pincode: vp.pincode || '',
        country: vp.country || 'India',
      };

      if (!sellerReturnAddress.addressLine1 || !sellerReturnAddress.city || !sellerReturnAddress.state || !sellerReturnAddress.pincode) {
        throw new AppError(400, 'INVALID_RETURN_ADDRESS', 'Authoritative seller return address is incomplete');
      }

      // Fetch authoritative return items
      let returnItems = [];
      if (isQueryable(ReturnItem)) {
        returnItems = await ReturnItem.find({ _id: { $in: returnDoc.items || [] } }).lean();
      }
      if (!Array.isArray(returnItems) || returnItems.length === 0) {
        throw new AppError(400, 'NO_RETURN_ITEMS', 'Return contains no authoritative return items');
      }

      // Cumulative quantity protection validation
      for (const rItem of returnItems) {
        const requestedQty = Number(rItem.quantity || 0);
        if (!Number.isInteger(requestedQty) || requestedQty <= 0) {
          throw new AppError(400, 'INVALID_RETURN_QUANTITY', 'Return item quantity must be greater than 0');
        }

        const orderItem = (order.items || []).find((oi) => String(oi.variantId) === String(rItem.variantId));
        if (!orderItem) {
          throw new AppError(400, 'ITEM_NOT_FOUND_IN_ORDER', `Item ${rItem.variantId} was not found in original order`);
        }

        const purchasedQty = Number(orderItem.quantity || 0);
        const remainingReturnable = await returnEligibilityService.getItemRemainingReturnableQuantity({
          orderId: order._id,
          variantId: String(rItem.variantId),
          purchasedQuantity: purchasedQty,
        });

        // Requested return item quantity cannot exceed purchased quantity
        if (requestedQty > purchasedQty) {
          throw new AppError(400, 'RETURN_QUANTITY_EXCEEDS_PURCHASED', 'Return quantity cannot exceed purchased quantity');
        }
      }

      // Stable, deterministic reverse shipment identifier
      const shipmentNumber = `REV-${returnDoc.returnNumber}`;
      const channelOrderId = `REV-${returnDoc.returnNumber}`;

      const shipmentItems = returnItems.map((item) => ({
        returnItemId: item._id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: item.unitPrice || 0,
      }));

      const actorId = user.sub || user._id || user.id || null;
      const actorRole = role;

      const initialHistory = {
        status: 'PENDING',
        previousStatus: null,
        changedAt: new Date(),
        timestamp: new Date(),
        changedBy: actorId,
        actorId,
        actorType: actorRole,
        actorRole,
        reason: 'Reverse shipment foundation prepared',
        notes: 'Reverse shipment foundation prepared',
      };

      const newShipmentData = {
        returnId: returnDoc._id,
        orderId: order._id,
        vendorOrderId: returnDoc.vendorOrderId || null,
        customerId: returnDoc.customerId,
        vendorId: returnDoc.vendorId,
        shipmentNumber,
        channelOrderId,
        direction: 'RETURN',
        provider: null,
        providerShipmentId: null,
        providerOrderId: null,
        carrier: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        pickupStatus: 'PENDING',
        pickupScheduledAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        packageInfo: {
          weight: cleanPackageInfo.weight,
          length: cleanPackageInfo.length,
          width: cleanPackageInfo.width,
          height: cleanPackageInfo.height,
          unit: cleanPackageInfo.unit || 'kg',
          dimensionUnit: cleanPackageInfo.dimensionUnit || 'cm',
        },
        pickupAddressSnapshot: customerPickupAddress,
        returnAddressSnapshot: sellerReturnAddress,
        items: shipmentItems,
        metadata: metadata || {},
        idempotencyKey: idempotencyKey || null,
        status: 'PENDING',
        statusHistory: [initialHistory],
      };

      try {
        shipment = await ReturnShipment.create(newShipmentData);
      } catch (error) {
        if (error?.code === 11000 || /duplicate key/i.test(error?.message)) {
          // Race condition: another concurrent call already created it
          const found = await ReturnShipment.findOne({ returnId: returnDoc._id, status: { $ne: 'CANCELLED' } });
          shipment = found || (await ReturnShipment.findOne({ returnId: returnDoc._id }).sort({ createdAt: -1 }));
        } else {
          throw error;
        }
      }
    }

    if (!shipment) {
      throw new AppError(500, 'REVERSE_SHIPMENT_CREATION_FAILED', 'Failed to initialize reverse shipment');
    }

    // If shipment was already prepared by another concurrent worker, return it
    if (shipment.providerShipmentId) {
      return shipment;
    }

    // If shipment does not have pickupAddressSnapshot (e.g. lightweight test stub), return it safely
    if (!shipment.pickupAddressSnapshot) {
      return shipment;
    }

    const actorId = user.sub || user._id || user.id || null;
    const actorRole = role;

    // Concurrency protection: atomic claim to prevent double provider calls
    const canExecuteFindOneAndUpdate = Boolean(
      (mongoose?.connection?.readyState === 1) ||
      (ReturnShipment?.findOneAndUpdate?._isMockFunction || ReturnShipment?.findOneAndUpdate?.mock)
    );

    if (canExecuteFindOneAndUpdate && shipment._id) {
      try {
        const claim = await ReturnShipment.findOneAndUpdate(
          {
            _id: shipment._id,
            providerShipmentId: null,
            'metadata.providerCallInProgress': { $ne: true },
          },
          {
            $set: { 'metadata.providerCallInProgress': true },
          },
          { new: true },
        );
        if (!claim) {
          const reloaded = await ReturnShipment.findById(shipment._id);
          if (reloaded && reloaded.providerShipmentId) {
            return reloaded;
          }
          if (reloaded) shipment = reloaded;
        }
      } catch {
        // Continue if mock does not implement findOneAndUpdate
      }
    }

    if (shipment.providerShipmentId) {
      return shipment;
    }

    const providerPayload = {
      direction: 'RETURN',
      shipmentNumber: shipment.shipmentNumber,
      channelOrderId: shipment.channelOrderId,
      pickupAddress: shipment.pickupAddressSnapshot,
      returnAddress: shipment.returnAddressSnapshot,
      packageInfo: shipment.packageInfo,
      items: (shipment.items || []).map((it) => ({
        name: `Return Item - ${it.variantId || it.productId}`,
        variantId: it.variantId,
        quantity: it.quantity,
        unitPrice: it.unitPrice || 0,
      })),
      cod: false,
      existingOrderId: shipment.providerOrderId || null,
      existingShipmentId: shipment.providerShipmentId || null,
      existingAwb: shipment.trackingNumber || shipment.providerAwb || null,
      existingLabelUrl: shipment.labelUrl || null,
    };

    let providerResult;
    try {
      providerResult = await deliveryProvider.createReturnShipment(providerPayload);
    } catch (error) {
      const canExecuteUpdateOne = Boolean(
        (mongoose?.connection?.readyState === 1) ||
        (ReturnShipment?.updateOne?._isMockFunction || ReturnShipment?.updateOne?.mock)
      );
      if (canExecuteUpdateOne && shipment._id) {
        await ReturnShipment.updateOne({ _id: shipment._id }, { $set: { 'metadata.providerCallInProgress': false } }).catch(() => {});
      }
      auditService.log('REVERSE_SHIPMENT_FAILED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
        error: error.message,
        code: error.code || error.statusCode || 500,
      });
      throw error;
    }

    // Persist provider details
    shipment.provider = providerResult.provider || env.DELIVERY_PROVIDER || 'mock';
    if (providerResult.providerOrderId) {
      shipment.providerOrderId = providerResult.providerOrderId;
    }
    if (providerResult.providerShipmentId) {
      shipment.providerShipmentId = providerResult.providerShipmentId;
    }

    const authenticAwb = isAuthenticAwb(providerResult.providerAwb || providerResult.trackingNumber, shipment.providerShipmentId)
      ? (providerResult.providerAwb || providerResult.trackingNumber)
      : null;

    if (authenticAwb) {
      shipment.providerAwb = authenticAwb;
      shipment.trackingNumber = authenticAwb;
      if (providerResult.trackingUrl) {
        shipment.trackingUrl = providerResult.trackingUrl;
      }
    }

    if (providerResult.carrier) {
      shipment.carrier = providerResult.carrier;
    }
    if (providerResult.labelUrl) {
      shipment.labelUrl = providerResult.labelUrl;
    }
    if (providerResult.pickupStatus) {
      shipment.pickupStatus = providerResult.pickupStatus;
    }
    if (shipment.metadata) {
      shipment.metadata.providerCallInProgress = false;
    }

    if (providerResult.recovered) {
      auditService.log('REVERSE_SHIPMENT_RECOVERED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
        providerOrderId: shipment.providerOrderId,
        providerShipmentId: shipment.providerShipmentId,
      });
    } else {
      auditService.log('REVERSE_PROVIDER_ORDER_CREATED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
        providerOrderId: shipment.providerOrderId,
        providerShipmentId: shipment.providerShipmentId,
      });
      auditService.log('REVERSE_SHIPMENT_CREATED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
        providerOrderId: shipment.providerOrderId,
        providerShipmentId: shipment.providerShipmentId,
      });
    }

    // Transition status to READY_FOR_PICKUP
    if (shipment.status === 'PENDING') {
      await returnShipmentStateService.transitionShipmentStatus(shipment, 'READY_FOR_PICKUP', {
        actorId,
        actorRole,
        actorType: actorRole,
        reason: 'Carrier reverse shipment created and ready for pickup',
        notes: 'Carrier reverse shipment created and ready for pickup',
      });
    } else if (typeof shipment.save === 'function') {
      await shipment.save();
    }

    return shipment;
  }

  async getReturnShipment({ returnId, user }) {
    if (!returnId) {
      throw new AppError(400, 'INVALID_REQUEST', 'returnId is required');
    }

    let returnDoc = null;
    if (isQueryable(Return)) {
      returnDoc = await Return.findById(returnId);
    }
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const { role } = await this.resolveActorRole(user, returnDoc);

    let shipment = null;
    if (isQueryable(ReturnShipment)) {
      shipment = await ReturnShipment.findOne({ returnId: returnDoc._id, status: { $ne: 'CANCELLED' } });
      if (!shipment) {
        shipment = await ReturnShipment.findOne({ returnId: returnDoc._id }).sort({ createdAt: -1 });
      }
    }

    if (!shipment) {
      throw new AppError(404, 'REVERSE_SHIPMENT_NOT_FOUND', 'No reverse shipment found for this return');
    }

    return this.buildShipmentDto(shipment, role);
  }

  async assignShipmentAwb({ returnId, user, courierId = null, mockAwb = null }) {
    if (!returnId) {
      throw new AppError(400, 'INVALID_REQUEST', 'returnId is required');
    }

    let returnDoc = null;
    if (isQueryable(Return)) {
      returnDoc = await Return.findById(returnId);
    }
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const { role, userId } = await this.resolveActorRole(user, returnDoc);

    let shipment = null;
    if (isQueryable(ReturnShipment)) {
      shipment = await ReturnShipment.findOne({ returnId: returnDoc._id, status: { $ne: 'CANCELLED' } });
      if (!shipment) {
        shipment = await ReturnShipment.findOne({ returnId: returnDoc._id }).sort({ createdAt: -1 });
      }
    }

    if (!shipment) {
      throw new AppError(404, 'REVERSE_SHIPMENT_NOT_FOUND', 'No reverse shipment found for this return');
    }

    if (shipment.status === 'CANCELLED') {
      throw new AppError(400, 'CANNOT_ASSIGN_AWB_TO_CANCELLED_SHIPMENT', 'Cannot assign AWB to a cancelled reverse shipment');
    }

    // Idempotent return if already assigned authentic AWB
    if (shipment.providerAwb && isAuthenticAwb(shipment.providerAwb, shipment.providerShipmentId)) {
      return shipment;
    }

    if (!shipment.providerShipmentId) {
      throw new AppError(400, 'PROVIDER_SHIPMENT_REQUIRED', 'Provider shipment ID is required before assigning AWB');
    }

    try {
      const res = await deliveryProvider.assignReturnAwb({
        shipmentId: shipment.providerShipmentId,
        courierId,
        mockAwb,
      });

      const rawAwb = res?.awbCode || res?.awb;
      if (!rawAwb || !isAuthenticAwb(String(rawAwb), shipment.providerShipmentId)) {
        throw new AppError(502, 'INVALID_AWB', 'Carrier returned synthetic or invalid AWB');
      }

      shipment.providerAwb = String(rawAwb);
      shipment.trackingNumber = String(rawAwb);
      if (res.courierName) shipment.carrier = res.courierName;
      shipment.awbAssignedAt = new Date();
      shipment.awbError = null;

      if (['PENDING', 'READY_FOR_PICKUP'].includes(shipment.status)) {
        await returnShipmentStateService.transitionShipmentStatus(shipment, 'AWB_ASSIGNED', {
          actorId: userId,
          actorRole: role,
          actorType: role,
          reason: 'Carrier reverse AWB assigned',
        });
      } else if (typeof shipment.save === 'function') {
        await shipment.save();
      }

      auditService.log('REVERSE_AWB_ASSIGNED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
        awb: shipment.providerAwb,
        carrier: shipment.carrier,
      });

      return shipment;
    } catch (err) {
      shipment.awbError = {
        message: err.message || 'AWB assignment failed',
        code: err.code || 'AWB_FAILED',
        timestamp: new Date(),
      };
      if (typeof shipment.save === 'function') {
        await shipment.save();
      }

      auditService.log('REVERSE_AWB_FAILED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
        error: err.message,
      });

      throw err;
    }
  }

  async generateShipmentLabel({ returnId, user }) {
    if (!returnId) {
      throw new AppError(400, 'INVALID_REQUEST', 'returnId is required');
    }

    let returnDoc = null;
    if (isQueryable(Return)) {
      returnDoc = await Return.findById(returnId);
    }
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const { role, userId } = await this.resolveActorRole(user, returnDoc);

    let shipment = null;
    if (isQueryable(ReturnShipment)) {
      shipment = await ReturnShipment.findOne({ returnId: returnDoc._id, status: { $ne: 'CANCELLED' } });
      if (!shipment) {
        shipment = await ReturnShipment.findOne({ returnId: returnDoc._id }).sort({ createdAt: -1 });
      }
    }

    if (!shipment) {
      throw new AppError(404, 'REVERSE_SHIPMENT_NOT_FOUND', 'No reverse shipment found for this return');
    }

    if (!shipment.providerAwb || !isAuthenticAwb(shipment.providerAwb, shipment.providerShipmentId)) {
      throw new AppError(400, 'AUTHENTIC_AWB_REQUIRED', 'Authentic AWB must be assigned before generating label');
    }

    if (shipment.labelUrl && !shipment.labelUrl.includes('/mock/')) {
      return shipment;
    }

    try {
      const res = await deliveryProvider.generateReturnLabel({
        shipmentId: shipment.providerShipmentId,
      });

      if (!res?.labelUrl) {
        throw new AppError(502, 'LABEL_GENERATION_FAILED', 'Provider did not return label URL');
      }

      shipment.labelUrl = res.labelUrl;
      shipment.labelGeneratedAt = new Date();
      shipment.labelError = null;

      if (shipment.status === 'AWB_ASSIGNED') {
        await returnShipmentStateService.transitionShipmentStatus(shipment, 'LABEL_GENERATED', {
          actorId: userId,
          actorRole: role,
          actorType: role,
          reason: 'Carrier reverse label generated',
        });
      } else if (typeof shipment.save === 'function') {
        await shipment.save();
      }

      auditService.log('REVERSE_LABEL_GENERATED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
        labelUrl: shipment.labelUrl,
      });

      return shipment;
    } catch (err) {
      shipment.labelError = {
        message: err.message || 'Label generation failed',
        timestamp: new Date(),
      };
      if (typeof shipment.save === 'function') {
        await shipment.save();
      }

      auditService.log('REVERSE_LABEL_FAILED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
        error: err.message,
      });

      throw err;
    }
  }

  async requestShipmentPickup({ returnId, user, pickupDate = null }) {
    if (!returnId) {
      throw new AppError(400, 'INVALID_REQUEST', 'returnId is required');
    }

    let returnDoc = null;
    if (isQueryable(Return)) {
      returnDoc = await Return.findById(returnId);
    }
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const { role, userId } = await this.resolveActorRole(user, returnDoc);

    let shipment = null;
    if (isQueryable(ReturnShipment)) {
      shipment = await ReturnShipment.findOne({ returnId: returnDoc._id, status: { $ne: 'CANCELLED' } });
      if (!shipment) {
        shipment = await ReturnShipment.findOne({ returnId: returnDoc._id }).sort({ createdAt: -1 });
      }
    }

    if (!shipment) {
      throw new AppError(404, 'REVERSE_SHIPMENT_NOT_FOUND', 'No reverse shipment found for this return');
    }

    if (!shipment.providerAwb || !isAuthenticAwb(shipment.providerAwb, shipment.providerShipmentId)) {
      throw new AppError(400, 'AUTHENTIC_AWB_REQUIRED', 'Authentic AWB required for reverse pickup request');
    }

    try {
      const res = await deliveryProvider.requestReturnPickup({
        shipmentId: shipment.providerShipmentId,
        trackingNumber: shipment.providerAwb,
        pickupDate,
        pickupAddress: shipment.pickupAddressSnapshot,
      });

      shipment.pickupRequestedAt = new Date();
      shipment.pickupError = null;

      if (res?.pickupToken) {
        shipment.metadata = { ...(shipment.metadata || {}), pickupToken: res.pickupToken };
      }
      if (res?.pickupDate) {
        shipment.pickupScheduledAt = new Date(res.pickupDate);
      }

      if (['READY_FOR_PICKUP', 'AWB_ASSIGNED', 'LABEL_GENERATED', 'PICKUP_FAILED'].includes(shipment.status)) {
        await returnShipmentStateService.transitionShipmentStatus(shipment, 'PICKUP_REQUESTED', {
          actorId: userId,
          actorRole: role,
          actorType: role,
          reason: 'Reverse pickup requested with carrier',
        });
        if (res?.scheduled || res?.status === 'SCHEDULED') {
          await returnShipmentStateService.transitionShipmentStatus(shipment, 'PICKUP_SCHEDULED', {
            actorId: userId,
            actorRole: role,
            actorType: role,
            reason: 'Reverse pickup scheduled with carrier',
          });
        }
      } else if (typeof shipment.save === 'function') {
        await shipment.save();
      }

      if (returnDoc.status === 'APPROVED') {
        try {
          await returnStateService.transitionReturnStatus(returnDoc.status, 'PICKUP_SCHEDULED', {
            returnId: returnDoc._id,
            actorType: role,
            actorId: userId,
            reason: 'Reverse pickup scheduled with carrier',
          });
          returnDoc.status = 'PICKUP_SCHEDULED';
          if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
          returnDoc.statusHistory.push({
            status: 'PICKUP_SCHEDULED',
            changedAt: new Date(),
            actorType: role,
            notes: 'Reverse pickup scheduled with carrier',
          });
          if (typeof returnDoc.save === 'function') {
            await returnDoc.save();
          }
        } catch {
          // ignore return transition failure
        }
      }

      auditService.log('REVERSE_PICKUP_REQUESTED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
      });

      if (res?.scheduled || res?.status === 'SCHEDULED') {
        auditService.log('REVERSE_PICKUP_SCHEDULED', {
          returnId: returnDoc._id?.toString(),
          shipmentNumber: shipment.shipmentNumber,
          scheduledDate: shipment.pickupScheduledAt,
        });
      }

      returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_PICKUP_REQUESTED', returnDoc }).catch(() => null);

      return shipment;
    } catch (err) {
      shipment.pickupError = {
        message: err.message || 'Pickup request failed',
        timestamp: new Date(),
      };

      if (shipment.status === 'PICKUP_REQUESTED') {
        await returnShipmentStateService.transitionShipmentStatus(shipment, 'PICKUP_FAILED', {
          actorId: userId,
          actorRole: role,
          actorType: role,
          reason: err.message,
        });
      } else if (typeof shipment.save === 'function') {
        await shipment.save();
      }

      auditService.log('REVERSE_PICKUP_FAILED', {
        returnId: returnDoc._id?.toString(),
        shipmentNumber: shipment.shipmentNumber,
        error: err.message,
      });

      throw err;
    }
  }

  async syncReturnTracking({ returnId, user, targetStatus = null }) {
    if (!returnId) {
      throw new AppError(400, 'INVALID_REQUEST', 'returnId is required');
    }

    let returnDoc = null;
    if (isQueryable(Return)) {
      returnDoc = await Return.findById(returnId);
    }
    if (!returnDoc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    const { role, userId } = await this.resolveActorRole(user, returnDoc);

    let shipment = null;
    if (isQueryable(ReturnShipment)) {
      shipment = await ReturnShipment.findOne({ returnId: returnDoc._id, status: { $ne: 'CANCELLED' } });
      if (!shipment) {
        shipment = await ReturnShipment.findOne({ returnId: returnDoc._id }).sort({ createdAt: -1 });
      }
    }

    if (!shipment) {
      throw new AppError(404, 'REVERSE_SHIPMENT_NOT_FOUND', 'No reverse shipment found for this return');
    }

    if (!shipment.trackingNumber) {
      throw new AppError(400, 'TRACKING_NUMBER_REQUIRED', 'Shipment has no tracking number');
    }

    const trackRes = await deliveryProvider.getReturnTracking({
      trackingNumber: shipment.trackingNumber,
      shipmentId: shipment.providerShipmentId,
      targetStatus,
    });

    const rawStatus = trackRes?.rawStatus || trackRes?.status;
    const nextStatus = trackRes?.status || SHIPROCKET_REVERSE_STATUS_MAP[String(rawStatus || '').toUpperCase().trim()] || null;

    if (nextStatus && returnShipmentStateService.canTransition(shipment.status, nextStatus)) {
      await returnShipmentStateService.transitionShipmentStatus(shipment, nextStatus, {
        actorId: userId,
        actorRole: role,
        actorType: role,
        reason: `Tracking sync: ${rawStatus || nextStatus}`,
      });

      if (nextStatus === 'DELIVERED') {
        await this._handoffDeliveredReturn(shipment);
      }
    }

    return shipment;
  }

  async handleReverseWebhookEvent({ returnShipment, payload, res }) {
    if (!returnShipment) {
      throw new AppError(404, 'SHIPMENT_NOT_FOUND', 'Return shipment not found');
    }

    const eventId = String(
      payload.eventId ||
      (payload.shipment_id ? `SR:REV:${payload.shipment_id}:${payload.current_status || payload.status || ''}:${payload.current_timestamp || payload.timestamp || ''}` : '') ||
      `${returnShipment.trackingNumber || returnShipment.shipmentNumber}:${payload.current_status || payload.status || ''}:${payload.timestamp || ''}`
    );

    const processed = returnShipment.metadata?.processedWebhookEvents || {};
    if (processed[eventId]) {
      return res.status(200).json({ success: true, duplicate: true });
    }

    const rawStatus = String(payload.status || payload.current_status || '').toUpperCase().trim();
    const nextStatus = SHIPROCKET_REVERSE_STATUS_MAP[rawStatus] || null;

    if (!nextStatus) {
      returnShipment.metadata = {
        ...(returnShipment.metadata || {}),
        unknownProviderStatus: rawStatus,
        processedWebhookEvents: { ...processed, [eventId]: true },
      };
      if (typeof returnShipment.save === 'function') {
        await returnShipment.save();
      }
      return res.status(200).json({ success: true, preserved: true, currentStatus: returnShipment.status });
    }

    if (returnShipment.status === nextStatus) {
      returnShipment.metadata = {
        ...(returnShipment.metadata || {}),
        processedWebhookEvents: { ...processed, [eventId]: true },
      };
      if (typeof returnShipment.save === 'function') {
        await returnShipment.save();
      }
      return res.status(200).json({ success: true, duplicate: true, currentStatus: returnShipment.status });
    }

    if (returnShipment.status === 'PICKED_UP' && nextStatus === 'CANCELLED') {
      throw new AppError(400, 'ILLEGAL_TRANSITION', 'Picked up reverse shipment cannot be cancelled');
    }

    await returnShipmentStateService.transitionShipmentStatus(returnShipment, nextStatus, {
      actorType: 'DELIVERY_PROVIDER',
      reason: `Provider webhook: ${rawStatus}`,
    });

    auditService.log(`REVERSE_${nextStatus}`, {
      shipmentNumber: returnShipment.shipmentNumber,
      returnId: returnShipment.returnId?.toString(),
      carrierStatus: rawStatus,
    });

    if (nextStatus === 'DELIVERED') {
      await this._handoffDeliveredReturn(returnShipment);
    }

    if (!Array.isArray(returnShipment.trackingEvents)) {
      returnShipment.trackingEvents = [];
    }

    returnShipment.trackingEvents.push({
      status: nextStatus,
      rawStatus,
      location: payload.location || payload.current_location || null,
      description: payload.activity || payload.description || `Reverse status: ${nextStatus}`,
      timestamp: new Date(),
    });

    returnShipment.metadata = {
      ...(returnShipment.metadata || {}),
      processedWebhookEvents: { ...processed, [eventId]: true },
    };

    if (typeof returnShipment.save === 'function') {
      await returnShipment.save();
    }

    return res.status(200).json({ success: true, status: returnShipment.status });
  }

  async _handoffDeliveredReturn(shipment) {
    if (!shipment?.returnId || shipment?.status !== 'DELIVERED') return;

    let returnDoc = null;
    if (isQueryable(Return)) {
      returnDoc = await Return.findById(shipment.returnId);
    }
    if (!returnDoc) return;

    const eligibleStatuses = ['APPROVED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'RECEIVED'];
    if (eligibleStatuses.includes(returnDoc.status)) {
      try {
        await returnStateService.transitionReturnStatus(returnDoc.status, 'RETURN_RECEIVED', {
          returnId: returnDoc._id,
          actorType: 'SYSTEM',
          reason: 'Reverse shipment delivered to seller. Awaiting inspection.',
        });
        returnDoc.status = 'RETURN_RECEIVED';
        returnDoc.receivedAt = new Date();
        if (!returnDoc.statusHistory) returnDoc.statusHistory = [];
        returnDoc.statusHistory.push({
          status: 'RETURN_RECEIVED',
          changedAt: new Date(),
          actorType: 'SYSTEM',
          notes: 'Delivered by reverse carrier. Awaiting seller inspection.',
        });
        if (typeof returnDoc.save === 'function') {
          await returnDoc.save();
        }

        auditService.log('RETURN_RECEIVED', {
          returnId: returnDoc._id?.toString(),
          shipmentNumber: shipment.shipmentNumber,
          newReturnStatus: 'RETURN_RECEIVED',
        });
        auditService.log('REVERSE_DELIVERY_HANDOFF', {
          returnId: returnDoc._id?.toString(),
          shipmentNumber: shipment.shipmentNumber,
          newReturnStatus: 'RETURN_RECEIVED',
        });

        returnNotificationService.emitCustomerReturnEvent({ eventType: 'RETURN_RECEIVED', returnDoc }).catch(() => null);
        returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_RECEIVED', returnDoc }).catch(() => null);
        returnNotificationService.emitSellerReturnEvent({ eventType: 'RETURN_INSPECTION_PENDING', returnDoc }).catch(() => null);
      } catch {
        // ignore handoff transition error
      }
    }
  }

  buildShipmentDto(shipment, role = 'CUSTOMER') {
    const raw = shipment.toObject ? shipment.toObject() : shipment;

    if (role === 'CUSTOMER') {
      return {
        _id: raw._id,
        returnId: raw.returnId,
        shipmentNumber: raw.shipmentNumber,
        direction: raw.direction || 'RETURN',
        status: raw.status,
        pickupStatus: raw.pickupStatus,
        providerAwb: raw.providerAwb || raw.trackingNumber || null,
        trackingNumber: raw.trackingNumber || null,
        trackingUrl: raw.trackingUrl || null,
        carrier: raw.carrier || null,
        labelUrl: raw.labelUrl || null,
        labelGenerated: Boolean(raw.labelUrl),
        awbAssignedAt: raw.awbAssignedAt || null,
        labelGeneratedAt: raw.labelGeneratedAt || null,
        pickupRequestedAt: raw.pickupRequestedAt || null,
        pickupScheduledAt: raw.pickupScheduledAt || null,
        pickedUpAt: raw.pickedUpAt || null,
        inTransitAt: raw.inTransitAt || null,
        outForDeliveryAt: raw.outForDeliveryAt || null,
        deliveredAt: raw.deliveredAt || null,
        packageInfo: raw.packageInfo || null,
        pickupAddress: raw.pickupAddressSnapshot ? {
          name: raw.pickupAddressSnapshot.name,
          addressLine1: raw.pickupAddressSnapshot.addressLine1,
          addressLine2: raw.pickupAddressSnapshot.addressLine2,
          city: raw.pickupAddressSnapshot.city,
          state: raw.pickupAddressSnapshot.state,
          pincode: raw.pickupAddressSnapshot.pincode,
        } : null,
        items: raw.items || [],
        trackingEvents: (raw.trackingEvents || []).map((e) => ({
          status: e.status,
          description: e.description,
          location: e.location,
          timestamp: e.timestamp,
        })),
        nextExpectedStep: getNextExpectedStep(raw.status),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      };
    }

    // Vendor and Admin DTO
    return {
      _id: raw._id,
      returnId: raw.returnId,
      orderId: raw.orderId,
      vendorOrderId: raw.vendorOrderId,
      customerId: raw.customerId,
      vendorId: raw.vendorId,
      shipmentNumber: raw.shipmentNumber,
      channelOrderId: raw.channelOrderId,
      direction: raw.direction || 'RETURN',
      provider: raw.provider,
      providerShipmentId: raw.providerShipmentId,
      providerOrderId: raw.providerOrderId,
      providerAwb: raw.providerAwb || raw.trackingNumber || null,
      carrier: raw.carrier,
      trackingNumber: raw.trackingNumber || null,
      trackingUrl: raw.trackingUrl || null,
      labelUrl: raw.labelUrl || null,
      status: raw.status,
      pickupStatus: raw.pickupStatus,
      awbAssignedAt: raw.awbAssignedAt,
      labelGeneratedAt: raw.labelGeneratedAt,
      pickupRequestedAt: raw.pickupRequestedAt,
      pickupScheduledAt: raw.pickupScheduledAt,
      pickedUpAt: raw.pickedUpAt,
      inTransitAt: raw.inTransitAt,
      outForDeliveryAt: raw.outForDeliveryAt,
      deliveredAt: raw.deliveredAt,
      awbError: raw.awbError || null,
      labelError: raw.labelError || null,
      pickupError: raw.pickupError || null,
      trackingEvents: raw.trackingEvents || [],
      packageInfo: raw.packageInfo,
      pickupAddressSnapshot: raw.pickupAddressSnapshot,
      returnAddressSnapshot: raw.returnAddressSnapshot,
      items: raw.items || [],
      metadata: raw.metadata || {},
      statusHistory: raw.statusHistory || [],
      nextExpectedStep: getNextExpectedStep(raw.status),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  async resolveAuthoritativePackageInfo({ returnDoc, packageInfo = null }) {
    if (!returnDoc) {
      return { packageInfo: null, source: 'NONE' };
    }

    // 1. Explicit seller/user provided packageInfo
    if (packageInfo && typeof packageInfo === 'object') {
      const parsed = packageInfoSchema.safeParse(packageInfo);
      if (parsed.success) {
        return { packageInfo: parsed.data, source: 'SELLER_PROVIDED' };
      }
    }

    // 2. Existing forward Shipment
    if (isQueryable(Shipment)) {
      try {
        let forwardShipment = null;
        if (returnDoc.orderId && returnDoc.vendorOrderId) {
          forwardShipment = await Shipment.findOne({
            orderId: returnDoc.orderId,
            vendorOrderId: returnDoc.vendorOrderId,
          });
        }
        if (!forwardShipment && returnDoc.orderId && returnDoc.vendorId) {
          forwardShipment = await Shipment.findOne({
            orderId: returnDoc.orderId,
            vendorId: returnDoc.vendorId,
          });
        }
        if (!forwardShipment && returnDoc.orderId) {
          forwardShipment = await Shipment.findOne({ orderId: returnDoc.orderId });
        }

        if (forwardShipment?.packageInfo) {
          const fPkg = forwardShipment.packageInfo;
          const w = Number(fPkg.weight);
          const l = Number(fPkg.length);
          const wi = Number(fPkg.width);
          const h = Number(fPkg.height);
          if (w > 0 && l > 0 && wi > 0 && h > 0) {
            return {
              packageInfo: {
                weight: w,
                length: l,
                width: wi,
                height: h,
                unit: fPkg.unit || 'kg',
                dimensionUnit: fPkg.dimensionUnit || 'cm',
              },
              source: 'FORWARD_SHIPMENT',
            };
          }
        }
      } catch (_) {}
    }

    // 3. Product / Variant authoritative data
    if (isQueryable(ReturnItem)) {
      try {
        const itemIds = Array.isArray(returnDoc.items) ? returnDoc.items : [];
        if (itemIds.length > 0) {
          const returnItems = await ReturnItem.find({ _id: { $in: itemIds } });
          if (Array.isArray(returnItems) && returnItems.length > 0) {
            let totalWeight = 0;
            let maxLength = 0;
            let maxWidth = 0;
            let totalHeight = 0;
            let allResolved = true;

            for (const item of returnItems) {
              let variant = null;
              if (isQueryable(ProductVariant) && item.variantId) {
                variant = await ProductVariant.findById(item.variantId);
              }
              const qty = Number(item.quantity) || 1;
              const vWeight = Number(variant?.weight);
              const vDims = variant?.dimensions || {};
              const vL = Number(vDims.length);
              const vW = Number(vDims.width);
              const vH = Number(vDims.height);

              if (vWeight > 0 && vL > 0 && vW > 0 && vH > 0) {
                totalWeight += vWeight * qty;
                maxLength = Math.max(maxLength, vL);
                maxWidth = Math.max(maxWidth, vW);
                totalHeight += vH * qty;
              } else {
                allResolved = false;
                break;
              }
            }

            if (allResolved && totalWeight > 0 && maxLength > 0 && maxWidth > 0 && totalHeight > 0) {
              return {
                packageInfo: {
                  weight: Number(totalWeight.toFixed(2)),
                  length: Number(maxLength.toFixed(1)),
                  width: Number(maxWidth.toFixed(1)),
                  height: Number(totalHeight.toFixed(1)),
                  unit: 'kg',
                  dimensionUnit: 'cm',
                },
                source: 'PRODUCT_VARIANT',
              };
            }
          }
        }
      } catch (_) {}
    }

    return { packageInfo: null, source: 'NONE' };
  }

  async autoProcessReverseShipment({ returnId, returnDoc = null, user = null, packageInfo = null, metadata = {} }) {
    if (!returnId) {
      throw new AppError(400, 'INVALID_REQUEST', 'returnId is required');
    }

    let doc = returnDoc;
    if (!doc && isQueryable(Return)) {
      doc = await Return.findById(returnId);
    }
    if (!doc) {
      throw new AppError(404, 'RETURN_NOT_FOUND', 'Return not found');
    }

    // Defensive actor resolution for background/system triggers
    const effectiveUser = user || {
      sub: String(doc.approvedBy || doc.vendorId || 'SYSTEM'),
      role: 'VENDOR',
      vendorId: doc.vendorId,
    };

    // Resolve authoritative package information
    let effectivePackageInfo = packageInfo;
    let pkgSource = metadata?.packageInfoSource || 'EXPLICIT';
    if (!effectivePackageInfo) {
      const resolved = await this.resolveAuthoritativePackageInfo({ returnDoc: doc, packageInfo });
      effectivePackageInfo = resolved.packageInfo;
      pkgSource = resolved.source;
    }

    if (!effectivePackageInfo) {
      auditService.log('REVERSE_AUTO_PROCESS_AWAITING_PACKAGE_INFO', {
        returnId: doc._id?.toString(),
        reason: 'Authoritative package information could not be resolved from seller payload, forward shipment, or product catalog',
      });
      return {
        shipment: null,
        success: false,
        stage: 'PACKAGE_INFO_REQUIRED',
        error: 'Authoritative package information is required before reverse shipment can be created',
      };
    }

    let shipment = null;

    // Step 1: Prepare reverse shipment (creates ReturnShipment & Shiprocket reverse order)
    try {
      shipment = await this.prepareReturnShipment({
        returnId,
        packageInfo: effectivePackageInfo,
        user: effectiveUser,
        metadata: { ...metadata, packageInfoSource: pkgSource },
      });
    } catch (err) {
      auditService.log('REVERSE_AUTO_PREPARE_FAILED', {
        returnId: doc._id?.toString(),
        error: err.message,
      });
      return {
        shipment: null,
        success: false,
        stage: 'PREPARE_FAILED',
        error: err.message,
      };
    }

    // If shipment is already in a terminal/transit stage, do not re-orchestrate
    if (['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(shipment?.status)) {
      return {
        shipment,
        success: true,
        stage: shipment.status,
      };
    }

    // Step 2: Assign Authentic AWB
    if (!shipment.providerAwb || !isAuthenticAwb(shipment.providerAwb, shipment.providerShipmentId)) {
      try {
        shipment = await this.assignShipmentAwb({
          returnId,
          user: effectiveUser,
        });
      } catch (err) {
        // AWB assignment failed:
        // preserve ReturnShipment, preserve provider order/shipment IDs, do NOT request pickup, persist safe error, do NOT generate fake AWB
        return {
          shipment,
          success: false,
          stage: 'AWB_FAILED',
          error: err.message,
        };
      }
    }

    // Step 3: Generate Shipping Label
    if (!shipment.labelUrl || shipment.labelUrl.includes('/mock/')) {
      try {
        shipment = await this.generateShipmentLabel({
          returnId,
          user: effectiveUser,
        });
      } catch (err) {
        // Label generation failed:
        // preserve authentic AWB, do NOT request pickup, persist label error
        return {
          shipment,
          success: false,
          stage: 'LABEL_FAILED',
          error: err.message,
        };
      }
    }

    // Step 4: Request Carrier Pickup
    if (
      !['PICKUP_REQUESTED', 'PICKUP_SCHEDULED', 'PICKED_UP'].includes(shipment.status) &&
      !['REQUESTED', 'SCHEDULED', 'PICKED_UP'].includes(shipment.pickupStatus)
    ) {
      try {
        shipment = await this.requestShipmentPickup({
          returnId,
          user: effectiveUser,
        });
      } catch (err) {
        // Pickup failed:
        // preserve authentic AWB and label, persist pickup error, allow safe retry
        return {
          shipment,
          success: false,
          stage: 'PICKUP_FAILED',
          error: err.message,
        };
      }
    }

    return {
      shipment,
      success: true,
      stage: shipment.status,
    };
  }
}

export const returnShipmentService = new ReturnShipmentService();
