import { z } from 'zod';
import { emailService } from '../services/email.service.js';
import { env } from '../config/env.js';

const schema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email(), subject: z.string().trim().min(3).max(160), message: z.string().trim().min(10).max(5000) });
export const submitContact = async (req, res, next) => { try {
  const payload = schema.parse(req.body);
  await emailService.sendEmail({ to: env.CONTACT_EMAIL, subject: `[Contact] ${payload.subject}`, text: `From: ${payload.name} <${payload.email}>\n\n${payload.message}`, html: `<p><strong>From:</strong> ${payload.name} &lt;${payload.email}&gt;</p><p>${payload.message.replace(/\n/g, '<br>')}</p>` });
  res.status(202).json({ success: true, data: { submitted: true }, message: 'Message received' });
} catch (error) { next(error); } };
