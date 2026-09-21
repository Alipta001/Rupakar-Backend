import { supportTicketService } from '../services/support-ticket.service.js';
import { createSupportTicketSchema, supportMessageSchema, supportStatusSchema, supportTicketQuerySchema } from '../validators/support.validator.js';
import { AppError } from '../utils/app-error.js';

export const createSupportTicket = async (req, res, next) => {
  try {
    const ticket = await supportTicketService.create(req.user.sub, createSupportTicketSchema.parse(req.body));
    res.status(201).json({ success: true, data: ticket, message: 'Support ticket created', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const listSupportTickets = async (req, res, next) => {
  try {
    const query = supportTicketQuerySchema.parse(req.query);
    const tickets = await supportTicketService.list(req.user.sub, query);
    res.status(200).json({ success: true, data: tickets, message: 'Support tickets loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const getSupportTicket = async (req, res, next) => {
  try {
    const ticket = await supportTicketService.get(req.user.sub, req.params.ticketId);
    res.status(200).json({ success: true, data: ticket, message: 'Support ticket loaded', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};

export const addSupportTicketMessage = async (req, res, next) => {
  try {
    const { message } = supportMessageSchema.parse(req.body);
    const ticket = await supportTicketService.addMessage(req.user.sub, req.params.ticketId, message);
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

export const updateAdminSupportTicket = async (req, res, next) => {
  try {
    const status = req.body?.status ? supportStatusSchema.parse({ status: req.body.status }).status : undefined;
    const message = req.body?.message ? supportMessageSchema.parse({ message: req.body.message }).message : undefined;
    if (!status && !message) throw new AppError(400, 'BAD_REQUEST', 'A status or message is required');
    const ticket = await supportTicketService.adminUpdate(req.user.sub, req.params.ticketId, { status, message });
    res.status(200).json({ success: true, data: ticket, message: 'Support ticket updated', requestId: String(req.headers['x-request-id'] ?? '') });
  } catch (error) { next(error); }
};
