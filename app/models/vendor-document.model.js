import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const vendorDocumentSchema = new Schema(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: ['GST', 'PAN', 'BUSINESS_REGISTRATION', 'IDENTITY', 'ADDRESS_PROOF', 'BANK_PROOF', 'AUTHENTICITY_PROOF'],
      required: true,
    },
    documentNumber: { type: String, trim: true },
    storageKey: { type: String, required: true, trim: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    submittedAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

vendorDocumentSchema.index({ vendorId: 1, status: 1, documentType: 1 });

export const VendorDocument = model('VendorDocument', vendorDocumentSchema);
