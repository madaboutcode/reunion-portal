import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { clearAuth, getAuthRole, resolveStaffLanding } from "@/lib/auth";
import { clearScopeCache } from "@/hooks/useStaffScopes";
import { fetchMyPermissions } from "@/lib/staff-api";

/**
 * CONTRACT: Role-only staff landing for users with no usable staff feature
 *   (tasks/registration-desk.design.md "No-access landing page").
 *
 * GUARANTEES:
 *   - Renders only inside the staff/admin ProtectedRoute (App.tsx) — it is
 *     feature-scope-free and makes no dashboard or feature API calls.
 *   - With `?reason=fetch` it explains that permissions could not be loaded
 *     and offers a Retry that re-fetches `/api/staff/me/permissions` and
 *     navigates to the resolved landing; a failed retry stays on the page.
 *   - Without `?reason=fetch` it explains that no staff feature is assigned.
 *   - Both modes offer Logout. It never claims a 403 when the cause is a
 *     permission-load failure (design.md §Redirect algorithm step 6).
 *
 * EXPECTS: mounted on a staff/admin role-gated route.
 *
 * FAILURE BEHAVIOR: retry failure keeps the user on the page (the button
 *   remains available); no navigation happens.
 */

export function StaffAccessDeniedPage() {
  useDocumentTitle("Access Denied");

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [retrying, setRetrying] = useState(false);

  const fetchFailure = searchParams.get("reason") === "fetch";

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetchMyPermissions();
      const scopes = res.permissions?.scopes ?? null;
      navigate(resolveStaffLanding(scopes, null, getAuthRole()), {
        replace: true,
      });
    } catch {
      // Permissions still cannot be loaded — stay here; the button allows
      // another attempt.
      setRetrying(false);
    }
  }

  function handleLogout() {
    clearAuth();
    clearScopeCache();
    navigate("/", { replace: true });
  }

  return (
    <div
      className="max-w-[560px] mx-auto px-5 py-16 text-center"
      role="alert"
      data-testid="staff-access-denied"
    >
      <h1 className="font-heading text-2xl text-charcoal mb-3">Access denied</h1>

      {fetchFailure ? (
        <>
          <p className="text-muted mb-2">
            We couldn&apos;t load your permissions. This may be a temporary
            network issue.
          </p>
          <p className="text-sm text-muted mb-8">
            If it keeps happening, ask an admin to check your account.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button onClick={handleRetry} loading={retrying} className="w-full sm:w-auto">
              Retry
            </Button>
            <Button variant="secondary" onClick={handleLogout} className="w-full sm:w-auto">
              Logout
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted mb-2">
            No staff features are assigned to your account.
          </p>
          <p className="text-sm text-muted mb-8">
            Ask an admin to update your permissions if you think this is a
            mistake.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button variant="secondary" onClick={handleLogout} className="w-full sm:w-auto">
              Logout
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
