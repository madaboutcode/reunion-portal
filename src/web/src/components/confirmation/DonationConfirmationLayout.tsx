import { useIsMobile } from "@/hooks/useIsMobile";
import { ThankYouCard } from "./ThankYouCard";
import { WhatsNextPanel } from "./WhatsNextPanel";
import { deriveDisplay } from "./deriveDisplay";
import { formatINR } from "@/lib/pricing";
import type { RegistrationResponseData } from "@smriti/shared";

export interface DonationConfirmationLayoutProps {
  data: RegistrationResponseData;
  regCode: string;
}

export function DonationConfirmationLayout({ data, regCode }: DonationConfirmationLayoutProps) {
  const isMobile = useIsMobile();
  const d = deriveDisplay(data, regCode);
  // Use the pricing total so contribution-only donors (no reunion donation) see the correct amount.
  const amount = formatINR(data.pricingBreakup.total);

  return (
    <div className="min-h-screen bg-page">
      <div className={`mx-auto ${isMobile ? "px-4 py-8" : "max-w-2xl px-6 py-16"}`}>
        <div className="flex justify-center mb-12">
          <ThankYouCard
            name={d.name}
            amount={amount}
            size={isMobile ? "mobile" : "desktop"}
          />
        </div>
        <WhatsNextPanel layout={isMobile ? "mobile" : "desktop"} variant="donation" />
      </div>
    </div>
  );
}
