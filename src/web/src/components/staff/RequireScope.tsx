import type { ReactNode } from "react";
import { useStaffScopes } from "@/hooks/useStaffScopes";
import { AccessDeniedPage } from "@/pages/AccessDeniedPage";
import type { StaffScope } from "@/lib/staff-types";

export interface RequireScopeProps {
  scope: StaffScope;
  children: ReactNode;
  /** Optional page/section name shown in the Access denied message. */
  pageLabel?: string;
}

/**
 * Page-level scope guard (access-control.spec.md R5.4, R7). Mount at the top of
 * a `/staff/*` page tree.
 *
 * GUARANTEES:
 * - Renders children when the current user holds `scope` (via useStaffScopes,
 *   which grants admins and full-access/unscoped staff everything).
 * - Renders an inline "Access denied" state (never a raw 403) when the scope is
 *   missing.
 * - While permissions are still loading, renders nothing — prevents a flash of
 *   the page or a premature "Access denied" before scopes resolve.
 *
 * Compose for multi-scope pages:
 *   <RequireScope scope="dashboard"><RequireScope scope="reports">…</RequireScope></RequireScope>
 */
export function RequireScope({ scope, children, pageLabel }: RequireScopeProps) {
  const { loaded, hasScope } = useStaffScopes();

  if (!loaded) return null;
  if (!hasScope(scope)) return <AccessDeniedPage page={pageLabel} />;
  return <>{children}</>;
}
