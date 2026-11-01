/**
 * Shared test utilities for vitest + @testing-library/react tests.
 *
 * Provides viewport simulation, mock data factories, and common
 * render patterns used across payment-flow and confirmation-flow tests.
 */

import type { RegistrationResponseData } from "@smriti/shared";

// ── Viewport ──────────────────────────────────────────────────────────────

export const DESKTOP = 1280;
export const MOBILE = 375;

export function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

// ── Mock data factory ─────────────────────────────────────────────────────

export function mockRegistration(
  overrides: Partial<RegistrationResponseData> = {},
): RegistrationResponseData {
  return {
    regId: "SMRT79WW4A25NWG1",
    regCode: "SMRT79WW4A25NWG1",
    status: "confirmed",
    createdAt: Date.now(),
    pricingBreakup: { base: 7500, collegeContribution: 500, lines: [], donation: 0, total: 8000 },
    contact: {
      fullName: "Mangalasseri Neelakantan",
      branch: "Mechanical Engineering",
      gender: "male",
      email: "neelakantan@example.com",
      whatsapp: "9876543210",
      city: "Kochi",
      country: "India",
    },
    attendance: {
      intent: "attending",
      participationType: "full_celebration",
      alumniMeal: "veg",
      tshirtSize: "L",
    },
    attendees: { children: [], guests: [] },
    idDocument: {
      fileKey: "id-docs/test.jpg",
      fileType: "image/jpeg",
      sizeBytes: 1024,
      fileName: "test.jpg",
      note: "",
    },
    pendingPaymentAmount: null,
    hasVerifiedPayments: false,
    verifiedPaymentAmount: 0,
    ...overrides,
  };
}

// ── localStorage stub ─────────────────────────────────────────────────────

export function stubLocalStorage() {
  const store: Record<string, string> = {};
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((k) => delete store[k]);
      }),
    },
    writable: true,
  });
}

// We need vi for stubLocalStorage — import dynamically since setup is per-file
import { vi } from "vitest";
