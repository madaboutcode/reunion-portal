/**
 * CONTRACT
 *
 * GUARANTEE: ENUMERATION_SAFE — requestMagicLink always returns void regardless
 *   of whether the email exists, is deactivated, or is unknown. The caller
 *   cannot distinguish "email sent" from "no identity found".
 *
 * GUARANTEE: PAYMENT_LINK_ENUMERATION_SAFE — requestPaymentLink always returns
 *   void regardless of whether the regCode exists. The caller cannot distinguish
 *   "link sent" from "registration not found".
 *
 * GUARANTEE: IDENTITY_RESOLUTION — the users table is checked before
 *   registrations. If an email appears in both tables, the staff/admin identity
 *   wins. Staff role is a superset of attendee capabilities.
 *
 * GUARANTEE: DEACTIVATED_BLOCKED — a user with isActive === false cannot
 *   receive a magic link or verify an existing one (user row not found by
 *   identity resolution because the DB query filters is_active = 1).
 *
 * GUARANTEE: TOKEN_HASHED — the raw token (crypto.randomUUID()) is never
 *   written to the database. Only its SHA-256 hex digest is stored. The raw
 *   token travels exclusively in the email link URL.
 *
 * GUARANTEE: ROLE_JWT — staff/admin identities receive a 7-day JWT containing
 *   { sub, role, email }. Attendee identities receive a 90-day JWT containing
 *   { sub, role }. Expiry is shorter for higher-privilege tokens.
 *
 * GUARANTEE: PAYMENT_LINK_EXPIRY — payment magic links expire in 24 hours.
 *
 * GUARANTEE: STAFF_LINK_GENERATION — createStaffLoginLinkUrl creates a hashed,
 *   single-use magic link for a staff user that expires in 10 minutes. It does
 *   not send email.
 *
 * EXPECTS: authRepo.findValidMagicLink returns a MagicLink row only when the
 *   token is not expired and not yet used. Exactly one of registrationId or
 *   userId is non-null on the returned row.
 *
 * FAILURE BEHAVIOR: verifyMagicLink throws AuthError('Invalid or expired link')
 *   for any invalid, expired, or already-used token. The failure is audited
 *   before the error is thrown.
 */

import { REG_CODE_PREFIX } from '@smriti/shared';
import type {
  IAuthRepository,
  IUserRepository,
  IEmailService,
  ISystemAuditRepository,
} from '../repositories/interfaces.js';
import type { IRegistrationRepository } from '../repositories/interfaces.js';
import { signToken, type JwtRole } from '../infra/jwt.js';
import { AuthError } from './errors.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

export class AuthService {
  private userRepo: IUserRepository;
  private registrationRepo: IRegistrationRepository;
  private authRepo: IAuthRepository;
  private emailService: IEmailService;
  private systemAuditRepo: ISystemAuditRepository;
  private jwtSecret: string;
  private baseUrl: string;

  constructor(deps: {
    userRepo: IUserRepository;
    registrationRepo: IRegistrationRepository;
    authRepo: IAuthRepository;
    emailService: IEmailService;
    systemAuditRepo: ISystemAuditRepository;
    jwtSecret: string;
    baseUrl: string;
  }) {
    this.userRepo = deps.userRepo;
    this.registrationRepo = deps.registrationRepo;
    this.authRepo = deps.authRepo;
    this.emailService = deps.emailService;
    this.systemAuditRepo = deps.systemAuditRepo;
    this.jwtSecret = deps.jwtSecret;
    this.baseUrl = deps.baseUrl;
  }

  async issueAttendeeToken(registrationId: number, status: string): Promise<string> {
    return signToken(
      { sub: String(registrationId), role: 'attendee', status },
      this.jwtSecret,
      '90d',
    );
  }

  async issueStaffToken(userId: number, role: JwtRole, email: string): Promise<string> {
    return signToken(
      { sub: String(userId), role, email },
      this.jwtSecret,
      '7d',
    );
  }

  /** Creates a short-lived staff login URL without sending an email. */
  async createStaffLoginLinkUrl(userId: number): Promise<string> {
    const rawToken = crypto.randomUUID();
    const tokenHash = await hashToken(rawToken);
    const expiresAt = Date.now() + 10 * 60 * 1000;

    await this.authRepo.createMagicLink(tokenHash, expiresAt, { userId });

    return `${this.baseUrl}/auth/verify?token=${rawToken}`;
  }

  /**
   * Resolves the email to an identity and sends a magic link email if found.
   * Always returns void — callers cannot distinguish found from not-found.
   */
  async requestMagicLink(email: string, returnTo?: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    // Identity resolution: users table first (staff/admin), then registrations
    const user = await this.userRepo.findByEmail(normalizedEmail);

    if (user !== null) {
      // User found — check active status before proceeding
      if (!user.isActive) {
        // Deactivated: audit and return silently (prevent enumeration)
        await this.systemAuditRepo.append({
          action: 'login_requested',
          actor: normalizedEmail,
          details: JSON.stringify({ resolved: 'deactivated' }),
        });
        return;
      }

      // Per-email rate limit: max 3 magic links per identity in 10 minutes
      const recentCount = await this.authRepo.countRecentLinks(
        { userId: user.id },
        Date.now() - 10 * 60 * 1000,
      );
      if (recentCount >= 3) {
        await this.systemAuditRepo.append({
          action: 'login_requested',
          actor: normalizedEmail,
          details: JSON.stringify({ resolved: 'rate_limited', recentCount }),
        });
        return;
      }

      // Active staff/admin identity
      const rawToken = crypto.randomUUID();
      const tokenHash = await hashToken(rawToken);
      const expiresAt = Date.now() + 10 * 60 * 1000;

      await this.authRepo.createMagicLink(tokenHash, expiresAt, { userId: user.id });

      const returnToParam = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
      const magicLinkUrl = `${this.baseUrl}/auth/verify?token=${rawToken}${returnToParam}`;
      await this.emailService.sendMagicLink(normalizedEmail, { token: magicLinkUrl, expiresIn: 10 });

      await this.systemAuditRepo.append({
        action: 'login_requested',
        actor: normalizedEmail,
        details: JSON.stringify({ resolved: user.role }),
      });
      return;
    }

    // Not in users — check registrations
    const registrations = await this.registrationRepo.findByEmail(normalizedEmail);

    if (registrations.length === 0) {
      // No identity anywhere — audit and return silently
      await this.systemAuditRepo.append({
        action: 'login_requested',
        actor: normalizedEmail,
        details: JSON.stringify({ resolved: 'unknown' }),
      });

      // Artificial delay to foil timing side-channel enumeration
      await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
      return;
    }

    // Attendee identity — spec says most recent registration wins (sorted by
    // created_at DESC in the repo, so first element is most recent)
    const registration = registrations[0];

    // Per-email rate limit: max 3 magic links per identity in 10 minutes
    const recentCount = await this.authRepo.countRecentLinks(
      { registrationId: registration.id },
      Date.now() - 10 * 60 * 1000,
    );
    if (recentCount >= 3) {
      await this.systemAuditRepo.append({
        action: 'login_requested',
        actor: normalizedEmail,
        details: JSON.stringify({ resolved: 'rate_limited', recentCount }),
      });
      return;
    }

    const rawToken = crypto.randomUUID();
    const tokenHash = await hashToken(rawToken);
    const expiresAt = Date.now() + 10 * 60 * 1000;

    await this.authRepo.createMagicLink(tokenHash, expiresAt, { registrationId: registration.id });

    const returnToParam = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
    const magicLinkUrl = `${this.baseUrl}/auth/verify?token=${rawToken}${returnToParam}`;
    await this.emailService.sendMagicLink(normalizedEmail, { token: magicLinkUrl, expiresIn: 10 });

    await this.systemAuditRepo.append({
      action: 'login_requested',
      actor: normalizedEmail,
      details: JSON.stringify({ resolved: 'attendee' }),
    });
  }

  /**
   * Creates a payment magic link URL for a registration.
   * Token expires in 24 hours. No rate limit — this is called internally.
   */
  async createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string> {
    const rawToken = crypto.randomUUID();
    const tokenHash = await hashToken(rawToken);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await this.authRepo.createMagicLink(tokenHash, expiresAt, { registrationId });
    return `${this.baseUrl}/pay/${regCode}?code=${rawToken}`;
  }

  /**
   * Looks up a registration by regCode, enforces per-identity rate limit (3 per 10 min),
   * creates a payment magic link, and sends the payment link email.
   * Always returns void — enumeration-safe.
   */
  async requestPaymentLink(regCode: string): Promise<void> {
    // Normalise — same logic as the route handler guard
    const normalized = regCode.replace(/-/g, '').trim().toUpperCase();
    if (!normalized.startsWith(REG_CODE_PREFIX) || normalized.length !== 16) {
      // Invalid format — return silently (enumeration-safe)
      await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
      return;
    }

    const registration = await this.registrationRepo.findByRegCode(normalized);

    if (!registration) {
      // No registration found — return silently with timing jitter (enumeration-safe)
      await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
      return;
    }

    // Per-identity rate limit: max 3 payment links per registration in 10 minutes
    const recentCount = await this.authRepo.countRecentLinks(
      { registrationId: registration.id },
      Date.now() - 10 * 60 * 1000,
    );
    if (recentCount >= 3) {
      // Rate limited — return silently
      return;
    }

    const link = await this.createPaymentLinkUrl(registration.id, normalized);
    await this.emailService.sendPaymentLink(registration.email, { link, expiresInHours: 24 });
  }

  /**
   * Verifies a raw magic link token and returns a signed JWT plus redirect path.
   * Throws AuthError on any invalid, expired, or already-used token.
   */
  async verifyMagicLink(token: string): Promise<{ jwt: string; role: JwtRole; redirectTo: string; email?: string; sub: string }> {
    const tokenHash = await hashToken(token);

    const magicLink = await this.authRepo.findValidMagicLink(tokenHash);

    if (!magicLink) {
      await this.systemAuditRepo.append({
        action: 'login_failed',
        actor: 'unknown',
        details: JSON.stringify({ reason: 'invalid_or_expired', tokenHashPrefix: tokenHash.slice(0, 8) }),
      });
      throw new AuthError('Invalid or expired link');
    }

    const claimed = await this.authRepo.markUsed(magicLink.id);
    if (!claimed) {
      await this.systemAuditRepo.append({
        action: 'login_failed',
        actor: 'unknown',
        details: JSON.stringify({ reason: 'already_consumed', tokenHashPrefix: tokenHash.slice(0, 8) }),
      });
      throw new AuthError('Invalid or expired link');
    }

    // Build JWT based on which identity is attached to this magic link
    if (magicLink.userId !== null) {
      const user = await this.userRepo.findById(magicLink.userId);
      if (!user) {
        await this.systemAuditRepo.append({
          action: 'login_failed',
          actor: 'unknown',
          details: JSON.stringify({ reason: 'user_not_found', userId: magicLink.userId }),
        });
        throw new AuthError('Invalid or expired link');
      }

      const jwt = await this.issueStaffToken(user.id, user.role as JwtRole, user.email);

      await this.systemAuditRepo.append({
        action: 'login_succeeded',
        actor: user.email,
        targetType: 'user',
        targetId: user.id,
        details: JSON.stringify({ role: user.role }),
      });

      return { jwt, role: user.role, redirectTo: '/staff/dashboard', email: user.email, sub: String(user.id) };
    }

    // Attendee identity
    const registrationId = magicLink.registrationId as number;

    const registration = await this.registrationRepo.findById(registrationId);
    if (!registration) {
      await this.systemAuditRepo.append({
        action: 'login_failed',
        actor: 'unknown',
        details: JSON.stringify({ reason: 'registration_not_found', registrationId }),
      });
      throw new AuthError('Invalid or expired link');
    }

    const jwt = await this.issueAttendeeToken(registrationId, registration.status);

    await this.systemAuditRepo.append({
      action: 'login_succeeded',
      actor: registration.email,
      targetType: 'registration',
      targetId: registrationId,
      details: JSON.stringify({ role: 'attendee' }),
    });

    return {
      jwt,
      role: 'attendee',
      redirectTo: `/confirmation/${registrationId}`,
      sub: String(registrationId),
    };
  }
}
