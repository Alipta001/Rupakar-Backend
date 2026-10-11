import { AppError } from '../utils/app-error.js';

const RETURN_STATUS_TRANSITIONS = {
  REQUESTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'DISPUTED', 'CANCELLED'],
  APPROVED: ['PICKUP_SCHEDULED', 'RETURN_RECEIVED', 'INSPECTION_PENDING', 'CANCELLED'],
  REJECTED: ['CLOSED'],
  PICKUP_SCHEDULED: ['IN_TRANSIT', 'RETURN_RECEIVED', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED', 'RETURN_RECEIVED', 'CANCELLED'],
  RECEIVED: ['INSPECTING', 'INSPECTION_PENDING', 'CANCELLED'],
  RETURN_RECEIVED: ['INSPECTION_PENDING', 'INSPECTING', 'CANCELLED'],
  INSPECTION_PENDING: ['INSPECTION_PASSED', 'INSPECTION_FAILED', 'INSPECTING', 'DISPUTED', 'CANCELLED'],
  INSPECTING: ['INSPECTION_PASSED', 'INSPECTION_FAILED', 'APPROVED_FOR_REFUND', 'REJECTED_AFTER_INSPECTION', 'DISPUTED', 'CANCELLED'],
  INSPECTION_PASSED: [
    'DISPOSITION_PENDING',
    'DISPOSITION_COMPLETED',
    'APPROVED_FOR_REFUND',
    'REPLACEMENT_PENDING',
    'COMPLETED',
    'DISPUTED',
    'CLOSED',
  ],
  DISPOSITION_PENDING: [
    'DISPOSITION_COMPLETED',
    'APPROVED_FOR_REFUND',
    'REPLACEMENT_PENDING',
    'COMPLETED',
    'DISPUTED',
    'CLOSED',
  ],
  DISPOSITION_COMPLETED: [
    'APPROVED_FOR_REFUND',
    'REPLACEMENT_PENDING',
    'COMPLETED',
    'DISPUTED',
    'CLOSED',
  ],
  INSPECTION_FAILED: ['DISPUTED', 'REJECTED_AFTER_INSPECTION', 'CANCELLED'],
  DISPUTED: [
    'APPROVED_FOR_REFUND',
    'REPLACEMENT_PENDING',
    'REJECTED_AFTER_INSPECTION',
    'REJECTED',
    'UNDER_REVIEW',
    'CLOSED',
    'CANCELLED',
  ],
  APPROVED_FOR_REFUND: [
    'REFUND_PENDING',
    'REFUND_PROCESSING',
    'REFUNDED',
    'REFUND_FAILED',
    'MANUAL_PAYOUT_PENDING',
    'MANUAL_PAYOUT_PROCESSING',
    'COMPLETED',
    'CLOSED',
  ],
  REFUND_PENDING: [
    'REFUND_PROCESSING',
    'REFUNDED',
    'REFUND_FAILED',
    'MANUAL_PAYOUT_PENDING',
    'MANUAL_PAYOUT_PROCESSING',
    'COMPLETED',
    'CLOSED',
  ],
  REFUND_PROCESSING: ['REFUNDED', 'REFUND_FAILED', 'COMPLETED', 'CLOSED'],
  REFUND_FAILED: [
    'REFUND_PENDING',
    'REFUND_PROCESSING',
    'REFUNDED',
    'MANUAL_PAYOUT_PENDING',
    'MANUAL_PAYOUT_PROCESSING',
    'COMPLETED',
    'CLOSED',
  ],
  MANUAL_PAYOUT_PENDING: [
    'MANUAL_PAYOUT_PROCESSING',
    'REFUNDED',
    'REFUND_FAILED',
    'COMPLETED',
    'CLOSED',
  ],
  MANUAL_PAYOUT_PROCESSING: [
    'REFUNDED',
    'REFUND_FAILED',
    'MANUAL_PAYOUT_PENDING',
    'COMPLETED',
    'CLOSED',
  ],
  REFUNDED: ['COMPLETED', 'CLOSED'],
  REPLACEMENT_PENDING: ['REPLACEMENT_SHIPPED', 'COMPLETED', 'CLOSED', 'CANCELLED'],
  REPLACEMENT_SHIPPED: ['REPLACEMENT_DELIVERED', 'COMPLETED', 'CLOSED'],
  REPLACEMENT_DELIVERED: ['COMPLETED', 'CLOSED'],
  REJECTED_AFTER_INSPECTION: ['CLOSED'],
  COMPLETED: ['CLOSED'],
  CLOSED: [],
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

    if (actorType === 'VENDOR') {
      const vendorForbidden = [
        'APPROVED_FOR_REFUND',
        'COMPLETED',
        'REFUNDED',
        'REFUND_COMPLETED',
        'REFUND_PENDING',
        'REFUND_PROCESSING',
        'REFUND_FAILED',
        'MANUAL_PAYOUT_PENDING',
        'MANUAL_PAYOUT_PROCESSING',
        'PAYMENT_COMPLETED',
        'REJECTED',
        'REJECTED_AFTER_INSPECTION',
        'REPLACEMENT_PENDING',
        'CLOSED',
      ];
      if (vendorForbidden.includes(nextStatus) || currentStatus === 'DISPUTED') {
        throw new AppError(403, 'VENDOR_FORBIDDEN_TRANSITION', `Vendors are not permitted to transition return to ${nextStatus}`);
      }
    }

    if (actorType === 'CUSTOMER') {
      if (nextStatus !== 'CANCELLED') {
        throw new AppError(403, 'CUSTOMER_FORBIDDEN_TRANSITION', 'Customers can only cancel eligible return requests');
      }
    }

    if (returnId) {
      // reserved for future return history/audit hook
    }

    return { previousStatus: currentStatus, nextStatus, actorType, actorId, reason };
  }
}

export const returnStateService = new ReturnStateService();
