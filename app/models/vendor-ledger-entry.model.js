import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const commissionLineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
  grossAmount: { type: Number, required: true, min: 0 },
  rate: { type: Number, required: true, min: 0, max: 100 },
  commissionAmount: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['PRODUCT', 'VENDOR', 'CATEGORY', 'GLOBAL', 'DEFAULT'], required: true },
}, { _id: false });

const vendorLedgerEntrySchema = new Schema(
  {
    parentOrderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    vendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    transactionType: {
      type: String,
      enum: [
        'SALE_CAPTURE',
        'COMMISSION',
        'DELIVERY',
        'PLATFORM_FEE',
        'REFUND_ADJUSTMENT',
        'REFUND_REVERSAL',
        'MANUAL_ADJUSTMENT',
        'SETTLEMENT',
        'PAYOUT',
        'PAYOUT_REVERSAL',
      ],
      required: true,
      index: true,
    },
    status: { type: String, enum: ['POSTED', 'PENDING', 'REVERSED'], default: 'POSTED', index: true },
    eligibilityStatus: {
      type: String,
      enum: ['PENDING', 'ON_HOLD', 'ELIGIBLE', 'PROCESSING', 'SETTLED', 'FAILED', 'REVERSED'],
      default: 'PENDING',
      index: true,
    },
    holdReason: { type: String, default: null },
    eligibleAt: { type: Date, default: null, index: true },
    settledAt: { type: Date, default: null },
    settlementBatchId: { type: Schema.Types.ObjectId, ref: 'SettlementBatch', default: null, index: true },
    payoutId: { type: Schema.Types.ObjectId, ref: 'VendorPayout', default: null, index: true },

    // Monetary fields in Paise (Integer)
    grossAmountPaise: { type: Number, default: 0 },
    commissionAmountPaise: { type: Number, default: 0 },
    paymentFeePaise: { type: Number, default: 0 },
    adjustmentAmountPaise: { type: Number, default: 0 },
    netAmountPaise: { type: Number, default: 0 },
    runningBalancePaise: { type: Number, default: null },

    // Legacy rupee fields for backwards compatibility
    grossAmount: { type: Number, required: true, min: 0 },
    commissionRate: { type: Number, required: true, min: 0, max: 100 },
    commissionAmount: { type: Number, required: true, min: 0 },
    commissionSource: { type: String, required: true },
    commissionLines: { type: [commissionLineSchema], default: [] },
    paymentFee: { type: Number, default: 0, min: 0 },
    adjustmentAmount: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'INR' },
    financialRuleVersion: { type: Number, default: 1 },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true },
);

vendorLedgerEntrySchema.index({ vendorOrderId: 1, transactionType: 1 });
vendorLedgerEntrySchema.index({ vendorId: 1, createdAt: -1 });
vendorLedgerEntrySchema.index({ vendorId: 1, status: 1, createdAt: -1 });
vendorLedgerEntrySchema.index({ vendorId: 1, eligibilityStatus: 1, createdAt: -1 });

export const VendorLedgerEntry = model('VendorLedgerEntry', vendorLedgerEntrySchema);
