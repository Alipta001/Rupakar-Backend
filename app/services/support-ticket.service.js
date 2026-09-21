import { SupportTicket } from '../models/support-ticket.model.js';
import { Vendor } from '../models/vendor.model.js';
import { Product } from '../models/product.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { AppError } from '../utils/app-error.js';

const getVendor = async (userId) => {
  const vendor = await Vendor.findOne({ ownerUserId: userId, deletedAt: null });
  if (!vendor) throw new AppError(403, 'VENDOR_NOT_FOUND', 'A seller account is required for support tickets');
  return vendor;
};

const ownedQuery = (userId, ticketId) => ({ _id: ticketId, userId });

export const supportTicketService = {
  async create(userId, payload) {
    const vendor = await getVendor(userId);
    if (payload.productId) {
      const product = await Product.exists({ _id: payload.productId, vendorId: vendor._id, deletedAt: null });
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Referenced product was not found for this seller');
    }
    if (payload.orderId) {
      const order = await VendorOrder.exists({ _id: payload.orderId, vendorId: vendor._id, deletedAt: null });
      if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Referenced order was not found for this seller');
    }
    const ticket = await SupportTicket.create({ ...payload, userId, vendorId: vendor._id, messages: [{ senderUserId: userId, senderRole: 'vendor', message: payload.message }] });
    return ticket.toObject();
  },

  async list(userId, { page, limit, status }) {
    const filter = { userId };
    if (status) filter.status = status;
    const [items, total] = await Promise.all([
      SupportTicket.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SupportTicket.countDocuments(filter),
    ]);
    return { items, page, limit, total };
  },

  async get(userId, ticketId) {
    const ticket = await SupportTicket.findOne(ownedQuery(userId, ticketId)).lean();
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    return ticket;
  },

  async addMessage(userId, ticketId, message) {
    const ticket = await SupportTicket.findOne(ownedQuery(userId, ticketId));
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    if (['RESOLVED', 'CLOSED'].includes(ticket.status)) throw new AppError(409, 'SUPPORT_TICKET_CLOSED', 'This support ticket is closed');
    ticket.messages.push({ senderUserId: userId, senderRole: 'vendor', message });
    if (ticket.status === 'OPEN') ticket.status = 'IN_PROGRESS';
    await ticket.save();
    return ticket.toObject();
  },

  async adminList({ page, limit, status }) {
    const filter = status ? { status } : {};
    const [items, total] = await Promise.all([
      SupportTicket.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SupportTicket.countDocuments(filter),
    ]);
    return { items, page, limit, total };
  },

  async adminUpdate(adminUserId, ticketId, { message, status }) {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    if (message) ticket.messages.push({ senderUserId: adminUserId, senderRole: 'admin', message });
    if (status) ticket.status = status;
    await ticket.save();
    return ticket.toObject();
  },
};
