import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getPaymentBankDetails } from "@smriti/shared";
import type { PricingLineItem } from "@smriti/shared";
import { AdviceDocument } from "./PaymentAdvicePage";

const FIXTURE_LINES: PricingLineItem[] = [
  { label: "Batch Contribution to College — Scholarship Fund", fee: 5000, free: false },
  { label: "Spouse — Ganga · Lunch & Dinner", fee: 2910, free: false },
  { label: "Twin1 (15 yrs) · Lunch & Dinner", fee: 2910, free: false },
  { label: "Twin2 (15 yrs) · Lunch & Dinner", fee: 2910, free: false },
  { label: "Accommodation — Private Room · 1 night", fee: 12000, free: false },
  { label: "Extra bed · 1 night", fee: 1500, free: false },
  { label: "Additional Breakfast (12+) × 1", fee: 1500, free: false },
  { label: "GST (18%) — accommodation", fee: 2700, free: false },
];

const FIXTURE_DATA = {
  regCode: "SMRTDEBUG0000001",
  regId: "debug-reg-0000001",
  fullName: "Mundakkal Shekaran",
  pricingBreakup: {
    base: 8500,
    collegeContribution: 500,
    lines: FIXTURE_LINES,
    donation: 0,
    total: 39930,
  },
  verifiedPaymentAmount: 0,
  pendingPaymentAmount: 39930,
};

export default function AdviceDebugPage() {
  useDocumentTitle("Payment Advice Debug");
  const { fields: bankFields } = getPaymentBankDetails();

  return <AdviceDocument data={FIXTURE_DATA} bankFields={bankFields} />;
}
