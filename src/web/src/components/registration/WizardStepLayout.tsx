import type { ReactNode } from "react";
import type { WizardDraft } from "@/types/registration";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Button } from "@/components/ui/Button";
import { EstimateSidebar } from "@/components/registration/EstimateSidebar";
import { StickyBottomBar } from "@/components/registration/StickyBottomBar";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WizardStepLayoutProps {
  data: WizardDraft;
  children: ReactNode;
  sidebar?: ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  animate?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export function WizardStepLayout({
  data,
  children,
  sidebar,
  onBack,
  onNext,
  nextLabel = "Continue →",
  nextDisabled = false,
  animate = false,
}: WizardStepLayoutProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        <div className="px-4 py-4" data-enter-nav-scope>{children}</div>
        <div className="h-mobile-bottom-spacer" />
        <StickyBottomBar
          onBack={onBack}
          onNext={onNext}
          nextLabel={nextLabel}
          nextDisabled={nextDisabled}
        />
      </>
    );
  }

  return (
    <div
      className={[
        "max-w-[1100px] mx-auto px-8 pt-8 pb-14",
        animate && "animate-step-in",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="grid grid-cols-[3fr_2fr] gap-7 items-start">
        <div data-enter-nav-scope>
          {children}
          <div className="flex justify-between items-center pt-2">
            {onBack ? (
              <Button variant="secondary" onClick={onBack} data-testid="wizard-back">
                ← Back
              </Button>
            ) : (
              <span />
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={onNext}
              disabled={nextDisabled}
              data-testid="wizard-continue"
            >
              {nextLabel}
            </Button>
          </div>
        </div>
        {sidebar ?? <EstimateSidebar data={data} />}
      </div>
    </div>
  );
}
