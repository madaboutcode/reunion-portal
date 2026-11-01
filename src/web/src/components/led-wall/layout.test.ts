import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "./defaults";
import { computeLayout } from "./layout";
import { getBranchInfo } from "./branchCatalog";
import type { PresentAttendee } from "./types";

const VIEWPORT = { w: 1280, h: 720 };
const BRANCH = getBranchInfo("Computer Science & Engineering");

function makeAttendees(count: number): PresentAttendee[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    fullName: `Person ${i + 1}`,
    branch: "Computer Science & Engineering",
    portraitUrl: i % 5 === 0 ? null : `https://cdn.example.test/portraits/${i + 1}.webp`,
    thumbnailUrl: null,
    checkedInAt: 1_780_000_000_000 + i * 1000,
  }));
}

/** Visit every numeric leaf in the tree; paths look like "rows[0].items[0].width". */
function walkNumbers(
  node: unknown,
  visit: (value: number, path: string) => void,
  path = "",
): void {
  if (node === null || node === undefined) return;
  if (typeof node === "number") {
    visit(node, path);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkNumbers(v, visit, `${path}[${i}]`));
    return;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      walkNumbers(value, visit, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * Fields that are offsets or angles, not sizes — the mockup lets them go
 * negative by design (card tilt, vertical float allowance, quote tilt,
 * backdrop % offsets, confetti horizontal drift, logo offset).
 */
const NEGATIVE_OK = new Set([
  "rotation",
  "marginTop",
  "qRot",
  "qSkew",
  "tapeR",
  "logoX",
  "dx",
]);

function collectBadNumbers(tree: unknown): { path: string; value: number }[] {
  const bad: { path: string; value: number }[] = [];
  walkNumbers(tree, (value, path) => {
    if (!Number.isFinite(value)) {
      bad.push({ path, value });
      return;
    }
    const segments = path.split(".");
    const last = segments[segments.length - 1];
    const backdropOffset =
      segments[0] === "backdrop" && (last === "x" || last === "y");
    if (value < 0 && !NEGATIVE_OK.has(last) && !backdropOffset) {
      bad.push({ path, value });
    }
  });
  return bad;
}

describe("computeLayout", () => {
  it("is deterministic across identical inputs", () => {
    const a = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(9));
    const b = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(9));
    expect(a).toEqual(b);
  });

  it("produces no NaN anywhere in the tree", () => {
    const tree = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(9));
    const bad = collectBadNumbers(tree).filter((e) => !Number.isFinite(e.value));
    expect(bad).toEqual([]);
  });

  it("produces no negative sizes anywhere in the tree", () => {
    const tree = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(9));
    expect(collectBadNumbers(tree)).toEqual([]);
  });

  it("scales the card count with the attendee count", () => {
    const many = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(10));

    expect(many.rows).toHaveLength(DEFAULT_PARAMS.rows);
    // Ten attendees already make one half wider than the wall.
    expect(many.rows[0].items).toHaveLength(20);
    expect(many.rows[1].items).toHaveLength(20);
  });

  it("repeats a short attendee list until one half fills the wall", () => {
    const tree = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(1));
    const half = tree.rows[0].items.slice(0, tree.rows[0].items.length / 2);
    const halfWidth = half.reduce((sum, card) => sum + card.width + DEFAULT_PARAMS.stripGap, 0);

    expect(halfWidth).toBeGreaterThanOrEqual(tree.wall.w);
    expect(tree.rows[0].items.length).toBeGreaterThan(2);
  });

  it("places the mockup's graphic doodles deterministically", () => {
    const tree = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(9));

    expect(tree.decor.sparkles).toHaveLength(11);
    expect(tree.decor.arrows).toHaveLength(2);
    expect(tree.decor.rules).toHaveLength(1);
    expect(tree.decor).toEqual(
      computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(9)).decor,
    );
  });

  it("moves the first row down with a larger top inset while keeping row heights positive", () => {
    const base = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(9));
    const padded = computeLayout(
      { ...DEFAULT_PARAMS, stripTopPad: DEFAULT_PARAMS.stripTopPad + 32 },
      VIEWPORT,
      BRANCH,
      makeAttendees(9),
    );

    expect(padded.rows[0].top).toBeGreaterThan(base.rows[0].top);
    expect(padded.rows[1]!.top - padded.rows[0]!.top).toBeGreaterThan(DEFAULT_PARAMS.stripGap);
    expect(padded.rows.every((row) => row.items.every((card) => card.width > 0))).toBe(true);
  });

  it("renders empty rows for no attendees without crashing", () => {
    const tree = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, []);

    expect(tree.rows).toHaveLength(DEFAULT_PARAMS.rows);
    for (const row of tree.rows) {
      expect(row.items).toEqual([]);
    }
    // empty strip still gets a minimum drift duration, not NaN
    expect(tree.rows[0].duration).toBe(8);
    expect(tree.rows[0].anim).toBe("driftL 8s linear infinite");
  });

  it("clamps each card to the available row height", () => {
    const padY = Math.round(VIEWPORT.h * 0.035);
    const rowH =
      (VIEWPORT.h -
        DEFAULT_PARAMS.stripTopPad -
        padY -
        DEFAULT_PARAMS.stripGap * (DEFAULT_PARAMS.rows - 1)) /
      DEFAULT_PARAMS.rows;

    const tree = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, makeAttendees(9));

    for (const row of tree.rows) {
      for (const card of row.items) {
        // The photo, mat, and both caption lines fit the strip's row height.
        const caption = card.nameSize * 1.05 + 3 + card.subSize * 1.2;
        const body = card.photoHeight + card.mat + card.matBottom + card.capPad + caption;
        expect(body).toBeLessThanOrEqual(rowH);
        // The photo is clamped after reserving the caption budget.
        const maxPhoto = rowH - card.mat - card.matBottom - card.capPad - caption;
        expect(card.photoHeight).toBeLessThanOrEqual(Math.ceil(maxPhoto));
      }
    }
  });

  it("stays finite and non-negative under degenerate (out-of-range) params", () => {
    const params = { ...DEFAULT_PARAMS, rows: 20, stripGap: 70, printScale: 0.5 };
    const tree = computeLayout(params, { w: 800, h: 360 }, BRANCH, makeAttendees(4));

    expect(tree.rows).toHaveLength(20);
    expect(collectBadNumbers(tree)).toEqual([]);
  });
});
