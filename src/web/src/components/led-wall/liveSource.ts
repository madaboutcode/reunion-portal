import { getDeskRoster } from "@/lib/api";
import type { DeskRosterEntry, DeskRosterEvent } from "@/lib/api";
import type { LedWallDataSource, PresentAttendee } from "./types";

function toAttendee(entry: DeskRosterEntry): PresentAttendee {
  return {
    id: entry.registrationId,
    fullName: entry.name,
    branch: entry.branch,
    portraitUrl: entry.portraitUrl,
    thumbnailUrl: entry.thumbnailUrl,
    checkedInAt: entry.checkedInAt,
  };
}

/**
 * HTTP-polling `LedWallDataSource` backed by `/api/public/desk-roster`.
 *
 * GUARANTEES:
 * - **G1 — cursor adoption is after mapping, on success only.** In
 *   `getSnapshot()` and in each poll, `this.cursor` only advances after the
 *   response has been successfully parsed into the mapped
 *   entries/events array. If the response is malformed or the request
 *   throws, the cursor does not move — otherwise a failed batch's events
 *   would be skipped permanently (the next poll would ask for everything
 *   after them).
 * - **G2 — the cursor is monotonic: `this.cursor = Math.max(this.cursor,
 *   res.seq)`.** Never a bare assignment. A slow full-mode request and a
 *   delta poll can resolve out of order; a bare assign would rewind the
 *   cursor behind already-delivered events, and a re-delivered departure
 *   would fire another full re-sync — an amplifying loop. `Math.max` makes
 *   that safe.
 * - **G3 — the poll timer does not start until a cursor is adopted.** With
 *   no cursor there is no `since`, so a poll would issue a second full-mode
 *   fetch. The timer starts inside the first successful `getSnapshot`
 *   continuation. Accepted consequence: if the very first snapshot fails,
 *   nothing polls until a later snapshot succeeds — `useLedWallSource`'s
 *   own re-sync timer is the recovery path for that.
 * - **G4 — this source never inspects departure ids.** A departure carries
 *   only `{seq, type, registrationId}`. There is no local present-set used
 *   to decide whether a departure is "known" — that set would drift from
 *   `wallCore`'s `applySnapshot` reconciliation. Instead: any departure in
 *   a batch sets a single resync flag; if set after processing the batch,
 *   `subscribeResync` fires once. Unknown-id tolerance is therefore
 *   structural, not defensive.
 * - **G5 — same-batch collapse, in seq order, last-event-per-id wins.**
 *   Events are processed in `seq` order. For a given id within one batch:
 *   arrival-then-departure emits no arrival; departure-then-arrival emits
 *   the arrival. Departures for other ids never suppress unrelated
 *   arrivals. Collapse governs arrival emission only — it is independent of
 *   G4's resync trigger, which looks at the raw batch, not survivors: a
 *   departure superseded by a same-id arrival (departure-then-arrival) still
 *   triggers a resync alongside the emitted arrival.
 * - **G6 — poll failures are swallowed; the cursor holds.** A rejected
 *   delta poll does not set any error state (that is the snapshot's
 *   channel, surfaced by `useLedWallSource`'s `SNAPSHOT_FAILED`) and does
 *   not advance the cursor — the next tick retries from the same `since`.
 *
 * Field mapping (server → wall): `registrationId → id`, `name → fullName`;
 * `branch`, `checkedInAt`, `portraitUrl`, `thumbnailUrl` carry through
 * unchanged.
 */
export class LiveLedWallSource implements LedWallDataSource {
  private readonly pollIntervalMs: number;
  private cursor = -Infinity;
  private pollTimer: number | null = null;
  private readonly arrivalSubscribers = new Set<(attendee: PresentAttendee) => void>();
  private readonly resyncSubscribers = new Set<() => void>();

  constructor(pollIntervalMs = 3000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  async getSnapshot(): Promise<PresentAttendee[]> {
    const res = await getDeskRoster();
    // Boundary shape guard: called without `since`, the server contract is a
    // full response. A delta response here is a server/contract violation,
    // not a reasoned state — crash loudly rather than adopt a bogus cursor.
    if (!("entries" in res)) {
      throw new Error(
        "LiveLedWallSource.getSnapshot: expected a full desk-roster response (entries), got a delta response",
      );
    }
    const mapped = res.entries.map(toAttendee);
    this.cursor = Math.max(this.cursor, res.seq); // G1/G2 — adopt only after mapping succeeds, monotonically
    this.startPolling(); // G3 — a cursor now exists, so polling can begin
    return mapped;
  }

  subscribe(onArrival: (attendee: PresentAttendee) => void): () => void {
    this.arrivalSubscribers.add(onArrival);
    return () => {
      this.arrivalSubscribers.delete(onArrival);
      this.stopPollingIfNoSubscribers();
    };
  }

  subscribeResync(onResyncNeeded: () => void): () => void {
    this.resyncSubscribers.add(onResyncNeeded);
    return () => {
      this.resyncSubscribers.delete(onResyncNeeded);
      this.stopPollingIfNoSubscribers();
    };
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return; // guard double-start
    this.pollTimer = window.setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  private stopPollingIfNoSubscribers(): void {
    if (this.arrivalSubscribers.size > 0 || this.resyncSubscribers.size > 0) return;
    if (this.pollTimer === null) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async poll(): Promise<void> {
    let res;
    try {
      res = await getDeskRoster(this.cursor);
    } catch {
      return; // G6 — swallow, cursor holds, next tick retries from the same `since`
    }
    // Boundary shape guard, mirroring getSnapshot's: called with `since`, the
    // server contract is a delta response.
    if (!("events" in res)) {
      throw new Error(
        "LiveLedWallSource.poll: expected a delta desk-roster response (events), got a full response",
      );
    }

    const bySeq = [...res.events].sort((a, b) => a.seq - b.seq);
    const lastEventById = new Map<number, DeskRosterEvent>();
    for (const event of bySeq) lastEventById.set(event.registrationId, event); // last write in seq order wins

    // G5 — walk survivors in seq order (last write per id). Collapse governs arrival emission only:
    // a departure elsewhere in the batch still triggers resync below even if an arrival for the same
    // id supersedes it (G4 — resync is independent of collapse).
    for (const event of bySeq) {
      if (lastEventById.get(event.registrationId) !== event) continue; // superseded within this batch
      if (event.type !== "arrival") continue; // a surviving departure needs no per-event handling here
      const attendee = toAttendee(event);
      for (const subscriber of this.arrivalSubscribers) subscriber(attendee);
    }

    // G4 — any departure in the raw batch triggers exactly one resync, regardless of collapse.
    const anyDeparture = res.events.some((event) => event.type === "departure");
    if (anyDeparture) {
      for (const subscriber of this.resyncSubscribers) subscriber();
    }

    this.cursor = Math.max(this.cursor, res.seq); // G1/G2 — adopt only after the batch is fully processed
  }
}
