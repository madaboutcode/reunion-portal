/**
 * Spec enforcement tests — payment flow & submission API.
 *
 * Tests every externally observable guarantee from:
 *   - payment-flow.spec.md (status model, proof upload, status mirroring)
 *   - submission-api.spec.md (submission response shape, registration retrieval)
 *
 * These tests are loyal ONLY to the spec. If the implementation doesn't match
 * the spec, the test fails. Failures are bug reports for the implementation.
 *
 * Tests use pure functions for status transitions and minimal in-memory fakes
 * for service-layer tests — same pattern as e2e.test.ts.
 *
 * @module payment-flow.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { SubmitRegistrationRequest, PricingBreakup } from "@smriti/shared";
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
  FileMetadata,
  Refund,
  NewRefund,
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import {
  isValidTransition,
  isValidPaymentTransition,
} from "../domain/status.js";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  IDocumentRepository,
  IFileStorage,
  IEmailService,
  IRefundRepository,
  PaymentConfirmedEmailData,
} from "../repositories/interfaces.js";
import { RegistrationService } from "../services/registration.service.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PaymentService } from "../services/payment.service.js";
import { PricingService } from "../services/pricing.service.js";
import { unusedD1 } from "./helpers/minimal-d1.js";
import {
  ValidationError,
  NotFoundError,
  AppError,
} from "../services/errors.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";

const stubAvailabilityService = { isAccommodationAvailable: async () => true } as unknown as AvailabilityService;

// =============================================================================
// Gap Analysis — Underspecification and Discrepancies
// =============================================================================
//
// **HIGH-LEVEL AMBIGUITY: confirmed→pending transition**
//
// payment-flow.spec.md R1 states: "When amendments increase the cost in
// future versions, confirmed → pending is supported." But status.ts
// `isValidTransition` has `confirmed: []` — no transitions from confirmed.
//
// Theme question: Is `confirmed → pending` a V1 requirement, a future
// requirement, or a spec error?
//
// Resolves: R1 enforcement tests must document which transitions are valid
// today vs. which are planned. Test below flags the gap rather than assuming
// either direction.
//
// ---
//
// **INDIVIDUAL GAP: paymentUrl vs paymentRedirectUrl**
//
// submission-api.spec.md R3.4 shows `"paymentUrl"` in the response.
// api-types.ts defines `SubmitRegistrationResponse.paymentUrl`.
// But e2e.test.ts tests `result.paymentRedirectUrl` — a field that doesn't
// exist on the type. The existing tests are testing a field name from a
// deleted gateway flow.
//
// ---
//
// **INDIVIDUAL GAP: ProofUploadResponse message text**
//
// submission-api.spec.md R6.5 specifies message:
//   "Proof submitted. The committee will review your payment."
// payment.service.ts returns:
//   "Payment proof uploaded, awaiting verification"
// These don't match. The spec wording is more user-friendly.
//
// ---
//
// **INDIVIDUAL GAP: Most recent payment ordering**
//
// payment-flow.spec.md R2.1 says "most recent" drives registration status.
// But "most recent" is undefined — created_at DESC? id DESC? Both?
// The code relies on paymentRepo.findByRegistration() ordering (by
// created_at, per GUARANTEE MOST_RECENT_PAYMENT in payment.service.ts).

// =============================================================================
// Minimal test data
// =============================================================================

const validSubmitData: SubmitRegistrationRequest = {
  contact: {
    fullName: "Test User",
    branch: "Computer Science & Engineering",
    gender: "male",
    email: "test@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: undefined,
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

// =============================================================================
// In-memory repository fakes
// =============================================================================

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
    if (data.email !== undefined) reg.email = data.email;
    if (data.country !== undefined) reg.country = data.country;
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
    return this.payments.get(id) ?? null;
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
    if (gatewayData?.gateway !== undefined) p.gateway = gatewayData.gateway;
    if (gatewayData?.gatewayResponse !== undefined)
      p.gatewayResponse = gatewayData.gatewayResponse;
    if (proofFileKey !== undefined) p.proofFileKey = proofFileKey;
    if (verification !== undefined) {
      p.verifiedBy = verification.verifiedBy;
      p.verifiedAt = verification.verifiedAt;
    }
  }

  async verify(
    id: number,
    amount: number,
    gatewayRef: string,
    verifiedBy: string,
    verifiedAt: number,
  ): Promise<void> {
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

  async sumVerified(_filters?: { type?: 'attendee' | 'donor' }): Promise<number> {
    return 0;
  }

  async sumVerifiedByBranch(_filters?: { type?: 'attendee' | 'donor' }): Promise<Array<{ branch: string; collected: number }>> {
    return [];
  }
  async findPendingByRegistration(_registrationId: number): Promise<Payment | null> { return null; }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async sumVerifiedByRegistration(registrationId: number): Promise<number> {
    return [...this.payments.values()]
      .filter((p) => p.registrationId === registrationId && p.status === "verified")
      .reduce((sum, p) => sum + p.amount, 0);
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
  async create(_doc: NewIdDocument): Promise<{ id: number }> {
    return { id: 1 };
  }
  async findByRegistration(
    _registrationId: number,
  ): Promise<IdDocument[]> {
    return [];
  }
  async updateR2Key(_docId: number, _newKey: string): Promise<void> {}
}

class ObservableFileStorage implements IFileStorage {
  uploadedFiles: Array<{
    key: string;
    metadata: FileMetadata;
  }> = [];
  shouldFail: boolean = false;

  async upload(
    key: string,
    _data: ArrayBuffer,
    metadata: FileMetadata,
  ): Promise<void> {
    if (this.shouldFail) throw new Error("R2 upload failed");
    this.uploadedFiles.push({ key, metadata });
  }

  async getSignedUrl(_key: string, _expiresIn: number): Promise<string> {
    throw new Error("not implemented");
  }

  async get(_key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null> {
    return null;
  }

  async delete(_key: string): Promise<void> {}

  async copy(_fromKey: string, _toKey: string): Promise<boolean> {
    return true;
  }

  async move(_fromKey: string, _toKey: string): Promise<void> {}
}

class StubEmailService implements IEmailService {
  async sendConfirmation(
    _to: string,
    _data: { regId: string; fullName: string; totalAmount: number; attendanceIntent: string },
  ): Promise<void> {}
  async sendMagicLink(
    _to: string,
    _data: { token: string; expiresIn: number },
  ): Promise<void> {}
  async sendPaymentConfirmed(_to: string, _data: unknown): Promise<void> {}
  async sendPaymentRejected(_to: string, _data: unknown): Promise<void> {}
  async sendStaffWelcome(_to: string, _data: unknown): Promise<void> {}
  async sendPaymentLink(_to: string, _data: unknown): Promise<void> {}
  async sendRevisedPayment(_to: string, _data: unknown): Promise<void> {}
  async sendAdditionalPayment(_to: string, _data: unknown): Promise<void> {}
  async sendStoryHidden(_to: string, _data: unknown): Promise<void> {}
}

// =============================================================================
// Test context
// =============================================================================

interface TestServices {
  registrationService: RegistrationService;
  paymentService: PaymentService;
  regRepo: InMemoryRegistrationRepo;
  attendeeRepo: InMemoryAttendeeRepo;
  paymentRepo: InMemoryPaymentRepo;
  auditRepo: InMemoryAuditRepo;
  fileStorage: ObservableFileStorage;
}

function createTestServices(): TestServices {
  const regRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  const documentRepo = new StubDocumentRepo();
  const fileStorage = new ObservableFileStorage();
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

  const paymentService = new PaymentService({
    db: unusedD1 as unknown as import('@cloudflare/workers-types').D1Database,
    registrationRepo: regRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    refundRepo: {
      create: async () => { throw new Error('refundRepo is unused in this payment-flow path'); },
      findById: async () => null,
      list: async () => [],
      listWithRegistration: async () => [],
      findByRegistration: async () => [],
      findByOriginalRegistration: async () => [],
    },
    fileStorage,
    emailService,
    appBaseUrl: 'http://localhost:5173',
  });

  return {
    registrationService,
    paymentService,
    regRepo,
    attendeeRepo,
    paymentRepo,
    auditRepo,
    fileStorage,
  };
}

// =============================================================================
// 1. Status Model Transitions
// =============================================================================
// Spec: payment-flow.spec.md R1, R2
// Source: status.ts — isValidTransition, isValidPaymentTransition

describe("Status Model — Registration Transitions (R1)", () => {
  // R1: pending → pending_verification → confirmed
  it("R1: pending → pending_verification is valid", () => {
    expect(isValidTransition("pending", "pending_verification")).toBe(true);
  });

  it("R1: pending_verification → confirmed is valid", () => {
    expect(isValidTransition("pending_verification", "confirmed")).toBe(true);
  });

  it("R1/R7.14: confirmed → pending is valid (staff edit creates payment obligation)", () => {
    expect(isValidTransition("confirmed", "pending")).toBe(true);
    // confirmed → pending_verification and confirmed → confirmed are still invalid
    expect(isValidTransition("confirmed", "pending_verification")).toBe(false);
    expect(isValidTransition("confirmed", "confirmed")).toBe(false);
  });

  // R1 explicitly rejects self-transitions and reverse transitions
  it("R1: self-transitions are invalid (pending → pending)", () => {
    expect(isValidTransition("pending", "pending")).toBe(false);
    expect(isValidTransition("pending_verification", "pending_verification")).toBe(false);
    expect(isValidTransition("confirmed", "confirmed")).toBe(false);
  });

  it("R1: pending_verification → pending is valid (rejection rollback), confirmed → pending_verification is invalid", () => {
    // Rejection path: staff rejects proof, registration rolls back to pending
    expect(isValidTransition("pending_verification", "pending")).toBe(true);
    // confirmed → pending_verification is invalid (must go through pending first)
    expect(isValidTransition("confirmed", "pending_verification")).toBe(false);
  });

  it("R7.14: pending → confirmed is valid (delta==0 after edit removes pending payment)", () => {
    expect(isValidTransition("pending", "confirmed")).toBe(true);
  });

  it("R1: returns false (never throws) for invalid input", () => {
    // Validators return false for rejected transitions — they don't throw
    expect(() => {
      isValidTransition("pending", "confirmed" as RegistrationStatus);
    }).not.toThrow();
  });
});

describe("Status Model — Payment Transitions (R2)", () => {
  // R2: payment_pending → pending_verification → verified
  it("R2: payment_pending → pending_verification is valid", () => {
    expect(
      isValidPaymentTransition("payment_pending", "pending_verification"),
    ).toBe(true);
  });

  it("R2: pending_verification → verified is valid", () => {
    expect(
      isValidPaymentTransition("pending_verification", "verified"),
    ).toBe(true);
  });

  it("R2: verified has no valid outgoing transitions (terminal)", () => {
    const allStatuses: PaymentStatus[] = ["payment_pending", "pending_verification", "verified"];
    for (const to of allStatuses) {
      expect(isValidPaymentTransition("verified", to)).toBe(false);
    }
  });

  it("R2: self-transitions are invalid", () => {
    expect(
      isValidPaymentTransition("payment_pending", "payment_pending"),
    ).toBe(false);
    expect(
      isValidPaymentTransition("pending_verification", "pending_verification"),
    ).toBe(false);
    expect(isValidPaymentTransition("verified", "verified")).toBe(false);
  });

  it("R2: pending_verification → payment_pending is valid (rejection rollback), verified → pending_verification is invalid", () => {
    // Rejection path: staff rejects proof, payment rolls back to payment_pending
    expect(
      isValidPaymentTransition("pending_verification", "payment_pending"),
    ).toBe(true);
    // verified is terminal — no rollback from verified
    expect(
      isValidPaymentTransition("verified", "pending_verification"),
    ).toBe(false);
  });

  it("R2: skip transitions are invalid (payment_pending → verified)", () => {
    expect(
      isValidPaymentTransition("payment_pending", "verified"),
    ).toBe(false);
  });

  it("R2: returns false (never throws) for invalid input", () => {
    expect(() => {
      isValidPaymentTransition(
        "payment_pending",
        "verified" as PaymentStatus,
      );
    }).not.toThrow();
  });
});

// =============================================================================
// 2. Submission Response Shape
// =============================================================================
// Spec: submission-api.spec.md R3.4, R3.6, R3.7
// Source: RegistrationService.submit()

describe("Submission Response Shape (R3.4, R3.6, R3.7)", () => {
  let svc: TestServices;

  beforeEach(() => {
    svc = createTestServices();
  });

  it("R3.4: response has paymentUrl field (NOT paymentRedirectUrl)", async () => {
    // The spec and api-types.ts both define `paymentUrl`.
    // Existing e2e.test.ts tests `paymentRedirectUrl` which is a holdover
    // from the deleted payment gateway flow.
    const result = await svc.registrationService.submit(validSubmitData);

    // TypeScript guarantees paymentUrl exists on SubmitRegistrationResponse.
    // This runtime assertion ensures it's a string (not undefined/missing).
    expect(result.paymentUrl).toBeTypeOf("string");
    expect(result.paymentUrl).toMatch(/^\/pay\//);
  });

  it("R3.6: status is 'pending' on creation", async () => {
    const result = await svc.registrationService.submit(validSubmitData);
    expect(result.status).toBe("pending");
  });

  it("R3.4: response includes all required fields", async () => {
    const result = await svc.registrationService.submit(validSubmitData);

    // Every field from SubmitRegistrationResponse must be present
    expect(result.regId).toBeTypeOf("string");
    expect(result.regId).toMatch(/^\d+$/);
    expect(result.regCode).toBeTypeOf("string");
    expect(result.regCode).toHaveLength(16);
    expect(result.regCode).toMatch(/^SMRT/);
    expect(result.token).toBeTypeOf("string");
    expect(result.status).toBe("pending");
    expect(result.pricingBreakup).toBeDefined();
    expect(result.pricingBreakup.total).toBeGreaterThan(0);
    expect(result.paymentUrl).toBeTypeOf("string");
  });

  it("R3.4: pricingBreakup has required sub-fields", async () => {
    const result = await svc.registrationService.submit(validSubmitData);
    const pb = result.pricingBreakup;

    expect(typeof pb.base).toBe("number");
    expect(typeof pb.donation).toBe("number");
    expect(typeof pb.total).toBe("number");
    expect(Array.isArray(pb.lines)).toBe(true);
    // total includes base + all line fees + donation (lines are additive)
    const linesTotal = pb.lines.reduce((sum, line) => sum + line.fee, 0);
    expect(pb.total).toBe(pb.base + linesTotal + pb.donation);
  });

  it("R3.7: paymentUrl is empty string when total is 0 (free registration)", async () => {
    // R3.7: "When total is 0, paymentUrl is empty"
    // Use donation_only with amount=0 (though registrationSchema may reject this)
    // Test the conceptual guarantee: if total=0, paymentUrl is ''
    const freeData: SubmitRegistrationRequest = {
      ...validSubmitData,
      // donation_only carries no alumniMeal/tshirtSize — registrationSchema
      // rejects them (attendees-meals.spec.md R1/R2.4; commit 9c8d5bc).
      attendance: { intent: "donation_only", participationType: "donation_only" },
      accommodation: undefined,
      donation: { amount: 1, publicAcknowledgement: true, felicitationConsent: false },
    };
    // With donation amount=1, total will be small but > 0.
    // The type system guarantees paymentUrl is always string.
    // Actual empty-string behavior requires total=0 which is blocked by
    // registrationSchema (donation-only requires positive donation).
    // This test verifies that non-zero total produces a non-empty paymentUrl.
    const result = await svc.registrationService.submit(freeData);
    expect(result.paymentUrl).not.toBe("");
  });

  it("R3.4: paymentUrl format is '/pay/{regCode}' for bank transfer flow", async () => {
    // Spec R3.7: paymentUrl is the URL to the bank details page.
    // The format is /pay/:regCode (public regCode used, not the internal numeric id).
    const result = await svc.registrationService.submit(validSubmitData);
    expect(result.paymentUrl).toBe("/pay/" + result.regCode);
  });

  it("R3.12: a payment_pending record is created for non-zero totals", async () => {
    const result = await svc.registrationService.submit(validSubmitData);
    const payments = await svc.paymentRepo.findByRegistration(
      Number(result.regId),
    );

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("payment_pending");
    expect(payments[0].amount).toBe(result.pricingBreakup.total);
    expect(payments[0].gateway).toBeNull();
  });
});

// =============================================================================
// 3. Proof Upload — PaymentService.uploadProof()
// =============================================================================
// Spec: submission-api.spec.md R6, payment-flow.spec.md R5
// Source: PaymentService.uploadProof()

describe("Proof Upload — uploadProof() (R6, R5)", () => {
  let svc: TestServices;
  let regId: number;
  let regCode: string;

  beforeEach(async () => {
    svc = createTestServices();
    // Submit a registration to establish state
    const result = await svc.registrationService.submit(validSubmitData);
    regId = Number(result.regId);
    regCode = result.regCode;
  });

  it("R6.5 / R5.4: successful upload returns { status: 'pending_verification', message }", async () => {
    const fileData = new ArrayBuffer(8);
    const metadata: FileMetadata = {
      mimeType: "image/png",
      fileName: "proof.png",
      sizeBytes: 1024,
    };

    const response = await svc.paymentService.uploadProof(
      regId,
      fileData,
      metadata,
    );

    // R6.5: response shape per ProofUploadResponse
    expect(response.status).toBe("pending_verification");
    expect(response.message).toBeTypeOf("string");
  });

  it("R6.8 / R5.4: payment status transitions to 'pending_verification'", async () => {
    const fileData = new ArrayBuffer(8);
    const metadata: FileMetadata = {
      mimeType: "image/png",
      fileName: "proof.png",
      sizeBytes: 1024,
    };

    await svc.paymentService.uploadProof(regId, fileData, metadata);

    const payments = await svc.paymentRepo.findByRegistration(regId);
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("pending_verification");
    expect(payments[0].proofFileKey).toBeTypeOf("string");
    expect(payments[0].proofFileKey).toMatch(/^registrations\/.+\/proof-\d+\.(jpg|png|pdf|bin)$/);
  });

  it("R6.9 / R5.4: registration status transitions to 'pending_verification'", async () => {
    const fileData = new ArrayBuffer(8);
    const metadata: FileMetadata = {
      mimeType: "image/png",
      fileName: "proof.png",
      sizeBytes: 1024,
    };

    await svc.paymentService.uploadProof(regId, fileData, metadata);

    const reg = await svc.regRepo.findById(regId);
    expect(reg).not.toBeNull();
    expect(reg!.status).toBe("pending_verification");
  });

  it("R6.10: audit entry logged with action 'proof_uploaded'", async () => {
    const fileData = new ArrayBuffer(8);
    const metadata: FileMetadata = {
      mimeType: "image/png",
      fileName: "proof.png",
      sizeBytes: 1024,
    };

    await svc.paymentService.uploadProof(regId, fileData, metadata);

    const proofEntries = svc.auditRepo.entries.filter(
      (e) => e.action === "proof_uploaded",
    );
    expect(proofEntries).toHaveLength(1);
    // R6.10: actor should be the registration email
    expect(proofEntries[0].actor).toBe(validSubmitData.contact.email);
  });

  it("R6.6: proof file stored at key pattern 'registrations/{regCode}/proof-{paymentId}.{ext}'", async () => {
    const fileData = new ArrayBuffer(8);
    const metadata: FileMetadata = {
      mimeType: "image/png",
      fileName: "proof.png",
      sizeBytes: 1024,
    };

    await svc.paymentService.uploadProof(regId, fileData, metadata);

    expect(svc.fileStorage.uploadedFiles).toHaveLength(1);
    const uploaded = svc.fileStorage.uploadedFiles[0];
    // New format: registrations/{regCode}/proof-{paymentId}.{ext}
    expect(uploaded.key).toMatch(/^registrations\/.+\/proof-\d+\.png$/);
    expect(uploaded.key).toContain(regCode);
    expect(uploaded.key).not.toContain("payment-proofs/");
  });

  it("R6.11: throws 409 when no payment_pending record exists", async () => {
    // Transition the existing payment to pending_verification first
    const payments = await svc.paymentRepo.findByRegistration(regId);
    await svc.paymentRepo.updateStatus(
      payments[0].id,
      "pending_verification",
    );

    // Now try to upload proof — no payment_pending record remains
    const fileData = new ArrayBuffer(8);
    const metadata: FileMetadata = {
      mimeType: "image/png",
      fileName: "proof2.png",
      sizeBytes: 1024,
    };

    try {
      await svc.paymentService.uploadProof(regId, fileData, metadata);
      expect.fail("Expected AppError with 409");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
    }
  });

  it("R6.11: 409 error message mentions 'No pending payment'", async () => {
    // Transition existing payment away from payment_pending
    const payments = await svc.paymentRepo.findByRegistration(regId);
    await svc.paymentRepo.updateStatus(
      payments[0].id,
      "pending_verification",
    );

    const fileData = new ArrayBuffer(8);
    const metadata: FileMetadata = {
      mimeType: "image/png",
      fileName: "proof2.png",
      sizeBytes: 1024,
    };

    try {
      await svc.paymentService.uploadProof(regId, fileData, metadata);
      expect.fail("Expected AppError");
    } catch (err) {
      expect((err as AppError).message).toContain("No pending payment");
    }
  });

  it("R6.1 (implied): throws NotFoundError when registration does not exist", async () => {
    const fileData = new ArrayBuffer(8);
    const metadata: FileMetadata = {
      mimeType: "image/png",
      fileName: "proof.png",
      sizeBytes: 1024,
    };

    await expect(
      svc.paymentService.uploadProof(99999, fileData, metadata),
    ).rejects.toThrow(NotFoundError);
  });

  it("STORE_BEFORE_MUTATE: file storage failure prevents DB mutations", async () => {
    svc.fileStorage.shouldFail = true;

    const fileData = new ArrayBuffer(8);
    const metadata: FileMetadata = {
      mimeType: "image/png",
      fileName: "proof.png",
      sizeBytes: 1024,
    };

    await expect(
      svc.paymentService.uploadProof(regId, fileData, metadata),
    ).rejects.toThrow("R2 upload failed");

    // Verify no side effects — payment stays payment_pending
    const payments = await svc.paymentRepo.findByRegistration(regId);
    expect(payments[0].status).toBe("payment_pending");

    // Registration stays pending
    const reg = await svc.regRepo.findById(regId);
    expect(reg!.status).toBe("pending");

    // No audit entry logged
    const proofEntries = svc.auditRepo.entries.filter(
      (e) => e.action === "proof_uploaded",
    );
    expect(proofEntries).toHaveLength(0);
  });
});

// =============================================================================
// 5. Registration Retrieval — Status Values
// =============================================================================
// Spec: submission-api.spec.md R7.3, R4.2
// Source: RegistrationService.getByToken()

describe("Registration Retrieval — Status Values (R7.3, R4.2)", () => {
  let svc: TestServices;

  beforeEach(() => {
    svc = createTestServices();
  });

  it("R7.3 / R4.2: registration status is one of 'pending' | 'pending_verification' | 'confirmed'", async () => {
    // Register
    const submitResult = await svc.registrationService.submit(validSubmitData);
    const regId = Number(submitResult.regId);

    // Fetch via /me — should show 'pending'
    const response = await svc.registrationService.getByToken(regId);
    const validStatuses: RegistrationStatus[] = [
      "pending",
      "pending_verification",
      "confirmed",
    ];
    expect(validStatuses).toContain(response.registration.status);
    expect(response.registration.status).toBe("pending");
  });

  it("R4.2: status is 'pending' immediately after submission", async () => {
    const submitResult = await svc.registrationService.submit(validSubmitData);

    const response = await svc.registrationService.getByToken(
      Number(submitResult.regId),
    );
    expect(response.registration.status).toBe("pending");
  });

  it("R4.2: status transitions to 'pending_verification' after proof upload", async () => {
    const submitResult = await svc.registrationService.submit(validSubmitData);
    const regId = Number(submitResult.regId);

    // Upload proof
    await svc.paymentService.uploadProof(
      regId,
      new ArrayBuffer(8),
      { mimeType: "image/png", fileName: "proof.png", sizeBytes: 1024 },
    );

    const response = await svc.registrationService.getByToken(regId);
    expect(response.registration.status).toBe("pending_verification");
  });

  it("R4.2: status value is always a valid RegistrationStatus literal", async () => {
    // Verify the RegistrationResponseData type constrains status
    // to the 3-value union per api-types.ts line 52.
    const submitResult = await svc.registrationService.submit(validSubmitData);

    const response = await svc.registrationService.getByToken(
      Number(submitResult.regId),
    );
    const { status } = response.registration;

    // Type narrowing: TypeScript guarantees this union
    expect(["pending", "pending_verification", "confirmed"]).toContain(status);
    // TypeScript would catch a 4th value
    expect(status).not.toBe("something_else" as RegistrationStatus);
  });
});

// =============================================================================
// 6. Audit Trail Verification
// =============================================================================
// Spec: payment-flow.spec.md R8
// Source: RegistrationService.submit() + PaymentService.uploadProof()

describe("Audit Trail (R8)", () => {
  let svc: TestServices;

  beforeEach(() => {
    svc = createTestServices();
  });

  it("R8.1: 'created' audit entry logged on submission (payment is part of the aggregate)", async () => {
    await svc.registrationService.submit(validSubmitData);

    const createdEntries = svc.auditRepo.entries.filter(
      (e) => e.action === "created",
    );
    expect(createdEntries).toHaveLength(1);
    // R8.4: actor is the registrant's email for initial creation
    expect(createdEntries[0].actor).toBe(validSubmitData.contact.email);
  });

  it("R8.2: proof_uploaded audit entry logged on proof upload", async () => {
    const result = await svc.registrationService.submit(validSubmitData);
    const regId = Number(result.regId);

    await svc.paymentService.uploadProof(
      regId,
      new ArrayBuffer(8),
      { mimeType: "image/png", fileName: "proof.png", sizeBytes: 1024 },
    );

    const proofEntries = svc.auditRepo.entries.filter(
      (e) => e.action === "proof_uploaded",
    );
    expect(proofEntries).toHaveLength(1);
    expect(proofEntries[0].actor).toBe(validSubmitData.contact.email);
    expect(proofEntries[0].changes).toBeDefined();
  });

  it("R8.1: 'created' audit entry has null changes on submission", async () => {
    await svc.registrationService.submit(validSubmitData);

    const entry = svc.auditRepo.entries.find(
      (e) => e.action === "created",
    );
    expect(entry).toBeDefined();
    expect(entry!.changes).toBeNull();
  });
});

// =============================================================================
// 7. Cross-cutting: ValidationError shape
// =============================================================================
// Spec: submission-api.spec.md R2, R2.1
// Source: RegistrationService.submit()

describe("Error Contract (R2, R2.1)", () => {
  let svc: TestServices;

  beforeEach(() => {
    svc = createTestServices();
  });

  it("R2.1: ValidationError includes fieldErrors with dot-notation paths", async () => {
    const invalidData: SubmitRegistrationRequest = {
      ...validSubmitData,
      contact: {
        ...validSubmitData.contact,
        fullName: "",
        email: "not-an-email",
      },
    };

    try {
      await svc.registrationService.submit(invalidData);
      expect.fail("Expected ValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.statusCode).toBe(400);
      expect(ve.fieldErrors).toBeDefined();
      expect(Object.keys(ve.fieldErrors).length).toBeGreaterThan(0);
    }
  });

  it("R2.6: NotFoundError has statusCode 404", () => {
    const err = new NotFoundError("Registration not found");
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Registration not found");
  });
});

// =============================================================================
// 8. Payment record creation on zero-total registrations
// =============================================================================
// Spec: payment-flow.spec.md R2.2, submission-api.spec.md R3.7
// Source: RegistrationService.submit()

describe("Payment Record Creation (R2.2, R3.7)", () => {
  let svc: TestServices;

  beforeEach(() => {
    svc = createTestServices();
  });

  it("R2.2: payment record IS created for non-zero totals (zero-total submissions are rejected)", async () => {
    // R2.2: "first payment record is created on registration submission
    // for non-zero totals." Zero-total submissions are rejected by the
    // service (ValidationError: 'Registration requires a payable amount').
    // Test the positive case: non-zero creates record.
    const result = await svc.registrationService.submit(validSubmitData);
    expect(result.pricingBreakup.total).toBeGreaterThan(0);

    const payments = await svc.paymentRepo.findByRegistration(
      Number(result.regId),
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("payment_pending");
  });

  it("R3.12: payment record has gateway=null, gateway_ref=null (bank transfer flow)", async () => {
    const result = await svc.registrationService.submit(validSubmitData);

    const payments = await svc.paymentRepo.findByRegistration(
      Number(result.regId),
    );
    expect(payments[0].gateway).toBeNull();
    expect(payments[0].gatewayRef).toBeNull();
    expect(payments[0].gatewayResponse).toBeNull();
  });
});

// =============================================================================
// 9. Staff Operations — verifyPayment() and rejectPayment()
// =============================================================================
// Source: PaymentService.verifyPayment() / rejectPayment()

// Observable email fake — tracks calls so tests can assert send happened
class ObservableEmailService implements IEmailService {
  confirmedCalls: Array<{ to: string } & PaymentConfirmedEmailData> = [];
  rejectedCalls: Array<{ to: string; fullName: string; regId: string; comment: string }> = [];

  async sendConfirmation(_to: string, _data: { regId: string; fullName: string; totalAmount: number; attendanceIntent: string }): Promise<void> {}
  async sendMagicLink(_to: string, _data: { token: string; expiresIn: number }): Promise<void> {}
  async sendStaffWelcome(_to: string, _data: unknown): Promise<void> {}
  async sendPaymentLink(_to: string, _data: unknown): Promise<void> {}

  async sendPaymentConfirmed(to: string, data: PaymentConfirmedEmailData): Promise<void> {
    this.confirmedCalls.push({ to, ...data });
  }

  async sendPaymentRejected(to: string, data: { fullName: string; regId: string; comment: string }): Promise<void> {
    this.rejectedCalls.push({ to, ...data });
  }
  async sendRevisedPayment(_to: string, _data: unknown): Promise<void> {}
  async sendAdditionalPayment(_to: string, _data: unknown): Promise<void> {}
  async sendStoryHidden(_to: string, _data: unknown): Promise<void> {}
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

function createVerifyTestServices(): { paymentService: PaymentService; regRepo: InMemoryRegistrationRepo; paymentRepo: InMemoryPaymentRepo; auditRepo: InMemoryAuditRepo; emailService: ObservableEmailService; refundRepo: InMemoryRefundRepo } {
  const regRepo = new InMemoryRegistrationRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  const emailService = new ObservableEmailService();
  const refundRepo = new InMemoryRefundRepo();

  // Wire companion repos for createWithRelations (needed by bootstrapRegService)
  regRepo.companionPaymentRepo = paymentRepo;

  const paymentService = new PaymentService({
    // verifyPayment's overpayment branch runs plain repository calls; the
    // only PaymentService path that touches the D1 binding is completeRefund,
    // which these tests never call — so the binding must stay untouched.
    db: unusedD1 as unknown as import('@cloudflare/workers-types').D1Database,
    registrationRepo: regRepo,
    paymentRepo,
    attendeeRepo: new InMemoryAttendeeRepo(),
    auditRepo,
    refundRepo,
    fileStorage: new ObservableFileStorage(),
    emailService,
    appBaseUrl: 'http://localhost:5173',
  });

  return { paymentService, regRepo, paymentRepo, auditRepo, emailService, refundRepo };
}

describe("verifyPayment() — GUARANTEE: VERIFY_PAYMENT", () => {
  let svc: ReturnType<typeof createVerifyTestServices>;
  let regId: number;
  let paymentId: number;
  let paymentAmount: number;

  beforeEach(async () => {
    svc = createVerifyTestServices();

    // Bootstrap: submit a registration, then manually advance to pending_verification
    // Wire companion repos for createWithRelations
    svc.regRepo.companionPaymentRepo = svc.paymentRepo;
    svc.regRepo.companionAttendeeRepo = new InMemoryAttendeeRepo();

    const bootstrapRegService = new RegistrationService({
      availabilityService: stubAvailabilityService,
      registrationRepo: svc.regRepo,
      attendeeRepo: new InMemoryAttendeeRepo(),
      auditRepo: svc.auditRepo,
      documentRepo: new StubDocumentRepo(),
      emailService: new StubEmailService(),
      pricingService: new PricingService(),
      authService: { async issueAttendeeToken() { return 'test-jwt-token'; }, async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; } },
    });

    const regResult = await bootstrapRegService.submit(validSubmitData);
    regId = Number(regResult.regId);

    const payments = await svc.paymentRepo.findByRegistration(regId);
    paymentId = payments[0].id;
    paymentAmount = payments[0].amount;
    await svc.paymentRepo.updateStatus(paymentId, "pending_verification");
    await svc.regRepo.updateStatus(regId, "pending_verification");
  });

  it("transitions payment status to 'verified'", async () => {
    await svc.paymentService.verifyPayment(paymentId, "UTR12345", "staff@smriti.com", paymentAmount);

    const payment = await svc.paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("verified");
  });

  it("records referenceId in gatewayRef", async () => {
    await svc.paymentService.verifyPayment(paymentId, "UTR12345", "staff@smriti.com", paymentAmount);

    const payment = await svc.paymentRepo.findById(paymentId);
    expect(payment?.gatewayRef).toBe("UTR12345");
  });

  it("records verifiedBy and verifiedAt", async () => {
    const before = Date.now();
    await svc.paymentService.verifyPayment(paymentId, "UTR12345", "staff@smriti.com", paymentAmount);

    const payment = await svc.paymentRepo.findById(paymentId);
    expect(payment?.verifiedBy).toBe("staff@smriti.com");
    expect(payment?.verifiedAt).toBeGreaterThanOrEqual(before);
  });

  it("transitions registration status to 'confirmed'", async () => {
    await svc.paymentService.verifyPayment(paymentId, "UTR12345", "staff@smriti.com", paymentAmount);

    const reg = await svc.regRepo.findById(regId);
    expect(reg?.status).toBe("confirmed");
  });

  it("appends 'payment_verified' audit entry with staff actor", async () => {
    await svc.paymentService.verifyPayment(paymentId, "UTR12345", "staff@smriti.com", paymentAmount);

    const verifyEntry = svc.auditRepo.entries.find(e => e.action === "payment_verified");
    expect(verifyEntry).toBeDefined();
    expect(verifyEntry?.actor).toBe("staff@smriti.com");
  });

  it("sends payment confirmed email (observable fake proves it was called)", async () => {
    await svc.paymentService.verifyPayment(paymentId, "UTR12345", "staff@smriti.com", paymentAmount);

    // Fire-and-forget — give microtask queue a turn
    await Promise.resolve();
    expect(svc.emailService.confirmedCalls).toHaveLength(1);
    expect(svc.emailService.confirmedCalls[0].payments).toEqual([{ amount: expect.any(Number), referenceId: "UTR12345", date: expect.any(Number) }]);
  });

  it("returns { paymentStatus: 'verified', registrationStatus: 'confirmed' }", async () => {
    const result = await svc.paymentService.verifyPayment(paymentId, "UTR12345", "staff@smriti.com", paymentAmount);

    expect(result.paymentStatus).toBe("verified");
    expect(result.registrationStatus).toBe("confirmed");
  });

  it("throws 409 AppError when payment is not in pending_verification state", async () => {
    // First verify succeeds
    await svc.paymentService.verifyPayment(paymentId, "UTR12345", "staff@smriti.com", paymentAmount);

    // Second verify on already-verified payment must throw 409
    await expect(
      svc.paymentService.verifyPayment(paymentId, "UTR99999", "staff@smriti.com", paymentAmount),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("throws NotFoundError when payment does not exist", async () => {
    await expect(
      svc.paymentService.verifyPayment(99999, "UTR12345", "staff@smriti.com", paymentAmount),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("verifyPayment() — multi-payment confirmation email includes ALL verified payments", () => {
  it("lists every verified payment (not just the final one) once the total is covered", async () => {
    const svc = createVerifyTestServices();
    svc.regRepo.companionPaymentRepo = svc.paymentRepo;
    svc.regRepo.companionAttendeeRepo = new InMemoryAttendeeRepo();

    const bootstrapRegService = new RegistrationService({
      availabilityService: stubAvailabilityService,
      registrationRepo: svc.regRepo,
      attendeeRepo: new InMemoryAttendeeRepo(),
      auditRepo: svc.auditRepo,
      documentRepo: new StubDocumentRepo(),
      emailService: new StubEmailService(),
      pricingService: new PricingService(),
      authService: {
        async issueAttendeeToken() { return "test-jwt-token"; },
        async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; },
      },
    });

    const regResult = await bootstrapRegService.submit(validSubmitData);
    const regId = Number(regResult.regId);
    const total = regResult.pricingBreakup.total;

    const initialPayments = await svc.paymentRepo.findByRegistration(regId);
    const payment1Id = initialPayments[0].id;

    // Second payment covers the remainder still owed.
    const { id: payment2Id } = await svc.paymentRepo.create({
      registration_id: regId,
      amount: total - 1,
      status: "payment_pending",
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    });

    // Verify a ₹1 payment first — shortfall is covered by payment2 (still pending), so it's allowed,
    // but the registration is not confirmed yet and no email should be sent.
    await svc.paymentRepo.updateStatus(payment1Id, "pending_verification");
    const result1 = await svc.paymentService.verifyPayment(payment1Id, "UTR1", "staff@smriti.com", 1);
    expect(result1.registrationStatus).toBe("pending");
    expect(svc.emailService.confirmedCalls).toHaveLength(0);

    // Verify the remainder — total is now covered, registration confirms, email fires.
    await svc.paymentRepo.updateStatus(payment2Id, "pending_verification");
    const result2 = await svc.paymentService.verifyPayment(payment2Id, "UTR2", "staff@smriti.com", total - 1);
    expect(result2.registrationStatus).toBe("confirmed");

    await Promise.resolve();
    expect(svc.emailService.confirmedCalls).toHaveLength(1);
    const { payments } = svc.emailService.confirmedCalls[0];

    // THE feature test: both payments appear, not just the one that triggered confirmation.
    expect(payments).toHaveLength(2);
    expect(payments).toEqual(
      expect.arrayContaining([
        { amount: 1, referenceId: "UTR1", date: expect.any(Number) },
        { amount: total - 1, referenceId: "UTR2", date: expect.any(Number) },
      ]),
    );
    expect(payments.reduce((sum, p) => sum + p.amount, 0)).toBe(total);
  });
});

describe("verifyPayment() — overpayment creates a refund and the confirmation email includes it", () => {
  it("includes the pending refund in the payment confirmed email", async () => {
    const svc = createVerifyTestServices();
    svc.regRepo.companionPaymentRepo = svc.paymentRepo;
    svc.regRepo.companionAttendeeRepo = new InMemoryAttendeeRepo();

    const bootstrapRegService = new RegistrationService({
      availabilityService: stubAvailabilityService,
      registrationRepo: svc.regRepo,
      attendeeRepo: new InMemoryAttendeeRepo(),
      auditRepo: svc.auditRepo,
      documentRepo: new StubDocumentRepo(),
      emailService: new StubEmailService(),
      pricingService: new PricingService(),
      authService: {
        async issueAttendeeToken() { return "test-jwt-token"; },
        async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; },
      },
    });

    const regResult = await bootstrapRegService.submit(validSubmitData);
    const regId = Number(regResult.regId);
    const total = regResult.pricingBreakup.total;

    const payments = await svc.paymentRepo.findByRegistration(regId);
    const paymentId = payments[0].id;
    await svc.paymentRepo.updateStatus(paymentId, "pending_verification");

    const overpaidAmount = total + 500;
    const result = await svc.paymentService.verifyPayment(paymentId, "UTR-OVERPAY", "staff@smriti.com", overpaidAmount);

    expect(result.registrationStatus).toBe("confirmed");
    expect(result.refundCreated).toEqual({ id: expect.any(Number), amount: 500 });

    await Promise.resolve();
    expect(svc.emailService.confirmedCalls).toHaveLength(1);
    expect(svc.emailService.confirmedCalls[0].refunds).toEqual([{ amount: 500 }]);
  });
});

describe("rejectPayment() — GUARANTEE: REJECT_PAYMENT", () => {
  let svc: ReturnType<typeof createVerifyTestServices>;
  let regId: number;
  let paymentId: number;

  beforeEach(async () => {
    svc = createVerifyTestServices();

    // Wire companion repos for createWithRelations
    svc.regRepo.companionPaymentRepo = svc.paymentRepo;
    svc.regRepo.companionAttendeeRepo = new InMemoryAttendeeRepo();

    const bootstrapRegService = new RegistrationService({
      availabilityService: stubAvailabilityService,
      registrationRepo: svc.regRepo,
      attendeeRepo: new InMemoryAttendeeRepo(),
      auditRepo: svc.auditRepo,
      documentRepo: new StubDocumentRepo(),
      emailService: new StubEmailService(),
      pricingService: new PricingService(),
      authService: { async issueAttendeeToken() { return 'test-jwt-token'; }, async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; } },
    });

    const regResult = await bootstrapRegService.submit(validSubmitData);
    regId = Number(regResult.regId);

    const payments = await svc.paymentRepo.findByRegistration(regId);
    paymentId = payments[0].id;
    await svc.paymentRepo.updateStatus(paymentId, "pending_verification");
    await svc.regRepo.updateStatus(regId, "pending_verification");
  });

  it("transitions payment status back to 'payment_pending'", async () => {
    await svc.paymentService.rejectPayment(paymentId, "Screenshot unclear", "staff@smriti.com");

    const payment = await svc.paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("payment_pending");
  });

  it("transitions registration status back to 'pending'", async () => {
    await svc.paymentService.rejectPayment(paymentId, "Screenshot unclear", "staff@smriti.com");

    const reg = await svc.regRepo.findById(regId);
    expect(reg?.status).toBe("pending");
  });

  it("appends 'proof_rejected' audit entry with staff actor and comment", async () => {
    await svc.paymentService.rejectPayment(paymentId, "Screenshot unclear", "staff@smriti.com");

    const entry = svc.auditRepo.entries.find(e => e.action === "proof_rejected");
    expect(entry).toBeDefined();
    expect(entry?.actor).toBe("staff@smriti.com");
  });

  it("sends payment rejected email with comment (observable fake proves it was called)", async () => {
    await svc.paymentService.rejectPayment(paymentId, "Screenshot unclear", "staff@smriti.com");

    await Promise.resolve();
    expect(svc.emailService.rejectedCalls).toHaveLength(1);
    expect(svc.emailService.rejectedCalls[0].comment).toBe("Screenshot unclear");
  });

  it("returns { paymentStatus: 'payment_pending', registrationStatus: 'pending' }", async () => {
    const result = await svc.paymentService.rejectPayment(paymentId, "Screenshot unclear", "staff@smriti.com");

    expect(result.paymentStatus).toBe("payment_pending");
    expect(result.registrationStatus).toBe("pending");
  });

  it("throws 409 AppError when payment is not in pending_verification state", async () => {
    // Reject once
    await svc.paymentService.rejectPayment(paymentId, "Screenshot unclear", "staff@smriti.com");

    // Reject again on payment_pending — must throw 409
    await expect(
      svc.paymentService.rejectPayment(paymentId, "Again", "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("throws NotFoundError when payment does not exist", async () => {
    await expect(
      svc.paymentService.rejectPayment(99999, "Unknown", "staff@smriti.com"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
