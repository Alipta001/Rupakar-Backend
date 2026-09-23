import { AppError } from '../utils/app-error.js';

const SHIPMENT_STATUS_TRANSITIONS = {
  PENDING: ['READY_TO_SHIP', 'PACKED', 'SHIPPED', 'CANCELLED'],
  READY_TO_SHIP: ['PACKED', 'SHIPPED', 'CANCELLED'],
  PACKED: ['READY_TO_SHIP', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT', 'DELIVERY_FAILED', 'CANCELLED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED', 'CANCELLED'],
  DELIVERED: ['RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  CANCELLED: [],
  RETURN_REQUESTED: ['RETURN_IN_TRANSIT', 'CANCELLED'],
  RETURN_IN_TRANSIT: ['RETURNED', 'CANCELLED'],
  RETURNED: [],
};

export class ShipmentStateService {
  async transitionShipmentStatus(currentStatus, nextStatus, { shipmentId = null, actorType = 'SYSTEM', actorId = null, reason = null } = {}) {
    if (!currentStatus || !nextStatus) {
      throw new AppError(400, 'INVALID_SHIPMENT_TRANSITION', 'Shipment status transition is invalid');
    }

    if (currentStatus === nextStatus) return { previousStatus: currentStatus, nextStatus, actorType, actorId, reason, duplicate: true };

    const allowed = SHIPMENT_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(400, 'INVALID_SHIPMENT_TRANSITION', `Cannot transition from ${currentStatus} to ${nextStatus}`);
    }

    if (shipmentId) {
      // Audit hook reserved for shipment history integration
    }

    return { previousStatus: currentStatus, nextStatus, actorType, actorId, reason };
  }
}

export const shipmentStateService = new ShipmentStateService();
