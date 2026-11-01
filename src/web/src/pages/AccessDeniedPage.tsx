import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useStaffScopes } from "@/hooks/useStaffScopes";
import { STAFF_LANDING_ROUTES } from "@/lib/auth";

export interface AccessDeniedPageProps {
  /** Optional page/section name the user tried to reach, for a friendlier message. */
  page?: string;
}

/**
 * Friendly "Access denied" state for a staff user who lacks the scope required
 * by a `/staff/*` page (access-control.spec.md R5.4). This is the first line of
 * user feedback — the API 403 is defense-in-depth behind it, never surfaced raw.
 *
 * Rendered inline by <RequireScope> inside the StaffLayout Outlet; no redirect.
 */
export function AccessDeniedPage({ page }: AccessDeniedPageProps) {
  useDocumentTitle("Access Denied");
  const { hasScope } = useStaffScopes();

  // Link to a route the user can actually reach — the first landing route
  // whose scope they hold. Dashboard-gated users get "Back to dashboard";
  // anyone else gets "Go to your workspace". No entry reachable (empty
  // scopes / fetch error) → no link at all, never a dead end.
  const reachable = STAFF_LANDING_ROUTES.find((entry) => hasScope(entry.scope));

  return (
    <div
      className="max-w-[560px] mx-auto px-5 py-16 text-center"
      role="alert"
      data-testid="access-denied"
    >
      <h1 className="font-heading text-2xl text-charcoal mb-3">Access denied</h1>
      <p className="text-muted mb-8">
        {page
          ? `You don't have access to ${page}.`
          : "You don't have access to this page."}{" "}
        If you think you should, ask an admin to update your permissions.
      </p>
      {reachable && (
        <Link
          to={reachable.route}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-bold no-underline bg-terracotta text-white hover:brightness-95 transition"
        >
          {reachable.route === "/staff/dashboard" ? "Back to dashboard" : "Go to your workspace"}
        </Link>
      )}
    </div>
  );
}
