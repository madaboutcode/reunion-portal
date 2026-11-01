import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  isValidPaymentTransition,
  deriveRegistrationStatus,
} from '../status.js';
import type {
  RegistrationStatus,
  PaymentStatus,
  AuditAction,
} from '../status.js';
import { toPayment } from '../types.js';
import type { PaymentRow } from '../types.js';

// ---------------------------------------------------------------------------
// AuditAction — compile-time union check
// ---------------------------------------------------------------------------

describe('AuditAction union', () => {
  it('accepts proof_uploaded', () => {
    const action: AuditAction = 'proof_uploaded';
    expect(action).toBe('proof_uploaded');
  });

  it('accepts payment_verified', () => {
    const action: AuditAction = 'payment_verified';
    expect(action).toBe('payment_verified');
  });

  it('accepts payment_created', () => {
    const action: AuditAction = 'payment_created';
    expect(action).toBe('payment_created');
  });

  it('accepts created (legacy, still valid)', () => {
    const action: AuditAction = 'created';
    expect(action).toBe('created');
  });

  it('accepts updated (legacy, still valid)', () => {
    const action: AuditAction = 'updated';
    expect(action).toBe('updated');
  });

  it('accepts amended (legacy, still valid)', () => {
    const action: AuditAction = 'amended';
    expect(action).toBe('amended');
  });
});

// ---------------------------------------------------------------------------
// RegistrationStatus — type check
// ---------------------------------------------------------------------------

describe('RegistrationStatus union', () => {
  it("includes 'pending'", () => {
    const s: RegistrationStatus = 'pending';
    expect(s).toBe('pending');
  });

  it("includes 'pending_verification'", () => {
    const s: RegistrationStatus = 'pending_verification';
    expect(s).toBe('pending_verification');
  });

  it("includes 'confirmed'", () => {
    const s: RegistrationStatus = 'confirmed';
    expect(s).toBe('confirmed');
  });
});

// ---------------------------------------------------------------------------
// PaymentStatus — type check
// ---------------------------------------------------------------------------

describe('PaymentStatus union', () => {
  it("includes 'payment_pending'", () => {
    const s: PaymentStatus = 'payment_pending';
    expect(s).toBe('payment_pending');
  });

  it("includes 'pending_verification'", () => {
    const s: PaymentStatus = 'pending_verification';
    expect(s).toBe('pending_verification');
  });

  it("includes 'verified'", () => {
    const s: PaymentStatus = 'verified';
    expect(s).toBe('verified');
  });
});

// ---------------------------------------------------------------------------
// isValidTransition — registration status
// ---------------------------------------------------------------------------

describe('isValidTransition — registration status', () => {
  // --- valid transitions ---

  it('pending → pending_verification is valid', () => {
    expect(isValidTransition('pending', 'pending_verification')).toBe(true);
  });

  it('pending_verification → confirmed is valid', () => {
    expect(isValidTransition('pending_verification', 'confirmed')).toBe(true);
  });

  // --- legacy transition now rejected ---

  it('pending → confirmed is valid (R7.14: delta==0 after edit removes pending payment)', () => {
    expect(isValidTransition('pending', 'confirmed')).toBe(true);
  });

  // --- reverse transitions rejected ---

  it('pending_verification → pending is valid (rejection rollback path)', () => {
    expect(isValidTransition('pending_verification', 'pending')).toBe(true);
  });

  it('confirmed → pending_verification is invalid (no rollback)', () => {
    expect(isValidTransition('confirmed', 'pending_verification')).toBe(false);
  });

  it('confirmed → pending is valid (R7.14: staff edit creates new payment obligation)', () => {
    expect(isValidTransition('confirmed', 'pending')).toBe(true);
  });

  // --- self-transitions rejected ---

  it('pending → pending is invalid (self-transition)', () => {
    expect(isValidTransition('pending', 'pending')).toBe(false);
  });

  it('pending_verification → pending_verification is invalid (self-transition)', () => {
    expect(isValidTransition('pending_verification', 'pending_verification')).toBe(
      false,
    );
  });

  it('confirmed → confirmed is invalid (self-transition)', () => {
    expect(isValidTransition('confirmed', 'confirmed')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidPaymentTransition — payment status
// ---------------------------------------------------------------------------

describe('isValidPaymentTransition — payment status', () => {
  // --- valid transitions ---

  it('payment_pending → pending_verification is valid', () => {
    expect(
      isValidPaymentTransition('payment_pending', 'pending_verification'),
    ).toBe(true);
  });

  it('pending_verification → verified is valid', () => {
    expect(isValidPaymentTransition('pending_verification', 'verified')).toBe(
      true,
    );
  });

  // --- skipping intermediate rejected ---

  it('payment_pending → verified is invalid (must go through pending_verification)', () => {
    expect(isValidPaymentTransition('payment_pending', 'verified')).toBe(false);
  });

  // --- verified is terminal (no exits) ---

  it('verified → payment_pending is invalid (terminal state)', () => {
    expect(isValidPaymentTransition('verified', 'payment_pending')).toBe(false);
  });

  it('verified → pending_verification is invalid (terminal state)', () => {
    expect(isValidPaymentTransition('verified', 'pending_verification')).toBe(
      false,
    );
  });

  // --- reverse transitions rejected ---

  it('pending_verification → payment_pending is valid (rejection rollback path)', () => {
    expect(
      isValidPaymentTransition('pending_verification', 'payment_pending'),
    ).toBe(true);
  });

  // --- self-transitions rejected ---

  it('payment_pending → payment_pending is invalid (self-transition)', () => {
    expect(
      isValidPaymentTransition('payment_pending', 'payment_pending'),
    ).toBe(false);
  });

  it('pending_verification → pending_verification is invalid (self-transition)', () => {
    expect(
      isValidPaymentTransition('pending_verification', 'pending_verification'),
    ).toBe(false);
  });

  it('verified → verified is invalid (self-transition)', () => {
    expect(isValidPaymentTransition('verified', 'verified')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toPayment — row coercion (new fields)
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 1,
    registration_id: 42,
    amount: 2500,
    status: 'payment_pending',
    gateway: null,
    gateway_ref: null,
    gateway_response: null,
    proof_file_key: null,
    verified_by: null,
    verified_at: null,
    method: null,
    note: null,
    created_at: 1700000000000,
    updated_at: 1700000001000,
    ...overrides,
  };
}

describe('toPayment — new fields', () => {
  it('toPayment maps proof_file_key from row (non-null)', () => {
    const payment = toPayment(
      makeRow({ proof_file_key: 'payment-proofs/ABC123/1/receipt.png' }),
    );
    expect(payment.proofFileKey).toBe(
      'payment-proofs/ABC123/1/receipt.png',
    );
  });

  it('toPayment maps verified_by from null row (null)', () => {
    const payment = toPayment(makeRow({ verified_by: null }));
    expect(payment.verifiedBy).toBeNull();
  });

  it('toPayment maps verified_at from row (non-null)', () => {
    const payment = toPayment(makeRow({ verified_at: 1700000100000 }));
    expect(payment.verifiedAt).toBe(1700000100000);
  });

  it('toPayment maps all new fields from a fully populated row', () => {
    const payment = toPayment(
      makeRow({
        proof_file_key: 'payment-proofs/ABC123/1/screenshot.jpg',
        verified_by: 'committee@example.test',
        verified_at: 1712345678000,
      }),
    );
    expect(payment.proofFileKey).toBe(
      'payment-proofs/ABC123/1/screenshot.jpg',
    );
    expect(payment.verifiedBy).toBe('committee@example.test');
    expect(payment.verifiedAt).toBe(1712345678000);
  });

  it('toPayment preserves null for all new fields when row has nulls', () => {
    const payment = toPayment(makeRow());
    expect(payment.proofFileKey).toBeNull();
    expect(payment.verifiedBy).toBeNull();
    expect(payment.verifiedAt).toBeNull();
  });

  it('toPayment still maps existing gateway fields', () => {
    const payment = toPayment(
      makeRow({
        gateway: 'bank_transfer',
        gateway_ref: null,
        gateway_response: null,
      }),
    );
    expect(payment.gateway).toBe('bank_transfer');
    expect(payment.status).toBe('payment_pending');
    expect(payment.amount).toBe(2500);
  });

  // Desk settlement fields (0023_payment_method_note) — read-path coverage
  // added alongside settleAtDesk's write path (payment.repo.ts).
  it('toPayment maps method and note from a desk-settled row', () => {
    const payment = toPayment(
      makeRow({ method: 'cash', note: 'Received by Ajith at 3pm' }),
    );
    expect(payment.method).toBe('cash');
    expect(payment.note).toBe('Received by Ajith at 3pm');
  });

  it('toPayment preserves null for method and note when row has nulls', () => {
    const payment = toPayment(makeRow());
    expect(payment.method).toBeNull();
    expect(payment.note).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveRegistrationStatus
// ---------------------------------------------------------------------------

describe('deriveRegistrationStatus', () => {
  it('no payments → pending', () => {
    expect(deriveRegistrationStatus([], 1000)).toBe('pending');
  });

  it('single payment_pending → pending', () => {
    expect(deriveRegistrationStatus([{ status: 'payment_pending', amount: 1000 }], 1000)).toBe('pending');
  });

  it('single pending_verification → pending_verification', () => {
    expect(deriveRegistrationStatus([{ status: 'pending_verification', amount: 1000 }], 1000)).toBe('pending_verification');
  });

  it('single verified covering total → confirmed', () => {
    expect(deriveRegistrationStatus([{ status: 'verified', amount: 1000 }], 1000)).toBe('confirmed');
  });

  it('partial verified (500 of 1000) + payment_pending → pending', () => {
    const payments = [
      { status: 'verified' as const, amount: 500 },
      { status: 'payment_pending' as const, amount: 500 },
    ];
    expect(deriveRegistrationStatus(payments, 1000)).toBe('pending');
  });

  it('partial verified + pending_verification → pending_verification', () => {
    const payments = [
      { status: 'verified' as const, amount: 500 },
      { status: 'pending_verification' as const, amount: 500 },
    ];
    expect(deriveRegistrationStatus(payments, 1000)).toBe('pending_verification');
  });

  it('multiple verified summing to total → confirmed', () => {
    const payments = [
      { status: 'verified' as const, amount: 600 },
      { status: 'verified' as const, amount: 400 },
    ];
    expect(deriveRegistrationStatus(payments, 1000)).toBe('confirmed');
  });

  it('verified covers total even with pending_verification present → confirmed (rule 1 has priority)', () => {
    const payments = [
      { status: 'verified' as const, amount: 1000 },
      { status: 'pending_verification' as const, amount: 200 },
    ];
    expect(deriveRegistrationStatus(payments, 1000)).toBe('confirmed');
  });

  it('bug scenario: one verified (partial) + one payment_pending (shortfall) → pending, NOT pending_verification', () => {
    const payments = [
      { status: 'verified' as const, amount: 700 },
      { status: 'payment_pending' as const, amount: 300 },
    ];
    expect(deriveRegistrationStatus(payments, 1000)).toBe('pending');
  });

  it('single verified strictly exceeding total (overpayment) → confirmed', () => {
    expect(deriveRegistrationStatus([{ status: 'verified', amount: 1500 }], 1000)).toBe('confirmed');
  });

  it('multiple verified payments summing below total + payment_pending → pending', () => {
    const payments = [
      { status: 'verified' as const, amount: 300 },
      { status: 'verified' as const, amount: 200 },
      { status: 'payment_pending' as const, amount: 500 },
    ];
    expect(deriveRegistrationStatus(payments, 1000)).toBe('pending');
  });
});
