import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const wishlistSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  },
  { timestamps: true },
);

wishlistSchema.index({ userId: 1, productId: 1 }, { unique: true });

export const Wishlist = model('Wishlist', wishlistSchema);
