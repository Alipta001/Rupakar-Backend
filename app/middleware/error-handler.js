import { AppError } from '../utils/app-error.js';
import { sendError } from '../utils/response.js';

export const notFoundHandler = (req, res) => {
  const requestId = String(req.headers['x-request-id'] ?? '');
  sendError(res, 404, 'ROUTE_NOT_FOUND', 'Route not found', requestId);
};

export const errorHandler = (err, req, res, _next) => {
  const requestId = String(req.headers['x-request-id'] ?? '');

  if (err?.name === 'ZodError') {
    sendError(res, 400, 'VALIDATION_ERROR', 'Request validation failed', requestId);
    return;
  }

  if (err?.name === 'CastError') {
    sendError(res, 400, 'INVALID_ID', 'A supplied identifier is invalid', requestId);
    return;
  }

  if (err?.name === 'ValidationError') {
    sendError(res, 400, 'DATABASE_VALIDATION_ERROR', 'Request data failed validation', requestId);
    return;
  }

  if (err instanceof AppError) {
    sendError(res, err.statusCode, err.code, err.message, requestId);
    return;
  }

  if (err instanceof Error) {
    if (process.env.NODE_ENV === 'production') {
      sendError(
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'An internal server error occurred',
        requestId,
      );
      return;
    }

    sendError(res, 500, 'INTERNAL_SERVER_ERROR', err.message, requestId);
    return;
  }

  sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Unexpected server error', requestId);
};
