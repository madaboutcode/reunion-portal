import { useEffect } from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WizardProvider, useWizard } from "@/context/WizardContext";
import { WizardShellInner } from "@/components/WizardShell";
import { setViewport, DESKTOP } from "@/__tests__/test-utils";
import type { WizardState } from "@/types/registration";
import type { WizardDraftStorage } from "@/lib/draft-storage";
import { getDefaultDraftStorage } from "@/lib/draft-storage.local";

function StateInjector({ changes }: { changes: Partial<WizardState> }) {
  const { update, goToStep } = useWizard();
  useEffect(() => {
    const { currentStep, ...draft } = changes;
    if (Object.keys(draft).length > 0) {
      update(draft);
    }
    if (currentStep !== undefined) {
      goToStep(currentStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- test bootstrap once
  }, []);
  return null;
}

function WizardTree({
  patch,
  draftStorage,
}: {
  patch?: Partial<WizardState>;
  draftStorage?: WizardDraftStorage;
}) {
  return (
    <MemoryRouter>
      <WizardProvider draftStorage={draftStorage ?? getDefaultDraftStorage()}>
        {patch ? <StateInjector changes={patch} /> : null}
        <WizardShellInner />
      </WizardProvider>
    </MemoryRouter>
  );
}

export function renderWizard(
  patch?: Partial<WizardState>,
  draftStorage?: WizardDraftStorage,
) {
  setViewport(DESKTOP);
  const user = userEvent.setup();
  render(<WizardTree patch={patch} draftStorage={draftStorage} />);
  return { user, draftStorage };
}

export const renderWizardWithState = renderWizard;