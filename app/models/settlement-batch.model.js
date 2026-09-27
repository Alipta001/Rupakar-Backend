import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const settlementBatchSchema = new Schema(
  {
    batchNumber: { type: String, required: true, unique: true, index: true },
    totalAmountPaise: { type: Number, required: true, min: 0 },
    vendorCount: { type: Number, required: true, min: 0 },
    payoutCount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['CREATED', 'PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED'],
      default: 'CREATED',
      index: true,
    },
    payoutIds: [{ type: Schema.Types.ObjectId, ref: 'VendorPayout' }],
    vendorIds: [{ type: Schema.Types.ObjectId, ref: 'Vendor' }],
    processedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    audit: { type: Object, default: {} },
  },
  { timestamps: true },
);

settlementBatchSchema.index({ status: 1, createdAt: -1 });

export const SettlementBatch = model('SettlementBatch', settlementBatchSchema);
