/**
 * useStepAnimation
 *
 * Titles first, content follows. The user sees the checklist before details.
 *
 * Sequence:
 *   1. Circle 1 pops → Title 1 types in
 *   2. Circle 2 pops → Title 2 types in
 *   3. Brief pause (both titles visible)
 *   4. Content 1 expands
 *   5. Content 2 expands
 */

import { useState, useEffect, useRef } from "react";

const TITLE1 = "Transfer the amount";
const TITLE2 = "Upload your payment proof";
const CHAR_DELAY_MS = 30;

export interface StepAnimState {
  circle1Visible: boolean;
  title1: string;
  title1Done: boolean;
  content1Expanded: boolean;
  circle2Visible: boolean;
  title2: string;
  title2Done: boolean;
  content2Expanded: boolean;
}

export const FINAL_STATE: StepAnimState = {
  circle1Visible: true,
  title1: TITLE1,
  title1Done: true,
  content1Expanded: true,
  circle2Visible: true,
  title2: TITLE2,
  title2Done: true,
  content2Expanded: true,
};

export function useStepAnimation(options?: { instant?: boolean }): StepAnimState {
  const hasRun = useRef(false);
  const instantRef = useRef(options?.instant ?? false);
  const [state, setState] = useState<StepAnimState>({
    circle1Visible: false,
    title1: "",
    title1Done: false,
    content1Expanded: false,
    circle2Visible: false,
    title2: "",
    title2Done: false,
    content2Expanded: false,
  });

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    if (instantRef.current) {
      setState(FINAL_STATE);
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    function after(ms: number, fn: () => void): void {
      timers.push(setTimeout(fn, ms));
    }

    // Phase 1: Type out both titles (checklist reveal)

    // Circle 1 pops (0ms)
    after(0, () => setState((s) => ({ ...s, circle1Visible: true })));

    // Title 1 types (100ms → ~670ms)
    for (let i = 0; i < TITLE1.length; i++) {
      const n = i + 1;
      after(100 + i * CHAR_DELAY_MS, () =>
        setState((s) => ({ ...s, title1: TITLE1.slice(0, n) })),
      );
    }
    const title1DoneAt = 100 + (TITLE1.length - 1) * CHAR_DELAY_MS;
    after(title1DoneAt, () => setState((s) => ({ ...s, title1Done: true })));

    // Circle 2 pops (title1DoneAt + 100ms)
    const circle2At = title1DoneAt + 100;
    after(circle2At, () => setState((s) => ({ ...s, circle2Visible: true })));

    // Title 2 types (circle2At + 100ms → ~circle2At + 820ms)
    const title2StartAt = circle2At + 100;
    for (let i = 0; i < TITLE2.length; i++) {
      const n = i + 1;
      after(title2StartAt + i * CHAR_DELAY_MS, () =>
        setState((s) => ({ ...s, title2: TITLE2.slice(0, n) })),
      );
    }
    const title2DoneAt = title2StartAt + (TITLE2.length - 1) * CHAR_DELAY_MS;
    after(title2DoneAt, () => setState((s) => ({ ...s, title2Done: true })));

    // Phase 2: Brief pause, then expand content (details fill in)

    const expandStart = title2DoneAt + 300;
    after(expandStart, () => setState((s) => ({ ...s, content1Expanded: true })));
    after(expandStart + 200, () => setState((s) => ({ ...s, content2Expanded: true })));

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  return state;
}
