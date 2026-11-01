/**
 * RefundCompletionFakeD1 — emulates PaymentService.completeRefund()'s guarded
 * D1 batch (plan §4) against an in-memory refund repo fake: the
 * system_audit_log INSERT ... SELECT guarded by the refund still being
 * 'pending', then the guarded UPDATE refunds. Statements execute in order on
 * one connection and see each other's writes, so a repeat completion writes
 * zero rows on both — the service reports 409 with no additional audit row.
 *
 * The fake reads and mutates the in-memory refund repo it is given, so tests
 * that assert on refundRepo see the real committed state.
 */

import type { Refund } from '../../domain/types.js';

/** The minimal repo surface the completion batch needs. */
export interface RefundCompletionRepos {
  refundRepo: {
    findById(id: number): Promise<Refund | null>;
    complete(id: number, resolvedBy: string, bankReference: string): Promise<void>;
  };
}

interface FakeStatement {
  getSql(): string;
  getArgs(): unknown[];
}

interface D1Meta {
  changes: number;
  last_row_id: number;
}

export class RefundCompletionFakeD1 {
  /** system_audit_log rows captured from the completion batch (refund_completed). */
  systemAuditRows: Array<{ action: string; actor: string; targetId: number; details: string }> = [];

  private readonly refundRepo: RefundCompletionRepos['refundRepo'];

  constructor(repos: RefundCompletionRepos) {
    this.refundRepo = repos.refundRepo;
  }

  prepare(sql: string): { bind(...args: unknown[]): FakeStatement } {
    return {
      bind(...args: unknown[]): FakeStatement {
        return { getSql: () => sql, getArgs: () => args };
      },
    };
  }

  async batch(statements: FakeStatement[]): Promise<Array<{ meta: D1Meta }>> {
    const results: Array<{ meta: D1Meta }> = [];
    for (const stmt of statements) {
      const sql = stmt.getSql();
      const args = stmt.getArgs();
      results.push(await this.runStatement(sql, args));
    }
    return results;
  }

  private async runStatement(sql: string, args: unknown[]): Promise<{ meta: D1Meta }> {
    // completeRefund(): system_audit_log INSERT ... SELECT FROM refunds
    // WHERE id = ? AND status = 'pending' — bind [action, actor, target_id,
    // details, refundId].
    if (sql.startsWith('INSERT INTO system_audit_log')) {
      const refundId = args[4] as number;
      const refund = await this.refundRepo.findById(refundId);
      const pending = refund !== null && refund.status === 'pending';
      if (pending) {
        this.systemAuditRows.push({
          action: args[0] as string,
          actor: args[1] as string,
          targetId: args[2] as number,
          details: args[3] as string,
        });
      }
      return { meta: { changes: pending ? 1 : 0, last_row_id: pending ? 1 : 0 } };
    }

    // completeRefund(): guarded UPDATE refunds ... WHERE id = ? AND
    // status = 'pending' — bind [resolved_by, bank_reference, id].
    if (sql.startsWith('UPDATE refunds')) {
      const refundId = args[2] as number;
      const refund = await this.refundRepo.findById(refundId);
      if (refund !== null && refund.status === 'pending') {
        await this.refundRepo.complete(refundId, args[0] as string, args[1] as string);
        return { meta: { changes: 1, last_row_id: 0 } };
      }
      return { meta: { changes: 0, last_row_id: 0 } };
    }

    throw new Error(`RefundCompletionFakeD1: unhandled statement: ${sql}`);
  }
}
