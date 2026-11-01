import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PricingSummary } from "@/components/ui/PricingSummary";
import { createInitialData } from "@/lib/pricing";
import type { WizardDraft } from "@smriti/shared";

// ── Two-tier child pricing fixtures ──────────────────────────────────────────
// Tier boundary constants (from PRICING_DEFAULTS in constants.ts):
//   childFreeAgeThreshold = 6  → under-6 are free
//   accommodationChildBedAge  = 12 → 6–12 pay child rate, 12+ pay adult rate
//
// Full Celebration food rates:
//   Under 6:  free (fee: 0, free: true)
//   6–12:     ₹1,455 (childFee6to12 = 50% of adult ₹2,910)
//   12+:      ₹2,910 (childFee12plus = adult rate)
//
// Accommodation charges (private room, per night):
//   Under 6:  free line item (fee: 0, free: true)
//   6–12:     ₹1,000 (accommodationChild6to12Fee)
//   12+:      extra bed auto-added by toRegistration (age > accommodationChildBedAge)

function under6PrivateRoomDraft(): WizardDraft {
  // Child age 4, private room, 1 night
  // toRegistration: hasOver12Child=false, totalOccupants=1 (under-6 excluded from count)
  //   → extraBed stays false → no extra bed line
  // Expected lines: room ₹12,000, child-4 accommodation Free, GST 18% of 12,000 = ₹2,160
  // Food: child-4 is free → one food "Free" + one accommodation "Free"
  return {
    ...createInitialData(),
    fullName: "Test Alumni",
    alumniMeal: "veg",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    accommodation: "private",
    extraBed: false,
    checkIn: "2026-08-15",
    checkOut: "2026-08-16",
    children: [{ id: "c1", name: "Tiny", age: 4, meal: "veg" }],
    donationAmount: "0",
  };
}

function child8FullCelebrationDraft(): WizardDraft {
  // Child age 8, full celebration, no accommodation
  // Expected food line: ₹1,455 (6–12 tier)
  return {
    ...createInitialData(),
    fullName: "Test Alumni",
    alumniMeal: "veg",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    accommodation: "none",
    extraBed: false,
    checkIn: "",
    checkOut: "",
    children: [{ id: "c1", name: "Mid", age: 8, meal: "veg" }],
    donationAmount: "0",
  };
}

function child14FullCelebrationDraft(): WizardDraft {
  // Child age 14, full celebration, no accommodation
  // Expected food line: ₹2,910 (12+ tier = adult rate)
  return {
    ...createInitialData(),
    fullName: "Test Alumni",
    alumniMeal: "veg",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    accommodation: "none",
    extraBed: false,
    checkIn: "",
    checkOut: "",
    children: [{ id: "c1", name: "Teen", age: 14, meal: "veg" }],
    donationAmount: "0",
  };
}

function mixedChildrenPrivateRoomDraft(): WizardDraft {
  // 3 children: age 4 (free food + free accommodation), age 10 (₹1,455 food + ₹1,000
  // accommodation), age 14 (₹2,910 food + auto extra bed ₹1,500)
  // toRegistration: hasOver12Child=true → extraBed forced true
  // Accommodation subtotal: 12,000 + 1,000 + 1,500 = 14,500 → GST 18% = ₹2,610
  return {
    ...createInitialData(),
    fullName: "Test Alumni",
    alumniMeal: "veg",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    accommodation: "private",
    extraBed: false, // auto-set true by toRegistration (age-14 child)
    checkIn: "2026-08-15",
    checkOut: "2026-08-16",
    children: [
      { id: "c1", name: "Baby", age: 4, meal: "veg" },
      { id: "c2", name: "Junior", age: 10, meal: "veg" },
      { id: "c3", name: "Teen", age: 14, meal: "veg" },
    ],
    donationAmount: "0",
  };
}

afterEach(cleanup);

// ── §7 family scenario ────────────────────────────────────────────────────
// Private room, 1 night (Aug-15 → Aug-16)
// Children: age 8 (₹1,000 child charge) + age 14 (auto extra bed ₹1,500)
// extraBed: false in draft — toRegistration auto-sets true for >12 child
// Expected accommodation lines: ₹12,000 + ₹1,000 + ₹1,500 = ₹14,500
// GST 18% on 14,500 = ₹2,610
// Total accommodation = ₹17,110

function familyDraft(): WizardDraft {
  return {
    ...createInitialData(),
    fullName: "Test Alumni",
    alumniMeal: "veg",
    attendanceIntent: "attending",
    accommodation: "private",
    extraBed: false, // auto-set true by toRegistration because of age-14 child
    checkIn: "2026-08-15",
    checkOut: "2026-08-16",
    children: [
      { id: "c1", name: "Child A", age: 8, meal: "veg" },
      { id: "c2", name: "Child B", age: 14, meal: "veg" },
    ],
    donationAmount: "0",
  };
}

// ── §7 solo shared_double scenario ─────────────────────────────────────────
// Shared double, 1 night (Aug-15 → Aug-16)
// Expected: ₹6,000 + GST ₹1,080 = ₹7,080
// Breakfast note: "Breakfast for 1" (shared is per head — booker's own breakfast)

function soloSharedDoubleDraft(): WizardDraft {
  return {
    ...createInitialData(),
    fullName: "Solo Alumni",
    alumniMeal: "veg",
    attendanceIntent: "attending",
    accommodation: "shared_double",
    extraBed: false,
    checkIn: "2026-08-15",
    checkOut: "2026-08-16",
    children: [],
    donationAmount: "0",
  };
}

describe("PricingSummary — two-tier child pricing rendering", () => {
  // ── Test 1 ────────────────────────────────────────────────────────────────
  // Spec guarantee: under-6 child in private room → pricing engine emits
  // fee:0, free:true for the accommodation line → component renders "Free"
  // not a rupee amount for that line.
  //
  // Generator exploit caught: a generator might always render formatINR(0) = "₹0"
  // for zero-fee lines instead of "Free", or might omit the line entirely.
  it("under-6 child with private room: accommodation line renders 'Free' not a rupee amount", () => {
    render(<PricingSummary data={under6PrivateRoomDraft()} />);

    // The accommodation label for the under-6 child must appear
    // Pricing engine label: `${c.name} (${age} yrs) — accommodation`
    expect(screen.getByText("Tiny (4 yrs) — accommodation")).toBeInTheDocument();

    // The value for that line must be "Free" — not "₹0" or missing
    // There are two "Free" occurrences: one for food, one for accommodation.
    // We assert at least 2 "Free" texts exist.
    const freeElements = screen.getAllByText("Free");
    expect(freeElements.length).toBeGreaterThanOrEqual(2);

    // "₹0" must NOT appear — the component must not fall through to formatINR
    expect(screen.queryByText("₹0")).not.toBeInTheDocument();

    // Room itself is not free
    expect(screen.getByText("₹12,000")).toBeInTheDocument();

    // GST: 18% of 12,000 (no child charge, no extra bed) = ₹2,160
    expect(screen.getByText("₹2,160")).toBeInTheDocument();
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  // Spec guarantee: child age 8 (6–12 tier) in full_celebration →
  // food line fee = ₹1,455 (50% of adult ₹2,910), NOT ₹2,910.
  //
  // Generator exploit caught: a generator might apply the full adult rate
  // for all children regardless of tier, rendering ₹2,910 for an age-8 child.
  it("child age 8, full celebration: food line renders ₹1,455 not ₹2,910", () => {
    render(<PricingSummary data={child8FullCelebrationDraft()} />);

    // The food line label
    expect(screen.getByText("Mid (8 yrs) · Lunch & Dinner")).toBeInTheDocument();

    // Must show the 6–12 tier rate
    expect(screen.getByText("₹1,455")).toBeInTheDocument();

    // Must NOT show the adult rate for this child
    expect(screen.queryByText("₹2,910")).not.toBeInTheDocument();
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  // Spec guarantee: child age 14 (12+ tier) in full_celebration →
  // food line fee = ₹2,910 (adult rate).
  //
  // Generator exploit caught: a generator might cap all children at the 6–12
  // rate, rendering ₹1,455 for an age-14 child.
  it("child age 14, full celebration: food line renders ₹2,910 (adult rate)", () => {
    render(<PricingSummary data={child14FullCelebrationDraft()} />);

    // The food line label
    expect(screen.getByText("Teen (14 yrs) · Lunch & Dinner")).toBeInTheDocument();

    // Must show adult rate
    expect(screen.getByText("₹2,910")).toBeInTheDocument();

    // Must NOT show the 6–12 half-rate
    expect(screen.queryByText("₹1,455")).not.toBeInTheDocument();
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  // Spec guarantee (comprehensive): mixed family with children of all three
  // age tiers renders each tier's food and accommodation charge correctly.
  //   - Child 4: food Free + accommodation Free
  //   - Child 10: food ₹1,455 + accommodation ₹1,000
  //   - Child 14: food ₹2,910 + extra bed ₹1,500 (auto-set by toRegistration)
  //
  // Generator exploit caught: a generator that misclassifies one tier while
  // getting the others right, or one that doesn't emit the free lines at all.
  it("mixed family (age 4 / 10 / 14), private room: each tier renders correct food and accommodation charges", () => {
    render(<PricingSummary data={mixedChildrenPrivateRoomDraft()} />);

    // ── Food lines ────────────────────────────────────────────────────────

    // Child 4: free food
    expect(screen.getByText("Baby (4 yrs) · Lunch & Dinner")).toBeInTheDocument();

    // Child 10: 6–12 tier food
    expect(screen.getByText("Junior (10 yrs) · Lunch & Dinner")).toBeInTheDocument();
    expect(screen.getByText("₹1,455")).toBeInTheDocument();

    // Child 14: adult-rate food
    expect(screen.getByText("Teen (14 yrs) · Lunch & Dinner")).toBeInTheDocument();
    expect(screen.getByText("₹2,910")).toBeInTheDocument();

    // ── Accommodation lines ───────────────────────────────────────────────

    // Room base
    expect(screen.getByText("Accommodation — Private Room · 1 night")).toBeInTheDocument();
    expect(screen.getByText("₹12,000")).toBeInTheDocument();

    // Child 4: free accommodation
    expect(screen.getByText("Baby (4 yrs) — accommodation")).toBeInTheDocument();

    // Child 10: ₹1,000 child accommodation charge
    expect(screen.getByText("Junior (10 yrs) — accommodation")).toBeInTheDocument();
    expect(screen.getByText("₹1,000")).toBeInTheDocument();

    // Child 14: auto extra bed (age > 12)
    expect(screen.getByText("Extra bed · 1 night")).toBeInTheDocument();
    expect(screen.getByText("₹1,500")).toBeInTheDocument();

    // GST: 18% of (12,000 + 1,000 + 1,500) = 18% of 14,500 = ₹2,610
    expect(screen.getByText("GST (18%) — accommodation")).toBeInTheDocument();
    expect(screen.getByText("₹2,610")).toBeInTheDocument();

    // ── Free text count ───────────────────────────────────────────────────
    // Child 4 food = 1 "Free", Child 4 accommodation = 1 "Free" → exactly 2
    const freeElements = screen.getAllByText("Free");
    expect(freeElements).toHaveLength(2);

    // "₹0" must not appear for any free line
    expect(screen.queryByText("₹0")).not.toBeInTheDocument();
  });
});

describe("PricingSummary — accommodation scenarios", () => {
  it("family private room: renders §7 accommodation lines (₹12,000 + ₹1,000 + ₹1,500 + ₹2,610 GST)", () => {
    render(<PricingSummary data={familyDraft()} />);

    // Private room line
    expect(screen.getByText("Accommodation — Private Room · 1 night")).toBeInTheDocument();
    expect(screen.getByText("₹12,000")).toBeInTheDocument();

    // Child 6–12 accommodation charge (age 8)
    expect(screen.getByText("Child A (8 yrs) — accommodation")).toBeInTheDocument();
    expect(screen.getByText("₹1,000")).toBeInTheDocument();

    // Extra bed (auto-on for age-14 child)
    expect(screen.getByText("Extra bed · 1 night")).toBeInTheDocument();
    expect(screen.getByText("₹1,500")).toBeInTheDocument();

    // GST line = 18% of (12,000 + 1,000 + 1,500) = 18% of 14,500 = 2,610
    expect(screen.getByText("GST (18%) — accommodation")).toBeInTheDocument();
    expect(screen.getByText("₹2,610")).toBeInTheDocument();
  });

  it("solo shared_double: renders ₹6,000, GST line, and breakfast note 'Breakfast for 1' (per head)", () => {
    render(<PricingSummary data={soloSharedDoubleDraft()} />);

    // Room line
    expect(screen.getByText("₹6,000")).toBeInTheDocument();

    // GST 18% of 6,000 = 1,080
    expect(screen.getByText("₹1,080")).toBeInTheDocument();

    // Breakfast note — shared is per head, so the booker gets breakfast for 1
    expect(screen.getByText(/Breakfast for 1/)).toBeInTheDocument();
  });
});
