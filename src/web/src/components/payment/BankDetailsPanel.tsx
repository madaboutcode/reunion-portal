import { useState, useCallback, useRef } from "react";
import type { BankFields } from "@smriti/shared";

export interface BankDetailsPanelProps {
  bankFields: BankFields;
  bankDetailsRaw: string;
  /** Registration code shown as "Your Ref" on the payment page. */
  regCode?: string;
  showInternationalNote?: boolean;
  className?: string;
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [value]);

  if (!value) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
        {label}
      </dt>
      <dd className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-charcoal font-mono">{value}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-white text-xs font-semibold text-muted hover:text-[#2A7A80] hover:border-soft-aqua transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </dd>
    </div>
  );
}

function DetailSection({
  title,
  subtitle,
  children,
  variant = "default",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  variant?: "default" | "international";
}) {
  const isInternational = variant === "international";

  return (
    <section
      className={
        isInternational
          ? "rounded-xl border border-[#2A7A80]/20 bg-[#E4F3F4]/40 p-4"
          : "rounded-xl border border-border-warm bg-white/60 p-4"
      }
    >
      <div className="mb-3">
        <h3 className="font-heading text-sm font-bold text-charcoal">{title}</h3>
        {subtitle && (
          <p className="text-xs text-muted mt-0.5 leading-snug">{subtitle}</p>
        )}
      </div>
      <dl className="space-y-4">{children}</dl>
    </section>
  );
}

export function BankDetailsPanel({
  bankFields,
  bankDetailsRaw,
  regCode,
  showInternationalNote = true,
  className = "",
}: BankDetailsPanelProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      <DetailSection title="Account details">
        <CopyField label="Account Number" value={bankFields.accountNumber} />
        <CopyField label="Account Name" value={bankFields.accountName} />
        <CopyField label="Bank" value={bankFields.bank} />
        <CopyField label="Branch" value={bankFields.branch} />
        {regCode && (
          <>
            <CopyField label="Your Ref" value={regCode} />
            <p className="text-[11px] text-muted leading-snug -mt-1">
              Mention this in the payment remarks for quick verification
            </p>
          </>
        )}
      </DetailSection>

      <DetailSection
        title="Paying from India"
        subtitle="Use NEFT, RTGS, or IMPS via any Indian bank or UPI app"
      >
        <CopyField label="IFSC Code" value={bankFields.ifscCode} />
      </DetailSection>

      <DetailSection
        title="Paying from outside India"
        subtitle="International wire transfer — allow 2–5 business days for funds to arrive"
        variant="international"
      >
        <CopyField label="SWIFT / BIC Code" value={bankFields.swiftCode} />
        <CopyField
          label="Purpose of Payment Code"
          value={bankFields.purposeOfPaymentCode}
        />
        <CopyField
          label="Purpose of Payment"
          value={bankFields.purposeOfPayment}
        />
        <CopyField
          label="Beneficiary Nationality"
          value={bankFields.beneficiaryNationality}
        />
        <CopyField label="Country" value={bankFields.country} />
        <CopyField label="Currency" value={bankFields.currency} />

        {showInternationalNote && (
          <div className="text-xs text-muted leading-relaxed space-y-1.5 pt-1 border-t border-[#2A7A80]/15">
            <p>
              • Enter the <strong className="text-charcoal">SWIFT/BIC code</strong> in
              your bank&apos;s SWIFT field — do not use the IFSC code there.
            </p>
            <p>
              • Send the amount in <strong className="text-charcoal">INR</strong> (Indian
              Rupees), not your local currency.
            </p>
            {regCode && (
              <p>
                • Include your registration reference{" "}
                <span className="font-mono text-charcoal">{regCode}</span> in the
                wire remarks.
              </p>
            )}
          </div>
        )}
      </DetailSection>

      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(bankDetailsRaw).catch(() => {});
        }}
        className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-border bg-white text-xs font-semibold text-muted hover:text-charcoal hover:border-soft-aqua transition-colors cursor-pointer"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
        Copy all details
      </button>
    </div>
  );
}