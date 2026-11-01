import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type {
  WizardState,
  WizardStep,
  WizardDraft,
} from "@/types/registration";
import { createInitialData } from "@/lib/pricing";
import { usePersistence, clearDraft } from "@/hooks/usePersistence";
import { buildInitialWizardState } from "@/lib/build-initial-wizard-state";
import type { WizardDraftStorage } from "@/lib/draft-storage";
import { getDefaultDraftStorage } from "@/lib/draft-storage.local";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WizardContextValue {
  state: WizardState;
  update: (changes: Partial<WizardDraft>) => void;
  goToStep: (step: WizardStep) => void;
  reset: () => void;
}

type WizardAction =
  | { type: "UPDATE"; changes: Partial<WizardDraft> }
  | { type: "GO_TO_STEP"; step: WizardStep }
  | { type: "RESET"; data: WizardDraft };

// ── Reducer ─────────────────────────────────────────────────────────────────

function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "UPDATE":
      return { ...state, ...action.changes };
    case "GO_TO_STEP": {
      const stepNum = typeof action.step === "number" ? action.step : state.maxReachedStep;
      return {
        ...state,
        currentStep: action.step,
        maxReachedStep: Math.max(state.maxReachedStep, stepNum),
      };
    }
    case "RESET":
      return { ...action.data, currentStep: 1, maxReachedStep: 1 };
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

const WizardContext = createContext<WizardContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────────────

export function WizardProvider({
  children,
  draftStorage,
}: {
  children: ReactNode;
  draftStorage?: WizardDraftStorage;
}) {
  const storage = draftStorage ?? getDefaultDraftStorage();
  const { loadDraft, saveDraft } = usePersistence(storage);

  const [state, dispatch] = useReducer(
    wizardReducer,
    null,
    () => buildInitialWizardState(loadDraft()),
  );

  useEffect(() => {
    if (state.currentStep === "confirmation") return;
    saveDraft(state);
  }, [state, saveDraft]);

  const update = useCallback((changes: Partial<WizardDraft>) => {
    dispatch({ type: "UPDATE", changes });
  }, []);

  const goToStep = useCallback((step: WizardStep) => {
    dispatch({ type: "GO_TO_STEP", step });
  }, []);

  const reset = useCallback(() => {
    const fresh = createInitialData();
    clearDraft(storage);
    dispatch({ type: "RESET", data: fresh });
  }, [storage]);

  return (
    <WizardContext.Provider value={{ state, update, goToStep, reset }}>
      {children}
    </WizardContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) {
    throw new Error("useWizard must be used within a WizardProvider");
  }
  return ctx;
}