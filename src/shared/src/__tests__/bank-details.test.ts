import { describe, it, expect } from "vitest";
import {
  parseBankDetails,
  getPaymentBankDetails,
} from "../bank-details.ts";

describe("parseBankDetails", () => {
  it("parses all known fields from the encoded constant", () => {
    const { fields } = getPaymentBankDetails();

    expect(fields.bank).toBe("Your Bank Name");
    expect(fields.accountName).toBe("YOUR ALUMNI ASSOCIATION");
    expect(fields.accountNumber).toBe("000000000000");
    expect(fields.ifscCode).toBe("XXXX0000000");
    expect(fields.swiftCode).toBe("XXXXXXXX000");
    expect(fields.branch).toBe("Your Branch, Your City");
    expect(fields.country).toBe("India");
    expect(fields.currency).toBe("INR");
    expect(fields.purposeOfPaymentCode).toBe("P0102");
    expect(fields.purposeOfPayment).toBe(
      "Travel - Alumni reunion registration",
    );
    expect(fields.beneficiaryNationality).toBe("Indian");
  });

  it("ignores malformed lines without a colon", () => {
    const fields = parseBankDetails(
      "Bank: Example Bank\nno colon here\nIFSC Code: EXAM0001",
    );
    expect(fields.bank).toBe("Example Bank");
    expect(fields.ifscCode).toBe("EXAM0001");
  });
});