import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const batchRowSchema = new Schema(
  {
    rowNumber: { type: Number, required: true },
    sku: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: '' },
    price: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },
    isValid: { type: Boolean, default: false },
    errors: [
      {
        field: { type: String, trim: true },
        message: { type: String, trim: true },
      },
    ],
    matchedImages: [
      {
        filename: { type: String, trim: true },
        isPrimary: { type: Boolean, default: false },
        sortOrder: { type: Number, default: 0 },
      },
    ],
    status: {
      type: String,
      enum: ['PENDING', 'VALID', 'INVALID', 'SUBMITTED', 'FAILED'],
      default: 'PENDING',
    },
    createdProductId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    productData: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false, suppressReservedKeysWarning: true },
);

const bulkUploadBatchSchema = new Schema(
  {
    batchId: { type: String, required: true, unique: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    originalSpreadsheetName: { type: String, trim: true, default: '' },
    originalZipName: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['VALIDATING', 'VALIDATED', 'SUBMITTING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED'],
      default: 'VALIDATED',
      index: true,
    },
    totalRows: { type: Number, default: 0 },
    validRowsCount: { type: Number, default: 0 },
    invalidRowsCount: { type: Number, default: 0 },
    submittedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    rows: [batchRowSchema],
    extractedImages: [
      {
        filename: { type: String, trim: true },
        tempPath: { type: String, trim: true },
        fileSize: { type: Number, default: 0 },
        mimeType: { type: String, trim: true },
        storageKey: { type: String, trim: true },
        url: { type: String, trim: true },
        sku: { type: String, trim: true },
        isPrimary: { type: Boolean, default: false },
        sortOrder: { type: Number, default: 0 },
      },
    ],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true },
);

bulkUploadBatchSchema.index({ vendorId: 1, createdAt: -1 });

export const BulkUploadBatch = model('BulkUploadBatch', bulkUploadBatchSchema);
