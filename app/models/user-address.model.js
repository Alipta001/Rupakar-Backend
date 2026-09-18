import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const userAddressSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, default: '', trim: true },
    landmark: { type: String, default: '', trim: true },
    city: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, default: 'India', trim: true },
    addressType: { type: String, enum: ['HOME', 'WORK', 'OTHER'], default: 'HOME' },
    isDefaultShipping: { type: Boolean, default: false },
    isDefaultBilling: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userAddressSchema.index({ userId: 1, isDeleted: 1 });

userAddressSchema.pre('save', async function ensureSingleDefault(next) {
  if (this.isModified('isDefaultShipping') && this.isDefaultShipping) {
    await this.constructor.updateMany(
      { userId: this.userId, _id: { $ne: this._id }, isDeleted: false },
      { $set: { isDefaultShipping: false } },
    );
  }

  if (this.isModified('isDefaultBilling') && this.isDefaultBilling) {
    await this.constructor.updateMany(
      { userId: this.userId, _id: { $ne: this._id }, isDeleted: false },
      { $set: { isDefaultBilling: false } },
    );
  }

  next();
});

export const UserAddress = model('UserAddress', userAddressSchema);
