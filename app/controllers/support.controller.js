import { supportTicketService } from '../services/support-ticket.service.js';
import { createSupportTicketSchema, supportMessageSchema, supportPrioritySchema, supportStatusSchema, supportTicketQuerySchema } from '../validators/support.validator.js';
import { AppError } from '../utils/app-error.js';

export const createSupportTicket = async (req, res, next) => {
  try {
    const ticket = await supportTicketService.create(req.user, createSupportTicketSchema.parse(req.body));
    res.status(201).json({ success: true, data: ticket, message: 'Support ticket created', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const listSupportTickets = async (req, res, next) => {
  try {
    const query = supportTicketQuerySchema.parse(req.query);
    const tickets = await supportTicketService.list(req.user, query);
    res.status(200).json({ success: true, data: tickets, message: 'Support tickets loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const getSupportTicket = async (req, res, next) => {
  try {
    const ticket = await supportTicketService.get(req.user, req.params.ticketId);
    res.status(200).json({ success: true, data: ticket, message: 'Support ticket loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const addSupportTicketMessage = async (req, res, next) => {
  try {
    const { message, isInternal } = supportMessageSchema.parse(req.body);
    const ticket = await supportTicketService.addMessage(req.user, req.params.ticketId, message, { isInternal });
    res.status(201).json({ success: true, data: ticket, message: 'Support message added', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const listAdminSupportTickets = async (req, res, next) => {
  try {
    const query = supportTicketQuerySchema.parse(req.query);
    const tickets = await supportTicketService.adminList(query);
    res.status(200).json({ success: true, data: tickets, message: 'Support tickets loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const getAdminSupportTicket = async (req, res, next) => {
  try {
    const ticket = await supportTicketService.adminGet(req.params.ticketId);
    res.status(200).json({ success: true, data: ticket, message: 'Support ticket loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const updateAdminSupportTicket = async (req, res, next) => {
  try {
    const status = req.body?.status ? supportStatusSchema.parse({ status: req.body.status }).status : undefined;
    const message = req.body?.message ? supportMessageSchema.parse({ message: req.body.message }).message : undefined;
    const priority = req.body?.priority ? supportPrioritySchema.parse({ priority: req.body.priority }).priority : undefined;
    const assignedTo = req.body?.assignedTo !== undefined ? req.body.assignedTo : undefined;
    const isInternal = typeof req.body?.isInternal === 'boolean' ? req.body.isInternal : false;
    if (!status && !message && !priority && assignedTo === undefined) {
      throw new AppError(400, 'BAD_REQUEST', 'A status, message, priority, or assignedTo is required');
    }
    const ticket = await supportTicketService.adminUpdate(req.user.sub, req.params.ticketId, { status, message, priority, assignedTo, isInternal });
    res.status(200).json({ success: true, data: ticket, message: 'Support ticket updated', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};
