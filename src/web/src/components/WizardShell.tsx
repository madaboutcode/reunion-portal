import { useEffect } from "react";
import { Link } from "react-router-dom";
import { WizardProvider, useWizard } from "@/context/WizardContext";
import SmritiHero from "@/components/registration/Hero";
import { SiteNav } from "@/components/SiteNav";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { Stepper } from "@/components/ui/Stepper";
import { SiteFooter } from "@/components/SiteFooter";
import { ParticipationStep } from "@/components/registration/ParticipationStep";
import { AlumniDetails } from "@/components/registration/AlumniDetails";
import { AttendeesMeals } from "@/components/registration/AttendeesMeals";
import { Accommodation } from "@/components/registration/Accommodation";
import { GivingBack } from "@/components/registration/GivingBack";
import { PhotoId } from "@/components/registration/PhotoId";
import { ReviewPay } from "@/components/registration/ReviewPay";
import { EstimateSidebar } from "@/components/registration/EstimateSidebar";
import { Button } from "@/components/ui/Button";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { WizardStep, ParticipationType } from "@/types/registration";
import { getDisabledSteps, resolveNextStep, resolveBackStep } from "@/lib/step-config";
import { STEP_DEFINITIONS } from "@/lib/wizard-steps";

// ── Inner Shell (reads context) ─────────────────────────────────────────────

export function WizardShellInner() {
  const { state, update, goToStep, reset } = useWizard();
  const currentStep = state.currentStep;
  const isMobile = useIsMobile();

  const disabledSteps = getDisabledSteps(state);
  const activeSteps = STEP_DEFINITIONS.filter(s => !disabledSteps.has(s.id));

  // Scroll to top on every step transition — handled once here, not in each step
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentStep]);

  // "confirmation" step is now handled by navigating to /confirmation/:id (Step6 submit).
  // This guard keeps TypeScript happy and prevents rendering the wizard chrome if the
  // step somehow ends up as "confirmation" during a transition.
  if (currentStep === "confirmation") {
    return null;
  }

  const step = currentStep;
  const onNext = () => goToStep(resolveNextStep(step, disabledSteps));
  const onBack = () => goToStep(resolveBackStep(step, disabledSteps));
  const activeIndex = activeSteps.findIndex(s => s.id === step) + 1;
  const activeMaxReached = activeSteps.findIndex(s => s.id === state.maxReachedStep) + 1;

  const stepContent = (() => {
    switch (step) {
      case 1: {
        const participationContent = (
          <ParticipationStep
            value={state.participationType ?? null}
            onChange={(v: ParticipationType) =>
              update({
                participationType: v,
                attendanceIntent: v === "donation_only" ? "donation_only" : "attending",
              })
            }
            hideHeading={!isMobile}
          />
        );

        if (isMobile) {
          return (
            <div className="animate-step-in">
              <div className="px-3.5 py-4">{participationContent}</div>
              <div className="h-mobile-bottom-spacer" />
              <div className="fixed fixed-bottom-safe left-0 right-0 bg-white border-t border-border p-3 flex gap-3 z-50 shadow-[0_-4px_24px_rgba(31,42,51,0.1)]">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={onNext}
                  className="flex-1"
                  data-testid="wizard-continue"
                >
                  Continue →
                </Button>
              </div>
            </div>
          );
        }

        return (
          <div className="max-w-[1100px] mx-auto px-8 pt-8 pb-14 animate-step-in">
            <h2 className="font-heading text-[22px] sm:text-[32px] text-charcoal font-bold mb-1">
              Choose your reunion plan
            </h2>
            <p className="font-accent text-[15px] sm:text-[18px] text-terracotta mb-5 sm:mb-6">
              Let&apos;s not rush through it :)
            </p>
            <div className="grid grid-cols-[3fr_2fr] gap-7 items-start">
              <div>
                {participationContent}
                <div className="flex justify-between items-center pt-2">
                  <span />
                  <Button variant="primary" size="lg" onClick={onNext} data-testid="wizard-continue">
                    Continue →
                  </Button>
                </div>
              </div>
              <EstimateSidebar data={state} />
            </div>
          </div>
        );
      }
      case 2:
        return (
          <AlumniDetails data={state} update={update} onNext={onNext} onBack={onBack} reset={reset} />
        );
      case 3:
        return (
          <AttendeesMeals data={state} update={update} onNext={onNext} onBack={onBack} />
        );
      case 4:
        return (
          <Accommodation data={state} update={update} onNext={onNext} onBack={onBack} />
        );
      case 5:
        return (
          <GivingBack data={state} onChange={update} onNext={onNext} onBack={onBack} />
        );
      case 6:
        return (
          <PhotoId
            data={state}
            update={update}
            onNext={onNext}
            onBack={onBack}
            goToStep={(n: number) => goToStep(n as WizardStep)}
          />
        );
      case 7:
        return (
          <ReviewPay
            data={state}
            update={update}
            onNext={onNext}
            onBack={onBack}
            goToStep={(n: number) => goToStep(n as WizardStep)}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div className="min-h-screen bg-page flex flex-col">
      {step === 1 ? (
        <>
          <SiteNav />
          <SmritiHero />
        </>
      ) : (
        <div className="sticky top-0 z-[300] bg-surface border-b border-[rgba(200,180,150,0.15)] shadow-[0_2px_10px_rgba(80,60,40,0.06)]">
          <div className="max-w-[1100px] mx-auto flex items-center gap-4 px-5 md:px-8">
            <Link
              to="/"
              className="shrink-0 self-center opacity-80 hover:opacity-100 transition-opacity"
              aria-label="Back to home"
            >
              <SmritiLogo size={68} />
            </Link>
            <div className="flex-1">
              <Stepper
                currentStep={activeIndex}
                steps={activeSteps}
                maxReachedStep={activeMaxReached}
                onStepClick={(stepId) => goToStep(stepId as WizardStep)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content Area ── */}
      <main className="flex-1 mt-6 md:mt-8">{stepContent}</main>

      <SiteFooter />
    </div>
  );
}

// ── Public Shell (provides context) ─────────────────────────────────────────

export default function WizardShell() {
  return (
    <WizardProvider>
      <WizardShellInner />
    </WizardProvider>
  );
}
