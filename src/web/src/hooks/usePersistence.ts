import { useCallback } from "react";
import type { WizardState } from "@/types/registration";
import type { WizardDraftStorage } from "@/lib/draft-storage";
import { getDefaultDraftStorage } from "@/lib/draft-storage.local";

export function clearDraft(storage: WizardDraftStorage = getDefaultDraftStorage()): void {
  storage.clear();
}

export function usePersistence(storage: WizardDraftStorage = getDefaultDraftStorage()) {
  const loadDraft = useCallback((): Partial<WizardState> | null => {
    return storage.load();
  }, [storage]);

  const saveDraft = useCallback(
    (state: Partial<WizardState>) => {
      storage.save(state);
    },
    [storage],
  );

  return { loadDraft, saveDraft, storage };
}