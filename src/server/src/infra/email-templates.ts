import { formatRegCodeForDisplay, PARTICIPATION_LABELS, MEAL_LABELS, ACCOMMODATION_LABELS, formatINR } from '@smriti/shared';
import type { PricingBreakup } from '@smriti/shared';

// ---------------------------------------------------------------------------
// Shared registration details shape (used by both email types)
// ---------------------------------------------------------------------------

interface RegistrationDetails {
  alumniMeal: string;
  tshirtSize: string | null;
  spouseName: string | null;
  childCount: number;
  guestCount: number;
  accommodation: string;   // AccommodationType string
  checkIn: string | null;  // ISO "2026-08-14"
  checkOut: string | null;
  extraBed: boolean;
}

export interface PaymentConfirmedContext extends RegistrationDetails {
  fullName: string;
  regCode: string;
  payments: Array<{ amount: number; referenceId: string; date: number }>;
  branch: string;
  attendanceIntent: string;
  participationType: string;
  pricingBreakup: PricingBreakup;
  passUrl: string;
  baseUrl: string;
  refunds?: Array<{ amount: number }>;
}

export interface PaymentRejectedContext {
  fullName: string;
  regId: string;
  regCode: string;
  comment: string;
  attendanceIntent: string;
  baseUrl: string;
  /** Full magic payment URL. Falls back to {baseUrl}/pay/{regCode} when absent. */
  paymentUrl?: string;
}

export interface StaffWelcomeContext {
  name: string;
  link: string;
  expiresIn: number;
  baseUrl: string;
}

export interface ConfirmationContext extends RegistrationDetails {
  fullName: string;
  regCode: string;
  regId: string;
  totalAmount: number;
  attendanceIntent: string;
  participationType: string;
  pricingBreakup: PricingBreakup;
  baseUrl: string;
  /** Full magic payment URL. Falls back to {baseUrl}/pay/{regCode} when absent. */
  paymentUrl?: string;
}

export interface PaymentLinkContext {
  link: string;
  expiresInHours: number;
  baseUrl: string;
}

export interface MagicLinkContext {
  link: string;
  expiresIn: number;
  baseUrl: string;
}

// ---------------------------------------------------------------------------
// Layout + utilities
// ---------------------------------------------------------------------------

function layout(subject: string, bodyHtml: string, baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(subject)}</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 24px 16px; }
    .card { background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .header { text-align: center; padding-bottom: 24px; border-bottom: 2px solid #B9DFE2; margin-bottom: 24px; }
    .header h1 { color: #D76B51; font-size: 22px; margin: 0; font-weight: 700; }
    .header .tagline { color: #888; font-size: 13px; margin-top: 4px; }
    .content { color: #333; font-size: 15px; line-height: 1.6; }
    .content h2 { color: #D76B51; font-size: 18px; margin: 0 0 16px; }
    .content h3 { color: #555; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 20px 0 8px; }
    .highlight-box { background: #f0fafb; border-left: 4px solid #B9DFE2; padding: 16px; border-radius: 0 8px 8px 0; margin: 16px 0; }
    .highlight-box .label { font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; margin-bottom: 4px; }
    .highlight-box .value { font-size: 20px; font-weight: 700; color: #333; }
    .hero-box { background: #1F2A33; border-radius: 10px; padding: 20px 24px; text-align: center; margin: 20px 0; }
    .hero-box .label { font-size: 12px; text-transform: uppercase; color: rgba(255,255,255,0.8); letter-spacing: 0.5px; margin-bottom: 6px; }
    .hero-box .value { font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: 1px; }
    .summary-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    .summary-table td { padding: 5px 0; font-size: 14px; }
    .summary-table td:first-child { color: #888; width: 45%; }
    .summary-table td:last-child { color: #333; font-weight: 500; }
    .cost-table { width: 100%; border-collapse: collapse; margin: 8px 0 4px; }
    .cost-table td { padding: 6px 0; font-size: 14px; color: #333; border-bottom: 1px solid #f0f0f0; }
    .cost-table td:last-child { text-align: right; font-weight: 500; white-space: nowrap; }
    .cost-table .free { color: #999; font-weight: 400; }
    .cost-table tr.total td { border-top: 2px solid #ddd; border-bottom: none; padding-top: 10px; font-size: 16px; font-weight: 700; color: #1F2A33; }
    .payment-muted { background: #f9f9f9; border-left: 3px solid #ddd; padding: 12px 16px; border-radius: 0 6px 6px 0; margin: 16px 0; font-size: 13px; color: #666; }
    .payment-muted .row { display: flex; justify-content: space-between; padding: 2px 0; }
    .btn { display: inline-block; background: #D76B51; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; }
    .footer { text-align: center; padding-top: 24px; margin-top: 24px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
    .footer a { color: #B9DFE2; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <h1>Smriti 2026</h1>
        <div class="tagline">TKMCE Batch of 2006 &mdash; 20 Year Reunion &mdash; Aug 15</div>
      </div>
      <div class="content">
        ${bodyHtml}
      </div>
      <div class="footer">
        <p>Smriti &rsquo;26 &mdash; TKMCE Batch of 2006 Reunion<br>
        <em style="font-style: italic; color: #bbb;">Campus corridors to global paths&hellip; and back to TKMCE once again&hellip;</em><br>
        <a href="${esc(baseUrl)}">${esc(baseUrl.replace(/^https?:\/\//, ''))}</a></p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Turn "2026-08-14" → "14 Aug 2026". Guards null/empty. Pure string parse — no Date/timezone. */
function formatEmailDate(iso: string | null): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[(parseInt(month, 10) - 1)] ?? month;
  return `${parseInt(day, 10)} ${monthName} ${year}`;
}

/** Turn a Unix epoch ms value into "1 Jul 2026" (UTC). */
function formatEpochDate(epochMs: number): string {
  const d = new Date(epochMs);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function renderCostBreakdown(breakup: PricingBreakup, baseLabel?: string): string {
  if (breakup.total <= 0) return '';

  const rows: string[] = [];

  if (breakup.base > 0) {
    const label = baseLabel ?? 'Reunion contribution';
    rows.push(`<tr><td>${esc(label)}</td><td>${esc(formatINR(breakup.base))}</td></tr>`);
  }

  for (const line of breakup.lines) {
    const amountCell = line.free
      ? `<span class="free">Free</span>`
      : esc(formatINR(line.fee));
    rows.push(`<tr><td>${esc(line.label)}</td><td>${amountCell}</td></tr>`);
  }

  if (breakup.donation > 0) {
    rows.push(`<tr><td>Donation</td><td>${esc(formatINR(breakup.donation))}</td></tr>`);
  }

  rows.push(`<tr class="total"><td>Total</td><td>${esc(formatINR(breakup.total))}</td></tr>`);

  return `<h3>Cost Breakdown</h3>
<table class="cost-table"><tbody>
${rows.join('\n')}
</tbody></table>`;
}

function renderPaymentConfirmation(
  payments: Array<{ amount: number; referenceId: string; date: number }>,
  amountLabel: string,
  refunds?: Array<{ amount: number }>,
): string {
  const rows = payments
    .map(
      (p, i) => `<div class="payment-muted"${payments.length > 1 ? ' style="margin-bottom: 8px;"' : ''}>
  <div class="row"><span>${payments.length > 1 ? `Payment ${i + 1} — ${formatEpochDate(p.date)}` : `${amountLabel} — ${formatEpochDate(p.date)}`}</span><span>${esc(formatINR(p.amount))}</span></div>
  <div class="row"><span>Reference ID</span><span>${esc(p.referenceId)}</span></div>
</div>`,
    )
    .join('\n');

  const totalReceived = payments.reduce((s, p) => s + p.amount, 0);
  const totalRefunds = (refunds ?? []).reduce((s, r) => s + r.amount, 0);

  let summaryHtml = '';
  if (refunds?.length) {
    const refundLines = refunds
      .map(r => `<div class="row"><span>Refund pending</span><span>${esc(formatINR(r.amount))}</span></div>`)
      .join('\n  ');
    summaryHtml = `<div class="payment-muted" style="border-left-color: #B9DFE2; font-weight: 600;">
  <div class="row"><span>Total received</span><span>${esc(formatINR(totalReceived))}</span></div>
</div>
<div class="payment-muted" style="border-left-color: #D76B51;">
  ${refundLines}
</div>
<div class="payment-muted" style="border-left-color: #B9DFE2; font-weight: 600;">
  <div class="row"><span>Applied to registration</span><span>${esc(formatINR(totalReceived - totalRefunds))}</span></div>
</div>`;
  } else if (payments.length > 1) {
    summaryHtml = `<div class="payment-muted" style="border-left-color: #B9DFE2; font-weight: 600;">
  <div class="row"><span>Total paid</span><span>${esc(formatINR(totalReceived))}</span></div>
</div>`;
  }

  return `<h3>Payment Confirmation</h3>
${rows}
${summaryHtml}`;
}

function renderRegistrationDetails(d: RegistrationDetails): string {
  const mealLabel = MEAL_LABELS[d.alumniMeal as keyof typeof MEAL_LABELS] ?? d.alumniMeal;
  const tshirtRow = d.tshirtSize
    ? `<tr><td>T-shirt size</td><td>${esc(d.tshirtSize)}</td></tr>`
    : '';

  const registrationSection = `<h3>Preferences</h3>
<table class="summary-table"><tbody>
  <tr><td>Meal preference</td><td>${esc(mealLabel)}</td></tr>
  ${tshirtRow}
</tbody></table>`;

  let accommodationSection = '';
  if (d.accommodation !== 'none') {
    const accommodationLabel = ACCOMMODATION_LABELS[d.accommodation as keyof typeof ACCOMMODATION_LABELS] ?? d.accommodation;
    const checkInFormatted = formatEmailDate(d.checkIn);
    const checkOutFormatted = formatEmailDate(d.checkOut);
    const extraBedRow = d.extraBed
      ? `<tr><td>Extra bed</td><td>Yes</td></tr>`
      : '';
    accommodationSection = `<h3>Accommodation</h3>
<table class="summary-table"><tbody>
  <tr><td>Type</td><td>${esc(accommodationLabel)}</td></tr>
  ${checkInFormatted ? `<tr><td>Check-in</td><td>${esc(checkInFormatted)}</td></tr>` : ''}
  ${checkOutFormatted ? `<tr><td>Check-out</td><td>${esc(checkOutFormatted)}</td></tr>` : ''}
  ${extraBedRow}
</tbody></table>`;
  }

  const groupRows: string[] = [];
  if (d.spouseName) groupRows.push(`<tr><td>Spouse</td><td>${esc(d.spouseName)}</td></tr>`);
  if (d.childCount > 0) groupRows.push(`<tr><td>Children</td><td>${d.childCount}</td></tr>`);
  if (d.guestCount > 0) groupRows.push(`<tr><td>Guests</td><td>${d.guestCount}</td></tr>`);

  const groupSection = groupRows.length > 0
    ? `<h3>Your Group</h3>
<table class="summary-table"><tbody>${groupRows.join('')}</tbody></table>`
    : '';

  return `${registrationSection}${accommodationSection}${groupSection}`;
}

// ---------------------------------------------------------------------------
// renderConfirmation (payment-request email)
// ---------------------------------------------------------------------------

export function renderConfirmation(ctx: ConfirmationContext): { subject: string; html: string } {
  const isDonor = ctx.attendanceIntent === 'donation_only';

  if (isDonor) {
    return renderConfirmationDonor(ctx);
  }
  return renderConfirmationAttendee(ctx);
}

function renderConfirmationAttendee(ctx: ConfirmationContext): { subject: string; html: string } {
  const participationLabel = PARTICIPATION_LABELS[ctx.participationType as keyof typeof PARTICIPATION_LABELS] ?? ctx.participationType;
  const subject = `Smriti '26 | TKMCE 2006 Reunion — Complete Your Payment`;

  const amountDueBox = ctx.totalAmount > 0
    ? `<div class="highlight-box">
  <div class="label">Amount Due</div>
  <div class="value">${esc(formatINR(ctx.totalAmount))}</div>
</div>`
    : '';

  const effectivePaymentUrl = ctx.paymentUrl ?? `${ctx.baseUrl}/pay/${ctx.regCode}`;
  const ctaSection = ctx.totalAmount > 0
    ? `<p>To secure your spot at the reunion, please complete your payment. You can pay via bank transfer or UPI — details are on the payment page.</p>

<p style="text-align: center; margin: 24px 0;">
  <a href="${esc(effectivePaymentUrl)}" class="btn">Complete Payment</a>
</p>`
    : `<p>No payment is required. Your spot is confirmed!</p>`;

  const body = `<h2>One last step &mdash; complete your payment</h2>

<p>Hi ${esc(ctx.fullName)},</p>

<p>We&rsquo;ve received your registration for Smriti 2026. Your spot will be confirmed once your payment is received and verified.</p>

${amountDueBox}

${renderCostBreakdown(ctx.pricingBreakup, participationLabel)}

${renderRegistrationDetails(ctx)}

${ctaSection}

<p>If you have any questions, feel free to reach out to the organizing committee.</p>

<p>See you at TKMCE on August 15!<br>
<strong>Smriti 2026 Organizing Committee</strong></p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}

function renderConfirmationDonor(ctx: ConfirmationContext): { subject: string; html: string } {
  const subject = `Smriti '26 | TKMCE 2006 Reunion — Thank You for Your Contribution`;

  const effectiveDonorPaymentUrl = ctx.paymentUrl ?? `${ctx.baseUrl}/pay/${ctx.regCode}`;
  const paymentSection = ctx.totalAmount > 0
    ? `${renderCostBreakdown(ctx.pricingBreakup)}

<div class="highlight-box">
  <div class="label">Total Contribution</div>
  <div class="value">${esc(formatINR(ctx.totalAmount))}</div>
</div>

<p>To complete your contribution, please transfer the amount via bank transfer or UPI. You&rsquo;ll find the details on the payment page.</p>

<p style="text-align: center; margin: 24px 0;">
  <a href="${esc(effectiveDonorPaymentUrl)}" class="btn">Complete Your Contribution</a>
</p>`
    : `<p>Thank you for registering your support! No payment is needed.</p>`;

  const body = `<h2>Thank You for Your Generous Contribution</h2>

<p>Hi ${esc(ctx.fullName)},</p>

<p>We&rsquo;ve received your donation registration for Smriti 2026. Your support means a lot to the batch and helps make the reunion possible.</p>

${paymentSection}

<p>If you have any questions, feel free to reach out to the organizing committee.</p>

<p>Warm regards,<br>
<strong>Smriti 2026 Organizing Committee</strong></p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}

// ---------------------------------------------------------------------------
// renderMagicLink
// ---------------------------------------------------------------------------

export function renderMagicLink(ctx: MagicLinkContext): { subject: string; html: string } {
  const subject = `Smriti '26 | TKMCE 2006 Reunion — Your Login Link`;

  const body = `<h2>Your Login Link</h2>

<p>You requested access to your Smriti 2026 registration. Click the button below to sign in:</p>

<p style="text-align: center; margin: 24px 0;">
  <a href="${esc(ctx.link)}" class="btn">Sign In to Smriti 2026</a>
</p>

<p>This link expires in <strong>${ctx.expiresIn} minutes</strong>. If you didn&rsquo;t request this, you can safely ignore this email.</p>

<p style="font-size: 12px; color: #999;">If the button doesn&rsquo;t work, copy and paste this URL into your browser:<br>
<a href="${esc(ctx.link)}" style="color: #B9DFE2; word-break: break-all;">${esc(ctx.link)}</a></p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}

// ---------------------------------------------------------------------------
// renderPaymentConfirmed (post-payment confirmation email)
// ---------------------------------------------------------------------------

export function renderPaymentConfirmed(ctx: PaymentConfirmedContext): { subject: string; html: string } {
  const isDonor = ctx.attendanceIntent === 'donation_only';
  if (isDonor) {
    return renderPaymentConfirmedDonor(ctx);
  }
  return renderPaymentConfirmedAttendee(ctx);
}

function renderPaymentConfirmedAttendee(ctx: PaymentConfirmedContext): { subject: string; html: string } {
  const displayCode = formatRegCodeForDisplay(ctx.regCode);
  const participationLabel = PARTICIPATION_LABELS[ctx.participationType as keyof typeof PARTICIPATION_LABELS] ?? ctx.participationType;
  const subject = `Smriti '26 | TKMCE 2006 Reunion — You're All Set! (${displayCode})`;

  const body = `<h2>You&rsquo;re All Set for Smriti 2026! &#127881;</h2>

<p>Hi ${esc(ctx.fullName)},</p>

<p>Your payment has been verified and your registration is confirmed. We can&rsquo;t wait to see you at TKMCE on <strong>August 15</strong>!</p>

<div class="hero-box">
  <div class="label">Your Registration Code</div>
  <div class="value">${esc(displayCode)}</div>
</div>

<p style="text-align: center; margin: 20px 0;">
  <a href="${esc(ctx.passUrl)}" class="btn">View Your Entry Pass</a>
</p>

<h3>Registration Summary</h3>
<table class="summary-table"><tbody>
  <tr><td>Name</td><td>${esc(ctx.fullName)}</td></tr>
  <tr><td>Branch</td><td>${esc(ctx.branch)}</td></tr>
  <tr><td>Participation</td><td>${esc(participationLabel)}</td></tr>
</tbody></table>

${renderRegistrationDetails(ctx)}

${renderCostBreakdown(ctx.pricingBreakup, participationLabel)}

${renderPaymentConfirmation(ctx.payments, 'Amount paid', ctx.refunds)}

<h3>What&rsquo;s Next</h3>
<p>Save your entry pass — you&rsquo;ll use it to check in at the event on <strong>August 15</strong>. Your pass includes a QR code that the check-in desk will scan.</p>

<p><strong>Smriti 2026 Organizing Committee</strong></p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}

function renderPaymentConfirmedDonor(ctx: PaymentConfirmedContext): { subject: string; html: string } {
  const displayCode = formatRegCodeForDisplay(ctx.regCode);
  const subject = `Smriti '26 | TKMCE 2006 Reunion — Donation Confirmed (${displayCode})`;

  const body = `<h2>Thank You for Your Generous Contribution! &#128150;</h2>

<p>Hi ${esc(ctx.fullName)},</p>

<p>Your contribution for Smriti 2026 has been verified. Thank you for your support — it means a lot to the batch and helps make the reunion a reality.</p>

<div class="hero-box">
  <div class="label">Your Registration Code</div>
  <div class="value">${esc(displayCode)}</div>
</div>

<h3>Contribution Details</h3>
<table class="summary-table"><tbody>
  <tr><td>Name</td><td>${esc(ctx.fullName)}</td></tr>
  <tr><td>Branch</td><td>${esc(ctx.branch)}</td></tr>
</tbody></table>

${renderCostBreakdown(ctx.pricingBreakup)}

${renderPaymentConfirmation(ctx.payments, 'Amount received', ctx.refunds)}

<p>If you have any questions, feel free to reach out to the organizing committee.</p>

<p>Warm regards,<br>
<strong>Smriti 2026 Organizing Committee</strong></p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}

// ---------------------------------------------------------------------------
// renderPaymentRejected
// ---------------------------------------------------------------------------

export function renderPaymentRejected(ctx: PaymentRejectedContext): { subject: string; html: string } {
  const isDonor = ctx.attendanceIntent === 'donation_only';
  const subject = isDonor
    ? `Smriti '26 | TKMCE 2006 Reunion — Donation Proof Not Accepted`
    : `Smriti '26 | TKMCE 2006 Reunion — Payment Proof Not Accepted`;
  const paymentLink = ctx.paymentUrl ?? `${ctx.baseUrl}/pay/${ctx.regCode}`;

  const body = isDonor
    ? `<h2>Your donation proof was not accepted</h2>

<p>Hi ${esc(ctx.fullName)},</p>

<p>We reviewed the payment proof you submitted for your Smriti 2026 donation, but were unable to accept it.</p>

<div class="highlight-box">
  <div class="label">Reason</div>
  <div class="value" style="font-size: 15px; font-weight: 400;">${esc(ctx.comment)}</div>
</div>

<p>Please go back to the payment page and re-upload a valid payment proof to complete your donation.</p>

<p style="text-align: center; margin: 24px 0;">
  <a href="${paymentLink}" class="btn">Re-upload Payment Proof</a>
</p>

<p>If you have any questions, please reach out to the organizing committee.</p>

<p><strong>Smriti 2026 Organizing Committee</strong></p>`
    : `<h2>Your payment proof was not accepted</h2>

<p>Hi ${esc(ctx.fullName)},</p>

<p>We reviewed the payment proof you submitted for your Smriti 2026 registration, but were unable to accept it.</p>

<div class="highlight-box">
  <div class="label">Reason</div>
  <div class="value" style="font-size: 15px; font-weight: 400;">${esc(ctx.comment)}</div>
</div>

<p>Please go back to the payment page and re-upload a valid payment proof to complete your registration.</p>

<p style="text-align: center; margin: 24px 0;">
  <a href="${paymentLink}" class="btn">Re-upload Payment Proof</a>
</p>

<p>If you have any questions, please reach out to the organizing committee.</p>

<p><strong>Smriti 2026 Organizing Committee</strong></p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}

// ---------------------------------------------------------------------------
// renderPaymentLink
// ---------------------------------------------------------------------------

export function renderPaymentLink(ctx: PaymentLinkContext): { subject: string; html: string } {
  const subject = `Smriti '26 | TKMCE 2006 Reunion — Your Payment Link`;

  const body = `<h2>Your Payment Link</h2>

<p>You requested a payment link for your Smriti 2026 registration. Click the button below to open your payment page:</p>

<p style="text-align: center; margin: 24px 0;">
  <a href="${esc(ctx.link)}" class="btn">Open Payment Page</a>
</p>

<p>This link is valid for <strong>${ctx.expiresInHours} hours</strong> and can be used once. If it has expired, visit the payment page and request a fresh link.</p>

<p>If you didn&rsquo;t request this link, you can safely ignore this email.</p>

<p style="font-size: 12px; color: #999;">If the button doesn&rsquo;t work, copy and paste this URL into your browser:<br>
<a href="${esc(ctx.link)}" style="color: #B9DFE2; word-break: break-all;">${esc(ctx.link)}</a></p>

<p style="font-size: 13px; color: #888;">Can&rsquo;t find this email later? Check your spam folder — it may have landed there.</p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}

// ---------------------------------------------------------------------------
// renderStaffWelcome
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// renderRevisedPayment — staff edit updated existing pending payment amount
// ---------------------------------------------------------------------------

export interface RevisedPaymentContext {
  fullName: string;
  /** Updated outstanding amount. */
  amount: number;
  breakup: PricingBreakup;
  paymentLink: string;
  baseUrl: string;
}

export function renderRevisedPayment(ctx: RevisedPaymentContext): { subject: string; html: string } {
  const subject = `REVISED: Payment required for your Smriti '26 registration`;

  const lineRows = ctx.breakup.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.label)}</td><td class="${l.free ? 'free' : ''}">${l.free ? 'Free' : formatINR(l.fee)}</td></tr>`,
    )
    .join('');

  const body = `<h2>Your Registration Has Been Updated</h2>

<p>Hi ${esc(ctx.fullName)},</p>

<p>Your registration for Smriti 2026 has been updated by the organizing committee. The outstanding payment amount has changed.</p>

<div class="highlight-box">
  <div class="label">REVISED OUTSTANDING AMOUNT</div>
  <div class="value">${formatINR(ctx.amount)}</div>
</div>

${lineRows.length > 0 ? `<h3>Pricing Breakdown</h3>
<table class="cost-table">
  ${lineRows}
  <tr class="total"><td>Total</td><td>${formatINR(ctx.breakup.total)}</td></tr>
</table>` : ''}

<p>Please complete your payment at your earliest convenience.</p>

<p style="text-align: center; margin: 24px 0;">
  <a href="${esc(ctx.paymentLink)}" class="btn">Pay Now — ${formatINR(ctx.amount)}</a>
</p>

<p style="font-size: 12px; color: #999;">If the button doesn&rsquo;t work, copy and paste this URL into your browser:<br>
<a href="${esc(ctx.paymentLink)}" style="color: #B9DFE2; word-break: break-all;">${esc(ctx.paymentLink)}</a></p>

<p>If you have any questions about this change, please reach out to the organizing committee.</p>

<p><strong>Smriti 2026 Organizing Committee</strong></p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}

// ---------------------------------------------------------------------------
// renderAdditionalPayment — staff edit on confirmed registration creates new pending payment
// ---------------------------------------------------------------------------

export interface AdditionalPaymentContext {
  fullName: string;
  /** Additional amount owed due to the registration change. */
  amount: number;
  breakup: PricingBreakup;
  paymentLink: string;
  baseUrl: string;
}

export function renderAdditionalPayment(ctx: AdditionalPaymentContext): { subject: string; html: string } {
  const subject = `Action required: Additional payment for your Smriti '26 registration`;

  const lineRows = ctx.breakup.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.label)}</td><td class="${l.free ? 'free' : ''}">${l.free ? 'Free' : formatINR(l.fee)}</td></tr>`,
    )
    .join('');

  const body = `<h2>Additional Payment Required</h2>

<p>Hi ${esc(ctx.fullName)},</p>

<p>Your registration for Smriti 2026 has been updated by the organizing committee. An additional payment is required for the changes made.</p>

<div class="highlight-box">
  <div class="label">ADDITIONAL PAYMENT REQUIRED</div>
  <div class="value">${formatINR(ctx.amount)}</div>
</div>

${lineRows.length > 0 ? `<h3>Updated Pricing Breakdown</h3>
<table class="cost-table">
  ${lineRows}
  <tr class="total"><td>Updated Total</td><td>${formatINR(ctx.breakup.total)}</td></tr>
</table>` : ''}

<p>Please complete this additional payment to confirm your updated registration.</p>

<p style="text-align: center; margin: 24px 0;">
  <a href="${esc(ctx.paymentLink)}" class="btn">Pay Additional Amount — ${formatINR(ctx.amount)}</a>
</p>

<p style="font-size: 12px; color: #999;">If the button doesn&rsquo;t work, copy and paste this URL into your browser:<br>
<a href="${esc(ctx.paymentLink)}" style="color: #B9DFE2; word-break: break-all;">${esc(ctx.paymentLink)}</a></p>

<p>If you have any questions about this change, please reach out to the organizing committee.</p>

<p><strong>Smriti 2026 Organizing Committee</strong></p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}

export function renderStaffWelcome(ctx: StaffWelcomeContext): { subject: string; html: string } {
  const subject = `Smriti '26 | TKMCE 2006 Reunion — Staff Access`;

  const body = `<h2>You&rsquo;ve been added to the team</h2>

<p>Hi ${esc(ctx.name)},</p>

<p>You&rsquo;ve been added to the Smriti 2026 organizing team. Click the button below to log in to the staff dashboard:</p>

<p style="text-align: center; margin: 24px 0;">
  <a href="${esc(ctx.link)}" class="btn">Access Staff Dashboard</a>
</p>

<p>This link expires in <strong>${ctx.expiresIn} minutes</strong>. After that, you can request a new login link from the dashboard.</p>

<p style="font-size: 12px; color: #999;">If the button doesn&rsquo;t work, copy and paste this URL into your browser:<br>
<a href="${esc(ctx.link)}" style="color: #B9DFE2; word-break: break-all;">${esc(ctx.link)}</a></p>

<p><strong>Smriti 2026 Organizing Committee</strong></p>`;

  return { subject, html: layout(subject, body, ctx.baseUrl) };
}
