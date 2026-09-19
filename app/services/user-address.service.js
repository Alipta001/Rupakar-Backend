import { UserAddress } from '../models/user-address.model.js';
import mongoose from 'mongoose';
import { AppError } from '../utils/app-error.js';

export class UserAddressService {
  async createAddress(userId, payload) {
    const address = await UserAddress.create({
      ...payload,
      userId,
    });

    return address.toObject();
  }

  async listAddresses(userId) {
    return UserAddress.find({ userId, isDeleted: false }).sort({ createdAt: -1, _id: -1 }).limit(100).lean();
  }

  async getAddress(userId, addressId) {
    this.assertAddressId(addressId);
    return UserAddress.findOne({ _id: addressId, userId, isDeleted: false }).lean();
  }

  async updateAddress(userId, addressId, payload) {
    this.assertAddressId(addressId);
    const address = await UserAddress.findOneAndUpdate(
      { _id: addressId, userId, isDeleted: false },
      { $set: payload },
      { new: true, runValidators: true },
    );

    return address ? address.toObject() : null;
  }

  async deleteAddress(userId, addressId) {
    this.assertAddressId(addressId);
    return UserAddress.findOneAndUpdate(
      { _id: addressId, userId, isDeleted: false },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
  }

  async setDefaultAddress(userId, addressId, field) {
    this.assertAddressId(addressId);
    if (!(field === 'isDefaultShipping' || field === 'isDefaultBilling')) {
      throw new Error('Invalid default address field');
    }

    const address = await UserAddress.findOne({ _id: addressId, userId, isDeleted: false });
    if (!address) {
      return null;
    }

    address[field] = true;
    if (field === 'isDefaultShipping') {
      await UserAddress.updateMany(
        { userId, _id: { $ne: addressId }, isDeleted: false },
        { $set: { isDefaultShipping: false } },
      );
    }
    if (field === 'isDefaultBilling') {
      await UserAddress.updateMany(
        { userId, _id: { $ne: addressId }, isDeleted: false },
        { $set: { isDefaultBilling: false } },
      );
    }

    await address.save();
    return address.toObject();
  }

  assertAddressId(addressId) {
    if (!mongoose.isValidObjectId(addressId)) {
      throw new AppError(400, 'INVALID_ADDRESS_ID', 'Address id is invalid');
    }
  }
}

export const userAddressService = new UserAddressService();
