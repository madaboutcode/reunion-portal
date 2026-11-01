import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { BankDetailsPanel } from "@/components/payment/BankDetailsPanel";
import { getPaymentBankDetails } from "@smriti/shared";

export default function BankDetailsPage() {
  useDocumentTitle("Bank Details");

  const { raw: bankDetailsRaw, fields: bankFields } = getPaymentBankDetails();

  return (
    <div className="min-h-screen bg-page relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-soft-aqua/30 via-transparent to-transparent" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-[480px]">
          <div className="flex justify-center mb-5">
            <SmritiLogo size={90} href="/" />
          </div>

          <div className="text-center mb-6">
            <h1 className="font-heading text-xl font-bold text-charcoal mb-1 sm:text-2xl">
              Bank Transfer Details
            </h1>
            <p className="text-sm text-muted">
              Send your payment via NEFT, RTGS, IMPS, or international wire
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-border-warm p-5 shadow-sm sm:p-6">
            <BankDetailsPanel
              bankFields={bankFields}
              bankDetailsRaw={bankDetailsRaw}
            />
          </div>

          <p className="mt-5 text-xs text-subtle leading-relaxed text-center">
            After transferring, please share a screenshot of the payment confirmation
            with the registration team for verification.
          </p>
        </div>
      </div>
    </div>
  );
}