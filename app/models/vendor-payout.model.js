import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const vendorPayoutSchema = new Schema(
  {
    payoutNumber: { type: String, required: true, unique: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'SettlementBatch', default: null, index: true },
    ledgerEntryIds: [{ type: Schema.Types.ObjectId, ref: 'VendorLedgerEntry', required: true }],
    amountPaise: { type: Number, required: true, min: 0 },
    reversalAmountPaise: { type: Number, default: 0, min: 0 },
    requestedAmount: { type: Number, required: true, min: 0 }, // In rupees (legacy compatibility)
    eligibleAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['CREATED', 'READY', 'REQUESTED', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED', 'ON_HOLD'],
      default: 'CREATED',
      index: true,
    },
    provider: {
      type: String,
      enum: ['RAZORPAY_ROUTE', 'RAZORPAY_PAYOUT', 'MANUAL_BANK_TRANSFER', 'UNCONFIGURED'],
      default: 'UNCONFIGURED',
      index: true,
    },
    providerTransferId: { type: String, default: null, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    currency: { type: String, required: true, default: 'INR' },
    bankSnapshot: {
      accountNumberMasked: { type: String, default: null },
      ifsc: { type: String, default: null },
      accountHolderName: { type: String, default: null },
      bankName: { type: String, default: null },
    },
    failureReason: { type: String, default: null },
    reversalAmount: { type: Number, default: 0, min: 0 },
    reversalReason: { type: String, default: null },
    initiatedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    retryCount: { type: Number, default: 0 },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

vendorPayoutSchema.index({ vendorId: 1, createdAt: -1 });
vendorPayoutSchema.index({ vendorId: 1, status: 1, createdAt: -1 });

export const VendorPayout = model('VendorPayout', vendorPayoutSchema);
