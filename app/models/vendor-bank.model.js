import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const vendorBankAccountSchema = new Schema(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
      unique: true,
    },
    accountHolderName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    branchName: { type: String, trim: true },
    ifscCode: { type: String, trim: true },
    accountType: { type: String, enum: ['SAVINGS', 'CURRENT', 'OTHER'], default: 'SAVINGS' },
    maskedAccountNumber: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const VendorBankAccount = model('VendorBankAccount', vendorBankAccountSchema);
