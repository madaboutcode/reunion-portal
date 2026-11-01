import type { LedWallDataSource, PresentAttendee } from "./types";

interface FixtureEntry {
  id: number;
  fullName: string;
  branch: string;
  hasPortrait: boolean;
  hasThumbnail: boolean;
}

const FIXTURE_ENTRIES: FixtureEntry[] = [
  ["Asha Nair", "Architecture"],
  ["Devika Kurian", "Architecture"],
  ["Milan Varma", "Architecture"],
  ["Nived Thomas", "Architecture"],
  ["Rhea Mathew", "Architecture"],
  ["Ishan Pillai", "Chemical Engineering"],
  ["Tara Balan", "Chemical Engineering"],
  ["Kiran Soman", "Chemical Engineering"],
  ["Maya Joseph", "Chemical Engineering"],
  ["Neil Kurup", "Chemical Engineering"],
  ["Akhil Dev", "Civil Engineering"],
  ["Lina Menon", "Civil Engineering"],
  ["Joel Ninan", "Civil Engineering"],
  ["Mira Paul", "Civil Engineering"],
  ["Rohan Iype", "Civil Engineering"],
  ["Aditi Bose", "Computer Science & Engineering"],
  ["Nikhil Babu", "Computer Science & Engineering"],
  ["Sara Thomas", "Computer Science & Engineering"],
  ["Arun Koshy", "Computer Science & Engineering"],
  ["Ira George", "Computer Science & Engineering"],
  ["Varun Das", "Electrical & Electronics Engineering"],
  ["Mia Raju", "Electrical & Electronics Engineering"],
  ["Eshan Roy", "Electrical & Electronics Engineering"],
  ["Anya Philip", "Electrical & Electronics Engineering"],
  ["Kavi Reji", "Electrical & Electronics Engineering"],
  ["Ravi Jose", "Electronics & Communication Engineering"],
  ["Nora Mathew", "Electronics & Communication Engineering"],
  ["Vishnu Lal", "Electronics & Communication Engineering"],
  ["Eli Thomas", "Electronics & Communication Engineering"],
  ["Maya Roy", "Electronics & Communication Engineering"],
  ["Adarsh Nair", "Mechanical Engineering"],
  ["Leah Biju", "Mechanical Engineering"],
  ["Rishi Paul", "Mechanical Engineering"],
  ["Nina Das", "Mechanical Engineering"],
  ["Owen Kurian", "Mechanical Engineering"],
  ["Aman Jose", "Production Engineering"],
  ["Diya Suresh", "Production Engineering"],
  ["Jai Menon", "Production Engineering"],
  ["Laya Balan", "Production Engineering"],
  ["Noel Varghese", "Production Engineering"],
].map(([fullName, branch], index) => ({
  // 1093 is not a published portrait; use the verified 1179 registration for
  // this fabricated fixture slot instead.
  id: index === 13 ? 1179 : 1080 + index,
  fullName,
  branch,
  // Three photo tiers exercised across the fixture: index 0 (Asha Nair) is
  // thumbnail-only (a desk walk-in with no cutout); index 5 (Ishan Pillai)
  // has neither and falls back to initials; everyone else gets both.
  hasPortrait: index !== 0 && index !== 5,
  hasThumbnail: index !== 5,
}));

const INITIAL_PRESENT_COUNT_PER_BRANCH = 2;
const PORTRAIT_BASE_URL = `${__CDN_URL__}/portraits`;
const THUMBNAIL_BASE_URL = __CDN_URL__;

function toAttendee(entry: FixtureEntry, index: number): PresentAttendee {
  return {
    id: entry.id,
    fullName: entry.fullName,
    branch: entry.branch,
    portraitUrl: entry.hasPortrait ? `${PORTRAIT_BASE_URL}/${entry.id}.webp` : null,
    thumbnailUrl: entry.hasThumbnail ? `${THUMBNAIL_BASE_URL}/${entry.id}.jpg` : null,
    checkedInAt: 1_780_000_000_000 + index * 1_000,
  };
}

const FIXTURE = FIXTURE_ENTRIES.map(toAttendee);

export const MOCK_FIXTURE: readonly PresentAttendee[] = FIXTURE;

export class MockLedWallSource implements LedWallDataSource {
  private readonly attendees: readonly PresentAttendee[];
  private readonly initialPresentIds: ReadonlySet<number>;
  private readonly presentIds: Set<number>;
  private readonly currentAttendees = new Map<number, PresentAttendee>();
  private readonly subscribers = new Set<(attendee: PresentAttendee) => void>();
  private recycleGeneration = 0;

  constructor(fixture: readonly PresentAttendee[] = MOCK_FIXTURE) {
    this.attendees = fixture;
    this.presentIds = new Set(
      fixture
        .filter((_, index) => index % 5 < INITIAL_PRESENT_COUNT_PER_BRANCH)
        .map((attendee) => attendee.id),
    );
    this.initialPresentIds = new Set(this.presentIds);
    for (const attendee of fixture) {
      if (this.presentIds.has(attendee.id)) this.currentAttendees.set(attendee.id, attendee);
    }
  }

  getSnapshot(): Promise<PresentAttendee[]> {
    return Promise.resolve(
      this.attendees
        .filter((attendee) => this.presentIds.has(attendee.id))
        .map((attendee) => this.currentAttendees.get(attendee.id) ?? attendee),
    );
  }

  subscribe(onArrival: (attendee: PresentAttendee) => void): () => void {
    this.subscribers.add(onArrival);
    return () => this.subscribers.delete(onArrival);
  }

  /** Inject a random absent fixture attendee, recycling the present set when exhausted. */
  inject(): PresentAttendee | null {
    let absent = this.attendees.filter((attendee) => !this.presentIds.has(attendee.id));
    if (absent.length === 0) {
      // Reconcile the source's current set before starting a new check-in cycle.
      this.presentIds.clear();
      this.currentAttendees.clear();
      for (const attendee of this.attendees) {
        if (this.initialPresentIds.has(attendee.id)) {
          this.presentIds.add(attendee.id);
          this.currentAttendees.set(attendee.id, attendee);
        }
      }
      this.recycleGeneration += 1;
      absent = this.attendees.filter((attendee) => !this.presentIds.has(attendee.id));
    }

    const index = Math.min(absent.length - 1, Math.floor(Math.random() * absent.length));
    const fixtureAttendee = absent[index];
    if (!fixtureAttendee) return null;
    const attendee = this.recycleGeneration === 0
      ? fixtureAttendee
      : { ...fixtureAttendee, checkedInAt: fixtureAttendee.checkedInAt + this.recycleGeneration * 1_000_000 };
    this.presentIds.add(attendee.id);
    this.currentAttendees.set(attendee.id, attendee);
    for (const subscriber of this.subscribers) subscriber(attendee);
    return attendee;
  }

  /** Remove a random present attendee without emitting an arrival event. */
  removeRandom(): PresentAttendee | null {
    const present = this.attendees
      .filter((attendee) => this.presentIds.has(attendee.id))
      .map((attendee) => this.currentAttendees.get(attendee.id) ?? attendee);
    if (present.length === 0) return null;

    const index = Math.min(present.length - 1, Math.floor(Math.random() * present.length));
    const attendee = present[index];
    if (!attendee) return null;
    this.presentIds.delete(attendee.id);
    this.currentAttendees.delete(attendee.id);
    return attendee;
  }

  presentCount(): number {
    return this.presentIds.size;
  }

  /**
   * Swap this branch's currently-present members for its other fixture
   * members of the same branch — silent, no arrival event (mirrors the rule
   * that snapshots never feed the spotlight queue; the periodic re-sync
   * picks this up). No-ops if the branch has no absent alternates.
   */
  replaceBranch(branch: string): void {
    const presentInBranch = this.attendees.filter(
      (attendee) => attendee.branch === branch && this.presentIds.has(attendee.id),
    );
    const absentInBranch = this.attendees.filter(
      (attendee) => attendee.branch === branch && !this.presentIds.has(attendee.id),
    );
    if (absentInBranch.length === 0) return;

    for (const attendee of presentInBranch) {
      this.presentIds.delete(attendee.id);
      this.currentAttendees.delete(attendee.id);
    }
    const replacements = absentInBranch.slice(0, Math.max(presentInBranch.length, 1));
    for (const attendee of replacements) {
      this.presentIds.add(attendee.id);
      this.currentAttendees.set(attendee.id, attendee);
    }
  }

  /** Empty the present set — silent, no arrival event; drives the wall to idle on the next re-sync. */
  clear(): void {
    this.presentIds.clear();
    this.currentAttendees.clear();
  }

  /**
   * Silently set a branch's present count to exactly `count`, clamped to
   * [0, branch total] — same silent contract as `replaceBranch`/`clear`, no
   * subscriber notified. Growing adds absent members of that branch in
   * fixture order; shrinking removes present members from the end of
   * fixture order, keeping the earliest ones.
   */
  setBranchCount(branch: string, count: number): void {
    const branchAttendees = this.attendees.filter((attendee) => attendee.branch === branch);
    const clamped = Math.max(0, Math.min(count, branchAttendees.length));
    const present = branchAttendees.filter((attendee) => this.presentIds.has(attendee.id));

    if (clamped > present.length) {
      const absent = branchAttendees.filter((attendee) => !this.presentIds.has(attendee.id));
      for (const attendee of absent.slice(0, clamped - present.length)) {
        this.presentIds.add(attendee.id);
        this.currentAttendees.set(attendee.id, attendee);
      }
    } else if (clamped < present.length) {
      for (const attendee of present.slice(clamped)) {
        this.presentIds.delete(attendee.id);
        this.currentAttendees.delete(attendee.id);
      }
    }
  }

  /**
   * One entry per branch, ordered by first fixture appearance, with that
   * branch's total fixture count and current present count. Drives the
   * per-branch slider UI.
   */
  branchSummaries(): { branch: string; total: number; present: number }[] {
    const order: string[] = [];
    const totals = new Map<string, number>();
    const presentCounts = new Map<string, number>();
    for (const attendee of this.attendees) {
      if (!totals.has(attendee.branch)) {
        order.push(attendee.branch);
        totals.set(attendee.branch, 0);
        presentCounts.set(attendee.branch, 0);
      }
      totals.set(attendee.branch, totals.get(attendee.branch)! + 1);
      if (this.presentIds.has(attendee.id)) {
        presentCounts.set(attendee.branch, presentCounts.get(attendee.branch)! + 1);
      }
    }
    return order.map((branch) => ({ branch, total: totals.get(branch)!, present: presentCounts.get(branch)! }));
  }
}

export function createMockSource(): MockLedWallSource {
  return new MockLedWallSource();
}

export const mockSource = createMockSource();
