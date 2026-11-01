/**
 * LED wall live source — end-to-end suite.
 *
 * Drives the whole client stack — LedWall → useLedWallSource → wallCore →
 * LiveLedWallSource → Polaroid — through a stubbed global `fetch`. Source of
 * truth: `tasks/2026-08-14-led-wall-live-source.testplan.md` (portal root),
 * Part C (jsdom/fake-timer traps T1–T10) and Part D (the 24-case matrix).
 * Case 5 (the G2 monotonic-cursor race) is a source-level unit test and
 * lives in `liveSource.test.ts` instead — not reproduced here.
 *
 * Every assertion below is transcribed from the plan, not derived from
 * reading `liveSource.ts`/`wallCore.ts`. A failing case is a bug report.
 *
 * Real timing values throughout (T9): `new LiveLedWallSource(3000)`,
 * `syncIntervalMs={60000}` — the plan's advance values (3000, 614, 60000)
 * assume these, and fake timers make even the 60s ones free.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedWall } from "./LedWall";
import { LiveLedWallSource } from "./liveSource";
import type { WallState } from "./wallCore";

const NOW = 1_780_000_000_000;
const CSE = "Computer Science & Engineering";
// A single fixed re-arrival timestamp, reused wherever the plan's fixtures say
// "T" or "checkedInAt: T" — some cases (case 9) require the FULL and DELTA
// checkedInAt to be byte-identical, so it must be the same literal both places.
const T = 1_780_000_100_000;

// ---------------------------------------------------------------------------
// Shared fixture shapes (Part C)
// ---------------------------------------------------------------------------

interface StubEntry {
  registrationId: number;
  name: string;
  branch: string;
  checkedInAt: number;
  portraitUrl: string | null;
  thumbnailUrl: string | null;
}

type StubEvent =
  | ({ type: "arrival" } & StubEntry & { seq: number })
  | { type: "departure"; seq: number; registrationId: number };

function ENTRY(
  id: number,
  name: string,
  branch: string,
  checkedInAt: number,
  portraitUrl: string | null = null,
  thumbnailUrl: string | null = null,
): StubEntry {
  return { registrationId: id, name, branch, checkedInAt, portraitUrl, thumbnailUrl };
}

function FULL(seq: number, entries: StubEntry[]) {
  return { now: NOW, seq, count: entries.length, entries };
}

function DELTA(seq: number, events: StubEvent[]) {
  return { now: NOW, seq, events };
}

function ARR(
  seq: number,
  id: number,
  name: string,
  branch: string,
  checkedInAt: number,
  portraitUrl: string | null = null,
  thumbnailUrl: string | null = null,
): StubEvent {
  return { type: "arrival", seq, registrationId: id, name, branch, checkedInAt, portraitUrl, thumbnailUrl };
}

function DEP(seq: number, id: number): StubEvent {
  return { type: "departure", seq, registrationId: id };
}

function ok(payload: unknown) {
  return { ok: true, json: async () => payload };
}

function fail(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** `URL_OF(n)` from Part C. */
function urlOf(fetchMock: ReturnType<typeof vi.fn>, n: number): string {
  return fetchMock.mock.calls[n]![0].toString();
}

function mountWall() {
  const states: WallState[] = [];
  const rendered = render(
    <LedWall
      source={new LiveLedWallSource(3000)}
      syncIntervalMs={60000}
      onState={(s) => states.push(s)}
      controls={false}
    />,
  );
  return { states, latest: () => states[states.length - 1]!, container: rendered.container };
}

async function flushMount() {
  // T10: LedWall dispatches PARAMS_CHANGED on mount — one inert extra state
  // emission lands before the first assertion, but no advance is needed for it.
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  // T4: advanceTimersByTimeAsync, never the sync form — fetch resolution is a
  // microtask chain.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LED wall live source — e2e", () => {
  // ---------------------------------------------------------------------
  // Group 1 — wiring & cursor
  // ---------------------------------------------------------------------
  describe("Group 1 — wiring & cursor", () => {
    it("1. mount issues exactly one full-mode request", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(
        ok(FULL(100, [ENTRY(1, "Asha Nair", CSE, NOW, "https://cdn/p/1.webp", "https://cdn/1.jpg")])),
      );
      mountWall();
      await flushMount();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(urlOf(fetchMock, 0)).toContain("/api/public/desk-roster");
      expect(urlOf(fetchMock, 0)).not.toContain("since");
    });

    it("2. snapshot seq becomes first poll's cursor", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(100, [])));
      mountWall();
      await flushMount();

      await advance(3000);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(urlOf(fetchMock, 1)).toContain("since=100");
    });

    it("3. a delta's seq advances the cursor", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(105, [ARR(105, 2, "B", CSE, T)])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(105, [])));
      mountWall();
      await flushMount();

      await advance(3000);
      await advance(3000);

      expect(urlOf(fetchMock, 1)).toContain("since=100");
      expect(urlOf(fetchMock, 2)).toContain("since=105");
    });

    it("4. empty delta holds the cursor", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(100, [])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(100, [])));
      const { states, latest } = mountWall();
      await flushMount();

      await advance(3000);
      await advance(3000);

      expect(urlOf(fetchMock, 1)).toContain("since=100");
      expect(urlOf(fetchMock, 2)).toContain("since=100");
      expect(latest().attendees.size).toBe(0);
      expect(states.some((s) => s.phase === "spotlight")).toBe(false);
    });

    // Case 5 is intentionally excluded — source-level unit test, lives in
    // liveSource.test.ts as the G2 monotonic-cursor regression test.

    it("6. non-200 must not be parsed as a roster", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(
        ok(
          FULL(100, [
            ENTRY(1, "Asha Nair", CSE, NOW, "https://cdn/p/1.webp", "https://cdn/1.jpg"),
            ENTRY(2, "Devika Kurian", CSE, NOW + 1, "https://cdn/p/2.webp", "https://cdn/2.jpg"),
          ]),
        ),
      );
      fetchMock.mockResolvedValueOnce(fail(500));
      const { latest } = mountWall();
      await flushMount();

      await advance(60000);

      expect(latest().attendees.size).toBe(2);
      expect(latest().error).not.toBeNull();
      expect(
        screen.getByText("Last snapshot unavailable. Showing the last known wall."),
      ).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------
  // Group 2 — arrival → spotlight
  // ---------------------------------------------------------------------
  describe("Group 2 — arrival → spotlight", () => {
    it("7. a delta arrival spotlights", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [])));
      fetchMock.mockResolvedValueOnce(
        ok(
          DELTA(101, [
            ARR(101, 5, "Nikhil Babu", CSE, 1_780_000_100_000, "https://cdn/p/5.webp", "https://cdn/5.jpg"),
          ]),
        ),
      );
      const { latest, container } = mountWall();
      await flushMount();

      await advance(3000);
      await advance(614);

      expect(latest().phase).toBe("spotlight");
      expect(latest().spotlight?.id).toBe(5);
      expect(latest().spotlight?.fullName).toBe("Nikhil Babu");
      const img = container.querySelector<HTMLImageElement>(".led-wall-spotlight-card img");
      expect(img?.getAttribute("src")).toBe("https://cdn/p/5.webp");
    });

    it("8. duplicate delivery across two batches spotlights once", async () => {
      const fetchMock = stubFetch();
      const arrival = ARR(101, 5, "Nikhil Babu", CSE, T, "https://cdn/p/5.webp", "https://cdn/5.jpg");
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(101, [arrival])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(101, [arrival])));
      const { states, latest } = mountWall();
      await flushMount();

      await advance(3000);
      await advance(3000);
      await advance(614);

      expect(latest().queue.length).toBe(0);
      expect(latest().attendees.size).toBe(1);
      // "Unchanged across the second delivery": exactly one spotlight-phase
      // transition in the whole run — the duplicate must not add a second one.
      expect(states.filter((s) => s.phase === "spotlight").length).toBe(1);
    });

    it("9. snapshot-known attendee re-delivered as arrival does NOT spotlight (cross-mode equality invariant)", async () => {
      // The full-mode entry and the delta arrival carry the byte-identical
      // checkedInAt (T) — this is the only test in either suite that walks
      // this exact path end-to-end and would catch a full-vs-delta
      // string/number drift in the checkedInAt comparison.
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [ENTRY(5, "Nikhil Babu", CSE, T)])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(101, [ARR(101, 5, "Nikhil Babu", CSE, T)])));
      const { states, latest } = mountWall();
      await flushMount();

      await advance(3000);
      await advance(614);

      expect(states.every((s) => s.phase !== "spotlight")).toBe(true);
      expect(latest().queue.length).toBe(0);
    });

    it("10. genuine re-arrival (newer checkedInAt, same id) DOES spotlight", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [ENTRY(5, "Nikhil Babu", CSE, T)])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(101, [ARR(101, 5, "Nikhil Babu", CSE, T + 60_000)])));
      const { latest } = mountWall();
      await flushMount();

      await advance(3000);
      await advance(614);

      expect(latest().phase).toBe("spotlight");
      expect(latest().spotlight?.id).toBe(5);
    });
  });

  // ---------------------------------------------------------------------
  // Group 3 — departure → resync
  // ---------------------------------------------------------------------
  describe("Group 3 — departure → resync", () => {
    it("11. a departure triggers an immediate full re-sync, well before 60s", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [ENTRY(5, "A", CSE, T), ENTRY(6, "B", CSE, T)])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(102, [DEP(102, 5)])));
      fetchMock.mockResolvedValueOnce(ok(FULL(102, [ENTRY(6, "B", CSE, T)])));
      const { latest } = mountWall();
      await flushMount();

      await advance(3000); // do not approach 60000

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(urlOf(fetchMock, 2)).not.toContain("since");
      expect([...latest().attendees.keys()]).toEqual([6]);
    });

    it("12. departure for an id the wall never held is harmless", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [ENTRY(6, "B", CSE, T)])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(102, [DEP(102, 999)])));
      fetchMock.mockResolvedValueOnce(ok(FULL(102, [ENTRY(6, "B", CSE, T)])));
      const { latest } = mountWall();
      await flushMount();

      await advance(3000);

      expect(latest().error).toBeNull();
      expect([...latest().attendees.keys()]).toEqual([6]);
      expect(fetchMock).toHaveBeenCalledTimes(3); // resync still fires — G4
    });

    it("13. two departures in one batch → exactly one re-sync", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(
        ok(FULL(100, [ENTRY(5, "A", CSE, T), ENTRY(6, "B", CSE, T), ENTRY(7, "C", CSE, T)])),
      );
      fetchMock.mockResolvedValueOnce(ok(DELTA(103, [DEP(102, 5), DEP(103, 6)])));
      fetchMock.mockResolvedValueOnce(ok(FULL(103, [ENTRY(7, "C", CSE, T)])));
      const { latest } = mountWall();
      await flushMount();

      await advance(3000);

      expect(fetchMock).toHaveBeenCalledTimes(3); // not 4
      expect([...latest().attendees.keys()]).toEqual([7]);
    });
  });

  // ---------------------------------------------------------------------
  // Group 4 — same-batch collapse
  // ---------------------------------------------------------------------
  describe("Group 4 — same-batch collapse", () => {
    it("14. arrival-then-departure, same id: never spotlighted", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [])));
      fetchMock.mockResolvedValueOnce(
        ok(DELTA(111, [ARR(110, 8, "Sara Thomas", CSE, T), DEP(111, 8)])),
      );
      fetchMock.mockResolvedValueOnce(ok(FULL(111, [])));
      const { states, latest } = mountWall();
      await flushMount();

      await advance(3000);
      await advance(614);

      expect(states.every((s) => s.spotlight?.id !== 8)).toBe(true);
      expect(states.every((s) => s.queue.every((a) => a.id !== 8))).toBe(true);
      expect(latest().attendees.size).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(3); // one resync
    });

    it("15. departure-then-arrival, same id: IS spotlighted", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [])));
      fetchMock.mockResolvedValueOnce(
        ok(DELTA(111, [DEP(110, 8), ARR(111, 8, "Sara Thomas", CSE, T)])),
      );
      fetchMock.mockResolvedValueOnce(ok(FULL(111, [ENTRY(8, "Sara Thomas", CSE, T)])));
      const { latest } = mountWall();
      await flushMount();

      await advance(3000);
      await advance(614);

      expect(latest().spotlight?.id).toBe(8);
      expect(latest().phase).toBe("spotlight");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("16. mixed batch, different ids", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [ENTRY(5, "A", CSE, T)])));
      fetchMock.mockResolvedValueOnce(
        ok(DELTA(113, [ARR(112, 9, "Nine", CSE, T), DEP(113, 5)])),
      );
      fetchMock.mockResolvedValueOnce(ok(FULL(113, [ENTRY(9, "Nine", CSE, T)])));
      const { latest } = mountWall();
      await flushMount();

      await advance(3000);
      await advance(614);

      expect(latest().spotlight?.id).toBe(9);
      expect([...latest().attendees.keys()]).toEqual([9]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  // ---------------------------------------------------------------------
  // Group 5 — the three photo tiers (rotation cards)
  // ---------------------------------------------------------------------
  describe("Group 5 — the three tiers", () => {
    it("17. cutout wins when both present", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(
        ok(FULL(100, [ENTRY(1, "Asha Nair", CSE, T, "https://cdn/p/1.webp", "https://cdn/1.jpg")])),
      );
      mountWall();
      await flushMount();

      const img = screen.getAllByAltText("Asha Nair")[0]!;
      expect(img.getAttribute("src")).toBe("https://cdn/p/1.webp");
    });

    it("18. no cutout, thumbnail present → thumbnail, no error event needed", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(
        ok(FULL(100, [ENTRY(1, "Asha Nair", CSE, T, null, "https://cdn/1.jpg")])),
      );
      const { container } = mountWall();
      await flushMount();

      const img = screen.getAllByAltText("Asha Nair")[0]!;
      expect(img.getAttribute("src")).toBe("https://cdn/1.jpg");
      expect(container.querySelector(".led-wall-initials")).not.toBeInTheDocument();
    });

    it("19. cutout 404s → falls to thumbnail", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(
        ok(FULL(100, [ENTRY(1, "Asha Nair", CSE, T, "https://cdn/p/1.webp", "https://cdn/1.jpg")])),
      );
      mountWall();
      await flushMount();

      const img = screen.getAllByAltText("Asha Nair")[0]!;
      fireEvent.error(img);

      expect(img.getAttribute("src")).toBe("https://cdn/1.jpg");
    });

    it("20. both fail → initials", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(
        ok(FULL(100, [ENTRY(1, "Asha Nair", CSE, T, "https://cdn/p/1.webp", "https://cdn/1.jpg")])),
      );
      mountWall();
      await flushMount();

      // Scoped to the one card whose img we manipulate — layout.ts (T1)
      // repeats/self-concatenates the strip, so sibling copies of the same
      // attendee are separate Polaroid instances with their own tier state
      // and would still show a portrait if we asserted globally.
      const img = screen.getAllByAltText("Asha Nair")[0]!;
      const card = img.closest(".led-wall-polaroid") as HTMLElement;
      fireEvent.error(img);
      const imgAfterFirstError = card.querySelector("img")!;
      fireEvent.error(imgAfterFirstError);

      expect(card.querySelector("img.led-wall-polaroid__portrait")).not.toBeInTheDocument();
      expect(within(card).getByText("AN")).toBeInTheDocument();
    });

    it("21. both null → initials immediately, no img requested", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [ENTRY(1, "Asha Nair", CSE, T, null, null)])));
      mountWall();
      await flushMount();

      expect(screen.queryByAltText("Asha Nair")).not.toBeInTheDocument();
      expect(screen.getAllByText("AN").length).toBeGreaterThan(0);
    });

    it("22. tier state resets when the slot's attendee changes", async () => {
      // pollIntervalMs=3000 and syncIntervalMs=60000 are both real, and
      // 3000 × 20 = 60000: LiveLedWallSource's own delta-poll interval and
      // useLedWallSource's full-mode resync interval are both live by the
      // time we advance 60000ms, and they coincide at the exact same virtual
      // millisecond. A plain sequential mockResolvedValueOnce queue can't
      // tell which of the two concurrent callers is asking, so whichever
      // fires first at the tie (empirically, the poll) steals the stub meant
      // for the other — a test-harness collision, not a source bug: a real
      // server answers each request per its own `since` param, never a
      // shared FIFO. Route by request shape instead of call order.
      const fetchMock = stubFetch();
      const X = "https://cdn/p/1.webp";
      const Y = "https://cdn/1.jpg";
      const Z = "https://cdn/p/2.webp";
      const W = "https://cdn/2.jpg";
      let fullCalls = 0;
      fetchMock.mockImplementation(async (input: string) => {
        if (input.includes("since=")) return ok(DELTA(102, [])); // idle poll ticks — harmless
        fullCalls += 1;
        return fullCalls === 1
          ? ok(FULL(100, [ENTRY(1, "Asha Nair", CSE, T, X, Y)]))
          : ok(FULL(102, [ENTRY(2, "Devika Kurian", CSE, T + 1, Z, W)]));
      });
      mountWall();
      await flushMount();

      const img1 = screen.getAllByAltText("Asha Nair")[0]!;
      const card1 = img1.closest(".led-wall-polaroid") as HTMLElement;
      fireEvent.error(img1);
      fireEvent.error(card1.querySelector("img")!);
      expect(within(card1).getByText("AN")).toBeInTheDocument();

      await advance(60000);

      const img2 = screen.getAllByAltText("Devika Kurian")[0]!;
      expect(img2.getAttribute("src")).toBe(Z);
    });
  });

  // ---------------------------------------------------------------------
  // Group 6 — failure & recovery
  // ---------------------------------------------------------------------
  describe("Group 6 — failure & recovery", () => {
    it("23. first snapshot fails; recovers on the next 60s tick (proves the poll gate exists)", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockRejectedValueOnce(new Error("network"));
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [ENTRY(1, "Asha Nair", CSE, T)])));
      fetchMock.mockResolvedValueOnce(ok(DELTA(100, [])));
      const { latest } = mountWall();
      await flushMount();

      expect(latest().phase).toBe("idle");
      expect(latest().error).not.toBeNull();
      expect(
        screen.getByText("Last snapshot unavailable. Showing the last known wall."),
      ).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1); // no poll started — G3

      await advance(60000);
      expect(latest().error).toBeNull();
      expect(latest().attendees.size).toBe(1);

      await advance(3000);
      expect(urlOf(fetchMock, 2)).toContain("since=100");
    });

    it("24. a delta poll rejects; cursor holds and next poll retries", async () => {
      const fetchMock = stubFetch();
      fetchMock.mockResolvedValueOnce(ok(FULL(100, [ENTRY(1, "Asha Nair", CSE, T)])));
      fetchMock.mockRejectedValueOnce(new Error("boom"));
      fetchMock.mockResolvedValueOnce(ok(DELTA(105, [])));
      const { latest } = mountWall();
      await flushMount();

      await advance(3000); // the failed poll — swallowed
      await advance(3000); // the retry

      expect(latest().attendees.size).toBe(1); // a failed delta must not set state.error
      expect(urlOf(fetchMock, 2)).toContain("since=100"); // unchanged
    });
  });
});
