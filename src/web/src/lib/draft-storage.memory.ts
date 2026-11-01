import type { WizardDraftStorage } from "@/lib/draft-storage";
import type { WizardState } from "@/types/registration";

/** In-memory storage for tests (mock external draft boundary). */
export function createMemoryDraftStorage(
  initial: Partial<WizardState> | null = null,
): WizardDraftStorage {
  let value: Partial<WizardState> | null = initial ? { ...initial } : null;

  return {
    load() {
      return value ? { ...value } : null;
    },
    save(state) {
      value = { ...state };
    },
    clear() {
      value = null;
    },
  };
}