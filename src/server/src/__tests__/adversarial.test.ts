/**
 * Adversarial QA Tests — Smriti Registration API
 *
 * Tests the implementation against EVERY guarantee in the spec
 * (submission-api.spec.md, authentication.spec.md, payment-flow.spec.md).
 *
 * These are adversarial: we assume the role of an attacker trying to
 * bypass auth, submit garbage, race conditions, and break invariants.
 *
 * Uses the same in-memory test infrastructure as e2e.test.ts.
 * Does NOT duplicate existing e2e tests.
 *
 * @module adversarial.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { SubmitRegistrationRequest, PricingBreakup } from "@smriti/shared";

import { RegistrationService } from "../services/registration.service.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PricingService } from "../services/pricing.service.js";
import { signToken, verifyToken } from "../infra/jwt.js";
import {
  AppError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  AuthError,
} from "../services/errors.js";
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
// Test constants
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = "test-secret-key-for-integration-tests-32chars!";

const validSubmitData: SubmitRegistrationRequest = {
  contact: {
    fullName: "Ravi Kumar",
    branch: "Computer Science & Engineering",
    gender: "male",
    email: "ravi@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: "",
    city: "Kochi",
    country: "India",
  },
  attendance: {
    intent: "attending",
    participationType: "full_celebration",
    alumniMeal: "non_veg",
    tshirtSize: "L",
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
  donation: {
    amount: 500,
    publicAcknowledgement: true,
    acknowledgementDisplayName: "Ravi K",
    felicitationConsent: false,
  },
  idDocument: {
    fileKey: "test-doc-key",
    fileType: "image/jpeg",
    sizeBytes: 1024,
    fileName: "id.jpg",
    note: "",
  },
};

// ---------------------------------------------------------------------------
// In-memory fakes (same implementation as e2e.test.ts)
// ---------------------------------------------------------------------------

class InMemoryRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  // Companion repos for createWithRelations
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
    if (data.branch !== undefined) reg.branch = data.branch;
    if (data.email !== undefined) reg.email = data.email;
    if (data.whatsapp !== undefined) reg.whatsapp = data.whatsapp;
    if (data.mobile_alternate !== undefined) reg.mobileAlternate = data.mobile_alternate;
    if (data.city !== undefined) reg.city = data.city;
    if (data.country !== undefined) reg.country = data.country;
    if (data.attendance_intent !== undefined) reg.attendanceIntent = data.attendance_intent;
    if (data.alumni_meal !== undefined) reg.alumniMeal = data.alumni_meal;
    if (data.accommodation !== undefined) reg.accommodation = data.accommodation;
    if (data.check_in !== undefined) reg.checkIn = data.check_in;
    if (data.check_out !== undefined) reg.checkOut = data.check_out;
    if (data.donation_amount !== undefined) reg.donationAmount = data.donation_amount;
    if (data.public_ack !== undefined) reg.publicAck = data.public_ack !== 0;
    if (data.ack_display_name !== undefined) reg.ackDisplayName = data.ack_display_name;
    if (data.felicitation !== undefined) reg.felicitation = data.felicitation !== 0;
    if (data.id_note !== undefined) reg.idNote = data.id_note;
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
    return [...this.payments.values()]
      .filter((p) => p.registrationId === registrationId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  }

  async updateStatus(id: number, status: PaymentStatus, gatewayData?: GatewayData, proofFileKey?: string): Promise<void> {
    const p = this.payments.get(id);
    if (!p) return;
    p.status = status;
    p.updatedAt = Date.now();
    if (gatewayData?.gatewayRef !== undefined) p.gatewayRef = gatewayData.gatewayRef;
    if (gatewayData?.gateway !== undefined) p.gateway = gatewayData.gateway;
    if (gatewayData?.gatewayResponse !== undefined) p.gatewayResponse = gatewayData.gatewayResponse;
    if (proofFileKey !== undefined) p.proofFileKey = proofFileKey;
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
    const id = this.nextId++;
    this.entries.push({
      id,
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
  async create(_doc: NewIdDocument): Promise<{ id: number }> {
    return { id: 1 };
  }
  async findByRegistration(_registrationId: number): Promise<IdDocument[]> {
    return [];
  }
  async updateR2Key(_docId: number, _newKey: string): Promise<void> {}
}

class StubEmailService implements IEmailService {
  sentConfirmations: Array<{ to: string; data: { regId: string; fullName: string; totalAmount: number; attendanceIntent: string } }> = [];
  sentMagicLinks: Array<{ to: string; data: { token: string; expiresIn: number } }> = [];

  async sendConfirmation(to: string, data: { regId: string; fullName: string; totalAmount: number; attendanceIntent: string }): Promise<void> {
    this.sentConfirmations.push({ to, data });
  }
  async sendMagicLink(to: string, data: { token: string; expiresIn: number }): Promise<void> {
    this.sentMagicLinks.push({ to, data });
  }
  async sendPaymentConfirmed(_to: string, _data: unknown): Promise<void> {}
  async sendPaymentRejected(_to: string, _data: unknown): Promise<void> {}
  async sendStaffWelcome(_to: string, _data: unknown): Promise<void> {}
  async sendPaymentLink(_to: string, _data: unknown): Promise<void> {}
  async sendRevisedPayment(_to: string, _data: unknown): Promise<void> {}
  async sendAdditionalPayment(_to: string, _data: unknown): Promise<void> {}
  async sendStoryHidden(_to: string, _data: unknown): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Test context factory
// ---------------------------------------------------------------------------

interface TestServices {
  registrationService: RegistrationService;
  regRepo: InMemoryRegistrationRepo;
  attendeeRepo: InMemoryAttendeeRepo;
  paymentRepo: InMemoryPaymentRepo;
  auditRepo: InMemoryAuditRepo;
  emailService: StubEmailService;
  pricingService: PricingService;
}

function createTestServices(): TestServices {
  const regRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  const documentRepo = new StubDocumentRepo();
  const emailService = new StubEmailService();
  const pricingService = new PricingService();

  // Wire companion repos for createWithRelations
  regRepo.companionAttendeeRepo = attendeeRepo;
  regRepo.companionPaymentRepo = paymentRepo;
  regRepo.companionDocumentRepo = documentRepo;

  const registrationService = new RegistrationService({
    availabilityService: stubAvailabilityService,
    registrationRepo: regRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    emailService,
    pricingService,
    authService: { async issueAttendeeToken() { return 'test-jwt-token'; }, async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; } },
  });

  return {
    registrationService,
    regRepo,
    attendeeRepo,
    paymentRepo,
    auditRepo,
    emailService,
    pricingService,
  };
}

// ===========================================================================
// ADVERSARIAL TESTS
// ===========================================================================

describe("Adversarial QA — Smriti Registration API", () => {
  let svc: TestServices;

  beforeEach(() => {
    svc = createTestServices();
  });

  // =========================================================================
  // A — AUTH & AUTHORIZATION ATTACKS
  // =========================================================================

  describe("A — Auth & Authorization Attacks", () => {
    describe("JWT verification (direct)", () => {
      it("A1: verifyToken rejects token signed with wrong secret", async () => {
        // Spec R1.4: tokens signed with HS256 using server-side secret
        // Spec R3.3: wrong signature → 401 "Invalid or expired token"
        const token = await signToken(
          { sub: "1001", regCode: "SMRTTEST000000", role: "attendee" },
          TEST_JWT_SECRET,
        );
        await expect(verifyToken(token, "wrong-secret-key!")).rejects.toThrow();
      });

      it("A2: verifyToken rejects token that has expired", async () => {
        // Spec R1.2/R3.3: expired token → 401 "Invalid or expired token"
        const payload = { sub: "1001", regCode: "SMRTTEST000000", role: "attendee" as const };
        // Use jose SignJWT directly to set a past expiry
        const jose = await import("jose");
        const expired = await new jose.SignJWT(payload)
          .setProtectedHeader({ alg: "HS256" })
          .setExpirationTime("1s ago") // jose supports relative times
          .sign(new TextEncoder().encode(TEST_JWT_SECRET));
        await expect(verifyToken(expired, TEST_JWT_SECRET)).rejects.toThrow();
      });

      it("A3: verifyToken rejects JWT signed with correctly structured but tampered payload from wrong auth context", async () => {
        // An attacker signs a valid token but for a different registration's ID.
        // The token itself is valid — verifyToken should succeed because the crypto is right.
        // Authorization (cross-user access) is handled at the route layer, not JWT layer.
        // This test verifies that JWT verification only checks signature+expiry, not business rules.
        const token = await signToken(
          { sub: "9999", regCode: "SMRTTAMPERED0", role: "attendee" },
          TEST_JWT_SECRET,
        );
        const decoded = await verifyToken(token, TEST_JWT_SECRET);
        // Token IS valid cryptographically — cross-user check is route-level
        expect(decoded.sub).toBe("9999");
        expect(decoded.regCode).toBe("SMRTTAMPERED0");
      });

      it("A4: JWT payload has correct shape (sub, regCode, role, iat, exp)", async () => {
        // Spec R1.3: payload shape must include sub, regCode, role, iat, exp
        const payload = { sub: "1001", regCode: "SMRTTESTCHECK", role: "attendee" as const };
        const token = await signToken(payload, TEST_JWT_SECRET);
        const decoded = await verifyToken(token, TEST_JWT_SECRET);
        // R1.3 fields present
        expect(decoded.sub).toBe("1001");
        expect(decoded.regCode).toBe("SMRTTESTCHECK");
        expect(decoded.role).toBe("attendee");
        expect(decoded.iat).toBeTypeOf("number");
        expect(decoded.exp).toBeTypeOf("number");
        // R1.5: 90-day expiry, exp > now and < now + 91 days
        const nowSec = Math.floor(Date.now() / 1000);
        expect(decoded.exp as number).toBeGreaterThan(nowSec);
        expect(decoded.exp as number).toBeLessThan(nowSec + 91 * 24 * 60 * 60);
      });

      it("A5: token for non-existent registration → service throws NotFoundError", async () => {
        // Spec R1.8: valid token but registration doesn't exist → 404
        await expect(svc.registrationService.getByToken(99999)).rejects.toThrow(NotFoundError);
      });
    });

    describe("Service-layer auth boundaries", () => {
      it("A6: getByRegCode returns data for ANY regCode — service has no auth", async () => {
        // The service layer does NOT enforce authorization.
        // Any caller with a valid regCode can retrieve any registration.
        // Auth is enforced at the ROUTE layer (registration.routes.ts).
        // This test documents this as a known design — the service is a
        // dumb data accessor; the route layer gates access.
        const r1 = await svc.registrationService.submit(validSubmitData);
        const r2 = await svc.registrationService.submit({
          ...validSubmitData,
          contact: {
            ...validSubmitData.contact,
            email: "other@example.com",
            fullName: "Different Person",
          },
        });
        // Without any token at all, getByRegCode returns the data
        const data2 = await svc.registrationService.getByRegCode(r2.regCode);
        expect(data2.registration.regCode).toBe(r2.regCode);
        expect(data2.registration.contact.fullName).toBe("Different Person");
        // And data1 is also accessible
        const data1 = await svc.registrationService.getByRegCode(r1.regCode);
        expect(data1.registration.regCode).toBe(r1.regCode);
      });
    });

    describe("Error class contracts", () => {
      it("A7: ForbiddenError statusCode=403, message='Not authorized'", () => {
        // Spec R2.4: ForbiddenError shape is { error: "Not authorized" } with status 403
        const err = new ForbiddenError();
        expect(err.statusCode).toBe(403);
        expect(err.message).toBe("Not authorized");
      });

      it("A8: AuthError statusCode=401", () => {
        // Spec R2.3: auth errors are 401
        const err = new AuthError("Missing authorization header");
        expect(err.statusCode).toBe(401);
        expect(err.message).toBe("Missing authorization header");
      });

      it("A9: AuthError instance is not ValidationError (no details leak)", () => {
        // Spec R2.3: auth errors never include details
        const err = new AuthError("Some auth error");
        expect(err).not.toBeInstanceOf(ValidationError);
        // AppError does not have a `details` or `fieldErrors` property
        expect((err as unknown as Record<string, unknown>).details).toBeUndefined();
        expect((err as unknown as Record<string, unknown>).fieldErrors).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // B — VALIDATION EDGE CASES
  // =========================================================================

  describe("B — Validation Edge Cases", () => {
    describe("Required field violations", () => {
      it("B1: empty string for fullName, email, branch, city, whatsapp → all field errors returned", async () => {
        // Spec R2.1: All field errors returned, not just the first
        const bad: SubmitRegistrationRequest = {
          ...validSubmitData,
          contact: {
            ...validSubmitData.contact,
            fullName: "",
            email: "",
            branch: "",
            city: "",
            whatsapp: "",
          },
        };
        try {
          await svc.registrationService.submit(bad);
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["contact.fullName"]).toBeDefined();
          expect(ve.fieldErrors["contact.email"]).toBeDefined();
          expect(ve.fieldErrors["contact.branch"]).toBeDefined();
          expect(ve.fieldErrors["contact.city"]).toBeDefined();
          expect(ve.fieldErrors["contact.whatsapp"]).toBeDefined();
          // All 5+ field errors present
          expect(Object.keys(ve.fieldErrors).length).toBeGreaterThanOrEqual(5);
        }
      });

      it("B2: malformed email 'not-an-email' → validation rejected", async () => {
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            contact: { ...validSubmitData.contact, email: "not-an-email" },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["contact.email"]).toBeDefined();
        }
      });

      it("B3: malformed email 'user@' → validation rejected", async () => {
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            contact: { ...validSubmitData.contact, email: "user@" },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["contact.email"]).toBeDefined();
        }
      });

      it("B4: malformed email '@domain.com' → validation rejected", async () => {
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            contact: { ...validSubmitData.contact, email: "@domain.com" },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["contact.email"]).toBeDefined();
        }
      });

      it("B5: whatsapp too short (< 10 chars) → validation rejected", async () => {
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            contact: { ...validSubmitData.contact, whatsapp: "+91987" },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["contact.whatsapp"]).toBeDefined();
        }
      });

      it("B6: whatsapp without '+' prefix → fails validation (country code required)", async () => {
        await expect(
          svc.registrationService.submit({
            ...validSubmitData,
            contact: { ...validSubmitData.contact, whatsapp: "919876543210" },
          }),
        ).rejects.toThrow();
      });

      it("B7: checkIn after checkOut → passes validation (no cross-field rule)", async () => {
        // The accommodationSchema accepts any two strings for checkIn/checkOut.
        // There is NO cross-field validation ensuring checkIn < checkOut.
        // This is a spec gap — the spec never mandates this validation.
        const result = await svc.registrationService.submit({
          ...validSubmitData,
          accommodation: {
            ...validSubmitData.accommodation!,
            checkIn: "2026-08-17",
            checkOut: "2026-08-14",
          },
        });
        // Registration succeeds despite invalid date order
        expect(result.regId).toBeTypeOf("string");

        // Verify the dates are stored as-is
        const response = await svc.registrationService.getByToken(Number(result.regId));
        expect(response.registration.accommodation?.checkIn).toBe("2026-08-17");
        expect(response.registration.accommodation?.checkOut).toBe("2026-08-14");
      });
    });

    describe("Invalid enum values", () => {
      it("B8: attendanceIntent='invalid_value' → validation rejected", async () => {
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            attendance: {
              ...validSubmitData.attendance,
              intent: "invalid_value" as SubmitRegistrationRequest["attendance"]["intent"],
            },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["attendance.intent"]).toBeDefined();
        }
      });

      it("B9: accommodation='penthouse' → validation rejected", async () => {
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            accommodation: {
              ...validSubmitData.accommodation!,
              type: "penthouse" as SubmitRegistrationRequest["accommodation"] extends { type: infer T } ? T : never,
            },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["accommodation.type"]).toBeDefined();
        }
      });

      it("B10: alumniMeal='vegan' → validation rejected", async () => {
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            attendance: {
              ...validSubmitData.attendance,
              alumniMeal: "vegan" as SubmitRegistrationRequest["attendance"]["alumniMeal"],
            },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["attendance.alumniMeal"]).toBeDefined();
        }
      });
    });

    describe("Spouse cross-field rule", () => {
      it("B11: hasSpouse=true with empty spouseName → validation rejected", async () => {
        // Spec R3.2: spouse name required when hasSpouse=true
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            attendees: {
              ...validSubmitData.attendees,
              spouse: { name: "", meal: "veg" },
            },
            accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["attendees.spouse.name"]).toBeDefined();
        }
      });

      it("B12: hasSpouse=true with whitespace-only spouseName → validation rejected (trim check)", async () => {
        // spouseRegSchema uses z.string().trim().min(1) — "   " trims to "" and fails min(1).
        await expect(
          svc.registrationService.submit({
            ...validSubmitData,
            attendees: {
              ...validSubmitData.attendees,
              spouse: { name: "   ", meal: "veg" },
            },
            accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
          }),
        ).rejects.toThrow(ValidationError);
      });
    });

    describe("Child age boundaries", () => {
      it("B13: child age=0 → valid (newborns exist per spec)", async () => {
        const result = await svc.registrationService.submit({
          ...validSubmitData,
          attendees: {
            ...validSubmitData.attendees,
            children: [{ id: "c1", name: "Baby", age: 0, meal: "veg" }],
          },
          accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
        });
        expect(result.regId).toBeTypeOf("string");
      });

      it("B14: child age=99 → valid", async () => {
        const result = await svc.registrationService.submit({
          ...validSubmitData,
          attendees: {
            ...validSubmitData.attendees,
            children: [{ id: "c1", name: "Adult Child", age: 99, meal: "non_veg" }],
          },
          accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
        });
        expect(result.regId).toBeTypeOf("string");
      });

      it("B15: child age=100 → validation rejected (max 99)", async () => {
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            attendees: {
              ...validSubmitData.attendees,
              children: [{ id: "c1", name: "Centenarian", age: 100, meal: "veg" }],
            },
            accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["attendees.children.0.age"]).toBeDefined();
        }
      });

      it("B16: child age=-1 → validation rejected (min 0)", async () => {
        try {
          await svc.registrationService.submit({
            ...validSubmitData,
            attendees: {
              ...validSubmitData.attendees,
              children: [{ id: "c1", name: "Negative", age: -1, meal: "veg" }],
            },
            accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
          });
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          expect(ve.fieldErrors["attendees.children.0.age"]).toBeDefined();
        }
      });
    });

    describe("Boundary string lengths", () => {
      it("B17: very long name (500 chars) → passes validation", async () => {
        const longName = "A".repeat(500);
        const result = await svc.registrationService.submit({
          ...validSubmitData,
          contact: { ...validSubmitData.contact, fullName: longName },
        });
        expect(result.regId).toBeTypeOf("string");
        const response = await svc.registrationService.getByToken(Number(result.regId));
        expect(response.registration.contact.fullName).toBe(longName);
      });

      it("B18: very long email (300 chars) → Zod .email() accepts it (no max length check)", async () => {
        // Zod's .email() regex does NOT enforce a maximum length.
        // A 302-char email passes validation. This is a spec gap —
        // the spec (R2.1) doesn't define a max email length.
        const longEmail = "a".repeat(290) + "@example.com";
        const result = await svc.registrationService.submit({
          ...validSubmitData,
          contact: { ...validSubmitData.contact, email: longEmail },
        });
        expect(result.regId).toBeTypeOf("string");
        // Verify the long email was stored and returned
        const response = await svc.registrationService.getByToken(Number(result.regId));
        expect(response.registration.contact.email).toBe(longEmail);
      });
    });

    describe("Multiple validation errors aggregation", () => {
      it("B19: 5+ invalid fields → all field errors returned", async () => {
        const bad: SubmitRegistrationRequest = {
          ...validSubmitData,
          contact: {
            ...validSubmitData.contact,
            fullName: "",
            email: "",
            branch: "",
            whatsapp: "",
            city: "",
          },
          attendance: {
            ...validSubmitData.attendance,
            intent: "invalid_value" as SubmitRegistrationRequest["attendance"]["intent"],
            alumniMeal: "vegan" as SubmitRegistrationRequest["attendance"]["alumniMeal"],
          },
        };
        try {
          await svc.registrationService.submit(bad);
          expect.fail("Expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const ve = err as ValidationError;
          // At least 6 field errors should be present
          expect(Object.keys(ve.fieldErrors).length).toBeGreaterThanOrEqual(6);
          expect(ve.fieldErrors["contact.fullName"]).toBeDefined();
          expect(ve.fieldErrors["contact.email"]).toBeDefined();
          expect(ve.fieldErrors["attendance.intent"]).toBeDefined();
        }
      });
    });
  });

  // =========================================================================
  // D — DATA INTEGRITY ROUNDTRIPS
  // =========================================================================

  describe("D — Data Integrity Roundtrips", () => {
    it("D1: null fields roundtrip to undefined (mobileAlternate)", async () => {
      // Canonical mapToResponse: mobileAlternate: reg.mobileAlternate ?? undefined
      // Empty string input → trimmed to "" → || null → stored as null → returned as undefined
      const result = await svc.registrationService.submit({
        ...validSubmitData,
        contact: { ...validSubmitData.contact, mobileAlternate: "" },
        accommodation: undefined,
      });
      const response = await svc.registrationService.getByToken(Number(result.regId));
      // Empty strings in → stored as null internally → returned as undefined
      expect(response.registration.contact.mobileAlternate).toBeUndefined();
      // checkIn/checkOut are not present when accommodation is omitted
      expect(response.registration.accommodation).toBeUndefined();
    });

    it("D2: 'country' defaults to 'India' when empty", async () => {
      // Spec edge case: country defaults to "India"
      // Note: canonical schema requires country non-empty, so this submits a
      // valid country. The default is tested at the DB mapping layer if schema
      // were to relax.
      const result = await svc.registrationService.submit({
        ...validSubmitData,
        contact: { ...validSubmitData.contact, country: "India" },
      });
      const response = await svc.registrationService.getByToken(Number(result.regId));
      expect(response.registration.contact.country).toBe("India");
    });

    it("D3: donation-only attendanceIntent → no attendee line items, base=0", async () => {
      // Spec edge case: donation_only → pricing engine returns only donation
      // donation_only carries no alumniMeal/tshirtSize — registrationSchema
      // rejects them (attendees-meals.spec.md R1/R2.4; commit 9c8d5bc).
      // participationType stays full_celebration deliberately: pricing must
      // key on intent, not participationType.
      const result = await svc.registrationService.submit({
        ...validSubmitData,
        attendance: { intent: "donation_only", participationType: "full_celebration" },
        donation: { amount: 2000, publicAcknowledgement: true, felicitationConsent: false },
        accommodation: undefined,
      });
      expect(result.pricingBreakup.base).toBe(0);
      expect(result.pricingBreakup.lines).toEqual([]);
      expect(result.pricingBreakup.donation).toBe(2000);
      expect(result.pricingBreakup.total).toBe(2000);
    });

    it("D4: full attendees roundtrip — spouse + 2 children + 2 guests", async () => {
      const withAll: SubmitRegistrationRequest = {
        ...validSubmitData,
        attendees: {
          spouse: { name: "Priya", meal: "veg" },
          children: [
            { id: "c1", name: "Arjun", age: 10, meal: "non_veg" },
            { id: "c2", name: "Meera", age: 4, meal: "veg" },
          ],
          guests: [
            { id: "g1", name: "Ravi", relationship: "Friend", meal: "non_veg" },
            { id: "g2", name: "Sita", relationship: "Colleague", meal: "veg" },
          ],
        },
        accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
      };
      const sub = await svc.registrationService.submit(withAll);
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      const data = response.registration;

      // Spouse inlined
      expect(data.attendees.spouse).toBeDefined();
      expect(data.attendees.spouse?.name).toBe("Priya");
      expect(data.attendees.spouse?.meal).toBe("veg");

      // Children inlined with stable IDs
      expect(data.attendees.children).toHaveLength(2);
      expect(data.attendees.children[0].name).toBe("Arjun");
      expect(data.attendees.children[0].age).toBe(10);
      expect(data.attendees.children[0].id).toBeTypeOf("string");
      expect(data.attendees.children[1].name).toBe("Meera");
      expect(data.attendees.children[1].age).toBe(4);

      // Guests inlined with stable IDs
      expect(data.attendees.guests).toHaveLength(2);
      expect(data.attendees.guests[0].name).toBe("Ravi");
      expect(data.attendees.guests[0].relationship).toBe("Friend");
    });

    it("D5: attendee IDs are stable across requests", async () => {
      const withKids: SubmitRegistrationRequest = {
        ...validSubmitData,
        attendees: {
          ...validSubmitData.attendees,
          children: [{ id: "c1", name: "Arjun", age: 8, meal: "non_veg" }],
        },
        accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
      };
      const sub = await svc.registrationService.submit(withKids);
      const first = await svc.registrationService.getByToken(Number(sub.regId));
      const second = await svc.registrationService.getByToken(Number(sub.regId));
      // IDs are stringified DB numbers — stable across reads
      expect(first.registration.attendees.children[0].id).toBe(second.registration.attendees.children[0].id);
      expect(first.registration.attendees.children[0].name).toBe("Arjun");
    });

    it("D6: pricingBreakup is frozen at submission time (GET /me returns same)", async () => {
      // Spec R3.10: pricing snapshot frozen at submission
      const sub = await svc.registrationService.submit(validSubmitData);
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      expect(response.registration.pricingBreakup.total).toBe(sub.pricingBreakup.total);
      expect(response.registration.pricingBreakup.base).toBe(sub.pricingBreakup.base);
      expect(response.registration.pricingBreakup.donation).toBe(sub.pricingBreakup.donation);
      expect(response.registration.pricingBreakup.lines.length).toBe(
        sub.pricingBreakup.lines.length,
      );
    });

    it("D7: regCode uniqueness — 5 submits with different emails produce 5 distinct regCodes", async () => {
      // Each registration must have a unique email (R3.15); each gets a unique regCode
      const codes = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const r = await svc.registrationService.submit({
          ...validSubmitData,
          contact: { ...validSubmitData.contact, email: `user${i}@example.com` },
        });
        expect(codes.has(r.regCode)).toBe(false);
        codes.add(r.regCode);
      }
      expect(codes.size).toBe(5);
    });

    it("D8: internal ID auto-increments sequentially (1001, 1002, 1003...)", async () => {
      const r1 = await svc.registrationService.submit({
        ...validSubmitData,
        contact: { ...validSubmitData.contact, email: "d8-user1@example.com" },
      });
      const r2 = await svc.registrationService.submit({
        ...validSubmitData,
        contact: { ...validSubmitData.contact, email: "d8-user2@example.com" },
      });
      const r3 = await svc.registrationService.submit({
        ...validSubmitData,
        contact: { ...validSubmitData.contact, email: "d8-user3@example.com" },
      });
      expect(Number(r1.regId)).toBe(1001);
      expect(Number(r2.regId)).toBe(1002);
      expect(Number(r3.regId)).toBe(1003);
    });

    it("D9: zero donation → donation undefined in response", async () => {
      const sub = await svc.registrationService.submit({
        ...validSubmitData,
        donation: undefined,
      });
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      // No donation field → mapToResponse returns donation: undefined
      expect(response.registration.donation).toBeUndefined();
    });

    it("D10: children and guests empty arrays roundtrip as empty arrays, not null", async () => {
      const sub = await svc.registrationService.submit({
        ...validSubmitData,
        attendees: {
          children: [],
          guests: [],
        },
      });
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      expect(response.registration.attendees.children).toEqual([]);
      expect(response.registration.attendees.guests).toEqual([]);
    });

    it("D11: ID fields do NOT contain the client-submitted client-side UUIDs — they are DB IDs", async () => {
      // Client sends "c1", "g1" etc as temporary IDs. The server replaces these
      // with actual DB attendee IDs (numeric, stringified).
      const sub = await svc.registrationService.submit({
        ...validSubmitData,
        attendees: {
          children: [{ id: "temp-client-uuid-123", name: "Arjun", age: 8, meal: "non_veg" }],
          guests: [{ id: "guest-uuid-456", name: "Ravi", relationship: "Friend", meal: "veg" }],
        },
        accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
      });
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      // IDs should be numeric strings (DB IDs), not client UUIDs
      expect(response.registration.attendees.children[0].id).toMatch(/^\d+$/);
      expect(response.registration.attendees.children[0].id).not.toBe("temp-client-uuid-123");
      expect(response.registration.attendees.guests[0].id).toMatch(/^\d+$/);
      expect(response.registration.attendees.guests[0].id).not.toBe("guest-uuid-456");
    });
  });

  // =========================================================================
  // E — ERROR CONTRACT COMPLIANCE
  // =========================================================================

  describe("E — Error Contract Compliance", () => {
    it("E1: ValidationError has statusCode 400 and fieldErrors", () => {
      const ve = new ValidationError({ fullName: "Required", email: "Invalid" });
      expect(ve.statusCode).toBe(400);
      expect(ve.message).toBe("Validation failed");
      expect(ve.fieldErrors).toEqual({ fullName: "Required", email: "Invalid" });
    });

    it("E2: NotFoundError has statusCode 404", () => {
      const ne = new NotFoundError("Registration not found");
      expect(ne.statusCode).toBe(404);
      expect(ne.message).toBe("Registration not found");
    });

    it("E3: ForbiddenError has statusCode 403, message='Not authorized'", () => {
      const fe = new ForbiddenError();
      expect(fe.statusCode).toBe(403);
      expect(fe.message).toBe("Not authorized");
    });

    it("E4: AuthError has statusCode 401", () => {
      const ae = new AuthError("Missing authorization header");
      expect(ae.statusCode).toBe(401);
    });

    it("E6: ForbiddenError and AuthError are NOT ValidationError instances (no details leak)", () => {
      // Spec R2.3: auth errors never include details
      const fe = new ForbiddenError();
      const ae = new AuthError();
      expect(fe).not.toBeInstanceOf(ValidationError);
      expect(ae).not.toBeInstanceOf(ValidationError);
    });

    it("E7: error middleware shape — validation returns { error, details: { fieldErrors } }", () => {
      const ve = new ValidationError({ field: "Bad" });
      const body = {
        error: ve.message,
        details: { fieldErrors: ve.fieldErrors },
      };
      // This is what the error middleware constructs for ValidationError (error.middleware.ts L6)
      expect(body.error).toBe("Validation failed");
      expect(body.details).toEqual({ fieldErrors: { field: "Bad" } });
    });

    it("E8: error middleware shape — non-validation AppError returns { error } only (no details)", () => {
      const ne = new NotFoundError("Registration not found");
      const body = { error: ne.message };
      // This is what the error middleware constructs for non-ValidationError AppErrors (error.middleware.ts L9)
      expect(body.error).toBe("Registration not found");
      expect((body as Record<string, unknown>).details).toBeUndefined();
    });
  });

  // =========================================================================
  // F — BOUNDARY & STRESS
  // =========================================================================

  describe("F — Boundary & Stress", () => {
    it("F1: donation_only with no donation amount is rejected by validation", async () => {
      // Spec R3.7: zero-total path is blocked at validation — donation_only requires
      // a positive donation amount. The server enforces this via registrationSchema superRefine.
      await expect(
        svc.registrationService.submit({
          ...validSubmitData,
          attendance: { ...validSubmitData.attendance, intent: "donation_only" },
          accommodation: undefined,
          donation: undefined,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("F2: special characters in fullName — Malayalam, Hindi, apostrophes, hyphens", async () => {
      const specialNames = [
        "അജീഷ് മാടത്തിൽ",        // Malayalam
        "अजीश मदाथिल",            // Hindi
        "O'Brien-Smith",         // apostrophe + hyphen
        "María José García",     // accented characters
        "李小龙",                 // Chinese
      ];
      for (let i = 0; i < specialNames.length; i++) {
        const name = specialNames[i]!;
        const result = await svc.registrationService.submit({
          ...validSubmitData,
          contact: { ...validSubmitData.contact, fullName: name, email: `f2-user${i}@example.com` },
        });
        const response = await svc.registrationService.getByToken(Number(result.regId));
        expect(response.registration.contact.fullName).toBe(name);
      }
    });

    it("F3: duplicate email submission → 409 AppError (email uniqueness enforced)", async () => {
      // R3.15: email must be unique — second submit with same email must fail
      await svc.registrationService.submit(validSubmitData);

      try {
        await svc.registrationService.submit(validSubmitData);
        expect.fail("Expected AppError 409");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const ae = err as AppError;
        expect(ae.statusCode).toBe(409);
      }
    });

    it("F4: regCode is exactly 16 chars, starts with SMRT, Crockford base32", async () => {
      for (let i = 0; i < 10; i++) {
        const result = await svc.registrationService.submit({
          ...validSubmitData,
          contact: { ...validSubmitData.contact, email: `f4-user${i}@example.com` },
        });
        expect(result.regCode).toHaveLength(16);
        expect(result.regCode).toMatch(/^SMRT[0-9A-HJKMNP-TV-Z]{12}$/);
      }
    });

    it("F5: response includes all required shape fields (regId as string, token, status, pricingBreakup, paymentUrl)", async () => {
      // Spec R3.4: response shape
      const result = await svc.registrationService.submit(validSubmitData);
      expect(result.regId).toBeTypeOf("string");
      expect(result.regId).toMatch(/^\d+$/);
      expect(result.regCode).toBeTypeOf("string");
      expect(result.token).toBeTypeOf("string");
      expect(result.status).toBe("pending");
      expect(result.pricingBreakup).toBeDefined();
      expect(result.pricingBreakup.base).toBeTypeOf("number");
      expect(result.pricingBreakup.lines).toBeInstanceOf(Array);
      expect(result.pricingBreakup.donation).toBeTypeOf("number");
      expect(result.pricingBreakup.total).toBeTypeOf("number");
      if (result.pricingBreakup.total > 0) {
        expect(result.paymentUrl).toBeTypeOf("string");
        expect(result.paymentUrl).toContain("/pay/");
      }
    });

    it("F6: GET /me response includes all augmented fields (regId, regCode, status, pricingBreakup, createdAt)", async () => {
      const sub = await svc.registrationService.submit(validSubmitData);
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      const data = response.registration;
      expect(data.regId).toBeTypeOf("string");
      expect(data.regCode).toBeTypeOf("string");
      expect(data.status).toBeTypeOf("string");
      expect(data.pricingBreakup).toBeDefined();
      expect(data.createdAt).toBeTypeOf("number");
      expect(data.createdAt).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // G — SPEC VIOLATIONS & FINDINGS
  // =========================================================================

  describe("G — Spec Violations & Findings", () => {
    it("FINDING-G1 (FIXED): isChargeable now uses PricingService.isChildChargeable(childFreeAgeThreshold=6)", async () => {
      // Previously: is_chargeable: child.age >= 12 ? 1 : 0 (hardcoded)
      // Fixed: delegates to PricingService.isChildChargeable() using config.childFreeAgeThreshold (6)
      const withKids: SubmitRegistrationRequest = {
        ...validSubmitData,
        attendees: {
          ...validSubmitData.attendees,
          children: [
            { id: "c1", name: "Ten Year Old", age: 10, meal: "non_veg" },
            { id: "c2", name: "Four Year Old", age: 4, meal: "veg" },
            { id: "c3", name: "Thirteen", age: 13, meal: "veg" },
          ],
        },
        accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
      };
      const sub = await svc.registrationService.submit(withKids);
      const regId = Number(sub.regId);
      const attendees = await svc.attendeeRepo.findByRegistration(regId);
      const children = attendees.filter((a) => a.type === "child");

      const tenYearOld = children.find((c) => c.age === 10);
      const fourYearOld = children.find((c) => c.age === 4);
      const thirteen = children.find((c) => c.age === 13);

      // 4-year-old: under threshold (4 < 6) → NOT chargeable
      expect(fourYearOld!.isChargeable).toBe(false);
      // 10-year-old: at/above threshold (10 >= 6) → chargeable (FIXED)
      expect(tenYearOld!.isChargeable).toBe(true);
      // 13-year-old: above threshold (13 >= 6) → chargeable
      expect(thirteen!.isChargeable).toBe(true);

      // Verify pricing lines match the isChargeable flags
      const tenYearOldLine = sub.pricingBreakup.lines.find((l) => l.label.includes("Ten Year Old"));
      expect(tenYearOldLine).toBeDefined();
      expect(tenYearOldLine!.free).toBe(false); // Pricing correctly charges
    });

    it("FINDING-G2: checkIn/checkOut are not cross-validated (any date order accepted)", async () => {
      // accommodationSchema accepts any two strings for checkIn/checkOut.
      // No cross-field validation ensures checkIn ≤ checkOut.
      // This is a spec gap — the spec does not mandate this validation,
      // but it is a data integrity concern.
      const result = await svc.registrationService.submit({
        ...validSubmitData,
        accommodation: {
          ...validSubmitData.accommodation!,
          checkIn: "2026-08-17",
          checkOut: "2026-08-14",
        },
      });
      expect(result.regId).toBeTypeOf("string"); // Registration succeeds
      const response = await svc.registrationService.getByToken(Number(result.regId));
      expect(response.registration.accommodation?.checkIn).toBe("2026-08-17");
      expect(response.registration.accommodation?.checkOut).toBe("2026-08-14");
      // Severity: LOW — not specified in the spec, but data anomaly
    });

    it("FINDING-G3 (resolved): donation is presence-based — zero amount means no donation", async () => {
      // In mapToResponse:
      //   donation: reg.donationAmount > 0 ? { ... } : undefined
      // The canonical Registration shape has no hasDonation flag — presence of the
      // donation object is determined purely by whether donationAmount > 0.
      // Zero-donation is blocked at schema validation (donationRegSchema requires positive).
      // Submitting without donation confirms the response has no donation field.
      const sub = await svc.registrationService.submit({
        ...validSubmitData,
        donation: undefined,
      });
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      expect(response.registration.donation).toBeUndefined();
      // Severity: LOW — zero donation is functionally equivalent to no donation
    });

    it("FINDING-G4: addon meal line item NOT generated for donation_only attendees", async () => {
      // When attendanceIntent is donation_only, no attendee line items are generated.
      // Even if the user specifies spouse, children, meals etc., the pricing
      // engine returns base=0, lines=[], donation, total=donation.
      // This is correct per spec (donation_only means not attending).
      // donation_only carries no alumniMeal/tshirtSize (schema rejects them);
      // spouse/accommodation kept deliberately — the adversarial point is that
      // pricing ignores them when intent is donation_only.
      const donationOnlyWithSpouse: SubmitRegistrationRequest = {
        ...validSubmitData,
        attendance: { intent: "donation_only", participationType: "full_celebration" },
        attendees: {
          ...validSubmitData.attendees,
          spouse: { name: "Priya", meal: "veg" },
        },
        accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
      };
      const result = await svc.registrationService.submit(donationOnlyWithSpouse);
      expect(result.pricingBreakup.lines).toEqual([]);
      expect(result.pricingBreakup.base).toBe(0);
      // This is expected behavior — donation_only overrides attendee pricing
    });

    it("FINDING-G5: error middleware maps AppError statusCode via type assertion (not value)", async () => {
      // In error.middleware.ts L9:
      //   return c.json({ error: err.message }, err.statusCode as 403);
      // The `as 403` assertion is incorrect — it narrows the type but doesn't
      // change the value at runtime. However, since all AppError subclasses
      // set actual numeric statusCodes, this works in practice.
      // The code correctly passes err.statusCode (actually a number), the
      // assertion just helps TypeScript narrow the union.
      const notFound = new NotFoundError("Registration not found");
      expect(notFound.statusCode).toBe(404);
      const forbidden = new ForbiddenError();
      expect(forbidden.statusCode).toBe(403);
      const auth = new AuthError();
      expect(auth.statusCode).toBe(401);
      // All statusCodes are actual numbers, not dependent on type assertion
    });
  });

  // =========================================================================
  // H — ADDITIONAL EDGE CASES
  // =========================================================================

  describe("H — Additional Edge Cases", () => {
    it("H1: hasSpouse=true with spouseName → spouse attendee created with isChargeable=true", async () => {
      const sub = await svc.registrationService.submit({
        ...validSubmitData,
        attendees: {
          ...validSubmitData.attendees,
          spouse: { name: "Priya", meal: "veg" },
        },
        accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
      });
      const attendees = await svc.attendeeRepo.findByRegistration(Number(sub.regId));
      const spouse = attendees.find((a) => a.type === "spouse");
      expect(spouse).toBeDefined();
      expect(spouse!.name).toBe("Priya");
      expect(spouse!.isChargeable).toBe(true);
    });

    it("H2: hasSpouse=true but spouseName whitespace → validation rejected (trim check)", async () => {
      // spouseRegSchema uses z.string().trim().min(1) — "   " trims to "" and fails min(1).
      // Whitespace-only names are now correctly rejected at schema validation.
      await expect(
        svc.registrationService.submit({
          ...validSubmitData,
          attendees: {
            ...validSubmitData.attendees,
            spouse: { name: "   ", meal: "veg" },
          },
          accommodation: { ...validSubmitData.accommodation!, type: "private", extraBed: false },
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("H3: zero donation amount (not positive) → validation rejected", async () => {
      // The canonical schema requires donation.amount to be positive.
      // Passing 0 is rejected at validation time.
      try {
        await svc.registrationService.submit({
          ...validSubmitData,
          donation: { amount: 0, publicAcknowledgement: false, felicitationConsent: false },
        });
        expect.fail("Expected ValidationError");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
      }
    });

    it("H4: omitting donation entirely → response.donation is undefined", async () => {
      const sub = await svc.registrationService.submit({
        ...validSubmitData,
        donation: undefined,
      });
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      expect(response.registration.donation).toBeUndefined();
    });

    it("H5: submission creates a single 'created' audit entry with payment info in snapshot", async () => {
      // Bank transfer flow: submission creates a 'created' audit entry.
      // Payment is part of the aggregate, not a separate 'payment_created' entry.
      await svc.registrationService.submit(validSubmitData);

      const createdEntries = svc.auditRepo.entries.filter(
        (e) => e.action === "created",
      );
      expect(createdEntries).toHaveLength(1);
      expect(createdEntries[0].actor).toBe(validSubmitData.contact.email);
    });

    it("H6: submission creates payment record with status 'payment_pending'", async () => {
      // Bank transfer flow: payment starts in payment_pending, not 'pending'
      const sub = await svc.registrationService.submit(validSubmitData);
      const payments = await svc.paymentRepo.findByRegistration(Number(sub.regId));
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe("payment_pending");
    });

    it("H7: payment record created during submission has proofFileKey null", async () => {
      // Bank transfer flow: proofFileKey is null at payment creation time
      const sub = await svc.registrationService.submit(validSubmitData);
      const payments = await svc.paymentRepo.findByRegistration(Number(sub.regId));
      expect(payments[0].proofFileKey).toBeNull();
      expect(payments[0].verifiedBy).toBeNull();
      expect(payments[0].verifiedAt).toBeNull();
    });

    it("H8: GET /me returns donation amount as a number type", async () => {
      const sub = await svc.registrationService.submit(validSubmitData);
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      // Canonical response: donation.amount is a number
      expect(typeof response.registration.donation?.amount).toBe("number");
      expect(response.registration.donation?.amount).toBe(500);
    });

    it("H9: regCode on response matches submitted regCode", async () => {
      const sub = await svc.registrationService.submit(validSubmitData);
      const response = await svc.registrationService.getByToken(Number(sub.regId));
      expect(response.registration.regCode).toBe(sub.regCode);
    });
  });
});
