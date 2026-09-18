import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const vendorStatus = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED'];
const vendorVerificationStatus = ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'];

const vendorSchema = new Schema(
  {
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
      unique: true,
    },
    businessName: { type: String, required: true, trim: true, maxlength: 160 },
    legalName: { type: String, trim: true, maxlength: 160 },
    businessType: { type: String, enum: ['INDIVIDUAL', 'PARTNERSHIP', 'PRIVATE_LTD', 'LLP', 'PROPRIETORSHIP', 'OTHER'], default: 'INDIVIDUAL' },
    description: { type: String, trim: true, maxlength: 2000 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    website: { type: String, trim: true },
    address: { type: String, trim: true },
    originState: { type: String, trim: true },
    originDistrict: { type: String, trim: true },
    gstNumber: { type: String, trim: true },
    panNumber: { type: String, trim: true },
    status: { type: String, enum: vendorStatus, default: 'PENDING' },
    verificationStatus: { type: String, enum: vendorVerificationStatus, default: 'UNVERIFIED' },
    documents: [{ type: Schema.Types.ObjectId, ref: 'VendorDocument' }],
    bankAccountReference: { type: Schema.Types.ObjectId, ref: 'VendorBankAccount', default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt: { type: Date, default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, trim: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

vendorSchema.index({ ownerUserId: 1, status: 1 });
vendorSchema.index({ status: 1, verificationStatus: 1 });
vendorSchema.index({ businessName: 1 });

export const Vendor = model('Vendor', vendorSchema);
