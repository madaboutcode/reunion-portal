/**
 * Permission-aware staff landing — unit tests for resolveStaffLanding and
 * isSafeInternalPath (tasks/registration-desk.design.md "Post-Login
 * Destination Design", plan Task 1 / acceptance criteria).
 *
 * These are pure-function tests — no mocks, no rendering. They pin the
 * redirect algorithm: full access → dashboard, desk-only → /staff/check-in,
 * denied returnTo discarded, empty scopes → /staff/access-denied.
 */

import { describe, expect, it } from "vitest";
import {
  isSafeInternalPath,
  resolveStaffLanding,
  getDefaultStaffRoute,
  STAFF_LANDING_ROUTES,
} from "@/lib/auth";
import { extractPassCode } from "@/lib/desk-utils";

describe("STAFF_LANDING_ROUTES — shared ordered registry", () => {
  it("orders dashboard first and registration_desk second (design.md priority table)", () => {
    expect(STAFF_LANDING_ROUTES[0]).toEqual({ scope: "dashboard", route: "/staff/dashboard" });
    expect(STAFF_LANDING_ROUTES[1]).toEqual({ scope: "registration_desk", route: "/staff/check-in" });
    expect(STAFF_LANDING_ROUTES.map((r) => r.scope)).toEqual([
      "dashboard",
      "registration_desk",
      "resources",
      "reports",
      "allocation",
      "bank_txns",
      "admin-tools",
    ]);
  });
});

describe("resolveStaffLanding — full access (null scopes / admin)", () => {
  it("treats null permissions as full access → /staff/dashboard", () => {
    expect(resolveStaffLanding(null, null, "staff")).toBe("/staff/dashboard");
  });

  it("admin role lands on /staff/dashboard regardless of scopes", () => {
    expect(resolveStaffLanding([], null, "admin")).toBe("/staff/dashboard");
    expect(resolveStaffLanding(["reports"], null, "admin")).toBe("/staff/dashboard");
  });

  it("full access honors a safe internal returnTo", () => {
    expect(resolveStaffLanding(null, "/staff/registrations/42", "staff")).toBe(
      "/staff/registrations/42",
    );
  });
});

describe("resolveStaffLanding — desk-only landing", () => {
  it("a registration_desk-only user lands on /staff/check-in", () => {
    expect(resolveStaffLanding(["registration_desk"], null, "staff")).toBe(
      "/staff/check-in",
    );
  });

  it("a dashboard returnTo is discarded for a desk-only user (design scenario 9)", () => {
    expect(
      resolveStaffLanding(["registration_desk"], "/staff/dashboard", "staff"),
    ).toBe("/staff/check-in");
  });

  it("a registration-detail returnTo is discarded for a desk-only user", () => {
    expect(
      resolveStaffLanding(["registration_desk"], "/staff/registrations/42", "staff"),
    ).toBe("/staff/check-in");
  });

  it("a desk user never resolves to /staff/dashboard from any denied returnTo", () => {
    const deniedReturnTos = [
      "/staff/dashboard",
      "/staff/registrations/42",
      "/staff/refunds",
      "/staff/archived",
      "/staff/coming",
    ];
    for (const returnTo of deniedReturnTos) {
      expect(resolveStaffLanding(["registration_desk"], returnTo, "staff")).toBe(
        "/staff/check-in",
      );
    }
  });
});

describe("resolveStaffLanding — multi-scope and other scopes", () => {
  it("a user with several scopes lands on the FIRST permitted route in the registry", () => {
    expect(resolveStaffLanding(["reports", "registration_desk"], null, "staff")).toBe(
      "/staff/check-in",
    );
    expect(resolveStaffLanding(["allocation", "reports"], null, "staff")).toBe(
      "/staff/reports",
    );
  });

  it("a reports-only user lands on /staff/reports", () => {
    expect(resolveStaffLanding(["reports"], null, "staff")).toBe("/staff/reports");
  });

  it("an empty scope list lands on /staff/access-denied (design step 5)", () => {
    expect(resolveStaffLanding([], null, "staff")).toBe("/staff/access-denied");
  });

  it("a scoped user whose returnTo's scope is present keeps the returnTo", () => {
    expect(resolveStaffLanding(["reports"], "/staff/reports", "staff")).toBe(
      "/staff/reports",
    );
    expect(resolveStaffLanding(["bank_txns"], "/staff/bank-transactions", "staff")).toBe(
      "/staff/bank-transactions",
    );
    expect(resolveStaffLanding(["resources"], "/staff/rooms", "staff")).toBe(
      "/staff/rooms",
    );
  });

  it("a non-staff internal returnTo (public route) is allowed for a scoped user", () => {
    expect(resolveStaffLanding(["registration_desk"], "/register", "staff")).toBe(
      "/register",
    );
  });
});

describe("resolveStaffLanding — returnTo safety", () => {
  it("discards an external/absolute returnTo", () => {
    expect(resolveStaffLanding(null, "https://evil.example.com", "staff")).toBe(
      "/staff/dashboard",
    );
  });

  it("discards a protocol-relative returnTo", () => {
    expect(resolveStaffLanding(null, "//evil.example.com", "staff")).toBe(
      "/staff/dashboard",
    );
  });

  it("discards an admin-only returnTo for a non-admin scoped user (no team loop)", () => {
    expect(resolveStaffLanding(["dashboard"], "/staff/team", "staff")).toBe(
      "/staff/dashboard",
    );
  });

  it("allows an admin-only returnTo for an admin", () => {
    expect(resolveStaffLanding(["dashboard"], "/staff/team", "admin")).toBe(
      "/staff/team",
    );
  });
});

describe("isSafeInternalPath", () => {
  it("accepts a plain internal path", () => {
    expect(isSafeInternalPath("/staff/check-in")).toBe(true);
  });

  it("rejects absolute URLs", () => {
    expect(isSafeInternalPath("https://example.com/path")).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isSafeInternalPath("//example.com/path")).toBe(false);
  });

  it("rejects non-slash paths", () => {
    expect(isSafeInternalPath("staff/dashboard")).toBe(false);
  });
});

describe("getDefaultStaffRoute — scope-only wrapper", () => {
  it("null (full access) → dashboard", () => {
    expect(getDefaultStaffRoute(null)).toBe("/staff/dashboard");
  });

  it("desk-only → /staff/check-in", () => {
    expect(getDefaultStaffRoute(["registration_desk"])).toBe("/staff/check-in");
  });

  it("empty scopes → /staff/access-denied (no silent '/' fallback)", () => {
    expect(getDefaultStaffRoute([])).toBe("/staff/access-denied");
  });
});

describe("extractPassCode — QR payload vs bare code", () => {
  it("passes a bare code through unchanged (normalized)", () => {
    expect(extractPassCode("SMRT79WW4A25NWG1")).toBe("SMRT79WW4A25NWG1");
  });

  it("extracts the code from the pass page URL fragment (pass.routes.ts QR_CODE_URL)", () => {
    expect(extractPassCode("/pass#SMRT79WW4A25NWG1")).toBe("SMRT79WW4A25NWG1");
    expect(extractPassCode("https://app.example.test/pass#SMRT79WW4A25NWG1")).toBe(
      "SMRT79WW4A25NWG1",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(extractPassCode("  SMRT79WW4A25NWG1  ")).toBe("SMRT79WW4A25NWG1");
  });

  it("returns the trimmed input when no fragment exists", () => {
    expect(extractPassCode("pass")).toBe("pass");
  });
});
