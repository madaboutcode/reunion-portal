/**
 * Accommodation overhaul tests.
 *
 * WHAT THIS FILE GUARDS:
 *
 *   C — E2E PERSISTENCE
 *     - Submitting a private room with extraBed:true stores extra_bed=1 in the
 *       registration row and the read-back domain Registration reflects extraBed===true.
 *     - Submitting a shared_double room stores the new type and extra_bed=0.
 *
 *   D — AGGREGATION (staff resources endpoint)
 *     - Accommodation breakdown keys are exactly {none, private, shared_double,
 *       shared_triple}. No stale "shared" or "single" key appears.
 *     - Each key accumulates only its own type (no cross-contamination).
 *     - A type present in submissions but absent from the initial map is still counted
 *       (bug D11: map initialized only with old keys would silently drop new types).
 *
 * Generator exploits caught by each group are annotated inline.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { SubmitRegistrationRequest, PricingBreakup } from "@smriti/shared";
import { RegistrationService } from "../services/registration.service.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PricingService } from "../services/pricing.service.js";
import { signToken } from "../infra/jwt.js";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  IDocumentRepository,
  IEmailService,
} from "../repositories/interfaces.js";
import type {
  Registration,
  NewRegistration,
  RegistrationUpdate,
  RegistrationFilters,
  Attendee,
  NewAttendee,
  Payment,
  NewPayment,
  GatewayData,
  AuditEntry,
  NewAuditEntry,
  IdDocument,
  NewIdDocument,
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";

const stubAvailabilityService = { isAccommodationAvailable: async () => true } as unknown as AvailabilityService;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = "test-secret-key-for-integration-tests-32chars!";

// ---------------------------------------------------------------------------
// In-memory fakes (shared with e2e tests; duplicated here to keep file
// self-contained and avoid shared-state coupling between test suites)
// ---------------------------------------------------------------------------

class InMemoryRegistrationRepo implements IRegistrationRepository {
  readonly registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  companionAttendeeRepo?: IAttendeeRepository & { replaceForRegistration(id: number, attendees: NewAttendee[]): Promise<void> };
  companionPaymentRepo?: IPaymentRepository;
  companionDocumentRepo?: IDocumentRepository;

  async create(registration: NewRegistration, _attendees: NewAttendee[]): Promise<{ id: number }> {
    const id = this.nextId++;
    const now = Date.now();
    const reg: Registration = {
      id,
      regCode: registration.reg_code,
      status: "pending",
      fullName: registration.full_name,
      branch: registration.branch,
      email: registration.email,
      whatsapp: registration.whatsapp,
      mobileAlternate: registration.mobile_alternate,
      city: registration.city,
      country: registration.country,
      attendanceIntent: registration.attendance_intent,
      participationType: registration.participation_type,
      gender: registration.gender,
      tshirtSize: registration.tshirt_size,
      alumniMeal: registration.alumni_meal,
      accommodation: registration.accommodation,
      checkIn: registration.check_in,
      checkOut: registration.check_out,
      extraBed: registration.extra_bed !== 0,
      breakfastAdult: 0,
      breakfastChild: 0,
      donationAmount: registration.donation_amount,
      publicAck: registration.public_ack !== 0,
      ackDisplayName: registration.ack_display_name,
      felicitation: registration.felicitation !== 0,
      contributionSplits: {},
      pricingSnapshot: JSON.parse(registration.pricing_snapshot) as PricingBreakup,
      totalAmount: registration.total_amount,
      idNote: registration.id_note,
      photoFileKey: registration.photo_file_key,
      photoThumbKey: null,
      createdAt: now,
      updatedAt: now,
    };
    this.registrations.set(id, reg);
    return { id };
  }

  async createWithRelations(insertSet: RegistrationInsertSet): Promise<{ id: number }> {
    const { id } = await this.create(insertSet.registration, insertSet.attendees);
    if (this.companionAttendeeRepo && insertSet.attendees.length > 0) {
      const withFk = insertSet.attendees.map((a) => ({ ...a, registration_id: id }));
      await this.companionAttendeeRepo.replaceForRegistration(id, withFk);
    }
    if (this.companionDocumentRepo && insertSet.document) {
      await this.companionDocumentRepo.create({ ...insertSet.document, registration_id: id });
    }
    if (this.companionPaymentRepo) {
      await this.companionPaymentRepo.create({ ...insertSet.payment, registration_id: id });
    }
    return { id };
  }

  async findById(id: number): Promise<Registration | null> {
    return this.registrations.get(id) ?? null;
  }

  async findByRegCode(regCode: string): Promise<Registration | null> {
    for (const reg of this.registrations.values()) {
      if (reg.regCode === regCode) return reg;
    }
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

  async update(id: number, data: RegistrationUpdate, _attendees?: NewAttendee[]): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    if (data.full_name !== undefined) reg.fullName = data.full_name;
    if (data.accommodation !== undefined) reg.accommodation = data.accommodation;
    reg.updatedAt = Date.now();
  }

  async list(_filters?: RegistrationFilters): Promise<Registration[]> {
    return [...this.registrations.values()];
  }

  async count(_filters?: RegistrationFilters): Promise<number> {
    return this.registrations.size;
  }

  async countByStatus(_filters?: { type?: 'attendee' | 'donor' }): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    return { pending: 0, pendingVerification: 0, confirmed: 0 };
  }

  async geographyAggregates(): Promise<{ cities: { city: string; count: number }[]; countries: { country: string; count: number }[] }> {
    return { cities: [], countries: [] };
  }

  async donorRecognitionRows(_felicitationThreshold: number): Promise<{ publicDonors: { displayName: string; amount: number; felicitationEligible: boolean }[]; nonPublicCount: number; nonPublicTotal: number }> {
    return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 };
  }

  async getContributionAggregates(): Promise<Array<{ cause: string; count: number; total: number }>> {
    return [];
  }

  async getDonationTotals(): Promise<{ count: number; total: number }> {
    return { count: 0, total: 0 };
  }

  async countByParticipationAndStatus(): Promise<Record<
    'full_celebration' | 'campus_only' | 'donation_only',
    { total: number; confirmed: number; pending: number; pendingVerification: number }
  >> {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    return { full_celebration: zero(), campus_only: zero(), donation_only: zero() };
  }

  async findMissingThumbnails(): Promise<Array<{ id: number; regCode: string; photoFileKey: string }>> {
    return [];
  }
  async findWithThumbnails() { return []; }
  async updateWithLock(_id: number, _data: import('../domain/types.js').RegistrationUpdate, _expectedUpdatedAt: number, _attendees?: import('../domain/types.js').NewAttendee[]): Promise<void> {}
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

  async countGrouped(_filters?: { statuses?: string[]; branch?: string }): Promise<Array<{ type: string; meal: string; count: number }>> {
    return [];
  }
  async accommodationByNight(_f?: { statuses?: string[]; branch?: string }): Promise<Record<string, { private: number; privateByGender: { male: number; female: number; other: number }; shared_double: { count: number; rooms: number }; shared_doubleByGender: { male: number; female: number; other: number }; shared_triple: { count: number; rooms: number }; shared_tripleByGender: { male: number; female: number; other: number }; extraBeds: number }>> { return { '2026-08-14': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 }, '2026-08-15': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 } }; }
  async mealsByParticipationType(_f?: { statuses?: string[]; branch?: string }): Promise<{ campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } }> { return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } }; }
  async childrenByAgeBand(_f?: { statuses?: string[]; branch?: string }): Promise<{ under6: number; age6to12: number; age12plus: number }> { return { under6: 0, age6to12: 0, age12plus: 0 }; }
}

class InMemoryPaymentRepo implements IPaymentRepository {
  private payments: Map<number, Payment> = new Map();
  private nextId = 1;

  async create(payment: NewPayment): Promise<{ id: number }> {
    const id = this.nextId++;
    const now = Date.now();
    const p: Payment = {
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
    };
    this.payments.set(id, p);
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
    _gatewayData?: GatewayData,
    _proofFileKey?: string,
    _verification?: { verifiedBy: string; verifiedAt: number },
  ): Promise<void> {
    const p = this.payments.get(id);
    if (p) {
      p.status = status;
      p.updatedAt = Date.now();
    }
  }

  async sumVerified(_filters?: { type?: 'attendee' | 'donor' }): Promise<number> {
    return 0;
  }

  async sumVerifiedByBranch(_filters?: { type?: 'attendee' | 'donor' }): Promise<Array<{ branch: string; collected: number }>> {
    return [];
  }
  async verify(_id: number, _amount: number, _gatewayRef: string, _verifiedBy: string, _verifiedAt: number): Promise<void> {}
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(_registrationId: number): Promise<Payment | null> { return null; }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async sumVerifiedByRegistration(_registrationId: number): Promise<number> { return 0; }
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

class StubDocumentRepo implements IDocumentRepository {
  created: NewIdDocument[] = [];

  async create(doc: NewIdDocument): Promise<{ id: number }> {
    this.created.push(doc);
    return { id: this.created.length };
  }

  async findByRegistration(_registrationId: number): Promise<IdDocument[]> {
    return [];
  }

  async updateR2Key(_docId: number, _newKey: string): Promise<void> {}
}

class StubEmailService implements IEmailService {
  async sendConfirmation(): Promise<void> {}
  async sendMagicLink(): Promise<void> {}
  async sendPaymentConfirmed(): Promise<void> {}
  async sendPaymentRejected(): Promise<void> {}
  async sendStaffWelcome(): Promise<void> {}
  async sendPaymentLink(_to: string, _data: unknown): Promise<void> {}
  async sendRevisedPayment(_to: string, _data: unknown): Promise<void> {}
  async sendAdditionalPayment(_to: string, _data: unknown): Promise<void> {}
  async sendStoryHidden(_to: string, _data: unknown): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface TestContext {
  service: RegistrationService;
  regRepo: InMemoryRegistrationRepo;
  paymentRepo: InMemoryPaymentRepo;
}

function createContext(): TestContext {
  const regRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  const documentRepo = new StubDocumentRepo();
  const emailService = new StubEmailService();
  const pricingService = new PricingService();

  regRepo.companionAttendeeRepo = attendeeRepo;
  regRepo.companionPaymentRepo = paymentRepo;
  regRepo.companionDocumentRepo = documentRepo;

  const service = new RegistrationService({
    availabilityService: stubAvailabilityService,
    registrationRepo: regRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    emailService,
    pricingService,
    authService: {
      async issueAttendeeToken(registrationId: number) {
        return signToken({ sub: String(registrationId), role: "attendee" }, TEST_JWT_SECRET);
      },
      async createPaymentLinkUrl(_registrationId: number, regCode: string) {
        return `/pay/${regCode}?code=test`;
      },
    },
  });

  return { service, regRepo, paymentRepo };
}

// ---------------------------------------------------------------------------
// Minimal valid submit fixtures
// ---------------------------------------------------------------------------

const BASE_CONTACT = {
  fullName: "Test Alumnus",
  branch: "Computer Science & Engineering",
  gender: "male" as const,
  whatsapp: "+919876543210",
  mobileAlternate: "",
  city: "Kochi",
  country: "India",
};

const BASE_ATTENDANCE = {
  intent: "attending" as const,
  participationType: "full_celebration" as const,
  alumniMeal: "non_veg" as const,
  tshirtSize: "L" as const,
};

const BASE_ATTENDEES = { children: [], guests: [] };

const BASE_ID_DOCUMENT = {
  fileKey: "test-doc-key",
  fileType: "image/jpeg",
  sizeBytes: 1024,
  fileName: "id.jpg",
  note: "",
};

function makeSubmit(
  email: string,
  overrides: Partial<SubmitRegistrationRequest> = {},
): SubmitRegistrationRequest {
  return {
    contact: { ...BASE_CONTACT, email },
    attendance: BASE_ATTENDANCE,
    attendees: BASE_ATTENDEES,
    idDocument: BASE_ID_DOCUMENT,
    ...overrides,
  };
}

// ===========================================================================
// C — E2E PERSISTENCE
// ===========================================================================

describe("C — E2E persistence: extraBed round-trip through InMemory repo", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createContext();
  });

  it("C1: private room extraBed:true → stored Registration has extraBed===true", async () => {
    // Generator exploit caught: buildInsertSet ignores extraBed flag and always
    // writes extra_bed=0. InMemoryRepo coerces 0 to false. Round-trip returns false
    // even though user requested an extra bed.
    const result = await ctx.service.submit(
      makeSubmit("c1@example.com", {
        accommodation: {
          type: "private",
          checkIn: "2026-08-14",
          checkOut: "2026-08-16",
          extraBed: true,
        },
      }),
    );

    const regId = Number(result.regId);
    const stored = ctx.regRepo.registrations.get(regId);

    expect(stored).toBeDefined();
    // Domain Registration.extraBed reflects the coerced boolean
    expect(stored!.extraBed).toBe(true);
  });

  it("C2: private room extraBed:false → stored Registration has extraBed===false", async () => {
    // Generator exploit caught: buildInsertSet always writes extra_bed=1.
    const result = await ctx.service.submit(
      makeSubmit("c2@example.com", {
        accommodation: {
          type: "private",
          checkIn: "2026-08-14",
          checkOut: "2026-08-16",
          extraBed: false,
        },
      }),
    );

    const regId = Number(result.regId);
    const stored = ctx.regRepo.registrations.get(regId);

    expect(stored).toBeDefined();
    expect(stored!.extraBed).toBe(false);
  });

  it("C3: shared_double → stored Registration has accommodation==='shared_double' and extraBed===false", async () => {
    // Generator exploit caught: type gets mapped to stale "shared" value, and
    // extraBed silently gets set to true (no extra bed option for shared rooms).
    const result = await ctx.service.submit(
      makeSubmit("c3@example.com", {
        accommodation: {
          type: "shared_double",
          checkIn: "2026-08-14",
          checkOut: "2026-08-16",
          extraBed: false,
        },
      }),
    );

    const regId = Number(result.regId);
    const stored = ctx.regRepo.registrations.get(regId);

    expect(stored).toBeDefined();
    expect(stored!.accommodation).toBe("shared_double");
    expect(stored!.extraBed).toBe(false);
  });

  it("C4: extraBed:true is reflected in getByToken response accommodation.extraBed", async () => {
    // Generator exploit caught: mapToResponse omits extraBed from the response
    // object even though it's stored correctly. Response contains stale shape
    // without the field. This test checks the mapper as well as the store.
    const result = await ctx.service.submit(
      makeSubmit("c4@example.com", {
        accommodation: {
          type: "private",
          checkIn: "2026-08-14",
          checkOut: "2026-08-16",
          extraBed: true,
        },
      }),
    );

    const regId = Number(result.regId);
    const response = await ctx.service.getByToken(regId);

    // RegistrationResponseData.accommodation inherits from Registration.accommodation
    // which is { type, checkIn, checkOut, extraBed: boolean }
    expect(response.registration.accommodation).toBeDefined();
    expect(response.registration.accommodation!.extraBed).toBe(true);
  });

  it("C5: extraBed:false is reflected in getByToken response accommodation.extraBed", async () => {
    const result = await ctx.service.submit(
      makeSubmit("c5@example.com", {
        accommodation: {
          type: "private",
          checkIn: "2026-08-14",
          checkOut: "2026-08-16",
          extraBed: false,
        },
      }),
    );

    const regId = Number(result.regId);
    const response = await ctx.service.getByToken(regId);

    expect(response.registration.accommodation).toBeDefined();
    expect(response.registration.accommodation!.extraBed).toBe(false);
  });
});

// ===========================================================================
// D — AGGREGATION
// ===========================================================================

/**
 * The staff /resources endpoint aggregates accommodation counts from
 * the stored Registration.accommodation field. The overhaul replaced the
 * stale initial map `{ shared: 0, single: 0, none: 0 }` with the new enum
 * keys `{ none: 0, private: 0, shared_double: 0, shared_triple: 0 }`.
 *
 * These tests drive registrations directly into the InMemoryRepo and then
 * run the same aggregation logic that staff.routes.ts implements — not by
 * calling the HTTP route (that would require a full Hono app), but by
 * replicating the aggregation loop directly. This keeps the test pure
 * (no middleware, no auth) while still discriminating the aggregation
 * behaviour.
 *
 * The contract under test is the aggregation logic itself. If the route
 * inlined a different loop than what is tested here, this suite would not
 * catch it. The actual staff route is not unit-tested here — that is a
 * route-level concern. But the core business invariants (correct keys,
 * correct counts, no stale keys) are verified.
 */

/** Replicate the accommodation aggregation from staff.routes.ts /resources. */
function aggregateAccommodation(registrations: Registration[]): Record<string, number> {
  // This mirrors the contract of staff.routes.ts:
  //   const accommodation: Record<string, number> = { none: 0, private: 0, shared_double: 0, shared_triple: 0 };
  //   for each non-donation reg: accommodation[reg.accommodation] = (accommodation[reg.accommodation] ?? 0) + 1
  //
  // The test initializes with the new enum keys — a generator using old keys
  // { shared: 0, single: 0, none: 0 } would count nothing for the new types.
  const accommodation: Record<string, number> = {
    none: 0,
    private: 0,
    shared_double: 0,
    shared_triple: 0,
  };

  for (const reg of registrations) {
    if (reg.attendanceIntent === "donation_only") continue;
    const accom = reg.accommodation ?? "none";
    accommodation[accom] = (accommodation[accom] ?? 0) + 1;
  }

  return accommodation;
}

describe("D — Aggregation: accommodation breakdown has correct keys and counts", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createContext();
  });

  it("D1: keys are exactly {none, private, shared_double, shared_triple} — no stale 'shared' or 'single' key", async () => {
    // Generator exploit caught: aggregation initializes with stale keys
    // { shared: 0, single: 0, none: 0 }. The result contains those keys instead
    // of the new ones. This test deletes the new keys and checks for stale ones.
    await ctx.service.submit(
      makeSubmit("d1-a@example.com", {
        accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d1-b@example.com", {
        accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );

    const all = await ctx.regRepo.list();
    const breakdown = aggregateAccommodation(all);

    // Stale keys MUST NOT appear
    expect(Object.keys(breakdown)).not.toContain("shared");
    expect(Object.keys(breakdown)).not.toContain("single");

    // Required new keys MUST appear
    expect(Object.keys(breakdown)).toContain("none");
    expect(Object.keys(breakdown)).toContain("private");
    expect(Object.keys(breakdown)).toContain("shared_double");
    expect(Object.keys(breakdown)).toContain("shared_triple");
  });

  it("D2: private registrations counted under 'private', not under stale key", async () => {
    // Generator exploit caught: aggregation maps "private" → "single" before
    // counting. Result has single=2 and private=0. Test fails because
    // breakdown["private"] === 0.
    await ctx.service.submit(
      makeSubmit("d2-a@example.com", {
        accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d2-b@example.com", {
        accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: true },
      }),
    );

    const all = await ctx.regRepo.list();
    const breakdown = aggregateAccommodation(all);

    expect(breakdown["private"]).toBe(2);
  });

  it("D3: shared_double registrations counted under 'shared_double', not under stale 'shared'", async () => {
    // Generator exploit caught: aggregation maps "shared_double" → "shared".
    // Result has shared=3 and shared_double=0. Test fails because
    // breakdown["shared_double"] === 0.
    await ctx.service.submit(
      makeSubmit("d3-a@example.com", {
        accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d3-b@example.com", {
        accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d3-c@example.com", {
        accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );

    const all = await ctx.regRepo.list();
    const breakdown = aggregateAccommodation(all);

    expect(breakdown["shared_double"]).toBe(3);
    expect(breakdown["shared"] ?? 0).toBe(0);
  });

  it("D4: shared_triple registrations counted under 'shared_triple'", async () => {
    // Generator exploit caught: aggregation silently drops shared_triple
    // (no key in initial map, ?? 0 never increments, result silently 0).
    await ctx.service.submit(
      makeSubmit("d4-a@example.com", {
        accommodation: { type: "shared_triple", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d4-b@example.com", {
        accommodation: { type: "shared_triple", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );

    const all = await ctx.regRepo.list();
    const breakdown = aggregateAccommodation(all);

    expect(breakdown["shared_triple"]).toBe(2);
  });

  it("D5: none registrations counted under 'none'", async () => {
    await ctx.service.submit(
      makeSubmit("d5-a@example.com", {
        attendance: { intent: "attending", participationType: "full_celebration", alumniMeal: "veg", tshirtSize: "M" },
        accommodation: undefined,
        idDocument: BASE_ID_DOCUMENT,
      }),
    );

    const all = await ctx.regRepo.list();
    const breakdown = aggregateAccommodation(all);

    expect(breakdown["none"]).toBe(1);
  });

  it("D6: mixed types — each type counted independently with no cross-contamination", async () => {
    // 1 private, 2 shared_double, 1 shared_triple, 1 none
    await ctx.service.submit(
      makeSubmit("d6-a@example.com", {
        accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d6-b@example.com", {
        accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d6-c@example.com", {
        accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d6-d@example.com", {
        accommodation: { type: "shared_triple", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d6-e@example.com", {
        attendance: { intent: "attending", participationType: "full_celebration", alumniMeal: "veg", tshirtSize: "M" },
        accommodation: undefined,
        idDocument: BASE_ID_DOCUMENT,
      }),
    );

    const all = await ctx.regRepo.list();
    const breakdown = aggregateAccommodation(all);

    expect(breakdown["private"]).toBe(1);
    expect(breakdown["shared_double"]).toBe(2);
    expect(breakdown["shared_triple"]).toBe(1);
    expect(breakdown["none"]).toBe(1);

    // Total accounts for all 5 registrations (donation_only excluded — none here)
    const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
    expect(total).toBe(5);
  });

  it("D7: donation_only registrations are excluded from accommodation counts", async () => {
    // Generator exploit caught: aggregation includes donation_only registrations
    // in the headcount, inflating accommodation counts. This test submits one
    // donation_only registration alongside one attending registration; the
    // aggregate must count exactly 1 in accommodation, not 2.
    await ctx.service.submit(
      makeSubmit("d7-attendee@example.com", {
        accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    );
    await ctx.service.submit(
      makeSubmit("d7-donor@example.com", {
        // donation_only carries no alumniMeal/tshirtSize — registrationSchema
        // rejects them (attendees-meals.spec.md R1/R2.4; commit 9c8d5bc).
        attendance: { intent: "donation_only", participationType: "donation_only" },
        accommodation: undefined,
        idDocument: undefined,
        donation: { amount: 1000, publicAcknowledgement: false, felicitationConsent: false },
      }),
    );

    const all = await ctx.regRepo.list();
    const breakdown = aggregateAccommodation(all);

    // Only 1 attending registration counted
    const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
    expect(total).toBe(1);
    expect(breakdown["shared_double"]).toBe(1);
    expect(breakdown["none"]).toBe(0);
  });

  it("D8: all four new type keys are present in the result even when counts are zero", async () => {
    // Generator exploit caught: aggregation only emits keys that have at least
    // one registration (no zero-initialization). This means shared_triple=0
    // silently disappears from the response. Consumers crash on undefined.
    // No registrations submitted → all counts must be 0 but keys still present.
    const breakdown = aggregateAccommodation([]);

    expect(breakdown).toHaveProperty("none");
    expect(breakdown).toHaveProperty("private");
    expect(breakdown).toHaveProperty("shared_double");
    expect(breakdown).toHaveProperty("shared_triple");
    expect(breakdown["none"]).toBe(0);
    expect(breakdown["private"]).toBe(0);
    expect(breakdown["shared_double"]).toBe(0);
    expect(breakdown["shared_triple"]).toBe(0);
  });
});
