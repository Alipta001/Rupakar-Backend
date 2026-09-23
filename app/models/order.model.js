import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const orderStatusValues = ['PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'PROCESSING', 'PACKED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED', 'DELIVERY_FAILED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED', 'CANCELLED'];
const paymentStatusValues = ['PENDING', 'AUTHORIZED', 'CAPTURED', 'PAID', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'];

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    productName: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    productSnapshot: { type: Object, default: {} },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderNumber: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: orderStatusValues, default: 'PENDING_PAYMENT', index: true },
    paymentStatus: { type: String, enum: paymentStatusValues, default: 'PENDING', index: true },
    items: [orderItemSchema],
    vendorOrders: [{ type: Schema.Types.ObjectId, ref: 'VendorOrder', default: [] }],
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    shipping: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    shippingAddressSnapshot: { type: Object, default: {} },
    billingAddressSnapshot: { type: Object, default: {} },
    paymentMethod: { type: String, default: 'razorpay' },
    idempotencyKey: { type: String, default: null, index: true },
    cancelledAt: { type: Date, default: null },
    cancelledReason: { type: String, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

export const Order = model('Order', orderSchema);
