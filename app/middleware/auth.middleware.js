import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';

export const requireAuth = (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication token is required');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);

    req.user = decoded;
    next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError' || error?.name === 'JsonWebTokenError' || error?.name === 'NotBeforeError') {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication token is invalid or expired'));
      return;
    }
    next(error);
  }
};

export const optionalAuth = (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
      req.user = decoded;
    }
  } catch (_error) {
    // optional token invalid or expired; proceed as guest
  }
  next();
};

export const requireRole = (...roles) => {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'FORBIDDEN', 'You do not have permission to access this resource'));
      return;
    }

    next();
  };
};
