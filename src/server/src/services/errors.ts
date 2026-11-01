export class AppError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super('Validation failed', 400);
    this.fieldErrors = fieldErrors;
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not authorized') {
    super(message, 403);
  }
}

/**
 * Thrown when an overpayment refund INSERT ... SELECT wrote ZERO rows instead
 * of exactly one — the source payment no longer exists, is not verified, or
 * no longer belongs to the registration. Caller:
 *
 *   - D1RefundRepository.create() — the standalone overpayment writer
 *     (refund.repo.ts CREATE_EXACTLY_ONE_ROW).
 *
 * The overpayment flow must never report a refund id for a refund that does
 * not exist (plan §7 "Existing overpayment refund creation still works";
 * refund.repo.ts EXPECTS).
 */
export class RefundCreateNoRowsError extends Error {
  constructor(registrationId: number, sourcePaymentId: number, rowsChanged: number) {
    super(
      `Refund insert wrote ${rowsChanged} rows — expected exactly 1. ` +
        `Source payment ${sourcePaymentId} is missing or no longer belongs to registration ${registrationId}; no refund row was created.`,
    );
    this.name = 'RefundCreateNoRowsError';
  }
}


