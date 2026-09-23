import { cancellationService } from '../services/cancellation.service.js';
import {
  createCancellationRequestSchema,
  rejectCancellationRequestSchema,
  listCancellationRequestsQuerySchema,
} from '../validators/cancellation.validators.js';
import { Vendor } from '../models/vendor.model.js';
import { AppError } from '../utils/app-error.js';
import { sendSuccess } from '../utils/response.js';

export const createOrderCancellationRequest = async (req, res, next) => {
  try {
    const payload = createCancellationRequestSchema.parse(req.body ?? {});
    const customerId = req.user.sub;

    const request = await cancellationService.createRequest({
      customerId,
      orderId: req.params.id,
      variantId: payload.variantId,
      quantity: payload.quantity,
      reason: payload.reason,
      customerNote: payload.customerNote,
    });

    sendSuccess(res, 201, 'Cancellation request submitted', request);
  } catch (error) {
    next(error);
  }
};

export const listOrderCancellationRequests = async (req, res, next) => {
  try {
    const customerId = req.user.sub;
    const requests = await cancellationService.listCustomerCancellationRequests(customerId, {
      orderId: req.params.id,
    });

    sendSuccess(res, 200, 'Cancellation requests loaded', requests);
  } catch (error) {
    next(error);
  }
};

export const listVendorCancellationRequests = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) {
      throw new AppError(403, 'FORBIDDEN', 'Only approved vendors can view cancellation requests');
    }

    const query = listCancellationRequestsQuerySchema.parse(req.query ?? {});
    const result = await cancellationService.listForVendor(vendor._id, query);

    sendSuccess(res, 200, 'Vendor cancellation requests loaded', result);
  } catch (error) {
    next(error);
  }
};

export const approveVendorCancellationRequest = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) {
      throw new AppError(403, 'FORBIDDEN', 'Only approved vendors can approve cancellation requests');
    }

    const result = await cancellationService.approveRequest({
      requestId: req.params.id,
      vendorId: vendor._id,
      reviewerUserId: req.user.sub,
    });

    sendSuccess(res, 200, 'Cancellation request approved', result);
  } catch (error) {
    next(error);
  }
};

export const rejectVendorCancellationRequest = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ ownerUserId: req.user.sub, deletedAt: null, status: 'APPROVED' });
    if (!vendor) {
      throw new AppError(403, 'FORBIDDEN', 'Only approved vendors can reject cancellation requests');
    }

    const payload = rejectCancellationRequestSchema.parse(req.body ?? {});
    const result = await cancellationService.rejectRequest({
      requestId: req.params.id,
      vendorId: vendor._id,
      reviewerUserId: req.user.sub,
      rejectionReason: payload.rejectionReason,
    });

    sendSuccess(res, 200, 'Cancellation request rejected', result);
  } catch (error) {
    next(error);
  }
};
