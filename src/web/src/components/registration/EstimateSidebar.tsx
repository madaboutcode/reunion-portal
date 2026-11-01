import type { WizardDraft } from "@/types/registration";
import { PricingSummary } from "@/components/ui/PricingSummary";

export interface EstimateSidebarProps {
  data: WizardDraft;
  className?: string;
}

export function EstimateSidebar({ data, className }: EstimateSidebarProps) {
  return (
    <PricingSummary
      data={data}
      className={["sticky top-6", className].filter(Boolean).join(" ")}
    />
  );
}
