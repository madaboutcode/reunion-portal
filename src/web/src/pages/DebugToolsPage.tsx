import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Button } from "@/components/ui/Button";
import type { WizardDraft } from "@/types/registration";

// localStorage key constants — must match auth.ts and usePersistence.ts
const TOKEN_KEY = "smriti_token";
const REG_ID_KEY = "smriti_reg_id";
const REG_CODE_KEY = "smriti_reg_code"; // debug tool only — not used by auth.ts
const DRAFT_KEY = "smriti_reg_v5"; // must match usePersistence.ts STORAGE_KEY

// Short random suffix so test emails don't collide on repeated use
const uid = () => Math.random().toString(36).slice(2, 7);

// ─── Registration Path Scenarios ─────────────────────────────────────────────

type RegistrationPath =
  | "fc_solo"
  | "fc_family_private"
  | "campus_family"
  | "donation_felicit";

type PaymentStatus = "not_submitted" | "pending" | "pending_verification" | "confirmed";

interface RegistrationPathOption {
  value: RegistrationPath;
  label: string;
  expectedTotal: string;
  description: string;
  draft: () => WizardDraft;
}

function baseDraft(): WizardDraft {
  return {
    fullName: "",
    branch: "",
    gender: "male",
    email: "",
    whatsapp: "",
    city: "",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "non_veg",
    tshirtSize: undefined,
    spouseName: "",
    spouseMeal: "veg",
    children: [],
    guests: [],
    accommodation: "none",
    extraBed: false,
    checkIn: "",
    checkOut: "",
    donationAmount: "",
    publicAcknowledgement: false,
    acknowledgementDisplayName: "",
    felicitationConsent: false,
    idFileName: "",
    idNote: "",
    collegeContribution: 500,
    collegeContributionCause: "",
    photoFileName: "",
  };
}

const REGISTRATION_PATHS: RegistrationPathOption[] = [
  // ── Full Celebration · Solo ────────────────────────────────────────────
  {
    value: "fc_solo",
    label: "Full Celebration · Solo",
    expectedTotal: "₹9,000",
    description: "Bare minimum — alumni only, no family, no accommodation, no donation. Tests all 7 steps render correctly for the most common path.",
    draft: () => ({
      ...baseDraft(),
      fullName: "Mundakkal Shekaran",
      branch: "Computer Science & Engineering",
      gender: "male",
      email: `shekaran.${uid()}@example.test`,
      whatsapp: "+919876543210",
      city: "Kochi",
      country: "India",
      alumniMeal: "non_veg",
      tshirtSize: "L",
      accommodation: "none",
      donationAmount: "",
      photoFileKey: "mock-photo-key-shekaran",
      photoFileType: "image/jpeg",
      photoFileSizeBytes: 87400,
      photoFileName: "shekaran_profile.jpg",
      idFileKey: "mock-id-key-shekaran",
      idFileType: "application/pdf",
      idFileSizeBytes: 245000,
      idFileName: "shekaran_aadhaar.pdf",
    }),
  },
  // ── Full Celebration · Family + Private ────────────────────────────────
  {
    value: "fc_family_private",
    label: "Full Celebration · Family + Private",
    expectedTotal: "₹28,980",
    description: "Spouse + 2 kids (age 4 free, age 8 paid) + private room 2 nights. Tests addl person fees, child age bands, and accommodation pricing.",
    draft: () => ({
      ...baseDraft(),
      fullName: "Karuthamma Chembankunju",
      branch: "Electronics & Communication Engineering",
      gender: "female",
      email: `karuthamma.${uid()}@example.test`,
      whatsapp: "+919845123456",
      city: "Trivandrum",
      country: "India",
      alumniMeal: "veg",
      tshirtSize: "M",
      spouseName: "Palani",
      spouseMeal: "non_veg",
      children: [
        { id: "c1", name: "Pareekutty", age: 8, meal: "non_veg" },
        { id: "c2", name: "Panchami", age: 4, meal: "veg" },
      ],
      accommodation: "private",
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      donationAmount: "",
      photoFileKey: "mock-photo-key-karuthamma",
      photoFileType: "image/jpeg",
      photoFileSizeBytes: 65500,
      photoFileName: "karuthamma_photo.jpg",
      idFileKey: "mock-id-key-karuthamma",
      idFileType: "image/jpeg",
      idFileSizeBytes: 182000,
      idFileName: "karuthamma_pan.jpg",
    }),
  },
  // ── Campus Only · Family ───────────────────────────────────────────────
  {
    value: "campus_family",
    label: "Campus Only · Family",
    expectedTotal: "₹32,325",
    description: "Spouse + child (age 8) + guest + ₹25K donation. Tests campus-only step skip (Step 4 hidden) and campus-specific addl person fees (lower than FC rates).",
    draft: () => ({
      ...baseDraft(),
      fullName: "Ganga Nakulan",
      branch: "Electrical & Electronics Engineering",
      gender: "female",
      email: `ganga.${uid()}@example.test`,
      whatsapp: "+919876540006",
      city: "Kollam",
      country: "India",
      participationType: "campus_only",
      alumniMeal: "veg",
      tshirtSize: "S",
      spouseName: "Nakulan",
      spouseMeal: "non_veg",
      children: [
        { id: "c1", name: "Sunny", age: 8, meal: "veg" },
      ],
      guests: [
        { id: "g1", name: "Mahadevan", relationship: "friend", meal: "veg" },
      ],
      accommodation: "none",
      donationAmount: "25000",
      collegeContribution: 500,
      photoFileKey: "mock-photo-key-ganga",
      photoFileType: "image/jpeg",
      photoFileSizeBytes: 68000,
      photoFileName: "ganga.jpg",
      idFileKey: "mock-id-key-ganga",
      idFileType: "image/jpeg",
      idFileSizeBytes: 175000,
      idFileName: "ganga_aadhaar.jpg",
    }),
  },
  // ── Donation Only · Felicitation ───────────────────────────────────────
  {
    value: "donation_felicit",
    label: "Donation Only · Felicitation",
    expectedTotal: "₹75,000",
    description: "No attendance, ₹75K donation with felicitation consent + public acknowledgement. Tests donation-only skip (Steps 3–4 hidden), felicitation UI (≥₹50K), and ID optional rule.",
    draft: () => ({
      ...baseDraft(),
      fullName: "Georgekutty",
      branch: "Chemical Engineering",
      gender: "male",
      email: `georgekutty.${uid()}@example.test`,
      whatsapp: "+14155551234",
      city: "San Francisco",
      country: "United States",
      attendanceIntent: "donation_only",
      participationType: "donation_only",
      alumniMeal: "veg",
      accommodation: "none",
      donationAmount: "75000",
      publicAcknowledgement: true,
      acknowledgementDisplayName: "Georgekutty",
      felicitationConsent: true,
      collegeContribution: 0,
      photoFileKey: "mock-photo-key-georgekutty",
      photoFileType: "image/jpeg",
      photoFileSizeBytes: 53000,
      photoFileName: "georgekutty.jpg",
      // no idFileKey — optional for donation_only
    }),
  },
];

const PAYMENT_STATUS_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: "not_submitted", label: "Not Submitted (ready for review)" },
  { value: "pending", label: "Pending (awaiting proof)" },
  { value: "pending_verification", label: "Pending Verification" },
  { value: "confirmed", label: "Confirmed" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomAlphaNum(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

function generateRegId(): string {
  return String(Math.floor(1001 + Math.random() * 8999));
}

function generateRegCode(): string {
  return "SMRT" + randomAlphaNum(12);
}

function generateFakeJwt(status: string): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(
    /=/g,
    "",
  );
  const payload = btoa(
    JSON.stringify({
      sub: generateRegId(),
      status,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    }),
  ).replace(/=/g, "");
  const sig = randomAlphaNum(32).toLowerCase();
  return `${header}.${payload}.${sig}`;
}

// ─── localStorage State ───────────────────────────────────────────────────────

interface StoredState {
  token: string | null;
  regId: string | null;
  regCode: string | null;
  draft: string | null;
}

function readStoredState(): StoredState {
  try {
    return {
      token: localStorage.getItem(TOKEN_KEY),
      regId: localStorage.getItem(REG_ID_KEY),
      regCode: localStorage.getItem(REG_CODE_KEY),
      draft: localStorage.getItem(DRAFT_KEY),
    };
  } catch {
    return { token: null, regId: null, regCode: null, draft: null };
  }
}

function buildStateJson(state: StoredState): string {
  const obj: Record<string, unknown> = {};
  obj[TOKEN_KEY] = state.token;
  obj[REG_ID_KEY] = state.regId;
  obj[REG_CODE_KEY] = state.regCode;
  try {
    obj[DRAFT_KEY] = state.draft ? JSON.parse(state.draft) : null;
  } catch {
    obj[DRAFT_KEY] = state.draft;
  }
  return JSON.stringify(obj, null, 2);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface LoadedScenario {
  path: RegistrationPath;
  paymentStatus: PaymentStatus;
  regId: string | null;
  regCode: string | null;
}

export default function DebugToolsPage() {
  useDocumentTitle("Debug Tools");
  const navigate = useNavigate();

  const [selectedPath, setSelectedPath] =
    useState<RegistrationPath>("fc_solo");
  const [selectedPaymentStatus, setSelectedPaymentStatus] =
    useState<PaymentStatus>("not_submitted");
  const [loaded, setLoaded] = useState<LoadedScenario | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [storedState, setStoredState] = useState<StoredState>(readStoredState);
  const [copyLabel, setCopyLabel] = useState("Copy");

  // Quick Actions state
  const [verifyStatus, setVerifyStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  // Magic Link state
  const [magicLinkEmail, setMagicLinkEmail] = useState("");
  const [magicLinkStatus, setMagicLinkStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [magicLinkResult, setMagicLinkResult] = useState<{
    magicLink: string;
    identity: { type: string; role?: string };
  } | null>(null);
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);

  useEffect(() => {
    setStoredState(readStoredState());
  }, [loaded]);

  function handleLoadScenario() {
    setSuccessMessage(null);

    const pathOption = REGISTRATION_PATHS.find((p) => p.value === selectedPath);
    if (!pathOption) return;

    const draft = pathOption.draft();

    if (selectedPaymentStatus === "not_submitted") {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REG_ID_KEY);
        localStorage.removeItem(REG_CODE_KEY);
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // ignore
      }
      setLoaded({
        path: selectedPath,
        paymentStatus: "not_submitted",
        regId: null,
        regCode: null,
      });
      setStoredState(readStoredState());
      setSuccessMessage(
        `Loaded "${pathOption.label}" draft (${pathOption.expectedTotal}) — no auth, ready for review.`,
      );
      return;
    }

    const regId = generateRegId();
    const regCode = generateRegCode();
    const token = generateFakeJwt(selectedPaymentStatus);

    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(REG_ID_KEY, regId);
      localStorage.setItem(REG_CODE_KEY, regCode);
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore
    }

    setLoaded({
      path: selectedPath,
      paymentStatus: selectedPaymentStatus,
      regId,
      regCode,
    });
    setStoredState(readStoredState());

    const paymentLabel =
      PAYMENT_STATUS_OPTIONS.find((p) => p.value === selectedPaymentStatus)
        ?.label ?? selectedPaymentStatus;
    setSuccessMessage(
      `Loaded "${pathOption.label} — ${paymentLabel}" (${pathOption.expectedTotal}) — regId: ${regId}, regCode: ${regCode}`,
    );
  }

  function handleCopyState() {
    const json = buildStateJson(storedState);
    navigator.clipboard.writeText(json).then(
      () => {
        setCopyLabel("Copied!");
        setTimeout(() => setCopyLabel("Copy"), 2000);
      },
      () => {
        setCopyLabel("Failed");
        setTimeout(() => setCopyLabel("Copy"), 2000);
      },
    );
  }

  const canNavigateWithReg =
    loaded !== null &&
    loaded.paymentStatus !== "not_submitted" &&
    loaded.regId !== null;

  async function handleVerifyPayment() {
    const token = storedState.token;
    if (!token) {
      setVerifyStatus("error");
      setVerifyMessage("No auth token in localStorage — load a scenario with a payment status first.");
      return;
    }

    setVerifyStatus("loading");
    setVerifyMessage(null);

    try {
      const res = await fetch("/api/debug/verify-payment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const data = (await res.json()) as { status?: string; error?: string };

      if (!res.ok) {
        setVerifyStatus("error");
        setVerifyMessage(`Server error (${res.status}): ${data.error ?? "Unknown error"}`);
        return;
      }

      setVerifyStatus("success");
      setVerifyMessage(`Payment verified! Registration status: ${data.status ?? "confirmed"}`);
      setStoredState(readStoredState());
    } catch (err) {
      setVerifyStatus("error");
      setVerifyMessage(
        `Request failed: ${err instanceof Error ? err.message : "Network error"}`,
      );
    }
  }

  async function handleGenerateMagicLink() {
    if (!magicLinkEmail.trim()) return;
    setMagicLinkStatus("loading");
    setMagicLinkResult(null);
    setMagicLinkError(null);

    try {
      const res = await fetch("/api/debug/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: magicLinkEmail.trim() }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        magicLink?: string;
        identity?: { type: string; role?: string };
        error?: string;
      };

      if (!res.ok) {
        setMagicLinkStatus("error");
        setMagicLinkError(`${res.status}: ${data.error ?? "Unknown error"}`);
        return;
      }

      setMagicLinkStatus("success");
      setMagicLinkResult({
        magicLink: data.magicLink ?? "",
        identity: data.identity ?? { type: "unknown" },
      });
    } catch (err) {
      setMagicLinkStatus("error");
      setMagicLinkError(
        err instanceof Error ? err.message : "Network error",
      );
    }
  }

  function handleClear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REG_ID_KEY);
      localStorage.removeItem(REG_CODE_KEY);
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    setLoaded(null);
    setStoredState(readStoredState());
    setSuccessMessage("Cleared all localStorage keys.");
  }

  const selectedPathOption = REGISTRATION_PATHS.find(
    (p) => p.value === selectedPath,
  );

  return (
    <div className="min-h-screen bg-page">
      <header className="bg-charcoal text-white p-4">
        <h1 className="font-heading text-2xl font-bold">Debug Tools</h1>
        <p className="text-subtle text-sm mt-1 font-body">
          Load test scenarios into localStorage — dev use only
        </p>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Scenario Loader */}
        <section className="bg-surface rounded-2xl border border-border-warm p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-charcoal mb-1">
            Load Scenario
          </h2>
          <p className="text-sm text-muted mb-5">
            Select a registration path and payment status, then click Load. This
            writes a WizardDraft and fake auth data to localStorage so you can
            test pages that require authentication.
          </p>

          <div className="space-y-4">
            {/* Registration Path */}
            <div>
              <label
                htmlFor="path-select"
                className="block text-sm font-semibold text-charcoal mb-1.5"
              >
                Registration Path
              </label>
              <select
                id="path-select"
                value={selectedPath}
                onChange={(e) =>
                  setSelectedPath(e.target.value as RegistrationPath)
                }
                className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta transition-colors"
              >
                {REGISTRATION_PATHS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} ({p.expectedTotal})
                  </option>
                ))}
              </select>
              {selectedPathOption && (
                <p className="mt-1.5 text-xs text-muted">
                  {selectedPathOption.description}
                </p>
              )}
            </div>

            {/* Payment Status */}
            <div>
              <label
                htmlFor="payment-status-select"
                className="block text-sm font-semibold text-charcoal mb-1.5"
              >
                Payment Status
              </label>
              <select
                id="payment-status-select"
                value={selectedPaymentStatus}
                onChange={(e) =>
                  setSelectedPaymentStatus(e.target.value as PaymentStatus)
                }
                className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta transition-colors"
              >
                {PAYMENT_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {selectedPaymentStatus === "not_submitted" && (
                <p className="mt-1.5 text-xs text-muted">
                  Loads draft only — no auth token. Go to /register to review and submit.
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <Button variant="primary" size="md" onClick={handleLoadScenario}>
                Load Scenario
              </Button>
              <Button variant="secondary" size="md" onClick={handleClear}>
                Clear
              </Button>
            </div>

            {successMessage !== null && (
              <div className="rounded-xl bg-veg-bg border border-veg-border px-4 py-3 text-sm text-veg-text font-mono break-all">
                {successMessage}
              </div>
            )}
          </div>
        </section>

        {/* Quick Navigation */}
        <section className="bg-surface rounded-2xl border border-border-warm p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-charcoal mb-1">
            Go to Page
          </h2>
          <p className="text-sm text-muted mb-5">
            Quick-navigate to pages. Payment and Confirmation links appear after
            loading a non-fresh scenario.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate("/register")}
            >
              Registration
            </Button>

            {canNavigateWithReg && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/pay/${loaded.regCode}`)}
                >
                  Payment Page
                  <span className="ml-1.5 font-mono text-xs opacity-60">
                    #{loaded.regId}
                  </span>
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/confirmation/${loaded.regId}`)}
                >
                  Confirmation Page
                  <span className="ml-1.5 font-mono text-xs opacity-60">
                    #{loaded.regId}
                  </span>
                </Button>
              </>
            )}
          </div>

          {loaded === null && (
            <p className="text-xs text-muted mt-3">
              Load a scenario first to enable Payment and Confirmation links.
            </p>
          )}
          {loaded?.paymentStatus === "not_submitted" && (
            <p className="text-xs text-muted mt-3">
              Not submitted — no auth data. Use Registration link to review and submit.
            </p>
          )}
        </section>

        {/* Quick Actions */}
        <section className="bg-surface rounded-2xl border border-border-warm p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-charcoal mb-1">
            Quick Actions
          </h2>
          <p className="text-sm text-muted mb-5">
            Dev-only server actions. Requires a loaded scenario with auth data (token in localStorage).
            These call <span className="font-mono text-xs">POST /api/debug/*</span> on the local server.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Button
                variant="primary"
                size="md"
                onClick={() => void handleVerifyPayment()}
                disabled={!storedState.token || verifyStatus === "loading"}
              >
                {verifyStatus === "loading" ? "Verifying…" : "Verify Payment"}
              </Button>
              <p className="text-xs text-muted">
                Marks the most recent payment as <span className="font-mono">verified</span> and registration as <span className="font-mono">confirmed</span>.
              </p>
            </div>

            {verifyStatus === "success" && verifyMessage && (
              <div className="rounded-xl bg-veg-bg border border-veg-border px-4 py-3 text-sm text-veg-text">
                <p className="font-semibold">{verifyMessage}</p>
                {loaded?.regId && (
                  <button
                    type="button"
                    onClick={() => navigate(`/confirmation/${loaded.regId}`)}
                    className="mt-2 text-xs font-semibold text-terracotta hover:underline"
                  >
                    Go to Confirmation Page &rarr;
                  </button>
                )}
              </div>
            )}

            {verifyStatus === "error" && verifyMessage && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-mono break-all">
                {verifyMessage}
              </div>
            )}

            {!storedState.token && (
              <p className="text-xs text-muted">
                No token — load a scenario with a payment status other than "Not Submitted" to enable this.
              </p>
            )}
          </div>
        </section>

        {/* Magic Link Generator */}
        <section className="bg-surface rounded-2xl border border-border-warm p-6 shadow-sm">
          <h2 className="font-heading text-xl font-bold text-charcoal mb-1">
            Generate Magic Link
          </h2>
          <p className="text-sm text-muted mb-5">
            Create a login magic link for any email (staff, admin, or attendee).
            Calls <span className="font-mono text-xs">POST /api/debug/magic-link</span> — dev only.
          </p>

          <div className="space-y-4">
            <div className="flex gap-3">
              <input
                type="email"
                value={magicLinkEmail}
                onChange={(e) => setMagicLinkEmail(e.target.value)}
                placeholder="user@example.com"
                className="flex-1 rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta transition-colors"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleGenerateMagicLink();
                }}
              />
              <Button
                variant="primary"
                size="md"
                onClick={() => void handleGenerateMagicLink()}
                disabled={!magicLinkEmail.trim() || magicLinkStatus === "loading"}
              >
                {magicLinkStatus === "loading" ? "Generating…" : "Generate Link"}
              </Button>
            </div>

            {magicLinkStatus === "success" && magicLinkResult && (
              <div className="rounded-xl bg-veg-bg border border-veg-border px-4 py-3 text-sm space-y-2">
                <p className="text-veg-text font-semibold">
                  {magicLinkResult.identity.type === "user"
                    ? `Staff/Admin (${magicLinkResult.identity.role})`
                    : "Attendee"}{" "}
                  — link generated
                </p>
                <a
                  href={magicLinkResult.magicLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block font-mono text-xs text-terracotta hover:underline break-all"
                >
                  {magicLinkResult.magicLink}
                </a>
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = magicLinkResult.magicLink;
                  }}
                  className="text-xs font-semibold text-terracotta hover:underline"
                >
                  Use this link now &rarr;
                </button>
              </div>
            )}

            {magicLinkStatus === "error" && magicLinkError && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-mono break-all">
                {magicLinkError}
              </div>
            )}
          </div>
        </section>

        {/* Current State */}
        <section className="bg-surface rounded-2xl border border-border-warm p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-xl font-bold text-charcoal">
              Current localStorage State
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStoredState(readStoredState())}
                className="text-xs font-semibold text-terracotta hover:underline"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={handleCopyState}
                className="text-xs font-semibold text-terracotta hover:underline"
              >
                {copyLabel}
              </button>
            </div>
          </div>

          <pre className="rounded-xl bg-page border border-border p-4 text-xs font-mono text-charcoal overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {buildStateJson(storedState)}
          </pre>
        </section>
      </main>
    </div>
  );
}
