/**
 * Unit tests for usePersistence hook and clearDraft utility.
 *
 * Tests:
 *   - saveDraft() writes to localStorage with key "smriti_reg_v5"
 *   - loadDraft() returns the saved value
 *   - loadDraft() returns null when the key is absent
 *   - loadDraft() returns null for malformed JSON (silent discard)
 *   - clearDraft() removes the key
 *
 * localStorage is provided by jsdom (vitest environment: jsdom in vitest.config.ts).
 * Each test starts with a clean localStorage via beforeEach.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePersistence, clearDraft } from "./usePersistence";

const STORAGE_KEY = "smriti_reg_v5";

beforeEach(() => {
  localStorage.clear();
});

// ── saveDraft ─────────────────────────────────────────────────────────────────

describe("saveDraft", () => {
  it("writes the draft to localStorage under key 'smriti_reg_v5'", () => {
    const { result } = renderHook(() => usePersistence());

    act(() => {
      result.current.saveDraft({ fullName: "Ravi Kumar" });
    });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ fullName: "Ravi Kumar" });
  });

  it("overwrites a previously saved draft", () => {
    const { result } = renderHook(() => usePersistence());

    act(() => {
      result.current.saveDraft({ fullName: "First" });
    });
    act(() => {
      result.current.saveDraft({ fullName: "Second" });
    });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!)).toEqual({ fullName: "Second" });
  });

  it("saves a partial WizardState (empty object)", () => {
    const { result } = renderHook(() => usePersistence());

    act(() => {
      result.current.saveDraft({});
    });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBe("{}");
  });
});

// ── loadDraft ─────────────────────────────────────────────────────────────────

describe("loadDraft", () => {
  it("returns the draft previously saved by saveDraft", () => {
    const { result } = renderHook(() => usePersistence());

    act(() => {
      result.current.saveDraft({ fullName: "Ravi", city: "Kochi" });
    });

    const draft = result.current.loadDraft();
    expect(draft).toEqual({ fullName: "Ravi", city: "Kochi" });
  });

  it("returns null when no draft has been saved (key absent)", () => {
    const { result } = renderHook(() => usePersistence());

    const draft = result.current.loadDraft();
    expect(draft).toBeNull();
  });

  it("returns null for malformed JSON (silent discard — no throw)", () => {
    // Simulate corrupted localStorage data
    localStorage.setItem(STORAGE_KEY, "this-is-not-json{{{");

    const { result } = renderHook(() => usePersistence());

    let draft: ReturnType<typeof result.current.loadDraft> | undefined;
    expect(() => {
      draft = result.current.loadDraft();
    }).not.toThrow();
    expect(draft).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    localStorage.setItem(STORAGE_KEY, '{"fullName": "Incomplete');

    const { result } = renderHook(() => usePersistence());
    expect(result.current.loadDraft()).toBeNull();
  });
});

// ── clearDraft (module-level export) ─────────────────────────────────────────

describe("clearDraft (module export)", () => {
  it("removes the draft key from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fullName: "Test" }));

    clearDraft();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("is safe to call when no draft exists", () => {
    expect(() => clearDraft()).not.toThrow();
  });
});
