import { randomUUID } from 'crypto';

export const requestIdMiddleware = (req, res, next) => {
  const incomingRequestId = req.headers['x-request-id'];
  const requestId =
    typeof incomingRequestId === 'string' && incomingRequestId.length > 0
      ? incomingRequestId
      : randomUUID();

  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};
