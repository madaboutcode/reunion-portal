import type { WizardDraftStorage } from "@/lib/draft-storage";
import { WIZARD_DRAFT_STORAGE_KEY } from "@/lib/draft-storage";

export function createLocalStorageDraftStorage(): WizardDraftStorage {
  return {
    load() {
      try {
        const raw = localStorage.getItem(WIZARD_DRAFT_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as Partial<import("@/types/registration").WizardState>;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        localStorage.setItem(WIZARD_DRAFT_STORAGE_KEY, JSON.stringify(state));
      } catch {
        console.warn("Failed to save draft to localStorage");
      }
    },
    clear() {
      try {
        localStorage.removeItem(WIZARD_DRAFT_STORAGE_KEY);
      } catch {
        // unavailable
      }
    },
  };
}

let defaultStorage: WizardDraftStorage | null = null;

export function getDefaultDraftStorage(): WizardDraftStorage {
  if (!defaultStorage) {
    defaultStorage = createLocalStorageDraftStorage();
  }
  return defaultStorage;
}

export function setDefaultDraftStorage(storage: WizardDraftStorage): void {
  defaultStorage = storage;
}