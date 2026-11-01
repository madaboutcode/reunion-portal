/**
 * Spec enforcement tests — AuthService (authentication.spec.md)
 *
 * Tests every externally observable guarantee from authentication.spec.md:
 *   - Identity resolution order (users before registrations)
 *   - Enumeration safety (always returns void regardless of email state)
 *   - Deactivated user silencing
 *   - Token hashing (raw token never stored)
 *   - Role-based JWT shape and expiry (7d staff, 90d attendee)
 *   - verifyMagicLink failure throws AuthError
 *   - Audit events emitted for all outcomes
 *
 * Uses observable fakes — fakes that record calls so tests can assert
 * that side effects (emails sent, tokens stored) actually happened.
 *
 * @module auth.service.test
 */

import { describe, it, expect } from "vitest";
import type {
  Registration,
  MagicLink,
  User,
  NewPayment,
  NewIdDocument,
  NewAttendee,
} from "../domain/types.js";
import type {
  IAuthRepository,
  IUserRepository,
  IRegistrationRepository,
  IEmailService,
  ISystemAuditRepository,
  MagicLinkEmailData,
} from "../repositories/interfaces.js";
import type { SystemAuditAction } from "../domain/types.js";
import { AuthService } from "../services/auth.service.js";
import { AuthError } from "../services/errors.js";
import { verifyToken } from "../infra/jwt.js";

// =============================================================================
// Observable fakes
// =============================================================================

interface AuditCall {
  action: SystemAuditAction;
  actor: string;
  targetType?: string;
  targetId?: number;
  details?: string;
}

function makeSystemAuditRepo(): ISystemAuditRepository & { calls: AuditCall[] } {
  const calls: AuditCall[] = [];
  return {
    calls,
    append: async (entry) => { calls.push(entry as AuditCall); },
  };
}

interface EmailCall {
  to: string;
  data: MagicLinkEmailData;
}

function makeEmailService(): IEmailService & { magicLinkCalls: EmailCall[] } {
  const magicLinkCalls: EmailCall[] = [];
  return {
    magicLinkCalls,
    sendConfirmation: async () => {},
    sendMagicLink: async (to, data) => { magicLinkCalls.push({ to, data }); },
    sendPaymentConfirmed: async () => {},
    sendPaymentRejected: async () => {},
    sendStaffWelcome: async () => {},
    sendPaymentLink: async () => {},
    sendRevisedPayment: async () => {},
    sendAdditionalPayment: async () => {},
    sendStoryHidden: async () => {},
  };
}

interface StoredMagicLink {
  tokenHash: string;
  expiresAt: number;
  identity: { registrationId: number } | { userId: number };
}

function makeAuthRepo(
  overrides: Partial<IAuthRepository> & { storedLinks?: StoredMagicLink[] } = {},
): IAuthRepository & { stored: StoredMagicLink[]; markedUsed: number[] } {
  const stored: StoredMagicLink[] = overrides.storedLinks ?? [];
  const markedUsed: number[] = [];

  return {
    stored,
    markedUsed,
    createMagicLink: async (tokenHash, expiresAt, identity) => {
      stored.push({ tokenHash, expiresAt, identity });
    },
    findValidMagicLink: overrides.findValidMagicLink ?? (async () => null),
    markUsed: overrides.markUsed ?? (async (id: number) => { markedUsed.push(id); return true; }),
    cleanExpired: async () => {},
    countRecentLinks: async () => 0,
  };
}

// ---------------------------------------------------------------------------
// Minimal domain object builders
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    email: "staff@example.com",
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
    regCode: "SM26-TEST1234",
    status: "pending",
    fullName: "Alumnus Name",
    branch: "Computer Science & Engineering",
    email: "alumnus@example.com",
    whatsapp: "+919999999999",
    mobileAlternate: null,
    city: "Chennai",
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

function makeMagicLink(overrides: Partial<MagicLink> = {}): MagicLink {
  return {
    id: 1,
    tokenHash: "abc123",
    registrationId: null,
    userId: null,
    expiresAt: Date.now() + 30 * 60 * 1000,
    usedAt: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stub repos that return nothing by default
// ---------------------------------------------------------------------------

function makeUserRepo(user: User | null = null): IUserRepository {
  const users = new Map<number, User>();
  if (user) users.set(user.id, user);

  return {
    create: async () => ({ id: 1 }),
    findById: async (id) => users.get(id) ?? null,
    findByEmail: async (email) => {
      if (user && user.email === email) return user;
      return null;
    },
    list: async () => Array.from(users.values()),
    update: async () => {},
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

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

const JWT_SECRET = "test-secret-for-unit-tests";
const BASE_URL = "https://example.com";

function makeService(deps: {
  userRepo?: IUserRepository;
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
// Tests: requestMagicLink
// =============================================================================

describe("AuthService.requestMagicLink", () => {
  describe("GUARANTEE: ENUMERATION_SAFE — always returns void", () => {
    it("returns void when email matches an active user", async () => {
      const user = makeUser({ email: "staff@example.com" });
      const svc = makeService({ userRepo: makeUserRepo(user) });
      const result = await svc.requestMagicLink("staff@example.com");
      expect(result).toBeUndefined();
    });

    it("returns void when email matches no identity", async () => {
      const svc = makeService({});
      const result = await svc.requestMagicLink("nobody@example.com");
      expect(result).toBeUndefined();
    });

    it("returns void when email matches a deactivated user", async () => {
      const user = makeUser({ email: "disabled@example.com", isActive: false });
      const svc = makeService({ userRepo: makeUserRepo(user) });
      const result = await svc.requestMagicLink("disabled@example.com");
      expect(result).toBeUndefined();
    });

    it("returns void when email matches an attendee registration", async () => {
      const reg = makeRegistration({ email: "alumnus@example.com" });
      const svc = makeService({ registrationRepo: makeRegistrationRepo([reg]) });
      const result = await svc.requestMagicLink("alumnus@example.com");
      expect(result).toBeUndefined();
    });
  });

  describe("GUARANTEE: DEACTIVATED_BLOCKED — no email sent for deactivated users", () => {
    it("does not send an email for a deactivated user", async () => {
      const user = makeUser({ email: "disabled@example.com", isActive: false });
      const emailService = makeEmailService();
      const svc = makeService({
        userRepo: makeUserRepo(user),
        emailService,
      });

      await svc.requestMagicLink("disabled@example.com");

      expect(emailService.magicLinkCalls).toHaveLength(0);
    });
  });

  describe("GUARANTEE: IDENTITY_RESOLUTION — users table checked before registrations", () => {
    it("sends staff magic link when email exists in both users and registrations", async () => {
      const sharedEmail = "overlap@example.com";
      const user = makeUser({ id: 5, email: sharedEmail, role: "staff" });
      const reg = makeRegistration({ id: 2000, email: sharedEmail });
      const authRepo = makeAuthRepo();
      const emailService = makeEmailService();

      const svc = makeService({
        userRepo: makeUserRepo(user),
        registrationRepo: makeRegistrationRepo([reg]),
        authRepo,
        emailService,
      });

      await svc.requestMagicLink(sharedEmail);

      // Exactly one email sent
      expect(emailService.magicLinkCalls).toHaveLength(1);

      // Token stored as userId, not registrationId
      expect(authRepo.stored).toHaveLength(1);
      expect(authRepo.stored[0].identity).toEqual({ userId: 5 });
    });

    it("falls through to registrations when email not in users", async () => {
      const reg = makeRegistration({ id: 1001, email: "attendee@example.com" });
      const authRepo = makeAuthRepo();

      const svc = makeService({
        registrationRepo: makeRegistrationRepo([reg]),
        authRepo,
      });

      await svc.requestMagicLink("attendee@example.com");

      expect(authRepo.stored).toHaveLength(1);
      expect(authRepo.stored[0].identity).toEqual({ registrationId: 1001 });
    });
  });

  describe("GUARANTEE: TOKEN_HASHED — raw token never stored", () => {
    it("stores a hash not the raw token", async () => {
      const user = makeUser({ email: "staff@example.com" });
      const authRepo = makeAuthRepo();
      const emailService = makeEmailService();

      const svc = makeService({
        userRepo: makeUserRepo(user),
        authRepo,
        emailService,
      });

      await svc.requestMagicLink("staff@example.com");

      // Raw token appears in the email URL
      const emailUrl = emailService.magicLinkCalls[0].data.token;
      const rawToken = new URL(emailUrl).searchParams.get("token")!;

      // Stored hash is not the raw token
      const storedHash = authRepo.stored[0].tokenHash;
      expect(storedHash).not.toEqual(rawToken);

      // Stored hash is a 64-char hex string (SHA-256 produces 32 bytes = 64 hex chars)
      expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("email link URL contains the raw token as a query param", async () => {
      const user = makeUser({ email: "staff@example.com" });
      const emailService = makeEmailService();

      const svc = makeService({
        userRepo: makeUserRepo(user),
        emailService,
      });

      await svc.requestMagicLink("staff@example.com");

      const emailUrl = emailService.magicLinkCalls[0].data.token;
      expect(emailUrl).toContain("/auth/verify?token=");
      expect(emailUrl.startsWith(BASE_URL)).toBe(true);
    });
  });

  describe("audit — login_requested logged for all outcomes", () => {
    it("audits login_requested when email not found", async () => {
      const auditRepo = makeSystemAuditRepo();
      const svc = makeService({ systemAuditRepo: auditRepo });

      await svc.requestMagicLink("nobody@example.com");

      expect(auditRepo.calls).toHaveLength(1);
      expect(auditRepo.calls[0].action).toBe("login_requested");
      expect(auditRepo.calls[0].actor).toBe("nobody@example.com");
    });

    it("audits login_requested when email found and magic link sent", async () => {
      const user = makeUser({ email: "staff@example.com" });
      const auditRepo = makeSystemAuditRepo();
      const svc = makeService({ userRepo: makeUserRepo(user), systemAuditRepo: auditRepo });

      await svc.requestMagicLink("staff@example.com");

      expect(auditRepo.calls).toHaveLength(1);
      expect(auditRepo.calls[0].action).toBe("login_requested");
    });
  });
});

// =============================================================================
// Tests: verifyMagicLink
// =============================================================================

describe("AuthService.verifyMagicLink", () => {
  describe("FAILURE BEHAVIOR: throws AuthError for invalid tokens", () => {
    it("throws AuthError when token not found", async () => {
      const authRepo = makeAuthRepo({
        findValidMagicLink: async () => null,
      });
      const svc = makeService({ authRepo });

      await expect(svc.verifyMagicLink("invalid-token")).rejects.toThrow(AuthError);
    });

    it("thrown AuthError has 401 status code", async () => {
      const authRepo = makeAuthRepo({
        findValidMagicLink: async () => null,
      });
      const svc = makeService({ authRepo });

      const error = await svc.verifyMagicLink("bad-token").catch(e => e);
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).statusCode).toBe(401);
    });

    it("audits login_failed before throwing", async () => {
      const authRepo = makeAuthRepo({
        findValidMagicLink: async () => null,
      });
      const auditRepo = makeSystemAuditRepo();
      const svc = makeService({ authRepo, systemAuditRepo: auditRepo });

      await svc.verifyMagicLink("bad-token").catch(() => {});

      expect(auditRepo.calls).toHaveLength(1);
      expect(auditRepo.calls[0].action).toBe("login_failed");
    });
  });

  describe("GUARANTEE: ROLE_JWT — staff/admin tokens (7d, includes email)", () => {
    it("issues a JWT with role and email for a staff user", async () => {
      const user = makeUser({ id: 7, email: "staff@example.com", role: "staff" });
      const link = makeMagicLink({ id: 10, userId: user.id, registrationId: null });

      const authRepo = makeAuthRepo({
        findValidMagicLink: async () => link,
      });
      const svc = makeService({
        userRepo: makeUserRepo(user),
        authRepo,
      });

      const { jwt, role, redirectTo } = await svc.verifyMagicLink("any-token");

      expect(role).toBe("staff");
      expect(redirectTo).toBe("/staff/dashboard");

      const payload = await verifyToken(jwt, JWT_SECRET);
      expect(payload.sub).toBe(String(user.id));
      expect(payload.role).toBe("staff");
      expect(payload.email).toBe(user.email);
    });

    it("issues a JWT with role and email for an admin user", async () => {
      const user = makeUser({ id: 1, role: "admin", email: "admin@example.com" });
      const link = makeMagicLink({ id: 11, userId: user.id, registrationId: null });

      const authRepo = makeAuthRepo({
        findValidMagicLink: async () => link,
      });
      const svc = makeService({
        userRepo: makeUserRepo(user),
        authRepo,
      });

      const { role, redirectTo } = await svc.verifyMagicLink("any-token");

      expect(role).toBe("admin");
      expect(redirectTo).toBe("/staff/dashboard");
    });

    it("marks the magic link as used after issuing JWT", async () => {
      const user = makeUser({ id: 7 });
      const link = makeMagicLink({ id: 42, userId: user.id, registrationId: null });

      const authRepo = makeAuthRepo({
        findValidMagicLink: async () => link,
      });
      const svc = makeService({ userRepo: makeUserRepo(user), authRepo });

      await svc.verifyMagicLink("any-token");

      expect(authRepo.markedUsed).toContain(42);
    });
  });

  describe("GUARANTEE: ROLE_JWT — attendee tokens (90d, no email)", () => {
    it("issues a JWT with attendee role and regCode redirect", async () => {
      const reg = makeRegistration({ id: 1001, regCode: "SM26-ABCD1234", email: "a@example.com" });
      const link = makeMagicLink({ id: 20, registrationId: reg.id, userId: null });

      const authRepo = makeAuthRepo({
        findValidMagicLink: async () => link,
      });
      const svc = makeService({
        registrationRepo: makeRegistrationRepo([reg]),
        authRepo,
      });

      const { jwt, role, redirectTo } = await svc.verifyMagicLink("any-token");

      expect(role).toBe("attendee");
      expect(redirectTo).toBe(`/confirmation/${reg.id}`);

      const payload = await verifyToken(jwt, JWT_SECRET);
      expect(payload.sub).toBe(String(reg.id));
      expect(payload.role).toBe("attendee");
      // Attendee token must NOT include email field
      expect(payload.email).toBeUndefined();
    });
  });

  describe("audit — login_succeeded logged on happy path", () => {
    it("audits login_succeeded for staff verification", async () => {
      const user = makeUser({ id: 7, email: "staff@example.com", role: "staff" });
      const link = makeMagicLink({ id: 10, userId: user.id, registrationId: null });

      const authRepo = makeAuthRepo({ findValidMagicLink: async () => link });
      const auditRepo = makeSystemAuditRepo();
      const svc = makeService({ userRepo: makeUserRepo(user), authRepo, systemAuditRepo: auditRepo });

      await svc.verifyMagicLink("any-token");

      expect(auditRepo.calls).toHaveLength(1);
      expect(auditRepo.calls[0].action).toBe("login_succeeded");
      expect(auditRepo.calls[0].actor).toBe(user.email);
    });

    it("audits login_succeeded for attendee verification", async () => {
      const reg = makeRegistration({ id: 1001, email: "alumnus@example.com" });
      const link = makeMagicLink({ id: 20, registrationId: reg.id, userId: null });

      const authRepo = makeAuthRepo({ findValidMagicLink: async () => link });
      const auditRepo = makeSystemAuditRepo();
      const svc = makeService({
        registrationRepo: makeRegistrationRepo([reg]),
        authRepo,
        systemAuditRepo: auditRepo,
      });

      await svc.verifyMagicLink("any-token");

      expect(auditRepo.calls).toHaveLength(1);
      expect(auditRepo.calls[0].action).toBe("login_succeeded");
      expect(auditRepo.calls[0].actor).toBe(reg.email);
    });
  });
});

// =============================================================================
// Tests: magic link expiry (R7.5) — 10-minute window
// =============================================================================

describe("AuthService.requestMagicLink — magic link expiry (R7.5)", () => {
  it("stores expiresAt approximately 10 minutes from now (within 1 second tolerance)", async () => {
    const user = makeUser({ email: "staff@example.com" });
    const authRepo = makeAuthRepo();
    const emailService = makeEmailService();
    const svc = makeService({ userRepo: makeUserRepo(user), authRepo, emailService });

    const before = Date.now();
    await svc.requestMagicLink("staff@example.com");
    const after = Date.now();

    expect(authRepo.stored).toHaveLength(1);
    const { expiresAt } = authRepo.stored[0];
    const expectedMin = before + 10 * 60 * 1000;
    const expectedMax = after + 10 * 60 * 1000;

    // expiresAt must be within [before + 10min, after + 10min] — 1s tolerance
    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin - 1000);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax + 1000);
  });

  it("attendee magic link also expires in ~10 minutes", async () => {
    const reg = makeRegistration({ email: "alumnus@example.com" });
    const authRepo = makeAuthRepo();
    const svc = makeService({ registrationRepo: makeRegistrationRepo([reg]), authRepo });

    const before = Date.now();
    await svc.requestMagicLink("alumnus@example.com");
    const after = Date.now();

    expect(authRepo.stored).toHaveLength(1);
    const { expiresAt } = authRepo.stored[0];
    expect(expiresAt).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 10 * 60 * 1000 + 1000);
  });
});

// =============================================================================
// Tests: JWT expiry durations (R5.2)
// =============================================================================

describe("AuthService.verifyMagicLink — JWT expiry durations (R5.2)", () => {
  it("staff JWT exp claim is approximately 7 days from iat", async () => {
    const user = makeUser({ id: 7, email: "staff@example.com", role: "staff" });
    const link = makeMagicLink({ id: 10, userId: user.id, registrationId: null });

    const authRepo = makeAuthRepo({ findValidMagicLink: async () => link });
    const svc = makeService({ userRepo: makeUserRepo(user), authRepo });

    const { jwt } = await svc.verifyMagicLink("any-token");
    const payload = await verifyToken(jwt, JWT_SECRET);

    const iat = payload.iat as number;
    const exp = payload.exp as number;
    const durationSeconds = exp - iat;

    // 7 days in seconds = 604800; allow 5s slack for test execution
    expect(durationSeconds).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 - 5);
    expect(durationSeconds).toBeLessThanOrEqual(7 * 24 * 60 * 60 + 5);
  });

  it("admin JWT exp claim is approximately 7 days from iat", async () => {
    const user = makeUser({ id: 1, email: "admin@example.com", role: "admin" });
    const link = makeMagicLink({ id: 11, userId: user.id, registrationId: null });

    const authRepo = makeAuthRepo({ findValidMagicLink: async () => link });
    const svc = makeService({ userRepo: makeUserRepo(user), authRepo });

    const { jwt } = await svc.verifyMagicLink("any-token");
    const payload = await verifyToken(jwt, JWT_SECRET);

    const iat = payload.iat as number;
    const exp = payload.exp as number;
    const durationSeconds = exp - iat;

    expect(durationSeconds).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 - 5);
    expect(durationSeconds).toBeLessThanOrEqual(7 * 24 * 60 * 60 + 5);
  });

  it("attendee JWT exp claim is approximately 90 days from iat", async () => {
    const reg = makeRegistration({ id: 1001, regCode: "SM26-ABCD1234", email: "a@example.com" });
    const link = makeMagicLink({ id: 20, registrationId: reg.id, userId: null });

    const authRepo = makeAuthRepo({ findValidMagicLink: async () => link });
    const svc = makeService({ registrationRepo: makeRegistrationRepo([reg]), authRepo });

    const { jwt } = await svc.verifyMagicLink("any-token");
    const payload = await verifyToken(jwt, JWT_SECRET);

    const iat = payload.iat as number;
    const exp = payload.exp as number;
    const durationSeconds = exp - iat;

    // 90 days in seconds = 7776000; allow 5s slack
    expect(durationSeconds).toBeGreaterThanOrEqual(90 * 24 * 60 * 60 - 5);
    expect(durationSeconds).toBeLessThanOrEqual(90 * 24 * 60 * 60 + 5);
  });
});
