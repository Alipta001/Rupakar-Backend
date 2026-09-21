import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { addSupportTicketMessage, createSupportTicket, getSupportTicket, listSupportTickets } from '../controllers/support.controller.js';

const router = Router();
router.use(requireAuth);
router.get('/tickets', listSupportTickets);
router.post('/tickets', createSupportTicket);
router.get('/tickets/:ticketId', getSupportTicket);
router.post('/tickets/:ticketId/messages', addSupportTicketMessage);

export default router;
