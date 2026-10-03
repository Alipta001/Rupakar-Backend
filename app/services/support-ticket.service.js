import { SupportTicket } from '../models/support-ticket.model.js';
import { Vendor } from '../models/vendor.model.js';
import { Product } from '../models/product.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { AppError } from '../utils/app-error.js';
import { notificationService } from './notification.service.js';

const getVendor = async (userId) => {
  const vendor = await Vendor.findOne({ ownerUserId: userId, deletedAt: null });
  if (!vendor) throw new AppError(403, 'VENDOR_NOT_FOUND', 'A seller account is required for support tickets');
  return vendor;
};

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

    try {
      await notificationService.createNotification({
        userId,
        type: 'SUPPORT_TICKET_CREATED',
        title: 'Support Ticket Created',
        message: `Support ticket #${ticket.ticketNumber || String(ticket._id).slice(-8)} "${ticket.subject}" has been created.`,
        metadata: { ticketId: String(ticket._id), subject: ticket.subject },
      });
      await notificationService.notifyAdmins({
        type: 'ADMIN_SUPPORT_TICKET_CREATED',
        title: 'New Support Ticket',
        message: `New support ticket from "${vendor.businessName}": "${ticket.subject}".`,
        metadata: { ticketId: String(ticket._id), vendorId: String(vendor._id), subject: ticket.subject },
      });
    } catch {
      // Non-blocking notification dispatch
    }

    return ticket.toObject ? ticket.toObject() : ticket;
  },

  async list(userId, { page = 1, limit = 20, status }) {
    const vendor = await Vendor.findOne({ ownerUserId: userId, deletedAt: null }).lean();
    const filter = vendor ? { $or: [{ userId }, { vendorId: vendor._id }] } : { userId };
    if (status) filter.status = status;
    const [items, total] = await Promise.all([
      SupportTicket.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SupportTicket.countDocuments(filter),
    ]);
    return { items, page, limit, total };
  },

  async get(userId, ticketId) {
    const vendor = await Vendor.findOne({ ownerUserId: userId, deletedAt: null }).lean();
    const query = vendor
      ? { _id: ticketId, $or: [{ userId }, { vendorId: vendor._id }] }
      : { _id: ticketId, userId };
    const ticket = await SupportTicket.findOne(query).lean();
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    return ticket;
  },

  async addMessage(userId, ticketId, message) {
    const vendor = await Vendor.findOne({ ownerUserId: userId, deletedAt: null }).lean();
    const query = vendor
      ? { _id: ticketId, $or: [{ userId }, { vendorId: vendor._id }] }
      : { _id: ticketId, userId };
    const ticket = await SupportTicket.findOne(query);
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    if (['RESOLVED', 'CLOSED'].includes(ticket.status)) throw new AppError(409, 'SUPPORT_TICKET_CLOSED', 'This support ticket is closed');
    ticket.messages.push({ senderUserId: userId, senderRole: 'vendor', message });
    if (ticket.status === 'OPEN') ticket.status = 'IN_PROGRESS';
    await ticket.save();

    try {
      await notificationService.notifyAdmins({
        type: 'ADMIN_SUPPORT_TICKET_REPLIED',
        title: 'Support Ticket Reply',
        message: `Seller replied on support ticket: "${ticket.subject}".`,
        metadata: { ticketId: String(ticket._id), subject: ticket.subject },
      });
    } catch {
      // Non-blocking notification dispatch
    }

    return ticket.toObject();
  },

  async adminList({ page = 1, limit = 20, status, search, category, priority }) {
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }
    const [items, total] = await Promise.all([
      SupportTicket.find(filter)
        .populate('userId', 'fullName name email')
        .populate('vendorId', 'businessName storeName ownerUserId storeEmail')
        .populate('assignedTo', 'fullName name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SupportTicket.countDocuments(filter),
    ]);
    return { items, page, limit, total };
  },

  async adminGet(ticketId) {
    const ticket = await SupportTicket.findById(ticketId)
      .populate('userId', 'fullName name email')
      .populate('vendorId', 'businessName storeName ownerUserId storeEmail')
      .populate('assignedTo', 'fullName name email')
      .populate('messages.senderUserId', 'fullName name email')
      .lean();
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    return ticket;
  },

  async adminUpdate(adminUserId, ticketId, { message, status, priority, assignedTo }) {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    if (message) ticket.messages.push({ senderUserId: adminUserId, senderRole: 'admin', message });
    const prevStatus = ticket.status;
    if (status) ticket.status = status;
    if (priority) ticket.priority = priority;
    if (assignedTo !== undefined) ticket.assignedTo = assignedTo;
    await ticket.save();

    try {
      const targetUserId = ticket.userId;
      if (targetUserId) {
        if (message) {
          await notificationService.createNotification({
            userId: targetUserId,
            type: 'SUPPORT_TICKET_REPLIED',
            title: 'Support Team Reply',
            message: `Support team replied to your ticket: "${ticket.subject}".`,
            metadata: { ticketId: String(ticket._id), subject: ticket.subject },
          });
        }
        if (status === 'RESOLVED' && prevStatus !== 'RESOLVED') {
          await notificationService.createNotification({
            userId: targetUserId,
            type: 'SUPPORT_TICKET_RESOLVED',
            title: 'Support Ticket Resolved',
            message: `Your support ticket "${ticket.subject}" has been marked as resolved.`,
            metadata: { ticketId: String(ticket._id), subject: ticket.subject },
          });
        } else if (status === 'CLOSED' && prevStatus !== 'CLOSED') {
          await notificationService.createNotification({
            userId: targetUserId,
            type: 'SUPPORT_TICKET_CLOSED',
            title: 'Support Ticket Closed',
            message: `Your support ticket "${ticket.subject}" is now closed.`,
            metadata: { ticketId: String(ticket._id), subject: ticket.subject },
          });
        }
      }

      if (status === 'RESOLVED' && prevStatus !== 'RESOLVED') {
        await notificationService.notifyAdmins({
          type: 'ADMIN_SUPPORT_TICKET_RESOLVED',
          title: 'Ticket Resolved',
          message: `Support ticket "${ticket.subject}" has been resolved.`,
          metadata: { ticketId: String(ticket._id), subject: ticket.subject },
        });
      }
    } catch {
      // Non-blocking notification dispatch
    }

    return await this.adminGet(ticketId);
  },
};
