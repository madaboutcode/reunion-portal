export interface UpiPaymentInput {
  vpa: string;
  payeeName: string;
}

export interface UpiQrInput {
  vpa: string;
  payeeName: string;
  amountInr: number;
  note?: string;
  orgId?: string;
}

export type UpiApp = "gpay" | "phonepe" | "bhim";

const UPI_APP_SCHEMES: Record<UpiApp, string> = {
  gpay: "gpay://upi/pay?",
  phonepe: "phonepe://pay?",
  bhim: "upi://pay?",
};

function buildFields(fields: [string, string][]): string {
  return fields.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

export function buildUpiUri(input: UpiPaymentInput): string {
  return `upi://pay?${buildFields([["pa", input.vpa], ["pn", input.payeeName]])}`;
}

export function buildAppUpiUri(input: UpiPaymentInput, app: UpiApp): string {
  return `${UPI_APP_SCHEMES[app]}${buildFields([["pa", input.vpa], ["pn", input.payeeName]])}`;
}

export function buildUpiQrUri(input: UpiQrInput): string {
  const fields: [string, string][] = [
    ["pa", input.vpa],
    ["pn", input.payeeName],
    ["am", input.amountInr.toFixed(2)],
    ["cu", "INR"],
  ];
  if (input.note) fields.push(["tn", input.note]);
  if (input.orgId) fields.push(["orgid", input.orgId]);
  return `upi://pay?${buildFields(fields)}`;
}

export function buildUpiNote(regCode: string): string {
  const tail = regCode.slice(-4);
  return `TKMCE Reunion 2026 - ${tail}`;
}
