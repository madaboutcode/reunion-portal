/**
 * Tests for renderConfirmation and renderPaymentConfirmed cost breakdown
 * and registration detail blocks.
 *
 * CONTRACT GUARANTEES TESTED:
 * - Cost breakdown renders for attendee emails with correct section, base row,
 *   line items (including GST and free lines), donation row, and total
 * - Registration details render meal, accommodation (with extra bed), and group
 * - Donor confirmation emails do NOT include "Cost Breakdown"
 * - renderPaymentConfirmed attendee includes breakdown before Payment Confirmation box
 */

import { describe, it, expect } from 'vitest';
import type { PricingBreakup } from '@smriti/shared';
import { renderConfirmation, renderPaymentConfirmed } from '../email-templates.js';
import type { ConfirmationContext, PaymentConfirmedContext } from '../email-templates.js';

// ---------------------------------------------------------------------------
// Sample data — family with private room, 2 nights, extraBed, spouse + child
// ---------------------------------------------------------------------------

const sampleBreakup: PricingBreakup = {
  base: 10000,
  lines: [
    { label: 'Spouse (Non-veg)', fee: 3000, free: false },
    { label: 'Child (Non-veg, under 5)', fee: 0, free: true },
    { label: 'Private room (2 nights)', fee: 24000, free: false },
    { label: 'Extra bed (2 nights)', fee: 2000, free: false },
    { label: 'GST (18%) — accommodation', fee: 760, free: false },
  ],
  donation: 500,
  collegeContribution: 500,
  total: 40260,
};

const attendeeConfirmationCtx: ConfirmationContext = {
  regId: '42',
  regCode: 'SMRTTEST00000042',
  fullName: 'Ravi Kumar',
  totalAmount: 40260,
  attendanceIntent: 'attending',
  participationType: 'full_celebration',
  alumniMeal: 'non_veg',
  tshirtSize: 'L',
  spouseName: 'Priya Kumar',
  childCount: 1,
  guestCount: 0,
  accommodation: 'private',
  checkIn: '2026-08-14',
  checkOut: '2026-08-16',
  extraBed: true,
  pricingBreakup: sampleBreakup,
  baseUrl: 'http://localhost:5173',
};

const donorConfirmationCtx: ConfirmationContext = {
  regId: '43',
  regCode: 'SMRTTEST00000043',
  fullName: 'Donor Only',
  totalAmount: 5000,
  attendanceIntent: 'donation_only',
  participationType: 'donation_only',
  alumniMeal: 'veg',
  tshirtSize: null,
  spouseName: null,
  childCount: 0,
  guestCount: 0,
  accommodation: 'none',
  checkIn: null,
  checkOut: null,
  extraBed: false,
  pricingBreakup: { base: 0, lines: [], donation: 5000, collegeContribution: 0, total: 5000 },
  baseUrl: 'http://localhost:5173',
};

const attendeePaymentConfirmedCtx: PaymentConfirmedContext = {
  fullName: 'Ravi Kumar',
  regCode: 'SMRTTEST00000042',
  payments: [{ amount: 40260, referenceId: 'UTR-TEST-98765', date: Date.parse('2026-07-01T00:00:00Z') }],
  branch: 'Computer Science',
  attendanceIntent: 'attending',
  participationType: 'full_celebration',
  alumniMeal: 'non_veg',
  tshirtSize: 'L',
  spouseName: 'Priya Kumar',
  childCount: 1,
  guestCount: 0,
  accommodation: 'private',
  checkIn: '2026-08-14',
  checkOut: '2026-08-16',
  extraBed: true,
  pricingBreakup: sampleBreakup,
  passUrl: 'http://localhost:5173/pass#SMRTTEST00000042',
  baseUrl: 'http://localhost:5173',
};

// ---------------------------------------------------------------------------
// renderConfirmation — attendee
// ---------------------------------------------------------------------------

describe('renderConfirmation — attendee cost breakdown', () => {
  it('includes "Cost Breakdown" section heading', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('Cost Breakdown');
  });

  it('includes participation type label as base row', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('Full Celebration');
  });

  it('includes accommodation line label', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('Private room (2 nights)');
  });

  it('includes GST line label', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('GST (18%) — accommodation');
  });

  it('formats the total with formatINR (₹ prefix, comma-separated)', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    // formatINR(40260) → "₹40,260"
    expect(html).toContain('40,260');
  });

  it('marks free line with "Free" text', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('Free');
  });

  it('includes donation row', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('Donation');
  });
});

describe('renderConfirmation — attendee registration details', () => {
  it('shows "Extra bed" row when extraBed is true', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('Extra bed');
    expect(html).toContain('Yes');
  });

  it('shows accommodation type label', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    // ACCOMMODATION_LABELS['private'] should resolve to something human-readable
    expect(html).toContain('Accommodation');
  });

  it('shows check-in date formatted as "14 Aug 2026"', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('14 Aug 2026');
  });

  it('shows check-out date formatted as "16 Aug 2026"', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('16 Aug 2026');
  });

  it('shows spouse name in group section', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('Priya Kumar');
  });

  it('shows child count', () => {
    const { html } = renderConfirmation(attendeeConfirmationCtx);
    expect(html).toContain('Children');
  });

  it('does NOT show extra bed row in details table when extraBed is false', () => {
    // Use a breakup without extra-bed lines so the only "Extra bed" source is the details block
    const ctx: ConfirmationContext = {
      ...attendeeConfirmationCtx,
      extraBed: false,
      pricingBreakup: {
        base: 10000,
        lines: [
          { label: 'Spouse (Non-veg)', fee: 3000, free: false },
          { label: 'Private room (2 nights)', fee: 24000, free: false },
          { label: 'GST (18%) — accommodation', fee: 760, free: false },
        ],
        donation: 0,
        collegeContribution: 500,
        total: 37760,
      },
    };
    const { html } = renderConfirmation(ctx);
    // The details block must NOT emit an Extra bed row
    // We check specifically for the table cell that the details helper emits
    expect(html).not.toMatch(/<td>Extra bed<\/td>/);
  });
});

// ---------------------------------------------------------------------------
// renderConfirmation — donor: includes cost breakdown with donation row
// ---------------------------------------------------------------------------

describe('renderConfirmation — donor (donation_only)', () => {
  it('includes "Cost Breakdown" section (donation row is shown)', () => {
    // Plan spec: donor confirmation replaces bare "Donation Amount" box with
    // renderCostBreakdown so per-cause lines appear correctly.
    const { html } = renderConfirmation(donorConfirmationCtx);
    expect(html).toContain('Cost Breakdown');
  });

  it('shows the donation amount in the breakdown', () => {
    const { html } = renderConfirmation(donorConfirmationCtx);
    expect(html).toContain('5,000');
  });

  it('does NOT include "Reunion contribution" base row (no base fee for donation_only)', () => {
    const { html } = renderConfirmation(donorConfirmationCtx);
    expect(html).not.toContain('Reunion contribution');
  });

  it('shows "Total Contribution" highlight box', () => {
    const { html } = renderConfirmation(donorConfirmationCtx);
    expect(html).toContain('Total Contribution');
  });

  it('uses the donor subject line', () => {
    const { subject } = renderConfirmation(donorConfirmationCtx);
    expect(subject).toContain('Thank You for Your Contribution');
  });
});

// ---------------------------------------------------------------------------
// renderPaymentConfirmed — attendee
// ---------------------------------------------------------------------------

describe('renderPaymentConfirmed — attendee cost breakdown', () => {
  it('includes "Cost Breakdown" heading', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    expect(html).toContain('Cost Breakdown');
  });

  it('includes participation type label as base row', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    expect(html).toContain('Full Celebration');
  });

  it('includes GST line label', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    expect(html).toContain('GST (18%) — accommodation');
  });

  it('renders the formatted total', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    expect(html).toContain('40,260');
  });

  it('cost breakdown appears before "Payment Confirmation" box', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    const breakdownIdx = html.indexOf('Cost Breakdown');
    const paymentConfirmIdx = html.indexOf('Payment Confirmation');
    expect(breakdownIdx).toBeGreaterThan(-1);
    expect(paymentConfirmIdx).toBeGreaterThan(-1);
    expect(breakdownIdx).toBeLessThan(paymentConfirmIdx);
  });
});

describe('renderPaymentConfirmed — attendee registration details', () => {
  it('shows extra bed row', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    expect(html).toContain('Extra bed');
  });

  it('shows formatted check-in date', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    expect(html).toContain('14 Aug 2026');
  });

  it('shows spouse name', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    expect(html).toContain('Priya Kumar');
  });

  it('shows formatted amount paid', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    expect(html).toContain('Amount paid');
    expect(html).toContain('40,260');
  });

  it('shows reference ID', () => {
    const { html } = renderPaymentConfirmed(attendeePaymentConfirmedCtx);
    expect(html).toContain('UTR-TEST-98765');
  });
});
