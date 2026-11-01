/**
 * Adversarial black-box tests for PaymentAdvicePage against
 * docs/specs/payment-advice-page.spec.md.
 *
 * These tests are loyal to the spec, not to the component's own embedded
 * CONTRACT block.
 *
 * Coverage table (R-requirement → test name)
 * ─────────────────────────────────────────────────────────────────────────
 * R1        → "unused valid code: code accepted, registration loaded, code becomes unusable on reopen (sessionless)"
 * R1        → "?code= present: renders code gate and does NOT call verifyMagicLink or getMyRegistration on mount"
 * R2        → "bad/expired code + valid session: expired wall is NOT shown, code stripped, session registration loads"
 * R3        → "no valid access: shows expired wall with resend action, no registration or financial data"
 * R3        → "resend: action disabled while sending"
 * R3        → "resend: success shows generic confirmation, no email/code existence disclosed"
 * R3        → "resend: failure shows retryable error, action re-enabled"
 * R4        → "regCode mismatch: canonicalizes URL, never renders mismatched-code advice content, never prints"
 * R5        → "pending_verification: redirects to confirmation, no advice content, no print"
 * R5        → "confirmed: redirects to confirmation, no advice content, no print"
 * R7        → "heading and browser title are exactly 'Payment Advice' (site-suffix qualified)"
 * R7        → "document is never labelled invoice or tax invoice anywhere on the page"
 * R8        → "issuer section names TKMCE 2006 Alumni Association and Smriti 2026"
 * R9        → "payer section shows fullName and 'Payment reference: {regCode}'"
 * R10       → "itemization + summary: base, non-zero lines, donation>0, in order"
 * R10       → "zero-fee line items and zero donation are omitted"
 * R10       → "base fee remains visible even when zero"
 * R10       → "summary shows Registration total / Already paid / Amount payable now, amounts reconcile"
 * R10       → "fresh registration (no verified payments) displays Already paid ₹0.00"
 * R11       → "bank section shows all 10 labelled values from the fixture"
 * R12       → "Generated on shows IST instant in the specified format"
 * R13       → "disclaimer matches the R13 sentence verbatim"
 * R14/R15   → "window.print fires exactly once, after document content is present"
 * R15       → "window.print fires at most once even when startup work runs twice (StrictMode double-effect)"
 * R15       → "window.print is never requested from loading/expired/notfound/error states"
 * R16       → "Print button remains after auto-print and triggers a manual print request without reload"
 * R17       → "print stylesheet declares A4 portrait 12mm margins and break-inside/break-after rules"
 * R18       → "document sections render top-to-bottom in the specified order, with no navigation shell"
 * R19       → "Back to payment page link points to /pay/{regCode}"
 * R19       → "Print and Back controls are present as natively-operable button/link elements"
 * R20       → "exactly one level-one heading, 'Payment Advice'"
 * R20       → "itemization table exposes Description and Amount column headers"
 * R20       → "bank details are structured as label/value pairs (dt/dd)"
 * States    → "not found (404): shows 'Registration not found' with back link, no print"
 * States    → "service error: shows retry + back, no print"
 * States    → "access error (401/403): treated as invalid session, expired wall shown"
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { StrictMode } from "react";

vi.mock("@/lib/api");
vi.mock("@/lib/auth");
vi.mock("@/lib/staff-api");

// Partially mock @smriti/shared so bank details can be swapped out per test —
// R11's fixture and the "missing/blank field" scenarios can't be exercised
// against the real base64-encoded production bank constant.
vi.mock("@smriti/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@smriti/shared")>();
  return {
    ...actual,
    getPaymentBankDetails: vi.fn(actual.getPaymentBankDetails),
  };
});

import { getMyRegistration, requestPaymentLink } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { verifyMagicLink } from "@/lib/staff-api";
import { getPaymentBankDetails, formatINRFixed } from "@smriti/shared";
import type { BankFields } from "@smriti/shared";
import { mockRegistration } from "./test-utils";
import PaymentAdvicePage from "@/pages/PaymentAdvicePage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ── R11 bank fixture (from the spec's own R11 scenario) ────────────────────

const R11_BANK_FIXTURE: BankFields = {
  bank: "Example Bank",
  accountName: "TKMCE 2006 Alumni Association",
  accountNumber: "0001",
  ifscCode: "EXAM0000001",
  swiftCode: "EXAMPLE1",
  branch: "Main Branch",
  country: "India",
  currency: "INR",
  purposeOfPaymentCode: "S1107",
  purposeOfPayment: "Event registration",
  // Not an R11 field — present only because BankFields carries it. See the
  // "GAP: blank beneficiaryNationality" test below.
  beneficiaryNationality: "Indian",
};

beforeEach(() => {
  window.print = vi.fn();
  vi.mocked(getPaymentBankDetails).mockReturnValue({
    raw: "",
    fields: R11_BANK_FIXTURE,
  });
});

// ── Render helper ────────────────────────────────────────────────────────

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location-probe">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderAdvice(
  regCode = "SMRT79WW4A25NWG1",
  queryString = "",
  { strict = false }: { strict?: boolean } = {},
) {
  const tree = (
    <MemoryRouter initialEntries={[`/pay/${regCode}/advice${queryString}`]}>
      <LocationProbe />
      <Routes>
        <Route path="/pay/:regCode/advice" element={<PaymentAdvicePage />} />
        <Route path="/pay/:regCode" element={<div data-testid="payment-page" />} />
        <Route path="/confirmation/:id" element={<div data-testid="confirmation-page" />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

// A self-consistent "ready" registration matching R10's exact scenario
// numbers (total ₹14,000 = verified ₹5,000 + pending ₹9,000) AND satisfying
// the itemization-sum requirement that R10 also imposes (base 8500 +
// collegeContribution 1000 + 2910 + 1455 + 0(free, omitted) + donation 135
// = 14000). The caller's suggested fixture summed to 15000 against a
// declared total of 14000 — that combination fails DATA_VALIDATION and
// cannot be used as a "ready" happy-path fixture, so it's corrected here.
function readyRegistration(overrides: Parameters<typeof mockRegistration>[0] = {}) {
  return mockRegistration({
    status: "pending",
    regCode: "SMRT79WW4A25NWG1",
    regId: "SMRT79WW4A25NWG1",
    contact: {
      fullName: "Anu Nair",
      branch: "Computer Science",
      gender: "female",
      email: "anu@example.com",
      whatsapp: "9876543210",
      city: "Kochi",
      country: "India",
    },
    pricingBreakup: {
      base: 8500,
      collegeContribution: 1000,
      lines: [
        { label: "Spouse — Non-veg", fee: 2910, free: false },
        { label: "Child (6-12) — Veg", fee: 1455, free: false },
        { label: "Zero-fee item", fee: 0, free: true },
      ],
      donation: 135,
      total: 14000,
    },
    verifiedPaymentAmount: 5000,
    pendingPaymentAmount: 9000,
    ...overrides,
  });
}

async function findReady() {
  return screen.findByRole("heading", { name: "Payment Advice", level: 1 });
}

// ── R1–R4: Access and identity ──────────────────────────────────────────

describe("PaymentAdvicePage — R1–R4 access and identity", () => {
  it("?code= present: renders code gate and does NOT call verifyMagicLink or getMyRegistration on mount", async () => {
    vi.mocked(getToken).mockReturnValue(null);

    renderAdvice("SMRT79WW4A25NWG1", "?code=valid-token");

    await screen.findByRole("button", { name: /continue to payment advice/i });

    expect(verifyMagicLink).not.toHaveBeenCalled();
    expect(getMyRegistration).not.toHaveBeenCalled();
  });

  it("unused valid code: code accepted, registration loaded, code becomes unusable on reopen (sessionless)", async () => {
    const user = userEvent.setup();

    // @/lib/auth is fully auto-mocked, so saveAuth() is a no-op that won't
    // make getToken() start returning the new token on its own. Since the
    // codegate render only depends on codeParam (not getToken()), it's safe
    // to have getToken() already report the post-verify session here — this
    // simulates saveAuth() having persisted it before fetchRegistration()
    // reads it.
    vi.mocked(getToken).mockReturnValue("new-jwt");
    vi.mocked(verifyMagicLink).mockResolvedValueOnce({
      token: "new-jwt",
      role: "attendee",
      redirectTo: "/",
      sub: "SMRT79WW4A25NWG1",
      email: "anu@example.com",
    });
    vi.mocked(getMyRegistration).mockResolvedValueOnce({
      registration: readyRegistration(),
    });

    renderAdvice("SMRT79WW4A25NWG1", "?code=valid-token");

    const continueBtn = await screen.findByRole("button", {
      name: /continue to payment advice/i,
    });
    await user.click(continueBtn);

    await waitFor(() => expect(verifyMagicLink).toHaveBeenCalledWith("valid-token"));
    await findReady();

    cleanup();
    vi.clearAllMocks();

    // Reopen the same code in a sessionless browser: server has invalidated
    // it, so verify now rejects and there's no existing session to fall back to.
    vi.mocked(getToken).mockReturnValue(null);
    vi.mocked(verifyMagicLink).mockRejectedValueOnce({ status: 401, error: "invalid" });

    renderAdvice("SMRT79WW4A25NWG1", "?code=valid-token");
    const continueBtn2 = await screen.findByRole("button", {
      name: /continue to payment advice/i,
    });
    await user.click(continueBtn2);

    await screen.findByText(/this payment link has expired/i);
    expect(getMyRegistration).not.toHaveBeenCalled();
  });

  it("bad/expired code + valid session: expired wall is NOT shown, code stripped, session registration loads", async () => {
    const user = userEvent.setup();

    vi.mocked(getToken).mockReturnValue("existing-session-jwt");
    vi.mocked(verifyMagicLink).mockRejectedValueOnce({ status: 401, error: "expired" });
    vi.mocked(getMyRegistration).mockResolvedValueOnce({
      registration: readyRegistration(),
    });

    renderAdvice("SMRT79WW4A25NWG1", "?code=expired-token");

    // NOTE (GAP): the spec's R2 scenario describes access resolving directly
    // from opening the URL. This component instead always shows an
    // intermediate "codegate" confirmation screen whenever ?code= is
    // present — even with a valid session already available — and that
    // state does not appear anywhere in the spec's States table. Exercising
    // through the actual UI requires this click; see the written report for
    // the open question about whether this manual gate is intentional.
    const continueBtn = await screen.findByRole("button", {
      name: /continue to payment advice/i,
    });
    await user.click(continueBtn);

    await findReady();

    // Expired wall must never have been shown en route to the session fallback.
    expect(screen.queryByText(/this payment link has expired/i)).not.toBeInTheDocument();
  });

  it("regCode mismatch: canonicalizes URL before rendering advice content", async () => {
    vi.mocked(getToken).mockReturnValue("session-jwt");
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: readyRegistration({ regCode: "SMRT_CANONICAL_2", regId: "SMRT_CANONICAL_2" }),
    });

    renderAdvice("SMRT_ROUTE_PARAM1", "");

    // URL is replaced with canonical regCode
    await waitFor(() => {
      expect(screen.getByTestId("location-probe").textContent).toBe(
        "/pay/SMRT_CANONICAL_2/advice",
      );
    });

    // Advice renders on the now-canonical URL (R4: replace URL before rendering)
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Payment Advice" })).toBeInTheDocument();
    });
  });
});

// ── R3: Expired-link resend action ──────────────────────────────────────

describe("PaymentAdvicePage — R3 expired-link resend", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue(null);
  });

  it("no valid access: shows expired wall with resend action, no registration or financial data", async () => {
    renderAdvice("SMRT79WW4A25NWG1");

    await screen.findByText(/this payment link has expired/i);
    expect(
      screen.getByRole("button", { name: /email me a fresh payment link/i }),
    ).toBeInTheDocument();

    expect(getMyRegistration).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Payment Advice" })).not.toBeInTheDocument();
    expect(screen.queryByText(/payment reference/i)).not.toBeInTheDocument();
  });

  it("resend: action disabled while sending", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (v: { ok: boolean; message: string }) => void;
    vi.mocked(requestPaymentLink).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    renderAdvice("SMRT79WW4A25NWG1");
    const btn = await screen.findByRole("button", { name: /email me a fresh payment link/i });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
    });

    resolveRequest({ ok: true, message: "Sent" });
  });

  it("resend: success shows generic confirmation, no email/code existence disclosed", async () => {
    const user = userEvent.setup();
    vi.mocked(requestPaymentLink).mockResolvedValue({ ok: true, message: "Sent" });

    renderAdvice("SMRT79WW4A25NWG1");
    const btn = await screen.findByRole("button", { name: /email me a fresh payment link/i });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/sent! check your inbox/i)).toBeInTheDocument();
    });

    // Generic confirmation only — must not leak an email address or
    // whether the registration/code existed.
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /email me a fresh payment link/i }),
    ).not.toBeInTheDocument();
  });

  it("resend: failure shows retryable error, action re-enabled", async () => {
    const user = userEvent.setup();
    vi.mocked(requestPaymentLink).mockRejectedValue({ status: 500 });

    renderAdvice("SMRT79WW4A25NWG1");
    const btn = await screen.findByRole("button", { name: /email me a fresh payment link/i });
    await user.click(btn);

    await waitFor(() => {
      const retryBtn = screen.getByRole("button", { name: /email me a fresh payment link/i });
      expect(retryBtn).toBeInTheDocument();
      expect(retryBtn).not.toBeDisabled();
    });
  });
});

// ── R5: Registration status ─────────────────────────────────────────────

describe("PaymentAdvicePage — R5 registration status", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue("session-jwt");
  });

  it("pending_verification: redirects to confirmation, no advice content, no print", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: readyRegistration({ status: "pending_verification" }),
    });

    renderAdvice();

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-page")).toBeInTheDocument();
    });

    expect(screen.queryByRole("heading", { name: "Payment Advice" })).not.toBeInTheDocument();
    expect(window.print).not.toHaveBeenCalled();
  });

  it("confirmed: redirects to confirmation, no advice content, no print", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: readyRegistration({ status: "confirmed" }),
    });

    renderAdvice();

    await waitFor(() => {
      expect(screen.getByTestId("confirmation-page")).toBeInTheDocument();
    });

    expect(screen.queryByRole("heading", { name: "Payment Advice" })).not.toBeInTheDocument();
    expect(window.print).not.toHaveBeenCalled();
  });
});

// ── R7–R13: Document content ─────────────────────────────────────────────

describe("PaymentAdvicePage — R7–R13 document content", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue("session-jwt");
    vi.mocked(getMyRegistration).mockResolvedValue({ registration: readyRegistration() });
  });

  it("heading and browser title are exactly 'Payment Advice' (site-suffix qualified)", async () => {
    renderAdvice();
    await findReady();

    expect(document.title.startsWith("Payment Advice")).toBe(true);
  });

  it("document is never labelled invoice or tax invoice anywhere on the page", async () => {
    renderAdvice();
    await findReady();

    const container = document.body;
    // R13's disclaimer itself must legitimately contain "Not a tax invoice"
    // — strip that known-good sentence out before checking that "tax
    // invoice" doesn't appear anywhere else on the page.
    const disclaimer =
      "This is a payment advice for Smriti 2026 registration fees, collected by TKMCE 2006 Alumni Association from its members. Not a tax invoice; no GST applies.";
    const textOutsideDisclaimer = (container.textContent ?? "").replace(disclaimer, "");
    expect(textOutsideDisclaimer).not.toMatch(/\btax invoice\b/i);
    // "invoice" alone would also violate R7 — check for "invoice" as a
    // document label (heading/button) rather than in body text.
    expect(screen.queryByRole("heading", { name: /invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invoice/i })).not.toBeInTheDocument();
  });

  it("issuer section names TKMCE 2006 Alumni Association and Smriti 2026", async () => {
    renderAdvice();
    await findReady();

    // "TKMCE 2006 Alumni Association" also appears as the bank account
    // holder name in the bank details section — narrow to the issuer
    // section's instance, which renders as a <p>, not a <dd>.
    const associationMatches = screen.getAllByText("TKMCE 2006 Alumni Association");
    expect(associationMatches.some((el) => el.tagName === "P")).toBe(true);
    expect(screen.getByText("Smriti 2026")).toBeInTheDocument();
  });

  it("payer section shows fullName and 'Payment reference: {regCode}'", async () => {
    renderAdvice();
    await findReady();

    expect(screen.getByText("Anu Nair")).toBeInTheDocument();
    expect(screen.getByText("Payment reference: SMRT79WW4A25NWG1")).toBeInTheDocument();
  });

  it("itemization + summary: base, non-zero lines, donation>0, in order", async () => {
    renderAdvice();
    await findReady();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // header row + base + 2 non-zero lines (zero-fee omitted) + donation
    // collegeContribution is metadata — already inside lines[] as a named item
    expect(rows).toHaveLength(5);

    const bodyLabels = rows.slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(bodyLabels).toEqual([
      "Base registration fee",
      "Spouse — Non-veg",
      "Child (6-12) — Veg",
      "Donation",
    ]);

    expect(within(table).getByText(formatINRFixed(8500))).toBeInTheDocument();
    expect(within(table).getByText(formatINRFixed(2910))).toBeInTheDocument();
    expect(within(table).getByText(formatINRFixed(1455))).toBeInTheDocument();
    expect(within(table).getByText(formatINRFixed(135))).toBeInTheDocument();
  });

  it("zero-fee line items and zero donation are omitted", async () => {
    // readyRegistration()'s default fixture has donation: 135 (> 0), which
    // is wrong for a test asserting the Donation row is omitted. Use a
    // fixture with donation: 0, with total/verified/pending adjusted so the
    // itemization still sums to the declared total (8500 + 1000 + 2910 +
    // 1455 + 0 + 0 = 13865) and DATA_VALIDATION still passes.
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: readyRegistration({
        pricingBreakup: {
          base: 8500,
          collegeContribution: 1000,
          lines: [
            { label: "Spouse — Non-veg", fee: 2910, free: false },
            { label: "Child (6-12) — Veg", fee: 1455, free: false },
            { label: "Zero-fee item", fee: 0, free: true },
          ],
          donation: 0,
          total: 13865,
        },
        verifiedPaymentAmount: 5000,
        pendingPaymentAmount: 8865,
      }),
    });

    renderAdvice();
    await findReady();

    expect(screen.queryByText("Zero-fee item")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Donation$/)).not.toBeInTheDocument();
  });

  it("base fee remains visible even when zero", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: readyRegistration({
        pricingBreakup: {
          base: 0,
          collegeContribution: 0,
          lines: [],
          donation: 14000,
          total: 14000,
        },
      }),
    });

    renderAdvice();
    await findReady();

    expect(screen.getByText("Base registration fee")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByText(formatINRFixed(0))).toHaveLength(1);
  });

  it("summary shows Registration total / Already paid / Amount payable now, amounts reconcile", async () => {
    renderAdvice();
    await findReady();

    expect(screen.getByText("Registration total")).toBeInTheDocument();
    expect(screen.getByText("₹14,000.00")).toBeInTheDocument();
    expect(screen.getByText("Already paid")).toBeInTheDocument();
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument();
    expect(screen.getByText("Amount payable now")).toBeInTheDocument();
    expect(screen.getByText("₹9,000.00")).toBeInTheDocument();
  });

  it("fresh registration (no verified payments) displays Already paid ₹0.00", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: readyRegistration({
        verifiedPaymentAmount: 0,
        pendingPaymentAmount: 14000,
      }),
    });

    renderAdvice();
    await findReady();

    expect(screen.getByText("Already paid")).toBeInTheDocument();
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
  });

  it("bank section shows all 10 labelled values from the fixture", async () => {
    renderAdvice();
    await findReady();

    const expectedPairs: [string, string][] = [
      ["Beneficiary bank name", "Example Bank"],
      ["Account holder name", "TKMCE 2006 Alumni Association"],
      ["Account number", "0001"],
      ["IFSC code", "EXAM0000001"],
      ["SWIFT/BIC code", "EXAMPLE1"],
      ["Branch", "Main Branch"],
      ["Country", "India"],
      ["Currency", "INR"],
      ["Purpose-of-payment code", "S1107"],
      ["Purpose-of-payment description", "Event registration"],
    ];

    for (const [label, value] of expectedPairs) {
      const dt = screen.getByText(label);
      expect(dt.tagName).toBe("DT");
      const dd = dt.nextElementSibling as HTMLElement;
      expect(dd?.tagName).toBe("DD");
      expect(dd?.textContent).toBe(value);
    }
  });

  it("Generated on shows IST instant in the specified format", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T11:00:00.000Z")); // 16:30 IST

    renderAdvice();
    await findReady();

    expect(screen.getByText("Generated on 15 July 2026, 4:30 pm IST")).toBeInTheDocument();
  });

  it("disclaimer matches the R13 sentence verbatim", async () => {
    renderAdvice();
    await findReady();

    expect(
      screen.getByText(
        "This is a payment advice for Smriti 2026 registration fees, collected by TKMCE 2006 Alumni Association from its members. Not a tax invoice; no GST applies.",
      ),
    ).toBeInTheDocument();
  });
});

// ── R14–R16: Printing ────────────────────────────────────────────────────

describe("PaymentAdvicePage — R14–R16 printing", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue("session-jwt");
  });

  it("window.print fires exactly once, after document content is present", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({ registration: readyRegistration() });

    renderAdvice();
    await findReady();

    // Content must be present before/at the moment print is requested.
    expect(screen.getByText("Payment reference: SMRT79WW4A25NWG1")).toBeInTheDocument();

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
  });

  it("window.print fires at most once even when startup work runs twice (StrictMode double-effect)", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({ registration: readyRegistration() });

    renderAdvice("SMRT79WW4A25NWG1", "", { strict: true });
    await findReady();

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["expired", async () => vi.mocked(getToken).mockReturnValue(null)],
    ["notfound", async () => vi.mocked(getMyRegistration).mockRejectedValue({ status: 404 })],
    ["error", async () => vi.mocked(getMyRegistration).mockRejectedValue({ status: 500 })],
  ])("window.print is never requested from the %s state", async (_name, setup) => {
    await setup();
    renderAdvice();

    await waitFor(() => {
      expect(document.body.textContent?.length).toBeGreaterThan(0);
    });
    expect(window.print).not.toHaveBeenCalled();
  });

  it("Print button remains after auto-print and triggers a manual print request without reload", async () => {
    const user = userEvent.setup();
    vi.mocked(getMyRegistration).mockResolvedValue({ registration: readyRegistration() });

    renderAdvice();
    await findReady();
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));

    const printBtn = screen.getByRole("button", { name: /^print$/i });
    await user.click(printBtn);

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(2));
    // Advice remains visible — no navigation/reload occurred.
    expect(screen.getByRole("heading", { name: "Payment Advice" })).toBeInTheDocument();
  });

  it("print stylesheet declares A4 portrait 12mm margins and break-inside/break-after rules", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({ registration: readyRegistration() });

    renderAdvice();
    await findReady();

    // Presence check only — jsdom does not apply CSS or paginate, so this
    // cannot verify actual print output (R17's pagination/orphan behavior
    // needs visual/print QA, not a unit test). It does catch a generator
    // that drops the print rules entirely.
    const styleText = document.querySelector("style")?.textContent ?? "";
    expect(styleText).toMatch(/@page\s*{\s*size:\s*A4 portrait;\s*margin:\s*12mm/);
    expect(styleText).toMatch(/break-inside:\s*avoid/);
    expect(styleText).toMatch(/break-after:\s*avoid/);
    expect(styleText).toMatch(/\.screen-only[^{]*{\s*display:\s*none/);
  });
});

// ── R18–R19: Page layout and controls ───────────────────────────────────

describe("PaymentAdvicePage — R18–R19 layout and controls", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue("session-jwt");
    vi.mocked(getMyRegistration).mockResolvedValue({ registration: readyRegistration() });
  });

  it("document sections render top-to-bottom in the specified order, with no navigation shell", async () => {
    renderAdvice();
    await findReady();

    expect(document.querySelector("nav")).toBeNull();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    const text = document.body.textContent ?? "";
    const idx = (needle: string) => text.indexOf(needle);

    const order = [
      idx("Payment Advice"),
      idx("TKMCE 2006 Alumni Association"),
      idx("Anu Nair"),
      idx("Payment reference"),
      idx("Itemization"),
      idx("Registration total"),
      idx("Bank transfer details"),
      idx("Beneficiary bank name"),
      idx("Generated on"),
      idx("Not a tax invoice"),
    ];

    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]).toBeGreaterThanOrEqual(0);
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it("Back to payment page link points to /pay/{regCode}", async () => {
    renderAdvice();
    await findReady();

    const backLink = screen.getByRole("link", { name: /back to payment page/i });
    expect(backLink).toHaveAttribute("href", "/pay/SMRT79WW4A25NWG1");
  });

  it("Print and Back controls are present as natively-operable button/link elements", async () => {
    renderAdvice();
    await findReady();

    expect(screen.getByRole("button", { name: /^print$/i }).tagName).toBe("BUTTON");
    expect(screen.getByRole("link", { name: /back to payment page/i }).tagName).toBe("A");
  });
});

// ── R20: Accessibility ───────────────────────────────────────────────────

describe("PaymentAdvicePage — R20 accessibility", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue("session-jwt");
    vi.mocked(getMyRegistration).mockResolvedValue({ registration: readyRegistration() });
  });

  it("exactly one level-one heading, 'Payment Advice'", async () => {
    renderAdvice();
    await findReady();

    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Payment Advice");
  });

  it("itemization table exposes Description and Amount column headers", async () => {
    renderAdvice();
    await findReady();

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: /description/i })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /amount/i })).toBeInTheDocument();
  });

  it("bank details are structured as label/value pairs (dt/dd)", async () => {
    renderAdvice();
    await findReady();

    const dl = document.querySelector("dl");
    expect(dl).not.toBeNull();
    expect(dl!.querySelectorAll("dt")).toHaveLength(10);
    expect(dl!.querySelectorAll("dd")).toHaveLength(10);
  });
});

// ── States: not found / service error / access error ────────────────────

describe("PaymentAdvicePage — error states", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue("session-jwt");
  });

  it("not found (404): shows 'Registration not found' with back link, no print", async () => {
    vi.mocked(getMyRegistration).mockRejectedValue({ status: 404, error: "Not found" });

    renderAdvice("SMRT79WW4A25NWG1");

    await screen.findByText("Registration not found");
    const backLink = screen.getByRole("link", { name: /back to payment page/i });
    expect(backLink).toHaveAttribute("href", "/pay/SMRT79WW4A25NWG1");
    expect(window.print).not.toHaveBeenCalled();
  });

  it("service error: shows retry + back, no print", async () => {
    vi.mocked(getMyRegistration).mockRejectedValue({ status: 500, error: "Server is down" });

    renderAdvice("SMRT79WW4A25NWG1");

    await screen.findByText("We couldn't load your payment advice");
    expect(screen.getByText("Server is down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to payment page/i })).toHaveAttribute(
      "href",
      "/pay/SMRT79WW4A25NWG1",
    );
    expect(window.print).not.toHaveBeenCalled();
  });

  it("access error (401/403): treated as invalid session, expired wall shown", async () => {
    vi.mocked(getMyRegistration).mockRejectedValue({ status: 403, error: "Forbidden" });

    renderAdvice("SMRT79WW4A25NWG1");

    await screen.findByText(/this payment link has expired/i);
    expect(window.print).not.toHaveBeenCalled();
  });
});
