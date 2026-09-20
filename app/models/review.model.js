import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const reviewStatusValues = ['PUBLISHED', 'HIDDEN', 'FLAGGED'];

const reviewSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator(value) {
          return Number.isInteger(value);
        },
        message: 'Rating must be a whole number between 1 and 5',
      },
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: reviewStatusValues,
      default: 'PUBLISHED',
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

reviewSchema.index({ customerId: 1, productId: 1, orderId: 1 }, { unique: true });
reviewSchema.index({ vendorId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ productId: 1, createdAt: -1 });

export const Review = model('Review', reviewSchema);
