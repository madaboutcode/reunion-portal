/**
 * Payment-link flow tests.
 *
 * Covers:
 *   - POST /auth/payment-link endpoint (valid / unknown / rate-limited / malformed)
 *   - AuthService.createPaymentLinkUrl — token stored, expiry ≈ now+4h
 *   - AuthService.requestPaymentLink — email sent with /pay/{regCode}?code=, rate limit
 *   - End-to-end: token in emailed URL verifies via existing GET /api/auth/verify → attendee JWT
 *   - POST /registrations/:regCode/pay/upload-proof — missing auth → 401,
 *     wrong registration → 403, valid matching token → 200
 *
 * @module payment-link.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type {
  Registration,
  MagicLink,
  NewPayment,
  NewAttendee,
  NewIdDocument,
  Payment,
  GatewayData,
  AuditEntry,
  NewAuditEntry,
  FileMetadata,
  IdDocument,
} from "../domain/types.js";
import type {
  IAuthRepository,
  IRegistrationRepository,
  IEmailService,
  ISystemAuditRepository,
  PaymentLinkEmailData,
  IPaymentRepository,
  IAuditRepository,
  IDocumentRepository,
  IFileStorage,
  IAttendeeRepository,
} from "../repositories/interfaces.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type { AppEnv } from "../env.js";
import { AuthService } from "../services/auth.service.js";
import { PaymentService } from "../services/payment.service.js";
import { unusedD1 } from "./helpers/minimal-d1.js";
import { RegistrationService } from "../services/registration.service.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PricingService } from "../services/pricing.service.js";
import { authRoutes } from "../routes/auth.routes.js";
import { paymentRoutes } from "../routes/payment.routes.js";
import { handleError } from "../middleware/error.middleware.js";
import { clearRateLimitStore } from "../middleware/rate-limit.js";
import { signToken, verifyToken } from "../infra/jwt.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";

const stubAvailabilityService = { isAccommodationAvailable: async () => true } as unknown as AvailabilityService;

// =============================================================================
// Observable fakes (same pattern as auth.service.test.ts)
// =============================================================================

interface StoredMagicLink {
  tokenHash: string;
  expiresAt: number;
  identity: { registrationId: number } | { userId: number };
}

function makeAuthRepo(
  overrides: Partial<IAuthRepository> & { storedLinks?: StoredMagicLink[] } = {},
): IAuthRepository & { stored: StoredMagicLink[]; markedUsed: number[]; recentCount: number } {
  const stored: StoredMagicLink[] = overrides.storedLinks ?? [];
  const markedUsed: number[] = [];
  let recentCount = 0;

  return {
    stored,
    markedUsed,
    get recentCount() { return recentCount; },
    set recentCount(v) { recentCount = v; },
    createMagicLink: async (tokenHash, expiresAt, identity) => {
      stored.push({ tokenHash, expiresAt, identity });
    },
    findValidMagicLink: overrides.findValidMagicLink ?? (async () => null),
    markUsed: overrides.markUsed ?? (async (id: number) => { markedUsed.push(id); return true; }),
    cleanExpired: async () => {},
    countRecentLinks: overrides.countRecentLinks ?? (async () => recentCount),
  };
}

interface PaymentLinkCall {
  to: string;
  data: PaymentLinkEmailData;
}

function makeEmailService(): IEmailService & { paymentLinkCalls: PaymentLinkCall[] } {
  const paymentLinkCalls: PaymentLinkCall[] = [];
  return {
    paymentLinkCalls,
    sendConfirmation: async () => {},
    sendMagicLink: async () => {},
    sendPaymentConfirmed: async () => {},
    sendPaymentRejected: async () => {},
    sendStaffWelcome: async () => {},
    sendPaymentLink: async (to, data) => { paymentLinkCalls.push({ to, data }); },
    sendRevisedPayment: async () => {},
    sendAdditionalPayment: async () => {},
    sendStoryHidden: async () => {},
  };
}

function makeSystemAuditRepo(): ISystemAuditRepository {
  return { append: async () => {} };
}

function makeUserRepo() {
  return {
    create: async () => ({ id: 1 }),
    findById: async () => null,
    findByEmail: async () => null,
    list: async () => [],
    update: async () => {},
  };
}

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1001,
    regCode: "SMRTTEST12345678",
    status: "pending",
    fullName: "Test User",
    branch: "Computer Science & Engineering",
    email: "test@example.com",
    whatsapp: "+919999999999",
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
    pricingSnapshot: { base: 0, lines: [], donation: 0, collegeContribution: 0, total: 0 },
    totalAmount: 0,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeRegistrationRepo(registrations: Registration[] = []): IRegistrationRepository & {
  companionAttendeeRepo?: { replaceForRegistration(id: number, attendees: NewAttendee[]): Promise<void> };
  companionPaymentRepo?: { create(payment: NewPayment): Promise<{ id: number }> };
  companionDocumentRepo?: { create(doc: NewIdDocument): Promise<{ id: number }> };
} {
  return {
    createWithRelations: async () => ({ id: 1 }),
    findById: async (id) => registrations.find(r => r.id === id) ?? null,
    findByRegCode: async (code) => registrations.find(r => r.regCode === code) ?? null,
    findByEmail: async (email) => registrations.filter(r => r.email === email),
    findByWhatsapp: async () => [],
    updateStatus: async () => {},
    update: async () => {},
    list: async () => registrations,
    count: async () => registrations.length,
    countByStatus: async () => ({ pending: 0, pendingVerification: 0, confirmed: 0 }),
    geographyAggregates: async () => ({ cities: [], countries: [] }),
    donorRecognitionRows: async (_felicitationThreshold: number) => ({ publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 }),
    getContributionAggregates: async () => [],
    countByParticipationAndStatus: async () => {
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
    },
    getDonationTotals: async () => ({ count: 0, total: 0 }),
    findMissingThumbnails: async () => [],
    findWithThumbnails: async () => [],
    updateWithLock: async () => {},
  };
}

function makeMagicLink(overrides: Partial<MagicLink> = {}): MagicLink {
  return {
    id: 1,
    tokenHash: "abc123",
    registrationId: null,
    userId: null,
    expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    usedAt: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

const JWT_SECRET = "test-secret-payment-link-tests";
const BASE_URL = "https://example.com";

function makeService(deps: {
  userRepo?: ReturnType<typeof makeUserRepo>;
  registrationRepo?: IRegistrationRepository;
  authRepo?: IAuthRepository;
  emailService?: IEmailService;
  systemAuditRepo?: ISystemAuditRepository;
}) {
  return new AuthService({
    userRepo: deps.userRepo ?? makeUserRepo(),
    registrationRepo: deps.registrationRepo ?? makeRegistrationRepo(),
    authRepo: deps.authRepo ?? makeAuthRepo(),
    emailService: deps.emailService ?? makeEmailService(),
    systemAuditRepo: deps.systemAuditRepo ?? makeSystemAuditRepo(),
    jwtSecret: JWT_SECRET,
    baseUrl: BASE_URL,
  });
}

// =============================================================================
// 1. createPaymentLinkUrl
// =============================================================================

describe("AuthService.createPaymentLinkUrl", () => {
  it("returns a URL of the form {baseUrl}/pay/{regCode}?code={rawToken}", async () => {
    const authRepo = makeAuthRepo();
    const svc = makeService({ authRepo });

    const url = await svc.createPaymentLinkUrl(1001, "SMRTTEST12345678");

    expect(url).toMatch(/^https:\/\/example\.com\/pay\/SMRTTEST12345678\?code=/);
  });

  it("GUARANTEE: TOKEN_HASHED — raw token in URL is not what's stored in DB", async () => {
    const authRepo = makeAuthRepo();
    const svc = makeService({ authRepo });

    const url = await svc.createPaymentLinkUrl(1001, "SMRTTEST12345678");

    const rawToken = new URL(url).searchParams.get("code")!;
    expect(rawToken).toBeTruthy();

    const storedHash = authRepo.stored[0].tokenHash;
    expect(storedHash).not.toEqual(rawToken);
    // SHA-256 hex = 64 chars
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("GUARANTEE: PAYMENT_LINK_EXPIRY — stored expiresAt ≈ now + 24h (within 2s tolerance)", async () => {
    const authRepo = makeAuthRepo();
    const svc = makeService({ authRepo });

    const before = Date.now();
    await svc.createPaymentLinkUrl(1001, "SMRTTEST12345678");
    const after = Date.now();

    const { expiresAt } = authRepo.stored[0];
    const expectedMin = before + 24 * 60 * 60 * 1000;
    const expectedMax = after + 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin - 2000);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax + 2000);
  });

  it("stores the magic link as registrationId identity (not userId)", async () => {
    const authRepo = makeAuthRepo();
    const svc = makeService({ authRepo });

    await svc.createPaymentLinkUrl(1234, "SMRTTEST12345678");

    expect(authRepo.stored).toHaveLength(1);
    expect(authRepo.stored[0].identity).toEqual({ registrationId: 1234 });
  });
});

// =============================================================================
// 2. requestPaymentLink
// =============================================================================

describe("AuthService.requestPaymentLink", () => {
  describe("GUARANTEE: PAYMENT_LINK_ENUMERATION_SAFE — always returns void", () => {
    it("returns void for an unknown regCode", async () => {
      const svc = makeService({});
      const result = await svc.requestPaymentLink("SMRTUNKNOWN12345");
      expect(result).toBeUndefined();
    });

    it("returns void for a valid regCode", async () => {
      const reg = makeRegistration({ regCode: "SMRTTEST12345678" });
      const svc = makeService({ registrationRepo: makeRegistrationRepo([reg]) });
      const result = await svc.requestPaymentLink("SMRTTEST12345678");
      expect(result).toBeUndefined();
    });

    it("returns void when rate limited", async () => {
      const reg = makeRegistration({ regCode: "SMRTTEST12345678" });
      const authRepo = makeAuthRepo();
      authRepo.recentCount = 3; // already at limit
      const svc = makeService({ registrationRepo: makeRegistrationRepo([reg]), authRepo });
      const result = await svc.requestPaymentLink("SMRTTEST12345678");
      expect(result).toBeUndefined();
    });
  });

  it("sends payment link email when regCode found", async () => {
    const reg = makeRegistration({ regCode: "SMRTTEST12345678", email: "test@example.com" });
    const emailService = makeEmailService();
    const svc = makeService({ registrationRepo: makeRegistrationRepo([reg]), emailService });

    await svc.requestPaymentLink("SMRTTEST12345678");

    expect(emailService.paymentLinkCalls).toHaveLength(1);
    expect(emailService.paymentLinkCalls[0].to).toBe("test@example.com");
  });

  it("emailed link contains /pay/{regCode}?code= pattern", async () => {
    const reg = makeRegistration({ regCode: "SMRTTEST12345678" });
    const emailService = makeEmailService();
    const svc = makeService({ registrationRepo: makeRegistrationRepo([reg]), emailService });

    await svc.requestPaymentLink("SMRTTEST12345678");

    const { link } = emailService.paymentLinkCalls[0].data;
    expect(link).toContain("/pay/SMRTTEST12345678?code=");
  });

  it("link expiresInHours is 24", async () => {
    const reg = makeRegistration({ regCode: "SMRTTEST12345678" });
    const emailService = makeEmailService();
    const svc = makeService({ registrationRepo: makeRegistrationRepo([reg]), emailService });

    await svc.requestPaymentLink("SMRTTEST12345678");

    expect(emailService.paymentLinkCalls[0].data.expiresInHours).toBe(24);
  });

  it("normalises regCode — strips dashes, trims, uppercases before lookup", async () => {
    const reg = makeRegistration({ regCode: "SMRTTEST12345678" });
    const emailService = makeEmailService();
    const svc = makeService({ registrationRepo: makeRegistrationRepo([reg]), emailService });

    // Input with dashes and lowercase — should still find the registration
    await svc.requestPaymentLink("smrt-test-1234-5678");

    expect(emailService.paymentLinkCalls).toHaveLength(1);
  });

  it("does NOT send email when regCode unknown", async () => {
    const emailService = makeEmailService();
    const svc = makeService({ emailService });

    await svc.requestPaymentLink("SMRTUNKNOWN12345");

    expect(emailService.paymentLinkCalls).toHaveLength(0);
  });

  it("does NOT send email on 4th request within 10 minutes (rate limited)", async () => {
    const reg = makeRegistration({ regCode: "SMRTTEST12345678" });
    const emailService = makeEmailService();
    const authRepo = makeAuthRepo();
    authRepo.recentCount = 3; // already 3 recent links
    const svc = makeService({
      registrationRepo: makeRegistrationRepo([reg]),
      emailService,
      authRepo,
    });

    await svc.requestPaymentLink("SMRTTEST12345678");

    // Still returns 200-equivalent (void), no email
    expect(emailService.paymentLinkCalls).toHaveLength(0);
  });

  it("sends email on 3rd request (not yet rate limited)", async () => {
    const reg = makeRegistration({ regCode: "SMRTTEST12345678" });
    const emailService = makeEmailService();
    const authRepo = makeAuthRepo();
    authRepo.recentCount = 2; // 2 recent — 3rd is allowed
    const svc = makeService({
      registrationRepo: makeRegistrationRepo([reg]),
      emailService,
      authRepo,
    });

    await svc.requestPaymentLink("SMRTTEST12345678");

    expect(emailService.paymentLinkCalls).toHaveLength(1);
  });

  it("invalid format (not starting with SMRT) returns silently — no email", async () => {
    const emailService = makeEmailService();
    const svc = makeService({ emailService });

    await svc.requestPaymentLink("INVALIDFORMAT1234");

    expect(emailService.paymentLinkCalls).toHaveLength(0);
  });

  it("invalid format (wrong length) returns silently — no email", async () => {
    const emailService = makeEmailService();
    const svc = makeService({ emailService });

    await svc.requestPaymentLink("SMRT123");

    expect(emailService.paymentLinkCalls).toHaveLength(0);
  });
});

// =============================================================================
// 3. End-to-end: token in emailed URL verifies via verifyMagicLink → attendee JWT
// =============================================================================

describe("Payment link end-to-end: emailed token verifies as attendee JWT", () => {
  it("token extracted from emailed URL verifies successfully and yields attendee JWT", async () => {
    const reg = makeRegistration({ id: 1001, regCode: "SMRTTEST12345678", status: "pending" });
    const emailService = makeEmailService();

    // authRepo that can actually verify links
    const stored: StoredMagicLink[] = [];
    const authRepo: IAuthRepository & { stored: StoredMagicLink[]; markedUsed: number[] } = {
      stored,
      markedUsed: [],
      createMagicLink: async (tokenHash, expiresAt, identity) => {
        stored.push({ tokenHash, expiresAt, identity });
      },
      findValidMagicLink: async (tokenHash) => {
        const link = stored.find(l => l.tokenHash === tokenHash);
        if (!link) return null;
        if (link.expiresAt < Date.now()) return null;
        const id = 'registrationId' in link.identity
          ? link.identity.registrationId
          : null;
        return makeMagicLink({
          id: 42,
          tokenHash: link.tokenHash,
          registrationId: id,
          userId: null,
          expiresAt: link.expiresAt,
          usedAt: null,
        });
      },
      markUsed: async (id: number) => { authRepo.markedUsed.push(id); return true; },
      cleanExpired: async () => {},
      countRecentLinks: async () => 0,
    };

    const svc = makeService({
      registrationRepo: makeRegistrationRepo([reg]),
      authRepo,
      emailService,
    });

    // Step 1: request a payment link
    await svc.requestPaymentLink("SMRTTEST12345678");

    expect(emailService.paymentLinkCalls).toHaveLength(1);
    const { link } = emailService.paymentLinkCalls[0].data;

    // Step 2: extract the raw token from the emailed URL
    const url = new URL(link);
    const rawToken = url.searchParams.get("code")!;
    expect(rawToken).toBeTruthy();

    // Step 3: verify the raw token — should yield an attendee JWT
    const result = await svc.verifyMagicLink(rawToken);

    expect(result.role).toBe("attendee");
    expect(result.sub).toBe(String(reg.id));

    const payload = await verifyToken(result.jwt, JWT_SECRET);
    expect(payload.role).toBe("attendee");
    expect(payload.sub).toBe(String(reg.id));
  });
});

// =============================================================================
// 4. Token expiry: expiresAt stored is ≈ now + 24h
// =============================================================================

describe("Payment link token expiry (24h)", () => {
  it("expiresAt is approximately 24h from now when createPaymentLinkUrl is called", async () => {
    const authRepo = makeAuthRepo();
    const svc = makeService({ authRepo });

    const before = Date.now();
    await svc.createPaymentLinkUrl(1001, "SMRTTEST12345678");
    const after = Date.now();

    const { expiresAt } = authRepo.stored[0];
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + twentyFourHoursMs - 2000);
    expect(expiresAt).toBeLessThanOrEqual(after + twentyFourHoursMs + 2000);
  });
});

// =============================================================================
// 5. HTTP-level tests: POST /api/auth/payment-link and upload-proof auth
// =============================================================================

// ---------------------------------------------------------------------------
// In-memory fakes for HTTP tests
// ---------------------------------------------------------------------------

class HttpTestRegistrationRepo implements IRegistrationRepository {
  private regs: Map<number, Registration> = new Map();

  seed(reg: Registration): void { this.regs.set(reg.id, reg); }

  async createWithRelations(_insertSet: RegistrationInsertSet): Promise<{ id: number }> { return { id: 1 }; }
  async findById(id: number): Promise<Registration | null> { return this.regs.get(id) ?? null; }
  async findByRegCode(code: string): Promise<Registration | null> {
    for (const r of this.regs.values()) { if (r.regCode === code) return r; }
    return null;
  }
  async findByEmail(email: string): Promise<Registration[]> {
    return [...this.regs.values()].filter(r => r.email === email);
  }
  async findByWhatsapp(): Promise<Registration[]> { return []; }
  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    const r = this.regs.get(id);
    if (r) r.status = status;
  }
  async update(): Promise<void> {}
  async list(): Promise<Registration[]> { return [...this.regs.values()]; }
  async count(): Promise<number> { return this.regs.size; }
  async countByStatus(): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
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

class HttpTestPaymentRepo implements IPaymentRepository {
  private payments: Map<number, Payment> = new Map();
  private nextId = 1;

  seed(p: Payment): void { this.payments.set(p.id, p); }

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

  async findById(id: number): Promise<Payment | null> { return this.payments.get(id) ?? null; }
  async findByRegistration(regId: number): Promise<Payment[]> {
    return [...this.payments.values()].filter(p => p.registrationId === regId).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  }
  async updateStatus(id: number, status: PaymentStatus, _gd?: GatewayData, _pfk?: string): Promise<void> {
    const p = this.payments.get(id);
    if (p) { p.status = status; p.updatedAt = Date.now(); }
  }
  async sumVerified(): Promise<number> { return 0; }
  async sumVerifiedByBranch(): Promise<Array<{ branch: string; collected: number }>> { return []; }
  async verify(_id: number, _amount: number, _gatewayRef: string, _verifiedBy: string, _verifiedAt: number): Promise<void> {}
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(_registrationId: number): Promise<Payment | null> { return null; }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async sumVerifiedByRegistration(_registrationId: number): Promise<number> { return 0; }
}

class HttpTestAuditRepo implements IAuditRepository {
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

  async findByRegistration(regId: number): Promise<AuditEntry[]> {
    return this.entries.filter(e => e.registrationId === regId);
  }
}

class StubAttendeeRepo implements IAttendeeRepository {
  async findByRegistration(): Promise<[]> { return []; }
  async replaceForRegistration(): Promise<void> {}
  async countGrouped(): Promise<[]> { return []; }
  async accommodationByNight(_f?: { statuses?: string[]; branch?: string }): Promise<Record<string, { private: number; privateByGender: { male: number; female: number; other: number }; shared_double: { count: number; rooms: number }; shared_doubleByGender: { male: number; female: number; other: number }; shared_triple: { count: number; rooms: number }; shared_tripleByGender: { male: number; female: number; other: number }; extraBeds: number }>> { return { '2026-08-14': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 }, '2026-08-15': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 } }; }
  async mealsByParticipationType(_f?: { statuses?: string[]; branch?: string }): Promise<{ campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } }> { return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } }; }
  async childrenByAgeBand(_f?: { statuses?: string[]; branch?: string }): Promise<{ under6: number; age6to12: number; age12plus: number }> { return { under6: 0, age6to12: 0, age12plus: 0 }; }
}

class StubDocumentRepo implements IDocumentRepository {
  async create(): Promise<{ id: number }> { return { id: 1 }; }
  async findByRegistration(): Promise<IdDocument[]> { return []; }
  async updateR2Key(): Promise<void> {}
}

class StubFileStorage implements IFileStorage {
  async upload(_key: string, _data: ArrayBuffer, _meta: FileMetadata): Promise<void> {}
  async getSignedUrl(): Promise<string> { throw new Error("not implemented"); }
  async get(): Promise<null> { return null; }
  async delete(): Promise<void> {}
  async copy(): Promise<boolean> { return true; }
  async move(): Promise<void> {}
}

class TrackingEmailService implements IEmailService {
  paymentLinkCalls: Array<{ to: string; data: PaymentLinkEmailData }> = [];
  async sendConfirmation(): Promise<void> {}
  async sendMagicLink(): Promise<void> {}
  async sendPaymentConfirmed(): Promise<void> {}
  async sendPaymentRejected(): Promise<void> {}
  async sendStaffWelcome(): Promise<void> {}
  async sendPaymentLink(to: string, data: PaymentLinkEmailData): Promise<void> {
    this.paymentLinkCalls.push({ to, data });
  }
  async sendRevisedPayment(_to: string, _data: unknown): Promise<void> {}
  async sendAdditionalPayment(_to: string, _data: unknown): Promise<void> {}
  async sendStoryHidden(_to: string, _data: unknown): Promise<void> {}
}

class HttpTestAuthRepo implements IAuthRepository {
  stored: Array<{
    id: number;
    tokenHash: string;
    expiresAt: number;
    identity: { registrationId: number } | { userId: number };
    usedAt: number | null;
  }> = [];
  markedUsed: number[] = [];
  private nextId = 1;

  async createMagicLink(tokenHash: string, expiresAt: number, identity: { registrationId: number } | { userId: number }): Promise<void> {
    this.stored.push({ id: this.nextId++, tokenHash, expiresAt, identity, usedAt: null });
  }

  async findValidMagicLink(tokenHash: string): Promise<MagicLink | null> {
    const now = Date.now();
    const found = this.stored.find(l => l.tokenHash === tokenHash && l.usedAt === null && l.expiresAt > now);
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
    const link = this.stored.find(l => l.id === id);
    if (!link || link.usedAt !== null) return false;
    link.usedAt = Date.now();
    this.markedUsed.push(id);
    return true;
  }

  async cleanExpired(): Promise<void> {}

  async countRecentLinks(identity: { registrationId: number } | { userId: number }, _sinceMs: number): Promise<number> {
    return this.stored.filter(l => {
      if ('registrationId' in identity) {
        return 'registrationId' in l.identity && l.identity.registrationId === identity.registrationId;
      }
      return 'userId' in l.identity && l.identity.userId === identity.userId;
    }).length;
  }
}

const HTTP_JWT_SECRET = "http-test-secret-payment-link-32c!";
const TEST_ENV = { JWT_SECRET: HTTP_JWT_SECRET } as unknown as import("../env.js").Env;

interface HttpTestCtx {
  req: (path: string, init?: RequestInit) => Promise<Response>;
  regRepo: HttpTestRegistrationRepo;
  paymentRepo: HttpTestPaymentRepo;
  emailService: TrackingEmailService;
  authRepo: HttpTestAuthRepo;
  authService: AuthService;
}

function createHttpTestApp(): HttpTestCtx {
  clearRateLimitStore();

  const regRepo = new HttpTestRegistrationRepo();
  const paymentRepo = new HttpTestPaymentRepo();
  const auditRepo = new HttpTestAuditRepo();
  const emailService = new TrackingEmailService();
  const authRepo = new HttpTestAuthRepo();

  const authService = new AuthService({
    userRepo: {
      create: async () => ({ id: 1 }),
      findById: async () => null,
      findByEmail: async () => null,
      list: async () => [],
      update: async () => {},
    },
    registrationRepo: regRepo,
    authRepo,
    emailService,
    systemAuditRepo: { append: async () => {} },
    jwtSecret: HTTP_JWT_SECRET,
    baseUrl: "http://localhost:8787",
  });

  const registrationService = new RegistrationService({
    availabilityService: stubAvailabilityService,
    registrationRepo: regRepo,
    attendeeRepo: new StubAttendeeRepo(),
    auditRepo,
    documentRepo: new StubDocumentRepo(),
    emailService,
    pricingService: new PricingService(),
    authService: {
      async issueAttendeeToken() { return "stub-token"; },
      async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; },
    },
  });

  const paymentService = new PaymentService({
    db: unusedD1 as unknown as import('@cloudflare/workers-types').D1Database,
    registrationRepo: regRepo,
    paymentRepo,
    attendeeRepo: new StubAttendeeRepo(),
    auditRepo,
    refundRepo: {
      create: async () => { throw new Error('refundRepo is unused in payment-link tests'); },
      findById: async () => null,
      list: async () => [],
      listWithRegistration: async () => [],
      findByRegistration: async () => [],
      findByOriginalRegistration: async () => [],
    },
    fileStorage: new StubFileStorage(),
    emailService,
    appBaseUrl: "http://localhost:5173",
  });

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("authService", authService);
    c.set("registrationService", registrationService);
    c.set("paymentService", paymentService);
    await next();
  });
  app.route("/auth", authRoutes);
  app.route("/", paymentRoutes);

  const req = (path: string, init?: RequestInit): Promise<Response> => Promise.resolve(app.request(path, init, TEST_ENV));

  return { req, regRepo, paymentRepo, emailService, authRepo, authService };
}

function makeTestReg(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1001,
    regCode: "SMRTTEST12345678",
    status: "pending",
    fullName: "Test User",
    branch: "Computer Science & Engineering",
    email: "test@example.com",
    whatsapp: "+919999999999",
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
    pricingSnapshot: { base: 0, lines: [], donation: 0, collegeContribution: 0, total: 0 },
    totalAmount: 0,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /api/auth/payment-link
// ---------------------------------------------------------------------------

describe("POST /api/auth/payment-link", () => {
  let ctx: HttpTestCtx;

  beforeEach(() => {
    ctx = createHttpTestApp();
  });

  it("valid regCode returns 200 {ok: true} and sends payment link email", async () => {
    const reg = makeTestReg({ regCode: "SMRTTEST12345678" });
    ctx.regRepo.seed(reg);

    const res = await ctx.req("/api/auth/payment-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRTTEST12345678" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(ctx.emailService.paymentLinkCalls).toHaveLength(1);
    expect(ctx.emailService.paymentLinkCalls[0].data.link).toContain("/pay/SMRTTEST12345678?code=");
  });

  it("unknown regCode returns 200 {ok: true} but NO email sent (enumeration-safe)", async () => {
    const res = await ctx.req("/api/auth/payment-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRTUNKNOWN12345" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(ctx.emailService.paymentLinkCalls).toHaveLength(0);
  });

  it("missing regCode field returns 400", async () => {
    const res = await ctx.req("/api/auth/payment-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "oops@example.com" }),
    });

    expect(res.status).toBe(400);
  });

  it("empty regCode string returns 400", async () => {
    const res = await ctx.req("/api/auth/payment-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "" }),
    });

    expect(res.status).toBe(400);
  });

  it("malformed JSON body returns 400", async () => {
    const res = await ctx.req("/api/auth/payment-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    expect(res.status).toBe(400);
  });

  it("rate-limited (4th request in 10 min) returns 200 but no email", async () => {
    const reg = makeTestReg({ regCode: "SMRTTEST12345678" });
    ctx.regRepo.seed(reg);

    // Send 3 requests (should succeed and send emails)
    for (let i = 0; i < 3; i++) {
      await ctx.req("/api/auth/payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regCode: "SMRTTEST12345678" }),
      });
    }

    const callsBefore = ctx.emailService.paymentLinkCalls.length;

    // 4th request — should return 200 but not send email
    const res = await ctx.req("/api/auth/payment-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regCode: "SMRTTEST12345678" }),
    });

    expect(res.status).toBe(200);
    // No new email sent
    expect(ctx.emailService.paymentLinkCalls.length).toBe(callsBefore);
  });
});

// ---------------------------------------------------------------------------
// POST /api/registrations/:regCode/pay/upload-proof — auth enforcement
// ---------------------------------------------------------------------------

describe("POST /api/registrations/:regCode/pay/upload-proof — auth enforcement", () => {
  let ctx: HttpTestCtx;

  beforeEach(async () => {
    ctx = createHttpTestApp();

    // Seed a registration and a payment_pending payment
    const reg = makeTestReg({ id: 1001, regCode: "SMRTTEST12345678", status: "pending" });
    ctx.regRepo.seed(reg);
    await ctx.paymentRepo.create({
      registration_id: 1001,
      amount: 5000,
      status: "payment_pending",
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    });
  });

  it("no Authorization header → 401 with {error: 'Authentication required'}", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(8)], { type: "image/png" }), "proof.png");

    const res = await ctx.req("/api/registrations/SMRTTEST12345678/pay/upload-proof", {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(401);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("Authentication required");
  });

  it("Bearer token for a different registration → 403", async () => {
    // Token for registration id 9999 (not 1001)
    const token = await signToken({ sub: "9999", role: "attendee" }, HTTP_JWT_SECRET, "90d");

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(8)], { type: "image/png" }), "proof.png");

    const res = await ctx.req("/api/registrations/SMRTTEST12345678/pay/upload-proof", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    expect(res.status).toBe(403);
  });

  it("valid attendee token matching registration → 200", async () => {
    const token = await signToken({ sub: "1001", role: "attendee" }, HTTP_JWT_SECRET, "90d");

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(8)], { type: "image/png" }), "proof.png");

    const res = await ctx.req("/api/registrations/SMRTTEST12345678/pay/upload-proof", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    expect(res.status).toBe(200);
  });

  it("invalid (expired/malformed) token → 401", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(8)], { type: "image/png" }), "proof.png");

    const res = await ctx.req("/api/registrations/SMRTTEST12345678/pay/upload-proof", {
      method: "POST",
      headers: { Authorization: "Bearer invalid-token-value" },
      body: form,
    });

    expect(res.status).toBe(401);
  });
});
