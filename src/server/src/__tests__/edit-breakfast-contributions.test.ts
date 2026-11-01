/**
 * Spec enforcement tests — EditService persistence of breakfast add-on and
 * contribution splits fields.
 *
 * Boundary: EditService.edit() — the service layer is the consumer-facing
 * boundary staff routes call (same framing as staff-edit-archive.test.ts).
 * Tests feed edit() a fields patch and assert on the persisted, reloaded
 * registration it returns — the only way a caller can observe whether
 * buildDbUpdate() actually wrote a field to the repository.
 *
 * =============================================================================
 * Gap Analysis — why this file exists as a separate harness
 * =============================================================================
 *
 * THEME: The InMemoryRegistrationRepo in staff-edit-archive.test.ts has an
 * `update()` that does NOT map `contribution_splits`, `breakfast_adult`,
 * `breakfast_child`, `accommodation`, `check_in`/`check_out`, or several other
 * RegistrationUpdate keys onto the in-memory Registration object (it only
 * handles a subset: full_name, email, whatsapp, country, donation_amount,
 * attendance_intent, participation_type, accommodation, check_in, check_out,
 * extra_bed, total_amount, pricing_snapshot — contribution_splits and
 * breakfast are absent). Reusing that fake here would make a persistence bug
 * invisible: buildDbUpdate() could correctly include contribution_splits in
 * the RegistrationUpdate object, and the test would still see an empty
 * `{}` back from the repo, because the repo fake silently drops the field —
 * a "silent stub erasing the side effect" per the mocking rules. This file
 * defines its own repo fake with a complete `update()` mapping, so a real
 * regression in buildDbUpdate() is what causes these tests to fail — not an
 * incomplete fake.
 *
 * INDIVIDUAL GAP (unresolved — flagging): There is no server-side or Zod
 * schema validation on breakfastAdult/breakfastChild (checked
 * registration-schema.ts, validation.ts, and the edit route body parsing at
 * staff.routes.ts — the route only checks `typeof fields['breakfastAdult']
 * === 'number'`, no min/integer/max constraint). A negative value like -5
 * would pass through applyFields/buildDbUpdate and persist as -5, and
 * pricing.ts's `breakfastAdult && breakfastAdult > 0` guard would silently
 * skip the fee line (rather than rejecting the input). This is a real gap
 * in input validation, not a classifier/persistence bug — flagging it rather
 * than writing a test that would require inventing the "correct" rejection
 * behavior the spec doesn't define.
 *
 * @module edit-breakfast-contributions.test
 */

import { describe, it, expect } from "vitest";
import type { PricingBreakup } from "@smriti/shared";
import type {
  Registration,
  RegistrationUpdate,
  RegistrationFilters,
  Attendee,
  NewAttendee,
  Payment,
  NewPayment,
  GatewayData,
  AuditEntry,
  NewAuditEntry,
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  IEmailService,
} from "../repositories/interfaces.js";
import { EditService, type EditRegistrationRequest } from "../services/edit.service.js";
import { NotFoundError } from "../services/errors.js";

// =============================================================================
// Complete in-memory registration repo — maps EVERY RegistrationUpdate key.
// See gap analysis above for why this is a separate, more complete fake than
// the one in staff-edit-archive.test.ts.
// =============================================================================

class CompleteRegistrationRepo implements IRegistrationRepository {
  registrations: Map<number, Registration> = new Map();

  async createWithRelations(): Promise<{ id: number }> {
    throw new Error("not used in this test file — registrations are seeded directly");
  }

  async findById(id: number): Promise<Registration | null> {
    return this.registrations.get(id) ?? null;
  }

  async findByRegCode(regCode: string): Promise<Registration | null> {
    for (const reg of this.registrations.values()) if (reg.regCode === regCode) return reg;
    return null;
  }

  async findByEmail(email: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter((r) => r.email === email);
  }

  async findByWhatsapp(whatsapp: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter((r) => r.whatsapp === whatsapp);
  }

  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    const reg = this.registrations.get(id);
    if (reg) {
      reg.status = status;
      reg.updatedAt = Date.now();
    }
  }

  async update(id: number, data: RegistrationUpdate): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    if (data.full_name !== undefined) reg.fullName = data.full_name;
    if (data.branch !== undefined) reg.branch = data.branch;
    if (data.email !== undefined) reg.email = data.email;
    if (data.whatsapp !== undefined) reg.whatsapp = data.whatsapp;
    if (data.mobile_alternate !== undefined) reg.mobileAlternate = data.mobile_alternate;
    if (data.city !== undefined) reg.city = data.city;
    if (data.country !== undefined) reg.country = data.country;
    if (data.gender !== undefined) reg.gender = data.gender;
    if (data.tshirt_size !== undefined) reg.tshirtSize = data.tshirt_size;
    if (data.attendance_intent !== undefined) reg.attendanceIntent = data.attendance_intent;
    if (data.participation_type !== undefined) reg.participationType = data.participation_type;
    if (data.alumni_meal !== undefined) reg.alumniMeal = data.alumni_meal;
    if (data.accommodation !== undefined) reg.accommodation = data.accommodation;
    if (data.check_in !== undefined) reg.checkIn = data.check_in;
    if (data.check_out !== undefined) reg.checkOut = data.check_out;
    if (data.extra_bed !== undefined) reg.extraBed = data.extra_bed !== 0;
    if (data.breakfast_adult !== undefined) reg.breakfastAdult = data.breakfast_adult;
    if (data.breakfast_child !== undefined) reg.breakfastChild = data.breakfast_child;
    if (data.donation_amount !== undefined) reg.donationAmount = data.donation_amount;
    if (data.public_ack !== undefined) reg.publicAck = data.public_ack !== 0;
    if (data.ack_display_name !== undefined) reg.ackDisplayName = data.ack_display_name;
    if (data.felicitation !== undefined) reg.felicitation = data.felicitation !== 0;
    if (data.id_note !== undefined) reg.idNote = data.id_note;
    if (data.photo_file_key !== undefined) reg.photoFileKey = data.photo_file_key;
    if (data.contribution_splits !== undefined) {
      reg.contributionSplits = JSON.parse(data.contribution_splits) as Record<string, number>;
    }
    if (data.pricing_snapshot !== undefined) {
      reg.pricingSnapshot = JSON.parse(data.pricing_snapshot) as PricingBreakup;
    }
    if (data.total_amount !== undefined) reg.totalAmount = data.total_amount;
    reg.updatedAt = Date.now();
  }

  async updateWithLock(
    id: number,
    data: RegistrationUpdate,
    expectedUpdatedAt: number,
    attendees?: NewAttendee[],
  ): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) throw new NotFoundError("Registration not found");
    if (reg.updatedAt !== expectedUpdatedAt) throw new Error("OPTIMISTIC_LOCK_CONFLICT");
    await this.update(id, data);
    if (attendees !== undefined && this.companionAttendeeRepo) {
      await this.companionAttendeeRepo.replaceForRegistration(id, attendees);
    }
  }

  companionAttendeeRepo?: IAttendeeRepository;

  async list(_filters?: RegistrationFilters): Promise<Registration[]> {
    return [...this.registrations.values()];
  }
  async count(_filters?: RegistrationFilters): Promise<number> {
    return this.registrations.size;
  }
  async findMissingThumbnails() {
    return [];
  }
  async findWithThumbnails() {
    return [];
  }
  async countByStatus() {
    return { pending: 0, pendingVerification: 0, confirmed: 0 };
  }
  async geographyAggregates() {
    return { cities: [], countries: [] };
  }
  async donorRecognitionRows() {
    return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 };
  }
  async countByParticipationAndStatus() {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    return { full_celebration: zero(), campus_only: zero(), donation_only: zero() };
  }
  async getContributionAggregates() {
    return [];
  }
  async getDonationTotals() {
    return { count: 0, total: 0 };
  }
}

class InMemoryAttendeeRepo implements IAttendeeRepository {
  private attendees: Map<number, Attendee[]> = new Map();
  private nextId = 1;

  async findByRegistration(registrationId: number): Promise<Attendee[]> {
    return this.attendees.get(registrationId) ?? [];
  }
  async replaceForRegistration(registrationId: number, newAttendees: NewAttendee[]): Promise<void> {
    const converted: Attendee[] = newAttendees.map((na) => ({
      id: this.nextId++,
      registrationId,
      type: na.type,
      name: na.name,
      age: na.age,
      relationship: na.relationship,
      meal: na.meal,
      isChargeable: na.is_chargeable !== 0,
      createdAt: Date.now(),
    }));
    this.attendees.set(registrationId, converted);
  }
  async countGrouped() { return []; }
  async accommodationByNight() { return {}; }
  async mealsByParticipationType() {
    return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } };
  }
  async childrenByAgeBand() { return { under6: 0, age6to12: 0, age12plus: 0 }; }
}

class InMemoryPaymentRepo implements IPaymentRepository {
  payments: Map<number, Payment> = new Map();
  private nextId = 1;

  async create(payment: NewPayment): Promise<{ id: number }> {
    const id = this.nextId++;
    const now = Date.now();
    this.payments.set(id, {
      id,
      registrationId: payment.registration_id,
      amount: payment.amount,
      status: payment.status,
      gateway: payment.gateway,
      gatewayRef: payment.gateway_ref,
      gatewayResponse: payment.gateway_response,
      proofFileKey: payment.proof_file_key,
      verifiedBy: payment.verified_by,
      verifiedAt: payment.verified_at,
      method: null,
      note: null,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }
  async findById(id: number): Promise<Payment | null> {
    return this.payments.get(id) ?? null;
  }
  async findByRegistration(registrationId: number): Promise<Payment[]> {
    return [...this.payments.values()].filter((p) => p.registrationId === registrationId);
  }
  async updateStatus(
    id: number,
    status: PaymentStatus,
    gatewayData?: GatewayData,
    proofFileKey?: string,
    verification?: { verifiedBy: string; verifiedAt: number },
  ): Promise<void> {
    const p = this.payments.get(id);
    if (!p) return;
    p.status = status;
    if (gatewayData?.gatewayRef !== undefined) p.gatewayRef = gatewayData.gatewayRef;
    if (proofFileKey !== undefined) p.proofFileKey = proofFileKey;
    if (verification) { p.verifiedBy = verification.verifiedBy; p.verifiedAt = verification.verifiedAt; }
  }
  async verify(id: number, amount: number, gatewayRef: string, verifiedBy: string, verifiedAt: number): Promise<void> {
    const p = this.payments.get(id);
    if (!p) return;
    p.status = "verified"; p.amount = amount; p.gatewayRef = gatewayRef; p.verifiedBy = verifiedBy; p.verifiedAt = verifiedAt;
  }
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(registrationId: number): Promise<Payment | null> {
    return [...this.payments.values()].find((p) => p.registrationId === registrationId && p.status === "payment_pending") ?? null;
  }
  async deletePending(paymentId: number): Promise<void> {
    const p = this.payments.get(paymentId);
    if (p && p.status === "payment_pending") this.payments.delete(paymentId);
  }
  async updatePendingAmount(paymentId: number, newAmount: number): Promise<void> {
    const p = this.payments.get(paymentId);
    if (p && p.status === "payment_pending") p.amount = newAmount;
  }
  async sumVerifiedByRegistration(registrationId: number): Promise<number> {
    return [...this.payments.values()].filter((p) => p.registrationId === registrationId && p.status === "verified").reduce((s, p) => s + p.amount, 0);
  }
  async sumVerified(): Promise<number> { return 0; }
  async sumVerifiedByBranch() { return []; }
}

class InMemoryAuditRepo implements IAuditRepository {
  entries: AuditEntry[] = [];
  private nextId = 1;
  async append(entry: NewAuditEntry): Promise<void> {
    this.entries.push({
      id: this.nextId++,
      registrationId: entry.registration_id,
      action: entry.action,
      actor: entry.actor,
      changes: entry.changes ? JSON.parse(entry.changes) : null,
      snapshot: JSON.parse(entry.snapshot),
      createdAt: Date.now(),
    });
  }
  async findByRegistration(registrationId: number): Promise<AuditEntry[]> {
    return this.entries.filter((e) => e.registrationId === registrationId);
  }
}

class NoopEmailService implements IEmailService {
  async sendConfirmation() {}
  async sendMagicLink() {}
  async sendPaymentConfirmed() {}
  async sendPaymentRejected() {}
  async sendStaffWelcome() {}
  async sendPaymentLink() {}
  async sendRevisedPayment() {}
  async sendAdditionalPayment() {}
  async sendStoryHidden() {}
}

class FakeDb {
  prepare() {
    return { bind() { return { async run() { return {}; } }; } };
  }
}

// =============================================================================
// Fixtures
// =============================================================================
//
// Both seed helpers set `totalAmount` to the value calculateTotal() would
// actually produce for that exact state (verified by hand below), NOT an
// arbitrary placeholder. This matters: EditService only compares newTotal
// against sumVerifiedByRegistration() (0 in these tests, no payments seeded)
// for the cost-decrease guard — it never validates the seed's stored
// totalAmount against real pricing. A test that reads `totalAmount` *before*
// an edit and asserts `after === before + delta` is only valid if `before`
// itself was accurate; an arbitrary placeholder would silently make such
// delta assertions pass or fail for the wrong reason.
//
// seedRegistration(): no accommodation — base fee only (8500), matching
// calculateTotal(full_celebration, no accommodation, no contribution, no
// donation) exactly. Used for contributionSplits tests.
//
// seedRegistrationWithPrivateRoom(): private room, 1 night, zero breakfast —
// totalAmount = 8500 (base) + 12000 (room) × 1.18 (GST) = 22660, matching
// calculateTotal exactly. Used for breakfast + accommodation-removal tests.

function baseRegistration(overrides: Partial<Registration> = {}): Registration {
  const now = Date.now();
  const pricingSnapshot: PricingBreakup = { base: 8500, collegeContribution: 0, lines: [], donation: 0, total: 8500 };
  return {
    id: 1,
    regCode: "SMRT-TESTCASE1",
    status: "confirmed",
    fullName: "Ravi Kumar",
    branch: "Computer Science & Engineering",
    email: "ravi@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: null,
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    gender: "male",
    tshirtSize: "L",
    alumniMeal: "non_veg",
    accommodation: "none",
    checkIn: null,
    checkOut: null,
    extraBed: false,
    breakfastAdult: 0,
    breakfastChild: 0,
    donationAmount: 0,
    publicAck: false,
    ackDisplayName: null,
    felicitation: false,
    contributionSplits: {},
    pricingSnapshot,
    totalAmount: 8500,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedRegistration(repo: CompleteRegistrationRepo): { regId: number; updatedAt: number } {
  const reg = baseRegistration();
  repo.registrations.set(1, reg);
  return { regId: 1, updatedAt: reg.updatedAt };
}

function seedRegistrationWithPrivateRoom(repo: CompleteRegistrationRepo): { regId: number; updatedAt: number } {
  const reg = baseRegistration({
    accommodation: "private",
    checkIn: "2026-08-14",
    checkOut: "2026-08-15",
    totalAmount: 22660, // 8500 + 12000 × 1.18 — see fixture note above
  });
  repo.registrations.set(1, reg);
  return { regId: 1, updatedAt: reg.updatedAt };
}

function createContext() {
  const regRepo = new CompleteRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  regRepo.companionAttendeeRepo = attendeeRepo;

  const editService = new EditService({
    db: new FakeDb(),
    registrationRepo: regRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    emailService: new NoopEmailService(),
  });

  return { editService, regRepo, attendeeRepo, paymentRepo, auditRepo };
}

// =============================================================================
// 1. contributionSplits persistence fix — buildDbUpdate() path
// =============================================================================

describe("EditService — contributionSplits persists to the repository (persistence fix)", () => {
  it("adding a contribution split via edit() is reflected in the reloaded registration", async () => {
    // This is the exact bug: "edit.service.ts buildDbUpdate() wasn't
    // persisting contribution_splits to D1." If buildDbUpdate regresses to
    // omitting contribution_splits from the RegistrationUpdate, this
    // CompleteRegistrationRepo's update() never sets reg.contributionSplits,
    // and the returned registration keeps the old (empty) value.
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistration(ctx.regRepo);

    const req: EditRegistrationRequest = {
      fields: { contributionSplits: { green_energy: 2000 } },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.contributionSplits).toEqual({ green_energy: 2000 });
  });

  it("changing an existing contribution split amount persists the new amount", async () => {
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistration(ctx.regRepo);
    ctx.regRepo.registrations.get(regId)!.contributionSplits = { green_energy: 1000 };

    const req: EditRegistrationRequest = {
      fields: { contributionSplits: { green_energy: 3000 } },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.contributionSplits).toEqual({ green_energy: 3000 });
  });

  it("removing all contribution splits persists an empty object, not the stale value", async () => {
    // Catches: generator that only writes contribution_splits when non-empty
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistration(ctx.regRepo);
    ctx.regRepo.registrations.get(regId)!.contributionSplits = { scholarship: 500 };

    const req: EditRegistrationRequest = {
      fields: { contributionSplits: {} },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.contributionSplits).toEqual({});
  });

  it("contributionSplits change triggers pricing recompute reflected in totalAmount", async () => {
    // Cross-checks the persistence fix against calculateTotal(): a new
    // contribution split must actually raise the registration's total, not
    // just sit in the DB unpriced.
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistration(ctx.regRepo);
    const before = ctx.regRepo.registrations.get(regId)!.totalAmount;

    const req: EditRegistrationRequest = {
      fields: { contributionSplits: { scholarship: 1500 } },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.totalAmount).toBe(before + 1500);
  });

  it("editing an unrelated field (fullName) leaves existing contributionSplits untouched", async () => {
    // Catches: generator that resets contribution_splits to {} whenever the
    // fields patch doesn't explicitly include contributionSplits
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistration(ctx.regRepo);
    ctx.regRepo.registrations.get(regId)!.contributionSplits = { green_energy: 1000 };

    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi K. Updated" },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.contributionSplits).toEqual({ green_energy: 1000 });
  });
});

// =============================================================================
// 2. Breakfast add-on persistence — buildDbUpdate() path
// =============================================================================

describe("EditService — breakfast counts persist to the repository", () => {
  it("setting breakfastAdult and breakfastChild via edit() is reflected in the reloaded registration", async () => {
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistrationWithPrivateRoom(ctx.regRepo);

    const req: EditRegistrationRequest = {
      fields: { breakfastAdult: 2, breakfastChild: 1 },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.breakfastAdult).toBe(2);
    expect(result.registration.breakfastChild).toBe(1);
  });

  it("breakfast counts raise totalAmount by the documented rate + 18% GST", async () => {
    // adult (12+) = 1500 + 18% GST = 1770 per head. Seed's totalAmount (22660)
    // is the verified baseline for a zero-breakfast private room — see the
    // fixture note above the seed helpers.
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistrationWithPrivateRoom(ctx.regRepo);
    const before = ctx.regRepo.registrations.get(regId)!.totalAmount;

    const req: EditRegistrationRequest = {
      fields: { breakfastAdult: 1 },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.totalAmount).toBe(before + 1770);
  });

  it("editing an unrelated field leaves existing breakfast counts untouched", async () => {
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistration(ctx.regRepo);
    const reg = ctx.regRepo.registrations.get(regId)!;
    reg.breakfastAdult = 3;
    reg.breakfastChild = 2;

    const req: EditRegistrationRequest = {
      fields: { city: "Bangalore" },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.breakfastAdult).toBe(3);
    expect(result.registration.breakfastChild).toBe(2);
  });
});

// =============================================================================
// 3. Accommodation removal zeroes breakfast counts (applyFields + buildDbUpdate)
// =============================================================================

describe("EditService — removing accommodation zeroes breakfast counts", () => {
  it("setting accommodation to 'none' zeroes breakfastAdult/breakfastChild even when the fields patch doesn't mention them", async () => {
    // Exercises the unconditional buildDbUpdate branch:
    //   if (fields.accommodation === 'none') { update.breakfast_adult = 0; ... }
    // which fires regardless of whether fields.breakfastAdult/breakfastChild
    // were included in the request.
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistrationWithPrivateRoom(ctx.regRepo);
    const reg = ctx.regRepo.registrations.get(regId)!;
    reg.breakfastAdult = 2;
    reg.breakfastChild = 1;

    const req: EditRegistrationRequest = {
      fields: { accommodation: "none", checkIn: null, checkOut: null },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.accommodation).toBe("none");
    expect(result.registration.breakfastAdult).toBe(0);
    expect(result.registration.breakfastChild).toBe(0);
  });

  it("removing accommodation while simultaneously trying to set new breakfast counts still zeroes them", async () => {
    // Catches: generator applying breakfastAdult/breakfastChild from the
    // fields patch AFTER the accommodation==='none' zeroing branch, letting a
    // client sneak breakfast charges past a room that no longer exists.
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistrationWithPrivateRoom(ctx.regRepo);
    const reg = ctx.regRepo.registrations.get(regId)!;
    reg.breakfastAdult = 2;
    reg.breakfastChild = 1;

    const req: EditRegistrationRequest = {
      fields: { accommodation: "none", checkIn: null, checkOut: null, breakfastAdult: 5, breakfastChild: 5 },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.breakfastAdult).toBe(0);
    expect(result.registration.breakfastChild).toBe(0);
  });

  it("removing accommodation with breakfast counts drops the breakfast pricing lines from the recomputed total", async () => {
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistrationWithPrivateRoom(ctx.regRepo);
    const reg = ctx.regRepo.registrations.get(regId)!;
    reg.breakfastAdult = 2;
    reg.breakfastChild = 0;

    const req: EditRegistrationRequest = {
      fields: { accommodation: "none", checkIn: null, checkOut: null },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    // With accommodation removed entirely, pricing falls back to just the
    // base fee (no accommodation, no breakfast, no GST line at all).
    expect(result.registration.totalAmount).toBe(8500);
    expect(result.pricingBreakup!.lines.some((l) => l.label.includes("Breakfast"))).toBe(false);
  });

  it("keeping accommodation but reducing breakfast to zero explicitly also persists zero (baseline, not the zeroing branch)", async () => {
    // Distinguishes the unconditional accommodation-removal zeroing from the
    // ordinary explicit-field-update path — both should reach zero, via
    // different code paths in buildDbUpdate.
    const ctx = createContext();
    const { regId, updatedAt } = seedRegistrationWithPrivateRoom(ctx.regRepo);
    const reg = ctx.regRepo.registrations.get(regId)!;
    reg.breakfastAdult = 2;
    reg.breakfastChild = 1;

    const req: EditRegistrationRequest = {
      fields: { breakfastAdult: 0, breakfastChild: 0 },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.registration.accommodation).toBe("private");
    expect(result.registration.breakfastAdult).toBe(0);
    expect(result.registration.breakfastChild).toBe(0);
  });
});
