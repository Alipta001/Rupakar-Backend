import mongoose from 'mongoose';
import { SupportTicket, SUPPORT_STATUSES } from '../models/support-ticket.model.js';
import { Vendor } from '../models/vendor.model.js';
import { Product } from '../models/product.model.js';
import { VendorOrder } from '../models/vendor-order.model.js';
import { Order } from '../models/order.model.js';
import { Return } from '../models/return.model.js';
import { AppError } from '../utils/app-error.js';
import { notificationService } from './notification.service.js';
import { auditService } from './audit.service.js';

const VALID_STATUS_TRANSITIONS = {
  OPEN: ['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_SELLER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_FOR_CUSTOMER', 'WAITING_FOR_SELLER', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_CUSTOMER: ['IN_PROGRESS', 'WAITING_FOR_SELLER', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_SELLER: ['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS', 'RESOLVED'],
};

const resolveLean = async (query) => {
  if (!query) return null;
  return typeof query.lean === 'function' ? await query.lean() : await query;
};

const extractUserAndRole = (userOrUserId) => {
  if (!userOrUserId) return { userId: null, role: null };
  if (userOrUserId instanceof mongoose.Types.ObjectId || userOrUserId._bsontype === 'ObjectID') {
    return { userId: userOrUserId, role: null };
  }
  if (typeof userOrUserId === 'object') {
    return {
      userId: userOrUserId.sub || userOrUserId.userId || userOrUserId._id || (typeof userOrUserId.id === 'string' ? userOrUserId.id : userOrUserId),
      role: userOrUserId.role || null,
    };
  }
  return { userId: userOrUserId, role: null };
};

const sanitizeTicketForRole = (ticket, role) => {
  if (!ticket) return null;
  const obj = ticket.toObject ? ticket.toObject() : { ...ticket };
  if (role !== 'admin' && Array.isArray(obj.messages)) {
    obj.messages = obj.messages.filter((m) => !m.isInternal);
  }
  return obj;
};

export const supportTicketService = {
  async create(userOrUserId, payload) {
    const { userId, role: explicitRole } = extractUserAndRole(userOrUserId);

    if (!payload.subject || !payload.subject.trim()) {
      throw new AppError(400, 'BAD_REQUEST', 'Ticket subject is required');
    }
    const messageText = payload.message || payload.description;
    if (!messageText || !messageText.trim()) {
      throw new AppError(400, 'BAD_REQUEST', 'Ticket message is required');
    }

    let isCustomer = explicitRole === 'customer';
    let vendor = null;

    if (!isCustomer) {
      vendor = await resolveLean(Vendor.findOne({ ownerUserId: userId, deletedAt: null }));
      if (!vendor && explicitRole !== 'vendor') {
        isCustomer = true;
      } else if (!vendor && explicitRole === 'vendor') {
        throw new AppError(403, 'VENDOR_NOT_FOUND', 'A seller account is required for support tickets');
      }
    }

    let customerId = isCustomer ? userId : null;
    let vendorId = vendor ? vendor._id : null;
    let orderId = payload.orderId || null;
    let returnId = payload.returnId || null;
    let replacementId = payload.replacementId || null;

    if (returnId) {
      const returnDoc = await resolveLean(Return.findById(returnId));
      if (!returnDoc) {
        throw new AppError(404, 'RETURN_NOT_FOUND', 'Referenced return was not found');
      }
      const returnCustId = returnDoc.customerId || returnDoc.userId;
      if (isCustomer && String(returnCustId) !== String(userId)) {
        throw new AppError(403, 'FORBIDDEN', 'You can only create tickets for your own returns');
      }
      if (vendor && String(returnDoc.vendorId) !== String(vendor._id)) {
        throw new AppError(403, 'FORBIDDEN', 'Referenced return does not belong to your store');
      }
      orderId = orderId || returnDoc.orderId;
      vendorId = vendorId || returnDoc.vendorId;
      customerId = customerId || returnCustId;
    }

    if (orderId && isCustomer && !returnId) {
      const order = await resolveLean(Order.findOne({ _id: orderId, customerId: userId }));
      if (!order) {
        const orderExists = await Order.exists({ _id: orderId });
        if (orderExists) {
          throw new AppError(403, 'FORBIDDEN', 'Referenced order does not belong to you');
        }
      }
    }

    if (vendor && payload.productId) {
      const product = await Product.exists({ _id: payload.productId, vendorId: vendor._id, deletedAt: null });
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Referenced product was not found for this seller');
    }

    if (vendor && payload.orderId && !returnId) {
      const vOrder = await VendorOrder.exists({ _id: payload.orderId, vendorId: vendor._id, deletedAt: null });
      if (!vOrder) {
        const pOrder = await Order.exists({ _id: payload.orderId });
        if (!pOrder) throw new AppError(404, 'ORDER_NOT_FOUND', 'Referenced order was not found for this seller');
      }
    }

    const senderRole = isCustomer ? 'customer' : 'vendor';
    const ticket = await SupportTicket.create({
      category: payload.category || 'OTHER',
      subject: payload.subject.trim(),
      description: payload.description || messageText.trim(),
      priority: payload.priority || 'MEDIUM',
      userId,
      customerId,
      vendorId,
      orderId,
      returnId,
      replacementId,
      productId: payload.productId || null,
      messages: [
        {
          senderUserId: userId,
          senderRole,
          message: messageText.trim(),
          isInternal: false,
        },
      ],
    });

    auditService.log('SUPPORT_TICKET_CREATED', {
      ticketId: String(ticket._id),
      ticketNumber: ticket.ticketNumber,
      userId: String(userId),
      customerId: customerId ? String(customerId) : null,
      vendorId: vendorId ? String(vendorId) : null,
      returnId: returnId ? String(returnId) : null,
      category: ticket.category,
    });

    try {
      await notificationService.createNotification({
        userId,
        type: 'SUPPORT_TICKET_CREATED',
        title: 'Support Ticket Created',
        message: `Support ticket #${ticket.ticketNumber || String(ticket._id).slice(-8)} "${ticket.subject}" has been created.`,
        metadata: { ticketId: String(ticket._id), ticketNumber: ticket.ticketNumber, subject: ticket.subject },
      });
      await notificationService.notifyAdmins({
        type: 'ADMIN_SUPPORT_TICKET_CREATED',
        title: 'New Support Ticket',
        message: `New support ticket #${ticket.ticketNumber} from ${isCustomer ? 'Customer' : vendor?.businessName || 'Seller'}: "${ticket.subject}".`,
        metadata: {
          ticketId: String(ticket._id),
          ticketNumber: ticket.ticketNumber,
          vendorId: vendorId ? String(vendorId) : undefined,
          customerId: customerId ? String(customerId) : undefined,
          subject: ticket.subject,
        },
      });
    } catch {
      // Non-blocking notification dispatch
    }

    return sanitizeTicketForRole(ticket, explicitRole || senderRole);
  },

  async list(userOrUserId, { page = 1, limit = 20, status, returnId, orderId } = {}) {
    const { userId, role: explicitRole } = extractUserAndRole(userOrUserId);

    let filter = {};
    if (explicitRole === 'customer') {
      filter = { $or: [{ customerId: userId }, { userId }] };
    } else {
      const vendor = await resolveLean(Vendor.findOne({ ownerUserId: userId, deletedAt: null }));
      if (vendor) {
        filter = { $or: [{ userId }, { vendorId: vendor._id }] };
      } else {
        filter = { $or: [{ customerId: userId }, { userId }] };
      }
    }

    if (status) filter.status = status;
    if (returnId) filter.returnId = returnId;
    if (orderId) filter.orderId = orderId;

    const [items, total] = await Promise.all([
      SupportTicket.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SupportTicket.countDocuments(filter),
    ]);

    const sanitizedItems = items.map((t) => sanitizeTicketForRole(t, explicitRole));
    return { items: sanitizedItems, page, limit, total };
  },

  async get(userOrUserId, ticketId) {
    const { userId, role: explicitRole } = extractUserAndRole(userOrUserId);

    let query = {};
    if (explicitRole === 'customer') {
      query = { _id: ticketId, $or: [{ customerId: userId }, { userId }] };
    } else {
      const vendor = await resolveLean(Vendor.findOne({ ownerUserId: userId, deletedAt: null }));
      if (vendor) {
        query = { _id: ticketId, $or: [{ userId }, { vendorId: vendor._id }] };
      } else {
        query = { _id: ticketId, $or: [{ customerId: userId }, { userId }] };
      }
    }

    const ticket = await resolveLean(SupportTicket.findOne(query));
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    return sanitizeTicketForRole(ticket, explicitRole);
  },

  async addMessage(userOrUserId, ticketId, message, { isInternal = false } = {}) {
    const { userId, role: explicitRole } = extractUserAndRole(userOrUserId);

    if (!message || !message.trim()) {
      throw new AppError(400, 'BAD_REQUEST', 'Message cannot be empty');
    }
    if (message.length > 5000) {
      throw new AppError(400, 'BAD_REQUEST', 'Message cannot exceed 5000 characters');
    }

    let query = {};
    let senderRole = 'vendor';

    if (explicitRole === 'admin') {
      query = { _id: ticketId };
      senderRole = 'admin';
    } else if (explicitRole === 'customer') {
      query = { _id: ticketId, $or: [{ customerId: userId }, { userId }] };
      senderRole = 'customer';
    } else {
      const vendor = await resolveLean(Vendor.findOne({ ownerUserId: userId, deletedAt: null }));
      if (vendor) {
        query = { _id: ticketId, $or: [{ userId }, { vendorId: vendor._id }] };
        senderRole = 'vendor';
      } else {
        query = { _id: ticketId, $or: [{ customerId: userId }, { userId }] };
        senderRole = 'customer';
      }
    }

    const ticket = await SupportTicket.findOne(query);
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    if (['RESOLVED', 'CLOSED'].includes(ticket.status)) {
      throw new AppError(409, 'SUPPORT_TICKET_CLOSED', 'This support ticket is closed');
    }

    const safeIsInternal = senderRole === 'admin' ? Boolean(isInternal) : false;

    ticket.messages.push({
      senderUserId: userId,
      senderRole,
      message: message.trim(),
      isInternal: safeIsInternal,
    });

    if (ticket.status === 'OPEN') {
      ticket.status = 'IN_PROGRESS';
    } else if (senderRole === 'customer' && ticket.status === 'WAITING_FOR_CUSTOMER') {
      ticket.status = 'IN_PROGRESS';
    } else if (senderRole === 'vendor' && ticket.status === 'WAITING_FOR_SELLER') {
      ticket.status = 'IN_PROGRESS';
    }

    await ticket.save();

    auditService.log('SUPPORT_MESSAGE_ADDED', {
      ticketId: String(ticket._id),
      ticketNumber: ticket.ticketNumber,
      senderUserId: String(userId),
      senderRole,
      isInternal: safeIsInternal,
    });

    try {
      if (senderRole !== 'admin') {
        await notificationService.notifyAdmins({
          type: 'ADMIN_SUPPORT_TICKET_REPLIED',
          title: 'Support Ticket Reply',
          message: `${senderRole === 'customer' ? 'Customer' : 'Seller'} replied on support ticket #${ticket.ticketNumber}: "${ticket.subject}".`,
          metadata: { ticketId: String(ticket._id), ticketNumber: ticket.ticketNumber, subject: ticket.subject },
        });
      }
    } catch {
      // Non-blocking notification dispatch
    }

    return sanitizeTicketForRole(ticket, explicitRole);
  },

  async adminList({ page = 1, limit = 20, status, search, category, priority, returnId, orderId } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (returnId) filter.returnId = returnId;
    if (orderId) filter.orderId = orderId;
    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { ticketNumber: { $regex: search, $options: 'i' } },
      ];
    }
    const [items, total] = await Promise.all([
      SupportTicket.find(filter)
        .populate('userId', 'fullName name email')
        .populate('customerId', 'fullName name email')
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
    const ticketQuery = SupportTicket.findById(ticketId)
      .populate('userId', 'fullName name email')
      .populate('customerId', 'fullName name email')
      .populate('vendorId', 'businessName storeName ownerUserId storeEmail')
      .populate('assignedTo', 'fullName name email')
      .populate('messages.senderUserId', 'fullName name email');
    const ticket = await resolveLean(ticketQuery);
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');
    return ticket;
  },

  async adminUpdate(adminUserId, ticketId, { message, status, priority, assignedTo, isInternal = false }) {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) throw new AppError(404, 'SUPPORT_TICKET_NOT_FOUND', 'Support ticket not found');

    const prevStatus = ticket.status;

    if (status && status !== prevStatus) {
      if (!SUPPORT_STATUSES.includes(status)) {
        throw new AppError(400, 'INVALID_STATUS', `Status must be one of: ${SUPPORT_STATUSES.join(', ')}`);
      }
      const allowedNext = VALID_STATUS_TRANSITIONS[prevStatus] || [];
      if (!allowedNext.includes(status)) {
        throw new AppError(400, 'INVALID_STATUS_TRANSITION', `Cannot transition support ticket from ${prevStatus} to ${status}`);
      }
      ticket.status = status;
      if (status === 'RESOLVED') {
        ticket.resolvedAt = new Date();
        auditService.log('SUPPORT_TICKET_RESOLVED', {
          ticketId: String(ticket._id),
          ticketNumber: ticket.ticketNumber,
          resolvedBy: String(adminUserId),
        });
      } else if (status === 'CLOSED') {
        ticket.closedAt = new Date();
        auditService.log('SUPPORT_TICKET_CLOSED', {
          ticketId: String(ticket._id),
          ticketNumber: ticket.ticketNumber,
          closedBy: String(adminUserId),
        });
      }
    }

    if (message && message.trim()) {
      ticket.messages.push({
        senderUserId: adminUserId,
        senderRole: 'admin',
        message: message.trim(),
        isInternal: Boolean(isInternal),
      });
      auditService.log('SUPPORT_MESSAGE_ADDED', {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        senderUserId: String(adminUserId),
        senderRole: 'admin',
        isInternal: Boolean(isInternal),
      });
    }

    if (priority) ticket.priority = priority;
    if (assignedTo !== undefined) {
      ticket.assignedTo = assignedTo;
      if (assignedTo) {
        auditService.log('SUPPORT_TICKET_ASSIGNED', {
          ticketId: String(ticket._id),
          ticketNumber: ticket.ticketNumber,
          assignedTo: String(assignedTo),
          assignedBy: String(adminUserId),
        });
      }
    }

    await ticket.save();

    try {
      const targetUserId = ticket.customerId || ticket.userId;
      if (targetUserId && !isInternal) {
        if (message) {
          await notificationService.createNotification({
            userId: targetUserId,
            type: 'SUPPORT_TICKET_REPLIED',
            title: 'Support Team Reply',
            message: `Support team replied to your ticket #${ticket.ticketNumber}: "${ticket.subject}".`,
            metadata: { ticketId: String(ticket._id), ticketNumber: ticket.ticketNumber, subject: ticket.subject },
          });
        }
        if (status === 'RESOLVED' && prevStatus !== 'RESOLVED') {
          await notificationService.createNotification({
            userId: targetUserId,
            type: 'SUPPORT_TICKET_RESOLVED',
            title: 'Support Ticket Resolved',
            message: `Your support ticket #${ticket.ticketNumber} "${ticket.subject}" has been marked as resolved.`,
            metadata: { ticketId: String(ticket._id), ticketNumber: ticket.ticketNumber, subject: ticket.subject },
          });
        } else if (status === 'CLOSED' && prevStatus !== 'CLOSED') {
          await notificationService.createNotification({
            userId: targetUserId,
            type: 'SUPPORT_TICKET_CLOSED',
            title: 'Support Ticket Closed',
            message: `Your support ticket #${ticket.ticketNumber} "${ticket.subject}" is now closed.`,
            metadata: { ticketId: String(ticket._id), ticketNumber: ticket.ticketNumber, subject: ticket.subject },
          });
        }
      }

      if (status === 'RESOLVED' && prevStatus !== 'RESOLVED') {
        await notificationService.notifyAdmins({
          type: 'ADMIN_SUPPORT_TICKET_RESOLVED',
          title: 'Ticket Resolved',
          message: `Support ticket #${ticket.ticketNumber} "${ticket.subject}" has been resolved.`,
          metadata: { ticketId: String(ticket._id), ticketNumber: ticket.ticketNumber, subject: ticket.subject },
        });
      }
    } catch {
      // Non-blocking notification dispatch
    }

    return await this.adminGet(ticketId);
  },
};
