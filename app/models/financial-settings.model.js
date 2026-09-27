import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const financialSettingsSchema = new Schema(
  {
    version: { type: Number, required: true, unique: true, index: true },
    delivery: {
      baseDeliveryFeePaise: { type: Number, default: 6000, min: 0 }, // ₹60.00
      freeDeliveryThresholdPaise: { type: Number, default: 99900, min: 0 }, // ₹999.00
      codFeePaise: { type: Number, default: 4000, min: 0 }, // ₹40.00
      stateRules: [{
        state: { type: String, required: true },
        additionalFeePaise: { type: Number, default: 0, min: 0 },
      }],
    },
    fees: {
      platformFeePaise: { type: Number, default: 0, min: 0 },
      paymentGatewayFeeRate: { type: Number, default: 0, min: 0, max: 100 },
      packagingFeePaise: { type: Number, default: 0, min: 0 },
      returnShippingFeePaise: { type: Number, default: 0, min: 0 },
      cancellationFeePaise: { type: Number, default: 0, min: 0 },
    },
    settlement: {
      returnProtectionDays: { type: Number, default: 7, min: 0 },
      minPayoutThresholdPaise: { type: Number, default: 100000, min: 0 }, // ₹1000.00
      autoSettlementEnabled: { type: Boolean, default: true },
      settlementFrequency: { type: String, enum: ['DAILY', 'WEEKLY', 'MANUAL'], default: 'DAILY' },
    },
    commission: {
      defaultGlobalRate: { type: Number, default: 10, min: 0, max: 100 },
    },
    isCurrent: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, default: 'Default marketplace financial configuration' },
  },
  { timestamps: true },
);

export const FinancialSettings = model('FinancialSettings', financialSettingsSchema);
