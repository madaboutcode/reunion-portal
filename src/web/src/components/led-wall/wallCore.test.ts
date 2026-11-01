/**
 * LED wall — pure core scenario suite.
 *
 * No DOM, no fake timers: `wallCore` emits "schedule" as data, so a
 * scenario is just a list of events plus a tiny runner that fires the
 * earliest-scheduled effect and feeds its event back in. These are the 8
 * scenarios from `tasks/2026-08-13-led-wall-state-machine.options.md` §4 —
 * the "is it better?" tests for the whole redesign.
 */
import { describe, expect, it } from "vitest";
import { candidateAEngine } from "./engine";
import type { WallEffect, WallEffectKey, WallEvent, WallState } from "./wallCore";
import { BRANCH_CATALOG } from "./branchCatalog";
import { DEFAULT_PARAMS } from "./defaults";
import type { LedWallParams, PresentAttendee } from "./types";

const PARAMS: LedWallParams = { ...DEFAULT_PARAMS, dwell: 22, outMs: 640, spotlightHold: 9500 };

function attendee(id: number, branch: string, checkedInAt: number): PresentAttendee {
  return { id, fullName: `Person ${id}`, branch, portraitUrl: null, thumbnailUrl: null, checkedInAt };
}

interface PendingTimer {
  afterMs: number;
  event: WallEvent;
}

/** Drives the engine directly — the shell (a later phase) is not involved. */
interface Runner {
  state: WallState;
  timers: Map<WallEffectKey, PendingTimer>;
  /** ids, in the order their spotlight began. */
  spotlightHistory: number[];
}

function createRunner(params: LedWallParams = PARAMS): Runner {
  const [state, effects] = candidateAEngine.init(params);
  const runner: Runner = { state, timers: new Map(), spotlightHistory: [] };
  applyEffects(runner, effects);
  return runner;
}

/**
 * "schedule" is an idempotent ensure: a key already pending is left running
 * untouched (no restart). "cancel" clears it. This mirrors the contract
 * `wallCore.ts` documents for the real interpreter (`useWallEngine`, a
 * later phase).
 */
function applyEffects(runner: Runner, effects: readonly WallEffect[]): void {
  for (const effect of effects) {
    if (effect.type === "cancel") {
      runner.timers.delete(effect.key);
    } else if (!runner.timers.has(effect.key)) {
      runner.timers.set(effect.key, { afterMs: effect.afterMs, event: effect.event });
    }
  }
}

function dispatch(runner: Runner, event: WallEvent, params: LedWallParams = PARAMS): void {
  const before = runner.state.spotlight?.id;
  const [next, effects] = candidateAEngine.transition(runner.state, event, params);
  runner.state = next;
  applyEffects(runner, effects);
  if (next.spotlight && next.spotlight.id !== before) runner.spotlightHistory.push(next.spotlight.id);
}

/** Fires the pending timer with the smallest `afterMs` and feeds its event back in. Returns false if nothing is pending. */
function fireEarliest(runner: Runner, params: LedWallParams = PARAMS): boolean {
  let earliestKey: WallEffectKey | null = null;
  let earliest: PendingTimer | null = null;
  for (const [key, timer] of runner.timers) {
    if (!earliest || timer.afterMs < earliest.afterMs) {
      earliest = timer;
      earliestKey = key;
    }
  }
  if (!earliest || !earliestKey) return false;
  runner.timers.delete(earliestKey);
  dispatch(runner, earliest.event, params);
  return true;
}

function isQuiescent(state: WallState): boolean {
  return state.shift === null && state.queue.length === 0 && state.spotlight === null;
}

/** Fires scheduled effects until the wall is back to a resting state (queue drained, nothing spotlighting, no shift in flight). */
function runToCompletion(runner: Runner, params: LedWallParams = PARAMS, maxSteps = 200): void {
  let steps = 0;
  while (!isQuiescent(runner.state) && fireEarliest(runner, params)) {
    steps += 1;
    if (steps > maxSteps) throw new Error("runToCompletion: exceeded maxSteps — likely an infinite loop");
  }
}

const CSE = "Computer Science & Engineering";
const ME = "Mechanical Engineering";
const CIVIL = "Civil Engineering";
const ARCH = "Architecture";

describe("wallCore — the 8 brief scenarios", () => {
  it("one arrival mid-rotation-shift spotlights, then rotation returns to the branch the shift was already heading to", () => {
    const runner = createRunner();
    dispatch(runner, {
      type: "SNAPSHOT",
      asOfSeq: 0,
      attendees: [attendee(1, CSE, 1000), attendee(2, CSE, 1001), attendee(3, ME, 1002), attendee(4, ME, 1003)],
    });
    expect(runner.state.phase).toBe("rotation");
    expect(runner.state.branchCursor).toBe(CSE);

    dispatch(runner, { type: "DWELL_EXPIRED" });
    expect(runner.state.shift?.kind).toBe("advance");

    // Arrives mid-shift, in an already-present branch so it doesn't perturb rotation order.
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(5, CSE, 2000), seq: 1 });
    expect(runner.state.queue).toHaveLength(1);

    runToCompletion(runner);

    expect(runner.spotlightHistory).toEqual([5]);
    expect(runner.state.phase).toBe("rotation");
    expect(runner.state.branchCursor).toBe(ME); // the advance shift completed as if uninterrupted
    expect(runner.state.queue).toEqual([]);
  });

  it("PROOF — a burst of 3 arrivals spotlights all 3, in order, with no stall", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000)] });

    dispatch(runner, { type: "ARRIVAL", attendee: attendee(101, CSE, 2000), seq: 1 });
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(102, ME, 2001), seq: 2 });
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(103, CIVIL, 2002), seq: 3 });

    // All 3 landed while the first arrival's shift was still animating — this is the stall repro on the old architecture.
    // 101 is already committed into that in-flight shift (popped at begin, not at swap — see beginShift); 102/103 queue behind it.
    expect(runner.state.shift?.attendee?.id).toBe(101);
    expect(runner.state.queue.map((a) => a.id)).toEqual([102, 103]);

    runToCompletion(runner);

    expect(runner.spotlightHistory).toEqual([101, 102, 103]);
    expect(runner.state.queue).toEqual([]);
    expect(runner.state.spotlight).toBeNull();
  });

  it("re-sync adding to the current branch does not restart the dwell timer", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });
    expect(runner.state.phase).toBe("rotation");
    const dwellBefore = runner.timers.get("dwell");
    expect(dwellBefore).toBeDefined();

    dispatch(runner, {
      type: "SNAPSHOT",
      asOfSeq: 0,
      attendees: [attendee(1, CSE, 1000), attendee(3, CSE, 1002), attendee(2, ME, 1001)],
    });

    expect(runner.state.attendees.size).toBe(3);
    expect(runner.state.attendees.has(3)).toBe(true);
    expect(runner.timers.get("dwell")).toBe(dwellBefore); // same timer — never restarted
    expect(runner.state.phase).toBe("rotation");
  });

  it("re-sync removing the currently-spotlighting attendee lets the spotlight finish; rotation truth updates", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [] });
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(1, CSE, 1000), seq: 1 });
    // Drive to the resting mid-hold point (swap + complete of the enter-shift).
    fireEarliest(runner);
    fireEarliest(runner);
    expect(runner.state.phase).toBe("spotlight");
    expect(runner.state.spotlight?.id).toBe(1);
    const spotlightBefore = runner.state.spotlight;

    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 5, attendees: [] }); // asOfSeq >= the arrival's seq: a genuine removal

    expect(runner.state.spotlight).toBe(spotlightBefore); // unchanged — the hold isn't cut short
    expect(runner.state.phase).toBe("spotlight");
    expect(runner.state.attendees.has(1)).toBe(false); // rotation truth updated

    runToCompletion(runner);
    expect(runner.state.phase).toBe("idle"); // nobody left once the spotlight naturally finishes
  });

  it("a branch-set swap mid-branch repairs the cursor via the old rotation order, without restarting the dwell timer", () => {
    const runner = createRunner();
    dispatch(runner, {
      type: "SNAPSHOT",
      asOfSeq: 0,
      attendees: [attendee(1, CIVIL, 1000), attendee(2, CSE, 1001), attendee(3, ME, 1002)],
    });
    expect(runner.state.branchCursor).toBe(CIVIL); // first in catalog order: Civil, CSE, Mechanical
    const dwellBefore = runner.timers.get("dwell");

    // Civil disappears, Architecture appears — cursor should walk forward from Civil's old position to CSE.
    dispatch(runner, {
      type: "SNAPSHOT",
      asOfSeq: 0,
      attendees: [attendee(4, ARCH, 2000), attendee(2, CSE, 1001), attendee(3, ME, 1002)],
    });

    expect(runner.state.branchCursor).toBe(CSE);
    expect(runner.timers.get("dwell")).toBe(dwellBefore);
  });

  it("zero present goes idle; the first arrival starts a spotlight episode", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [] });
    expect(runner.state.phase).toBe("idle");

    dispatch(runner, { type: "ARRIVAL", attendee: attendee(1, CSE, 1000), seq: 1 });
    expect(runner.state.shift?.kind).toBe("enter");

    runToCompletion(runner);
    expect(runner.spotlightHistory).toEqual([1]);
    expect(runner.state.phase).toBe("rotation"); // only 1 branch present, so it settles here rather than idle
  });

  it("an exact duplicate arrival (same id and checkedInAt) is ignored — no state change, no effects", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });
    const before = runner.state;

    const [next, effects] = candidateAEngine.transition(
      runner.state,
      { type: "ARRIVAL", attendee: attendee(1, CSE, 1000), seq: 99 },
      PARAMS,
    );

    expect(next).toBe(before);
    expect(effects).toEqual([]);
  });

  it("re-arrival with a newer checkedInAt (checked out and back in) spotlights again", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });

    dispatch(runner, { type: "ARRIVAL", attendee: attendee(1, CSE, 5000), seq: 1 }); // same id, newer checkedInAt
    // Committed into the enter-shift immediately (queue was empty and no other shift was in flight).
    expect(runner.state.shift?.kind).toBe("enter");
    expect(runner.state.shift?.attendee?.id).toBe(1);

    runToCompletion(runner);
    expect(runner.spotlightHistory).toEqual([1]);
    expect(runner.state.attendees.get(1)?.checkedInAt).toBe(5000);
  });

  it("empty branches never appear in the rotation cursor — the shift walks straight past them", () => {
    const runner = createRunner();
    // Present: Civil and Mechanical only. Architecture/Chemical/CSE/EEE/ECE are empty and sit between them in catalog order.
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CIVIL, 1000), attendee(2, ME, 1001)] });
    expect(runner.state.branchCursor).toBe(CIVIL);

    dispatch(runner, { type: "DWELL_EXPIRED" });
    fireEarliest(runner); // swap
    expect(runner.state.branchCursor).toBe(ME); // skipped every empty catalog branch in between
  });

  it("an attendee in an unrecognized branch is still present in rotation truth, but never becomes the branch cursor", () => {
    const runner = createRunner();
    dispatch(runner, {
      type: "SNAPSHOT",
      asOfSeq: 0,
      attendees: [attendee(1, CSE, 1000), attendee(2, "Alumni Board", 1001)],
    });

    expect(runner.state.attendees.has(2)).toBe(true); // still rendered, per spec — no panel, but not dropped
    expect(runner.state.branchCursor).toBe(CSE); // the unrecognized branch is never a rotation stop
    expect(runner.state.phase).toBe("rotation");
  });
});

describe("wallCore — review-driven fixes", () => {
  it("FIX 1 — a re-sync pruning a committed (but not-yet-swapped) enter-shift attendee doesn't crash; they finish their spotlight", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [] });
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(1, CSE, 1000), seq: 1 }); // begins the enter-shift, commits id 1
    expect(runner.state.shift?.attendee?.id).toBe(1);

    // asOfSeq >= the arrival's seq, and doesn't list id 1 — a genuine removal, arriving before the shift has even swapped.
    expect(() => dispatch(runner, { type: "SNAPSHOT", asOfSeq: 1, attendees: [] })).not.toThrow();
    expect(runner.state.attendees.has(1)).toBe(false); // rotation truth updated
    expect(runner.state.shift?.attendee?.id).toBe(1); // still committed — not stranded

    expect(() => runToCompletion(runner)).not.toThrow();
    expect(runner.spotlightHistory).toEqual([1]); // the committed spotlight still happened
    expect(runner.state.phase).toBe("idle"); // nobody left once it naturally finishes
  });

  it("FIX 2 — the exit-swap never leaves phase 'rotation' with a null cursor while a catalog-branch attendee is present", () => {
    const runner = createRunner();
    const assertInvariant = () => {
      const hasCatalogAttendee = [...runner.state.attendees.values()].some((a) => a.branch in BRANCH_CATALOG);
      const violated = runner.state.phase === "rotation" && runner.state.branchCursor === null && hasCatalogAttendee;
      expect(violated).toBe(false);
    };

    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [] });
    assertInvariant();
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(1, CSE, 1000), seq: 1 }); // idle → committed spotlight, cursor never set via the rotation path
    assertInvariant();

    let steps = 0;
    while (fireEarliest(runner)) {
      assertInvariant(); // checked immediately after the exit-swap fire, where the bug lived
      if (isQuiescent(runner.state)) break;
      steps += 1;
      if (steps > 50) throw new Error("exceeded step budget");
    }
  });

  it("FIX 3 — an out-of-order (stale) snapshot response is dropped, not applied", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 5, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });
    const afterNewer = runner.state;

    // A slower request that started before the one above, but resolves after it.
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 3, attendees: [attendee(1, CSE, 1000)] });

    expect(runner.state.attendees.has(2)).toBe(true); // b survives — the stale response never applied
    expect(runner.state).toEqual(afterNewer);
  });

  it("FIX 3 — an equal asOfSeq still applies (a plain refresh with no arrivals in between)", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 5, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });

    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 5, attendees: [attendee(1, CSE, 1000)] }); // 2 genuinely left, same asOfSeq

    expect(runner.state.attendees.has(2)).toBe(false);
  });

  it("FIX 4 — overlay keeps a not-yet-shown arrival a stale-relative snapshot doesn't list yet, in both attendees and the queue", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [] });
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(1, CSE, 1000), seq: 1 }); // begins its own enter-shift, commits immediately
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(10, ME, 2000), seq: 5 }); // shift already in flight — stays queued
    expect(runner.state.queue.map((a) => a.id)).toEqual([10]);

    // asOfSeq 3 predates id 10's arrival (seq 5) but not id 1's (seq 1) — confirms id 1, is silent on id 10.
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 3, attendees: [attendee(1, CSE, 1000)] });

    expect(runner.state.attendees.has(10)).toBe(true);
    expect(runner.state.queue.map((a) => a.id)).toEqual([10]);
  });

  it("FIX 4 — a re-sync prunes a queued (not-yet-shown) attendee without disturbing the one already spotlighting", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [] });
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(1, CSE, 1000), seq: 1 }); // committed, enter-shift begins
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(2, ME, 2000), seq: 2 }); // queues behind it
    fireEarliest(runner); // swap: id 1 becomes the spotlight
    fireEarliest(runner); // complete: shift clears, hold ensured
    expect(runner.state.spotlight?.id).toBe(1);
    expect(runner.state.queue.map((a) => a.id)).toEqual([2]);

    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 10, attendees: [attendee(1, CSE, 1000)] }); // id 2 genuinely gone

    expect(runner.state.queue).toEqual([]); // pruned
    expect(runner.state.spotlight?.id).toBe(1); // unaffected
  });

  it("FIX 4 — PARAMS_CHANGED cancels and re-schedules a pending dwell with the new duration", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });
    expect(runner.timers.get("dwell")?.afterMs).toBe(PARAMS.dwell * 1000);

    const faster: LedWallParams = { ...PARAMS, dwell: 5 };
    dispatch(runner, { type: "PARAMS_CHANGED", params: faster }, faster);

    expect(runner.timers.get("dwell")?.afterMs).toBe(5000);
  });

  it("FIX 4 — PARAMS_CHANGED cancels and re-schedules a pending hold with the new duration", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [] });
    dispatch(runner, { type: "ARRIVAL", attendee: attendee(1, CSE, 1000), seq: 1 });
    fireEarliest(runner); // swap
    fireEarliest(runner); // complete — resting spotlight, hold ensured at the default duration
    expect(runner.timers.get("hold")?.afterMs).toBe(PARAMS.spotlightHold);

    const faster: LedWallParams = { ...PARAMS, spotlightHold: 1500 };
    dispatch(runner, { type: "PARAMS_CHANGED", params: faster }, faster);

    expect(runner.timers.get("hold")?.afterMs).toBe(1500);
  });

  it("FIX 4 — DWELL_EXPIRED is dropped when not resting in rotation (wrong phase, or a shift already in flight)", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [] });
    const whileIdle = runner.state;
    dispatch(runner, { type: "DWELL_EXPIRED" }); // phase is "idle", not "rotation"
    expect(runner.state).toEqual(whileIdle);

    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 1, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });
    dispatch(runner, { type: "DWELL_EXPIRED" }); // valid — begins the advance shift
    expect(runner.state.shift?.kind).toBe("advance");
    const midShift = runner.state;
    dispatch(runner, { type: "DWELL_EXPIRED" }); // a shift is already in flight — stale
    expect(runner.state).toEqual(midShift);
  });

  it("FIX 4 — HOLD_EXPIRED is dropped when not resting in spotlight", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000)] });
    const whileRotating = runner.state;
    dispatch(runner, { type: "HOLD_EXPIRED" }); // phase is "rotation", not "spotlight"
    expect(runner.state).toEqual(whileRotating);
  });

  it("FIX 4 — SHIFT_SWAPPED and SHIFT_COMPLETED with a mismatched token are dropped, not acted on", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });
    dispatch(runner, { type: "DWELL_EXPIRED" });
    const midShift = runner.state;
    const wrongToken = (midShift.shift?.token ?? 0) + 100;

    dispatch(runner, { type: "SHIFT_SWAPPED", token: wrongToken });
    expect(runner.state).toEqual(midShift);

    dispatch(runner, { type: "SHIFT_COMPLETED", token: wrongToken });
    expect(runner.state).toEqual(midShift);
  });

  it("FIX 4 — SHIFT_COMPLETED before its SHIFT_SWAPPED is an impossible ordering and throws", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });
    dispatch(runner, { type: "DWELL_EXPIRED" });
    const token = runner.state.shift?.token;
    expect(token).toBeDefined();

    expect(() =>
      candidateAEngine.transition(runner.state, { type: "SHIFT_COMPLETED", token: token as number }, PARAMS),
    ).toThrow();
  });

  it("FIX 4 — a duplicate SHIFT_SWAPPED for an already-swapped shift throws", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001)] });
    dispatch(runner, { type: "DWELL_EXPIRED" });
    const token = runner.state.shift?.token;
    expect(token).toBeDefined();
    dispatch(runner, { type: "SHIFT_SWAPPED", token: token as number }); // valid, first swap

    expect(() =>
      candidateAEngine.transition(runner.state, { type: "SHIFT_SWAPPED", token: token as number }, PARAMS),
    ).toThrow();
  });

  it("FIX 5 — shift tokens are monotonic across shifts, decoupled from the 2-value shiftParity alternator", () => {
    const runner = createRunner();
    dispatch(runner, { type: "SNAPSHOT", asOfSeq: 0, attendees: [attendee(1, CSE, 1000), attendee(2, ME, 1001), attendee(3, CIVIL, 1002)] });

    dispatch(runner, { type: "DWELL_EXPIRED" }); // advance shift #1
    const tokenA = runner.state.shift?.token;
    runToCompletion(runner);

    dispatch(runner, { type: "DWELL_EXPIRED" }); // advance shift #2
    const tokenB = runner.state.shift?.token;
    runToCompletion(runner);

    dispatch(runner, { type: "DWELL_EXPIRED" }); // advance shift #3
    const tokenC = runner.state.shift?.token;

    expect(tokenA).toBeDefined();
    expect(tokenB).toBeDefined();
    expect(tokenC).toBeDefined();
    // Monotonically increasing, not merely alternating 0/1 — the 3rd shift's token must differ from the 1st's.
    expect(tokenB).toBeGreaterThan(tokenA as number);
    expect(tokenC).toBeGreaterThan(tokenB as number);
  });
});
