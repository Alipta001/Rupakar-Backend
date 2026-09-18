import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const cartItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'ProductVariant', required: true, index: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
  },
  { _id: false },
);

const cartSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    guestSessionId: { type: String, trim: true },
    items: [cartItemSchema],
    status: { type: String, enum: ['ACTIVE', 'MERGED'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

cartSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { userId: { $type: 'objectId' } },
  },
);
cartSchema.index(
  { guestSessionId: 1 },
  {
    unique: true,
    partialFilterExpression: { guestSessionId: { $type: 'string' } },
  },
);

export const Cart = model('Cart', cartSchema);
