import { AppError } from '../utils/app-error.js';

const RETURN_STATUS_TRANSITIONS = {
  REQUESTED: ['UNDER_REVIEW', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PICKUP_SCHEDULED', 'CANCELLED'],
  REJECTED: [],
  PICKUP_SCHEDULED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['INSPECTING', 'CANCELLED'],
  INSPECTING: ['APPROVED_FOR_REFUND', 'REJECTED_AFTER_INSPECTION', 'CANCELLED'],
  APPROVED_FOR_REFUND: ['COMPLETED'],
  REJECTED_AFTER_INSPECTION: [],
  COMPLETED: [],
  CANCELLED: [],
};

export class ReturnStateService {
  async transitionReturnStatus(currentStatus, nextStatus, { returnId = null, actorType = 'SYSTEM', actorId = null, reason = null } = {}) {
    if (!currentStatus || !nextStatus) {
      throw new AppError(400, 'INVALID_RETURN_TRANSITION', 'Return status transition is invalid');
    }

    const allowed = RETURN_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new AppError(400, 'INVALID_RETURN_TRANSITION', `Cannot transition from ${currentStatus} to ${nextStatus}`);
    }

    if (returnId) {
      // reserved for future return history/audit hook
    }

    return { previousStatus: currentStatus, nextStatus, actorType, actorId, reason };
  }
}

export const returnStateService = new ReturnStateService();
