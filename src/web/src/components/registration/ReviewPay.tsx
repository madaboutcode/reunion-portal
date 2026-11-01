import { useMemo, useState, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { StickyBottomBar } from "@/components/registration/StickyBottomBar";
import { formatINR, PARTICIPATION_LABELS, ACCOMMODATION_LABELS, GENDER_LABELS, CONTRIBUTION_CAUSE_LABELS } from "@/lib/constants";
import { submitRegistration } from "@/lib/api";
import { saveAuth, saveVerifyResponse } from "@/lib/auth";
import { calculateTotal, getAttendeeCounts, toRegistration } from "@/lib/pricing";
import { validateForPayment, type ReviewIssue } from "@smriti/shared";
import { PricingSummary } from "@/components/ui/PricingSummary";
import { clearDraft } from "@/hooks/usePersistence";
import { STEP } from "@/lib/wizard-steps";
import type {
  WizardDraft,
  MealPreference,
} from "@/types/registration";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReviewPayProps {
  data: WizardDraft;
  update: (changes: Partial<WizardDraft>) => void;
  onNext: () => void;
  onBack: () => void;
  /** Navigate to a specific step for editing. Falls back to onBack if omitted. */
  goToStep?: (step: number) => void;
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Key-value row for summary cards. Hides when value is falsy. */
function KV({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | null | undefined;
  accent?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between mb-[7px]">
      <span className="text-sm text-subtle min-w-[90px]">{label}</span>
      <span
        className="text-[13px] font-medium text-right max-w-[220px]"
        style={{ color: accent ?? undefined }}
      >
        {value}
      </span>
    </div>
  );
}

/** Inline meal badge. Veg = green pill, Non-veg = terracotta pill. */
function MealBadge({ meal }: { meal: MealPreference | undefined }) {
  if (!meal) return null;
  const veg = meal === "veg";
  return (
    <span
      className="inline-block px-2 py-px rounded-[10px] text-sm font-bold ml-1.5"
      style={{
        background: veg ? "#ebf7f0" : "#fdf3ef",
        color: veg ? "#1e7a4a" : "#c4512f",
      }}
    >
      {veg ? "🌿 Veg" : "🍗 Non-veg"}
    </span>
  );
}

/** Summary card with icon + title header, edit action, and optional issue list. */
function SummarySection({
  icon,
  title,
  children,
  onEdit,
  issues = [],
  delay = 0,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onEdit: () => void;
  issues?: ReviewIssue[];
  delay?: number;
}) {
  const hasIssues = issues.length > 0;
  return (
    <div
      className={[
        "bg-white rounded-2xl border mb-3 overflow-hidden animate-[slide-in-right_0.4s_ease-out_both]",
        hasIssues ? "border-amber-300 border-l-[3px]" : "border-border",
      ].join(" ")}
      style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.03)", animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between px-5 py-[13px] bg-[#fafafa] border-b border-[#f0f0f0]">
        <div className="flex items-center gap-2">
          <span className="flex items-center">{icon}</span>
          <span className="text-base font-bold text-charcoal">{title}</span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className={[
            "text-sm font-semibold cursor-pointer bg-transparent border-0 px-1.5 py-0.5 hover:underline",
            hasIssues ? "text-amber-600" : "text-terracotta",
          ].join(" ")}
        >
          {hasIssues ? "Complete →" : "Edit"}
        </button>
      </div>
      <div className="px-5 py-4">
        {children}
        {hasIssues && (
          <div className="mt-3 pt-3 border-t border-[#f5f0eb]">
            {issues.map((issue) => (
              <div key={issue.field} className="flex items-start gap-2 mb-1.5 last:mb-0">
                <span className="text-amber-500 text-xs mt-0.5 shrink-0">●</span>
                <span className="text-sm text-amber-700">{issue.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function ReviewPay({
  data,
  onNext,
  onBack,
  goToStep,
}: ReviewPayProps) {
  const isMobile = useIsMobile();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reg = toRegistration(data);
  const bd = calculateTotal(reg);
  const counts = getAttendeeCounts(reg);
  const validation = useMemo(() => validateForPayment(data), [data]);
  const issuesBySection = useMemo(() => {
    const map: Record<string, ReviewIssue[]> = {};
    for (const issue of validation.issues) {
      (map[issue.section] ??= []).push(issue);
    }
    return map;
  }, [validation]);

  const extractErrorMessage = (err: unknown) => {
    const fallback = "Something went wrong. Please try again.";
    if (!err || typeof err !== "object") return fallback;

    // ApiError: { code, details: { error, details?: { fieldErrors } } }
    const details = "details" in err ? (err as { details: unknown }).details : null;
    if (details && typeof details === "object" && "error" in details) {
      const body = details as { error: string; details?: { fieldErrors?: Record<string, string> } };
      if (body.details?.fieldErrors) {
        const firstError = Object.values(body.details.fieldErrors)[0];
        return firstError || body.error;
      }
      return body.error;
    }

    // Direct { error } shape (non-ApiError)
    if ("error" in err) {
      return (err as { error: string }).error;
    }

    return fallback;
  };

  const handlePay = async () => {
    setPaying(true);
    setError(null);

    try {
      // Submit — map draft to canonical Registration before POST
      const response = await submitRegistration(toRegistration(data));

      // Persist auth token and session metadata so clients don't decode the JWT
      saveAuth(response.token, response.regId);
      saveVerifyResponse({ role: "attendee", sub: response.regId });

      clearDraft();
      onNext();
      const sep = response.paymentUrl.includes("?") ? "&" : "?";
      window.location.href = `${response.paymentUrl}${sep}new=1`;
    } catch (err: unknown) {
      setPaying(false);
      setError(extractErrorMessage(err));
    }
  };

  const goto = (n: number) => {
    if (goToStep) {
      goToStep(n);
      return;
    }
    onBack();
  };

  // ── Attendees list ──
  interface AttendeeLine {
    name: string;
    label: string;
    meal?: MealPreference;
  }

  const attendeeLines: AttendeeLine[] = [];
  if (data.participationType !== "donation_only") {
    attendeeLines.push({
      name: data.fullName || "You",
      label: "Alumni",
      meal: data.alumniMeal,
    });
    if (data.spouseName?.trim()) {
      attendeeLines.push({
        name: data.spouseName,
        label: "Spouse",
        meal: data.spouseMeal,
      });
    }
    (data.children || []).forEach((c) =>
      attendeeLines.push({
        name: c.name || "Child",
        label: `${c.age || "?"} yrs`,
        meal: c.meal,
      }),
    );
    (data.guests || []).forEach((g) =>
      attendeeLines.push({
        name: g.name || "Guest",
        label: g.relationship || "Guest",
        meal: g.meal,
      }),
    );
  }

  // ── Pricing breakdown panel ──
  const pricePanel = (
    <PricingSummary
      data={data}
      className={!isMobile ? "sticky top-6" : undefined}
    >
      {/* Pay button (desktop) */}
      {!isMobile && (
        <>
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {!validation.ready && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-sm text-amber-700">
              Complete the items marked above to continue
            </div>
          )}
          <button
            type="button"
            onClick={handlePay}
            data-testid="step6-advance"
            disabled={paying || !validation.ready}
            className={[
              "w-full h-[54px] border-0 rounded-2xl text-white text-[17px] font-bold font-body mb-3",
              "transition-all duration-200",
              paying || !validation.ready
                ? "bg-[#d1d5db] cursor-not-allowed"
                : "cursor-pointer hover:brightness-95 active:brightness-90",
            ].join(" ")}
            style={
              paying || !validation.ready
                ? undefined
                : {
                    background: "linear-gradient(135deg, #D76B51, #c45a40)",
                    boxShadow: "0 6px 20px rgba(215,107,81,0.4)",
                  }
            }
          >
            {paying ? "Processing..." : "Proceed to Payment"}
          </button>
          {validation.ready && (
            <p className="text-sm text-subtle text-center leading-relaxed">
              🔒 Secure payment · We&rsquo;ll email you a link to come back to this
              page, so you can complete payment even if you close the browser.
            </p>
          )}
        </>
      )}
    </PricingSummary>
  );

  // ── Summary sections ──
  const summaryContent = (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-heading font-bold text-charcoal leading-tight text-[26px] max-sm:text-[22px]">
          You&rsquo;re almost there
        </h2>
        <span className="text-xl" aria-hidden="true">🏁</span>
      </div>
      <p className="text-[13px] text-subtle leading-relaxed mb-5">
        Review your details before proceeding to payment
      </p>

      {/* Alumni Details */}
      <SummarySection
        icon={<span className="text-[17px]">🎓</span>}
        title="Alumni Details"
        onEdit={() => goto(STEP.about_you)}
        issues={issuesBySection["alumni"]}
        delay={100}
      >
        <KV label="Name" value={data.fullName} />
        <KV label="Branch" value={data.branch || null} />
        <KV label="Email" value={data.email} />
        <KV label="WhatsApp" value={data.whatsapp || null} />
        <KV label="Mobile (alternate)" value={data.mobileAlternate || null} />
        <KV
          label="Gender"
          value={data.gender ? (GENDER_LABELS[data.gender] ?? data.gender) : null}
        />
        <KV
          label="City"
          value={[data.city, data.country].filter(Boolean).join(", ")}
        />
        <KV
          label="Participation"
          value={data.participationType ? (PARTICIPATION_LABELS[data.participationType] ?? data.participationType) : null}
          accent={data.participationType !== "donation_only" ? "#2d9b67" : "#6b7280"}
        />
      </SummarySection>

      {/* T-Shirt Size — non-donation-only only */}
      {data.participationType !== "donation_only" && (
        <SummarySection
          icon={<span className="text-[17px]">👕</span>}
          title="T-Shirt Size"
          onEdit={() => goto(STEP.your_group)}
          issues={issuesBySection["attendees"]?.filter(i => i.field === "tshirtSize")}
          delay={150}
        >
          {data.tshirtSize ? (
            <span className="text-base font-semibold text-charcoal">{data.tshirtSize}</span>
          ) : (
            <span className="text-sm text-warning font-medium">Not selected — please choose your size</span>
          )}
        </SummarySection>
      )}

      {/* Attendees & Meals — non-donation-only only */}
      {data.participationType !== "donation_only" && (
        <SummarySection
          icon={<span className="text-[17px]">👨‍👩‍👧‍👦</span>}
          title={`Attendees & Meals · ${counts.total} ${counts.total === 1 ? "person" : "people"}`}
          onEdit={() => goto(STEP.your_group)}
          issues={issuesBySection["attendees"]?.filter(i => i.field !== "tshirtSize")}
          delay={200}
        >
          {attendeeLines.map((a, i) => (
            <div
              key={i}
              className="flex items-center justify-between mb-2"
            >
              <div>
                <span className="text-[13px] font-medium text-charcoal">
                  {a.name}
                </span>
                <span className="text-sm text-subtle ml-1.5">
                  {a.label}
                </span>
              </div>
              <MealBadge meal={a.meal} />
            </div>
          ))}
          <div className="mt-2.5 px-2.5 py-1.5 bg-soft-aqua-light rounded-lg inline-block">
            <span className="text-sm text-[#2a7a80] font-semibold">
              {counts.veg} Veg · {counts.nonveg} Non-veg
            </span>
          </div>
        </SummarySection>
      )}

      {data.participationType !== "donation_only" && (
        <SummarySection
          icon={<span className="text-lg" aria-hidden="true">🏨</span>}
          title="Stay"
          onEdit={() => goto(STEP.your_stay)}
          issues={issuesBySection["stay"]?.filter(i => i.field !== "donationAmount")}
          delay={250}
        >
          <KV label="Accommodation" value={ACCOMMODATION_LABELS[data.accommodation]} />
          {data.accommodation !== "none" && data.checkIn && (
            <KV
              label="Dates"
              value={`${new Date(data.checkIn + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })} → ${data.checkOut ? new Date(data.checkOut + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}`}
            />
          )}
          {data.accommodation === "private" && data.extraBed && (
            <KV label="Extra bed" value="Yes" />
          )}
        </SummarySection>
      )}

      {/* College Contribution — shown for all participation types */}
      <SummarySection
        icon={<span className="text-[17px]">🏫</span>}
        title="College Contribution"
        onEdit={() => goto(STEP.giving_back)}
        issues={issuesBySection["giving_back"]?.filter(i => i.field === "collegeContribution" || i.field === "collegeContributionCause")}
        delay={300}
      >
        {data.collegeContribution != null && data.collegeContribution > 0 ? (
          <div>
            <span className="text-base font-semibold text-charcoal">
              {formatINR(data.collegeContribution)}
            </span>
            {data.collegeContributionCause !== "" ? (
              <span className="text-sm text-subtle ml-2">
                — {CONTRIBUTION_CAUSE_LABELS[data.collegeContributionCause]}
              </span>
            ) : (
              <span className="text-sm text-subtle ml-2">— Batch Contribution to College</span>
            )}
          </div>
        ) : (
          <span className="text-sm text-subtle">None</span>
        )}
      </SummarySection>

      {/* Giving Back (donation) — shown for all intents */}
      <SummarySection
        icon={<span className="text-[17px]">❤️</span>}
        title="Giving Back"
        onEdit={() => goto(STEP.giving_back)}
        issues={issuesBySection["giving_back"]}
        delay={350}
      >
        <KV
          label="Donation"
          value={
            bd.donation > 0
              ? formatINR(bd.donation)
              : "None"
          }
          accent={bd.donation > 0 ? "#D76B51" : undefined}
        />
      </SummarySection>

      {/* Photo & ID Document */}
      <SummarySection
        icon={<span className="text-[17px]">📸</span>}
        title="Photo & ID Document"
        onEdit={() => goto(STEP.photo_id)}
        issues={issuesBySection["photo"]}
        delay={400}
      >
        {/* Photo — shown for all users */}
        <div className="mb-2">
          <span className="text-xs font-semibold text-subtle uppercase tracking-wide block mb-1">Photo</span>
          {data.photoFileKey ? (
            <div className="flex items-center gap-2">
              <span className="text-[#2d9b67] text-base">✓</span>
              <span className="text-[13px] text-[#2d9b67] font-semibold">
                {data.photoFileName || "Uploaded"}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span className="text-[13px] text-warning font-medium">
                Not uploaded
              </span>
            </div>
          )}
        </div>

        {/* ID Document — attending only */}
        {data.participationType !== "donation_only" && (
          <div>
            <span className="text-xs font-semibold text-subtle uppercase tracking-wide block mb-1">ID Document</span>
            {data.idFileKey ? (
              <div className="flex items-center gap-2">
                <span className="text-[#2d9b67] text-base">✓</span>
                <span className="text-[13px] text-[#2d9b67] font-semibold">
                  {data.idFileName || "Uploaded"}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-base">⚠️</span>
                <span className="text-[13px] text-warning font-medium">
                  Not uploaded — we may follow up
                </span>
              </div>
            )}
          </div>
        )}
      </SummarySection>

      {/* Mobile: pricing inline */}
      {isMobile && <div className="mt-2">{pricePanel}</div>}

      {/* Desktop: back button */}
      {!isMobile && (
        <div className="mt-2">
          <button
            type="button"
            onClick={onBack}
            data-testid="step6-back"
            className="h-11 px-[22px] border-[1.5px] border-border rounded-xl bg-white text-[#374151] text-base font-semibold font-body cursor-pointer hover:bg-[#F9FAFB] transition-colors duration-150"
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  );

  // ── Mobile layout ──
  if (isMobile) {
    return (
      <div className="animate-step-in">
        <div className="px-3.5 py-4">{summaryContent}</div>
        {error && (
          <div className="px-3.5 pb-1">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              {error}
            </div>
          </div>
        )}
        {!validation.ready && (
          <div className="px-3.5 pb-1">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
              Complete the items marked above to continue
            </div>
          </div>
        )}
        <div className="h-mobile-bottom-spacer" />
        <StickyBottomBar
          onBack={onBack}
          onNext={handlePay}
          nextLabel={
            paying ? "Processing..." : "Proceed to Payment"
          }
          nextDisabled={paying || !validation.ready}
        />
      </div>
    );
  }

  // ── Desktop layout ──
  return (
    <div className="max-w-[1100px] mx-auto px-8 pt-8 pb-14 animate-step-in">
      <div className="grid grid-cols-[3fr_2fr] gap-7 items-start">
        {summaryContent}
        {pricePanel}
      </div>
    </div>
  );
}
