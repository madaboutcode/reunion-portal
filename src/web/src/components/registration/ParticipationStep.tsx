import { CampusOnlyCard } from "@/components/registration/CampusOnlyCard";
import { DonationOnlyCard } from "@/components/registration/DonationOnlyCard";
import { FullCelebrationCard } from "@/components/registration/FullCelebrationCard";

export type ParticipationType =
  | "full_celebration"
  | "campus_only"
  | "donation_only";

export interface ParticipationStepProps {
  value: ParticipationType | null;
  onChange: (value: ParticipationType) => void;
  hideHeading?: boolean;
}

export function ParticipationStep({ value, onChange, hideHeading }: ParticipationStepProps) {
  return (
    <div className="animate-step-in">
      {!hideHeading && (
        <>
          <h2 className="font-heading text-[22px] sm:text-[32px] text-charcoal font-bold mb-1">
            Choose your reunion plan
          </h2>
          <p className="font-accent text-[15px] sm:text-[18px] text-terracotta mb-5 sm:mb-6">
            Let&apos;s not rush through it :)
          </p>
        </>
      )}

      <div className="flex flex-col gap-4 sm:gap-5 mb-4">
        <FullCelebrationCard
          selected={value === "full_celebration"}
          onSelect={() => onChange("full_celebration")}
        />
        <CampusOnlyCard
          selected={value === "campus_only"}
          onSelect={() => onChange("campus_only")}
        />
        <DonationOnlyCard
          selected={value === "donation_only"}
          onSelect={() => onChange("donation_only")}
        />
      </div>

      <p className="text-[12px] text-subtle text-center sm:text-left">
        Your choice can be changed later if your plans change.
        {" "}Secure &amp; easy registration.
      </p>
    </div>
  );
}