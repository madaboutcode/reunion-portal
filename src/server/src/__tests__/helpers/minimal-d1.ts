/**
 * Minimal D1 stub for tests whose service under test carries a D1Database
 * dependency it never touches on the exercised path (e.g. PaymentService
 * constructed for verifyPayment tests that never call completeRefund).
 *
 * Every method throws so an unexpectedly-touched path fails LOUDLY instead of
 * silently returning fabricated results.
 */
export const unusedD1: unknown = {
  prepare(): never {
    throw new Error('unusedD1: prepare() called — the tested path must not touch the D1 binding');
  },
  batch(): never {
    throw new Error('unusedD1: batch() called — the tested path must not touch the D1 binding');
  },
};
