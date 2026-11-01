import { useEffect, useState } from "react";
import { getAuthRole, isAdmin, isStaff } from "@/lib/auth";
import { fetchMyPermissions } from "@/lib/staff-api";
import type { StaffScope } from "@/lib/staff-types";

export type StaffRole = "staff" | "admin" | null;

// Maps the raw localStorage role to the staff/admin/null triad used by the
// scope-guard consumers (spec R5.5). Any non-staff role (e.g. "attendee") → null.
function currentStaffRole(): StaffRole {
  if (isAdmin()) return "admin";
  if (getAuthRole() === "staff") return "staff";
  return null;
}

// Distinct sentinel for a permissions-FETCH failure, kept separate from the
// legitimate "full-access staff" state (permissions resolved with no scopes).
// Conflating the two used to fail OPEN (grant everything) on a fetch error —
// see hasScope below for the fail-closed fix.
const FETCH_ERROR = Symbol("permissions-fetch-error");

let cachedScopes: StaffScope[] | null | typeof FETCH_ERROR | undefined = undefined;
let fetchPromise: Promise<void> | null = null;

function doFetch(): Promise<void> {
  if (!fetchPromise) {
    fetchPromise = fetchMyPermissions()
      .then((res) => {
        cachedScopes = (res.permissions?.scopes as StaffScope[] | undefined) ?? null;
      })
      .catch(() => {
        cachedScopes = FETCH_ERROR;
      });
  }
  return fetchPromise;
}

export function clearScopeCache(): void {
  cachedScopes = undefined;
  fetchPromise = null;
}

export function useStaffScopes(): {
  loaded: boolean;
  role: StaffRole;
  hasScope: (scope: StaffScope) => boolean;
} {
  const [loaded, setLoaded] = useState(cachedScopes !== undefined);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isStaff()) {
      setLoaded(true);
      return;
    }
    if (cachedScopes !== undefined) {
      setLoaded(true);
      return;
    }
    doFetch().then(() => {
      setLoaded(true);
      setTick((t) => t + 1);
    });
  }, []);

  const hasScope = (scope: StaffScope): boolean => {
    if (isAdmin()) return true;
    if (cachedScopes === FETCH_ERROR) return false; // fetch failed → fail closed, grant nothing
    if (cachedScopes === null) return true; // legit full-access staff (permissions resolved with no scopes)
    return cachedScopes?.includes(scope) ?? false;
  };

  return { loaded, role: currentStaffRole(), hasScope };
}
