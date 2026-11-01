import { describe, expect, it } from 'vitest';
import { parseSbiStatement } from '../lib/sbi-statement-parser.js';

const TAB_STATEMENT = [
  'Account Name       :\tTest Alumni Account',
  'Account Number     :\t_TEST_ACCOUNT_001',
  'Opening Balance as on 1 Aug 2026        :\t22,20,634.14',
  'Start Date          :\t1 Aug 2026',
  'End Date            :\t6 Aug 2026',
  'Txn Date\tValue Date\tDescription\tRef No./Cheque No.\tBranch Code\t        Debit\tCredit\tBalance\t',
  '1 Aug 2026 \t1 Aug 2026 \tCHQ TRANSFER-NEFT UTR NO: SBIN000000000000--84322 TEST STORE\t/ 84322\t0001\t75,004.72\t \t21,45,629.42',
  '1 Aug 2026 \t1 Aug 2026 \t   BY TRANSFER-UPI/CR/000000000000/TEST PERSON/ICIC/test/UPI--\tTRANSFER FROM\t3355\t \t20,000.00\t21,65,629.42',
  '1 Aug 2026 \t1 Aug 2026 \tCHEQUE DEPOSIT---738471\tTRANSFER TO 67343606117\t4063\t \t25,000.00\t21,90,629.42',
  '**This is a computer generated statement and does not require a signature',
].join('\n');

describe('tab-delimited SBI statement parser', () => {
  it('parses metadata, debit and credit rows from the known export shape', async () => {
    const result = await parseSbiStatement(TAB_STATEMENT);

    expect(result.accountName).toBe('Test Alumni Account');
    expect(result.accountNumber).toBe('_TEST_ACCOUNT_001');
    expect(result.startDate).toBe('1 Aug 2026');
    expect(result.endDate).toBe('6 Aug 2026');
    expect(result.openingBalance).toBe(222063414);
    expect(result.closingBalance).toBe(219062942);
    expect(result.transactions).toHaveLength(3);

    expect(result.transactions[0]).toMatchObject({
      txnDate: '1 Aug 2026',
      txnDateIso: '2026-08-01',
      valueDate: '1 Aug 2026',
      description: 'CHQ TRANSFER-NEFT UTR NO: SBIN000000000000-84322 TEST STORE',
      refNo: '/ 84322',
      branchCode: '0001',
      debitPaise: 7500472,
      creditPaise: 0,
      balancePaise: 214562942,
      txnType: 'debit',
    });
    expect(result.transactions[1]).toMatchObject({
      description: 'BY TRANSFER-UPI/CR/000000000000/TEST PERSON/ICIC/test/UPI',
      debitPaise: 0,
      creditPaise: 2000000,
      balancePaise: 216562942,
      txnType: 'credit',
    });
    expect(result.transactions[2]).toMatchObject({
      description: 'CHEQUE DEPOSIT',
      debitPaise: 0,
      creditPaise: 2500000,
      balancePaise: 219062942,
      txnType: 'credit',
    });
    expect(result.transactions[0].txnHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
