import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export class MockEmailProvider {
  async send({ to, subject, html, text }) {
    console.log(`[MOCK EMAIL] To: ${to}, Subject: ${subject}`);
    return { messageId: `mock-${Date.now()}`, success: true };
  }
}

export class ResendEmailProvider {
  constructor({ apiKey, from } = {}) {
    this.apiKey = apiKey || env.RESEND_API_KEY;
    this.from = from || env.EMAIL_FROM || 'noreply@rupakar.com';
  }

  async send({ to, subject, html, text }) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: Array.isArray(to) ? to : [to],
          subject,
          html,
          text: text || subject,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error?.message || `Resend error (${response.status})`);
      }

      return { messageId: data.id || `resend-${Date.now()}`, success: true };
    } catch (error) {
      console.error('[EMAIL ERROR: RESEND]', error.message);
      throw new Error(`Email send failed: ${error.message}`);
    }
  }
}

export class GmailEmailProvider {
  constructor() {
    const fromAddress = env.EMAIL_FROM || env.CONTACT_EMAIL || env.EMAIL_USER;
    this.from = `"Rupakar" <${fromAddress}>`;
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASSWORD,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }

  async send({ to, subject, html, text }) {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        text: text || subject,
        html,
      });
      return { messageId: info.messageId, success: true };
    } catch (error) {
      console.error('[EMAIL ERROR: GMAIL]', error.message);
      throw new Error(`Email send failed: ${error.message}`);
    }
  }
}

export class SmtpEmailProvider {
  constructor() {
    const fromAddress = env.EMAIL_FROM || env.CONTACT_EMAIL || (env.EMAIL_USER?.includes('@') ? env.EMAIL_USER : 'noreply@rupakar.com');
    this.from = `"Rupakar" <${fromAddress}>`;
    this.transporter = nodemailer.createTransport({
      host: env.EMAIL_HOST,
      port: env.EMAIL_PORT,
      secure: env.EMAIL_PORT === 465,
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }

  async send({ to, subject, html, text }) {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        text: text || subject,
        html,
      });
      return { messageId: info.messageId, success: true };
    } catch (error) {
      console.error('[EMAIL ERROR: SMTP]', error.message);
      throw new Error(`Email send failed: ${error.message}`);
    }
  }
}

export class EmailService {
  constructor(provider) {
    if (provider) {
      this.provider = provider;
      return;
    }

    const hasResend = Boolean(env.RESEND_API_KEY && env.RESEND_API_KEY.length > 5);
    const hasSmtpCredentials = Boolean(
      env.EMAIL_USER &&
      env.EMAIL_USER !== 'noreply@example.com' &&
      env.EMAIL_PASSWORD &&
      env.EMAIL_PASSWORD !== 'change-me'
    );

    if (env.EMAIL_PROVIDER === 'resend' || (hasResend && !hasSmtpCredentials)) {
      this.provider = new ResendEmailProvider({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
    } else if (hasSmtpCredentials) {
      const isGmail = env.EMAIL_HOST?.includes('gmail') || env.EMAIL_PROVIDER === 'gmail' || (env.EMAIL_USER?.includes('@gmail.com') && (!env.EMAIL_HOST || env.EMAIL_HOST === 'smtp.example.com' || env.EMAIL_HOST === 'smtp.gmail.com'));
      this.provider = isGmail ? new GmailEmailProvider() : new SmtpEmailProvider();
    } else if (process.env.NODE_ENV === 'production') {
      this.provider = hasResend
        ? new ResendEmailProvider({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })
        : new SmtpEmailProvider();
    } else {
      this.provider = new MockEmailProvider();
    }
  }

  async sendEmail({ to, subject, html, text }) {
    if (!to || !subject) {
      throw new Error('To and subject are required');
    }
    return this.provider.send({ to, subject, html, text });
  }

  async sendOtpEmail({ email, name, otp }) {
    const verifyUrl = `${env.FRONTEND_URL}/verify-otp?email=${encodeURIComponent(email)}`;
    const html = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background-color: #FBF9F5; border: 1px solid #EAE2D5; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 28px;">
          <h1 style="color: #6B3E26; font-size: 26px; margin: 0; font-weight: 700; letter-spacing: 1px;">RUPAKAR</h1>
          <p style="color: #C89B3C; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; margin-top: 4px;">Artisan Marketplace</p>
        </div>
        <div style="background: #FFFFFF; padding: 28px; border-radius: 8px; border: 1px solid #EAD8C7; box-shadow: 0 2px 4px rgba(0,0,0,0.03);">
          <h2 style="color: #1E1A17; font-size: 18px; margin-top: 0;">Email Verification Code</h2>
          <p style="color: #5B4B3F; font-size: 14px; line-height: 1.6;">Hello ${name || 'Valued Customer'},</p>
          <p style="color: #5B4B3F; font-size: 14px; line-height: 1.6;">Welcome to Rupakar! Please use the following 6-digit verification code to verify your email address and activate your account:</p>
          <div style="text-align: center; margin: 28px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #6B3E26; background: #F8F4EE; padding: 14px 28px; border-radius: 8px; border: 1px dashed #C89B3C;">
              ${otp}
            </span>
          </div>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${verifyUrl}" style="background-color: #6B3E26; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Verify Email Online</a>
          </div>
          <p style="color: #7A6B5D; font-size: 13px; line-height: 1.5;">This code will expire in <strong>10 minutes</strong>. If you did not create an account on Rupakar, please disregard this email.</p>
        </div>
        <div style="text-align: center; margin-top: 24px; color: #9C8E82; font-size: 12px;">
          &copy; ${new Date().getFullYear()} Rupakar Marketplace. All rights reserved.
        </div>
      </div>
    `;
    return this.sendEmail({
      to: email,
      subject: `${otp} is your Rupakar verification code`,
      html,
      text: `Your Rupakar verification code is: ${otp}. It will expire in 10 minutes. Verify online at: ${verifyUrl}`,
    });
  }

  async sendPasswordResetOtp({ email, otp }) {
    const resetUrl = `${env.FRONTEND_URL}/reset-password?email=${encodeURIComponent(email)}`;
    const html = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 32px 24px; background-color: #FBF9F5; border: 1px solid #EAE2D5; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 28px;">
          <h1 style="color: #6B3E26; font-size: 26px; margin: 0; font-weight: 700; letter-spacing: 1px;">RUPAKAR</h1>
          <p style="color: #C89B3C; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; margin-top: 4px;">Artisan Marketplace</p>
        </div>
        <div style="background: #FFFFFF; padding: 28px; border-radius: 8px; border: 1px solid #EAD8C7; box-shadow: 0 2px 4px rgba(0,0,0,0.03);">
          <h2 style="color: #1E1A17; font-size: 18px; margin-top: 0;">Password Reset Request</h2>
          <p style="color: #5B4B3F; font-size: 14px; line-height: 1.6;">We received a request to reset your password for your Rupakar account.</p>
          <p style="color: #5B4B3F; font-size: 14px; line-height: 1.6;">Use the following code to complete your password reset:</p>
          <div style="text-align: center; margin: 28px 0;">
            <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #6B3E26; background: #F8F4EE; padding: 14px 28px; border-radius: 8px; border: 1px dashed #C89B3C;">
              ${otp}
            </span>
          </div>
          <div style="text-align: center; margin: 20px 0;">
            <a href="${resetUrl}" style="background-color: #6B3E26; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Reset Password Online</a>
          </div>
          <p style="color: #7A6B5D; font-size: 13px; line-height: 1.5;">This code will expire in <strong>10 minutes</strong>. If you did not request a password reset, you can safely ignore this email.</p>
        </div>
        <div style="text-align: center; margin-top: 24px; color: #9C8E82; font-size: 12px;">
          &copy; ${new Date().getFullYear()} Rupakar Marketplace. All rights reserved.
        </div>
      </div>
    `;
    return this.sendEmail({
      to: email,
      subject: `${otp} is your Rupakar password reset code`,
      html,
      text: `Your Rupakar password reset code is: ${otp}. It will expire in 10 minutes. Reset online at: ${resetUrl}`,
    });
  }

  async sendWelcome({ email, name }) {
    const html = `<p>Welcome ${name}!</p><p>Thank you for registering at Rupakar Marketplace.</p>`;
    return this.sendEmail({
      to: email,
      subject: 'Welcome to Rupakar Marketplace',
      html,
    });
  }

  async sendEmailVerification({ email, verificationLink }) {
    const link = verificationLink || `${env.FRONTEND_URL}/verify-otp?email=${encodeURIComponent(email)}`;
    const html = `<p>Please verify your email by clicking the link below:</p><p><a href="${link}">Verify Email</a></p>`;
    return this.sendEmail({
      to: email,
      subject: 'Verify Your Email',
      html,
      text: `Please verify your email: ${link}`,
    });
  }

  async sendPasswordReset({ email, resetLink }) {
    const link = resetLink || `${env.FRONTEND_URL}/reset-password?email=${encodeURIComponent(email)}`;
    const html = `<p>Click the link below to reset your password:</p><p><a href="${link}">Reset Password</a></p>`;
    return this.sendEmail({
      to: email,
      subject: 'Reset Your Password',
      html,
      text: `Reset your password: ${link}`,
    });
  }

  async sendOrderConfirmation({ email, orderNumber, total }) {
    const html = `<p>Your order #${orderNumber} has been confirmed.</p><p>Total: ₹${total}</p>`;
    return this.sendEmail({
      to: email,
      subject: `Order Confirmation - ${orderNumber}`,
      html,
    });
  }

  async sendPaymentSuccess({ email, orderNumber, amount }) {
    const html = `<p>Payment received for order #${orderNumber}.</p><p>Amount: ₹${amount}</p>`;
    return this.sendEmail({
      to: email,
      subject: `Payment Confirmed - ${orderNumber}`,
      html,
    });
  }

  async sendPaymentFailure({ email, orderNumber, reason }) {
    const html = `<p>Payment failed for order #${orderNumber}.</p><p>Reason: ${reason}</p><p>Please try again or contact support.</p>`;
    return this.sendEmail({
      to: email,
      subject: `Payment Failed - ${orderNumber}`,
      html,
    });
  }

  async sendShipmentUpdate({ email, orderNumber, trackingNumber, trackingUrl }) {
    const html = `<p>Your order #${orderNumber} has been shipped!</p><p>Tracking Number: ${trackingNumber}</p><p><a href="${trackingUrl}">Track Shipment</a></p>`;
    return this.sendEmail({
      to: email,
      subject: `Shipment Update - ${orderNumber}`,
      html,
    });
  }

  async sendDeliveryNotification({ email, orderNumber }) {
    const html = `<p>Your order #${orderNumber} has been delivered!</p><p>Thank you for your purchase.</p>`;
    return this.sendEmail({
      to: email,
      subject: `Delivery Confirmed - ${orderNumber}`,
      html,
    });
  }

  async sendReturnUpdate({ email, returnNumber, status }) {
    const html = `<p>Your return #${returnNumber} status: ${status}.</p>`;
    return this.sendEmail({
      to: email,
      subject: `Return Status Update - ${returnNumber}`,
      html,
    });
  }

  async sendRefundUpdate({ email, refundNumber, status, amount }) {
    const html = `<p>Your refund #${refundNumber} status: ${status}.</p><p>Amount: ₹${amount}</p>`;
    return this.sendEmail({
      to: email,
      subject: `Refund Status Update - ${refundNumber}`,
      html,
    });
  }

  async sendInvoiceReady({ email, invoiceNumber, downloadUrl }) {
    const html = `<p>Your invoice #${invoiceNumber} is ready.</p><p><a href="${downloadUrl}">Download Invoice</a></p>`;
    return this.sendEmail({
      to: email,
      subject: `Invoice Ready - ${invoiceNumber}`,
      html,
    });
  }

  async sendVendorApproval({ email, vendorName, message }) {
    const html = `<p>Congratulations ${vendorName}!</p><p>${message}</p>`;
    return this.sendEmail({
      to: email,
      subject: 'Vendor Application Approved',
      html,
    });
  }

  async sendVendorRejection({ email, vendorName, reason }) {
    const html = `<p>Hello ${vendorName},</p><p>Your vendor application was not approved.</p><p>Reason: ${reason}</p>`;
    return this.sendEmail({
      to: email,
      subject: 'Vendor Application Status',
      html,
    });
  }
}

export const emailService = new EmailService();
