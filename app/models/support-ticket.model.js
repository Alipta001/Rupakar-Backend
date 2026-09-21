import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const supportMessageSchema = new Schema({
  senderUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  senderRole: { type: String, enum: ['customer', 'vendor', 'admin'], required: true },
  message: { type: String, required: true, trim: true, maxlength: 5000 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const supportTicketSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
  category: { type: String, enum: ['PRODUCTS', 'ORDERS', 'FINANCE', 'VERIFICATION', 'STORE', 'POLICIES', 'OTHER'], required: true },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'], default: 'OPEN', index: true },
  messages: { type: [supportMessageSchema], default: [] },
}, { timestamps: true });

supportTicketSchema.index({ vendorId: 1, createdAt: -1 });
supportTicketSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const SupportTicket = model('SupportTicket', supportTicketSchema);
