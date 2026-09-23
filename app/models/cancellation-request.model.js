import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const cancellationRequestSchema = new Schema(
  {
    requestNumber: { type: String, required: true, unique: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    vendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
    productName: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    refundAmount: { type: Number, required: true, min: 0 },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    customerNote: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    rejectionReason: { type: String, trim: true },
    refundId: { type: Schema.Types.ObjectId, ref: 'Refund', default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

cancellationRequestSchema.index({ orderId: 1, variantId: 1, status: 1 });
cancellationRequestSchema.index({ vendorId: 1, status: 1 });
cancellationRequestSchema.index({ customerId: 1, createdAt: -1 });

export const CancellationRequest = model('CancellationRequest', cancellationRequestSchema);
