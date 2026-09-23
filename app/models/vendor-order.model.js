import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const vendorOrderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true, index: true },
    productName: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    productSnapshot: { type: Object, default: {} },
  },
  { _id: false },
);

const vendorOrderSchema = new Schema(
  {
    parentOrderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'PROCESSING', 'PACKED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURN_IN_TRANSIT', 'RETURNED', 'FAILED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'], default: 'PENDING_PAYMENT', index: true },
    items: [vendorOrderItemSchema],
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    shipping: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    commissionPlaceholder: { type: Number, default: 0 },
    vendorPayablePlaceholder: { type: Number, default: 0 },
    inventoryDecremented: { type: Boolean, default: false },
    inventoryDecrementedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

vendorOrderSchema.index({ parentOrderId: 1, vendorId: 1 }, { unique: true });

export const VendorOrder = model('VendorOrder', vendorOrderSchema);
