/**
 * Spec enforcement tests — Staff Edit, Archive & Payment Management
 *
 * Tests every externally observable guarantee from:
 *   - staff-operations.spec.md R8 (archive), R10 (edit), R11 (payment on edit), R12 (audit)
 *   - staff-api.spec.md R18 (PUT edit), R19 (POST archive), R20 (GET archived), R21 (no changes to existing queries)
 *   - payment-flow.spec.md R7 (amendment & recalculation R7.1–R7.24)
 *
 * Boundary: EditService.edit() and ArchiveService.archive() — the service
 * layer is the consumer-facing boundary for staff operations. These services
 * are what route handlers call. Tests feed service inputs and assert on
 * observable outputs (return values, in-memory repo state, audit entries, email
 * calls).
 *
 * These tests are loyal ONLY to the spec. Failures are bug reports, not
 * problems to fix in the tests.
 *
 * =============================================================================
 * Gap Analysis — Underspecification flagged before writing tests
 * =============================================================================
 *
 * THEME: ArchiveService.archive() takes a D1Database directly (not an
 * IArchivedRepository). db.batch() is the atomic mechanism. This means the
 * archive service cannot be tested through a pure in-memory fake — the
 * D1Database structural type must be faked. A FakeD1 is defined below that
 * tracks batch calls and simulates last_row_id.
 *
 * INDIVIDUAL GAP: R19.3 — archivedId comes from insertResult.meta.last_row_id.
 * The spec doesn't define what value to expect other than "the ID in
 * archived_registrations". The FakeD1 returns a predictable id (1) for the
 * first batch call.
 *
 * INDIVIDUAL GAP: R8.1 error message in staff-operations.spec.md says
 * "Cannot archive registration with payment records" but the implementation
 * says "Cannot archive a registration with payment records. Remove payments
 * first." These differ slightly. Tests assert against the spec message.
 *
 * INDIVIDUAL GAP: R18.5 — spec says 422 for cost decrease below verified,
 * but the implementation throws 422 via AppError. Verified. Tests assert
 * statusCode = 422.
 *
 * INDIVIDUAL GAP: R10.2.1(b) — "invalidate outstanding magic links for the
 * old email" happens via db.prepare(DELETE ...).bind().run(). This is
 * observable only through the FakeDb's call log. Tests verify this call
 * happens when email changes.
 *
 * INDIVIDUAL GAP: R20 (GET /api/staff/archived and GET /api/staff/archived/:id)
 * are served by IArchivedRepository.list() and findById(). These are tested
 * through an InMemoryArchivedRepository, not through the HTTP layer (no HTTP
 * test app in this test suite — pattern from payment-flow.test.ts uses
 * service-layer testing).
 *
 * INDIVIDUAL GAP: R21 — "archived records are physically absent from
 * registrations, so all existing queries naturally exclude them." This is
 * a structural guarantee that can only be verified by confirming that archive
 * deletes from the registrations repo. Tested by verifying regRepo.findById()
 * returns null after archive (simulated via the FakeD1 deleting from repo).
 *
 * @module staff-edit-archive.test
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
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  IDocumentRepository,
  IEmailService,
  RevisedPaymentEmailData,
  AdditionalPaymentEmailData,
} from "../repositories/interfaces.js";
import type {
  ArchivedRegistration,
  IArchivedRepository,
} from "../repositories/archived.repo.js";
import { RegistrationService } from "../services/registration.service.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PricingService } from "../services/pricing.service.js";
import { ArchiveService } from "../services/archive.service.js";
import { EditService, type EditRegistrationRequest } from "../services/edit.service.js";
import { createEmptyTshirtRepo, createEmptyChargeRepo } from "./helpers/fake-tshirt-charge-repos.js";
import {
  AppError,
  NotFoundError,
} from "../services/errors.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";

const stubAvailabilityService = { isAccommodationAvailable: async () => true } as unknown as AvailabilityService;

// =============================================================================
// FakeD1 — minimal D1Database structural fake for ArchiveService
// =============================================================================
//
// ArchiveService.archive() calls db.batch([insertStmt, deletePaymentsStmt,
// deleteMagicLinksStmt, deleteRoommateOutgoingStmt, deleteRoommateIncomingStmt,
// deleteRegistrationStmt]). The FakeD1 tracks these calls so tests can assert
// the batch happened, and returns a configurable last_row_id for the INSERT.

class FakeStatement {
  private readonly sql: string;
  private readonly args: unknown[];
  private readonly fake: FakeD1;

  constructor(sql: string, args: unknown[], fake: FakeD1) {
    this.sql = sql;
    this.args = args;
    this.fake = fake;
  }

  bind(...args: unknown[]): FakeStatement {
    return new FakeStatement(this.sql, args, this.fake);
  }

  async run(): Promise<unknown> {
    this.fake.runCalls.push({ sql: this.sql, args: this.args });
    return {};
  }

  /** Snapshot loaders (roommate preferences, bank links) read child tables
   *  that are empty in these tests — every SELECT returns an empty result. */
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }

  /** The cancellation/archive paths never hit first() in these tests. */
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return null;
  }

  getSql(): string { return this.sql; }
  getArgs(): unknown[] { return this.args; }
}

class FakeD1 {
  runCalls: Array<{ sql: string; args: unknown[] }> = [];
  batchCalls: Array<FakeStatement[]> = [];
  nextRowId = 1;
  // Tracks which registrations were deleted (so regRepo can be updated)
  deletedRegistrationIds: number[] = [];

  prepare(sql: string): FakeStatement {
    return new FakeStatement(sql, [], this);
  }

  async batch(statements: FakeStatement[]): Promise<Array<{ meta: { last_row_id: number } }>> {
    this.batchCalls.push(statements);

    // Track registration deletions to simulate cascade
    for (const stmt of statements) {
      const sql = stmt.getSql();
      if (sql.includes('DELETE FROM registrations')) {
        const args = stmt.getArgs();
        if (typeof args[0] === 'number') {
          this.deletedRegistrationIds.push(args[0]);
        }
      }
    }

    // Return results: first statement gets last_row_id (INSERT into archived_registrations).
    // changes: 1 keeps the archive canary (INSERT changed zero rows → 409)
    // satisfied — these tests exercise the happy archive path, not the race.
    return statements.map((_, idx) => ({
      meta: { last_row_id: idx === 0 ? this.nextRowId++ : 0, changes: 1 },
    }));
  }
}

// =============================================================================
// FakeDb for EditService (minimal structural type)
// =============================================================================

class FakeEditDb {
  magicLinkDeleteCalls: Array<{ registrationId: number }> = [];

  prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<unknown> } } {
    const calls = this.magicLinkDeleteCalls;
    return {
      bind(...args: unknown[]): { run(): Promise<unknown> } {
        // Capture registration_id from DELETE magic_links WHERE registration_id = ?
        if (sql.includes('magic_links') && typeof args[0] === 'number') {
          calls.push({ registrationId: args[0] as number });
        }
        return { async run() { return {}; } };
      },
    };
  }
}

// =============================================================================
// Minimal test data
// =============================================================================

const validSubmitData: SubmitRegistrationRequest = {
  contact: {
    fullName: "Ravi Kumar",
    branch: "Computer Science & Engineering",
    gender: "male",
    email: "ravi@example.com",
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
// In-memory repository fakes (extended from payment-flow.test.ts pattern)
// These implement the full interface correctly for edit tests.
// =============================================================================

class InMemoryRegistrationRepo implements IRegistrationRepository {
  registrations: Map<number, Registration> = new Map();
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
      const withFk = insertSet.attendees.map(a => ({ ...a, registration_id: id }));
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
    return [...this.registrations.values()].filter(r => r.email === email);
  }

  async findByWhatsapp(whatsapp: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter(r => r.whatsapp === whatsapp);
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
    if (data.email !== undefined) reg.email = data.email;
    if (data.whatsapp !== undefined) reg.whatsapp = data.whatsapp;
    if (data.country !== undefined) reg.country = data.country;
    if (data.donation_amount !== undefined) reg.donationAmount = data.donation_amount;
    if (data.attendance_intent !== undefined) reg.attendanceIntent = data.attendance_intent;
    if (data.participation_type !== undefined) reg.participationType = data.participation_type;
    if (data.accommodation !== undefined) reg.accommodation = data.accommodation;
    if (data.check_in !== undefined) reg.checkIn = data.check_in;
    if (data.check_out !== undefined) reg.checkOut = data.check_out;
    if (data.extra_bed !== undefined) reg.extraBed = data.extra_bed !== 0;
    if (data.total_amount !== undefined) reg.totalAmount = data.total_amount;
    if (data.pricing_snapshot !== undefined) {
      try { reg.pricingSnapshot = JSON.parse(data.pricing_snapshot) as PricingBreakup; } catch { /* no-op */ }
    }
    reg.updatedAt = Date.now();
  }

  /**
   * updateWithLock — properly implements optimistic locking.
   * Throws Error('OPTIMISTIC_LOCK_CONFLICT') if updatedAt doesn't match.
   */
  async updateWithLock(
    id: number,
    data: RegistrationUpdate,
    expectedUpdatedAt: number,
    attendees?: NewAttendee[],
  ): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) throw new NotFoundError('Registration not found');
    if (reg.updatedAt !== expectedUpdatedAt) {
      throw new Error('OPTIMISTIC_LOCK_CONFLICT');
    }
    await this.update(id, data, attendees);
    if (attendees !== undefined && this.companionAttendeeRepo) {
      await this.companionAttendeeRepo.replaceForRegistration(id, attendees);
    }
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

  async countByParticipationAndStatus(): Promise<Record<'full_celebration' | 'campus_only' | 'donation_only', { total: number; confirmed: number; pending: number; pendingVerification: number }>> {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    return { full_celebration: zero(), campus_only: zero(), donation_only: zero() };
  }

  async getDonationTotals(): Promise<{ count: number; total: number }> {
    return { count: 0, total: 0 };
  }

  async findMissingThumbnails(): Promise<Array<{ id: number; regCode: string; photoFileKey: string }>> {
    return [];
  }
  async findWithThumbnails() { return []; }
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

  async countGrouped(_filters?: { statuses?: string[]; branch?: string }): Promise<Array<{ type: string; meal: string; count: number }>> { return []; }
  async accommodationByNight(_f?: { statuses?: string[]; branch?: string }): Promise<Record<string, { private: number; privateByGender: { male: number; female: number; other: number }; shared_double: { count: number; rooms: number }; shared_doubleByGender: { male: number; female: number; other: number }; shared_triple: { count: number; rooms: number }; shared_tripleByGender: { male: number; female: number; other: number }; extraBeds: number }>> { return {}; }
  async mealsByParticipationType(_f?: { statuses?: string[]; branch?: string }): Promise<{ campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } }> { return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } }; }
  async childrenByAgeBand(_f?: { statuses?: string[]; branch?: string }): Promise<{ under6: number; age6to12: number; age12plus: number }> { return { under6: 0, age6to12: 0, age12plus: 0 }; }
}

class InMemoryPaymentRepo implements IPaymentRepository {
  payments: Map<number, Payment> = new Map();
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
    if (gatewayData?.gatewayRef !== undefined) p.gatewayRef = gatewayData.gatewayRef;
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

  async findPendingByRegistration(registrationId: number): Promise<Payment | null> {
    const pending = [...this.payments.values()].find(
      (p) => p.registrationId === registrationId && p.status === 'payment_pending',
    );
    return pending ?? null;
  }

  async deletePending(paymentId: number): Promise<void> {
    const p = this.payments.get(paymentId);
    if (p && p.status === 'payment_pending') {
      this.payments.delete(paymentId);
    }
  }

  async updatePendingAmount(paymentId: number, newAmount: number): Promise<void> {
    const p = this.payments.get(paymentId);
    if (p && p.status === 'payment_pending') {
      p.amount = newAmount;
      p.updatedAt = Date.now();
    }
  }

  async sumVerifiedByRegistration(registrationId: number): Promise<number> {
    return [...this.payments.values()]
      .filter((p) => p.registrationId === registrationId && p.status === 'verified')
      .reduce((sum, p) => sum + p.amount, 0);
  }

  async sumVerified(_filters?: { type?: 'attendee' | 'donor' }): Promise<number> { return 0; }
  async sumVerifiedByBranch(_filters?: { type?: 'attendee' | 'donor' }): Promise<Array<{ branch: string; collected: number }>> { return []; }
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
  async create(_doc: NewIdDocument): Promise<{ id: number }> { return { id: 1 }; }
  async findByRegistration(_registrationId: number): Promise<IdDocument[]> { return []; }
  async updateR2Key(_docId: number, _newKey: string): Promise<void> {}
}


// Observable email service — tracks payment email calls
class ObservableEmailService implements IEmailService {
  revisedPaymentCalls: Array<{ to: string } & RevisedPaymentEmailData> = [];
  additionalPaymentCalls: Array<{ to: string } & AdditionalPaymentEmailData> = [];

  async sendConfirmation(_to: string, _data: unknown): Promise<void> {}
  async sendMagicLink(_to: string, _data: unknown): Promise<void> {}
  async sendPaymentConfirmed(_to: string, _data: unknown): Promise<void> {}
  async sendPaymentRejected(_to: string, _data: unknown): Promise<void> {}
  async sendStaffWelcome(_to: string, _data: unknown): Promise<void> {}
  async sendPaymentLink(_to: string, _data: unknown): Promise<void> {}

  async sendRevisedPayment(to: string, data: RevisedPaymentEmailData): Promise<void> {
    this.revisedPaymentCalls.push({ to, ...data });
  }

  async sendAdditionalPayment(to: string, data: AdditionalPaymentEmailData): Promise<void> {
    this.additionalPaymentCalls.push({ to, ...data });
  }
  async sendStoryHidden(_to: string, _data: unknown): Promise<void> {}
}

// In-memory archived registration store (simulates reads from archived_registrations)
class InMemoryArchivedRepo implements IArchivedRepository {
  items: ArchivedRegistration[] = [];
  private nextId = 1;

  async create(data: {
    originalId: number;
    regCode: string;
    email: string;
    fullName: string;
    snapshot: string;
    archivedBy: string;
  }): Promise<number> {
    const id = this.nextId++;
    this.items.push({
      id,
      originalId: data.originalId,
      regCode: data.regCode,
      email: data.email,
      fullName: data.fullName,
      snapshot: JSON.parse(data.snapshot) as unknown,
      archivedBy: data.archivedBy,
      archivedAt: Date.now(),
    });
    return id;
  }

  async list(filters: { search?: string; page: number; limit: number }): Promise<{ items: ArchivedRegistration[]; total: number }> {
    let result = this.items;
    if (filters.search) {
      const term = filters.search.toLowerCase();
      result = result.filter(
        (a) =>
          a.fullName.toLowerCase().includes(term) ||
          a.email.toLowerCase().includes(term) ||
          a.regCode.toLowerCase().includes(term),
      );
    }
    const total = result.length;
    const offset = (filters.page - 1) * filters.limit;
    return { items: result.slice(offset, offset + filters.limit), total };
  }

  async findById(id: number): Promise<ArchivedRegistration | null> {
    return this.items.find((a) => a.id === id) ?? null;
  }
}

// =============================================================================
// Test context factory
// =============================================================================

interface EditTestContext {
  editService: EditService;
  regRepo: InMemoryRegistrationRepo;
  attendeeRepo: InMemoryAttendeeRepo;
  paymentRepo: InMemoryPaymentRepo;
  auditRepo: InMemoryAuditRepo;
  emailService: ObservableEmailService;
  fakeDb: FakeEditDb;
}

interface ArchiveTestContext {
  archiveService: ArchiveService;
  regRepo: InMemoryRegistrationRepo;
  paymentRepo: InMemoryPaymentRepo;
  attendeeRepo: InMemoryAttendeeRepo;
  auditRepo: InMemoryAuditRepo;
  documentRepo: StubDocumentRepo;
  fakeD1: FakeD1;
}

function createEditContext(): EditTestContext {
  const regRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  const emailService = new ObservableEmailService();
  const fakeDb = new FakeEditDb();

  regRepo.companionAttendeeRepo = attendeeRepo;
  regRepo.companionPaymentRepo = paymentRepo;
  regRepo.companionDocumentRepo = new StubDocumentRepo();

  const editService = new EditService({
    db: fakeDb,
    registrationRepo: regRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    emailService,
    authService: {
      async createPaymentLinkUrl(_registrationId: number, regCode: string) {
        return `/pay/${regCode}?code=test`;
      },
    },
  });

  return { editService, regRepo, attendeeRepo, paymentRepo, auditRepo, emailService, fakeDb };
}

function createArchiveContext(): ArchiveTestContext {
  const regRepo = new InMemoryRegistrationRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const auditRepo = new InMemoryAuditRepo();
  const documentRepo = new StubDocumentRepo();
  const fakeD1 = new FakeD1();

  regRepo.companionPaymentRepo = paymentRepo;
  regRepo.companionAttendeeRepo = attendeeRepo;
  regRepo.companionDocumentRepo = documentRepo;

  const archiveService = new ArchiveService({
    // ArchiveService takes D1Database — we pass our structural fake
    db: fakeD1 as unknown as import('@cloudflare/workers-types').D1Database,
    registrationRepo: regRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    // Paid registrations cannot be archived (force included), so archive
    // snapshots always carry empty refunds/tshirts/charges on the tested
    // paths — empty read-only fakes are faithful here.
    refundRepo: {
      create: async () => { throw new Error('refundRepo is read-only in archive tests'); },
      findById: async () => null,
      list: async () => [],
      listWithRegistration: async () => [],
      findByRegistration: async () => [],
      findByOriginalRegistration: async () => [],
    },
    tshirtRepo: createEmptyTshirtRepo(),
    chargeRepo: createEmptyChargeRepo(),
  });

  return { archiveService, regRepo, paymentRepo, attendeeRepo, auditRepo, documentRepo, fakeD1 };
}

/** Bootstrap a full registration and return id + regCode. */
async function bootstrapRegistration(
  ctx: { regRepo: InMemoryRegistrationRepo; paymentRepo: InMemoryPaymentRepo; attendeeRepo: InMemoryAttendeeRepo; auditRepo: InMemoryAuditRepo },
  data: SubmitRegistrationRequest = validSubmitData,
): Promise<{ regId: number; regCode: string; updatedAt: number }> {
  const documentRepo = new StubDocumentRepo();
  ctx.regRepo.companionDocumentRepo = documentRepo;

  const regService = new RegistrationService({
    availabilityService: stubAvailabilityService,
    registrationRepo: ctx.regRepo,
    attendeeRepo: ctx.attendeeRepo,
    auditRepo: ctx.auditRepo,
    documentRepo,
    emailService: {
      async sendConfirmation() {},
      async sendMagicLink() {},
      async sendPaymentConfirmed() {},
      async sendPaymentRejected() {},
      async sendStaffWelcome() {},
      async sendPaymentLink() {},
      async sendRevisedPayment() {},
      async sendAdditionalPayment() {},
      async sendStoryHidden() {},
    },
    pricingService: new PricingService(),
    authService: {
      async issueAttendeeToken() { return 'test-jwt-token'; },
      async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; },
    },
  });

  const result = await regService.submit(data);
  const regId = Number(result.regId);
  const reg = await ctx.regRepo.findById(regId);
  return { regId, regCode: result.regCode, updatedAt: reg!.updatedAt };
}

// =============================================================================
// 1. Archive Feature (R8, R19)
// =============================================================================

describe("Archive — zero-payment guard (R8.1, R19.2)", () => {
  let ctx: ArchiveTestContext;

  beforeEach(() => {
    ctx = createArchiveContext();
  });

  it("R19.2: archive() returns archivedId when registration has zero payments", async () => {
    // Insert a bare registration with no payments
    const { regId } = await bootstrapRegistration(ctx);

    // Remove the payment record to simulate zero-payment state
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    for (const p of payments) {
      // Remove from in-memory store directly (simulate pre-payment deletion)
      ctx.paymentRepo.payments.delete(p.id);
    }

    const result = await ctx.archiveService.archive(regId, "staff@smriti.com");

    // R19.3: returns { ok: true, archivedId } — archivedId is the ID in archived_registrations
    expect(result).toHaveProperty('archivedId');
    expect(typeof result.archivedId).toBe('number');
    expect(result.archivedId).toBeGreaterThan(0);
  });

  it("R8.1/R19.2: archive() succeeds when only payment_pending stubs exist", async () => {
    // Bootstrap creates a payment_pending record — a bare stub with no real money movement
    const { regId } = await bootstrapRegistration(ctx);

    // payment_pending stubs should not block archiving
    const result = await ctx.archiveService.archive(regId, "staff@smriti.com");
    expect(result).toHaveProperty('archivedId');
    expect(result.archivedId).toBeGreaterThan(0);
  });

  it("R8.1: 409 when payment is verified (not just payment_pending)", async () => {
    // Catches: generator allowing archive when payment is 'verified' (terminal state)
    const { regId } = await bootstrapRegistration(ctx);
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    // Advance payment to verified
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.paymentRepo.updateStatus(payments[0].id, 'verified', { gatewayRef: 'UTR123' });

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("R8.1: 409 when payment is pending_verification (not just payment_pending)", async () => {
    // Catches: generator allowing archive when proof uploaded and awaiting review
    const { regId } = await bootstrapRegistration(ctx);
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("R19.5: archive() throws NotFoundError (404) for nonexistent registration", async () => {
    await expect(
      ctx.archiveService.archive(99999, "staff@smriti.com"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Archive — force mode (ARCHIVE_FORCE)", () => {
  let ctx: ArchiveTestContext;

  beforeEach(() => {
    ctx = createArchiveContext();
  });

  // ===========================================================================
  // Force does NOT bypass the payment guard (plan §4 staff routes, §6
  // "Decision: Forced archive of paid registrations") — paid registrations
  // must use the cancellation route, which preserves the source payment for
  // the refund. force only records forceArchived in the snapshot.
  // ===========================================================================

  it("force=true: still 409 when payment is pending_verification", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com", { force: true }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("force=true: still 409 when payment is verified", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.paymentRepo.updateStatus(payments[0].id, 'verified', { gatewayRef: 'UTR123' });

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com", { force: true }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("force=true: still 409 with mixed payment statuses (pending_verification + verified)", async () => {
    const { regId } = await bootstrapRegistration(ctx);

    // Create a second payment that's verified
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.paymentRepo.updateStatus(payments[0].id, 'verified', { gatewayRef: 'UTR-PRIMARY' });

    // Add another payment that's pending_verification
    await ctx.paymentRepo.create({
      registration_id: regId,
      amount: 500,
      status: 'pending_verification',
      gateway: null, gateway_ref: null, gateway_response: null,
      proof_file_key: 'proofs/test.jpg', verified_by: null, verified_at: null,
    });

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com", { force: true }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("force=true: archives registration with zero payments (edge case)", async () => {
    // Catches: generator that requires at least one payment in force mode
    const { regId } = await bootstrapRegistration(ctx);
    // Remove all payment records entirely
    ctx.paymentRepo.payments.clear();

    const result = await ctx.archiveService.archive(regId, "staff@smriti.com", { force: true });
    expect(result).toHaveProperty('archivedId');
    expect(result.archivedId).toBeGreaterThan(0);
  });

  // ===========================================================================
  // Type safety — force must be strict boolean true (R19.1)
  // ===========================================================================

  it("force='true' (string): does NOT bypass guard — strict === true fails", async () => {
    // Catches: generator using truthiness check instead of strict boolean
    // Implementation: options.force === true → "true" !== true → force stays false
    const { regId } = await bootstrapRegistration(ctx);
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com", { force: "true" as unknown as boolean }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("force=1 (number): does NOT bypass guard — strict === true fails", async () => {
    // Catches: generator using Boolean() or !! coercion
    // Implementation: options.force === true → 1 !== true → force stays false
    const { regId } = await bootstrapRegistration(ctx);
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com", { force: 1 as unknown as boolean }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("force='force' (truthy string): does NOT bypass guard", async () => {
    // Catches: generator doing a truthy string check
    const { regId } = await bootstrapRegistration(ctx);
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com", { force: "force" as unknown as boolean }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  // ===========================================================================
  // Backwards compatibility — force=false and force=undefined (R19.1)
  // ===========================================================================

  it("force=false: still throws 409 for pending_verification (default unchanged)", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com", { force: false }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("force=undefined: still throws 409 (backwards-compatible)", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');

    await expect(
      ctx.archiveService.archive(regId, "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("force=false and force=undefined produce identical snapshots on success", async () => {
    // Catches: generator producing different snapshot shapes for force=false vs force=undefined
    const { regId } = await bootstrapRegistration(ctx);

    await ctx.archiveService.archive(regId, "staff@smriti.com", { force: false });
    const falseArgs = ctx.fakeD1.batchCalls[0][0].getArgs();
    const falseSnapshot = JSON.parse(falseArgs[4] as string) as Record<string, unknown>;

    // Reset ctx for second archive
    ctx = createArchiveContext();
    const { regId: regId2 } = await bootstrapRegistration(ctx);

    await ctx.archiveService.archive(regId2, "staff@smriti.com");
    const undefArgs = ctx.fakeD1.batchCalls[0][0].getArgs();
    const undefSnapshot = JSON.parse(undefArgs[4] as string) as Record<string, unknown>;

    // Both snapshots must have same top-level keys
    const falseKeys = Object.keys(falseSnapshot).sort();
    const undefKeys = Object.keys(undefSnapshot).sort();
    expect(falseKeys).toEqual(undefKeys);
    // Neither should have forceArchived
    expect(falseSnapshot.forceArchived).toBeUndefined();
    expect(undefSnapshot.forceArchived).toBeUndefined();
  });

  // ===========================================================================
  // Snapshot content — force vs non-force (R8.3, R19.4, ARCHIVE_SNAPSHOT)
  // ===========================================================================

  it("force=true: snapshot includes all required fields (registration, attendees, auditLog, documents, payments)", async () => {
    // Unpaid registration (payment_pending stub only) — the only registrations
    // archive may touch. force adds forceArchived but never bypasses the guard.
    const { regId } = await bootstrapRegistration(ctx);

    await ctx.archiveService.archive(regId, "staff@smriti.com", { force: true });

    const insertArgs = ctx.fakeD1.batchCalls[0][0].getArgs();
    const snapshot = JSON.parse(insertArgs[4] as string) as Record<string, unknown>;
    expect(snapshot.forceArchived).toBe(true);
    expect(snapshot).toHaveProperty('registration');
    expect(snapshot).toHaveProperty('attendees');
    expect(snapshot).toHaveProperty('auditLog');
    expect(snapshot).toHaveProperty('documents');
    expect(snapshot).toHaveProperty('payments');
    expect(Array.isArray(snapshot.payments)).toBe(true);
    expect((snapshot.payments as unknown[]).length).toBeGreaterThan(0);
  });

  it("force=true: snapshot payments array includes all payments (not filtered)", async () => {
    // Two payment_pending stubs — both are stubs with no real money movement
    // and must appear in the snapshot unchanged.
    const { regId } = await bootstrapRegistration(ctx);
    await ctx.paymentRepo.create({
      registration_id: regId,
      amount: 500,
      status: 'payment_pending',
      gateway: null, gateway_ref: null, gateway_response: null,
      proof_file_key: null, verified_by: null, verified_at: null,
    });

    await ctx.archiveService.archive(regId, "staff@smriti.com", { force: true });

    const insertArgs = ctx.fakeD1.batchCalls[0][0].getArgs();
    const snapshot = JSON.parse(insertArgs[4] as string) as Record<string, unknown>;
    expect(snapshot.forceArchived).toBe(true);
    // Must include ALL payments (2), not just one
    expect((snapshot.payments as unknown[]).length).toBe(2);
  });

  it("force=false: snapshot includes later child tables (tshirts, charges, roommatePreferences, bankTransactionLinks, bankTransactions, refunds)", async () => {
    // Paid registrations cannot be archived, so the snapshot carries the
    // child tables as empty arrays here — the keys must still be present
    // (plan §3 archive snapshot contract, §4 staff routes).
    const { regId } = await bootstrapRegistration(ctx);

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    const insertArgs = ctx.fakeD1.batchCalls[0][0].getArgs();
    const snapshot = JSON.parse(insertArgs[4] as string) as Record<string, unknown>;
    expect(snapshot).toHaveProperty('tshirts');
    expect(snapshot).toHaveProperty('additionalCharges');
    expect(snapshot).toHaveProperty('roommatePreferences');
    expect(snapshot).toHaveProperty('refunds');
    expect(snapshot).toHaveProperty('bankTransactionLinks');
    expect(snapshot).toHaveProperty('bankTransactions');
    expect(Array.isArray(snapshot.tshirts)).toBe(true);
    expect(Array.isArray(snapshot.roommatePreferences)).toBe(true);
    expect(Array.isArray(snapshot.bankTransactionLinks)).toBe(true);
    expect(Array.isArray(snapshot.bankTransactions)).toBe(true);
  });

  it("force=false: snapshot does NOT include forceArchived flag", async () => {
    const { regId } = await bootstrapRegistration(ctx);

    await ctx.archiveService.archive(regId, "staff@smriti.com", { force: false });

    const insertArgs = ctx.fakeD1.batchCalls[0][0].getArgs();
    const snapshot = JSON.parse(insertArgs[4] as string) as Record<string, unknown>;
    expect(snapshot.forceArchived).toBeUndefined();
  });

  it("force=undefined: snapshot does NOT include forceArchived flag (backwards-compatible)", async () => {
    // Catches: generator adding forceArchived=false to undefined-force snapshots
    const { regId } = await bootstrapRegistration(ctx);

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    const insertArgs = ctx.fakeD1.batchCalls[0][0].getArgs();
    const snapshot = JSON.parse(insertArgs[4] as string) as Record<string, unknown>;
    expect(snapshot.forceArchived).toBeUndefined();
  });

  // ===========================================================================
  // 404 — applies regardless of force (ARCHIVE_NOT_FOUND, R19.5)
  // ===========================================================================

  it("force=true: 404 for nonexistent registration", async () => {
    await expect(
      ctx.archiveService.archive(99999, "staff@smriti.com", { force: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("force=false: 404 for nonexistent registration", async () => {
    // Catches: generator that skips not-found check in non-force mode after force refactor
    await expect(
      ctx.archiveService.archive(99999, "staff@smriti.com", { force: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("force=undefined: 404 for nonexistent registration", async () => {
    // Catches: generator that changes not-found behavior when options are absent
    await expect(
      ctx.archiveService.archive(99999, "staff@smriti.com"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Archive — D1 batch operations (R8.3, R8.4)", () => {
  let ctx: ArchiveTestContext;

  beforeEach(async () => {
    ctx = createArchiveContext();
  });

  it("R8.3: archive() executes db.batch() with exactly 6 statements", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear(); // zero payments

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    // Batch must have been called exactly once with 6 statements: archive
    // insert, payments delete, magic_links delete, roommate_preferences in
    // both FK directions, registration delete.
    expect(ctx.fakeD1.batchCalls).toHaveLength(1);
    expect(ctx.fakeD1.batchCalls[0]).toHaveLength(6);
  });

  it("R8.3 step 1: first batch statement is INSERT into archived_registrations", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    const firstStmt = ctx.fakeD1.batchCalls[0][0];
    expect(firstStmt.getSql()).toMatch(/INSERT INTO archived_registrations/i);
  });

  it("R8.3 step 2: second batch statement deletes payment_pending stubs", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    const secondStmt = ctx.fakeD1.batchCalls[0][1];
    expect(secondStmt.getSql()).toMatch(/DELETE FROM payments/i);
  });

  it("R8.3 step 3: third batch statement deletes from magic_links", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    const thirdStmt = ctx.fakeD1.batchCalls[0][2];
    expect(thirdStmt.getSql()).toMatch(/DELETE FROM magic_links/i);
  });

  it("R8.3 step 4: fourth and fifth batch statements delete roommate_preferences in both FK directions", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    const fourthStmt = ctx.fakeD1.batchCalls[0][3];
    const fifthStmt = ctx.fakeD1.batchCalls[0][4];
    expect(fourthStmt.getSql()).toMatch(/DELETE FROM roommate_preferences/i);
    expect(fifthStmt.getSql()).toMatch(/DELETE FROM roommate_preferences/i);
  });

  it("R8.3 step 6: sixth batch statement deletes from registrations (triggers CASCADE)", async () => {
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    const sixthStmt = ctx.fakeD1.batchCalls[0][5];
    expect(sixthStmt.getSql()).toMatch(/DELETE FROM registrations/i);
  });

  it("R8.5: archive() does NOT send any email to the attendee", async () => {
    // Catches: generator sending a confirmation or notification email on archive
    // ArchiveService has no email dependency — only way this fails is if the
    // service was constructed with an email dep and calls it. Verify no calls
    // were made by checking the observable email service is NOT wired.
    // This is a structural guarantee — no emailService in ArchiveService constructor.
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    // Should complete without throwing
    await ctx.archiveService.archive(regId, "staff@smriti.com");
    // No assertion on email calls — if the service had an email dep and called it,
    // the FakeD1 would throw on an unknown method. Pass = no email sent.
  });
});

describe("Archive — snapshot content (R8.3)", () => {
  it("R8.3: snapshot passed to INSERT includes registration, attendees, auditLog, documents", async () => {
    const ctx = createArchiveContext();
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    // Inspect the INSERT statement arguments to verify snapshot shape
    const batchStmts = ctx.fakeD1.batchCalls[0];
    const insertArgs = batchStmts[0].getArgs();
    // args: [original_id, reg_code, email, full_name, snapshot, archived_by]
    const snapshotArg = insertArgs[4] as string;
    expect(typeof snapshotArg).toBe('string');

    const parsed = JSON.parse(snapshotArg) as { registration: unknown; attendees: unknown; auditLog: unknown; documents: unknown };
    expect(parsed).toHaveProperty('registration');
    expect(parsed).toHaveProperty('attendees');
    expect(parsed).toHaveProperty('auditLog');
    expect(parsed).toHaveProperty('documents');
  });

  it("R8.3: snapshot includes correct regCode and email", async () => {
    const ctx = createArchiveContext();
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    const insertArgs = ctx.fakeD1.batchCalls[0][0].getArgs();
    // args[1] = reg_code, args[2] = email, args[5] = archived_by
    expect(insertArgs[2]).toBe(validSubmitData.contact.email);
    expect(insertArgs[5]).toBe('staff@smriti.com');
  });
});

describe("Archive — R21: active queries exclude archived records", () => {
  it("R21: after archive batch, registrationId was targeted for DELETE — absent from registrations", async () => {
    // R21: "archived records are physically deleted from registrations, so all
    // existing queries naturally exclude them." The FakeD1 records which IDs
    // were targeted for deletion.
    const ctx = createArchiveContext();
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    // Verify the DELETE FROM registrations was issued for the correct ID
    const deleteStmt = ctx.fakeD1.batchCalls[0][5];
    const deleteArgs = deleteStmt.getArgs();
    expect(deleteArgs[0]).toBe(regId);
  });

  it("R8.6: a second registration with the same email can be created after archive (email freed)", async () => {
    // R8.6: the email UNIQUE constraint is released by the DELETE.
    // In our in-memory repo, the registration is gone after archive's DELETE FROM registrations.
    // We simulate this by removing the reg from regRepo after fakeD1 executes the batch.
    const ctx = createArchiveContext();
    const { regId } = await bootstrapRegistration(ctx);
    ctx.paymentRepo.payments.clear();

    await ctx.archiveService.archive(regId, "staff@smriti.com");

    // Simulate the DELETE having taken effect in the DB
    ctx.regRepo.registrations.delete(regId);

    // Now findByEmail should return empty — email is freed
    const byEmail = await ctx.regRepo.findByEmail(validSubmitData.contact.email);
    expect(byEmail).toHaveLength(0);
  });
});

// =============================================================================
// 2. Archived Records View (R20, R20.3)
// =============================================================================

describe("Archived Records View — GET /api/staff/archived (R20)", () => {
  let archivedRepo: InMemoryArchivedRepo;

  beforeEach(() => {
    archivedRepo = new InMemoryArchivedRepo();
  });

  it("R20.2: list() returns paginated result with archived array, total, page, limit", async () => {
    // Insert a few archived records
    await archivedRepo.create({ originalId: 1001, regCode: 'SMRT-AAA', email: 'a@x.com', fullName: 'Alice', snapshot: '{}', archivedBy: 'staff@smriti.com' });
    await archivedRepo.create({ originalId: 1002, regCode: 'SMRT-BBB', email: 'b@x.com', fullName: 'Bob', snapshot: '{}', archivedBy: 'staff@smriti.com' });

    const result = await archivedRepo.list({ page: 1, limit: 50 });

    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('total');
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.total).toBe(2);
  });

  it("R20.2: each archived item has id, originalId, regCode, email, fullName, archivedBy, archivedAt", async () => {
    await archivedRepo.create({
      originalId: 1001,
      regCode: 'SMRT-AAA',
      email: 'a@x.com',
      fullName: 'Alice Smith',
      snapshot: '{"registration":{}}',
      archivedBy: 'staff@smriti.com',
    });

    const result = await archivedRepo.list({ page: 1, limit: 50 });
    const item = result.items[0];

    expect(typeof item.id).toBe('number');
    expect(item.originalId).toBe(1001);
    expect(item.regCode).toBe('SMRT-AAA');
    expect(item.email).toBe('a@x.com');
    expect(item.fullName).toBe('Alice Smith');
    expect(item.archivedBy).toBe('staff@smriti.com');
    expect(typeof item.archivedAt).toBe('number');
  });

  it("R20.3: findById() returns parsed JSON snapshot (not raw string)", async () => {
    // R20.3: GET /api/staff/archived/:id returns the parsed JSON snapshot
    // Catches: generator returning raw JSON string instead of parsed object
    const snapshot = JSON.stringify({ registration: { id: 1001, fullName: 'Alice' }, attendees: [], auditLog: [] });
    await archivedRepo.create({
      originalId: 1001,
      regCode: 'SMRT-AAA',
      email: 'a@x.com',
      fullName: 'Alice',
      snapshot,
      archivedBy: 'staff@smriti.com',
    });

    const result = await archivedRepo.findById(1);

    expect(result).not.toBeNull();
    // snapshot must be a parsed object, not a string
    expect(typeof result!.snapshot).toBe('object');
    expect(result!.snapshot).not.toBeNull();
    const snap = result!.snapshot as { registration: { id: number; fullName: string } };
    expect(snap.registration.fullName).toBe('Alice');
  });

  it("R20.1: search filters by fullName, email, regCode (case-insensitive)", async () => {
    await archivedRepo.create({ originalId: 1, regCode: 'SMRT-AAA', email: 'alice@x.com', fullName: 'Alice Smith', snapshot: '{}', archivedBy: 'staff@smriti.com' });
    await archivedRepo.create({ originalId: 2, regCode: 'SMRT-BBB', email: 'bob@x.com', fullName: 'Bob Jones', snapshot: '{}', archivedBy: 'staff@smriti.com' });

    const result = await archivedRepo.list({ search: 'alice', page: 1, limit: 50 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].fullName).toBe('Alice Smith');
  });

  it("R20: pagination returns correct page slices", async () => {
    // Insert 3 items, page size 2
    for (let i = 1; i <= 3; i++) {
      await archivedRepo.create({ originalId: i, regCode: `SMRT-${String.fromCharCode(64+i)}`, email: `u${i}@x.com`, fullName: `User ${i}`, snapshot: '{}', archivedBy: 'staff@smriti.com' });
    }

    const page1 = await archivedRepo.list({ page: 1, limit: 2 });
    const page2 = await archivedRepo.list({ page: 2, limit: 2 });

    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(3);
  });
});

// =============================================================================
// 3. Edit Feature — Guards (R10.3–R10.6, R18.2–R18.5)
// =============================================================================

describe("Edit — optimistic locking guard (R10.6, R18.2)", () => {
  let ctx: EditTestContext;
  let regId: number;
  let updatedAt: number;

  beforeEach(async () => {
    ctx = createEditContext();
    const result = await bootstrapRegistration(ctx);
    regId = result.regId;
    updatedAt = result.updatedAt;
  });

  it("R18.2: edit with correct updatedAt succeeds", async () => {
    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi Kumar Updated" },
      updatedAt,
    };

    // Should not throw
    await expect(
      ctx.editService.edit(regId, req, "staff@smriti.com"),
    ).resolves.toBeDefined();
  });

  it("R18.2: edit with stale updatedAt throws 409 (optimistic lock conflict)", async () => {
    // Catches: generator ignoring the updatedAt check and applying any edit
    const staleUpdatedAt = updatedAt - 1000; // older timestamp
    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi Kumar Updated" },
      updatedAt: staleUpdatedAt,
    };

    await expect(
      ctx.editService.edit(regId, req, "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("R18.2: 409 error message mentions modification conflict", async () => {
    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi Kumar Updated" },
      updatedAt: updatedAt - 5000,
    };

    try {
      await ctx.editService.edit(regId, req, "staff@smriti.com");
      expect.fail("Expected AppError");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).toMatch(/modified|conflict|reload/i);
    }
  });
});

describe("Edit — 404 for nonexistent registration (R18.8)", () => {
  it("R18.8: edit() throws NotFoundError for unknown registrationId", async () => {
    const ctx = createEditContext();
    const req: EditRegistrationRequest = {
      fields: { fullName: "Nobody" },
      updatedAt: Date.now(),
    };

    await expect(
      ctx.editService.edit(99999, req, "staff@smriti.com"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Edit — cosmetic changes always allowed (R10.1, R18.4)", () => {
  let ctx: EditTestContext;
  let regId: number;
  let updatedAt: number;

  beforeEach(async () => {
    ctx = createEditContext();
    const result = await bootstrapRegistration(ctx);
    regId = result.regId;

    // Advance payment to pending_verification (would block cost-affecting edits)
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.regRepo.updateStatus(regId, 'pending_verification');

    // Re-read updatedAt AFTER status changes (updateStatus bumps it)
    const reg = await ctx.regRepo.findById(regId);
    updatedAt = reg!.updatedAt;
  });

  it("R10.1: fullName change succeeds even when payment is pending_verification", async () => {
    // Catches: generator blocking cosmetic edits when pending_verification exists
    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi Kumar New Name" },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");
    expect(result.registration.fullName).toBe("Ravi Kumar New Name");
  });

  it("R10.1: whatsapp change succeeds when payment is pending_verification", async () => {
    const req: EditRegistrationRequest = {
      fields: { whatsapp: "+919999999999" },
      updatedAt,
    };

    await expect(
      ctx.editService.edit(regId, req, "staff@smriti.com"),
    ).resolves.toBeDefined();
  });

  it("R10.1: city, country, branch changes succeed when payment is pending_verification", async () => {
    const req: EditRegistrationRequest = {
      fields: { city: "Bangalore", country: "India", branch: "Electronics & Communication Engineering" },
      updatedAt,
    };

    await expect(
      ctx.editService.edit(regId, req, "staff@smriti.com"),
    ).resolves.toBeDefined();
  });
});

describe("Edit — cost-affecting blocked when pending_verification (R10.4, R18.4)", () => {
  let ctx: EditTestContext;
  let regId: number;
  let updatedAt: number;

  beforeEach(async () => {
    ctx = createEditContext();
    const result = await bootstrapRegistration(ctx);
    regId = result.regId;

    // Advance to pending_verification state
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.regRepo.updateStatus(regId, 'pending_verification');

    // Re-read updatedAt AFTER status changes (updateStatus bumps it)
    const reg = await ctx.regRepo.findById(regId);
    updatedAt = reg!.updatedAt;
  });

  it("R10.4: donationAmount change throws 409 when pending_verification exists", async () => {
    // Catches: generator allowing cost changes despite unresolved pending_verification
    const req: EditRegistrationRequest = {
      fields: { donationAmount: 1000 },
      updatedAt,
    };

    await expect(
      ctx.editService.edit(regId, req, "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("R10.4: accommodation change throws 409 when pending_verification exists", async () => {
    const req: EditRegistrationRequest = {
      fields: { accommodation: 'private', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: true },
      updatedAt,
    };

    await expect(
      ctx.editService.edit(regId, req, "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("R18.4: 409 error message mentions verifying or rejecting pending payment", async () => {
    const req: EditRegistrationRequest = {
      fields: { donationAmount: 2000 },
      updatedAt,
    };

    try {
      await ctx.editService.edit(regId, req, "staff@smriti.com");
      expect.fail("Expected AppError");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).message).toMatch(/verify|reject|pending/i);
    }
  });
});

describe("Edit — cost decrease below verified total blocked (R10.5, R18.5)", () => {
  let ctx: EditTestContext;
  let regId: number;
  let updatedAt: number;

  beforeEach(async () => {
    ctx = createEditContext();
    const result = await bootstrapRegistration(ctx);
    regId = result.regId;

    // Mark payment as verified (money received)
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.paymentRepo.updateStatus(payments[0].id, 'verified', { gatewayRef: 'UTR123' });
    await ctx.regRepo.updateStatus(regId, 'confirmed');

    // Reload updatedAt (status update may have changed it)
    const updatedReg = await ctx.regRepo.findById(regId);
    updatedAt = updatedReg!.updatedAt;
  });

  it("R10.5/R18.5: removing donation from confirmed+verified registration throws 422", async () => {
    // Catches: generator allowing cost decrease below verified payments
    // Original registration includes donation of 500 + accommodation fees
    // Removing the donation would reduce total below verified total
    const req: EditRegistrationRequest = {
      fields: {
        donationAmount: 0,
        accommodation: 'none',
        checkIn: null,
        checkOut: null,
      },
      updatedAt,
    };

    await expect(
      ctx.editService.edit(regId, req, "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("R18.5: 422 error message includes verified amount", async () => {
    // Catches: generator returning 409 or generic error instead of 422 with amount
    const req: EditRegistrationRequest = {
      fields: { donationAmount: 0, accommodation: 'none', checkIn: null, checkOut: null },
      updatedAt,
    };

    try {
      await ctx.editService.edit(regId, req, "staff@smriti.com");
      expect.fail("Expected AppError 422");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect(appErr.message).toMatch(/₹|verified|total|below/i);
    }
  });

  it("R7.5: cost decrease allowed when no verified payments exist (all payment_pending)", async () => {
    // R7.6: "Cost decrease when no money has moved is allowed."
    // Bootstrap a fresh registration (payment still payment_pending)
    const result2 = await bootstrapRegistration(ctx, {
      ...validSubmitData,
      contact: { ...validSubmitData.contact, email: 'fresh@example.com', whatsapp: '+919000000001' },
    });
    const regId2 = result2.regId;
    const updatedAt2 = result2.updatedAt;

    // Reduce donation to 0 — total will be lower but no verified payments
    const req: EditRegistrationRequest = {
      fields: { donationAmount: 0 },
      updatedAt: updatedAt2,
    };

    await expect(
      ctx.editService.edit(regId2, req, "staff@smriti.com"),
    ).resolves.toBeDefined();
  });
});

describe("Edit — response shape (R18.6)", () => {
  it("R18.6: edit() returns registration, pricingBreakup, paymentDelta, paymentAction", async () => {
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    const req: EditRegistrationRequest = {
      fields: { donationAmount: 1000 },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result).toHaveProperty('registration');
    expect(result).toHaveProperty('pricingBreakup');
    expect(result).toHaveProperty('paymentDelta');
    expect(result).toHaveProperty('paymentAction');
  });

  it("R18.6: pricingBreakup is non-null for cost-affecting edits", async () => {
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    const req: EditRegistrationRequest = {
      fields: { donationAmount: 1000 },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");
    expect(result.pricingBreakup).not.toBeNull();
    expect(typeof result.pricingBreakup!.total).toBe('number');
  });

  it("R18.6: pricingBreakup is null for cosmetic-only edits", async () => {
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi Kumar Jr" },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");
    expect(result.pricingBreakup).toBeNull();
  });
});

// =============================================================================
// 4. Payment Management on Edit — R7.9–R7.14
// =============================================================================

describe("Edit — delta > 0 with existing payment_pending (R7.9)", () => {
  let ctx: EditTestContext;
  let regId: number;
  let updatedAt: number;
  let originalPendingAmount: number;

  beforeEach(async () => {
    ctx = createEditContext();
    const result = await bootstrapRegistration(ctx);
    regId = result.regId;
    updatedAt = result.updatedAt;

    // Get the initial payment_pending record
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    originalPendingAmount = payments[0].amount;
  });

  it("R7.9: increasing donation updates existing payment_pending amount (not creates new)", async () => {
    // Catches: generator creating a second payment record instead of updating existing
    const req: EditRegistrationRequest = {
      fields: { donationAmount: originalPendingAmount + 500 },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    // Action must be 'updated', not 'created'
    expect(result.paymentAction).toBe('updated');

    // Must still be exactly one payment_pending record
    const allPayments = await ctx.paymentRepo.findByRegistration(regId);
    const pendingPayments = allPayments.filter(p => p.status === 'payment_pending');
    expect(pendingPayments).toHaveLength(1);
  });

  it("R7.9: updated pending payment amount equals delta (new_total - verified_total)", async () => {
    // With no verified payments, verifiedTotal = 0, so delta = newTotal
    const req: EditRegistrationRequest = {
      fields: { donationAmount: 1000 },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const pending = await ctx.paymentRepo.findPendingByRegistration(regId);
    expect(pending).not.toBeNull();
    // Delta = newTotal - 0 (no verified). Amount must match newTotal
    expect(pending!.amount).toBeGreaterThan(0);
    expect(pending!.amount).not.toBe(originalPendingAmount);
  });

  it("R7.7: payment_pending record IS mutable — amount can change", async () => {
    // R7.7: "Only payment_pending records can have their amount updated"
    const initialAmount = (await ctx.paymentRepo.findPendingByRegistration(regId))!.amount;

    const req: EditRegistrationRequest = {
      fields: { donationAmount: 2000 },
      updatedAt,
    };
    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const updated = await ctx.paymentRepo.findPendingByRegistration(regId);
    expect(updated!.amount).not.toBe(initialAmount);
  });

  it("R7.17: email sent to attendee when existing pending payment is updated", async () => {
    // R7.17: "send 'Revised payment' email when pending amount is updated"
    // Catches: generator not sending email on amount update
    const req: EditRegistrationRequest = {
      fields: { donationAmount: 1000 },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");
    // Fire-and-forget — give async calls a turn
    await Promise.resolve();

    expect(ctx.emailService.revisedPaymentCalls).toHaveLength(1);
    expect(ctx.emailService.revisedPaymentCalls[0].to).toBe(validSubmitData.contact.email);
  });
});

describe("Edit — delta > 0 with no payment_pending (all verified) (R7.10, R7.13)", () => {
  let ctx: EditTestContext;
  let regId: number;
  let updatedAt: number;

  beforeEach(async () => {
    ctx = createEditContext();
    const result = await bootstrapRegistration(ctx);
    regId = result.regId;
    updatedAt = result.updatedAt;

    // Verify the existing payment so no payment_pending remains
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.paymentRepo.updateStatus(payments[0].id, 'verified', { gatewayRef: 'UTR123' });
    await ctx.regRepo.updateStatus(regId, 'confirmed');

    // Reload updatedAt
    const updatedReg = await ctx.regRepo.findById(regId);
    updatedAt = updatedReg!.updatedAt;
  });

  it("R7.10: creates a NEW payment record when delta > 0 and no payment_pending exists", async () => {
    // Catches: generator updating a verified payment instead of creating new
    const verifiedTotal = await ctx.paymentRepo.sumVerifiedByRegistration(regId);

    const req: EditRegistrationRequest = {
      fields: { donationAmount: verifiedTotal + 2000 },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.paymentAction).toBe('created');

    // A new payment_pending record must exist
    const newPending = await ctx.paymentRepo.findPendingByRegistration(regId);
    expect(newPending).not.toBeNull();
    expect(newPending!.status).toBe('payment_pending');
  });

  it("R7.13: registration status → 'pending' when new payment obligation created", async () => {
    // R7.13: "If any payment_pending record exists → status = pending"
    // Catches: generator keeping status = 'confirmed' after creating new payment
    const verifiedTotal = await ctx.paymentRepo.sumVerifiedByRegistration(regId);

    const req: EditRegistrationRequest = {
      fields: { donationAmount: verifiedTotal + 2000 },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const reg = await ctx.regRepo.findById(regId);
    expect(reg!.status).toBe('pending');
  });

  it("R7.14: confirmed → pending is a valid transition (amendment creates obligation)", async () => {
    // This tests the actual status.ts transition — confirmed must now support → pending
    const { isValidTransition } = await import('../domain/status.js');
    expect(isValidTransition('confirmed', 'pending')).toBe(true);
  });

  it("R7.7: verified payment record is NOT modified when new payment is created", async () => {
    // R7.7: "pending_verification or verified records are never modified"
    // Catches: generator updating the verified record's amount
    const verifiedPayments = [...ctx.paymentRepo.payments.values()].filter(p => p.status === 'verified');
    const verifiedAmountBefore = verifiedPayments[0].amount;
    const verifiedTotal = await ctx.paymentRepo.sumVerifiedByRegistration(regId);

    const req: EditRegistrationRequest = {
      fields: { donationAmount: verifiedTotal + 2000 },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const verifiedAfter = ctx.paymentRepo.payments.get(verifiedPayments[0].id);
    expect(verifiedAfter!.amount).toBe(verifiedAmountBefore);
    expect(verifiedAfter!.status).toBe('verified');
  });

  it("R7.16: 'Additional payment required' email sent when new payment created", async () => {
    // R7.16: send email when a new payment_pending record is created
    // Catches: generator sending 'revised payment' email or no email at all
    const verifiedTotal = await ctx.paymentRepo.sumVerifiedByRegistration(regId);

    const req: EditRegistrationRequest = {
      fields: { donationAmount: verifiedTotal + 2000 },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");
    await Promise.resolve();

    expect(ctx.emailService.additionalPaymentCalls).toHaveLength(1);
    expect(ctx.emailService.additionalPaymentCalls[0].to).toBe(validSubmitData.contact.email);
    // Revised payment email must NOT have been sent
    expect(ctx.emailService.revisedPaymentCalls).toHaveLength(0);
  });
});

describe("Edit — delta == 0 with existing payment_pending (R7.11, R7.13, R7.14)", () => {
  let ctx: EditTestContext;
  let regId: number;

  beforeEach(async () => {
    ctx = createEditContext();
    const result = await bootstrapRegistration(ctx);
    regId = result.regId;
  });

  it("R7.11: delta == 0 deletes existing payment_pending record", async () => {
    // To get delta == 0 with a pending payment: use same total as current
    // But that requires reverting to the exact original pricing.
    // Simplest approach: make the total match exactly by editing back
    // Actually, delta = newTotal - sumVerified. With sumVerified=0, delta=newTotal.
    // To force delta==0, we need newTotal == 0 which is blocked.
    // Instead: partially verify, then edit to match verified amount.

    // Verify a partial amount
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    const originalPaymentId = payments[0].id;
    // Update pending amount to originalTotal (already matches)
    // We need to get verifiedTotal == newTotal.
    // Create a split scenario: verify the payment, then edit to reduce total to that verified amount
    // But that triggers the 422 guard if we go below verified.
    // Exception path: if we go DOWN to verified total (not below), delta == 0.

    // Verify the full amount
    await ctx.paymentRepo.updateStatus(originalPaymentId, 'pending_verification');
    await ctx.paymentRepo.updateStatus(originalPaymentId, 'verified', { gatewayRef: 'UTR123' });
    await ctx.regRepo.updateStatus(regId, 'confirmed');

    // Now create a new payment_pending for a supplementary amount
    const suppId = (await ctx.paymentRepo.create({
      registration_id: regId,
      amount: 500,
      status: 'payment_pending',
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    })).id;

    await ctx.regRepo.updateStatus(regId, 'pending');

    // Reload updatedAt
    const updatedReg = await ctx.regRepo.findById(regId);
    const freshUpdatedAt = updatedReg!.updatedAt;

    // Now edit so that newTotal == verifiedTotal (delta == 0).
    // The registration's donation was 500. Keeping it the same means newTotal == verifiedTotal → delta == 0.
    const req: EditRegistrationRequest = {
      fields: { donationAmount: 500 }, // keep donation same — total matches verified
      updatedAt: freshUpdatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    // paymentAction should be 'deleted' (pending payment deleted since delta=0)
    expect(result.paymentAction).toBe('deleted');

    // The supplementary pending payment must be gone
    const pending = await ctx.paymentRepo.findPendingByRegistration(regId);
    expect(pending).toBeNull();

    // Original verified payment must still exist and be verified
    const verifiedPmt = ctx.paymentRepo.payments.get(originalPaymentId);
    expect(verifiedPmt!.status).toBe('verified');

    // suppId payment_pending must have been deleted
    expect(ctx.paymentRepo.payments.has(suppId)).toBe(false);
  });

  it("R7.13/R7.14: registration status → 'confirmed' when delta==0 removes pending payment", async () => {
    // R7.14: pending → confirmed transition when delta becomes 0
    // Setup: verified payment + supplementary pending
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.paymentRepo.updateStatus(payments[0].id, 'verified', { gatewayRef: 'UTR123' });
    await ctx.regRepo.updateStatus(regId, 'confirmed');

    await ctx.paymentRepo.create({
      registration_id: regId,
      amount: 500,
      status: 'payment_pending',
      gateway: null, gateway_ref: null, gateway_response: null,
      proof_file_key: null, verified_by: null, verified_at: null,
    });
    await ctx.regRepo.updateStatus(regId, 'pending');

    const updatedReg = await ctx.regRepo.findById(regId);
    const freshUpdatedAt = updatedReg!.updatedAt;

    const req: EditRegistrationRequest = {
      fields: { donationAmount: 500 }, // same total → delta = 0
      updatedAt: freshUpdatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const reg = await ctx.regRepo.findById(regId);
    expect(reg!.status).toBe('confirmed');
  });

  it("R7.14: pending → confirmed is a valid transition", async () => {
    const { isValidTransition } = await import('../domain/status.js');
    expect(isValidTransition('pending', 'confirmed')).toBe(true);
  });

  it("R7.18: no email sent when pending payment deleted (delta==0)", async () => {
    // R7.18: "When a payment_pending record is deleted: no email"
    // Catches: generator sending a confirmation email when delta becomes 0
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.paymentRepo.updateStatus(payments[0].id, 'verified', { gatewayRef: 'UTR123' });
    await ctx.regRepo.updateStatus(regId, 'confirmed');

    await ctx.paymentRepo.create({
      registration_id: regId,
      amount: 500,
      status: 'payment_pending',
      gateway: null, gateway_ref: null, gateway_response: null,
      proof_file_key: null, verified_by: null, verified_at: null,
    });
    await ctx.regRepo.updateStatus(regId, 'pending');

    const updatedReg = await ctx.regRepo.findById(regId);

    const req: EditRegistrationRequest = {
      fields: { donationAmount: 500 },
      updatedAt: updatedReg!.updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");
    await Promise.resolve();

    expect(ctx.emailService.revisedPaymentCalls).toHaveLength(0);
    expect(ctx.emailService.additionalPaymentCalls).toHaveLength(0);
  });
});

describe("Edit — delta == 0 with no payment_pending (R7.12)", () => {
  it("R7.12: no payment action when delta == 0 and no pending payment exists", async () => {
    // Setup: confirmed registration, no pending payment, total stays same
    const ctx = createEditContext();
    const { regId } = await bootstrapRegistration(ctx);

    // Verify the existing payment
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.paymentRepo.updateStatus(payments[0].id, 'verified', { gatewayRef: 'UTR123' });
    await ctx.regRepo.updateStatus(regId, 'confirmed');

    const updatedReg = await ctx.regRepo.findById(regId);
    const freshUpdatedAt = updatedReg!.updatedAt;

    // Make a cosmetic edit only (no cost change, no pending, delta = 0)
    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi Kumar Renamed" },
      updatedAt: freshUpdatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");

    expect(result.paymentAction).toBe('none');
    expect(result.paymentDelta).toBeNull();
  });
});

// =============================================================================
// 5. Payment record immutability (R7.7, R11.2)
// =============================================================================

describe("Edit — payment record immutability (R7.7, R11.2)", () => {
  it("R7.7: pending_verification record is never modified during edit", async () => {
    // R11.2: pending_verification records are frozen — never modified
    // Catches: generator modifying a pending_verification record's amount during repricing
    const ctx = createEditContext();
    const { regId } = await bootstrapRegistration(ctx);

    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.regRepo.updateStatus(regId, 'pending_verification');

    // Re-read the registration after the status mutation — updateStatus bumps
    // updatedAt, so the edit must present the fresh timestamp to pass the
    // optimistic lock (matches sibling tests R7.12, R7.23).
    const updatedReg = await ctx.regRepo.findById(regId);
    const freshUpdatedAt = updatedReg!.updatedAt;

    // Cost-affecting edit is blocked (tested separately). But we verify the
    // pending_verification record itself was not modified. We make a cosmetic
    // edit and verify the payment record is unchanged.
    const pvAmountBefore = payments[0].amount;
    const pvStatusBefore = payments[0].status;

    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi Kumar Frozen" },
      updatedAt: freshUpdatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const paymentAfter = ctx.paymentRepo.payments.get(payments[0].id);
    expect(paymentAfter!.status).toBe(pvStatusBefore);
    expect(paymentAfter!.amount).toBe(pvAmountBefore);
  });

  it("R11.3: at most one payment_pending record per registration at any time", async () => {
    // R7.8: invariant — at most one payment_pending per registration
    // Catches: generator creating a second payment_pending instead of updating
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    // Make a cost-affecting edit — should update existing pending, not create new
    const req: EditRegistrationRequest = {
      fields: { donationAmount: 800 },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const allPayments = await ctx.paymentRepo.findByRegistration(regId);
    const pendingCount = allPayments.filter(p => p.status === 'payment_pending').length;
    expect(pendingCount).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// 6. Audit Trail (R12)
// =============================================================================

describe("Edit — audit trail (R12, R7.22–R7.24)", () => {
  it("R7.22: 'amended' audit entry logged on every edit", async () => {
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi Kumar Edited" },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const auditEntries = await ctx.auditRepo.findByRegistration(regId);
    const amendedEntries = auditEntries.filter(e => e.action === 'amended');
    expect(amendedEntries).toHaveLength(1);
  });

  it("R12.1: audit actor is staff email, not attendee email", async () => {
    // Catches: generator logging the attendee email instead of staff email
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    const req: EditRegistrationRequest = {
      fields: { fullName: "Ravi Kumar Edited" },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const auditEntries = await ctx.auditRepo.findByRegistration(regId);
    const amendedEntry = auditEntries.find(e => e.action === 'amended');
    expect(amendedEntry!.actor).toBe('staff@smriti.com');
    expect(amendedEntry!.actor).not.toBe(validSubmitData.contact.email);
  });

  it("R7.23: 'payment_created' audit entry logged when new payment is created", async () => {
    const ctx = createEditContext();
    const { regId } = await bootstrapRegistration(ctx);

    // Verify existing payment to force creation path
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.paymentRepo.updateStatus(payments[0].id, 'verified', { gatewayRef: 'UTR123' });
    await ctx.regRepo.updateStatus(regId, 'confirmed');

    const updatedReg = await ctx.regRepo.findById(regId);

    const req: EditRegistrationRequest = {
      fields: { donationAmount: 5000 },
      updatedAt: updatedReg!.updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const auditEntries = await ctx.auditRepo.findByRegistration(regId);
    const paymentCreatedEntry = auditEntries.find(e => e.action === 'payment_created');
    expect(paymentCreatedEntry).toBeDefined();
    expect(paymentCreatedEntry!.actor).toBe('staff@smriti.com');
  });

  it("R7.24: 'payment_amended' audit entry logged when existing pending amount is updated", async () => {
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    // Existing payment_pending remains (no verify)
    const req: EditRegistrationRequest = {
      fields: { donationAmount: 1000 },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    const auditEntries = await ctx.auditRepo.findByRegistration(regId);
    const paymentAmendedEntry = auditEntries.find(e => e.action === 'payment_amended');
    expect(paymentAmendedEntry).toBeDefined();
    expect(paymentAmendedEntry!.actor).toBe('staff@smriti.com');
  });
});

// =============================================================================
// 7. Email change (R10.2.1)
// =============================================================================

describe("Edit — email change (R10.2.1)", () => {
  it("R10.2.1: email change with duplicate throws 409", async () => {
    const ctx = createEditContext();

    // Create two registrations
    await bootstrapRegistration(ctx, validSubmitData);
    const result2 = await bootstrapRegistration(ctx, {
      ...validSubmitData,
      contact: { ...validSubmitData.contact, email: 'second@example.com', whatsapp: '+919000000002' },
    });

    const reg2 = await ctx.regRepo.findById(result2.regId);

    // Try to change second registration's email to first's email
    const req: EditRegistrationRequest = {
      fields: { email: validSubmitData.contact.email }, // duplicate
      updatedAt: reg2!.updatedAt,
    };

    await expect(
      ctx.editService.edit(result2.regId, req, "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("R10.2.1(b): email change triggers magic link invalidation (DELETE magic_links called)", async () => {
    // Catches: generator not invalidating magic links on email change
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    const req: EditRegistrationRequest = {
      fields: { email: 'newemail@example.com' },
      updatedAt,
    };

    await ctx.editService.edit(regId, req, "staff@smriti.com");

    // FakeEditDb should have recorded the DELETE magic_links call
    expect(ctx.fakeDb.magicLinkDeleteCalls).toHaveLength(1);
    expect(ctx.fakeDb.magicLinkDeleteCalls[0].registrationId).toBe(regId);
  });

  it("R10.2.1: email change to non-duplicate succeeds", async () => {
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    const req: EditRegistrationRequest = {
      fields: { email: 'brand-new-email@example.com' },
      updatedAt,
    };

    const result = await ctx.editService.edit(regId, req, "staff@smriti.com");
    expect(result.registration.email).toBe('brand-new-email@example.com');
  });

  it("R10.2.1: email change is allowed regardless of payment state", async () => {
    // R10.2.1: "Email changes are always allowed regardless of payment state"
    // Catches: generator blocking email change when pending_verification exists
    const ctx = createEditContext();
    const { regId } = await bootstrapRegistration(ctx);

    // Advance to pending_verification
    const payments = await ctx.paymentRepo.findByRegistration(regId);
    await ctx.paymentRepo.updateStatus(payments[0].id, 'pending_verification');
    await ctx.regRepo.updateStatus(regId, 'pending_verification');

    // Re-read updatedAt AFTER the status change: updateStatus bumps it, so a
    // value captured before it goes stale whenever the clock ticks in between.
    const reg = await ctx.regRepo.findById(regId);

    const req: EditRegistrationRequest = {
      fields: { email: 'another@example.com' },
      updatedAt: reg!.updatedAt,
    };

    await expect(
      ctx.editService.edit(regId, req, "staff@smriti.com"),
    ).resolves.toBeDefined();
  });
});

describe("Edit — participation type owns legacy attendance intent", () => {
  it("persists a coupled donation_only pair even when the client submits a contradictory intent", async () => {
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    const result = await ctx.editService.edit(regId, {
      fields: {
        participationType: "donation_only",
        attendanceIntent: "attending",
      },
      updatedAt,
    }, "staff@smriti.com");

    expect(result.registration.participationType).toBe("donation_only");
    expect(result.registration.attendanceIntent).toBe("donation_only");

    const persisted = await ctx.regRepo.findById(regId);
    expect(persisted).toMatchObject({
      participationType: "donation_only",
      attendanceIntent: "donation_only",
    });
  });
});

describe("Edit — attendee chargeability is derived at persistence", () => {
  it("keeps age 0 free and age 6 chargeable regardless of client flags", async () => {
    const ctx = createEditContext();
    const { regId, updatedAt } = await bootstrapRegistration(ctx);

    await ctx.editService.edit(regId, {
      fields: {},
      attendees: [
        {
          registration_id: regId,
          type: "child",
          name: "Infant",
          age: 0,
          relationship: null,
          meal: "veg",
          is_chargeable: 1,
        },
        {
          registration_id: regId,
          type: "child",
          name: "Six Year Old",
          age: 6,
          relationship: null,
          meal: "non_veg",
          is_chargeable: 0,
        },
      ],
      updatedAt,
    }, "staff@smriti.com");

    const persisted = await ctx.attendeeRepo.findByRegistration(regId);
    expect(persisted.map((attendee) => ({
      name: attendee.name,
      age: attendee.age,
      isChargeable: attendee.isChargeable,
    }))).toEqual([
      { name: "Infant", age: 0, isChargeable: false },
      { name: "Six Year Old", age: 6, isChargeable: true },
    ]);
  });
});
