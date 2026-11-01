/**
 * Spec enforcement tests — SBI statement parser.
 *
 * Tests the parser against known statement data. The real statement file
 * has 175 transactions (174 credits, 1 debit). These tests verify:
 *   - Transaction count and type classification
 *   - Amount parsing (Indian comma notation → paise)
 *   - Debit vs credit detection
 *   - Hash uniqueness (dedup identity)
 *   - Header metadata extraction
 *   - Edge cases: description truncation, empty lines, short lines
 */

import { describe, it, expect } from "vitest";
import { parseSbiStatement } from "../lib/sbi-statement-parser.js";

// Minimal statement snippet for unit tests (avoids file I/O dependency).
// Includes header, 2 credits, 1 debit to cover the key paths.
const MINIMAL_STATEMENT = `Account Name:                      YOUR ALUMNI ASSOCIATION
Address:                           YOUR ADDRESS LINE 1
                                   YOUR CITY
                                   India - 000000
Date:                              19 Jul 2026
Account Number:                    _00000000000000000

Branch:                            YOUR BRANCH

Interest Rate(% p.a.):             0.0
IFS Code            :              XXXX0000000
Account Description:               CA-REGULAR-PUB-OTH-ALL-INR
Currency:                          INR
Book Balance:                      2150884.14
Hold Value:                        0.00
Available Balance:                 2150884.14
Uncleared Amount:                  0.0
Opening Balance as on 19 Jan 2026  0.00
Start Date:                        19 Jan 2026
End Date:                          19 Jul 2026
Txn Date:    Value Date:            Description:                                                            Ref No./Cheque No.:                     Branch Code:            Debit:             Credit:            Balance:
13 Apr 2026  13 Apr 2026            BY TRANSFER-UPI/CR/100000000001/SAMPLEAA/SIBL/sampleuser/From-          TRANSFER FROM 0000000000000 /           3355                                     25,000.00           25,000.00
13 Apr 2026  13 Apr 2026            BY TRANSFER-UPI/CR/100000000002/SAMPLEB /FDRL/0000000000/Sampl-         TRANSFER FROM 0000000000000 /           3355                                     25,000.00           50,000.00
26 May 2026  26 May 2026            CHQ TRANSFER-NEFT UTR NO: SBIN000000000000-00000 SAMPL E S               / 00000 SAMPL E S                      0001                 75,000.00                               75,000.00
10 Jun 2026  10 Jun 2026            BY TRANSFER-UPI/CR/100000000003/HANA MOCK/FDRL/0000000001/TKMCE-         TRANSFER FROM 0000000000000 /           3355                                     14,310.00           89,310.00
`;

describe("parseSbiStatement", () => {
  describe("header metadata", () => {
    it("extracts account name", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.accountName).toBe("YOUR ALUMNI ASSOCIATION");
    });

    it("extracts account number", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.accountNumber).toBe("_00000000000000000");
    });

    it("extracts date range", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.startDate).toBe("19 Jan 2026");
      expect(result.endDate).toBe("19 Jul 2026");
    });

    it("extracts opening balance in paise", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.openingBalance).toBe(0);
    });
  });

  describe("transaction parsing", () => {
    it("parses correct number of transactions", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.transactions).toHaveLength(4);
    });

    it("classifies credit transactions", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      const credits = result.transactions.filter((t) => t.txnType === "credit");
      expect(credits).toHaveLength(3);
    });

    it("classifies debit transactions", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      const debits = result.transactions.filter((t) => t.txnType === "debit");
      expect(debits).toHaveLength(1);
    });
  });

  describe("amount parsing (Indian comma notation → paise)", () => {
    it("parses ₹25,000.00 credit as 2500000 paise", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      const first = result.transactions[0];
      expect(first.creditPaise).toBe(2500000);
      expect(first.debitPaise).toBe(0);
    });

    it("parses ₹75,000.00 debit as 7500000 paise", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      const debit = result.transactions.find((t) => t.txnType === "debit")!;
      expect(debit.debitPaise).toBe(7500000);
      expect(debit.creditPaise).toBe(0);
    });

    it("parses ₹14,310.00 credit as 1431000 paise", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      const last = result.transactions[3];
      expect(last.creditPaise).toBe(1431000);
    });

    it("parses running balance correctly", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.transactions[0].balancePaise).toBe(2500000);
      expect(result.transactions[1].balancePaise).toBe(5000000);
    });
  });

  describe("field extraction", () => {
    it("extracts txn date and value date", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.transactions[0].txnDate).toBe("13 Apr 2026");
      expect(result.transactions[0].valueDate).toBe("13 Apr 2026");
    });

    it("extracts description (may be truncated with dash)", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.transactions[0].description).toContain("SAMPLEAA");
      expect(result.transactions[0].description).toMatch(/-$/);
    });

    it("extracts ref number", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.transactions[0].refNo).toContain("TRANSFER FROM");
    });

    it("extracts branch code", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(result.transactions[0].branchCode).toBe("3355");
    });

    it("extracts branch code for debit row", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      const debit = result.transactions.find((t) => t.txnType === "debit")!;
      expect(debit.branchCode).toBe("0001");
    });
  });

  describe("hash identity (dedup key)", () => {
    it("generates a 64-char hex hash for each transaction", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      for (const tx of result.transactions) {
        expect(tx.txnHash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it("all hashes are unique", async () => {
      const result = await parseSbiStatement(MINIMAL_STATEMENT);
      const hashes = result.transactions.map((t) => t.txnHash);
      expect(new Set(hashes).size).toBe(hashes.length);
    });

    it("same input produces same hash (deterministic)", async () => {
      const r1 = await parseSbiStatement(MINIMAL_STATEMENT);
      const r2 = await parseSbiStatement(MINIMAL_STATEMENT);
      expect(r1.transactions[0].txnHash).toBe(r2.transactions[0].txnHash);
    });
  });

  describe("edge cases", () => {
    it("skips blank lines", async () => {
      const withBlanks = MINIMAL_STATEMENT + "\n\n\n";
      const result = await parseSbiStatement(withBlanks);
      expect(result.transactions).toHaveLength(4);
    });

    it("handles lines shorter than expected column width", async () => {
      const shortLine = MINIMAL_STATEMENT.replace(
        /89,310\.00\s+$/m,
        "89,310.00",
      );
      const result = await parseSbiStatement(shortLine);
      expect(result.transactions).toHaveLength(4);
    });

    it("rejects empty input gracefully", async () => {
      const result = await parseSbiStatement("");
      expect(result.transactions).toHaveLength(0);
    });
  });
});
