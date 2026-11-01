/**
 * Adversarial spec tests — pass-retrieval.spec.md
 *
 * These tests enforce externally observable guarantees from the spec.
 * A failing test is a bug report, not a problem to fix here.
 *
 * DOES NOT duplicate tests already in lookup.test.ts:
 *   - R2.2 dash-stripping         — already tested
 *   - R2.2 lowercase → uppercase  — already tested
 *   - R2.3 missing/empty regCode  — already tested
 *   - R2.3 short/long/wrong-prefix codes — already tested
 *   - R2.7 numeric-only codes     — already tested
 *   - Service-level NotFoundError  — already tested
 *   - Service-level correct shape (name/regCode/intent/count/accommodation) — already tested
 *
 * NEW coverage in this file:
 *   - R2.2: whitespace trimming (untested gap)
 *   - R2.3: exact error message body (lookup.test.ts only checks status)
 *   - R2.4: route-level 404 with exact body (lookup.test.ts tests service only)
 *   - R2.5: complete field set — exactly 5 keys, every key present, no extra keys
 *   - R2.6: response NEVER leaks id, email, whatsapp, payment, token
 *   - R1.1 + R3.x: documented as untestable (no React test infra) — coverage table at bottom
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { SubmitRegistrationRequest, PricingBreakup } from "@smriti/shared";

import { RegistrationService } from "../services/registration.service.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PricingService } from "../services/pricing.service.js";
import { handleError } from "../middleware/error.middleware.js";
import { registrationRoutes } from "../routes/registration.routes.js";
import { clearRateLimitStore } from "../middleware/rate-limit.js";
import type { AppEnv } from "../env.js";
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
// In-memory repos (copied pattern from lookup.test.ts)
// ---------------------------------------------------------------------------

class InMemoryRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  // Companion repos for createWithRelations
  companionAttendeeRepo?: IAttendeeRepository & { replaceForRegistration(id: number, attendees: NewAttendee[]): Promise<void> };
  companionPaymentRepo?: IPaymentRepository;
  companionDocumentRepo?: IDocumentRepository;

  async create(
    registration: NewRegistration,
    _attendees: NewAttendee[],
  ): Promise<{ id: number }> {
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
      pricingSnapshot: JSON.parse(
        registration.pricing_snapshot,
      ) as PricingBreakup,
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

    // Create attendees with correct FK
    if (this.companionAttendeeRepo && insertSet.attendees.length > 0) {
      const withFk = insertSet.attendees.map(a => ({ ...a, registration_id: id }));
      await this.companionAttendeeRepo.replaceForRegistration(id, withFk);
    }

    // Create document if present
    if (this.companionDocumentRepo && insertSet.document) {
      await this.companionDocumentRepo.create({ ...insertSet.document, registration_id: id });
    }

    // Create payment
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
    return [...this.registrations.values()].filter(
      (r) => r.whatsapp === whatsapp,
    );
  }

  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    const reg = this.registrations.get(id);
    if (reg) {
      reg.status = status;
      reg.updatedAt = Date.now();
    }
  }

  async update(
    id: number,
    data: RegistrationUpdate,
    _attendees?: NewAttendee[],
  ): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    if (data.full_name !== undefined) reg.fullName = data.full_name;
    if (data.attendance_intent !== undefined)
      reg.attendanceIntent = data.attendance_intent;
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

  async countByParticipationAndStatus(): Promise<Record<
    'full_celebration' | 'campus_only' | 'donation_only',
    { total: number; confirmed: number; pending: number; pendingVerification: number }
  >> {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    const out: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }> = {
      full_celebration: zero(),
      campus_only: zero(),
      donation_only: zero(),
    };
    return out as Record<
      'full_celebration' | 'campus_only' | 'donation_only',
      { total: number; confirmed: number; pending: number; pendingVerification: number }
    >;
  }

  async getDonationTotals(): Promise<{ count: number; total: number }> {
    return { count: 0, total: 0 };
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

  async replaceForRegistration(
    registrationId: number,
    newAttendees: NewAttendee[],
  ): Promise<void> {
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

class StubPaymentRepo implements IPaymentRepository {
  async create(_p: NewPayment): Promise<{ id: number }> {
    return { id: 1 };
  }
  async findById(_id: number): Promise<Payment | null> {
    return null;
  }
  async findByRegistration(_id: number): Promise<Payment[]> {
    return [];
  }
  async updateStatus(
    _id: number,
    _status: PaymentStatus,
    _data?: GatewayData,
    _proofFileKey?: string,
  ): Promise<void> {}
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

class StubAuditRepo implements IAuditRepository {
  async append(_e: NewAuditEntry): Promise<void> {}
  async findByRegistration(_id: number): Promise<AuditEntry[]> {
    return [];
  }
}

class StubDocumentRepo implements IDocumentRepository {
  async create(_doc: NewIdDocument): Promise<{ id: number }> {
    return { id: 1 };
  }
  async findByRegistration(_id: number): Promise<IdDocument[]> {
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
// Factory helpers
// ---------------------------------------------------------------------------


function createService(
  regRepo = new InMemoryRegistrationRepo(),
  attendeeRepo = new InMemoryAttendeeRepo(),
): RegistrationService {
  const documentRepo = new StubDocumentRepo();
  const paymentRepo = new StubPaymentRepo();

  // Wire companion repos for createWithRelations
  regRepo.companionAttendeeRepo = attendeeRepo;
  regRepo.companionDocumentRepo = documentRepo;
  regRepo.companionPaymentRepo = paymentRepo;

  return new RegistrationService({
    availabilityService: stubAvailabilityService,
    registrationRepo: regRepo,
    attendeeRepo,
    auditRepo: new StubAuditRepo(),
    documentRepo,
    emailService: new StubEmailService(),
    pricingService: new PricingService(),
    authService: { async issueAttendeeToken() { return 'test-jwt-token'; }, async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; } },
  });
}

/**
 * Creates a Hono test app wired with the real error middleware.
 *
 * IMPORTANT: lookup.test.ts's createLookupApp does NOT wire onError,
 * meaning NotFoundError thrown by the service is not translated to 404
 * in that test environment. Here we wire handleError so route-level
 * error translation is part of what we test (R2.4 requires the HTTP
 * response to be 404, not an unhandled exception).
 */
function createFullApp(svc: RegistrationService) {
  const app = new Hono<AppEnv>().basePath("/api");
  app.use("*", async (c, next) => {
    c.set("registrationService", svc as AppEnv["Variables"]["registrationService"]);
    await next();
  });
  app.route("/", registrationRoutes);
  app.onError(handleError);
  return app;
}

const baseSubmit: SubmitRegistrationRequest = {
  contact: {
    fullName: "Arjun Nair",
    branch: "Computer Science & Engineering",
    gender: "male",
    email: "arjun@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: "",
    city: "Thrissur",
    country: "India",
  },
  attendance: {
    intent: "attending",
    participationType: "full_celebration",
    alumniMeal: "veg",
    tshirtSize: "M",
  },
  attendees: {
    children: [],
    guests: [],
  },
  accommodation: {
    type: "shared_double",
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
    extraBed: false,
  },
  idDocument: {
    fileKey: "test-id-key",
    fileType: "image/jpeg",
    sizeBytes: 1024,
    fileName: "id.jpg",
    note: "",
  },
};

// ---------------------------------------------------------------------------
// R2.2 — Normalization: whitespace trimming (untested gap in lookup.test.ts)
// ---------------------------------------------------------------------------

describe("R2.2 — normalization: whitespace trimming", () => {
  /**
   * Spec R2.2: "The endpoint normalizes the input: strips dashes, trims
   * whitespace, uppercases."
   *
   * lookup.test.ts tests dash-stripping and uppercasing but NOT trimming.
   * A generator that omits `.trim()` would pass all existing tests.
   *
   * Generator exploit: return 400 for " SMRTAAAAAAAABBBB " (with spaces)
   * because the format check runs BEFORE trimming — a reordering bug.
   */
  it("accepts a valid code with leading and trailing whitespace", async () => {
    const svc = createService();
    const { regCode } = await svc.submit(baseSubmit);

    const app = createFullApp(svc);
    const padded = `  ${regCode}  `;

    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: padded }),
    });

    // Spec R2.2: trim happens before format validation.
    // If 400, the implementation trims AFTER validating (wrong order).
    expect(res.status).toBe(200);
  });

  it("accepts a dash-formatted code with leading/trailing spaces combined", async () => {
    const svc = createService();
    const { regCode } = await svc.submit(baseSubmit);
    // Build the dashed version of the actual regCode.
    // regCode is 16 chars: SMRT + 12 chars.
    // Dashed format: SMRT-XXXX-XXXX-XXXX
    const dashed = `${regCode.slice(0, 4)}-${regCode.slice(4, 8)}-${regCode.slice(8, 12)}-${regCode.slice(12)}`;

    const app = createFullApp(svc);

    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: `  ${dashed}  ` }),
    });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R2.3 — Exact error message for invalid format
// ---------------------------------------------------------------------------

describe("R2.3 — format validation: exact error body", () => {
  /**
   * Spec R2.3: "Codes that fail this check receive 400
   * { 'error': 'Invalid pass code format' }."
   *
   * lookup.test.ts asserts status === 400 but never asserts the message.
   * A generator returning { "error": "bad input" } passes existing tests.
   */
  let app: ReturnType<typeof createFullApp>;

  beforeEach(() => {
    clearRateLimitStore();
    app = createFullApp(createService());
  });

  it("returns the exact error message for a code that is too short", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRT123" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invalid pass code format");
  });

  it("returns the exact error message for a code with wrong prefix", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "ABCDAAAAAAAABBBB" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invalid pass code format");
  });

  it("returns the exact error message for a numeric-only code (R2.7)", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "1234567890123456" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invalid pass code format");
  });

  it("returns the exact error message for a code that is too long", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRTAAAAABBBBBCCCCCC" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Invalid pass code format");
  });
});

// ---------------------------------------------------------------------------
// R2.4 — 404 for valid format, no matching registration (route-level)
// ---------------------------------------------------------------------------

describe("R2.4 — 404 for valid-format code with no matching registration", () => {
  /**
   * Spec R2.4: "If the code is valid but no matching registration exists,
   * the response is 404 { 'error': 'Registration not found' }."
   *
   * lookup.test.ts tests this at the service layer (NotFoundError is thrown)
   * but no test verifies the HTTP response status + body through the route.
   *
   * Generator exploit: route swallows the NotFoundError and returns 500,
   * or returns 200 with null. The error middleware must be wired for this
   * to translate correctly.
   */
  let app: ReturnType<typeof createFullApp>;

  beforeEach(() => {
    clearRateLimitStore();
    app = createFullApp(createService()); // empty repo — no registrations
  });

  it("returns HTTP 404 for a well-formed code that does not exist in the database", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRTDOESNOTEXIST" }), // 16 chars, SMRT prefix
    });
    expect(res.status).toBe(404);
  });

  it("returns the exact error body for a non-existent code", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRTDOESNOTEXIST" }),
    });
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("Registration not found");
  });

  it("does not return 400 for a valid-format non-existent code (distinguishes format error from not-found)", async () => {
    /**
     * Generator exploit: a broken implementation that returns 400 for all
     * lookup failures without distinguishing format errors from missing records.
     * The spec says 400 = bad format, 404 = not found — these must be distinct.
     */
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRTDOESNOTEXIST" }),
    });
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// R2.5 — Response shape: exactly the right fields
// ---------------------------------------------------------------------------

describe("R2.5 — response shape: exact field set", () => {
  /**
   * Spec R2.5: response must contain exactly:
   *   { name, regCode, attendanceIntent, attendeeCount, accommodation }
   *
   * No existing test asserts the COMPLETE key set, or that no extra keys
   * are present. A generator could omit attendeeCount and pass existing tests.
   */
  let app: ReturnType<typeof createFullApp>;
  let regCode: string;

  beforeEach(async () => {
    clearRateLimitStore();
    const svc = createService();
    const result = await svc.submit(baseSubmit);
    regCode = result.regCode;
    app = createFullApp(svc);
  });

  it("response contains the 'name' field", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    const body = await res.json<Record<string, unknown>>();
    expect("name" in body).toBe(true);
  });

  it("response contains the 'regCode' field", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    const body = await res.json<Record<string, unknown>>();
    expect("regCode" in body).toBe(true);
  });

  it("response contains the 'attendanceIntent' field", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    const body = await res.json<Record<string, unknown>>();
    expect("attendanceIntent" in body).toBe(true);
  });

  it("response contains the 'attendeeCount' field", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    const body = await res.json<Record<string, unknown>>();
    expect("attendeeCount" in body).toBe(true);
  });

  it("response contains the 'accommodation' field", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    const body = await res.json<Record<string, unknown>>();
    expect("accommodation" in body).toBe(true);
  });

  it("response has EXACTLY 5 keys — no extra fields", async () => {
    /**
     * Generator exploit: service returns all 5 spec fields PLUS extra fields
     * (e.g., id, email, createdAt). The spec says "contains only pass display
     * data" — extra keys are a spec violation even if all required keys present.
     *
     * Catches: a service implementation that returns the full Registration
     * object instead of the projected subset.
     */
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    const keys = Object.keys(body);
    expect(keys).toHaveLength(6);
    expect(keys.sort()).toEqual(
      ["accommodation", "attendanceIntent", "attendeeCount", "name", "participationType", "regCode"].sort(),
    );
  });

  it("regCode in response matches the code used in the lookup", async () => {
    /**
     * Catches: a generator that returns a hardcoded regCode instead of the
     * actual record's code.
     */
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    const body = await res.json<{ regCode: string }>();
    expect(body.regCode).toBe(regCode);
  });

  it("name in response matches the registrant's full name", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    const body = await res.json<{ name: string }>();
    expect(body.name).toBe("Arjun Nair");
  });

  it("attendeeCount is a number", async () => {
    /**
     * Type assertion: spec says attendeeCount is a count.
     * A generator could return it as a string ("0") or omit it.
     */
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    const body = await res.json<{ attendeeCount: unknown }>();
    expect(typeof body.attendeeCount).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// R2.6 — Response does NOT contain internal/sensitive fields
// ---------------------------------------------------------------------------

describe("R2.6 — sensitive fields excluded from pass response", () => {
  /**
   * Spec R2.6: "The response contains only pass display data. No internal IDs,
   * no email, no phone, no payment details, no JWT token."
   *
   * These are negative assertions. A generator that returns the full
   * Registration domain object would expose all of these. This group of
   * tests catches that exploit.
   *
   * Generator exploit: return the full Registration object from the service
   * and let the route serialize it. All 5 spec fields would be present AND
   * all forbidden fields too. R2.5's field count test catches this, but these
   * tests are explicit about WHY each field must be absent.
   */
  let app: ReturnType<typeof createFullApp>;
  let regCode: string;

  beforeEach(async () => {
    clearRateLimitStore();
    const svc = createService();
    const result = await svc.submit(baseSubmit);
    regCode = result.regCode;
    app = createFullApp(svc);
  });

  async function lookupBody(): Promise<Record<string, unknown>> {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode }),
    });
    return res.json<Record<string, unknown>>();
  }

  it("response does not contain internal database ID ('id')", async () => {
    const body = await lookupBody();
    expect("id" in body).toBe(false);
  });

  it("response does not contain email address ('email')", async () => {
    /**
     * Email is the auth identity (CLAUDE.md). Leaking it in a public
     * unauthenticated endpoint is a privacy violation.
     */
    const body = await lookupBody();
    expect("email" in body).toBe(false);
  });

  it("response does not contain phone/WhatsApp number ('whatsapp')", async () => {
    const body = await lookupBody();
    expect("whatsapp" in body).toBe(false);
  });

  it("response does not contain alternate mobile ('mobileAlternate')", async () => {
    const body = await lookupBody();
    expect("mobileAlternate" in body).toBe(false);
  });

  it("response does not contain JWT token ('token')", async () => {
    const body = await lookupBody();
    expect("token" in body).toBe(false);
  });

  it("response does not contain payment details ('totalAmount')", async () => {
    const body = await lookupBody();
    expect("totalAmount" in body).toBe(false);
  });

  it("response does not contain payment details ('pricingSnapshot')", async () => {
    const body = await lookupBody();
    expect("pricingSnapshot" in body).toBe(false);
  });

  it("response does not contain registration status ('status')", async () => {
    /**
     * Internal lifecycle state. Not part of pass display. A generator
     * returning the full Registration object would include this.
     */
    const body = await lookupBody();
    expect("status" in body).toBe(false);
  });

  it("response does not contain branch ('branch')", async () => {
    const body = await lookupBody();
    expect("branch" in body).toBe(false);
  });

  it("response does not contain timestamps ('createdAt', 'updatedAt')", async () => {
    const body = await lookupBody();
    expect("createdAt" in body).toBe(false);
    expect("updatedAt" in body).toBe(false);
  });

  it("response does not contain donation amount ('donationAmount')", async () => {
    /**
     * Financial data. Spec says no payment details.
     */
    const body = await lookupBody();
    expect("donationAmount" in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R2.5 + R2.6 combined: donation_only registration
// ---------------------------------------------------------------------------

describe("R2.5 + R2.6 — field shape holds for donation_only registrations", () => {
  /**
   * R3.5 says donation_only intent produces a thank-you, not an entry pass.
   * This confirms that the endpoint still returns the same 5-field shape —
   * the client uses attendanceIntent to decide what to render.
   * The response must not contain payment or donation data even for donors.
   */
  let app: ReturnType<typeof createFullApp>;
  let donationRegCode: string;

  beforeEach(async () => {
    clearRateLimitStore();
    const svc = createService();
    const result = await svc.submit({
      ...baseSubmit,
      attendance: {
        // donation_only carries no alumniMeal/tshirtSize — registrationSchema
        // rejects them (attendees-meals.spec.md R1/R2.4; commit 9c8d5bc).
        intent: "donation_only",
        participationType: "donation_only",
      },
      accommodation: undefined,
      donation: {
        amount: 5000,
        publicAcknowledgement: false,
        felicitationConsent: false,
      },
    });
    donationRegCode = result.regCode;
    app = createFullApp(svc);
  });

  it("donation_only response has exactly 5 keys", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: donationRegCode }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(
      ["accommodation", "attendanceIntent", "attendeeCount", "name", "participationType", "regCode"].sort(),
    );
  });

  it("donation_only response does not leak the donation amount", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: donationRegCode }),
    });
    const body = await res.json<Record<string, unknown>>();
    expect("donationAmount" in body).toBe(false);
    expect("hasDonation" in body).toBe(false);
  });

  it("donation_only attendanceIntent is preserved in response", async () => {
    /**
     * The client (R3.5) uses this value to decide not to show the entry pass.
     * If the service normalizes donation_only to 'attending', R3.5 breaks.
     */
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: donationRegCode }),
    });
    const body = await res.json<{ attendanceIntent: string }>();
    expect(body.attendanceIntent).toBe("donation_only");
  });
});

// ---------------------------------------------------------------------------
// R2.8 — Rate limiting (documented as untestable — no rate limiting in V1)
// ---------------------------------------------------------------------------

/*
 * R2.8: "No rate limiting in V1. The reg code is the credential — anyone with
 * it can view the pass."
 *
 * UNTESTABLE in this suite. Rate limiting is infrastructure-level
 * (Cloudflare WAF, not application code). This is a KNOWN GAP — document it,
 * not test it.
 *
 * What this means: repeated calls to the endpoint will succeed, but we cannot
 * write a test that proves the ABSENCE of a rate limiter. A test that makes
 * 10 requests and asserts all 200 would pass whether rate limiting exists or
 * not (if the threshold is >10). Testing the absence of a control requires
 * a threat model, not a unit test.
 */

// ---------------------------------------------------------------------------
// Client-side requirements (R1, R3) — no React test infrastructure
// ---------------------------------------------------------------------------

/*
 * The web package has no jsdom/testing-library test setup. The following
 * requirements cannot be tested as executable code in this suite.
 *
 * COVERAGE TABLE — requirements that need React test infrastructure:
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │ Requirement │ What must be tested                  │ Why untestable here   │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R1.1        │ QR value is                          │ Component prop test.  │
 * │             │ `{origin}/pass#{rawCode}`             │ Needs jsdom +         │
 * │             │ where rawCode has no dashes           │ testing-library.      │
 * │             │ and origin is window.location.origin │                       │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R1.2        │ Origin from window.location.origin,  │ Needs window mock.    │
 * │             │ never hardcoded                      │                       │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R1.3        │ QR rendered as inline SVG via        │ Needs DOM assertions. │
 * │             │ `qrcode` npm package.                │                       │
 * │             │ No canvas element, no img download.  │                       │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R1.4        │ Skeleton shown while SVG generating  │ Async render test.    │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R3.2        │ No hash → "Pass Not Recognized"      │ Needs router mock +   │
 * │             │                                      │ location.hash stub.   │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R3.4        │ attending intent → pass rendered     │ Needs API mock +      │
 * │             │ (no redirect, no navigation)         │ component render.     │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R3.5        │ donation_only → thank-you message,   │ Needs API mock +      │
 * │             │ no entry pass shown                  │ component render.     │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R3.6        │ 404 → "Pass Not Recognized"          │ Needs HTTP mock.      │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R3.7        │ Non-404 error → generic error +      │ Needs HTTP mock.      │
 * │             │ "Try Again" button                   │                       │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │ R3.8        │ Page does NOT write to localStorage  │ Needs localStorage    │
 * │             │                                      │ spy in jsdom.         │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * TO ENABLE THESE TESTS: add vitest with jsdom environment and
 * @testing-library/react to src/web/package.json devDependencies,
 * then create src/web/src/__tests__/pass-page.spec.test.tsx.
 */
