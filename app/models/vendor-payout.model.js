import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const vendorPayoutSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    ledgerEntryIds: [{ type: Schema.Types.ObjectId, ref: 'VendorLedgerEntry', required: true }],
    requestedAmount: { type: Number, required: true, min: 0 },
    eligibleAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['REQUESTED', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED'], default: 'REQUESTED', index: true },
    provider: { type: String, enum: ['RAZORPAY_ROUTE', 'RAZORPAY_PAYOUT', 'UNCONFIGURED'], default: 'UNCONFIGURED' },
    providerTransferId: { type: String, default: null, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    currency: { type: String, required: true, default: 'INR' },
    failureReason: { type: String, default: null },
    reversalAmount: { type: Number, default: 0, min: 0 },
    reversalReason: { type: String, default: null },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

vendorPayoutSchema.index({ vendorId: 1, createdAt: -1 });
vendorPayoutSchema.index({ vendorId: 1, status: 1, createdAt: -1 });

export const VendorPayout = model('VendorPayout', vendorPayoutSchema);
