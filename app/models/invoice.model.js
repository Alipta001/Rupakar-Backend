import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const invoiceItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true },
    productName: { type: String, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    sourceKey: { type: String, required: true, unique: true, sparse: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    vendorOrderId: { type: Schema.Types.ObjectId, ref: 'VendorOrder', default: null },
    items: [invoiceItemSchema],
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    shipping: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    commissionRate: { type: Number, default: 0, min: 0, max: 100 },
    commissionAmount: { type: Number, default: 0, min: 0 },
    netVendorPayable: { type: Number, default: 0 },
    commissionSource: { type: String, default: null },
    currency: { type: String, default: 'INR' },
    paymentMethod: { type: String, default: 'razorpay' },
    paymentStatus: { type: String, enum: ['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'], default: 'PENDING', index: true },
    status: { type: String, enum: ['DRAFT', 'ISSUED', 'VIEWED', 'DOWNLOADED', 'CANCELLED'], default: 'ISSUED', index: true },
    customerSnapshot: { type: Object, default: {} },
    vendorSnapshot: { type: Object, default: {} },
    billingAddressSnapshot: { type: Object, default: {} },
    shippingAddressSnapshot: { type: Object, default: {} },
    storageKey: { type: String, default: null },
    storageUrl: { type: String, default: null },
    issuedAt: { type: Date, default: Date.now, index: true },
    viewedAt: { type: Date, default: null },
    downloadedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

invoiceSchema.index({ orderId: 1, customerId: 1 });
invoiceSchema.index({ customerId: 1, issuedAt: -1 });
invoiceSchema.index({ vendorId: 1, issuedAt: -1 });
invoiceSchema.index({ status: 1, issuedAt: -1 });
invoiceSchema.index({ issuedAt: -1, _id: -1 });

export const Invoice = model('Invoice', invoiceSchema);
