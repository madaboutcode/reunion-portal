import { PAYMENT_BANK_DETAILS_B64 } from "./constants.ts";

export interface BankFields {
  bank: string;
  accountName: string;
  accountNumber: string;
  ifscCode: string;
  swiftCode: string;
  branch: string;
  country: string;
  currency: string;
  purposeOfPaymentCode: string;
  purposeOfPayment: string;
  beneficiaryNationality: string;
}

export function decodePaymentConstant(b64: string): string {
  return atob(b64);
}

export function parseBankDetails(raw: string): BankFields {
  const fields: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    fields[key] = value;
  }
  return {
    bank: fields["bank"] ?? "",
    accountName: fields["account name"] ?? "",
    accountNumber: fields["account number"] ?? "",
    ifscCode: fields["ifsc code"] ?? "",
    swiftCode: fields["swift code"] ?? "",
    branch: fields["branch"] ?? "",
    country: fields["country"] ?? "",
    currency: fields["currency"] ?? "",
    purposeOfPaymentCode: fields["purpose of payment code"] ?? "",
    purposeOfPayment: fields["purpose of payment"] ?? "",
    beneficiaryNationality: fields["beneficiary nationality"] ?? "",
  };
}

export function getPaymentBankDetails(): { raw: string; fields: BankFields } {
  const raw = decodePaymentConstant(PAYMENT_BANK_DETAILS_B64);
  return { raw, fields: parseBankDetails(raw) };
}