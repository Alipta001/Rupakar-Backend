import mongoose from 'mongoose';
import crypto from 'crypto';

const { Schema, model } = mongoose;

export const SUPPORT_CATEGORIES = [
  'RETURN',
  'REFUND',
  'REPLACEMENT',
  'DAMAGED_ITEM',
  'WRONG_ITEM',
  'MISSING_ITEM',
  'AUTHENTICITY',
  'DELIVERY',
  'PAYMENT',
  'PRODUCTS',
  'ORDERS',
  'FINANCE',
  'VERIFICATION',
  'STORE',
  'POLICIES',
  'OTHER',
];

export const SUPPORT_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_CUSTOMER',
  'WAITING_FOR_SELLER',
  'RESOLVED',
  'CLOSED',
];

const supportMessageSchema = new Schema(
  {
    senderUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['customer', 'vendor', 'admin', 'system'], required: true },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    isInternal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const generateTicketNumber = () => {
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `RUP-SUP-${code}`;
};

const supportTicketSchema = new Schema(
  {
    ticketNumber: {
      type: String,
      unique: true,
      index: true,
      default: generateTicketNumber,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    returnId: { type: Schema.Types.ObjectId, ref: 'Return', default: null, index: true },
    replacementId: { type: Schema.Types.ObjectId, ref: 'Replacement', default: null, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    category: {
      type: String,
      enum: SUPPORT_CATEGORIES,
      required: true,
      index: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 5000, default: null },
    status: {
      type: String,
      enum: SUPPORT_STATUSES,
      default: 'OPEN',
      index: true,
    },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM', index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    messages: { type: [supportMessageSchema], default: [] },
  },
  { timestamps: true }
);

supportTicketSchema.pre('validate', function (next) {
  if (!this.ticketNumber) {
    this.ticketNumber = generateTicketNumber();
  }
  if (!this.customerId && this.userId) {
    this.customerId = this.userId;
  }
  next();
});

supportTicketSchema.index({ vendorId: 1, createdAt: -1 });
supportTicketSchema.index({ userId: 1, status: 1, createdAt: -1 });
supportTicketSchema.index({ customerId: 1, status: 1, createdAt: -1 });
supportTicketSchema.index({ returnId: 1, createdAt: -1 });
supportTicketSchema.index({ orderId: 1, createdAt: -1 });

export const SupportTicket = model('SupportTicket', supportTicketSchema);
