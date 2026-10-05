import { AppError } from '../utils/app-error.js';

const SHIPMENT_STATUS_TRANSITIONS = {
  PENDING: ['CREATED', 'PACKED', 'READY_TO_SHIP', 'SHIPPED', 'CANCELLED'],
  CREATED: ['LABEL_GENERATED', 'PACKED', 'READY_TO_SHIP', 'PICKUP_REQUESTED', 'SHIPPED', 'CANCELLED'],
  PACKED: ['READY_TO_SHIP', 'LABEL_GENERATED', 'PICKUP_REQUESTED', 'SHIPPED', 'CANCELLED'],
  LABEL_GENERATED: ['READY_TO_SHIP', 'PICKUP_REQUESTED', 'PICKED_UP', 'SHIPPED', 'CANCELLED'],
  READY_TO_SHIP: ['PACKED', 'PICKUP_REQUESTED', 'PICKED_UP', 'SHIPPED', 'CANCELLED'],
  PICKUP_REQUESTED: ['PICKED_UP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERY_FAILED', 'CANCELLED'],
  PICKED_UP: ['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'CANCELLED'],
  SHIPPED: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RTO_INITIATED', 'CANCELLED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RTO_INITIATED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED', 'RTO_INITIATED', 'CANCELLED'],
  DELIVERED: ['RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'IN_TRANSIT', 'RTO_INITIATED', 'CANCELLED'],
  RTO_INITIATED: ['RTO_IN_TRANSIT', 'RTO_DELIVERED', 'CANCELLED'],
  RTO_IN_TRANSIT: ['RTO_DELIVERED', 'CANCELLED'],
  RTO_DELIVERED: [],
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

  isValidStatus(status) {
    return Boolean(status && Object.prototype.hasOwnProperty.call(SHIPMENT_STATUS_TRANSITIONS, status));
  }
}

export const shipmentStateService = new ShipmentStateService();
