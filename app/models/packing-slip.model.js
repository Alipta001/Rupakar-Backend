import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const packingSlipSchema = new Schema({
  packingSlipNumber: { type: String, required: true, unique: true, index: true },
  sourceKey: { type: String, required: true, unique: true, index: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  vendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', required: true, unique: true, index: true },
  vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  generationStatus: { type: String, enum: ['PENDING', 'GENERATING', 'UPLOADING', 'AVAILABLE', 'FAILED'], default: 'PENDING', index: true },
  storageProvider: { type: String, default: null },
  storageKey: { type: String, default: null },
  fileType: { type: String, default: 'application/pdf' },
  generatedAt: { type: Date, default: null },
  uploadedAt: { type: Date, default: null },
  errorReason: { type: String, default: null },
}, { timestamps: true });

packingSlipSchema.index({ vendorId: 1, orderId: 1 });

export const PackingSlip = model('PackingSlip', packingSlipSchema);
