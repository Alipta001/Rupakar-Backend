import mongoose from 'mongoose';
import { ReturnNotificationEvent } from '../models/return-notification-event.model.js';
import { notificationService } from './notification.service.js';
import { emailService } from './email.service.js';
import { smsService, normalizeIndianPhone10 } from './sms.service.js';
import { User } from '../models/user.model.js';
import { Vendor } from '../models/vendor.model.js';
import { env } from '../config/env.js';

const SMS_HIGH_VALUE_EVENTS = new Set([
  'RETURN_APPROVED',
  'RETURN_PICKED_UP',
  'RETURN_RECEIVED',
  'RETURN_REFUNDED',
  'RETURN_REPLACEMENT_SHIPPED',
]);

const CUSTOMER_EVENT_TEMPLATES = {
  RETURN_REQUESTED: {
    title: 'Return Request Received',
    message: (retNum) => `Your return request ${retNum} has been received and is being processed.`,
    sms: (retNum) => `Rupakar: Your return request ${retNum} has been received. Track details in your account.`,
  },
  RETURN_APPROVED: {
    title: 'Return Request Approved',
    message: (retNum) => `Your return request ${retNum} has been approved. A pickup will be scheduled shortly.`,
    sms: (retNum) => `Rupakar: Your return request ${retNum} has been approved. A pickup will be scheduled.`,
  },
  RETURN_REJECTED: {
    title: 'Return Request Rejected',
    message: (retNum) => `Your return request ${retNum} was not approved. Please view details in your account.`,
  },
  RETURN_CANCELLED: {
    title: 'Return Request Cancelled',
    message: (retNum) => `Your return request ${retNum} has been cancelled.`,
  },
  RETURN_PICKUP_REQUESTED: {
    title: 'Return Pickup Scheduled',
    message: (retNum) => `Pickup has been requested for return ${retNum}. Please keep the package packed and ready.`,
  },
  RETURN_PICKED_UP: {
    title: 'Return Package Picked Up',
    message: (retNum) => `Your return package for ${retNum} has been picked up by the courier.`,
    sms: (retNum) => `Rupakar: Your return package for ${retNum} has been picked up.`,
  },
  RETURN_IN_TRANSIT: {
    title: 'Return Package In Transit',
    message: (retNum) => `Your return package for ${retNum} is in transit back to the seller.`,
  },
  RETURN_RECEIVED: {
    title: 'Returned Item Received',
    message: (retNum) => `We received your returned item for ${retNum}. It is now under inspection.`,
    sms: (retNum) => `Rupakar: We received your return ${retNum}. Item is now under inspection.`,
  },
  RETURN_INSPECTION_STARTED: {
    title: 'Inspection Started',
    message: (retNum) => `Inspection has started for your returned item (${retNum}).`,
  },
  RETURN_INSPECTION_PASSED: {
    title: 'Inspection Passed',
    message: (retNum) => `Your returned item (${retNum}) passed inspection and your resolution is being processed.`,
  },
  RETURN_INSPECTION_FAILED: {
    title: 'Inspection Failed',
    message: (retNum) => `Your returned item (${retNum}) did not pass inspection. Please check return details for next steps.`,
  },
  RETURN_DISPOSITION_COMPLETED: {
    title: 'Return Disposition Completed',
    message: (retNum) => `Inspection and disposition have been completed for your return ${retNum}.`,
  },
  RETURN_REFUND_PENDING: {
    title: 'Refund Pending',
    message: (retNum) => `Your refund for return ${retNum} is pending processing.`,
  },
  RETURN_REFUND_PROCESSING: {
    title: 'Refund Processing',
    message: (retNum) => `Your refund for return ${retNum} is currently processing.`,
  },
  RETURN_REFUNDED: {
    title: 'Refund Completed',
    message: (retNum) => `Your refund for return ${retNum} has been processed successfully.`,
    sms: (retNum) => `Rupakar: Your refund for return ${retNum} has been processed successfully.`,
  },
  RETURN_MANUAL_PAYOUT_PENDING: {
    title: 'Payout Details Submitted',
    message: (retNum) => `Your payout details for return ${retNum} have been received and are pending manual processing.`,
  },
  RETURN_REPLACEMENT_APPROVED: {
    title: 'Replacement Approved',
    message: (retNum) => `Your replacement order for return ${retNum} has been approved.`,
  },
  RETURN_REPLACEMENT_SHIPPED: {
    title: 'Replacement Shipped',
    message: (retNum) => `Your replacement order for return ${retNum} has shipped.`,
    sms: (retNum) => `Rupakar: Your replacement order for return ${retNum} has shipped.`,
  },
  RETURN_REPLACEMENT_DELIVERED: {
    title: 'Replacement Delivered',
    message: (retNum) => `Your replacement order for return ${retNum} has been delivered.`,
    sms: (retNum) => `Rupakar: Your replacement order for return ${retNum} has been delivered.`,
  },
  RETURN_CLOSED: {
    title: 'Return Closed',
    message: (retNum) => `Your return request ${retNum} has been completed and closed.`,
  },
};

const SELLER_EVENT_TEMPLATES = {
  RETURN_REQUESTED: {
    title: 'New Return Request',
    message: (retNum) => `New return request ${retNum} has been created for your order.`,
  },
  RETURN_APPROVED: {
    title: 'Return Request Approved',
    message: (retNum) => `Return request ${retNum} has been approved.`,
  },
  RETURN_RECEIVED: {
    title: 'Returned Item Received',
    message: (retNum) => `Return shipment for ${retNum} has been delivered. Inspection is required.`,
  },
  RETURN_INSPECTION_PENDING: {
    title: 'Inspection Pending',
    message: (retNum) => `Return ${retNum} is awaiting inspection.`,
  },
  RETURN_DISPUTED: {
    title: 'Return Disputed',
    message: (retNum) => `A dispute has been logged for return ${retNum}.`,
  },
  RETURN_DISPOSITION_REQUIRED: {
    title: 'Inventory Disposition Required',
    message: (retNum) => `Return ${retNum} passed inspection. Please complete inventory disposition.`,
  },
  RETURN_DISPOSITION_COMPLETED: {
    title: 'Inventory Disposition Completed',
    message: (retNum) => `Inventory disposition has been recorded for return ${retNum}.`,
  },
};

const ADMIN_EVENT_TEMPLATES = {
  RETURN_REQUESTED: {
    title: 'Return Request Created',
    message: (retNum) => `Return request ${retNum} was created.`,
  },
  RETURN_DISPUTED: {
    title: 'Return Dispute Opened',
    message: (retNum) => `Seller opened a dispute on return ${retNum}.`,
  },
  RETURN_INSPECTION_FAILED: {
    title: 'Return Inspection Failed',
    message: (retNum) => `Return ${retNum} failed physical inspection.`,
  },
  RETURN_AUTHENTICITY_HOLD: {
    title: 'Authenticity Hold on Return',
    message: (retNum) => `Return ${retNum} was placed on authenticity hold.`,
  },
  RETURN_REFUND_FAILED: {
    title: 'Return Refund Failed',
    message: (retNum) => `Prepaid refund execution failed for return ${retNum}.`,
  },
  RETURN_COD_PAYOUT_PENDING: {
    title: 'COD Manual Payout Pending',
    message: (retNum) => `COD manual payout is pending review for return ${retNum}.`,
  },
  RETURN_DISPOSITION_FAILED: {
    title: 'Return Disposition Failed',
    message: (retNum) => `Inventory disposition failed for return ${retNum}.`,
  },
};

const buildBrandedEmailHtml = ({ title, message, returnNumber, status, portalUrl }) => {
  return `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background-color: #FBF9F5; border: 1px solid #EAE2D5; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 28px;">
        <h1 style="color: #6B3E26; font-size: 26px; margin: 0; font-weight: 700; letter-spacing: 1px;">RUPAKAR</h1>
        <p style="color: #C89B3C; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; margin-top: 4px;">Artisan Marketplace</p>
      </div>
      <div style="background: #FFFFFF; padding: 28px; border-radius: 8px; border: 1px solid #EAD8C7; box-shadow: 0 2px 4px rgba(0,0,0,0.03);">
        <h2 style="color: #1E1A17; font-size: 18px; margin-top: 0;">${title}</h2>
        <p style="color: #5B4B3F; font-size: 14px; line-height: 1.6;">${message}</p>
        <div style="margin: 20px 0; padding: 14px; background: #F8F4EE; border-radius: 6px;">
          <p style="margin: 0; font-size: 13px; color: #7A6B5D;"><strong>Return Reference:</strong> ${returnNumber || 'N/A'}</p>
          ${status ? `<p style="margin: 6px 0 0 0; font-size: 13px; color: #7A6B5D;"><strong>Status:</strong> ${status}</p>` : ''}
        </div>
        ${
          portalUrl
            ? `<div style="text-align: center; margin: 24px 0 10px 0;">
                <a href="${portalUrl}" style="background-color: #6B3E26; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">View Return Details</a>
              </div>`
            : ''
        }
      </div>
      <div style="text-align: center; margin-top: 24px; color: #9C8E82; font-size: 12px;">
        &copy; ${new Date().getFullYear()} Rupakar Marketplace. All rights reserved.
      </div>
    </div>
  `;
};

const safeLookup = async (model, id, fields) => {
  if (mongoose.connection.readyState === 0 && !model.findById?._isMockFunction) {
    return null;
  }
  try {
    const query = model.findById(id);
    if (query && typeof query.select === 'function') {
      const sQuery = query.select(fields);
      return sQuery && typeof sQuery.lean === 'function' ? await sQuery.lean() : await sQuery;
    }
    if (query && typeof query.lean === 'function') {
      return await query.lean();
    }
    return await query;
  } catch {
    return null;
  }
};

export class ReturnNotificationService {
  buildEventKey({ returnId, eventType, recipientRole, suffix = 'v1' }) {
    return `RETURN:${returnId}:${eventType}:${recipientRole}:${suffix}`;
  }

  async recordEventIdempotent({ returnId, eventType, recipientId, recipientRole, channels = ['IN_APP'], title, message, suffix = 'v1', metadata = {} }) {
    const eventKey = this.buildEventKey({ returnId, eventType, recipientRole, suffix });

    if (mongoose.connection.readyState === 0 && !ReturnNotificationEvent.findOne?._isMockFunction) {
      return { duplicate: false, event: null, eventKey };
    }

    try {
      // Check if event already exists
      const findQuery = ReturnNotificationEvent.findOne({ eventKey });
      const existing = findQuery && typeof findQuery.lean === 'function' ? await findQuery.lean() : await findQuery;
      if (existing) {
        return { duplicate: true, event: existing, eventKey };
      }

      const event = await ReturnNotificationEvent.create({
        eventKey,
        returnId,
        eventType,
        recipientId,
        recipientRole,
        channels,
        title,
        message,
        metadata,
        status: 'RECORDED',
      });

      return { duplicate: false, event, eventKey };
    } catch (err) {
      if (err?.code === 11000 || String(err?.message).includes('duplicate key')) {
        const fallbackQuery = ReturnNotificationEvent.findOne({ eventKey });
        const existing = fallbackQuery && typeof fallbackQuery.lean === 'function' ? await fallbackQuery.lean() : await fallbackQuery;
        return { duplicate: true, event: existing, eventKey };
      }
      throw err;
    }
  }

  async emitCustomerReturnEvent({ eventType, returnDoc, suffix = 'v1', customTitle = null, customMessage = null }) {
    const customerUserId = returnDoc?.customerId || returnDoc?.userId;
    if (!returnDoc || !returnDoc._id || !customerUserId) return null;

    try {
      const template = CUSTOMER_EVENT_TEMPLATES[eventType];
      const returnNumber = returnDoc.returnNumber || String(returnDoc._id).slice(-8);
      const title = customTitle || template?.title || `Return Update: ${eventType}`;
      const message = customMessage || (template?.message ? template.message(returnNumber) : `Update on your return ${returnNumber}.`);

      const returnId = String(returnDoc._id);

      // Channels to trigger
      const channels = ['IN_APP'];
      if (SMS_HIGH_VALUE_EVENTS.has(eventType)) {
        channels.push('SMS');
      }
      channels.push('EMAIL');

      const { duplicate, eventKey } = await this.recordEventIdempotent({
        returnId,
        eventType,
        recipientId: customerUserId,
        recipientRole: 'customer',
        channels,
        title,
        message,
        suffix,
        metadata: { returnNumber, status: returnDoc.status },
      });

      if (duplicate) {
        return { duplicate: true, eventKey };
      }

      // Customer recipient lookup for email and phone
      const customerUser = await safeLookup(User, customerUserId, 'email phone fullName name');

      const email = customerUser?.email || returnDoc.customerEmail || null;
      const phone = customerUser?.phone || returnDoc.customerPhone || null;

      // 1. In-app Notification
      await notificationService.createNotification({
        userId: customerUserId,
        type: eventType,
        title,
        message,
        channel: 'IN_APP',
        recipient: email,
        metadata: {
          returnId,
          returnNumber,
          orderId: returnDoc.orderId ? String(returnDoc.orderId) : undefined,
          idempotencyKey: eventKey,
        },
      }).catch(() => null);

      // 2. Email Delivery (branded, safe)
      if (email) {
        const portalUrl = `${env.FRONTEND_URL || 'https://rupakar.in'}/account/returns/${returnId}`;
        const emailHtml = buildBrandedEmailHtml({
          title,
          message,
          returnNumber,
          status: returnDoc.status,
          portalUrl,
        });

        await emailService.sendEmail({
          to: email,
          subject: `${title} - ${returnNumber}`,
          html: emailHtml,
          text: message,
        }).catch(() => null);
      }

      // 3. SMS Delivery (only for high value events and valid Indian 10-digit phone)
      if (SMS_HIGH_VALUE_EVENTS.has(eventType) && phone) {
        const tenDigits = normalizeIndianPhone10(phone);
        if (tenDigits) {
          const smsText = template?.sms ? template.sms(returnNumber) : `Rupakar: ${message}`;
          await smsService.sendSms({
            to: `+91${tenDigits}`,
            message: smsText,
          }).catch(() => null);
        }
      }

      await ReturnNotificationEvent.updateOne({ eventKey }, { status: 'PROCESSED', processedAt: new Date() }).catch(() => null);
      return { success: true, eventKey };
    } catch (err) {
      // Non-blocking: never fail business workflow
      console.warn(`[RETURN NOTIFICATION FAILED] customer ${eventType}:`, err?.message);
      return { success: false, error: err?.message };
    }
  }

  async emitSellerReturnEvent({ eventType, returnDoc, suffix = 'v1', customTitle = null, customMessage = null }) {
    if (!returnDoc || !returnDoc._id || !returnDoc.vendorId) return null;

    try {
      const template = SELLER_EVENT_TEMPLATES[eventType];
      const returnNumber = returnDoc.returnNumber || String(returnDoc._id).slice(-8);
      const title = customTitle || template?.title || `Seller Return Alert: ${eventType}`;
      const message = customMessage || (template?.message ? template.message(returnNumber) : `Seller update on return ${returnNumber}.`);

      const returnId = String(returnDoc._id);
      const vendorId = returnDoc.vendorId;

      const vendor = await safeLookup(Vendor, vendorId, 'ownerUserId businessName email storeEmail');
      if (!vendor || !vendor.ownerUserId) return null;

      const sellerUserId = vendor.ownerUserId;

      const { duplicate, eventKey } = await this.recordEventIdempotent({
        returnId,
        eventType,
        recipientId: sellerUserId,
        recipientRole: 'vendor',
        channels: ['IN_APP', 'EMAIL'],
        title,
        message,
        suffix,
        metadata: { returnNumber, vendorId: String(vendorId) },
      });

      if (duplicate) {
        return { duplicate: true, eventKey };
      }

      // 1. In-app Notification to Seller
      await notificationService.notifyVendor({
        vendorId,
        userId: sellerUserId,
        type: eventType,
        title,
        message,
        channel: 'IN_APP',
        metadata: {
          returnId,
          returnNumber,
          vendorId: String(vendorId),
          idempotencyKey: eventKey,
        },
      }).catch(() => null);

      // 2. Email to Seller
      const sellerEmail = vendor.email || vendor.storeEmail;
      if (sellerEmail) {
        const portalUrl = `${env.SELLER_PORTAL_URL || env.FRONTEND_URL || 'https://rupakar.in'}/seller/returns/${returnId}`;
        const emailHtml = buildBrandedEmailHtml({
          title,
          message,
          returnNumber,
          status: returnDoc.status,
          portalUrl,
        });

        await emailService.sendEmail({
          to: sellerEmail,
          subject: `${title} - ${returnNumber}`,
          html: emailHtml,
          text: message,
        }).catch(() => null);
      }

      await ReturnNotificationEvent.updateOne({ eventKey }, { status: 'PROCESSED', processedAt: new Date() }).catch(() => null);
      return { success: true, eventKey };
    } catch (err) {
      console.warn(`[RETURN NOTIFICATION FAILED] seller ${eventType}:`, err?.message);
      return { success: false, error: err?.message };
    }
  }

  async emitAdminReturnException({ eventType, returnDoc, suffix = 'v1', customTitle = null, customMessage = null }) {
    if (!returnDoc || !returnDoc._id) return null;

    try {
      const template = ADMIN_EVENT_TEMPLATES[eventType];
      const returnNumber = returnDoc.returnNumber || String(returnDoc._id).slice(-8);
      const title = customTitle || template?.title || `Admin Exception: ${eventType}`;
      const message = customMessage || (template?.message ? template.message(returnNumber) : `Admin alert on return ${returnNumber}.`);

      const returnId = String(returnDoc._id);

      // We use a dummy or first admin id for event record key
      const adminUser = await User.findOne({ role: 'admin', isActive: true }).select('_id').lean();
      const recipientId = adminUser?._id || returnDoc.userId;

      const { duplicate, eventKey } = await this.recordEventIdempotent({
        returnId,
        eventType: `ADMIN_${eventType}`,
        recipientId,
        recipientRole: 'admin',
        channels: ['IN_APP'],
        title,
        message,
        suffix,
        metadata: { returnNumber, exception: eventType },
      });

      if (duplicate) {
        return { duplicate: true, eventKey };
      }

      await notificationService.notifyAdmins({
        type: `ADMIN_${eventType}`,
        title,
        message,
        channel: 'IN_APP',
        metadata: {
          returnId,
          returnNumber,
          forAdmin: true,
          idempotencyKey: eventKey,
        },
      }).catch(() => null);

      await ReturnNotificationEvent.updateOne({ eventKey }, { status: 'PROCESSED', processedAt: new Date() }).catch(() => null);
      return { success: true, eventKey };
    } catch (err) {
      console.warn(`[RETURN NOTIFICATION FAILED] admin ${eventType}:`, err?.message);
      return { success: false, error: err?.message };
    }
  }
}

export const returnNotificationService = new ReturnNotificationService();
