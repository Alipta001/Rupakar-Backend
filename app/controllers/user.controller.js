import bcrypt from 'bcryptjs';
import { User } from '../models/user.model.js';
import { AppError } from '../utils/app-error.js';
import { updateMeSchema, addressSchema, updateAddressSchema } from '../validators/user.validator.js';
import { userAddressService } from '../services/user-address.service.js';
import { authService } from '../services/auth.service.js';

const sanitizeUser = (user) => {
  const firstName = user.firstName || user.name?.split(' ')[0] || 'User';
  const lastName = user.lastName || user.name?.split(' ').slice(1).join(' ') || '';
  const name = user.name || [firstName, lastName].filter(Boolean).join(' ') || 'Customer';

  return {
    id: user._id,
    _id: user._id,
    name,
    fullName: name,
    firstName,
    lastName,
    email: user.email,
    phone: user.phone || '',
    avatar: user.avatar || '',
    profileImage: user.avatar || '',
    preferences: user.preferences || {},
    role: user.role || 'customer',
    status: user.isActive ? 'ACTIVE' : 'INACTIVE',
    isActive: Boolean(user.isActive),
    isVerified: Boolean(user.isEmailVerified),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

export const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub).select('-password -otp -otpExpire -resetPasswordToken -resetPasswordExpire');
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    res.status(200).json({
      success: true,
      data: sanitizeUser(user.toObject()),
      message: 'Profile loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const updateMe = async (req, res, next) => {
  try {
    const payload = updateMeSchema.parse(req.body);

    if (payload.email) {
      const existing = await User.findOne({ email: payload.email.toLowerCase(), _id: { $ne: req.user.sub } });
      if (existing) {
        throw new AppError(409, 'EMAIL_IN_USE', 'This email is already in use');
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.sub,
      {
        ...payload,
        ...(payload.email ? { email: payload.email.toLowerCase() } : {}),
      },
      { new: true, runValidators: true },
    ).select('-password -otp -otpExpire -resetPasswordToken -resetPasswordExpire');

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    res.status(200).json({
      success: true,
      data: sanitizeUser(user.toObject()),
      message: 'Profile updated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const createAddress = async (req, res, next) => {
  try {
    const payload = addressSchema.parse(req.body);
    const address = await userAddressService.createAddress(req.user.sub, payload);

    res.status(201).json({
      success: true,
      data: address,
      message: 'Address created',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const listAddresses = async (req, res, next) => {
  try {
    const addresses = await userAddressService.listAddresses(req.user.sub);
    res.status(200).json({
      success: true,
      data: addresses,
      message: 'Addresses loaded',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const updateAddress = async (req, res, next) => {
  try {
    const payload = updateAddressSchema.parse(req.body);
    const address = await userAddressService.updateAddress(req.user.sub, req.params.addressId, payload);
    if (!address) {
      throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
    }

    res.status(200).json({
      success: true,
      data: address,
      message: 'Address updated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const deleteAddress = async (req, res, next) => {
  try {
    const deleted = await userAddressService.deleteAddress(req.user.sub, req.params.addressId);
    if (!deleted) {
      throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
    }

    res.status(200).json({
      success: true,
      data: { deleted: true },
      message: 'Address deleted',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const setDefaultShipping = async (req, res, next) => {
  try {
    const address = await userAddressService.setDefaultAddress(req.user.sub, req.params.addressId, 'isDefaultShipping');
    if (!address) {
      throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
    }

    res.status(200).json({
      success: true,
      data: address,
      message: 'Default shipping address updated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const setDefaultBilling = async (req, res, next) => {
  try {
    const address = await userAddressService.setDefaultAddress(req.user.sub, req.params.addressId, 'isDefaultBilling');
    if (!address) {
      throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
    }

    res.status(200).json({
      success: true,
      data: address,
      message: 'Default billing address updated',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      throw new AppError(400, 'BAD_REQUEST', 'Current password and new password are required');
    }
    if (newPassword.length < 8) {
      throw new AppError(400, 'BAD_REQUEST', 'New password must be at least 8 characters');
    }

    const user = await User.findById(req.user.sub);
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    await authService.revokeUserSessions(user._id, 'PASSWORD_CHANGE');

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      requestId: String(req.headers['x-request-id'] ?? ''),
    });
  } catch (error) {
    next(error);
  }
};
