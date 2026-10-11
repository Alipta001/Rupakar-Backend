import { AppError } from '../utils/app-error.js';

const REPLACEMENT_STATUS_TRANSITIONS = {
  APPROVED: ['PENDING_ORDER_CREATION', 'ORDER_CREATED', 'PENDING_FULFILLMENT', 'ORDER_CREATION_FAILED', 'CANCELLED'],
  PENDING_ORDER_CREATION: ['ORDER_CREATED', 'PENDING_FULFILLMENT', 'ORDER_CREATION_FAILED', 'CANCELLED'],
  ORDER_CREATED: ['PENDING_FULFILLMENT', 'CANCELLED'],
  PENDING_FULFILLMENT: ['FULFILLMENT_STARTED', 'CANCELLED'],
  FULFILLMENT_STARTED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  ORDER_CREATION_FAILED: ['PENDING_ORDER_CREATION', 'CANCELLED'],
  CANCELLED: [],
};

export class ReplacementStateService {
  async transitionReplacementStatus(
    currentStatus,
    nextStatus,
    { replacementId = null, actorType = 'SYSTEM', actorId = null, reason = null } = {},
  ) {
    if (!currentStatus || !nextStatus) {
      throw new AppError(400, 'INVALID_REPLACEMENT_TRANSITION', 'Replacement status transition is invalid');
    }

    const allowed = REPLACEMENT_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(400, 'INVALID_REPLACEMENT_TRANSITION', `Cannot transition replacement from ${currentStatus} to ${nextStatus}`);
    }

    if (actorType === 'VENDOR') {
      throw new AppError(403, 'VENDOR_FORBIDDEN_TRANSITION', 'Vendors are not permitted to change replacement status');
    }

    if (actorType === 'CUSTOMER') {
      if (nextStatus !== 'CANCELLED') {
        throw new AppError(403, 'CUSTOMER_FORBIDDEN_TRANSITION', 'Customers can only cancel eligible replacements');
      }
    }

    return { previousStatus: currentStatus, nextStatus, actorType, actorId, reason };
  }
}

export const replacementStateService = new ReplacementStateService();
export { REPLACEMENT_STATUS_TRANSITIONS };
