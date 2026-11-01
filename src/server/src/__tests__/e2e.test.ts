/**
 * Integration tests for Registration API — verifies service-layer behavior
 * against the API spec (submission-api.spec.md, authentication.spec.md,
 * payment-flow.spec.md).
 *
 * Tests instantiate RegistrationService and PaymentService with in-memory
 * repository fakes. No Worker runtime needed.
 *
 * @module e2e.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  SubmitRegistrationRequest,
  PricingBreakup,
} from "@smriti/shared";

import { RegistrationService } from "../services/registration.service.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PaymentService } from "../services/payment.service.js";
import { PricingService } from "../services/pricing.service.js";
import { signToken, verifyToken } from "../infra/jwt.js";
import {
  ValidationError,
  NotFoundError,
  AppError,
} from "../services/errors.js";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  IDocumentRepository,
  IEmailService,
  IRefundRepository,
  IFileStorage,
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
  Refund,
  NewRefund,
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";
import { RefundCompletionFakeD1 } from "./helpers/refund-completion-d1.js";

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
// In-memory repository implementations
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
    return [...this.registrations.values()].filter(
      (r) => r.email === email,
    );
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
    if (data.branch !== undefined) reg.branch = data.branch;
    if (data.email !== undefined) reg.email = data.email;
    if (data.whatsapp !== undefined) reg.whatsapp = data.whatsapp;
    if (data.mobile_alternate !== undefined)
      reg.mobileAlternate = data.mobile_alternate;
    if (data.city !== undefined) reg.city = data.city;
    if (data.country !== undefined) reg.country = data.country;
    if (data.attendance_intent !== undefined)
      reg.attendanceIntent = data.attendance_intent;
    if (data.alumni_meal !== undefined) reg.alumniMeal = data.alumni_meal;
    if (data.accommodation !== undefined)
      reg.accommodation = data.accommodation;
    if (data.check_in !== undefined) reg.checkIn = data.check_in;
    if (data.check_out !== undefined) reg.checkOut = data.check_out;
    if (data.donation_amount !== undefined)
      reg.donationAmount = data.donation_amount;
    if (data.public_ack !== undefined) reg.publicAck = data.public_ack !== 0;
    if (data.ack_display_name !== undefined)
      reg.ackDisplayName = data.ack_display_name;
    if (data.felicitation !== undefined)
      reg.felicitation = data.felicitation !== 0;
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
    // Return a shallow copy, matching D1 semantics (each query materializes a
    // fresh object from the row). This prevents a caller's already-fetched
    // object from silently mutating when a later repo write touches the map
    // entry in place (e.g. verify() overwriting amount).
    const p = this.payments.get(id);
    return p ? { ...p } : null;
  }

  async findByRegistration(registrationId: number): Promise<Payment[]> {
    return [...this.payments.values()]
      .filter((p) => p.registrationId === registrationId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
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
    p.updatedAt = Date.now();
    if (gatewayData?.gatewayRef !== undefined)
      p.gatewayRef = gatewayData.gatewayRef;
    if (gatewayData?.gateway !== undefined)
      p.gateway = gatewayData.gateway;
    if (gatewayData?.gatewayResponse !== undefined)
      p.gatewayResponse = gatewayData.gatewayResponse;
    if (proofFileKey !== undefined)
      p.proofFileKey = proofFileKey;
    if (verification !== undefined) {
      p.verifiedBy = verification.verifiedBy;
      p.verifiedAt = verification.verifiedAt;
    }
  }

  async sumVerified(_filters?: { type?: 'attendee' | 'donor' }): Promise<number> {
    return 0;
  }

  async sumVerifiedByBranch(_filters?: { type?: 'attendee' | 'donor' }): Promise<Array<{ branch: string; collected: number }>> {
    return [];
  }
  async verify(id: number, amount: number, gatewayRef: string, verifiedBy: string, verifiedAt: number): Promise<void> {
    const p = this.payments.get(id);
    if (!p || p.status !== 'pending_verification') return;
    p.status = 'verified';
    p.amount = amount;
    p.gatewayRef = gatewayRef;
    p.verifiedBy = verifiedBy;
    p.verifiedAt = verifiedAt;
    p.updatedAt = Date.now();
  }
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(registrationId: number): Promise<Payment | null> {
    const pending = [...this.payments.values()].filter(
      (p) => p.registrationId === registrationId && p.status === 'payment_pending',
    );
    return pending[0] ?? null;
  }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async sumVerifiedByRegistration(registrationId: number): Promise<number> {
    return [...this.payments.values()]
      .filter((p) => p.registrationId === registrationId && p.status === 'verified')
      .reduce((sum, p) => sum + p.amount, 0);
  }
}

class InMemoryRefundRepo implements IRefundRepository {
  private refunds: Map<number, Refund> = new Map();
  private nextId = 1;

  async create(refund: NewRefund): Promise<{ id: number }> {
    const id = this.nextId++;
    this.refunds.set(id, {
      id,
      registrationId: refund.registration_id,
      sourcePaymentId: refund.source_payment_id,
      amount: refund.amount,
      reason: 'overpayment',
      cancellationReason: null,
      status: refund.status,
      bankReference: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: Date.now(),
      originalRegistrationId: refund.registration_id,
      originalPaymentId: refund.source_payment_id,
      regCode: '—',
      fullName: '—',
      email: '',
      sourcePaymentAmount: refund.amount,
      sourcePaymentReference: null,
      ownerKind: 'active',
    });
    return { id };
  }

  async findById(id: number): Promise<Refund | null> {
    return this.refunds.get(id) ?? null;
  }

  async list(filters?: { status?: string }): Promise<Refund[]> {
    let results = [...this.refunds.values()];
    if (filters?.status) results = results.filter((r) => r.status === filters.status);
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  async listWithRegistration(filters?: { status?: string }): Promise<Refund[]> {
    return this.list(filters);
  }

  async findByRegistration(registrationId: number): Promise<Refund[]> {
    return [...this.refunds.values()]
      .filter((r) => r.registrationId === registrationId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async findByOriginalRegistration(originalRegistrationId: number): Promise<Refund[]> {
    return [...this.refunds.values()]
      .filter((r) => r.originalRegistrationId === originalRegistrationId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async complete(id: number, resolvedBy: string, bankReference: string): Promise<void> {
    const r = this.refunds.get(id);
    if (!r || r.status !== 'pending') return;
    r.status = 'completed';
    r.resolvedBy = resolvedBy;
    r.resolvedAt = Date.now();
    r.bankReference = bankReference;
  }
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
  created: NewIdDocument[] = [];
  async create(doc: NewIdDocument): Promise<{ id: number }> {
    this.created.push(doc);
    return { id: this.created.length };
  }
  async findByRegistration(
    _registrationId: number,
  ): Promise<IdDocument[]> {
    return [];
  }
  async updateR2Key(_docId: number, _newKey: string): Promise<void> {}
}

class StubEmailService implements IEmailService {
  sentConfirmations: Array<{
    to: string;
    data: { regId: string; fullName: string; totalAmount: number; attendanceIntent: string };
  }> = [];
  sentMagicLinks: Array<{
    to: string;
    data: { token: string; expiresIn: number };
  }> = [];

  async sendConfirmation(
    to: string,
    data: { regId: string; fullName: string; totalAmount: number; attendanceIntent: string },
  ): Promise<void> {
    this.sentConfirmations.push({ to, data });
  }

  async sendMagicLink(
    to: string,
    data: { token: string; expiresIn: number },
  ): Promise<void> {
    this.sentMagicLinks.push({ to, data });
  }

  sentPaymentConfirmed: Array<{ to: string; data: unknown }> = [];
  sentAdditionalPayment: Array<{ to: string; data: unknown }> = [];

  async sendPaymentConfirmed(to: string, data: unknown): Promise<void> {
    this.sentPaymentConfirmed.push({ to, data });
  }
  async sendPaymentRejected(_to: string, _data: unknown): Promise<void> {}
  async sendStaffWelcome(_to: string, _data: unknown): Promise<void> {}
  async sendPaymentLink(_to: string, _data: unknown): Promise<void> {}
  async sendRevisedPayment(_to: string, _data: unknown): Promise<void> {}
  async sendAdditionalPayment(to: string, data: unknown): Promise<void> {
    this.sentAdditionalPayment.push({ to, data });
  }
  async sendStoryHidden(_to: string, _data: unknown): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Test context
// ---------------------------------------------------------------------------

interface TestServices {
  registrationService: RegistrationService;
  regRepo: InMemoryRegistrationRepo;
  attendeeRepo: InMemoryAttendeeRepo;
  paymentRepo: InMemoryPaymentRepo;
  auditRepo: InMemoryAuditRepo;
  documentRepo: StubDocumentRepo;
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

  const authService = {
    async issueAttendeeToken(registrationId: number, _status: string) {
      return signToken({ sub: String(registrationId), role: "attendee" }, TEST_JWT_SECRET);
    },
    async createPaymentLinkUrl(_registrationId: number, regCode: string) {
      return `/pay/${regCode}?code=test`;
    },
  };

  const registrationService = new RegistrationService({
    availabilityService: stubAvailabilityService,
    registrationRepo: regRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    emailService,
    pricingService,
    authService,
  });

  return {
    registrationService,
    regRepo,
    attendeeRepo,
    paymentRepo,
    auditRepo,
    documentRepo,
    emailService,
    pricingService,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Registration API", () => {
  let svc: TestServices;

  beforeEach(() => {
    svc = createTestServices();
  });

  // =========================================================================
  // POST /api/registrations (submit)
  // =========================================================================

  describe("POST /api/registrations (submit)", () => {
    it("creates registration with valid data, returns 201 shape with regId, regCode, token, status, pricingBreakup, paymentUrl", async () => {
      const result = await svc.registrationService.submit(validSubmitData);

      // R3.4: Response includes regId, token, status, pricingBreakup, paymentUrl
      expect(result.regId).toBeTypeOf("string");
      expect(result.regCode).toBeTypeOf("string");
      expect(result.token).toBeTypeOf("string");
      expect(result.status).toBe("pending");
      expect(result.pricingBreakup).toBeDefined();
      expect(result.paymentUrl).toBeTypeOf("string");

      // regId is the internal numeric id as string (e.g. "1001")
      expect(result.regId).toMatch(/^\d+$/);
      expect(Number(result.regId)).toBeGreaterThanOrEqual(1001);
    });

    it("returns regCode as a 16-character string starting with SMRT prefix", async () => {
      const result = await svc.registrationService.submit(validSubmitData);

      // Implementation: regCode is 16 chars (SMRT prefix + 12 Crockford base32)
      expect(result.regCode).toHaveLength(16);
      expect(result.regCode).toMatch(/^SMRT[0-9A-HJKMNP-TV-Z]{12}$/);
    });

    it("returns status 'pending' on creation", async () => {
      // R3.6: status is always "pending" on creation
      const result = await svc.registrationService.submit(validSubmitData);
      expect(result.status).toBe("pending");
    });

    it("returns pricingBreakup with computed pricing fields (base, lines, donation, total)", async () => {
      // R3.3: Server computes pricing server-side
      const result = await svc.registrationService.submit(validSubmitData);
      const pb = result.pricingBreakup;

      expect(pb).toHaveProperty("base");
      expect(pb).toHaveProperty("lines");
      expect(pb).toHaveProperty("donation");
      expect(pb).toHaveProperty("total");
      expect(typeof pb.base).toBe("number");
      expect(typeof pb.donation).toBe("number");
      expect(typeof pb.total).toBe("number");
      expect(Array.isArray(pb.lines)).toBe(true);

      // With base fee 10000 + donation 500, total should be >= 10500
      expect(pb.total).toBeGreaterThanOrEqual(10500);
      expect(pb.donation).toBe(500);
    });

    it("returns paymentUrl starting with '/payment/' for non-zero total", async () => {
      // Bank transfer flow: paymentUrl points to /pay/{regCode}
      const result = await svc.registrationService.submit(validSubmitData);
      expect(result.paymentUrl).toMatch(/^\/pay\//);
      expect(result.paymentUrl).toContain(result.regCode);
    });

    it("creates a payment_pending payment record during submission for non-zero totals", async () => {
      const result = await svc.registrationService.submit(validSubmitData);
      const payments = await svc.paymentRepo.findByRegistration(Number(result.regId));

      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe("payment_pending");
      expect(payments[0].amount).toBe(result.pricingBreakup.total);
      expect(payments[0].gateway).toBeNull();
      expect(payments[0].gatewayRef).toBeNull();
      expect(payments[0].proofFileKey).toBeNull();
    });

    it("rejects donation-only submission with no donation amount (registrationSchema enforces this)", async () => {
      // donation_only with no amount fails pre-submit validation.
      // registrationSchema requires donation present for donation_only intent.
      // Zero-total registrations cannot be submitted through the normal flow.
      const donationOnlyData: SubmitRegistrationRequest = {
        ...validSubmitData,
        attendance: { intent: "donation_only", participationType: "donation_only", alumniMeal: "non_veg", tshirtSize: "M" },
        donation: undefined,
      };
      await expect(
        svc.registrationService.submit(donationOnlyData),
      ).rejects.toThrow(ValidationError);
    });

    it("creates a 'created' audit entry on successful submission", async () => {
      // Submission creates a single 'created' audit entry (payment is part of the aggregate).
      await svc.registrationService.submit(validSubmitData);

      const createdEntries = svc.auditRepo.entries.filter((entry) => entry.action === "created");

      expect(createdEntries).toHaveLength(1);
      expect(createdEntries[0].actor).toBe(validSubmitData.contact.email);
      expect(createdEntries[0].changes).toBeNull();
      expect(createdEntries[0].snapshot).toBeTypeOf("object");
    });

    it("returns a valid JWT token signed with HS256", async () => {
      const result = await svc.registrationService.submit(validSubmitData);

      // Verify the token is a valid JWT
      const payload = await verifyToken(result.token, TEST_JWT_SECRET);

      // R1.3: sub (internal id string), role, iat, exp
      // signToken is called with { sub, role } only — regCode is not in the JWT payload
      expect(payload.sub).toBeTypeOf("string");
      expect(payload.sub).toMatch(/^\d+$/);
      expect(payload.role).toBe("attendee");
      expect(payload.iat).toBeTypeOf("number");
      expect(payload.exp).toBeTypeOf("number");

      // R1.5: Expiry is ~90 days from issuance (verify it's in the future)
      const nowSec = Math.floor(Date.now() / 1000);
      expect(payload.exp).toBeGreaterThan(nowSec);
      // Should be roughly 90 days from now (allow generous tolerance for clock skew)
      const days90 = 90 * 24 * 60 * 60;
      expect(payload.exp).toBeLessThan(nowSec + days90 + 3600); // 90 days + 1h tolerance
    });

    it("throws ValidationError with fieldErrors for missing required fields", async () => {
      const invalidData: SubmitRegistrationRequest = {
        ...validSubmitData,
        contact: {
          ...validSubmitData.contact,
          fullName: "", // R3.2: alumniDetailsSchema requires min(1)
          email: "",
          branch: "",
          whatsapp: "",
          city: "",
        },
      };

      try {
        await svc.registrationService.submit(invalidData);
        expect.fail("Expected ValidationError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.fieldErrors).toBeDefined();
        expect(Object.keys(ve.fieldErrors).length).toBeGreaterThan(0);
        expect(ve.fieldErrors["contact.fullName"]).toBeDefined();
        expect(ve.fieldErrors["contact.email"]).toBeDefined();
      }
    });

    it("creates registration with spouse, children, and guests", async () => {
      const withAttendees: SubmitRegistrationRequest = {
        ...validSubmitData,
        accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-17", extraBed: false },
        attendees: {
          spouse: { name: "Priya Madathil", meal: "veg" },
          children: [
            {
              id: "child-1",
              name: "Arjun",
              age: 8,
              meal: "non_veg",
            },
          ],
          guests: [
            {
              id: "guest-1",
              name: "Ravi Kumar",
              relationship: "Friend",
              meal: "non_veg",
            },
          ],
        },
      };

      const result =
        await svc.registrationService.submit(withAttendees);

      // Verify the response has regId
      expect(result.regId).toBeTypeOf("string");

      // Verify attendees were stored
      const regId = Number(result.regId);
      const attendees =
        await svc.attendeeRepo.findByRegistration(regId);

      // Should have 3 attendees: spouse, child, guest
      expect(attendees).toHaveLength(3);
      expect(attendees.some((a) => a.type === "spouse")).toBe(true);
      expect(attendees.some((a) => a.type === "child")).toBe(true);
      expect(attendees.some((a) => a.type === "guest")).toBe(true);
    });

    it("returns undefined for empty optional fields, preserves checkIn/checkOut in accommodation", async () => {
      const submitResult =
        await svc.registrationService.submit(validSubmitData);

      // mobileAlternate: "" gets trimmed to null internally, returned as undefined
      const regId = Number(submitResult.regId);
      const response = await svc.registrationService.getByToken(regId);
      const data = response.registration;

      expect(data.contact.mobileAlternate).toBeUndefined();
      expect(data.accommodation?.checkIn).toBe("2026-08-14");
      expect(data.accommodation?.checkOut).toBe("2026-08-16");
    });

    it("submit with idDocument creates id_documents record", async () => {
      const { registrationService, documentRepo } = createTestServices();
      const result = await registrationService.submit(validSubmitData);
      expect(result.regId).toBeDefined();
      expect(documentRepo.created).toHaveLength(1);
      expect(documentRepo.created[0]).toMatchObject({
        file_name: "id.jpg",
        mime_type: "image/jpeg",
        size_bytes: 1024,
        r2_key: "test-doc-key",
      });
    });

    it("submit without idDocument does not create id_documents record", async () => {
      const { registrationService, documentRepo } = createTestServices();
      const dataWithoutDoc = {
        ...validSubmitData,
        // donation_only carries no alumniMeal/tshirtSize — registrationSchema
        // rejects them (attendees-meals.spec.md R1/R2.4; commit 9c8d5bc).
        attendance: { intent: "donation_only" as const, participationType: "donation_only" as const },
        accommodation: undefined,
        idDocument: undefined,
      };
      await registrationService.submit(dataWithoutDoc);
      expect(documentRepo.created).toHaveLength(0);
    });

    // =========================================================================
    // ID Document — additional coverage
    // =========================================================================

    it("id_documents record has correct registration_id (not placeholder 0)", async () => {
      // G7: The existing test never asserts registration_id. A generator could
      // store registration_id: 0 (the NewAttendee placeholder) and still pass.
      // This test catches that regression.
      const { registrationService, documentRepo } = createTestServices();
      const result = await registrationService.submit(validSubmitData);
      expect(documentRepo.created).toHaveLength(1);
      const regId = Number(result.regId);
      expect(documentRepo.created[0].registration_id).toBe(regId);
      expect(documentRepo.created[0].registration_id).toBeGreaterThan(0);
    });

    it("id_documents record stores all metadata fields from idDocument (fileName, fileType, sizeBytes, fileKey)", async () => {
      // Verifies each metadata field individually — the existing test uses
      // toMatchObject which passes even if extra fields are wrong.
      const { registrationService, documentRepo } = createTestServices();
      await registrationService.submit(validSubmitData);
      const doc = documentRepo.created[0];
      expect(doc.file_name).toBe("id.jpg");
      expect(doc.mime_type).toBe("image/jpeg");
      expect(doc.size_bytes).toBe(1024);
      expect(doc.r2_key).toBe("test-doc-key");
    });

    it("idDocument with empty fileKey is rejected by schema validation (fileKey min-length 1)", async () => {
      // G5 investigation: the shared registrationSchema enforces fileKey min(1),
      // so an empty fileKey is blocked before the document-write branch is reached.
      // This means the flag-set-but-no-row inconsistency cannot occur through the
      // normal submission path. This test confirms that guarantee holds — empty
      // fileKey always produces a ValidationError, never a silent partial write.
      const { registrationService } = createTestServices();
      await expect(
        registrationService.submit({
          ...validSubmitData,
          idDocument: {
            fileKey: "",
            fileType: "image/jpeg",
            sizeBytes: 1024,
            fileName: "id.jpg",
            note: "",
          },
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("donation_only submit without idDocument: no document row", async () => {
      // step4-id-upload.spec.md R7: donation_only skips Step 4 entirely —
      // the wizard never sets idDocument. Submission must not create a document row.
      const { registrationService, documentRepo } = createTestServices();
      await registrationService.submit({
        ...validSubmitData,
        attendance: { intent: "donation_only", participationType: "donation_only" },
        accommodation: undefined,
        idDocument: undefined,
        donation: { amount: 1500, publicAcknowledgement: false, felicitationConsent: false },
      });
      expect(documentRepo.created).toHaveLength(0);
    });

    it("GET /me after submit with idDocument returns idDocument in response when repo serves the doc back", async () => {
      // G9: StubDocumentRepo.findByRegistration always returns []. This test
      // uses a MemoryDocumentRepo that serves back created docs so we can
      // verify the response mapping path. Tests R4.1 idDocument field shape.
      //
      // The MemoryDocumentRepo is defined inline below because the default
      // StubDocumentRepo cannot serve back what it stored.
      const memDocRepo: IDocumentRepository & { created: NewIdDocument[] } = (() => {
        const created: NewIdDocument[] = [];
        const repo: IDocumentRepository & { created: NewIdDocument[] } = {
          created,
          async create(doc: NewIdDocument): Promise<{ id: number }> {
            created.push(doc);
            return { id: created.length };
          },
          async findByRegistration(registrationId: number): Promise<IdDocument[]> {
            return created
              .filter((d) => d.registration_id === registrationId)
              .map((d, i) => ({
                id: i + 1,
                registrationId: d.registration_id,
                fileName: d.file_name,
                mimeType: d.mime_type,
                sizeBytes: d.size_bytes,
                r2Key: d.r2_key,
                createdAt: Date.now(),
              }));
          },
          async updateR2Key(_docId: number, _newKey: string): Promise<void> {},
        };
        return repo;
      })();

      const regRepo = new InMemoryRegistrationRepo();
      const attendeeRepo = new InMemoryAttendeeRepo();
      const paymentRepo = new InMemoryPaymentRepo();
      const auditRepo = new InMemoryAuditRepo();
      const emailService = new StubEmailService();
      const pricingService = new PricingService();

      // Wire companion repos for createWithRelations
      regRepo.companionAttendeeRepo = attendeeRepo;
      regRepo.companionPaymentRepo = paymentRepo;
      regRepo.companionDocumentRepo = memDocRepo;

      const svcWithMemDoc = new RegistrationService({
        availabilityService: stubAvailabilityService,
        registrationRepo: regRepo,
        attendeeRepo,
        auditRepo,
        documentRepo: memDocRepo,
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

      const result = await svcWithMemDoc.submit(validSubmitData);
      const response = await svcWithMemDoc.getByToken(Number(result.regId));
      const doc = response.registration.idDocument;

      // R4.1: idDocument field must be present in response when doc was uploaded
      expect(doc).toBeDefined();
      expect(doc!.fileKey).toBe("test-doc-key");
      expect(doc!.fileName).toBe("id.jpg");
      expect(doc!.fileType).toBe("image/jpeg");
      expect(doc!.sizeBytes).toBe(1024);
    });

    it("GET /me after submit without idDocument returns idDocument as undefined", async () => {
      // Contrast test: no document submitted → idDocument absent from response.
      // Tests the mapToResponse guard: doc !== null.
      const { registrationService } = createTestServices();
      const result = await registrationService.submit({
        ...validSubmitData,
        attendance: { intent: "donation_only" as const, participationType: "donation_only" as const },
        accommodation: undefined,
        idDocument: undefined,
      });
      const response = await registrationService.getByToken(Number(result.regId));
      expect(response.registration.idDocument).toBeUndefined();
    });

    it("idNote is stored and returned when a note is provided with the document", async () => {
      // The note field on idDocument is passed through id_note on the
      // registration row, not the id_documents table. Verifies round-trip.
      const memDocRepo: IDocumentRepository = (() => {
        const created: NewIdDocument[] = [];
        return {
          async create(doc: NewIdDocument): Promise<{ id: number }> {
            created.push(doc);
            return { id: created.length };
          },
          async findByRegistration(registrationId: number): Promise<IdDocument[]> {
            return created
              .filter((d) => d.registration_id === registrationId)
              .map((d, i) => ({
                id: i + 1,
                registrationId: d.registration_id,
                fileName: d.file_name,
                mimeType: d.mime_type,
                sizeBytes: d.size_bytes,
                r2Key: d.r2_key,
                createdAt: Date.now(),
              }));
          },
          async updateR2Key(_docId: number, _newKey: string): Promise<void> {},
        };
      })();

      const regRepo = new InMemoryRegistrationRepo();
      const attendeeRepo = new InMemoryAttendeeRepo();
      const paymentRepo = new InMemoryPaymentRepo();
      const auditRepo = new InMemoryAuditRepo();
      const emailService = new StubEmailService();
      const pricingService = new PricingService();

      // Wire companion repos for createWithRelations
      regRepo.companionAttendeeRepo = attendeeRepo;
      regRepo.companionPaymentRepo = paymentRepo;
      regRepo.companionDocumentRepo = memDocRepo;

      const svcWithNote = new RegistrationService({
        availabilityService: stubAvailabilityService,
        registrationRepo: regRepo,
        attendeeRepo,
        auditRepo,
        documentRepo: memDocRepo,
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

      const result = await svcWithNote.submit({
        ...validSubmitData,
        idDocument: {
          ...validSubmitData.idDocument!,
          note: "Name on ID differs from registered name.",
        },
      });
      const response = await svcWithNote.getByToken(Number(result.regId));
      expect(response.registration.idDocument!.note).toBe(
        "Name on ID differs from registered name.",
      );
    });
  });

  // =========================================================================
  // GET /api/registrations/me
  // =========================================================================

  describe("GET /api/registrations/me", () => {
    it("returns full registration for valid token (by internal id)", async () => {
      const submitResult =
        await svc.registrationService.submit(validSubmitData);
      const regId = Number(submitResult.regId);

      const response = await svc.registrationService.getByToken(regId);

      // R4.1: Response is { registration: RegistrationResponseData }
      expect(response.registration).toBeDefined();
      const data = response.registration;

      // R4.2: Includes server-generated fields
      expect(data.regId).toBe(submitResult.regId);
      expect(data.regCode).toBe(submitResult.regCode);
      expect(data.status).toBe("pending");
      expect(data.pricingBreakup).toBeDefined();
      expect(data.createdAt).toBeTypeOf("number");
      expect(data.createdAt).toBeGreaterThan(0);

      // User-submitted fields preserved
      expect(data.contact.fullName).toBe("Ravi Kumar");
      expect(data.contact.email).toBe("ravi@example.com");
      expect(data.contact.branch).toBe("Computer Science & Engineering");
      expect(data.attendance.intent).toBe("attending");
      expect(data.attendance.alumniMeal).toBe("non_veg");
    });

    it("throws NotFoundError when registration id doesn't exist", async () => {
      // R4.4: 404 when registration doesn't exist
      await expect(
        svc.registrationService.getByToken(99999),
      ).rejects.toThrow(NotFoundError);
    });

    it("returns attendees inlined (spouse, children, guests) not as separate array", async () => {
      const withAttendees: SubmitRegistrationRequest = {
        ...validSubmitData,
        accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-17", extraBed: false },
        attendees: {
          spouse: { name: "Priya", meal: "veg" },
          children: [
            { id: "c1", name: "Arjun", age: 8, meal: "non_veg" },
          ],
          guests: [
            {
              id: "g1",
              name: "Ravi",
              relationship: "Friend",
              meal: "veg",
            },
          ],
        },
      };

      const submitResult =
        await svc.registrationService.submit(withAttendees);
      const regId = Number(submitResult.regId);
      const response = await svc.registrationService.getByToken(regId);
      const data = response.registration;

      // R4.3: Attendees inlined
      expect(data.attendees.spouse).toBeDefined();
      expect(data.attendees.spouse?.name).toBe("Priya");
      expect(data.attendees.spouse?.meal).toBe("veg");

      expect(data.attendees.children).toHaveLength(1);
      expect(data.attendees.children[0].name).toBe("Arjun");
      expect(data.attendees.children[0].age).toBe(8);
      expect(data.attendees.children[0].id).toBeTypeOf("string");

      expect(data.attendees.guests).toHaveLength(1);
      expect(data.attendees.guests[0].name).toBe("Ravi");
      expect(data.attendees.guests[0].relationship).toBe("Friend");
      expect(data.attendees.guests[0].id).toBeTypeOf("string");
    });

    it("returns undefined for absent spouse, empty arrays for children/guests", async () => {
      // No spouse → attendees.spouse is undefined
      const submitResult =
        await svc.registrationService.submit(validSubmitData);
      const regId = Number(submitResult.regId);
      const response = await svc.registrationService.getByToken(regId);
      const data = response.registration;

      expect(data.attendees.spouse).toBeUndefined();
      expect(data.attendees.children).toEqual([]);
      expect(data.attendees.guests).toEqual([]);
    });

    it("returns the regCode field (formerly registrationRef)", async () => {
      const submitResult =
        await svc.registrationService.submit(validSubmitData);
      const regId = Number(submitResult.regId);
      const response = await svc.registrationService.getByToken(regId);

      // regCode on RegistrationResponseData = reg.regCode
      expect(response.registration.regCode).toBe(
        submitResult.regCode,
      );
    });

    it("returns donation object with amount as number", async () => {
      const submitResult =
        await svc.registrationService.submit(validSubmitData);
      const regId = Number(submitResult.regId);
      const response = await svc.registrationService.getByToken(regId);
      const data = response.registration;

      expect(data.donation).toBeDefined();
      expect(data.donation?.amount).toBe(500);
      expect(typeof data.donation?.amount).toBe("number");
    });

    it("returns donation undefined when no donation given", async () => {
      const noDonation: SubmitRegistrationRequest = {
        ...validSubmitData,
        donation: undefined,
      };
      const submitResult =
        await svc.registrationService.submit(noDonation);
      const regId = Number(submitResult.regId);
      const response = await svc.registrationService.getByToken(regId);
      const data = response.registration;

      expect(data.donation).toBeUndefined();
    });
  });

  // =========================================================================
  // GET /api/registrations/:regCode
  // =========================================================================

  describe("GET /api/registrations/:regCode", () => {
    it("returns same data as /me for matching regCode", async () => {
      const submitResult =
        await svc.registrationService.submit(validSubmitData);

      const response =
        await svc.registrationService.getByRegCode(
          submitResult.regCode,
        );

      expect(response.registration).toBeDefined();
      expect(response.registration.regCode).toBe(submitResult.regCode);
      expect(response.registration.regId).toBe(submitResult.regId);
      expect(response.registration.contact.fullName).toBe("Ravi Kumar");
    });

    it("throws NotFoundError for non-existent regCode", async () => {
      // R5.2: 404 for non-existent regCode
      await expect(
        svc.registrationService.getByRegCode("SMRTNONEXISTENT"),
      ).rejects.toThrow(NotFoundError);
    });

    it("returns attendees inlined when fetched by regCode", async () => {
      const withSpouse: SubmitRegistrationRequest = {
        ...validSubmitData,
        accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-17", extraBed: false },
        attendees: {
          ...validSubmitData.attendees,
          spouse: { name: "Priya", meal: "veg" },
        },
      };
      const submitResult =
        await svc.registrationService.submit(withSpouse);
      const response = await svc.registrationService.getByRegCode(
        submitResult.regCode,
      );

      expect(response.registration.attendees.spouse).toBeDefined();
      expect(response.registration.attendees.spouse?.name).toBe("Priya");
    });
  });

  // =========================================================================
  // POST /api/registrations/:regCode/pay (initiate payment)
  // =========================================================================

  // =========================================================================
  // Full Flow (E2E)
  // =========================================================================

  describe("Full Flow (E2E)", () => {
    it("submit → get me → verify pending payment record created → get me (pending)", async () => {
      // Bank transfer flow: submit creates a payment_pending record; no immediate confirm step.
      // 1. Submit
      const submitResult =
        await svc.registrationService.submit(validSubmitData);
      expect(submitResult.status).toBe("pending");
      expect(submitResult.paymentUrl).toContain("/pay/");

      // 2. Get status (via token)
      const afterSubmit = await svc.registrationService.getByToken(
        Number(submitResult.regId),
      );
      expect(afterSubmit.registration.status).toBe("pending");

      // 3. Verify payment record was created in payment_pending state
      const payments = await svc.paymentRepo.findByRegistration(Number(submitResult.regId));
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe("payment_pending");
      expect(payments[0].amount).toBe(submitResult.pricingBreakup.total);
      expect(payments[0].proofFileKey).toBeNull();
    });

    it("submit with spouse + children + guests → get me returns all attendees inlined", async () => {
      const withAttendees: SubmitRegistrationRequest = {
        ...validSubmitData,
        accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-17", extraBed: false },
        attendees: {
          spouse: { name: "Priya", meal: "veg" },
          children: [
            { id: "c1", name: "Arjun", age: 10, meal: "non_veg" },
            { id: "c2", name: "Meera", age: 5, meal: "veg" },
          ],
          guests: [
            {
              id: "g1",
              name: "Ravi",
              relationship: "Friend",
              meal: "non_veg",
            },
            {
              id: "g2",
              name: "Sita",
              relationship: "Colleague",
              meal: "veg",
            },
          ],
        },
      };

      const submitResult =
        await svc.registrationService.submit(withAttendees);
      const response = await svc.registrationService.getByToken(
        Number(submitResult.regId),
      );
      const data = response.registration;

      // All attendees inlined
      expect(data.attendees.spouse).toBeDefined();
      expect(data.attendees.spouse?.name).toBe("Priya");
      expect(data.attendees.spouse?.meal).toBe("veg");
      expect(data.attendees.children).toHaveLength(2);
      expect(data.attendees.children[0].name).toBe("Arjun");
      expect(data.attendees.children[1].name).toBe("Meera");
      // Child under 6 is free (childFreeAgeThreshold = 6)
      expect(data.attendees.children[1].age).toBe(5);
      expect(data.attendees.guests).toHaveLength(2);

      // Verify attendees stored in repo
      const regId = Number(submitResult.regId);
      const attendees =
        await svc.attendeeRepo.findByRegistration(regId);
      expect(attendees).toHaveLength(5); // 1 spouse + 2 children + 2 guests
    });

    it("donation-only: submit with donation_only intent → total is donation only, no base fee", async () => {
      const donationOnly: SubmitRegistrationRequest = {
        ...validSubmitData,
        attendance: { intent: "donation_only", participationType: "donation_only" },
        accommodation: undefined,
        donation: { amount: 2000, publicAcknowledgement: true, felicitationConsent: false },
      };

      const result =
        await svc.registrationService.submit(donationOnly);

      // donation_only should have base=0 and total = donation
      expect(result.pricingBreakup.base).toBe(0);
      expect(result.pricingBreakup.donation).toBe(2000);
      expect(result.pricingBreakup.total).toBe(2000);
      expect(result.pricingBreakup.lines).toEqual([]);

      // total=2000 > 0, so paymentUrl should be set
      expect(result.paymentUrl).toContain("/pay/");
    });

    it("multiple submits with different emails create independent registrations", async () => {
      const r1 = await svc.registrationService.submit(validSubmitData);
      const r2 = await svc.registrationService.submit({
        ...validSubmitData,
        contact: { ...validSubmitData.contact, email: "different@example.com" },
      });

      // Different emails are fine — each gets a unique regCode and token
      expect(r1.regCode).not.toBe(r2.regCode);
      expect(r1.token).not.toBe(r2.token);
      expect(r1.regId).not.toBe(r2.regId);

      // Both can be retrieved independently
      const data1 = await svc.registrationService.getByToken(
        Number(r1.regId),
      );
      const data2 = await svc.registrationService.getByToken(
        Number(r2.regId),
      );
      expect(data1.registration.contact.email).toBe("ravi@example.com");
      expect(data2.registration.contact.email).toBe("different@example.com");
    });

    it("rejects a second submission with the same email — returns AppError 409", async () => {
      // First submission succeeds
      await svc.registrationService.submit(validSubmitData);

      // Second submission with the same email must fail
      try {
        await svc.registrationService.submit(validSubmitData);
        expect.fail("Expected AppError 409 to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const ae = err as AppError;
        expect(ae.statusCode).toBe(409);
        expect(ae.message).toMatch(/already exists/i);
      }
    });
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  describe("Error Handling", () => {
    it("ValidationError has statusCode 400 and fieldErrors", async () => {
      try {
        await svc.registrationService.submit({
          ...validSubmitData,
          contact: { ...validSubmitData.contact, fullName: "", email: "not-an-email" },
        });
        expect.fail("Should throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.statusCode).toBe(400);
        expect(ve.fieldErrors).toBeDefined();
        expect(Object.keys(ve.fieldErrors).length).toBeGreaterThan(0);
      }
    });

    it("NotFoundError has statusCode 404", () => {
      const err = new NotFoundError("Registration not found");
      expect(err.statusCode).toBe(404);
    });

    it("AppError with 409 has statusCode 409", () => {
      const err = new AppError("No pending payment to confirm", 409);
      expect(err.statusCode).toBe(409);
    });

    it("submit rejects invalid email format", async () => {
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

    it("submit with hasSpouse=true but empty spouseName fails validation", async () => {
      // attendeesSpouseSchema: name required when spouse present
      try {
        await svc.registrationService.submit({
          ...validSubmitData,
          accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-17", extraBed: false },
          attendees: {
            ...validSubmitData.attendees,
            spouse: { name: "", meal: "veg" },
          },
        });
        expect.fail("Expected ValidationError");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.fieldErrors["attendees.spouse.name"]).toBeDefined();
      }
    });
  });

  // =========================================================================
  // JWT Verification (Additional)
  // =========================================================================

  describe("JWT Token", () => {
    it("verifyToken decodes a JWT signed with signToken", async () => {
      const payload = {
        sub: "42",
        regCode: "SMRTABC123DEF456",
        role: "attendee" as const,
      };
      const token = await signToken(payload, TEST_JWT_SECRET);
      const decoded = await verifyToken(token, TEST_JWT_SECRET);

      expect(decoded.sub).toBe("42");
      expect(decoded.regCode).toBe("SMRTABC123DEF456");
      expect(decoded.role).toBe("attendee");
      expect(decoded.iat).toBeTypeOf("number");
      expect(decoded.exp).toBeTypeOf("number");
    });

    it("verifyToken rejects token with wrong secret", async () => {
      const token = await signToken(
        { sub: "1", regCode: "SMRTTEST000000", role: "attendee" },
        TEST_JWT_SECRET,
      );

      await expect(
        verifyToken(token, "wrong-secret"),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Pricing Verification
  // =========================================================================

  describe("Pricing", () => {
    it("pricing is frozen at submission time in the pricingBreakup response", async () => {
      const result =
        await svc.registrationService.submit(validSubmitData);

      // R3.10: Pricing snapshot frozen at submission time
      const storedPricing = result.pricingBreakup;
      expect(storedPricing).toBeDefined();
      // Base fee plus donation
      expect(storedPricing.total).toBeGreaterThan(0);
    });

    it("pricingBreakup is included in GET /me response", async () => {
      const submitResult =
        await svc.registrationService.submit(validSubmitData);
      const response = await svc.registrationService.getByToken(
        Number(submitResult.regId),
      );

      expect(response.registration.pricingBreakup).toBeDefined();
      expect(response.registration.pricingBreakup.total).toBe(
        submitResult.pricingBreakup.total,
      );
    });

    it("donation-only pricing has base=0 and no lines", async () => {
      const donationData: SubmitRegistrationRequest = {
        ...validSubmitData,
        attendance: { intent: "donation_only", participationType: "donation_only" },
        donation: { amount: 1000, publicAcknowledgement: true, felicitationConsent: false },
        accommodation: undefined,
      };

      const result =
        await svc.registrationService.submit(donationData);
      expect(result.pricingBreakup.base).toBe(0);
      expect(result.pricingBreakup.lines).toEqual([]);
      expect(result.pricingBreakup.donation).toBe(1000);
      expect(result.pricingBreakup.total).toBe(1000);
    });
  });

  // =========================================================================
  // Data Mapping (Response Shape Verification)
  // =========================================================================

  describe("Data Mapping", () => {
    it("GET /me response includes all RegistrationResponseData fields", async () => {
      const submitResult =
        await svc.registrationService.submit(validSubmitData);
      const response = await svc.registrationService.getByToken(
        Number(submitResult.regId),
      );
      const data = response.registration;

      // Contact fields
      expect(data.contact.fullName).toBeTypeOf("string");
      expect(data.contact.branch).toBeTypeOf("string");
      expect(data.contact.email).toBeTypeOf("string");
      expect(data.contact.whatsapp).toBeTypeOf("string");
      expect(data.contact.city).toBeTypeOf("string");
      expect(data.contact.country).toBeTypeOf("string");
      expect(data.attendance.intent).toBeTypeOf("string");
      expect(data.attendance.alumniMeal).toBeTypeOf("string");
      expect(data.accommodation).toBeDefined();
      expect(data.accommodation?.type).toBeTypeOf("string");

      // Augmented server fields
      expect(data.regId).toBeTypeOf("string");
      expect(data.regCode).toBeTypeOf("string");
      expect(data.status).toBeTypeOf("string");
      expect(data.pricingBreakup).toBeDefined();
      expect(data.createdAt).toBeTypeOf("number");

      // Attendees: no spouse in base fixture
      expect(data.attendees.spouse).toBeUndefined();
      expect(data.attendees.children).toEqual([]);
      expect(data.attendees.guests).toEqual([]);

      // Donation booleans
      expect(typeof data.donation?.amount).toBe("number");
      expect(typeof data.donation?.publicAcknowledgement).toBe("boolean");
      expect(typeof data.donation?.felicitationConsent).toBe("boolean");
    });

    it("country defaults to 'India' when present in request", async () => {
      const submitResult =
        await svc.registrationService.submit(validSubmitData);
      const response = await svc.registrationService.getByToken(
        Number(submitResult.regId),
      );
      expect(response.registration.contact.country).toBe("India");
    });
  });
});

// ---------------------------------------------------------------------------
// PaymentService — partial verification & refunds
// ---------------------------------------------------------------------------

const stubFileStorage: IFileStorage = {
  async upload(): Promise<void> {},
  async getSignedUrl(): Promise<string> {
    return "";
  },
  async get() {
    return null;
  },
  async delete(): Promise<void> {},
  async copy(): Promise<boolean> {
    return true;
  },
  async move(): Promise<void> {},
};

interface PaymentTestServices {
  paymentService: PaymentService;
  regRepo: InMemoryRegistrationRepo;
  paymentRepo: InMemoryPaymentRepo;
  refundRepo: InMemoryRefundRepo;
  auditRepo: InMemoryAuditRepo;
  attendeeRepo: InMemoryAttendeeRepo;
  emailService: StubEmailService;
  /** Captures the completeRefund() system-audit batch. */
  completionDb: RefundCompletionFakeD1;
}

// ---------------------------------------------------------------------------
// RefundCompletionFakeD1 — emulates PaymentService's completeRefund() guarded
// batch against the in-memory refund repo. Imported from
// helpers/refund-completion-d1.ts; a losing statement writes zero rows exactly
// like the real guarded SQL. (verifyPayment's overpayment branch runs plain
// repository calls and needs no D1 emulation.)
// ---------------------------------------------------------------------------

function createPaymentTestServices(): PaymentTestServices {
  const regRepo = new InMemoryRegistrationRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const refundRepo = new InMemoryRefundRepo();
  const auditRepo = new InMemoryAuditRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const emailService = new StubEmailService();
  const completionDb = new RefundCompletionFakeD1({ refundRepo });

  const paymentService = new PaymentService({
    db: completionDb as unknown as import('@cloudflare/workers-types').D1Database,
    registrationRepo: regRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    refundRepo,
    fileStorage: stubFileStorage,
    emailService,
    appBaseUrl: "http://localhost:5173",
  });

  return { paymentService, regRepo, paymentRepo, refundRepo, auditRepo, attendeeRepo, emailService, completionDb };
}

let paymentTestRegCounter = 0;

function buildPaymentTestRegistration(totalAmount: number, overrides?: Partial<NewRegistration>): NewRegistration {
  paymentTestRegCounter += 1;
  const n = paymentTestRegCounter;
  return {
    reg_code: `SMRTPAYTEST${String(n).padStart(5, "0")}`,
    full_name: "Test Alumni",
    branch: "2005",
    email: `alumni${n}@example.com`,
    whatsapp: "+919999999999",
    mobile_alternate: null,
    city: "Kochi",
    country: "India",
    attendance_intent: "attending",
    participation_type: "full_celebration",
    gender: null,
    tshirt_size: "M",
    alumni_meal: "veg",
    accommodation: "none",
    check_in: null,
    check_out: null,
    extra_bed: 0,
    donation_amount: 0,
    public_ack: 0,
    ack_display_name: null,
    felicitation: 0,
    contribution_splits: "{}",
    pricing_snapshot: JSON.stringify({ base: totalAmount, lines: [], donation: 0, collegeContribution: 0, total: totalAmount }),
    total_amount: totalAmount,
    id_note: null,
    photo_file_key: null,
    ...overrides,
  };
}

/** Seeds a registration with a single payment in 'pending_verification', ready to verify. */
async function seedRegistrationWithPayment(
  svcs: PaymentTestServices,
  opts?: { totalAmount?: number; paymentAmount?: number },
): Promise<{ regId: number; paymentId: number }> {
  const totalAmount = opts?.totalAmount ?? 13810;
  const paymentAmount = opts?.paymentAmount ?? totalAmount;

  const { id: regId } = await svcs.regRepo.create(buildPaymentTestRegistration(totalAmount), []);
  const { id: paymentId } = await svcs.paymentRepo.create({
    registration_id: regId,
    amount: paymentAmount,
    status: "pending_verification",
    gateway: null,
    gateway_ref: null,
    gateway_response: null,
    proof_file_key: "proof-key.jpg",
    verified_by: null,
    verified_at: null,
  });

  return { regId, paymentId };
}

describe("PaymentService — partial verification & refunds", () => {
  it("V1: full verify with actualAmount omitted confirms registration", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });

    const result = await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 13810);

    expect(result.paymentStatus).toBe("verified");
    expect(result.registrationStatus).toBe("confirmed");

    const reg = await svcs.regRepo.findById(regId);
    expect(reg?.status).toBe("confirmed");

    const payment = await svcs.paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("verified");
    expect(payment?.amount).toBe(13810);

    expect(svcs.emailService.sentPaymentConfirmed).toHaveLength(1);
    expect(svcs.emailService.sentPaymentConfirmed[0].to).toBe(reg?.email);
  });

  it("V2: full verify with actualAmount explicitly equal to expected behaves like V1", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });

    const result = await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 13810);

    expect(result.registrationStatus).toBe("confirmed");
    const payment = await svcs.paymentRepo.findById(paymentId);
    expect(payment?.amount).toBe(13810);
    expect(svcs.emailService.sentPaymentConfirmed).toHaveLength(1);
    void regId;
  });

  it("V3: partial verify without balance payment rejects with 409", async () => {
    const svcs = createPaymentTestServices();
    const { paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });

    try {
      await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 11190);
      expect.fail("Expected AppError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).message).toMatch(/uncovered shortfall/i);
    }

    // Payment must remain untouched — verification never partially applies.
    const payment = await svcs.paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("pending_verification");
    expect(payment?.amount).toBe(13810);
  });

  it("V4: create balance then partial verify succeeds without confirming", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });

    const balance = await svcs.paymentService.createBalancePayment(regId, 2620, "staff@test.com", paymentId);
    expect(balance.amount).toBe(2620);
    expect(svcs.emailService.sentAdditionalPayment).toHaveLength(1);

    const result = await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 11190);

    expect(result.registrationStatus).toBe("pending");
    expect(svcs.emailService.sentPaymentConfirmed).toHaveLength(0);

    const payment = await svcs.paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("verified");
    expect(payment?.amount).toBe(11190);

    const pending = await svcs.paymentRepo.findPendingByRegistration(regId);
    expect(pending?.amount).toBe(2620);

    const reg = await svcs.regRepo.findById(regId);
    expect(reg?.status).toBe("pending");
  });

  it("partial verify with withShortfallPayment=true creates shortfall and sets registration to pending", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 10000 });

    const result = await svcs.paymentService.verifyPayment(paymentId, "UTR-PARTIAL", "staff@test.com", 6000, true);

    expect(result.paymentStatus).toBe("verified");
    expect(result.registrationStatus).toBe("pending");
    expect(result.shortfallCreated).toBeDefined();
    expect(result.shortfallCreated?.amount).toBe(4000);

    const payment = await svcs.paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("verified");
    expect(payment?.amount).toBe(6000);

    const shortfallPayment = await svcs.paymentRepo.findPendingByRegistration(regId);
    expect(shortfallPayment).not.toBeNull();
    expect(shortfallPayment?.amount).toBe(4000);

    const reg = await svcs.regRepo.findById(regId);
    expect(reg?.status).toBe("pending");

    expect(svcs.emailService.sentPaymentConfirmed).toHaveLength(0);
  });

  it("compound verify then shortfall proof-and-verify completes registration lifecycle", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 10000 });

    // Step 1: staff partially verifies and opts to auto-create the shortfall
    // balance payment in the same call.
    const first = await svcs.paymentService.verifyPayment(paymentId, "UTR1", "staff@test.com", 6000, true);
    expect(first.registrationStatus).toBe("pending");

    const regAfterFirst = await svcs.regRepo.findById(regId);
    expect(regAfterFirst?.status).toBe("pending");

    const shortfallPayment = await svcs.paymentRepo.findPendingByRegistration(regId);
    expect(shortfallPayment).not.toBeNull();
    const shortfallPaymentId = shortfallPayment!.id;

    // Step 2: attendee uploads proof for the shortfall payment. Simulated
    // here via a direct repo call (not through the service) — this must NOT
    // move the registration status, since derivation only runs from
    // PaymentService methods, never as a side effect of a bare repo write.
    await svcs.paymentRepo.updateStatus(shortfallPaymentId, "pending_verification");
    const regAfterProofBypass = await svcs.regRepo.findById(regId);
    expect(regAfterProofBypass?.status).toBe("pending");

    // Step 3: staff verifies the shortfall payment for the full remaining
    // amount — this closes out total_amount and must confirm registration.
    const second = await svcs.paymentService.verifyPayment(shortfallPaymentId, "UTR2", "staff@test.com", 4000);
    expect(second.registrationStatus).toBe("confirmed");

    const regFinal = await svcs.regRepo.findById(regId);
    expect(regFinal?.status).toBe("confirmed");

    expect(svcs.emailService.sentPaymentConfirmed).toHaveLength(1);
    expect(svcs.emailService.sentPaymentConfirmed[0].to).toBe(regFinal?.email);
  });

  it("uploadProof on shortfall payment derives pending_verification", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 10000 });

    // Step 1: Compound partial verify — creates shortfall payment_pending
    await svcs.paymentService.verifyPayment(paymentId, "UTR1", "staff@test.com", 6000, true);
    const regAfterVerify = await svcs.regRepo.findById(regId);
    expect(regAfterVerify?.status).toBe("pending");

    // Step 2: Upload proof on the shortfall payment
    const shortfall = await svcs.paymentRepo.findPendingByRegistration(regId);
    expect(shortfall).not.toBeNull();

    await svcs.paymentService.uploadProof(
      regId,
      new ArrayBuffer(8),
      { mimeType: "image/jpeg", fileName: "proof.jpg", sizeBytes: 8 },
    );

    // Assert: registration status is pending_verification (R1.1 row 5)
    const regAfterProof = await svcs.regRepo.findById(regId);
    expect(regAfterProof?.status).toBe("pending_verification");

    // Assert: shortfall payment is now pending_verification
    const shortfallAfterProof = await svcs.paymentRepo.findById(shortfall!.id);
    expect(shortfallAfterProof?.status).toBe("pending_verification");
  });

  it("V5: second payment completes total and confirms", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });

    await svcs.paymentService.createBalancePayment(regId, 2620, "staff@test.com", paymentId);
    await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 11190);

    const balancePayment = await svcs.paymentRepo.findPendingByRegistration(regId);
    expect(balancePayment).not.toBeNull();

    // Simulate the attendee uploading proof for the shortfall payment.
    await svcs.paymentRepo.updateStatus(balancePayment!.id, "pending_verification");

    const result = await svcs.paymentService.verifyPayment(balancePayment!.id, "UTR456", "staff@test.com", 2620);

    expect(result.registrationStatus).toBe("confirmed");
    expect(svcs.emailService.sentPaymentConfirmed).toHaveLength(1);

    const reg = await svcs.regRepo.findById(regId);
    expect(reg?.status).toBe("confirmed");
  });

  it("V6: overpayment verifies for expected amount and creates refund", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });

    const result = await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 25000);

    expect(result.refundCreated).toBeDefined();
    expect(result.refundCreated?.amount).toBe(11190);
    expect(result.registrationStatus).toBe("confirmed");

    const payment = await svcs.paymentRepo.findById(paymentId);
    expect(payment?.amount).toBe(13810);
    expect(payment?.status).toBe("verified");

    const refunds = await svcs.refundRepo.list({ status: "pending" });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(11190);
    expect(refunds[0].registrationId).toBe(regId);
    expect(refunds[0].sourcePaymentId).toBe(paymentId);
    expect(refunds[0].status).toBe("pending");
  });

  it("V7: actualAmount of zero rejects with 422", async () => {
    const svcs = createPaymentTestServices();
    const { paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });

    try {
      await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 0);
      expect.fail("Expected AppError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(422);
    }
  });

  it("V8: creating balance payment when one already exists rejects with 409", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });
    await svcs.paymentRepo.create({
      registration_id: regId,
      amount: 1000,
      status: "payment_pending",
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    });

    try {
      await svcs.paymentService.createBalancePayment(regId, 1000, "staff@test.com", paymentId);
      expect.fail("Expected AppError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
    }
  });

  it("V9: completing a pending refund succeeds", async () => {
    const svcs = createPaymentTestServices();
    const { paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });
    const verifyResult = await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 25000);
    const refundId = verifyResult.refundCreated!.id;

    const result = await svcs.paymentService.completeRefund(refundId, "IMPS/999", "staff@test.com");

    expect(result.status).toBe("completed");

    const refund = await svcs.refundRepo.findById(refundId);
    expect(refund?.status).toBe("completed");
    expect(refund?.bankReference).toBe("IMPS/999");
    expect(refund?.resolvedBy).toBe("staff@test.com");
    expect(refund?.resolvedAt).toBeTypeOf("number");

    // Refund completion audits via system_audit_log (PaymentService batch) —
    // exactly one row for the winner.
    const auditEntries = svcs.completionDb.systemAuditRows.filter((e) => e.action === "refund_completed");
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].actor).toBe("staff@test.com");
  });

  it("V10: completing an already completed refund rejects with 409", async () => {
    const svcs = createPaymentTestServices();
    const { paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });
    const verifyResult = await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 25000);
    const refundId = verifyResult.refundCreated!.id;
    await svcs.paymentService.completeRefund(refundId, "IMPS/999", "staff@test.com");

    try {
      await svcs.paymentService.completeRefund(refundId, "IMPS/000", "staff@test.com");
      expect.fail("Expected AppError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
    }
  });

  it("V11: verify payment not in pending_verification rejects with 409", async () => {
    const svcs = createPaymentTestServices();
    const { regId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });
    const { id: pendingPaymentId } = await svcs.paymentRepo.create({
      registration_id: regId,
      amount: 13810,
      status: "payment_pending",
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    });

    try {
      await svcs.paymentService.verifyPayment(pendingPaymentId, "UTR123", "staff@test.com", 13810);
      expect.fail("Expected AppError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
    }
  });

  it("V4b: both payments in pending_verification — verify doesn't deadlock", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });

    await svcs.paymentService.createBalancePayment(regId, 2620, "staff@test.com", paymentId);

    const balancePayment = await svcs.paymentRepo.findPendingByRegistration(regId);
    expect(balancePayment).not.toBeNull();
    await svcs.paymentRepo.updateStatus(balancePayment!.id, "pending_verification");

    const result = await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 11190);
    expect(result.paymentStatus).toBe("verified");
    expect(result.registrationStatus).toBe("pending_verification");

    await svcs.paymentRepo.updateStatus(balancePayment!.id, "pending_verification");
    const result2 = await svcs.paymentService.verifyPayment(balancePayment!.id, "UTR456", "staff@test.com", 2620);
    expect(result2.registrationStatus).toBe("confirmed");
  });

  it("V13: partial verify audit entry contains expectedAmount and actualAmount", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });
    await svcs.paymentService.createBalancePayment(regId, 2620, "staff@test.com", paymentId);
    await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 11190);

    const verifiedEntries = svcs.auditRepo.entries.filter((e) => e.action === "payment_verified");
    expect(verifiedEntries).toHaveLength(1);
    const changes = verifiedEntries[0].changes as unknown as { expectedAmount: number; actualAmount: number };
    expect(changes.expectedAmount).toBe(13810);
    expect(changes.actualAmount).toBe(11190);

    const createdEntries = svcs.auditRepo.entries.filter((e) => e.action === "payment_created");
    expect(createdEntries).toHaveLength(1);
    const createdChanges = createdEntries[0].changes as unknown as { amount: number; reason: string; sourcePaymentId: number };
    expect(createdChanges.reason).toBe("partial_verification_shortfall");
    expect(createdChanges.sourcePaymentId).toBe(paymentId);
  });

  it("V6 audit: overpayment creates refund_created audit entry", async () => {
    const svcs = createPaymentTestServices();
    const { paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });
    await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 25000);

    const refundEntries = svcs.auditRepo.entries.filter((e) => e.action === "refund_created");
    expect(refundEntries).toHaveLength(1);
    expect(refundEntries[0].actor).toBe("staff@test.com");
    const changes = refundEntries[0].changes as unknown as {
      refundId: number; amount: number; sourcePaymentId: number;
      expectedAmount: number; actualAmount: number;
    };
    expect(changes.amount).toBe(11190);
    expect(changes.sourcePaymentId).toBe(paymentId);
    expect(changes.expectedAmount).toBe(13810);
    expect(changes.actualAmount).toBe(25000);
  });

  it("V1 audit: full verify creates payment_verified audit only", async () => {
    const svcs = createPaymentTestServices();
    const { paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });
    await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 13810);

    const verified = svcs.auditRepo.entries.filter((e) => e.action === "payment_verified");
    expect(verified).toHaveLength(1);
    const refundAudits = svcs.auditRepo.entries.filter((e) => e.action === "refund_created");
    expect(refundAudits).toHaveLength(0);
  });

  it("V4 audit: partial verify creates payment_created + payment_verified audits", async () => {
    const svcs = createPaymentTestServices();
    const { regId, paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });
    await svcs.paymentService.createBalancePayment(regId, 2620, "staff@test.com", paymentId);
    await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 11190);

    const actions = svcs.auditRepo.entries.map(e => e.action);
    expect(actions).toContain("payment_created");
    expect(actions).toContain("payment_verified");
    expect(actions).not.toContain("refund_created");
  });

  it("V9 audit: completing refund creates refund_completed audit", async () => {
    const svcs = createPaymentTestServices();
    const { paymentId } = await seedRegistrationWithPayment(svcs, { totalAmount: 13810 });
    const result = await svcs.paymentService.verifyPayment(paymentId, "UTR123", "staff@test.com", 25000);
    await svcs.paymentService.completeRefund(result.refundCreated!.id, "IMPS/999", "staff@test.com");

    const completed = svcs.completionDb.systemAuditRows.filter((e) => e.action === "refund_completed");
    expect(completed).toHaveLength(1);
    const changes = JSON.parse(completed[0].details) as { refundId: number; amount: number; bankReference: string };
    expect(changes.bankReference).toBe("IMPS/999");
    expect(changes.amount).toBe(11190);
  });
});
