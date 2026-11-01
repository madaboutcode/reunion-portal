import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getAuthRole } from "@/lib/auth";
import { useStaffScopes } from "@/hooks/useStaffScopes";
import type { StaffScope } from "@/lib/staff-types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProtectedRouteProps {
  requiredRoles: string[];
  /**
   * Optional scope gate (access-control.spec.md R5, mechanism 2). When set, a
   * user who passes the role check but lacks any required scope is redirected to
   * `/staff/dashboard?denied=1` (redirect-style gate, distinct from the inline
   * `<RequireScope>` "Access denied" state used for per-page guards).
   */
  requiredScopes?: StaffScope[];
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * Layout route that guards child routes by role, and optionally by scope.
 *
 * GUARANTEES:
 * - Renders <Outlet /> when auth payload exists and role is in requiredRoles.
 * - Redirects to /login?returnTo=<encoded-path> when unauthenticated or role mismatch.
 * - Preserves the current path + search in returnTo so login can redirect back.
 * - When requiredScopes is set: renders <Outlet /> only if the role passes AND
 *   the user holds every required scope (admins and full-access staff bypass);
 *   otherwise redirects to /staff/dashboard?denied=1. Renders nothing until
 *   permissions have loaded, to avoid a premature redirect.
 */
export function ProtectedRoute({ requiredRoles, requiredScopes }: ProtectedRouteProps) {
  const location = useLocation();
  const role = getAuthRole();
  const { loaded, hasScope } = useStaffScopes();

  if (!role || !requiredRoles.includes(role)) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }

  if (requiredScopes && requiredScopes.length > 0) {
    if (!loaded) return null;
    const missing = requiredScopes.some((scope) => !hasScope(scope));
    if (missing) {
      return <Navigate to="/staff/dashboard?denied=1" replace />;
    }
  }

  return <Outlet />;
}
