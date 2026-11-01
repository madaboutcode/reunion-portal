/**
 * LED wall — the pure state core (Candidate A).
 *
 * Single owner of mode, branch cursor, spotlight queue, spotlight attendee,
 * and shift/transition state. No React, no timers, no `Date.now`, no I/O —
 * time enters only as a `WallEffect["schedule"]` the shell runs, and leaves
 * only as an event fed back through `transition`. Design source:
 * `tasks/2026-08-13-led-wall-state-machine.plan.md` and
 * `tasks/2026-08-13-led-wall-state-machine.options.md` §3 Candidate A.
 *
 * Every `transition` case ends by calling `settle`, which re-asks "what
 * should be running now?" given the resulting state. That is what kills the
 * spotlight-queue stall by construction: there is no lock outside state, so
 * no event can strand the queue — the very next event re-asks the question.
 *
 * Effect contract for the shell (`useWallEngine`, built in a later phase):
 * `"schedule"` for a given `key` is an idempotent *ensure* — if a timer for
 * that key is already pending, the shell leaves it running untouched (this
 * is how a re-sync that doesn't touch dwell/hold avoids restarting them,
 * per feature spec R9). `"cancel"` clears a pending timer for that key, if
 * any. A caller that wants to force a restart (e.g. a live speed change)
 * must emit `cancel` before `schedule` for the same key — `wallCore` does
 * exactly this for `PARAMS_CHANGED`: changing dwell/hold mid-flight restarts
 * that timer at full new duration from now, not a pro-rated remainder. One
 * consequence worth knowing: dragging the dwell slider in the debug panel
 * fires `PARAMS_CHANGED` on every tick, which keeps restarting the dwell
 * timer — the current branch stays pinned on screen for as long as you keep
 * dragging. That's intended, not a bug.
 *
 * A re-sync that prunes a queued-but-not-yet-shown attendee (see
 * `applySnapshot`) does so silently — no event, no error. The Phase-3 state
 * inspector is where that becomes visible, by reading the queue before and
 * after.
 */
import { BRANCH_CATALOG } from "./branchCatalog";
import type { LedWallParams, PresentAttendee } from "./types";

/** One in-flight visual transition: a branch advance, or entering/exiting the spotlight. */
export interface WallShift {
  /** Distinguishes this shift from the next one scheduled after it — the staleness guard for timer events. Monotonic, independent of `shiftParity`. */
  token: number;
  kind: "advance" | "enter" | "exit";
  /** Whether the 48%-mark content swap (branch change / spotlight in-or-out) has already applied. */
  swapped: boolean;
  /**
   * For `kind: "enter"` only: the attendee committed to this shift's
   * spotlight, popped from the queue at `beginShift` time (not at swap
   * time). This is what makes a mid-flight queue prune (a re-sync that no
   * longer lists this attendee) harmless — they're no longer *in* the
   * queue to be pruned from, they're already committed to finishing their
   * episode, exactly like someone already spotlighting. `null` for
   * `"advance"`/`"exit"`.
   */
  attendee: PresentAttendee | null;
}

export interface WallState {
  phase: "loading" | "idle" | "rotation" | "spotlight";
  /** Rotation truth: everyone currently present, keyed by registration id. */
  attendees: Map<number, PresentAttendee>;
  /** id → checkedInAt of the last attendee record accepted — dedup, real state now. */
  knownVersions: Map<number, number>;
  /**
   * id → the ARRIVAL `seq` that last placed this id in `attendees`. Only
   * ARRIVAL sets this; SNAPSHOT reads it to tell "removed" apart from
   * "the snapshot just predates this arrival" (see `applySnapshot`). Not
   * part of the plan's literal field list — added because the documented
   * arrival-vs-in-flight-snapshot race decision has no other home. See the
   * handoff notes for the full rationale.
   */
  arrivalSeq: Map<number, number>;
  /**
   * The `asOfSeq` of the last SNAPSHOT actually applied. Also not in the
   * plan's literal field list — needed to drop an out-of-order snapshot
   * response (a slower request resolving after a newer one already
   * landed), which would otherwise roll `attendees` backwards. See
   * `applySnapshot`'s call site in `transition`.
   */
  lastSnapshotSeq: number;
  branchCursor: string | null;
  /** FIFO, live-witnessed arrivals only — SNAPSHOT/re-sync never enqueues. */
  queue: PresentAttendee[];
  spotlight: PresentAttendee | null;
  shift: WallShift | null;
  shiftParity: "A" | "B";
  /**
   * The token to hand the next shift that begins. Also not in the plan's
   * literal field list — the plan's `shift.token` needs to be monotonic
   * (its own stated shape), and that's only provable locally with a
   * persisted counter; deriving it from `shiftParity` alone (a 2-value
   * alternator) makes staleness detection depend on the shell never
   * double-firing or misordering effects, which is a weaker guarantee than
   * the core can make on its own.
   */
  nextShiftToken: number;
  error: string | null;
}

export type WallEvent =
  | { type: "SNAPSHOT"; attendees: PresentAttendee[]; asOfSeq: number }
  | { type: "SNAPSHOT_FAILED"; message: string }
  | { type: "ARRIVAL"; attendee: PresentAttendee; seq: number }
  | { type: "DWELL_EXPIRED" }
  | { type: "HOLD_EXPIRED" }
  | { type: "SHIFT_SWAPPED"; token: number } // the 48% mark
  | { type: "SHIFT_COMPLETED"; token: number } // the 100% mark
  | { type: "PARAMS_CHANGED"; params: LedWallParams };

export type WallEffectKey = "dwell" | "hold" | "swap" | "complete";

export type WallEffect =
  | { type: "schedule"; key: WallEffectKey; afterMs: number; event: WallEvent }
  | { type: "cancel"; key: WallEffectKey };

function assertNever(value: never): never {
  throw new Error(`wallCore: unhandled case ${JSON.stringify(value)}`);
}

/** Catalog order, filtered to branches with at least one present attendee — empty branches are skipped. */
function rotationBranchesOf(attendees: Map<number, PresentAttendee>): string[] {
  const counts = new Map<string, number>();
  for (const attendee of attendees.values()) {
    counts.set(attendee.branch, (counts.get(attendee.branch) ?? 0) + 1);
  }
  return Object.keys(BRANCH_CATALOG).filter((branch) => (counts.get(branch) ?? 0) > 0);
}

/**
 * Branch-cursor repair after a re-sync (ported from `LedWall.tsx`'s
 * `branchAfterResync`, ~lines 61-72): if the current branch is still
 * present, keep it. Otherwise walk forward from the cursor's position in
 * the OLD rotation order to the next branch that is still present in the
 * NEW order. Falls back to the first branch in the new order, or `null`.
 */
function repairBranchCursor(oldOrder: string[], newOrder: string[], cursor: string | null): string | null {
  if (cursor !== null && newOrder.includes(cursor)) return cursor;
  const previousIndex = cursor !== null ? oldOrder.indexOf(cursor) : -1;
  if (previousIndex >= 0) {
    for (let offset = 1; offset <= oldOrder.length; offset += 1) {
      const candidate = oldOrder[(previousIndex + offset) % oldOrder.length];
      if (candidate !== undefined && newOrder.includes(candidate)) return candidate;
    }
  }
  return newOrder[0] ?? null;
}

function shiftDurationMs(params: LedWallParams): number {
  return Math.round(params.outMs * 2);
}

function swapDelayMs(params: LedWallParams): number {
  return Math.round(shiftDurationMs(params) * 0.48);
}

/** If still in the placeholder `"loading"` phase, leave it — SNAPSHOT/SNAPSHOT_FAILED/ARRIVAL all count as "we now know something." */
function leaveLoading(state: WallState): WallState {
  return state.phase === "loading" ? { ...state, phase: "idle" } : state;
}

/**
 * A spotlight episode is "in progress and must not be silently abandoned"
 * once either: we're resting mid-hold (`phase === "spotlight"`), or an
 * enter-shift has already committed an attendee (`shift.kind === "enter"`,
 * true for its whole lifecycle — pre- and post-swap). This is what protects
 * a committed arrival from the "nobody present → idle" collapse in
 * `settle`, matching the same "let it finish" treatment as someone already
 * spotlighting.
 */
function spotlightInProgress(state: WallState): boolean {
  return state.phase === "spotlight" || state.shift?.kind === "enter";
}

function beginShift(state: WallState, params: LedWallParams, kind: WallShift["kind"]): [WallState, WallEffect[]] {
  const parity: "A" | "B" = state.shiftParity === "A" ? "B" : "A";
  const token = state.nextShiftToken;
  let queue = state.queue;
  let attendee: PresentAttendee | null = null;
  if (kind === "enter") {
    const [head, ...rest] = state.queue;
    if (!head) throw new Error('wallCore: beginShift("enter") called with an empty queue — impossible, settle only calls it when queue.length > 0');
    attendee = head;
    queue = rest; // committed now, not at swap — a later re-sync's queue-prune can't strand them
  }
  const next: WallState = {
    ...state,
    queue,
    shift: { token, kind, swapped: false, attendee },
    shiftParity: parity,
    nextShiftToken: token + 1,
  };
  return [
    next,
    [
      { type: "cancel", key: "dwell" },
      { type: "cancel", key: "hold" },
      { type: "schedule", key: "swap", afterMs: swapDelayMs(params), event: { type: "SHIFT_SWAPPED", token } },
      { type: "schedule", key: "complete", afterMs: shiftDurationMs(params), event: { type: "SHIFT_COMPLETED", token } },
    ],
  ];
}

/** Applies the content change a shift's 48%-mark swap carries — the moment the branch/spotlight actually changes. */
function applySwapContent(state: WallState): WallState {
  const shift = state.shift;
  if (!shift) throw new Error("wallCore: applySwapContent called with no shift in flight");
  switch (shift.kind) {
    case "enter": {
      if (!shift.attendee) throw new Error('wallCore: "enter" shift swapped with no committed attendee — beginShift always sets one');
      return { ...state, phase: "spotlight", spotlight: shift.attendee, shift: { ...shift, swapped: true } };
    }
    case "exit": {
      const attendeesPresent = state.attendees.size > 0;
      // Same repair settle uses for landing in "rotation" — otherwise this window (exit-swap
      // to exit-complete) can sit at phase: "rotation", branchCursor: null with people present.
      const branches = rotationBranchesOf(state.attendees);
      const cursor = attendeesPresent
        ? (state.branchCursor !== null && branches.includes(state.branchCursor) ? state.branchCursor : (branches[0] ?? null))
        : state.branchCursor;
      return {
        ...state,
        phase: attendeesPresent ? "rotation" : "idle",
        spotlight: null,
        branchCursor: cursor,
        shift: { ...shift, swapped: true },
      };
    }
    case "advance": {
      const branches = rotationBranchesOf(state.attendees);
      const currentIndex = state.branchCursor !== null ? branches.indexOf(state.branchCursor) : -1;
      const nextCursor = branches.length > 0 ? (branches[(currentIndex + 1 + branches.length) % branches.length] ?? null) : null;
      return { ...state, branchCursor: nextCursor, shift: { ...shift, swapped: true } };
    }
    default:
      return assertNever(shift.kind);
  }
}

/**
 * Overlays SNAPSHOT data with the rotation truth, resolving the
 * arrival-vs-in-flight-snapshot race: an id whose most recent ARRIVAL `seq`
 * is newer than this snapshot's `asOfSeq` is kept even if the snapshot
 * doesn't list it yet (the snapshot request started before that arrival).
 * An id whose arrival is older than `asOfSeq` and is still missing from the
 * snapshot is a genuine removal.
 *
 * Also prunes queued-but-not-yet-shown attendees who are no longer present
 * (pre-decision: spotlighting an absent person is wrong — this can't reach
 * an attendee already committed into an in-flight enter-shift, since
 * `beginShift` already moved them out of `queue`), and repairs the branch
 * cursor (ported `branchAfterResync`).
 *
 * Assumes the caller has already checked `asOfSeq` isn't stale relative to
 * `state.lastSnapshotSeq` — see the `SNAPSHOT` case in `transition`.
 */
function applySnapshot(state: WallState, attendeesList: PresentAttendee[], asOfSeq: number): WallState {
  const oldOrder = rotationBranchesOf(state.attendees);
  const nextAttendees = new Map(attendeesList.map((a) => [a.id, a]));
  const nextArrivalSeq = new Map<number, number>();
  for (const [id, seq] of state.arrivalSeq) {
    if (nextAttendees.has(id)) continue; // the snapshot already reflects this arrival
    if (seq > asOfSeq) {
      // The snapshot predates this arrival — keep it overlaid rather than treating it as removed.
      const attendee = state.attendees.get(id);
      if (attendee) {
        nextAttendees.set(id, attendee);
        nextArrivalSeq.set(id, seq);
      }
    }
    // else: seq <= asOfSeq and missing from the snapshot — a genuine removal.
  }
  const nextKnownVersions = new Map<number, number>();
  for (const attendee of nextAttendees.values()) nextKnownVersions.set(attendee.id, attendee.checkedInAt);

  const nextQueue = state.queue.filter((attendee) => nextAttendees.has(attendee.id));
  const newOrder = rotationBranchesOf(nextAttendees);
  const nextCursor = repairBranchCursor(oldOrder, newOrder, state.branchCursor);

  return {
    ...state,
    attendees: nextAttendees,
    knownVersions: nextKnownVersions,
    arrivalSeq: nextArrivalSeq,
    lastSnapshotSeq: asOfSeq,
    queue: nextQueue,
    branchCursor: nextCursor,
    error: null,
  };
}

/**
 * Dedup key is id + checkedInAt: an exact match is a duplicate, ignored.
 * A newer checkedInAt for a known id is a re-arrival (checked out and
 * back in) — spotlights again. Returns `state` unchanged (same reference)
 * for a true duplicate, so callers can short-circuit cheaply.
 */
function applyArrival(state: WallState, attendee: PresentAttendee, seq: number): WallState {
  if (state.knownVersions.get(attendee.id) === attendee.checkedInAt) return state;
  const nextAttendees = new Map(state.attendees);
  nextAttendees.set(attendee.id, attendee);
  const nextKnownVersions = new Map(state.knownVersions);
  nextKnownVersions.set(attendee.id, attendee.checkedInAt);
  const nextArrivalSeq = new Map(state.arrivalSeq);
  nextArrivalSeq.set(attendee.id, seq);
  return {
    ...state,
    attendees: nextAttendees,
    knownVersions: nextKnownVersions,
    arrivalSeq: nextArrivalSeq,
    queue: [...state.queue, attendee],
  };
}

/**
 * Given where we are now, what should be running? This is the step every
 * `transition` case passes through on its way out — the stall dies here:
 * "should the next spotlight start" is re-evaluated after every event,
 * because this function is structurally the last thing every event does.
 */
function settle(state: WallState, params: LedWallParams): [WallState, WallEffect[]] {
  if (state.phase === "loading") return [state, []]; // waiting on the first SNAPSHOT/SNAPSHOT_FAILED

  if (state.attendees.size === 0 && !spotlightInProgress(state)) {
    // Nobody present, and no spotlight episode already committed. A committed episode
    // (resting mid-hold, or an enter-shift already holding its attendee) is left to
    // finish naturally (pre-decision: re-sync removing the spotlighted attendee — or
    // everyone else — doesn't cut them off).
    const alreadyIdle =
      state.phase === "idle" && state.shift === null && state.branchCursor === null && state.queue.length === 0;
    if (alreadyIdle) return [state, []];
    return [
      { ...state, phase: "idle", shift: null, spotlight: null, queue: [], branchCursor: null },
      [
        { type: "cancel", key: "dwell" },
        { type: "cancel", key: "hold" },
        { type: "cancel", key: "swap" },
        { type: "cancel", key: "complete" },
      ],
    ];
  }

  if (state.shift !== null) {
    // A shift is in flight; its own swap/complete effects are already scheduled by beginShift. Nothing to do.
    return [state, []];
  }

  if (state.queue.length > 0 && state.phase !== "spotlight") {
    return beginShift(state, params, "enter");
  }

  if (state.phase === "spotlight") {
    // Resting mid-hold: ensure the hold timer is running. Idempotent — see the module doc.
    return [state, [{ type: "schedule", key: "hold", afterMs: params.spotlightHold, event: { type: "HOLD_EXPIRED" } }]];
  }

  const branches = rotationBranchesOf(state.attendees);
  const cursor = state.branchCursor !== null && branches.includes(state.branchCursor) ? state.branchCursor : (branches[0] ?? null);
  const next: WallState = { ...state, phase: "rotation", branchCursor: cursor };
  if (branches.length >= 2) {
    return [next, [{ type: "schedule", key: "dwell", afterMs: params.dwell * 1000, event: { type: "DWELL_EXPIRED" } }]];
  }
  return [next, [{ type: "cancel", key: "dwell" }]];
}

// `params` isn't needed to build the initial state (loading starts empty regardless
// of tunables) — omitted rather than an unused parameter. `WallEngine.init` still
// accepts a `LedWallParams` argument; TS's arity rules allow this narrower signature.
export function init(): [WallState, WallEffect[]] {
  const state: WallState = {
    phase: "loading",
    attendees: new Map(),
    knownVersions: new Map(),
    arrivalSeq: new Map(),
    lastSnapshotSeq: -1,
    branchCursor: null,
    queue: [],
    spotlight: null,
    shift: null,
    shiftParity: "A",
    nextShiftToken: 0,
    error: null,
  };
  return [state, []];
}

export function transition(state: WallState, event: WallEvent, params: LedWallParams): [WallState, WallEffect[]] {
  switch (event.type) {
    case "SNAPSHOT": {
      // An out-of-order response: a slower request resolved after a newer one already applied.
      // Equal asOfSeq still applies — a plain refresh with no arrivals in between.
      if (event.asOfSeq < state.lastSnapshotSeq) return settle(state, params);
      return settle(leaveLoading(applySnapshot(state, event.attendees, event.asOfSeq)), params);
    }

    case "SNAPSHOT_FAILED":
      return settle(leaveLoading({ ...state, error: event.message }), params);

    case "ARRIVAL": {
      const updated = applyArrival(state, event.attendee, event.seq);
      if (updated === state) return [state, []]; // exact duplicate — no-op, nothing to settle
      return settle(leaveLoading(updated), params);
    }

    case "DWELL_EXPIRED": {
      if (state.phase !== "rotation" || state.shift !== null) return settle(state, params); // stale — drop
      return beginShift(state, params, "advance");
    }

    case "HOLD_EXPIRED": {
      if (state.phase !== "spotlight" || state.shift !== null) return settle(state, params); // stale — drop
      return beginShift(state, params, "exit");
    }

    case "SHIFT_SWAPPED": {
      if (!state.shift || state.shift.token !== event.token) return settle(state, params); // stale — shift already ended/replaced
      if (state.shift.swapped) throw new Error("wallCore: duplicate SHIFT_SWAPPED for an already-swapped shift");
      return settle(applySwapContent(state), params);
    }

    case "SHIFT_COMPLETED": {
      if (!state.shift || state.shift.token !== event.token) return settle(state, params); // stale — shift already ended/replaced
      if (!state.shift.swapped) throw new Error("wallCore: SHIFT_COMPLETED arrived before its SHIFT_SWAPPED");
      return settle({ ...state, shift: null }, params);
    }

    case "PARAMS_CHANGED": {
      // Force a restart with the new durations: cancel first, then let settle re-ensure with fresh params.
      const [settled, effects] = settle(state, event.params);
      return [settled, [{ type: "cancel", key: "dwell" }, { type: "cancel", key: "hold" }, ...effects]];
    }

    default:
      return assertNever(event);
  }
}
