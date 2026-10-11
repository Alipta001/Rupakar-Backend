import { AppError } from '../utils/app-error.js';

export const REVERSE_SHIPMENT_STATUSES = {
  PENDING: 'PENDING',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  AWB_ASSIGNED: 'AWB_ASSIGNED',
  LABEL_GENERATED: 'LABEL_GENERATED',
  PICKUP_REQUESTED: 'PICKUP_REQUESTED',
  PICKUP_SCHEDULED: 'PICKUP_SCHEDULED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  PICKUP_FAILED: 'PICKUP_FAILED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  CANCELLED: 'CANCELLED',
};

export const REVERSE_SHIPMENT_TRANSITIONS = {
  PENDING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['AWB_ASSIGNED', 'PICKUP_REQUESTED', 'CANCELLED'],
  AWB_ASSIGNED: ['LABEL_GENERATED', 'PICKUP_REQUESTED', 'CANCELLED'],
  LABEL_GENERATED: ['PICKUP_REQUESTED', 'CANCELLED'],
  PICKUP_REQUESTED: ['PICKUP_SCHEDULED', 'PICKUP_FAILED', 'CANCELLED'],
  PICKUP_SCHEDULED: ['PICKED_UP', 'PICKUP_FAILED', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT'], // Once collected, cancellation is restricted
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERED: [],
  PICKUP_FAILED: ['READY_FOR_PICKUP', 'AWB_ASSIGNED', 'LABEL_GENERATED', 'PICKUP_REQUESTED', 'CANCELLED'], // Allows retry
  DELIVERY_FAILED: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'CANCELLED'], // Allows retry
  CANCELLED: [],
};

export class ReturnShipmentStateService {
  canTransition(currentStatus, nextStatus) {
    if (!currentStatus || !nextStatus) return false;
    const allowed = REVERSE_SHIPMENT_TRANSITIONS[currentStatus] || [];
    return allowed.includes(nextStatus);
  }

  async transitionShipmentStatus(
    shipment,
    nextStatus,
    { actorId = null, actorRole = 'SYSTEM', actorType = 'SYSTEM', reason = null, notes = null } = {},
  ) {
    if (!shipment) {
      throw new AppError(400, 'INVALID_REVERSE_SHIPMENT', 'Shipment record is required');
    }

    const currentStatus = shipment.status || 'PENDING';

    if (currentStatus === nextStatus) {
      return shipment;
    }

    if (!this.canTransition(currentStatus, nextStatus)) {
      throw new AppError(
        400,
        'INVALID_REVERSE_SHIPMENT_TRANSITION',
        `Cannot transition reverse shipment from ${currentStatus} to ${nextStatus}`,
      );
    }

    const resolvedRole = (actorRole || actorType || 'SYSTEM').toUpperCase();
    const resolvedType = (actorType || actorRole || 'SYSTEM').toUpperCase();
    const transitionReason = reason || notes || null;
    const now = new Date();

    shipment.status = nextStatus;

    if (nextStatus === 'AWB_ASSIGNED') {
      if (!shipment.awbAssignedAt) shipment.awbAssignedAt = now;
    } else if (nextStatus === 'LABEL_GENERATED') {
      if (!shipment.labelGeneratedAt) shipment.labelGeneratedAt = now;
    } else if (nextStatus === 'PICKUP_REQUESTED') {
      shipment.pickupStatus = 'REQUESTED';
      if (!shipment.pickupRequestedAt) shipment.pickupRequestedAt = now;
    } else if (nextStatus === 'PICKUP_SCHEDULED') {
      shipment.pickupStatus = 'SCHEDULED';
      if (!shipment.pickupScheduledAt) shipment.pickupScheduledAt = now;
    } else if (nextStatus === 'PICKED_UP') {
      shipment.pickupStatus = 'PICKED_UP';
      if (!shipment.pickedUpAt) shipment.pickedUpAt = now;
    } else if (nextStatus === 'IN_TRANSIT') {
      if (!shipment.inTransitAt) shipment.inTransitAt = now;
    } else if (nextStatus === 'OUT_FOR_DELIVERY') {
      if (!shipment.outForDeliveryAt) shipment.outForDeliveryAt = now;
    } else if (nextStatus === 'PICKUP_FAILED') {
      shipment.pickupStatus = 'FAILED';
    } else if (nextStatus === 'DELIVERED') {
      if (!shipment.deliveredAt) shipment.deliveredAt = now;
    } else if (nextStatus === 'CANCELLED') {
      shipment.pickupStatus = 'CANCELLED';
    }

    if (!Array.isArray(shipment.statusHistory)) {
      shipment.statusHistory = [];
    }

    shipment.statusHistory.push({
      status: nextStatus,
      previousStatus: currentStatus,
      changedAt: now,
      timestamp: now,
      changedBy: actorId,
      actorId,
      actorType: resolvedType,
      actorRole: resolvedRole,
      reason: transitionReason,
      notes: transitionReason,
    });

    if (typeof shipment.save === 'function') {
      await shipment.save();
    }

    return shipment;
  }
}

export const returnShipmentStateService = new ReturnShipmentStateService();
