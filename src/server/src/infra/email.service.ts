import type {
  IEmailService,
  ConfirmationEmailData,
  MagicLinkEmailData,
  PaymentConfirmedEmailData,
  PaymentRejectedEmailData,
  StaffWelcomeEmailData,
  PaymentLinkEmailData,
  RevisedPaymentEmailData,
  AdditionalPaymentEmailData,
  StoryHiddenEmailData,
} from '../repositories/interfaces.js';
import { renderConfirmation, renderMagicLink, renderPaymentConfirmed, renderPaymentRejected, renderStaffWelcome, renderPaymentLink, renderRevisedPayment, renderAdditionalPayment } from './email-templates.js';
import { createLogger, parseLogLevel, type Logger } from './logger.js';
import { isLocalUrl } from '../lib/site-config.js';

/**
 * Used when Mailgun is not configured. Nothing is sent.
 * GUARANTEE: a link that carries a login or payment token is printed to the log ONLY when
 * appBaseUrl points at localhost / 127.0.0.1. On any other host the service logs an error
 * that email is not configured, and the log does not contain the token.
 */
export class MockEmailService implements IEmailService {
  private readonly local: boolean;

  constructor(appBaseUrl: string) {
    this.local = isLocalUrl(appBaseUrl);
  }

  /** Returns the link for printing, or null (after logging an error) when not local. */
  private linkForLog(kind: string, to: string, link: string): string | null {
    if (this.local) return link;
    console.error(
      `[email] ${kind} email to ${to} was NOT sent and its link is not logged: ` +
        `email is not configured. Set MAILGUN_API_KEY and MAILGUN_DOMAIN.`,
    );
    return null;
  }

  async sendConfirmation(to: string, data: ConfirmationEmailData): Promise<void> {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  CONFIRMATION EMAIL (dev mock — not sent)         ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  To: ${to}`);
    console.log(`║  Name: ${data.fullName}`);
    console.log(`║  Reg Code: ${data.regCode}`);
    console.log(`║  Intent: ${data.attendanceIntent}`);
    console.log(`║  Total: ₹${data.totalAmount}`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
  }

  async sendMagicLink(to: string, data: MagicLinkEmailData): Promise<void> {
    const link = this.linkForLog('Magic link', to, data.token);
    if (link === null) return;
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  MAGIC LINK (dev — email not sent)               ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  To: ${to}`);
    console.log(`║  Link: ${link}`);
    console.log(`║  Expires in: ${data.expiresIn} minutes`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
  }

  async sendPaymentConfirmed(to: string, data: PaymentConfirmedEmailData): Promise<void> {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  PAYMENT CONFIRMED (dev mock — not sent)          ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  To: ${to}`);
    console.log(`║  Name: ${data.fullName}`);
    console.log(`║  Reg Code: ${data.regCode}`);
    console.log(`║  Branch: ${data.branch}`);
    console.log(`║  Attendance: ${data.attendanceIntent}`);
    console.log(`║  Meal: ${data.alumniMeal}`);
    console.log(`║  T-shirt: ${data.tshirtSize ?? 'n/a'}`);
    console.log(`║  Spouse: ${data.spouseName ?? 'none'}`);
    console.log(`║  Children: ${data.childCount}  Guests: ${data.guestCount}`);
    console.log(`║  Accommodation: ${data.accommodation}`);
    for (const p of data.payments) {
      console.log(`║  Payment: ₹${p.amount}  Ref: ${p.referenceId}  Date: ${new Date(p.date).toISOString()}`);
    }
    if (data.refunds?.length) {
      for (const r of data.refunds) {
        console.log(`║  Refund pending: ₹${r.amount}`);
      }
    }
    console.log(`║  Pass URL: ${data.passUrl}`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
  }

  async sendPaymentRejected(to: string, data: PaymentRejectedEmailData): Promise<void> {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  PAYMENT REJECTED (dev mock — not sent)           ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  To: ${to}`);
    console.log(`║  Name: ${data.fullName}`);
    console.log(`║  Reg ID: ${data.regId}`);
    console.log(`║  Comment: ${data.comment}`);
    console.log(`║  Intent: ${data.attendanceIntent}`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
  }

  async sendStaffWelcome(to: string, data: StaffWelcomeEmailData): Promise<void> {
    const link = this.linkForLog('Staff welcome', to, data.token);
    if (link === null) return;
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  STAFF WELCOME (dev — email not sent)            ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  To: ${to}`);
    console.log(`║  Link: ${link}`);
    console.log(`║  Expires in: ${data.expiresIn} minutes`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
  }

  async sendPaymentLink(to: string, data: PaymentLinkEmailData): Promise<void> {
    const link = this.linkForLog('Payment link', to, data.link);
    if (link === null) return;
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  PAYMENT LINK (dev — email not sent)             ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  To: ${to}`);
    console.log(`║  Link: ${link}`);
    console.log(`║  Expires in: ${data.expiresInHours} hours`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
  }

  async sendRevisedPayment(to: string, data: RevisedPaymentEmailData): Promise<void> {
    const link = this.linkForLog('Revised payment', to, data.paymentLink);
    if (link === null) return;
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  REVISED PAYMENT (dev mock — not sent)           ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  To: ${to}`);
    console.log(`║  Name: ${data.fullName}`);
    console.log(`║  Revised Amount: ₹${data.amount}`);
    console.log(`║  Payment Link: ${link}`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
  }

  async sendAdditionalPayment(to: string, data: AdditionalPaymentEmailData): Promise<void> {
    const link = this.linkForLog('Additional payment', to, data.paymentLink);
    if (link === null) return;
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  ADDITIONAL PAYMENT (dev mock — not sent)        ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  To: ${to}`);
    console.log(`║  Name: ${data.fullName}`);
    console.log(`║  Additional Amount: ₹${data.amount}`);
    console.log(`║  Payment Link: ${link}`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
  }

  async sendStoryHidden(to: string, data: StoryHiddenEmailData): Promise<void> {
    console.log(`\n╔══════════════════════════════════════════════════╗`);
    console.log(`║  STORY HIDDEN (dev mock — not sent)               ║`);
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  To: ${to}`);
    console.log(`║  Author: ${data.authorName}`);
    console.log(`║  Comment: ${data.comment}`);
    console.log(`╚══════════════════════════════════════════════════╝\n`);
  }
}

export class MailgunEmailService implements IEmailService {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly from: string;
  private readonly allowedDomains: string[];
  private readonly appBaseUrl: string;
  private readonly log: Logger;

  constructor(apiKey: string, domain: string, allowedDomains: string[], logLevel: string | undefined, appBaseUrl: string, senderName: string) {
    this.baseUrl = `https://api.mailgun.net/v3/${domain}/messages`;
    this.authHeader = `Basic ${btoa(`api:${apiKey}`)}`;
    this.from = `${senderName} <noreply@${domain}>`;
    this.allowedDomains = allowedDomains.map(d => d.toLowerCase());
    this.appBaseUrl = appBaseUrl;
    this.log = createLogger('email', parseLogLevel(logLevel));
  }

  async sendConfirmation(to: string, data: ConfirmationEmailData): Promise<void> {
    const { subject, html } = renderConfirmation({
      fullName: data.fullName,
      regCode: data.regCode,
      regId: data.regId,
      totalAmount: data.totalAmount,
      attendanceIntent: data.attendanceIntent,
      participationType: data.participationType,
      alumniMeal: data.alumniMeal,
      tshirtSize: data.tshirtSize,
      spouseName: data.spouseName,
      childCount: data.childCount,
      guestCount: data.guestCount,
      accommodation: data.accommodation,
      checkIn: data.checkIn,
      checkOut: data.checkOut,
      extraBed: data.extraBed,
      pricingBreakup: data.pricingBreakup,
      baseUrl: this.appBaseUrl,
      paymentUrl: data.paymentUrl,
    });
    await this.send({ to, subject, html });
  }

  async sendMagicLink(to: string, data: MagicLinkEmailData): Promise<void> {
    const { subject, html } = renderMagicLink({
      link: data.token,
      expiresIn: data.expiresIn,
      baseUrl: this.appBaseUrl,
    });
    await this.send({ to, subject, html });
  }

  async sendPaymentConfirmed(to: string, data: PaymentConfirmedEmailData): Promise<void> {
    const { subject, html } = renderPaymentConfirmed({
      fullName: data.fullName,
      regCode: data.regCode,
      payments: data.payments,
      branch: data.branch,
      attendanceIntent: data.attendanceIntent,
      participationType: data.participationType,
      alumniMeal: data.alumniMeal,
      tshirtSize: data.tshirtSize,
      spouseName: data.spouseName,
      childCount: data.childCount,
      guestCount: data.guestCount,
      accommodation: data.accommodation,
      checkIn: data.checkIn,
      checkOut: data.checkOut,
      extraBed: data.extraBed,
      pricingBreakup: data.pricingBreakup,
      passUrl: data.passUrl,
      baseUrl: this.appBaseUrl,
      refunds: data.refunds,
    });
    await this.send({ to, subject, html });
  }

  async sendPaymentRejected(to: string, data: PaymentRejectedEmailData): Promise<void> {
    const { subject, html } = renderPaymentRejected({
      fullName: data.fullName,
      regId: data.regId,
      regCode: data.regCode,
      comment: data.comment,
      attendanceIntent: data.attendanceIntent,
      baseUrl: this.appBaseUrl,
      paymentUrl: data.paymentUrl,
    });
    await this.send({ to, subject, html });
  }

  async sendPaymentLink(to: string, data: PaymentLinkEmailData): Promise<void> {
    const { subject, html } = renderPaymentLink({
      link: data.link,
      expiresInHours: data.expiresInHours,
      baseUrl: this.appBaseUrl,
    });
    await this.send({ to, subject, html });
  }

  async sendStaffWelcome(to: string, data: StaffWelcomeEmailData): Promise<void> {
    const { subject, html } = renderStaffWelcome({
      name: data.name,
      link: data.token,
      expiresIn: data.expiresIn,
      baseUrl: this.appBaseUrl,
    });
    await this.send({ to, subject, html });
  }

  async sendRevisedPayment(to: string, data: RevisedPaymentEmailData): Promise<void> {
    const { subject, html } = renderRevisedPayment({
      fullName: data.fullName,
      amount: data.amount,
      breakup: data.breakup,
      paymentLink: data.paymentLink,
      baseUrl: this.appBaseUrl,
    });
    await this.send({ to, subject, html });
  }

  async sendAdditionalPayment(to: string, data: AdditionalPaymentEmailData): Promise<void> {
    const { subject, html } = renderAdditionalPayment({
      fullName: data.fullName,
      amount: data.amount,
      breakup: data.breakup,
      paymentLink: data.paymentLink,
      baseUrl: this.appBaseUrl,
    });
    await this.send({ to, subject, html });
  }

  async sendStoryHidden(to: string, data: StoryHiddenEmailData): Promise<void> {
    const subject = "Your story on Smriti 2026";
    const text =
      `Hi ${data.authorName},\n\n` +
      `Your memory story on Smriti 2026 has been hidden by a moderator.\n\n` +
      `Reason: ${data.comment}\n\n` +
      `If you have questions, please reach out to the organizing committee.`;
    await this.send({ to, subject, text });
  }

  async sendTest(to: string, subject: string, text: string): Promise<void> {
    await this.send({ to, subject, text });
  }

  private async send(params: { to: string; subject: string; html?: string; text?: string }): Promise<void> {
    if (this.allowedDomains.length > 0) {
      const domain = params.to.split('@')[1]?.toLowerCase();
      if (!domain || !this.allowedDomains.includes(domain)) {
        this.log.warn('Email skipped — recipient not in allowed domains', { to: params.to, allowedDomains: this.allowedDomains });
        return;
      }
    }

    const form = new FormData();
    form.append('from', this.from);
    form.append('to', params.to);
    form.append('subject', params.subject);
    if (params.html) form.append('html', params.html);
    if (params.text) form.append('text', params.text);

    this.log.debug('Mailgun POST', { url: this.baseUrl, to: params.to, subject: params.subject });
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { Authorization: this.authHeader },
      body: form,
    });
    this.log.debug('Mailgun response', { status: res.status, statusText: res.statusText });

    if (!res.ok) {
      const body = await res.text();
      this.log.error('Mailgun API error', { status: res.status, to: params.to, body });
      throw new Error(`Mailgun API error ${res.status}: ${body}`);
    }
  }
}
