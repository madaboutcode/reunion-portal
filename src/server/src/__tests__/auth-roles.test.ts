/**
 * Route-level tests for auth, staff, and admin routes.
 *
 * Tests every externally observable guarantee from:
 *   - auth.routes.ts (magic-link, verify)
 *   - auth.middleware.ts (authMiddleware, requireRole)
 *   - staff.routes.ts (dashboard, registrations, verify/reject, files, export)
 *   - admin.routes.ts (create user, list, update, generate-login-link, resend-invite)
 *
 * Uses the Hono test client pattern: real route handlers with in-memory fakes.
 * No mock libraries. All fakes implement real interfaces and track observable
 * side effects.
 *
 * @module auth-roles.test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { clearRateLimitStore } from "../middleware/rate-limit.js";
import { handleError } from "../middleware/error.middleware.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { createFakePermissionsDb } from "./helpers/fake-permissions-db.js";
import { createEmptyTshirtRepo, createEmptyChargeRepo } from "./helpers/fake-tshirt-charge-repos.js";
import { authRoutes } from "../routes/auth.routes.js";
import { staffRoutes } from "../routes/staff.routes.js";
import { adminRoutes } from "../routes/admin.routes.js";
import { AuthService } from "../services/auth.service.js";
import { PaymentService } from "../services/payment.service.js";
import { RegistrationService } from "../services/registration.service.js";
import { unusedD1 } from "./helpers/minimal-d1.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PricingService } from "../services/pricing.service.js";
import { signToken } from "../infra/jwt.js";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  IDocumentRepository,
  IFileStorage,
  IEmailService,
  IAuthRepository,
  IUserRepository,
  ISystemAuditRepository,
  MagicLinkEmailData,
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
  FileMetadata,
  MagicLink,
  User,
  NewUser,
  SystemAuditAction,
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type { PricingBreakup } from "@smriti/shared";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";

const stubAvailabilityService = { isAccommodationAvailable: async () => true } as unknown as AvailabilityService;

// =============================================================================
// Constants
// =============================================================================

const TEST_JWT_SECRET = "test-secret-key-for-auth-roles-tests-32chars!";

// Hono app.request() accepts env as the third argument.
// authMiddleware reads c.env.JWT_SECRET, so this must be provided per request.
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as import("../env.js").Env;

// =============================================================================
// In-memory fakes
// =============================================================================

// ---------------------------------------------------------------------------
// Auth repo
// ---------------------------------------------------------------------------

class InMemoryAuthRepo implements IAuthRepository {
  stored: Array<{
    id: number;
    tokenHash: string;
    expiresAt: number;
    identity: { registrationId: number } | { userId: number };
    usedAt: number | null;
  }> = [];
  markedUsed: number[] = [];
  private nextId = 1;

  async createMagicLink(
    tokenHash: string,
    expiresAt: number,
    identity: { registrationId: number } | { userId: number },
  ): Promise<void> {
    this.stored.push({ id: this.nextId++, tokenHash, expiresAt, identity, usedAt: null });
  }

  async findValidMagicLink(tokenHash: string): Promise<MagicLink | null> {
    const now = Date.now();
    const found = this.stored.find(
      (l) => l.tokenHash === tokenHash && l.usedAt === null && l.expiresAt > now,
    );
    if (!found) return null;
    const identity = found.identity;
    return {
      id: found.id,
      tokenHash: found.tokenHash,
      registrationId: "registrationId" in identity ? identity.registrationId : null,
      userId: "userId" in identity ? identity.userId : null,
      expiresAt: found.expiresAt,
      usedAt: found.usedAt,
      createdAt: Date.now(),
    };
  }

  async markUsed(id: number): Promise<boolean> {
    this.markedUsed.push(id);
    return true;
  }

  async cleanExpired(): Promise<void> {}

  async countRecentLinks(
    identity: { registrationId: number } | { userId: number },
    _sinceMs: number,
  ): Promise<number> {
    const column = 'registrationId' in identity ? 'registrationId' : 'userId';
    const id = 'registrationId' in identity ? identity.registrationId : identity.userId;
    return this.stored.filter(
      (l) => {
        const linkId = column === 'registrationId'
          ? ('registrationId' in l.identity ? l.identity.registrationId : null)
          : ('userId' in l.identity ? l.identity.userId : null);
        return linkId === id;
      },
    ).length;
  }

  /**
   * Helper: plant a valid token directly so tests can call GET /verify
   * without going through the full magic-link email flow.
   */
  plantToken(rawToken: string, identity: { registrationId: number } | { userId: number }): void {
    // Store under the same token string used as tokenHash for simplicity —
    // the test must also configure findValidMagicLink, so we do it inline.
    this.stored.push({
      id: this.nextId++,
      tokenHash: rawToken,
      expiresAt: Date.now() + 30 * 60 * 1000,
      identity,
      usedAt: null,
    });
  }
}

// ---------------------------------------------------------------------------
// User repo — observable creates
// ---------------------------------------------------------------------------

class InMemoryUserRepo implements IUserRepository {
  users: Map<number, User> = new Map();
  private nextId = 1;
  // Used to simulate D1 UNIQUE constraint errors
  throwOnCreate: string | null = null;

  seed(user: User): void {
    this.users.set(user.id, user);
  }

  async create(newUser: NewUser): Promise<{ id: number }> {
    if (this.throwOnCreate) {
      throw new Error(this.throwOnCreate);
    }
    const id = this.nextId++;
    const now = Date.now();
    const user: User = {
      id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      isActive: true,
      permissions: null,
      createdBy: newUser.created_by,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(id, user);
    return { id };
  }

  async findById(id: number): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async list(): Promise<User[]> {
    return [...this.users.values()];
  }

  async update(id: number, data: { name?: string; is_active?: number }): Promise<void> {
    const user = this.users.get(id);
    if (!user) return;
    if (data.name !== undefined) user.name = data.name;
    if (data.is_active !== undefined) user.isActive = data.is_active !== 0;
    user.updatedAt = Date.now();
  }
}

// ---------------------------------------------------------------------------
// Registration repo
// ---------------------------------------------------------------------------

class InMemoryRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  // Companion repos for createWithRelations
  companionAttendeeRepo?: IAttendeeRepository & { replaceForRegistration(id: number, attendees: NewAttendee[]): Promise<void> };
  companionPaymentRepo?: IPaymentRepository;
  companionDocumentRepo?: IDocumentRepository;

  seed(reg: Registration): void {
    this.registrations.set(reg.id, reg);
  }

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
    if (data.email !== undefined) reg.email = data.email;
    reg.updatedAt = Date.now();
  }

  async list(filters?: RegistrationFilters): Promise<Registration[]> {
    let regs = [...this.registrations.values()];
    if (filters?.status) regs = regs.filter((r) => r.status === filters.status);
    if (filters?.branch) regs = regs.filter((r) => r.branch === filters.branch);
    return regs;
  }

  async count(filters?: RegistrationFilters): Promise<number> {
    const all = await this.list(filters);
    return all.length;
  }

  async countByStatus(filters?: { type?: 'attendee' | 'donor' }): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    let regs = [...this.registrations.values()];
    if (filters?.type === 'attendee') regs = regs.filter((r) => r.attendanceIntent !== 'donation_only');
    else if (filters?.type === 'donor') regs = regs.filter((r) => r.attendanceIntent === 'donation_only');
    let pending = 0, pendingVerification = 0, confirmed = 0;
    for (const r of regs) {
      if (r.status === 'pending') pending++;
      else if (r.status === 'pending_verification') pendingVerification++;
      else if (r.status === 'confirmed') confirmed++;
    }
    return { pending, pendingVerification, confirmed };
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
    for (const reg of this.registrations.values()) {
      const pt = reg.participationType as string;
      if (!(pt in out)) continue;
      const bucket = out[pt];
      bucket.total++;
      if (reg.status === 'confirmed') bucket.confirmed++;
      else if (reg.status === 'pending') bucket.pending++;
      else if (reg.status === 'pending_verification') bucket.pendingVerification++;
    }
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

  async getContributionAggregates(): Promise<Array<{ cause: string; count: number; total: number }>> {
    return [];
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

// ---------------------------------------------------------------------------
// Attendee repo
// ---------------------------------------------------------------------------

class InMemoryAttendeeRepo implements IAttendeeRepository {
  private attendees: Map<number, Attendee[]> = new Map();

  async findByRegistration(registrationId: number): Promise<Attendee[]> {
    return this.attendees.get(registrationId) ?? [];
  }

  async replaceForRegistration(
    registrationId: number,
    newAttendees: NewAttendee[],
  ): Promise<void> {
    const converted: Attendee[] = newAttendees.map((na, i) => ({
      id: i + 1,
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

// ---------------------------------------------------------------------------
// Payment repo
// ---------------------------------------------------------------------------

class InMemoryPaymentRepo implements IPaymentRepository {
  payments: Map<number, Payment> = new Map();
  private nextId = 1;

  seed(payment: Payment): void {
    this.payments.set(payment.id, payment);
  }

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
    if (gatewayData?.gateway !== undefined) p.gateway = gatewayData.gateway;
    if (proofFileKey !== undefined) p.proofFileKey = proofFileKey;
    if (verification !== undefined) {
      p.verifiedBy = verification.verifiedBy;
      p.verifiedAt = verification.verifiedAt;
    }
  }

  async sumVerified(_filters?: { type?: 'attendee' | 'donor' }): Promise<number> {
    let total = 0;
    for (const p of this.payments.values()) {
      if (p.status === 'verified') total += p.amount;
    }
    return total;
  }

  async sumVerifiedByBranch(_filters?: { type?: 'attendee' | 'donor' }): Promise<Array<{ branch: string; collected: number }>> {
    return [];
  }
  // Mutates the stored payment like the real repo: verifyPayment() re-reads
  // payments after verify() and derives the registration status from them
  // (deriveRegistrationStatus). A no-op here leaves the registration stuck
  // in pending_verification.
  async verify(id: number, amount: number, gatewayRef: string, verifiedBy: string, verifiedAt: number): Promise<void> {
    const p = this.payments.get(id);
    if (!p) return;
    this.payments.set(id, { ...p, status: "verified", amount, gatewayRef, verifiedBy, verifiedAt, updatedAt: Date.now() });
  }
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(_registrationId: number): Promise<Payment | null> { return null; }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async sumVerifiedByRegistration(_registrationId: number): Promise<number> { return 0; }
}

// ---------------------------------------------------------------------------
// Audit repo
// ---------------------------------------------------------------------------

class InMemoryAuditRepo implements IAuditRepository {
  entries: AuditEntry[] = [];
  private nextId = 1;

  async append(entry: NewAuditEntry): Promise<void> {
    this.entries.push({
      id: this.nextId++,
      registrationId: entry.registration_id,
      action: entry.action,
      actor: entry.actor,
      changes: entry.changes ? (JSON.parse(entry.changes) as Record<string, { old: unknown; new: unknown }>) : null,
      snapshot: JSON.parse(entry.snapshot) as { registration: Registration; attendees: Attendee[] },
      createdAt: Date.now(),
    });
  }

  async findByRegistration(registrationId: number): Promise<AuditEntry[]> {
    return this.entries.filter((e) => e.registrationId === registrationId);
  }
}

// ---------------------------------------------------------------------------
// Document repo (stub — not the focus of these tests)
// ---------------------------------------------------------------------------

class StubDocumentRepo implements IDocumentRepository {
  async create(_doc: NewIdDocument): Promise<{ id: number }> {
    return { id: 1 };
  }
  async findByRegistration(_registrationId: number): Promise<IdDocument[]> {
    return [];
  }
  async updateR2Key(_docId: number, _newKey: string): Promise<void> {}
}

// ---------------------------------------------------------------------------
// File storage — observable, returns fake stream
// ---------------------------------------------------------------------------

class InMemoryFileStorage implements IFileStorage {
  uploads: Array<{ key: string; metadata: FileMetadata }> = [];
  files: Map<string, { body: ReadableStream; contentType: string; size: number }> = new Map();

  seedFile(key: string, content: string, contentType: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    this.files.set(key, { body: stream, contentType, size: bytes.length });
  }

  async upload(key: string, _data: ArrayBuffer, metadata: FileMetadata): Promise<void> {
    this.uploads.push({ key, metadata });
  }

  async getSignedUrl(_key: string, _expiresIn: number): Promise<string> {
    throw new Error("not implemented");
  }

  async get(key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null> {
    return this.files.get(key) ?? null;
  }

  async delete(_key: string): Promise<void> {}

  async copy(fromKey: string, toKey: string): Promise<boolean> {
    const file = this.files.get(fromKey);
    if (!file) return false;
    this.files.set(toKey, file);
    return true;
  }

  async move(_fromKey: string, _toKey: string): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Email service — observable
// ---------------------------------------------------------------------------

interface EmailCall {
  type: "magic-link" | "confirmation" | "payment-confirmed" | "payment-rejected" | "staff-welcome";
  to: string;
  data: unknown;
}

class ObservableEmailService implements IEmailService {
  calls: EmailCall[] = [];

  async sendConfirmation(to: string, data: unknown): Promise<void> {
    this.calls.push({ type: "confirmation", to, data });
  }

  async sendMagicLink(to: string, data: MagicLinkEmailData): Promise<void> {
    this.calls.push({ type: "magic-link", to, data });
  }

  async sendPaymentConfirmed(to: string, data: unknown): Promise<void> {
    this.calls.push({ type: "payment-confirmed", to, data });
  }

  async sendPaymentRejected(to: string, data: unknown): Promise<void> {
    this.calls.push({ type: "payment-rejected", to, data });
  }

  async sendStaffWelcome(to: string, data: unknown): Promise<void> {
    this.calls.push({ type: "staff-welcome", to, data });
  }

  async sendPaymentLink(_to: string, _data: unknown): Promise<void> {}
  async sendRevisedPayment(_to: string, _data: unknown): Promise<void> {}
  async sendAdditionalPayment(_to: string, _data: unknown): Promise<void> {}
  async sendStoryHidden(_to: string, _data: unknown): Promise<void> {}
}

// ---------------------------------------------------------------------------
// System audit repo — observable
// ---------------------------------------------------------------------------

interface SystemAuditCall {
  action: SystemAuditAction;
  actor: string;
  targetType?: string;
  targetId?: number;
  details?: string;
}

class ObservableSystemAuditRepo implements ISystemAuditRepository {
  calls: SystemAuditCall[] = [];

  async append(entry: {
    action: SystemAuditAction;
    actor: string;
    targetType?: string;
    targetId?: number;
    details?: string;
  }): Promise<void> {
    this.calls.push(entry as SystemAuditCall);
  }
}

// =============================================================================
// Domain object builders
// =============================================================================

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 10,
    email: "staff@example.test",
    name: "Staff Member",
    role: "staff",
    isActive: true,
    permissions: null,
    createdBy: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1001,
    regCode: "SMRTTESTCODE0001",
    status: "pending",
    fullName: "Test Alumnus",
    branch: "Mechanical Engineering",
    email: "alumnus@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: null,
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    gender: null,
    tshirtSize: null,
    alumniMeal: "veg",
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
    pricingSnapshot: { base: 10000, lines: [], donation: 0, collegeContribution: 500, total: 10000 },
    totalAmount: 10000,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 1,
    registrationId: 1001,
    amount: 10000,
    status: "pending_verification",
    gateway: null,
    gatewayRef: null,
    gatewayResponse: null,
    proofFileKey: "payment-proofs/SMRTTESTCODE0001-1-proof.jpg",
    verifiedBy: null,
    verifiedAt: null,
    method: null,
    note: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// =============================================================================
// Test app factory
// =============================================================================

interface TestContext {
  /** Wrapper that always passes TEST_ENV as the Hono env binding. */
  req: (input: string, init?: RequestInit) => Response | Promise<Response>;
  app: Hono<AppEnv>;
  userRepo: InMemoryUserRepo;
  registrationRepo: InMemoryRegistrationRepo;
  attendeeRepo: InMemoryAttendeeRepo;
  paymentRepo: InMemoryPaymentRepo;
  auditRepo: InMemoryAuditRepo;
  fileStorage: InMemoryFileStorage;
  emailService: ObservableEmailService;
  systemAuditRepo: ObservableSystemAuditRepo;
  authRepo: InMemoryAuthRepo;
  authService: AuthService;
}

function createTestApp(): TestContext {
  // Prevent stale scope lookups from a previous test's userId bleeding into this one.
  _scopeCache.clear();

  const userRepo = new InMemoryUserRepo();
  const registrationRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  const documentRepo = new StubDocumentRepo();
  const fileStorage = new InMemoryFileStorage();
  const emailService = new ObservableEmailService();
  const systemAuditRepo = new ObservableSystemAuditRepo();
  const authRepo = new InMemoryAuthRepo();
  const pricingService = new PricingService();

  // Wire companion repos for createWithRelations
  registrationRepo.companionAttendeeRepo = attendeeRepo;
  registrationRepo.companionPaymentRepo = paymentRepo;
  registrationRepo.companionDocumentRepo = documentRepo;

  const authService = new AuthService({
    userRepo,
    registrationRepo,
    authRepo,
    emailService,
    systemAuditRepo,
    jwtSecret: TEST_JWT_SECRET,
    baseUrl: "http://localhost:8787",
  });

  const registrationService = new RegistrationService({
    availabilityService: stubAvailabilityService,
    registrationRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    emailService,
    pricingService,
    authService: { async issueAttendeeToken() { return 'test-jwt-token'; }, async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; } },
  });

  const paymentService = new PaymentService({
    db: unusedD1 as unknown as import('@cloudflare/workers-types').D1Database,
    registrationRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    refundRepo: {
      create: async () => { throw new Error('refundRepo is unused in auth-roles tests'); },
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

  // Build a Hono app that mirrors index.ts wiring but with in-memory fakes
  const app = new Hono<AppEnv>().basePath("/api");

  app.onError(handleError);

  // DI middleware — sets all services and repos into context variables.
  // JWT_SECRET is provided via the third argument of app.request() (Hono's Env binding).
  app.use("*", async (c, next) => {
    c.set("authService", authService);
    c.set("registrationService", registrationService);
    c.set("paymentService", paymentService);
    c.set("userRepo", userRepo);
    c.set("systemAuditRepo", systemAuditRepo);
    c.set("registrationRepo", registrationRepo);
    c.set("attendeeRepo", attendeeRepo);
    c.set("paymentRepo", paymentRepo);
    c.set("auditRepo", auditRepo);
    c.set("documentRepo", documentRepo);
    c.set("fileStorage", fileStorage);
    c.set("tshirtRepo", createEmptyTshirtRepo());
    c.set("chargeRepo", createEmptyChargeRepo());
    await next();
  });

  app.route("/auth", authRoutes);
  app.route("/staff", staffRoutes);
  app.route("/admin", adminRoutes);

  // Wrapper: always injects TEST_ENV so authMiddleware can read JWT_SECRET
  const req = (input: string, init?: RequestInit) =>
    app.request(input, init, TEST_ENV);

  return {
    req,
    app,
    userRepo,
    registrationRepo,
    attendeeRepo,
    paymentRepo,
    auditRepo,
    fileStorage,
    emailService,
    systemAuditRepo,
    authRepo,
    authService,
  };
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

async function staffToken(userId = 10, email = "staff@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}

async function adminToken(userId = 99, email = "admin@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "admin", email }, TEST_JWT_SECRET, "7d");
}

async function attendeeToken(registrationId = 1001): Promise<string> {
  return signToken({ sub: String(registrationId), role: "attendee" }, TEST_JWT_SECRET, "90d");
}

// =============================================================================
// Tests: POST /api/auth/magic-link
// =============================================================================

describe("POST /api/auth/magic-link", () => {
  let ctx: TestContext;

  beforeEach(() => {
    clearRateLimitStore();
    ctx = createTestApp();
  });

  it("returns 200 for a valid known email (staff user)", async () => {
    ctx.userRepo.seed(makeUser({ id: 10, email: "staff@example.test" }));

    const res = await ctx.req("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: "staff@example.test" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it("returns 200 even when email is not recognized — enumeration safety", async () => {
    const res = await ctx.req("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@example.com" }),
      headers: { "Content-Type": "application/json" },
    });

    // GUARANTEE: ENUMERATION_SAFE — 200 regardless of whether email exists
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it("returns 400 for missing email field", async () => {
    const res = await ctx.req("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ notEmail: "something" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it("returns 400 for malformed JSON body", async () => {
    const res = await ctx.req("/api/auth/magic-link", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
  });

  it("returns 200 even for a deactivated user — no leak of account state", async () => {
    ctx.userRepo.seed(makeUser({ id: 5, email: "disabled@example.com", isActive: false }));

    const res = await ctx.req("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: "disabled@example.com" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    // No email sent to deactivated user
    expect(ctx.emailService.calls.filter((c) => c.to === "disabled@example.com")).toHaveLength(0);
  });
});

describe("GET /api/staff/registrations search by formatted reg code", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("matches a registration when staff search uses the display-formatted code", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, regCode: "SMRT79WW4A25NWG1" }));

    const token = await staffToken();
    const res = await ctx.req("/api/staff/registrations?search=SMRT-79WW-4A25-NWG1", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<{ regCode: string }>;
      totalItems: number;
    };
    expect(body.totalItems).toBe(1);
    expect(body.data[0]?.regCode).toBe("SMRT79WW4A25NWG1");
  });
});

// =============================================================================
// Tests: GET /api/auth/verify
// =============================================================================

describe("GET /api/auth/verify", () => {
  let ctx: TestContext;

  beforeEach(() => {
    clearRateLimitStore();
    ctx = createTestApp();
  });

  it("returns 400 when token query param is missing", async () => {
    const res = await ctx.req("/api/auth/verify");
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });

  it("returns 401 for an invalid token", async () => {
    const res = await ctx.req("/api/auth/verify?token=bogus-token-that-does-not-exist");
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Invalid or expired link");
  });

  it("returns JWT, role, and redirectTo for a valid staff token", async () => {
    const user = makeUser({ id: 7, email: "staff@example.test", role: "staff" });
    ctx.userRepo.seed(user);

    // Plant a raw magic link token directly in the auth repo
    const rawToken = "test-raw-token-staff-verify-12345";
    ctx.authRepo.stored.push({
      id: 1,
      tokenHash: rawToken, // InMemoryAuthRepo.findValidMagicLink compares tokenHash directly
      expiresAt: Date.now() + 30 * 60 * 1000,
      identity: { userId: 7 },
      usedAt: null,
    });

    // Override the authService's authRepo to use our InMemoryAuthRepo
    // Re-create the authService wired to the same authRepo
    const authSvc = new AuthService({
      userRepo: ctx.userRepo,
      registrationRepo: ctx.registrationRepo,
      authRepo: ctx.authRepo,
      emailService: ctx.emailService,
      systemAuditRepo: ctx.systemAuditRepo,
      jwtSecret: TEST_JWT_SECRET,
      baseUrl: "http://localhost:8787",
    });

    // Build a minimal app using the authService that uses our authRepo.
    // JWT_SECRET is injected via TEST_ENV in the request call (3rd arg), not via c.env mutation.
    const miniApp = new Hono<AppEnv>().basePath("/api");
    miniApp.onError(handleError);
    miniApp.use("*", async (c, next) => {
      c.set("authService", authSvc);
      await next();
    });
    miniApp.route("/auth", authRoutes);

    // The authService hashes the token using SHA-256 before looking it up.
    // We need to store the hash of our rawToken in authRepo, not the raw token.
    const encoder = new TextEncoder();
    const data = encoder.encode(rawToken);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // Replace the entry with the correct SHA-256 hash
    ctx.authRepo.stored[0].tokenHash = tokenHash;

    const res = await miniApp.request(`/api/auth/verify?token=${rawToken}`, undefined, TEST_ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; role: string; redirectTo: string };
    expect(body.token).toBeTypeOf("string");
    expect(body.role).toBe("staff");
    expect(body.redirectTo).toBe("/staff/dashboard");
  });

  it("returns JWT with attendee role and registration redirectTo for valid attendee token", async () => {
    const reg = makeRegistration({ id: 2000, regCode: "SMRTATESTREGCDE0", email: "a@example.com" });
    ctx.registrationRepo.seed(reg);

    const rawToken = "test-raw-token-attendee-verify-999";
    const encoder = new TextEncoder();
    const data = encoder.encode(rawToken);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    ctx.authRepo.stored.push({
      id: 2,
      tokenHash,
      expiresAt: Date.now() + 30 * 60 * 1000,
      identity: { registrationId: 2000 },
      usedAt: null,
    });

    const authSvc = new AuthService({
      userRepo: ctx.userRepo,
      registrationRepo: ctx.registrationRepo,
      authRepo: ctx.authRepo,
      emailService: ctx.emailService,
      systemAuditRepo: ctx.systemAuditRepo,
      jwtSecret: TEST_JWT_SECRET,
      baseUrl: "http://localhost:8787",
    });

    const miniApp = new Hono<AppEnv>().basePath("/api");
    miniApp.onError(handleError);
    miniApp.use("*", async (c, next) => {
      c.set("authService", authSvc);
      await next();
    });
    miniApp.route("/auth", authRoutes);

    const res = await miniApp.request(`/api/auth/verify?token=${rawToken}`, undefined, TEST_ENV);
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; role: string; redirectTo: string };
    expect(body.role).toBe("attendee");
    expect(body.redirectTo).toBe(`/confirmation/${reg.id}`);
  });
});

// =============================================================================
// Tests: authMiddleware + requireRole
// =============================================================================

describe("authMiddleware and requireRole", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
    // Seed a registration so the dashboard endpoint doesn't need real data
    ctx.registrationRepo.seed(makeRegistration());
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await ctx.req("/api/staff/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns 401 when JWT is invalid", async () => {
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: "Bearer not.a.real.jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("staff JWT gets 200 on staff route", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("admin JWT gets 200 on staff route (admin is superset of staff)", async () => {
    const token = await adminToken();
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("attendee JWT gets 403 on staff route", async () => {
    const token = await attendeeToken();
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("admin JWT gets 200 on admin route", async () => {
    const token = await adminToken();
    const res = await ctx.req("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("staff JWT gets 403 on admin route", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("authMiddleware builds attendee AuthContext with registrationId from JWT sub", async () => {
    // Prove the context is built correctly by hitting an endpoint that uses it.
    // GET /staff/my-registration returns 404 for a staff member with no registration,
    // but returns 403 for an attendee — proving the role is correctly extracted.
    const token = await attendeeToken(1001);
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Attendee role → 403, which proves attendee context was set (not staff/admin)
    expect(res.status).toBe(403);
  });

  it("authMiddleware builds staff AuthContext with userId and email from JWT", async () => {
    // staff JWT → 200 on /staff/dashboard proves the staff context was built correctly
    const token = await staffToken(10, "staff@example.test");
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// Tests: Staff routes
// =============================================================================

describe("GET /api/staff/dashboard", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("returns stats shape with all expected keys", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, status: "pending" }));
    ctx.registrationRepo.seed(makeRegistration({ id: 1002, status: "confirmed" }));
    ctx.registrationRepo.seed(makeRegistration({ id: 1003, status: "pending_verification" }));

    const token = await staffToken();
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { stats: Record<string, number> };
    const { stats } = body;
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(1);
    expect(stats.confirmed).toBe(1);
    expect(stats.pendingVerification).toBe(1);
    expect(typeof stats.moneyCollected).toBe("number");
  });

  it("moneyCollected sums only verified payments, not pending ones", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, status: "confirmed" }));
    ctx.registrationRepo.seed(makeRegistration({ id: 1002, status: "pending_verification" }));

    ctx.paymentRepo.seed(makePayment({ id: 1, registrationId: 1001, status: "verified", amount: 10000 }));
    ctx.paymentRepo.seed(makePayment({ id: 2, registrationId: 1002, status: "pending_verification", amount: 8000 }));

    const token = await staffToken();
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { stats: Record<string, number> };
    // Only the verified payment (10000) counts
    expect(body.stats.moneyCollected).toBe(10000);
  });
});

describe("GET /api/staff/registrations", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("returns paginated list", async () => {
    const reg = makeRegistration({ id: 1001 });
    ctx.registrationRepo.seed(reg);

    const token = await staffToken();
    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<{ id: number }>;
      totalItems: number;
    };
    expect(body.data).toHaveLength(1);
    expect(body.totalItems).toBe(1);
  });
});

describe("GET /api/staff/registrations/:id", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("returns full registration detail for a valid id", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, fullName: "Detail Test" }));

    const token = await staffToken(10, "staff@example.test");
    const res = await ctx.req("/api/staff/registrations/1001", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { registration: { fullName: string } };
    expect(body.registration.fullName).toBe("Detail Test");
  });

  it("logs registration_viewed in system audit on GET :id", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001 }));

    const token = await staffToken(10, "staff@example.test");
    await ctx.req("/api/staff/registrations/1001", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const viewedCall = ctx.systemAuditRepo.calls.find(
      (c) => c.action === "registration_viewed",
    );
    expect(viewedCall).toBeDefined();
    expect(viewedCall?.actor).toBe("staff@example.test");
    expect(viewedCall?.targetId).toBe(1001);
  });

  it("returns 404 for a non-existent registration id", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/registrations/99999", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/staff/payments/:id/verify", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, status: "pending_verification" }));
    ctx.paymentRepo.seed(
      makePayment({ id: 1, registrationId: 1001, status: "pending_verification" }),
    );
  });

  it("delegates to paymentService and returns paymentStatus + registrationStatus", async () => {
    const token = await staffToken();
    // Full-coverage verification: actualAmount must cover totalAmount (10000).
    // A partial amount now 409s ("Uncovered shortfall") by design — the
    // partial/shortfall flow (payment-flow.spec.md R7.20-R7.21, commit bea64b4)
    // is covered by payment-partial-refund-routes.test.ts.
    const res = await ctx.req("/api/staff/payments/1/verify", {
      method: "POST",
      body: JSON.stringify({ referenceId: "REF123", actualAmount: 10000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { paymentStatus: string; registrationStatus: string };
    expect(body.paymentStatus).toBe("verified");
    expect(body.registrationStatus).toBe("confirmed");
  });

  it("returns 422 when referenceId is missing", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/payments/1/verify", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { details: { fieldErrors: Record<string, string> } };
    expect(body.details.fieldErrors.referenceId).toBeDefined();
  });

  it("returns 422 when referenceId is an empty string", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/payments/1/verify", {
      method: "POST",
      body: JSON.stringify({ referenceId: "   " }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
  });
});

describe("POST /api/staff/payments/:id/reject", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, status: "pending_verification" }));
    ctx.paymentRepo.seed(
      makePayment({ id: 1, registrationId: 1001, status: "pending_verification" }),
    );
  });

  it("delegates to paymentService and returns paymentStatus + registrationStatus", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/payments/1/reject", {
      method: "POST",
      body: JSON.stringify({ comment: "Proof is blurry" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { paymentStatus: string; registrationStatus: string };
    expect(body.paymentStatus).toBe("payment_pending");
    expect(body.registrationStatus).toBe("pending");
  });

  it("returns 422 when comment is missing", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/payments/1/reject", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { details: { fieldErrors: Record<string, string> } };
    expect(body.details.fieldErrors.comment).toBeDefined();
  });

  it("returns 422 when comment is whitespace only", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/payments/1/reject", {
      method: "POST",
      body: JSON.stringify({ comment: "  " }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
  });
});

describe("GET /api/staff/files/*", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("streams file content with correct Content-Type when file exists", async () => {
    ctx.fileStorage.seedFile(
      "payment-proofs/SMRTTESTCODE0001-1-proof.jpg",
      "fake image bytes",
      "image/jpeg",
    );

    const token = await staffToken(10, "staff@example.test");
    const res = await ctx.req(
      "/api/staff/files/payment-proofs/SMRTTESTCODE0001-1-proof.jpg",
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("logs file_viewed in system audit when file is accessed", async () => {
    ctx.fileStorage.seedFile("payment-proofs/test.jpg", "data", "image/jpeg");

    const token = await staffToken(10, "staff@example.test");
    await ctx.req("/api/staff/files/payment-proofs/test.jpg", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const fileViewedCall = ctx.systemAuditRepo.calls.find((c) => c.action === "file_viewed");
    expect(fileViewedCall).toBeDefined();
    expect(fileViewedCall?.actor).toBe("staff@example.test");
  });

  it("returns 404 when file does not exist in storage", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/files/nonexistent.jpg", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  // R6.4 — key allow-list. Allowed prefixes derived from real key producers:
  // payment-proofs/ (staff upload-proof), registrations/<regCode>/ (submit
  // relocation + payment.service proofs), id-docs/pending/ + photos/pending/
  // (wizard uploads that staff pages fetch verbatim until/unless relocated).
  // regCode = SMRT + 12 Crockford-base32 chars per domain/reg-id.ts.
  describe("R6.4 key allow-list", () => {
    // Valid Crockford-base32 regCode (alphabet excludes I, L, O, U).
    const REG_CODE = "SMRT0123456789AB";

    async function fetchKey(path: string): Promise<Response> {
      const token = await staffToken(10, "staff@example.test");
      return ctx.req(`/api/staff/files/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    it("allows payment-proofs/ keys (200)", async () => {
      ctx.fileStorage.seedFile(
        "payment-proofs/SMRTTESTC0DE0001-1-receipt.pdf",
        "pdf bytes",
        "application/pdf",
      );
      const res = await fetchKey("payment-proofs/SMRTTESTC0DE0001-1-receipt.pdf");
      expect(res.status).toBe(200);
    });

    it("allows id-docs/pending/ keys (200)", async () => {
      ctx.fileStorage.seedFile(
        "id-docs/pending/branch/name/abc123.jpg",
        "id doc bytes",
        "image/jpeg",
      );
      const res = await fetchKey("id-docs/pending/branch/name/abc123.jpg");
      expect(res.status).toBe(200);
    });

    it("allows photos/pending/ keys (200)", async () => {
      ctx.fileStorage.seedFile(
        "photos/pending/branch/name/def456.png",
        "photo bytes",
        "image/png",
      );
      const res = await fetchKey("photos/pending/branch/name/def456.png");
      expect(res.status).toBe(200);
    });

    it("allows registrations/<regCode>/ keys (200)", async () => {
      ctx.fileStorage.seedFile(
        `registrations/${REG_CODE}/photo-thumb.jpg`,
        "thumb bytes",
        "image/jpeg",
      );
      const res = await fetchKey(`registrations/${REG_CODE}/photo-thumb.jpg`);
      expect(res.status).toBe(200);
    });

    it("denies keys outside every allowed prefix with 404, even when the object exists", async () => {
      // Seed the object so the test proves the ALLOW-LIST denies it,
      // not a storage miss.
      ctx.fileStorage.seedFile("audit-logs/2026-07.json", "secret", "application/json");
      const res = await fetchKey("audit-logs/2026-07.json");
      expect(res.status).toBe(404);
      // Denied keys never produce a file_viewed audit entry.
      const viewed = ctx.systemAuditRepo.calls.find((call) => call.action === "file_viewed");
      expect(viewed).toBeUndefined();
    });

    it("denies bare id-docs/ keys outside pending/ (404) — only id-docs/pending/ is ever written", async () => {
      ctx.fileStorage.seedFile("id-docs/other/file.jpg", "bytes", "image/jpeg");
      const res = await fetchKey("id-docs/other/file.jpg");
      expect(res.status).toBe(404);
    });

    it("denies registrations/ keys whose regCode segment is not SMRT+Crockford (404)", async () => {
      // 16 chars but contains I, L, O, U — excluded from the Crockford alphabet.
      ctx.fileStorage.seedFile("registrations/SMRTILOUILOUILOU/photo.jpg", "x", "image/jpeg");
      const badCodes = [
        "SMRTILOUILOUILOU/photo.jpg", // invalid alphabet chars
        "XMRT0123456789AB/photo.jpg", // wrong prefix
        "SMRT0123/photo.jpg", // too short
        "SMRT0123456789ABCD/photo.jpg", // too long
      ];
      for (const code of badCodes) {
        const res = await fetchKey(`registrations/${code}`);
        expect(res.status).toBe(404);
      }
    });

    it("denies path-traversal payloads with 404 (raw and percent-encoded)", async () => {
      ctx.fileStorage.seedFile("secret/config.json", "secret", "application/json");
      const payloads = [
        "payment-proofs/../secret/config.json",
        "payment-proofs/%2e%2e/secret/config.json",
        "payment-proofs/..%2fsecret%2fconfig.json",
        `registrations/${REG_CODE}/../../secret/config.json`,
        "id-docs/pending/%2e%2e%2f%2e%2e%2fsecret%2fconfig.json",
      ];
      for (const payload of payloads) {
        const res = await fetchKey(payload);
        expect(res.status).toBe(404);
      }
    });

    it("denies empty key with 404", async () => {
      const res = await fetchKey("");
      expect(res.status).toBe(404);
    });
  });
});

describe("GET /api/staff/export", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, fullName: "Export Test" }));
  });

  it("returns CSV with correct headers", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/export", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv");

    const csv = await res.text();
    const firstLine = csv.split("\n")[0];
    // Must include the key column headers
    expect(firstLine).toContain("regCode");
    expect(firstLine).toContain("fullName");
    expect(firstLine).toContain("status");
  });

  it("logs export_downloaded in system audit", async () => {
    const token = await staffToken(10, "staff@example.test");
    await ctx.req("/api/staff/export", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const exportCall = ctx.systemAuditRepo.calls.find((c) => c.action === "export_downloaded");
    expect(exportCall).toBeDefined();
    expect(exportCall?.actor).toBe("staff@example.test");
  });

  it("CSV data rows contain the registration's values", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/staff/export", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const csv = await res.text();
    // Should contain the seeded registration's fullName
    expect(csv).toContain("Export Test");
  });
});

// =============================================================================
// Tests: Admin routes
// =============================================================================

describe("POST /api/admin/users", () => {
  let ctx: TestContext;
  let adminJwt: string;

  beforeEach(async () => {
    ctx = createTestApp();
    adminJwt = await adminToken(99, "admin@example.test");
  });

  it("creates a staff user and returns 201 with user shape", async () => {
    const res = await ctx.req("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "newstaff@example.com", name: "New Staff", role: "staff" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      id: number; email: string; name: string; role: string; isActive: boolean;
    };
    expect(body.email).toBe("newstaff@example.com");
    expect(body.name).toBe("New Staff");
    expect(body.role).toBe("staff");
    expect(body.isActive).toBe(true);
  });

  it("returns 400 when role is not staff", async () => {
    const res = await ctx.req("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "a@example.com", name: "Admin Try", role: "admin" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("staff");
  });

  it("returns 409 when email already exists (UNIQUE constraint)", async () => {
    ctx.userRepo.throwOnCreate = "UNIQUE constraint failed: users.email";

    const res = await ctx.req("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "dup@example.com", name: "Dup User", role: "staff" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  it("logs staff_created in system audit", async () => {
    await ctx.req("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "audit@example.com", name: "Audit User", role: "staff" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    const createdCall = ctx.systemAuditRepo.calls.find((c) => c.action === "staff_created");
    expect(createdCall).toBeDefined();
    expect(createdCall?.actor).toBe("admin@example.test");
  });

  it("returns 400 for missing email field", async () => {
    const res = await ctx.req("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ name: "No Email", role: "staff" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/users", () => {
  let ctx: TestContext;
  let adminJwt: string;

  beforeEach(async () => {
    ctx = createTestApp();
    adminJwt = await adminToken();
  });

  it("returns list of users", async () => {
    ctx.userRepo.seed(makeUser({ id: 1, email: "a@example.com" }));
    ctx.userRepo.seed(makeUser({ id: 2, email: "b@example.com" }));

    const res = await ctx.req("/api/admin/users", {
      headers: { Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { users: Array<{ email: string }> };
    expect(body.users).toHaveLength(2);
  });

  it("returns empty list when no users exist", async () => {
    const res = await ctx.req("/api/admin/users", {
      headers: { Authorization: `Bearer ${adminJwt}` },
    });
    const body = await res.json() as { users: unknown[] };
    expect(body.users).toHaveLength(0);
  });
});

describe("PATCH /api/admin/users/:id", () => {
  let ctx: TestContext;
  let adminJwt: string;
  const ADMIN_USER_ID = 99;

  beforeEach(async () => {
    ctx = createTestApp();
    adminJwt = await adminToken(ADMIN_USER_ID, "admin@example.test");
    ctx.userRepo.seed(
      makeUser({ id: 5, email: "staff@example.com", name: "Original Name" }),
    );
  });

  it("updates user name and returns updated shape", async () => {
    const res = await ctx.req("/api/admin/users/5", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated Name" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { name: string };
    expect(body.name).toBe("Updated Name");
  });

  it("returns 409 when admin attempts to deactivate their own account", async () => {
    // Seed the admin's own user record
    ctx.userRepo.seed(
      makeUser({ id: ADMIN_USER_ID, email: "admin@example.test", role: "admin" }),
    );

    const res = await ctx.req(`/api/admin/users/${ADMIN_USER_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  it("returns 404 for a non-existent user id", async () => {
    const res = await ctx.req("/api/admin/users/99999", {
      method: "PATCH",
      body: JSON.stringify({ name: "Ghost" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });
    expect(res.status).toBe(404);
  });

  it("logs staff_updated in system audit", async () => {
    await ctx.req("/api/admin/users/5", {
      method: "PATCH",
      body: JSON.stringify({ name: "Audited Name" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    const updatedCall = ctx.systemAuditRepo.calls.find((c) => c.action === "staff_updated");
    expect(updatedCall).toBeDefined();
    expect(updatedCall?.actor).toBe("admin@example.test");
  });
});

describe("POST /api/admin/users/:id/resend-invite", () => {
  let ctx: TestContext;
  let adminJwt: string;

  beforeEach(async () => {
    ctx = createTestApp();
    adminJwt = await adminToken(99, "admin@example.test");
  });

  it("returns 200 and sends a magic link for an active user", async () => {
    ctx.userRepo.seed(makeUser({ id: 5, email: "active@example.com", isActive: true }));

    const res = await ctx.req("/api/admin/users/5/resend-invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 409 when resending invite to a deactivated user", async () => {
    ctx.userRepo.seed(makeUser({ id: 6, email: "disabled@example.com", isActive: false }));

    const res = await ctx.req("/api/admin/users/6/resend-invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  it("returns 404 for a non-existent user id", async () => {
    const res = await ctx.req("/api/admin/users/99999/resend-invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/users/:id/generate-login-link", () => {
  let ctx: TestContext;
  let adminJwt: string;

  beforeEach(async () => {
    ctx = createTestApp();
    adminJwt = await adminToken(99, "admin@example.test");
  });

  it("returns a 10-minute copyable link for an active staff user without sending email", async () => {
    ctx.userRepo.seed(makeUser({ id: 5, email: "staff@example.com", role: "staff", isActive: true }));

    const res = await ctx.req("/api/admin/users/5/generate-login-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { link: string; expiresIn: number };
    expect(body.link).toMatch(/^http:\/\/localhost:8787\/auth\/verify\?token=.+$/);
    expect(body.expiresIn).toBe(10);

    const rawToken = new URL(body.link).searchParams.get("token");
    expect(rawToken).toBeTruthy();
    expect(ctx.authRepo.stored).toHaveLength(1);
    expect(ctx.authRepo.stored[0].identity).toEqual({ userId: 5 });
    expect(ctx.authRepo.stored[0].tokenHash).not.toBe(rawToken);
    const remainingLifetime = ctx.authRepo.stored[0].expiresAt - Date.now();
    expect(remainingLifetime).toBeGreaterThan(9 * 60 * 1000);
    expect(remainingLifetime).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(ctx.emailService.calls).toHaveLength(0);

    const audit = ctx.systemAuditRepo.calls.find((call) => call.action === "login_link_generated");
    expect(audit).toMatchObject({
      actor: "admin@example.test",
      targetType: "user",
      targetId: 5,
    });
    expect(JSON.parse(audit?.details ?? "{}")).toEqual({
      generatedFor: "staff@example.com",
      role: "staff",
      expiresIn: 10,
    });
  });

  it("rejects admin targets", async () => {
    ctx.userRepo.seed(makeUser({ id: 5, role: "admin", email: "other-admin@example.com" }));

    const res = await ctx.req("/api/admin/users/5/generate-login-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(409);
    expect(ctx.authRepo.stored).toHaveLength(0);
  });

  it("returns 404 for a non-existent target", async () => {
    const res = await ctx.req("/api/admin/users/99999/generate-login-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(404);
  });

  it("rejects deactivated staff targets", async () => {
    ctx.userRepo.seed(makeUser({ id: 5, isActive: false }));

    const res = await ctx.req("/api/admin/users/5/generate-login-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(409);
    expect(ctx.authRepo.stored).toHaveLength(0);
  });

  it("requires an admin JWT", async () => {
    const staffJwt = await staffToken(10, "staff@example.test");

    const res = await ctx.req("/api/admin/users/5/generate-login-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// Tests: POST /api/staff/registrations/:id/upload-proof (R10)
// =============================================================================

describe("POST /api/staff/registrations/:id/upload-proof", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("uploads proof for a registration with a payment_pending payment — returns 200 with pending_verification status", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, regCode: "SMRTTESTCODE0001", status: "pending" }));
    ctx.paymentRepo.seed(makePayment({ id: 5, registrationId: 1001, status: "payment_pending", proofFileKey: null }));

    const token = await staffToken(10, "staff@example.test");

    // Build a minimal multipart form
    const formData = new FormData();
    const fileBlob = new Blob(["fake image bytes"], { type: "image/jpeg" });
    formData.append("file", fileBlob, "receipt.jpg");

    const res = await ctx.req("/api/staff/registrations/1001/upload-proof", {
      method: "POST",
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; message: string };
    expect(body.status).toBe("pending_verification");
  });

  it("returns 404 for a non-existent registration", async () => {
    const token = await staffToken();
    const formData = new FormData();
    const fileBlob = new Blob(["bytes"], { type: "image/jpeg" });
    formData.append("file", fileBlob, "proof.jpg");

    const res = await ctx.req("/api/staff/registrations/99999/upload-proof", {
      method: "POST",
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it("returns 409 when no payment_pending payment exists for the registration", async () => {
    // Seed a registration with a payment already in pending_verification (not payment_pending)
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, status: "pending_verification" }));
    ctx.paymentRepo.seed(makePayment({ id: 3, registrationId: 1001, status: "pending_verification" }));

    const token = await staffToken();
    const formData = new FormData();
    const fileBlob = new Blob(["bytes"], { type: "image/jpeg" });
    formData.append("file", fileBlob, "proof.jpg");

    const res = await ctx.req("/api/staff/registrations/1001/upload-proof", {
      method: "POST",
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
  });

  it("audit entry uses action proof_uploaded_by_staff with staff email as actor", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, regCode: "SMRTTESTCODE0001", status: "pending" }));
    ctx.paymentRepo.seed(makePayment({ id: 5, registrationId: 1001, status: "payment_pending", proofFileKey: null }));

    const token = await staffToken(10, "staff@example.test");
    const formData = new FormData();
    const fileBlob = new Blob(["fake image bytes"], { type: "image/jpeg" });
    formData.append("file", fileBlob, "receipt.jpg");

    await ctx.req("/api/staff/registrations/1001/upload-proof", {
      method: "POST",
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
    });

    const auditEntry = ctx.auditRepo.entries.find((e) => e.action === "proof_uploaded_by_staff");
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.actor).toBe("staff@example.test");
  });
});

// =============================================================================
// Tests: GET /api/staff/my-registration (R11)
// =============================================================================

describe("GET /api/staff/my-registration", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("returns registration data when staff email matches a registration", async () => {
    ctx.registrationRepo.seed(
      makeRegistration({ id: 1001, email: "staff@example.test", regCode: "SMRTTESTCODE0001" }),
    );

    const token = await staffToken(10, "staff@example.test");
    const res = await ctx.req("/api/staff/my-registration", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { registration: { regCode: string } };
    expect(body.registration.regCode).toBe("SMRTTESTCODE0001");
  });

  it("returns 404 when staff email does not match any registration", async () => {
    // No registration seeded for this email
    const token = await staffToken(10, "noregistration@example.test");
    const res = await ctx.req("/api/staff/my-registration", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("No registration found for your email");
  });
});

// =============================================================================
// Tests: Deactivated user JWT still works (R11 / JWT stateless)
// =============================================================================

describe("Deactivated user JWT still valid on staff routes (JWT is stateless)", () => {
  it("staff JWT continues to authorize after the user is deactivated via PATCH", async () => {
    const ctx = createTestApp();
    const adminJwt = await adminToken(99, "admin@example.test");

    // Seed the staff user and the admin
    ctx.userRepo.seed(makeUser({ id: 20, email: "willbedisabled@example.com", role: "staff" }));
    ctx.userRepo.seed(makeUser({ id: 99, email: "admin@example.test", role: "admin" }));
    ctx.registrationRepo.seed(makeRegistration({ id: 2001 }));

    // Sign a staff JWT before deactivation
    const staffJwt = await staffToken(20, "willbedisabled@example.com");

    // Deactivate the staff user via admin API
    await ctx.req("/api/admin/users/20", {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    // Verify user is now deactivated in the repo
    const user = await ctx.userRepo.findById(20);
    expect(user?.isActive).toBe(false);

    // The original JWT must still grant access — deactivation only blocks NEW tokens
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// Tests: 409 for verify/reject when payment is wrong status (R8.2, R9.2)
// =============================================================================

describe("POST /api/staff/payments/:id/verify — 409 when not pending_verification (R8.2)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("returns 409 when payment status is 'verified' (not pending_verification)", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, status: "confirmed" }));
    ctx.paymentRepo.seed(makePayment({ id: 1, registrationId: 1001, status: "verified" }));

    const token = await staffToken();
    const res = await ctx.req("/api/staff/payments/1/verify", {
      method: "POST",
      body: JSON.stringify({ referenceId: "REF123", actualAmount: 8500 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBeDefined();
  });

  it("returns 409 when payment status is 'payment_pending' (not pending_verification)", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, status: "pending" }));
    ctx.paymentRepo.seed(makePayment({ id: 2, registrationId: 1001, status: "payment_pending" }));

    const token = await staffToken();
    const res = await ctx.req("/api/staff/payments/2/verify", {
      method: "POST",
      body: JSON.stringify({ referenceId: "REF456", actualAmount: 8500 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
  });
});

describe("POST /api/staff/payments/:id/reject — 409 when not pending_verification (R9.2)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("returns 409 when payment status is 'verified'", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, status: "confirmed" }));
    ctx.paymentRepo.seed(makePayment({ id: 1, registrationId: 1001, status: "verified" }));

    const token = await staffToken();
    const res = await ctx.req("/api/staff/payments/1/reject", {
      method: "POST",
      body: JSON.stringify({ comment: "Wrong" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
  });

  it("returns 409 when payment status is 'payment_pending'", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, status: "pending" }));
    ctx.paymentRepo.seed(makePayment({ id: 2, registrationId: 1001, status: "payment_pending" }));

    const token = await staffToken();
    const res = await ctx.req("/api/staff/payments/2/reject", {
      method: "POST",
      body: JSON.stringify({ comment: "Wrong" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
  });
});

// =============================================================================
// Tests: Full detail response shape (R7.1)
// =============================================================================

describe("GET /api/staff/registrations/:id — full detail response shape (R7.1)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("response contains all five top-level keys: registration, attendees, payments, documents, audit", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001, fullName: "Shape Test" }));
    ctx.paymentRepo.seed(makePayment({ id: 1, registrationId: 1001, status: "pending_verification" }));

    const token = await staffToken(10, "staff@example.test");
    const res = await ctx.req("/api/staff/registrations/1001", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.registration).toBeDefined();
    expect(body.attendees).toBeDefined();
    expect(body.payments).toBeDefined();
    expect(body.documents).toBeDefined();
    expect(body.audit).toBeDefined();
    expect(Array.isArray(body.attendees)).toBe(true);
    expect(Array.isArray(body.payments)).toBe(true);
    expect(Array.isArray(body.documents)).toBe(true);
    expect(Array.isArray(body.audit)).toBe(true);

    // Registration object must include key fields
    const reg = body.registration as Record<string, unknown>;
    expect(reg.id).toBe(1001);
    expect(reg.fullName).toBe("Shape Test");
    expect(reg.regCode).toBeDefined();
    expect(reg.status).toBeDefined();
    expect(reg.email).toBeDefined();
  });

  it("payments array contains the seeded payment with its fields", async () => {
    ctx.registrationRepo.seed(makeRegistration({ id: 1001 }));
    ctx.paymentRepo.seed(makePayment({ id: 7, registrationId: 1001, status: "pending_verification", amount: 12000 }));

    const token = await staffToken();
    const res = await ctx.req("/api/staff/registrations/1001", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json() as { payments: Array<{ id: number; amount: number; status: string }> };
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].id).toBe(7);
    expect(body.payments[0].amount).toBe(12000);
    expect(body.payments[0].status).toBe("pending_verification");
  });
});

// =============================================================================
// Tests: 403 body text (R1.3, R2.1)
// =============================================================================

describe("403 response body contains Insufficient permissions (R1.3, R2.1)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("attendee JWT on staff route returns 403 with correct error body", async () => {
    const token = await attendeeToken(1001);
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Insufficient permissions");
  });

  it("staff JWT on admin route returns 403 with correct error body", async () => {
    const token = await staffToken();
    const res = await ctx.req("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Insufficient permissions");
  });
});

// =============================================================================
// Tests: Staff welcome email after creation (R14.5)
// =============================================================================

describe("POST /api/admin/users — staff welcome email (R14.5)", () => {
  let ctx: TestContext;
  let adminJwt: string;

  beforeEach(async () => {
    ctx = createTestApp();
    adminJwt = await adminToken(99, "admin@example.test");
  });

  it("sends a magic-link email to the newly created staff member's address", async () => {
    const newEmail = "brandnewstaff@example.com";

    await ctx.req("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: newEmail, name: "Brand New Staff", role: "staff" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    // The authService sends a magic-link email as part of the invite flow (requestMagicLink)
    const inviteEmail = ctx.emailService.calls.find(
      (c) => c.type === "magic-link" && c.to === newEmail,
    );
    expect(inviteEmail).toBeDefined();
  });
});

// =============================================================================
// Tests: Re-upload cycle after rejection (R6.6)
// =============================================================================

describe("Re-upload cycle: reject → payment_pending → upload → pending_verification", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  it("after rejection, a new upload moves payment back to pending_verification", async () => {
    const reg = makeRegistration({ id: 1001, regCode: "SMRTTESTCODE0001", status: "pending_verification" });
    ctx.registrationRepo.seed(reg);
    ctx.paymentRepo.seed(makePayment({ id: 1, registrationId: 1001, status: "pending_verification" }));

    const staffJwt = await staffToken(10, "staff@example.test");

    // Step 1: Reject the payment — moves it to payment_pending
    const rejectRes = await ctx.req("/api/staff/payments/1/reject", {
      method: "POST",
      body: JSON.stringify({ comment: "Proof is blurry" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(rejectRes.status).toBe(200);

    // Confirm the payment is now payment_pending in the repo
    const paymentAfterReject = await ctx.paymentRepo.findById(1);
    expect(paymentAfterReject?.status).toBe("payment_pending");

    // Step 2: Staff uploads a new proof — should succeed since status is now payment_pending
    const formData = new FormData();
    const fileBlob = new Blob(["new clear image bytes"], { type: "image/jpeg" });
    formData.append("file", fileBlob, "clear-receipt.jpg");

    const uploadRes = await ctx.req("/api/staff/registrations/1001/upload-proof", {
      method: "POST",
      body: formData,
      headers: { Authorization: `Bearer ${staffJwt}` },
    });
    expect(uploadRes.status).toBe(200);
    const uploadBody = await uploadRes.json() as { status: string };
    expect(uploadBody.status).toBe("pending_verification");

    // Confirm the payment is back to pending_verification
    const paymentAfterReupload = await ctx.paymentRepo.findById(1);
    expect(paymentAfterReupload?.status).toBe("pending_verification");
  });
});

// =============================================================================
// Tests: Public auth endpoints work without token (R9.1)
// =============================================================================

describe("Public auth endpoints — no Authorization header required", () => {
  let ctx: TestContext;

  beforeEach(() => {
    clearRateLimitStore();
    ctx = createTestApp();
  });

  it("POST /api/auth/magic-link works without any Authorization header", async () => {
    ctx.userRepo.seed(makeUser({ id: 10, email: "staff@example.test" }));

    // No Authorization header set
    const res = await ctx.req("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: "staff@example.test" }),
      headers: { "Content-Type": "application/json" },
    });

    // Must not be 401 — auth is not required for this endpoint
    expect(res.status).toBe(200);
  });

  it("GET /api/auth/verify works without any Authorization header (invalid token returns 401, not 403)", async () => {
    // No Authorization header — endpoint processes query param only
    const res = await ctx.req("/api/auth/verify?token=some-nonexistent-token");

    // Should get 401 (bad token), not 403 (missing auth). 403 would mean the
    // authMiddleware is wrongly guarding this route.
    expect(res.status).not.toBe(403);
    // 401 is expected for an invalid token on an unguarded endpoint
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Tests: PATCH ignores role/email fields (R16.2)
// =============================================================================

describe("PATCH /api/admin/users/:id — ignores role and email fields (R16.2)", () => {
  let ctx: TestContext;
  let adminJwt: string;

  beforeEach(async () => {
    ctx = createTestApp();
    adminJwt = await adminToken(99, "admin@example.test");
    ctx.userRepo.seed(
      makeUser({ id: 5, email: "original@example.com", name: "Original Name", role: "staff" }),
    );
  });

  it("sending role and email in body does not change the user's role or email", async () => {
    const res = await ctx.req("/api/admin/users/5", {
      method: "PATCH",
      body: JSON.stringify({ role: "admin", email: "hacker@evil.com", name: "Legit Update" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminJwt}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { role: string; email: string; name: string };

    // role must remain 'staff' — the route only processes 'name' and 'isActive'
    expect(body.role).toBe("staff");
    // email must remain unchanged
    expect(body.email).toBe("original@example.com");
    // name update was legit and should have gone through
    expect(body.name).toBe("Legit Update");
  });
});

// =============================================================================
// Tests: requireScope fail-closed on missing row / malformed permissions
// (access-control.spec.md R3.5, R4.4; edge cases "Deleted user with valid JWT"
// and "Malformed permissions JSON")
// =============================================================================

/**
 * D1 fake with MISSING-ROW semantics and a query counter.
 *
 * createFakePermissionsDb() returns a `{ permissions: null }` row for every
 * userId, so it cannot simulate a deleted user (no row at all). This fake
 * returns `null` from first() when the id is absent — the R3.5 deleted-user
 * case — and counts queries so cache behavior (R4.4) is observable.
 */
function createScopeProbeDb(rows: Record<number, string | null>) {
  const table = new Map<number, string | null>(
    Object.entries(rows).map(([id, permissions]) => [Number(id), permissions]),
  );
  let queries = 0;
  const db = {
    prepare(_sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          async first<T>(): Promise<T | null> {
            queries++;
            const id = args[0] as number;
            if (!table.has(id)) return null; // no users row — deleted user
            return { permissions: table.get(id) ?? null } as T;
          },
        }),
      };
    },
  };
  return { db, queryCount: () => queries };
}

describe("requireScope fail-closed on missing/malformed data (R3.5, R4.4)", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestApp();
    ctx.registrationRepo.seed(makeRegistration());
  });

  function envWith(db: unknown) {
    return { JWT_SECRET: TEST_JWT_SECRET, DB: db } as unknown as import("../env.js").Env;
  }

  it("returns 403 when the users row is missing (deleted user with valid JWT) and WARN-logs the userId", async () => {
    const { db } = createScopeProbeDb({}); // no rows at all
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const token = await staffToken(42, "ghost@example.test");
      const res = await ctx.app.request(
        "/api/staff/dashboard",
        { headers: { Authorization: `Bearer ${token}` } },
        envWith(db),
      );

      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Insufficient permissions");

      // WARN entry carries the userId and the reason (missing row)
      const warnLines = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(
        warnLines.some((l) => l.includes('"userId":42') && l.includes("no user row")),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns 403 when permissions JSON is malformed and WARN-logs the userId and reason", async () => {
    const { db } = createScopeProbeDb({ 43: "{not-valid-json" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const token = await staffToken(43, "corrupted@example.test");
      const res = await ctx.app.request(
        "/api/staff/dashboard",
        { headers: { Authorization: `Bearer ${token}` } },
        envWith(db),
      );

      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Insufficient permissions");

      const warnLines = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(
        warnLines.some((l) => l.includes('"userId":43') && l.includes("malformed permissions JSON")),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("admin bypasses the missing-row case — still 200, no scope lookup at all (R2.2)", async () => {
    const { db, queryCount } = createScopeProbeDb({}); // admin has no users row either
    const token = await adminToken(77, "admin@example.test");
    const res = await ctx.app.request(
      "/api/staff/dashboard",
      { headers: { Authorization: `Bearer ${token}` } },
      envWith(db),
    );

    expect(res.status).toBe(200);
    // Admin short-circuits before resolveScopes — the DB is never queried
    expect(queryCount()).toBe(0);
  });

  it("admin bypasses the malformed-JSON case — still 200 (R2.2)", async () => {
    const { db } = createScopeProbeDb({ 78: "{broken" });
    const token = await adminToken(78, "admin@example.test");
    const res = await ctx.app.request(
      "/api/staff/dashboard",
      { headers: { Authorization: `Bearer ${token}` } },
      envWith(db),
    );

    expect(res.status).toBe(200);
  });

  it("caches [] after a missing-row hit — second request 403s without re-querying the DB (R4.4)", async () => {
    const { db, queryCount } = createScopeProbeDb({});
    const token = await staffToken(44, "ghost2@example.test");
    const headers = { Authorization: `Bearer ${token}` };

    const res1 = await ctx.app.request("/api/staff/dashboard", { headers }, envWith(db));
    expect(res1.status).toBe(403);
    expect(queryCount()).toBe(1);

    // The cache holds the corrected [] — not null (full access)
    expect(_scopeCache.get(44)?.scopes).toEqual([]);

    const res2 = await ctx.app.request("/api/staff/dashboard", { headers }, envWith(db));
    expect(res2.status).toBe(403);
    expect(queryCount()).toBe(1); // served from cache, no second query
  });

  it("explicit NULL permissions on an EXISTING row keeps full access (R2.1 — unscoped staff default)", async () => {
    const { db } = createScopeProbeDb({ 45: null }); // row exists, permissions IS NULL
    const token = await staffToken(45, "unscoped@example.test");
    const res = await ctx.app.request(
      "/api/staff/dashboard",
      { headers: { Authorization: `Bearer ${token}` } },
      envWith(db),
    );

    expect(res.status).toBe(200);
  });
});
