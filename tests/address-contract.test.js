import { afterEach, describe, expect, it, jest } from '@jest/globals';
import mongoose from 'mongoose';
import { createAddress, listAddresses, updateAddress } from '../app/controllers/user.controller.js';
import { userAddressService } from '../app/services/user-address.service.js';

const response = () => {
  const json = jest.fn();
  return { res: { status: () => ({ json }) }, json };
};

afterEach(() => jest.restoreAllMocks());

describe('address API contract', () => {
  it('lists addresses for the authenticated JWT subject and returns an array in data', async () => {
    const addresses = [{ _id: new mongoose.Types.ObjectId(), fullName: 'Customer' }];
    const listSpy = jest.spyOn(userAddressService, 'listAddresses').mockResolvedValue(addresses);
    const { res, json } = response();
    const next = jest.fn();

    await listAddresses({ user: { sub: 'authenticated-user-id' }, headers: {} }, res, next);

    expect(listSpy).toHaveBeenCalledWith('authenticated-user-id');
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ data: addresses }));
  });

  it('returns INVALID_ADDRESS_ID instead of allowing a malformed ObjectId to reach MongoDB', async () => {
    const updateSpy = jest.spyOn(userAddressService, 'updateAddress');
    const { res } = response();
    const next = jest.fn();

    await updateAddress({
      user: { sub: new mongoose.Types.ObjectId().toHexString() },
      params: { addressId: 'not-an-object-id' },
      body: { city: 'Kolkata' },
      headers: {},
    }, res, next);

    expect(updateSpy).toHaveBeenCalledWith(expect.any(String), 'not-an-object-id', { city: 'Kolkata' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_ADDRESS_ID', statusCode: 400 }));
  });

  it('creates an address with the canonical fields required by MongoDB', async () => {
    const createdAddress = { _id: new mongoose.Types.ObjectId(), fullName: 'Customer', district: 'Kolkata' };
    const createSpy = jest.spyOn(userAddressService, 'createAddress').mockResolvedValue(createdAddress);
    const { res, json } = response();
    const next = jest.fn();

    await createAddress({
      user: { sub: new mongoose.Types.ObjectId().toHexString() },
      body: {
        fullName: 'Customer',
        addressLine1: '1 Artisan Street',
        addressLine2: '',
        city: 'Kolkata',
        district: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700001',
        phone: '9876543210',
      },
      headers: {},
    }, res, next);

    expect(createSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      fullName: 'Customer',
      addressLine1: '1 Artisan Street',
      city: 'Kolkata',
      district: 'Kolkata',
      state: 'West Bengal',
      postalCode: '700001',
      phone: '9876543210',
    }));
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ data: createdAddress }));
  });
});