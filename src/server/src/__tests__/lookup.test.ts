/**
 * Tests for pass lookup — route-level validation and service-level behavior.
 *
 * Route tests: minimal Hono app with mock service, validates input gating.
 * Service tests: in-memory repos (subset from e2e.test.ts), validates pass data shape.
 *
 * @module lookup.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { SubmitRegistrationRequest, PricingBreakup } from "@smriti/shared";

import { RegistrationService } from "../services/registration.service.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PricingService } from "../services/pricing.service.js";
import { NotFoundError } from "../services/errors.js";
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
// In-memory repos (minimal subset — only what getPassData needs)
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

  async geographyAggregates(): Promise<{ cities: { city: string; count: number }[]; countries: { country: string; count: number }[] }> {
    return { cities: [], countries: [] };
  }

  async donorRecognitionRows(_felicitationThreshold: number): Promise<{ publicDonors: { displayName: string; amount: number; felicitationEligible: boolean }[]; nonPublicCount: number; nonPublicTotal: number }> {
    return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 };
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

// Stubs for deps getPassData doesn't touch
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
) {
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

function createLookupApp(
  mockService: Partial<AppEnv["Variables"]["registrationService"]>,
) {
  const app = new Hono<AppEnv>().basePath("/api");
  app.use("*", async (c, next) => {
    c.set(
      "registrationService",
      mockService as AppEnv["Variables"]["registrationService"],
    );
    await next();
  });
  app.route("/", registrationRoutes);
  return app;
}

// A mock service that records what code was passed and returns a canned response
function makePassServiceMock() {
  const calls: string[] = [];
  const mock = {
    calls,
    getPassData: async (code: string) => {
      calls.push(code);
      return {
        name: "Test User",
        regCode: code,
        attendanceIntent: "attending",
        participationType: "full_celebration",
        attendeeCount: 1,
        accommodation: "shared_double",
      };
    },
  };
  return mock;
}

// Canonical Registration shape used by service tests
const baseSubmit: SubmitRegistrationRequest = {
  contact: {
    fullName: "Meera Pillai",
    branch: "Computer Science & Engineering",
    gender: "female",
    email: "meera@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: "",
    city: "Kochi",
    country: "India",
  },
  attendance: {
    intent: "attending",
    participationType: "full_celebration",
    alumniMeal: "veg",
    tshirtSize: "S",
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
// Route-level validation tests
// ---------------------------------------------------------------------------

describe("POST /api/registrations/lookup — route validation", () => {
  let app: ReturnType<typeof createLookupApp>;
  let mock: ReturnType<typeof makePassServiceMock>;

  beforeEach(() => {
    clearRateLimitStore();
    mock = makePassServiceMock();
    app = createLookupApp(mock);
  });

  it("returns 400 when regCode is missing from body", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when regCode is an empty string", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a purely numeric code (no SMRT prefix)", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "1234567890123456" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when code is too short", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRT123" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when code is too long", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRTAAAAABBBBBCCCCCC" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when 16-char code has wrong prefix", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "ABCDAAAAAAAABBBB" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts a valid 16-char code without dashes and calls service", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRTAAAAAAAABBBB" }),
    });
    expect(res.status).toBe(200);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toBe("SMRTAAAAAAAABBBB");
  });

  it("strips dashes from a dash-formatted code before calling service", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRT-AAAA-AAAA-BBBB" }),
    });
    expect(res.status).toBe(200);
    expect(mock.calls[0]).toBe("SMRTAAAAAAAABBBB");
  });

  it("normalizes lowercase input to uppercase before calling service", async () => {
    const res = await app.request("/api/registrations/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "smrt-aaaa-aaaa-bbbb" }),
    });
    expect(res.status).toBe(200);
    expect(mock.calls[0]).toBe("SMRTAAAAAAAABBBB");
  });
});

// ---------------------------------------------------------------------------
// Service-level tests (getPassData)
// ---------------------------------------------------------------------------

describe("RegistrationService.getPassData", () => {
  it("returns the correct shape for a known registration", async () => {
    const svc = createService();
    const { regCode } = await svc.submit(baseSubmit);

    const result = await svc.getPassData(regCode);

    expect(result.name).toBe("Meera Pillai");
    expect(result.regCode).toBe(regCode);
    expect(result.attendanceIntent).toBe("attending");
    expect(result.attendeeCount).toBe(0); // no spouse/children/guests
    expect(result.accommodation).toBe("shared_double");
  });

  it("throws NotFoundError for an unknown reg code", async () => {
    const svc = createService();
    await expect(svc.getPassData("SMRTUNKNOWN000001")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("returns attendeeCount 0 when no attendees added", async () => {
    const svc = createService();
    const { regCode } = await svc.submit(baseSubmit);

    const result = await svc.getPassData(regCode);
    expect(result.attendeeCount).toBe(0);
  });

  it("returns attendeeCount 3 for a registration with spouse + 2 children", async () => {
    const svc = createService();
    const { regCode } = await svc.submit({
      ...baseSubmit,
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-16",
        extraBed: false,
      },
      attendees: {
        spouse: { name: "Kavitha Pillai", meal: "veg" },
        children: [
          { id: "c1", name: "Child One", age: 10, meal: "veg" },
          { id: "c2", name: "Child Two", age: 7, meal: "non_veg" },
        ],
        guests: [],
      },
    });

    const result = await svc.getPassData(regCode);
    expect(result.attendeeCount).toBe(3);
  });

  it("returns attendanceIntent 'donation_only' for a donation-only registration", async () => {
    const svc = createService();
    const { regCode } = await svc.submit({
      ...baseSubmit,
      attendance: {
        // donation_only carries no alumniMeal/tshirtSize — registrationSchema
        // rejects them (attendees-meals.spec.md R1/R2.4; commit 9c8d5bc).
        intent: "donation_only",
        participationType: "donation_only",
      },
      accommodation: undefined,
      donation: {
        amount: 1000,
        publicAcknowledgement: false,
        felicitationConsent: false,
      },
    });

    const result = await svc.getPassData(regCode);
    expect(result.attendanceIntent).toBe("donation_only");
  });
});
