import type { StaffScope } from "./staff-types";

const TOKEN_KEY = "smriti_token";
const REG_ID_KEY = "smriti_reg_id";
const ROLE_KEY = "smriti_role";
const SUB_KEY = "smriti_sub";
const EMAIL_KEY = "smriti_email";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable — silently ignore
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage unavailable — silently ignore
  }
}

export function saveAuth(token: string, regId: string): void {
  safeSet(TOKEN_KEY, token);
  safeSet(REG_ID_KEY, regId);
}

export function getToken(): string | null {
  return safeGet(TOKEN_KEY);
}

export function getRegId(): string | null {
  return safeGet(REG_ID_KEY);
}

export function getAuthRole(): string | null {
  return safeGet(ROLE_KEY);
}

export function getAuthEmail(): string | null {
  return safeGet(EMAIL_KEY);
}

export function getAuthSub(): string | null {
  return safeGet(SUB_KEY);
}

export function clearAuth(): void {
  safeRemove(TOKEN_KEY);
  safeRemove(REG_ID_KEY);
  safeRemove(ROLE_KEY);
  safeRemove(SUB_KEY);
  safeRemove(EMAIL_KEY);
}

export function saveStaffAuth(token: string): void {
  // Staff JWT intentionally overwrites any attendee JWT (staff is superset — auth spec R1.4)
  safeSet(TOKEN_KEY, token);
  // Staff has no regId — clear it to avoid stale attendee state
  safeRemove(REG_ID_KEY);
}

/**
 * Stores role, sub, and optionally email from the verify response.
 * Called alongside saveAuth/saveStaffAuth after magic link verification.
 */
export function saveVerifyResponse(response: { role: string; email?: string; sub: string }): void {
  safeSet(ROLE_KEY, response.role);
  safeSet(SUB_KEY, response.sub);
  if (response.email) {
    safeSet(EMAIL_KEY, response.email);
  } else {
    safeRemove(EMAIL_KEY);
  }
}

export function isStaff(): boolean {
  const role = getAuthRole();
  return role === "staff" || role === "admin";
}

export function isAdmin(): boolean {
  return getAuthRole() === "admin";
}

export function getUserDisplay(): { email: string; role: string } | null {
  const email = getAuthEmail();
  const role = getAuthRole();
  if (!email || !role) return null;
  return { email, role };
}

// ---------------------------------------------------------------------------
// Permission-aware staff landing (tasks/registration-desk.design.md
// "Post-Login Destination Design", access-control.spec.md R7 UI matrix).
// ---------------------------------------------------------------------------

export interface StaffLandingRoute {
  scope: StaffScope;
  route: string;
}

/**
 * Ordered staff landing registry — the SINGLE source for default staff
 * routing after login. Shared conceptually by landing (here), navigation
 * (SiteNav), and page route metadata (App.tsx). Do not hard-code a second
 * order elsewhere. Priority: dashboard, then registration_desk, then the
 * feature scopes. A user with several scopes lands on the first permitted
 * route.
 */
export const STAFF_LANDING_ROUTES: StaffLandingRoute[] = [
  { scope: "dashboard", route: "/staff/dashboard" },
  { scope: "registration_desk", route: "/staff/check-in" },
  { scope: "resources", route: "/staff/resources" },
  { scope: "reports", route: "/staff/reports" },
  { scope: "allocation", route: "/staff/allocation" },
  { scope: "bank_txns", route: "/staff/bank-transactions" },
  { scope: "admin-tools", route: "/staff/tools" },
];

// Required gate per staff path prefix (access-control.spec.md R7). Longer
// prefixes first so /staff/registrations/:id does not shadow /staff/registrations.
const STAFF_PATH_GATES: Array<{
  prefix: string;
  gate: StaffScope | "admin-only";
}> = [
  { prefix: "/staff/team", gate: "admin-only" },
  { prefix: "/staff/registrations/", gate: "dashboard" },
  { prefix: "/staff/dashboard", gate: "dashboard" },
  { prefix: "/staff/refunds", gate: "dashboard" },
  { prefix: "/staff/coming", gate: "dashboard" },
  { prefix: "/staff/archived/", gate: "dashboard" },
  { prefix: "/staff/archived", gate: "dashboard" },
  { prefix: "/staff/check-in", gate: "registration_desk" },
  { prefix: "/staff/resources", gate: "resources" },
  { prefix: "/staff/rooms", gate: "resources" },
  { prefix: "/staff/reports", gate: "reports" },
  { prefix: "/staff/bank-transactions", gate: "bank_txns" },
  { prefix: "/staff/allocation", gate: "allocation" },
  { prefix: "/staff/tools", gate: "admin-tools" },
  { prefix: "/staff/daily-report", gate: "admin-tools" },
];

/**
 * Returns the gate a staff path requires, or null when the path is not a
 * staff feature page (e.g. /pass, /register).
 */
function gateForStaffPath(path: string): StaffScope | "admin-only" | null {
  for (const { prefix, gate } of STAFF_PATH_GATES) {
    if (path.startsWith(prefix)) return gate;
  }
  return null;
}

/**
 * A returnTo is safe only as a same-origin internal path: starts with a
 * single "/", and is not protocol-relative or absolute (design.md
 * "Return-path safety").
 */
export function isSafeInternalPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("://");
}

/**
 * Permission-aware staff landing after authentication (design.md "Redirect
 * algorithm").
 *
 * - `scopes === null` (permissions NULL / full access) or admin → dashboard
 *   (or the internal returnTo when one is present).
 * - A safe internal returnTo is honored ONLY when the path's required scope
 *   is present; a denied returnTo is discarded and replaced by the default.
 * - Otherwise the first permitted route in STAFF_LANDING_ROUTES.
 * - An empty scope list → the scope-free `/staff/access-denied` route.
 *
 * A permissions-FETCH failure is handled by the caller (it cannot be
 * represented as scopes); it must navigate to `/staff/access-denied?reason=fetch`,
 * never to `/staff/dashboard`.
 */
export function resolveStaffLanding(
  scopes: string[] | null,
  returnTo: string | null,
  role: string | null,
): string {
  if (scopes === null || role === "admin") {
    if (returnTo && isSafeInternalPath(returnTo)) return returnTo;
    return "/staff/dashboard";
  }

  if (scopes.length === 0) return "/staff/access-denied";

  if (returnTo && isSafeInternalPath(returnTo)) {
    const gate = gateForStaffPath(returnTo);
    if (gate === null || (gate !== "admin-only" && scopes.includes(gate))) {
      return returnTo;
    }
    // A denied or admin-only returnTo falls through to the default route.
  }

  for (const entry of STAFF_LANDING_ROUTES) {
    if (scopes.includes(entry.scope)) return entry.route;
  }
  return "/staff/access-denied";
}

/**
 * Scope-only landing helper (no returnTo, no role override) — the historical
 * getDefaultStaffRoute contract extended with registration_desk and the
 * empty-scope → /staff/access-denied destination.
 */
export function getDefaultStaffRoute(scopes: string[] | null): string {
  return resolveStaffLanding(scopes, null, null);
}
