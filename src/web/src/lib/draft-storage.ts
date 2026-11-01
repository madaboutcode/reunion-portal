import type { WizardState } from "@/types/registration";

export const WIZARD_DRAFT_STORAGE_KEY = "smriti_reg_v5";

/** External boundary for wizard draft persistence (production: localStorage). */
export interface WizardDraftStorage {
  load(): Partial<WizardState> | null;
  save(state: Partial<WizardState>): void;
  clear(): void;
}