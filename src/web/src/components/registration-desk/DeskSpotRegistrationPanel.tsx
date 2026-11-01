import { useEffect, useRef, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { FileUpload } from "@/components/ui/FileUpload";
import { MealToggle } from "@/components/form/MealToggle";
import { useFileUpload } from "@/hooks/useFileUpload";
import { getAuthEmail } from "@/lib/auth";
import { deskSpotRegistrationSchema } from "@/lib/validation";
import { deskCreateSpotRegistration } from "@/lib/staff-api";
import { BRANCHES, PRICING_DEFAULTS } from "@/lib/constants";
import { calculateTotal, type PricingRegistration } from "@/lib/pricing";
import { ApiError } from "@/lib/http";
import type { DeskSpotRegistrationResponse, DeskSpotRegistrationRequest } from "@/lib/staff-types";

export interface DeskSpotRegistrationPanelProps {
  /** "form" renders the entry form; "review" renders the pre-create summary
   *  of the SAME mounted form state — fields and the uploaded photoFileKey
   *  stay alive across the switch (plan "Spot registration" step 2/3). */
  stage: "form" | "review";
  /** Called after client validation passes. NO create request is made here —
   *  review is validation-only (plan step 2). */
  onRequestReview: () => void;
  /** Called from the review — returns to the populated form, including the
   *  uploaded photo reference (plan step 4). */
  onEditDetails: () => void;
  /** Reports whether any form value or uploaded photo reference differs from
   *  the empty initial form. Owned by the parent ONLY for close/discard
   *  decisions; the form remains the owner of field state (plan Data Models). */
  onDirtyChange: (dirty: boolean) => void;
  /** Reports whether the final create POST is in flight. The parent uses it
   *  to BLOCK every close path (header Close, Escape, backdrop) while a
   *  create is running — discarding mid-flight would lose the receipt for a
   *  registration the server already created (P1, 2026-08-12 review). Reset
   *  to false on failure (retry stays possible) and on unmount. */
  onSubmittingChange: (submitting: boolean) => void;
  /** Called with the desk-safe creation response after the final create. */
  onCreated: (created: DeskSpotRegistrationResponse["registration"]) => void;
}

interface CompanionRow {
  name: string;
  meal: "veg" | "non_veg";
}

interface ChildRow {
  name: string;
  age: string;
  meal: "veg" | "non_veg";
}

interface SpotFormState {
  fullName: string;
  whatsapp: string;
  branch: string;
  participationType: "full_celebration" | "campus_only";
  alumniMeal: "veg" | "non_veg";
  photoFileKey: string;
  email: string;
  donationAmount: string;
  spouse: CompanionRow;
  children: ChildRow[];
  guests: CompanionRow[];
}

const PHOTO_UPLOAD_URL = "/api/uploads/photo";

function initialForm(): SpotFormState {
  return {
    fullName: "",
    whatsapp: "",
    branch: "",
    participationType: "full_celebration",
    alumniMeal: "veg",
    photoFileKey: "",
    email: "",
    donationAmount: "",
    spouse: { name: "", meal: "veg" },
    children: [],
    guests: [],
  };
}

/**
 * Builds the exact desk request shape from the form. Only the documented
 * allowed fields are present; unknown keys are never added (ispec R5/R5.1).
 */
function buildPayload(form: SpotFormState): DeskSpotRegistrationRequest {
  return {
    fullName: form.fullName,
    whatsapp: form.whatsapp,
    branch: form.branch,
    participationType: form.participationType,
    alumniMeal: form.alumniMeal,
    photoFileKey: form.photoFileKey,
    email: form.email.trim(),
    ...(form.donationAmount.trim()
      ? { donationAmount: Number(form.donationAmount) }
      : {}),
    ...(form.spouse.name.trim()
      ? { spouse: { name: form.spouse.name.trim(), mealPreference: form.spouse.meal } }
      : {}),
    children: form.children
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), age: Number(c.age), mealPreference: c.meal })),
    guests: form.guests
      .filter((g) => g.name.trim())
      .map((g) => ({ name: g.name.trim(), mealPreference: g.meal })),
  };
}

/**
 * Pricing projection from the desk's allowed fields — mirrors the server's
 * toPricingRegistration() in registration-desk.service.ts so the preview uses
 * the SAME shared calculateTotal + PRICING_DEFAULTS (plan Pre-Decisions:
 * client pricing preview — never a duplicated fee table).
 */
function toPricingRegistration(form: SpotFormState): PricingRegistration {
  return {
    attendance: {
      intent: "attending",
      participationType: form.participationType,
      alumniMeal: form.alumniMeal,
    },
    attendees: {
      spouse: form.spouse.name.trim()
        ? { name: form.spouse.name.trim(), meal: form.spouse.meal }
        : undefined,
      children: form.children
        .filter((c) => c.name.trim())
        .map((c) => ({ name: c.name.trim(), age: Number(c.age), meal: c.meal })),
      guests: form.guests
        .filter((g) => g.name.trim())
        .map((g) => ({ name: g.name.trim(), meal: g.meal })),
    },
    contributionSplits: {},
    ...(form.donationAmount.trim() && Number(form.donationAmount) > 0
      ? { donation: { amount: Number(form.donationAmount) } }
      : {}),
  };
}

/** First zod message per path — same shape the server surfaces (ispec R6). */
function collectFieldErrors(error: import("zod").ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!errors[path]) errors[path] = issue.message;
  }
  return errors;
}

function apiErrorMessage(err: unknown): string | null {
  if (err instanceof ApiError) return err.code;
  return null;
}

/** Review row — label left, value right, same visual language as DeskPaymentReview. */
function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <strong className="text-right text-sm font-semibold break-words text-charcoal">{value}</strong>
    </div>
  );
}

/**
 * CONTRACT: Narrow spot-registration form + pre-create review
 * (registration-desk.spec.md R5; 2026-08-12 plan "Spot registration").
 *
 * GUARANTEES:
 *   - Accepts ONLY the allowed fields; the payload is validated against the
 *     same deskSpotRegistrationSchema the server enforces, so an invalid
 *     submission shows field errors without a network round-trip.
 *   - The photo uses the existing upload approach (JPG/PNG, 5MB, immediate
 *     upload via /api/uploads/photo, server-returned reference) and is
 *     REQUIRED before review (spec R13).
 *   - REVIEW_IS_VALIDATION_ONLY — `Review registration` validates and calls
 *     onRequestReview; it NEVER calls the create endpoint. The same mounted
 *     form state then renders the grouped review.
 *   - EDIT_BACK_PRESERVES_STATE — `Edit details` returns to the populated
 *     form including the uploaded photoFileKey, because the review is a
 *     branch of the SAME component instance, not a remount.
 *   - IDEMPOTENCY_ON_FINAL_CREATE — the Idempotency-Key is created on the
 *     final `Create registration` action and retained for retry of the same
 *     body; editing the form clears the pending key (plan Data Models). The
 *     server replays the original response for a same-key retry (ispec
 *     R5.5/R5.6).
 *   - ESTIMATED_TOTAL_IS_PREVIEW — the review shows the client-side shared
 *     calculateTotal amount in an explicitly informational block; the final
 *     server-calculated amount appears on the post-create receipt.
 *   - Dirty state (any form value or uploaded photo reference differing from
 *     the empty initial form) is reported via onDirtyChange — the parent uses
 *     it only for close/discard decisions.
 *   - Clear loading / error / success states: final create shows loading;
 *     errors render inline on the review; success calls onCreated.
 *
 * FAILURE BEHAVIOR: 422/409 server errors and network failures surface as an
 *   inline error on the review (spec States: "Spot registration validation
 *   error", "Network or server error"); the form state is preserved for retry.
 *   Upload failure keeps the photo key empty and blocks review.
 */
export function DeskSpotRegistrationPanel({
  stage,
  onRequestReview,
  onEditDetails,
  onDirtyChange,
  onSubmittingChange,
  onCreated,
}: DeskSpotRegistrationPanelProps) {
  const [form, setForm] = useState<SpotFormState>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm());
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // Reports the in-flight create signal to the parent so it can block every
  // close path during the POST (P1). The cleanup resets the signal on
  // unmount — the parent must never be left believing a create is running
  // after the panel is gone.
  useEffect(() => {
    onSubmittingChange(submitting);
    return () => onSubmittingChange(false);
  }, [submitting, onSubmittingChange]);

  // The idempotency key is created on the FINAL create action and retained
  // for retry of the same body (plan Data Models: "Editing the form clears
  // that pending key"). Retrying the same body reuses the key → the server
  // replays the original response; an edited body produces a fresh key on the
  // next create click (ispec R5.5/R5.6).
  const pendingKeyRef = useRef<string | null>(null);

  function update(changes: Partial<SpotFormState>) {
    // Editing the form (including a re-uploaded photo) invalidates any
    // pending idempotency key — the next create is a different body.
    pendingKeyRef.current = null;
    setForm((f) => ({ ...f, ...changes }));
    // Clear per-field errors when the user edits that field.
    const touched = Object.keys(changes);
    if (touched.length > 0) {
      setFieldErrors((errs) => {
        const next = { ...errs };
        for (const key of touched) {
          delete next[key];
          // Children/guests have indexed paths — drop the whole group to be safe.
          if (key === "children") {
            for (const k of Object.keys(next)) if (k.startsWith("children.")) delete next[k];
          }
          if (key === "guests") {
            for (const k of Object.keys(next)) if (k.startsWith("guests.")) delete next[k];
          }
          if (key === "spouse") {
            for (const k of Object.keys(next)) if (k.startsWith("spouse.")) delete next[k];
          }
        }
        return next;
      });
    }
  }

  const photoDisabled = !form.fullName.trim() || !form.branch.trim();
  const photo = useFileUpload(
    PHOTO_UPLOAD_URL,
    {
      fullName: form.fullName.trim(),
      branch: form.branch.trim(),
      // The photo can be captured before the attendee's email is typed in
      // (e.g. staff snap the photo first, then fill the rest of the form),
      // so the attendee email field may be momentarily empty at upload time
      // even though the form as a whole now requires it before submit. The
      // upload endpoint requires a non-empty email for request metadata, so
      // fall back to the desk operator's authenticated email when the
      // attendee email isn't filled in yet.
      // FALLBACK-OK: `|| ""` — an empty email is REJECTED by the upload
      // boundary (upload.routes.ts "email is required"), never stored.
      email: form.email.trim() || getAuthEmail() || "",
    },
    {
      onSuccess: (fileKey) => {
        update({ photoFileKey: fileKey });
        setFieldErrors((errs) => {
          const next = { ...errs };
          delete next.photoFileKey;
          return next;
        });
      },
      onClear: () => update({ photoFileKey: "" }),
    },
  );

  function validateForm(): boolean {
    setSubmitError(null);
    setFieldErrors({});
    const payload = buildPayload(form);
    const parsed = deskSpotRegistrationSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(collectFieldErrors(parsed.error));
      return false;
    }
    return true;
  }

  /** Review button — validate locally, then switch to the review stage. No POST. */
  function handleReview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (!validateForm()) return;
    onRequestReview();
  }

  /** Final create — the ONLY action that generates/uses the idempotency key
   *  and calls the existing POST endpoint (plan "Spot registration" step 5). */
  async function handleFinalCreate() {
    if (submitting) return;
    setSubmitError(null);
    setFieldErrors({});
    const payload = buildPayload(form);
    const parsed = deskSpotRegistrationSchema.safeParse(payload);
    if (!parsed.success) {
      // Unreachable from the review stage (review only opens on a valid
      // form), but fail closed rather than POSTing invalid data — return the
      // operator to the form to fix the reported fields.
      setFieldErrors(collectFieldErrors(parsed.error));
      onEditDetails();
      return;
    }
    // Create the key on the final create action; retained for retry of the
    // same body (editing clears it via update()).
    pendingKeyRef.current ??= crypto.randomUUID();
    setSubmitting(true);
    try {
      const res = await deskCreateSpotRegistration(parsed.data, pendingKeyRef.current);
      onCreated(res.registration);
    } catch (err) {
      // Server 409 (duplicate WhatsApp/email or key conflict) and 422
      // messages pass through; everything else is a generic retryable error.
      // FALLBACK-OK: spec "States — Network or server error" — the form state
      // is preserved for retry. The pending key is retained so a same-body
      // retry replays rather than double-creating.
      setSubmitError(
        apiErrorMessage(err) ??
          "Could not create the registration. Please check the details and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function addChild() {
    // Route through update() so the pending idempotency key is cleared — the
    // request body changes when a child row is added (P2, 2026-08-12 review).
    update({ children: [...form.children, { name: "", age: "", meal: "veg" }] });
  }
  function addGuest() {
    // Same key-clearing requirement as addChild — a new guest changes the body.
    update({ guests: [...form.guests, { name: "", meal: "veg" }] });
  }

  const err = (path: string) => fieldErrors[path];

  // ── Pre-create review (plan "Spot registration" step 4) ───────────────────
  if (stage === "review") {
    const participationLabel =
      form.participationType === "full_celebration" ? "Full Celebration" : "Campus Only";
    const mealLabel = form.alumniMeal === "veg" ? "Vegetarian" : "Non-vegetarian";
    const childrenRows = form.children
      .filter((c) => c.name.trim())
      .map((c) => `${c.name.trim()} (${c.age || "?"}) · ${c.meal === "veg" ? "veg" : "non-veg"}`)
      .join(", ");
    const guestRows = form.guests
      .filter((g) => g.name.trim())
      .map((g) => `${g.name.trim()} · ${g.meal === "veg" ? "veg" : "non-veg"}`)
      .join(", ");
    const previewTotal = calculateTotal(toPricingRegistration(form), PRICING_DEFAULTS).total;

    return (
      <section
        className="bg-surface border border-border-warm rounded-[1.75rem] p-5 sm:p-6"
        aria-label="Review spot registration"
        data-testid="desk-spot-review-panel"
      >
        <h2 className="font-heading text-xl text-charcoal font-bold">Review registration</h2>
        <p className="text-sm text-muted mb-5">
          Check these details before creating the record. Nothing is saved until you confirm.
        </p>

        <div className="divide-y divide-border-warm rounded-2xl border border-border-warm bg-white">
          <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Attendee</p>
          <ReviewRow label="Full name" value={form.fullName} />
          <ReviewRow label="WhatsApp" value={form.whatsapp} />
          <ReviewRow label="Branch" value={form.branch} />
          <ReviewRow label="Email" value={form.email} />
          {form.photoFileKey && (
            <ReviewRow label="Photo" value={form.photoFileKey.split("/").pop() ?? "Uploaded"} />
          )}
        </div>

        <div className="mt-4 divide-y divide-border-warm rounded-2xl border border-border-warm bg-white">
          <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Participation &amp; group</p>
          <ReviewRow label="Participation" value={participationLabel} />
          <ReviewRow label="Meal preference" value={mealLabel} />
          {form.spouse.name.trim() && (
            <ReviewRow label="Spouse" value={`${form.spouse.name.trim()} · ${form.spouse.meal === "veg" ? "veg" : "non-veg"}`} />
          )}
          {childrenRows && <ReviewRow label="Children" value={childrenRows} />}
          {guestRows && <ReviewRow label="Guests" value={guestRows} />}
        </div>

        <div className="mt-4 divide-y divide-border-warm rounded-2xl border border-border-warm bg-white">
          <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Payment</p>
          {form.donationAmount.trim() && (
            <ReviewRow label="Donation" value={`₹${Number(form.donationAmount).toLocaleString("en-IN")}`} />
          )}
          <div className="rounded-b-2xl border-t border-soft-aqua bg-soft-aqua-light px-4 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-soft-aqua-ink">
              Estimated total (preview)
            </p>
            <p className="mt-1 font-heading text-[28px] font-bold leading-none text-charcoal">
              ₹{previewTotal.toLocaleString("en-IN")}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-soft-aqua-ink">
              Informational only. The final amount is calculated by the server after creation.
            </p>
          </div>
        </div>

        {submitError && (
          <p role="alert" className="text-sm text-terracotta-deep mt-5" data-testid="desk-spot-error">
            {submitError}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          <Button
            type="button"
            onClick={handleFinalCreate}
            loading={submitting}
            disabled={submitting}
            className="w-full sm:flex-1"
            data-testid="desk-spot-create"
          >
            Create registration
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onEditDetails}
            disabled={submitting}
            className="w-full sm:flex-1"
            data-testid="desk-spot-edit"
          >
            Edit details
          </Button>
        </div>
      </section>
    );
  }

  // ── Entry form (plan "Spot registration" steps 1–2) ───────────────────────
  return (
    <section
      className="bg-surface border border-border-warm rounded-[1.75rem] p-5 sm:p-6"
      aria-label="New spot registration"
      data-testid="desk-spot-form"
    >
      <div className="mb-1">
        <h2 className="font-heading text-xl text-charcoal font-bold">
          New spot registration
        </h2>
      </div>
      <p className="text-sm text-muted mb-5">
        Register a new attendee at the desk. Review the details before creating — a pending
        payment is created, and check-in is a separate step after this.
      </p>

      <form onSubmit={handleReview} className="space-y-5">
        {/* Name + WhatsApp + Branch */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="spot-fullName" className="block text-sm font-semibold text-charcoal mb-1.5">
              Full name *
            </label>
            <Input
              id="spot-fullName"
              value={form.fullName}
              onChange={(e) => update({ fullName: e.target.value })}
              error={Boolean(err("fullName"))}
              placeholder="Attendee's full name"
            />
            {err("fullName") && <p className="text-sm text-terracotta-deep mt-1">{err("fullName")}</p>}
          </div>
          <div>
            <label htmlFor="spot-whatsapp" className="block text-sm font-semibold text-charcoal mb-1.5">
              WhatsApp *
            </label>
            <Input
              id="spot-whatsapp"
              type="tel"
              value={form.whatsapp}
              onChange={(e) => update({ whatsapp: e.target.value })}
              error={Boolean(err("whatsapp"))}
              placeholder="+91…"
            />
            {err("whatsapp") && <p className="text-sm text-terracotta-deep mt-1">{err("whatsapp")}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="spot-branch" className="block text-sm font-semibold text-charcoal mb-1.5">
            Branch *
          </label>
          <Select
            id="spot-branch"
            options={BRANCHES}
            placeholder="Select branch"
            value={form.branch}
            onChange={(e) => update({ branch: e.target.value })}
            error={Boolean(err("branch"))}
          />
          {err("branch") && <p className="text-sm text-terracotta-deep mt-1">{err("branch")}</p>}
        </div>

        {/* Participation + meal */}
        <div>
          <span className="block text-sm font-semibold text-charcoal mb-1.5">
            Participation type *
          </span>
          <Toggle
            options={[
              { value: "full_celebration", label: "Full Celebration" },
              { value: "campus_only", label: "Campus Only" },
            ]}
            value={form.participationType}
            onChange={(v) =>
              update({ participationType: v as "full_celebration" | "campus_only" })
            }
          />
          {err("participationType") && (
            <p className="text-sm text-terracotta-deep mt-1">{err("participationType")}</p>
          )}
        </div>

        <div>
          <span className="block text-sm font-semibold text-charcoal mb-1.5">
            Meal preference *
          </span>
          <MealToggle
            value={form.alumniMeal}
            onChange={(v) => update({ alumniMeal: v })}
          />
          {err("alumniMeal") && <p className="text-sm text-terracotta-deep mt-1">{err("alumniMeal")}</p>}
        </div>

        {/* Photo */}
        <div>
          <span className="block text-sm font-semibold text-charcoal mb-1.5">
            Photo *
          </span>
          <FileUpload
            accept=".jpg,.jpeg,.png"
            maxSizeMB={5}
            capture="environment"
            preview
            data-testid="upload-spot-photo"
            onFileSelect={photo.handleFileSelect}
            uploading={photo.uploading}
            uploadProgress={photo.progress}
            uploadedFileName={form.photoFileKey ? form.photoFileKey.split("/").pop() : undefined}
            onRemoveUploaded={photo.handleRemove}
            error={photo.error || undefined}
            disabled={photoDisabled || photo.uploading}
          />
          {photoDisabled && (
            <p className="text-xs text-muted mt-2">
              Enter the full name and branch above to enable the photo upload.
            </p>
          )}
          {err("photoFileKey") && <p className="text-sm text-terracotta-deep mt-1">{err("photoFileKey")}</p>}
          <p className="text-xs text-muted mt-2">
            JPG or PNG · max 5 MB. Uploaded immediately, like the registration form.
          </p>
        </div>

        {/* Email + optional donation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="spot-email" className="block text-sm font-semibold text-charcoal mb-1.5">
              Email *
            </label>
            <Input
              id="spot-email"
              type="email"
              value={form.email}
              onChange={(e) => update({ email: e.target.value })}
              error={Boolean(err("email"))}
              placeholder="name@example.com"
            />
            {err("email") && <p className="text-sm text-terracotta-deep mt-1">{err("email")}</p>}
          </div>
          <div>
            <label htmlFor="spot-donation" className="block text-sm font-semibold text-charcoal mb-1.5">
              Donation amount ₹ (optional)
            </label>
            <Input
              id="spot-donation"
              type="number"
              min={1}
              value={form.donationAmount}
              onChange={(e) => update({ donationAmount: e.target.value })}
              error={Boolean(err("donationAmount"))}
              placeholder="e.g. 1000"
            />
            {err("donationAmount") && <p className="text-sm text-terracotta-deep mt-1">{err("donationAmount")}</p>}
          </div>
        </div>

        {/* Spouse */}
        <div className="rounded-xl border border-[#f0ede8] p-4">
          <h3 className="text-sm font-semibold text-charcoal mb-3">Spouse (optional)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Input
                value={form.spouse.name}
                onChange={(e) => update({ spouse: { ...form.spouse, name: e.target.value } })}
                error={Boolean(err("spouse.name"))}
                placeholder="Spouse's name"
                aria-label="Spouse name"
              />
              {err("spouse.name") && <p className="text-sm text-terracotta-deep mt-1">{err("spouse.name")}</p>}
            </div>
            <div>
              <MealToggle
                value={form.spouse.meal}
                onChange={(v) => update({ spouse: { ...form.spouse, meal: v } })}
              />
            </div>
          </div>
        </div>

        {/* Children */}
        <div className="rounded-xl border border-[#f0ede8] p-4">
          <h3 className="text-sm font-semibold text-charcoal mb-3">Children (optional)</h3>
          {form.children.length === 0 && (
            <p className="text-xs text-muted mb-3">No children added.</p>
          )}
          <div className="space-y-3">
            {form.children.map((child, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_90px_auto_auto] gap-3 items-end">
                <div>
                  <Input
                    value={child.name}
                    onChange={(e) => {
                      const children = form.children.map((c, j) => (j === i ? { ...c, name: e.target.value } : c));
                      update({ children });
                    }}
                    error={Boolean(err(`children.${i}.name`))}
                    placeholder="Child's name"
                    aria-label={`Child ${i + 1} name`}
                  />
                </div>
                <div>
                  <Input
                    type="number"
                    min={0}
                    max={99}
                    value={child.age}
                    onChange={(e) => {
                      const children = form.children.map((c, j) => (j === i ? { ...c, age: e.target.value } : c));
                      update({ children });
                    }}
                    error={Boolean(err(`children.${i}.age`))}
                    placeholder="Age"
                    aria-label={`Child ${i + 1} age`}
                  />
                </div>
                <MealToggle
                  value={child.meal}
                  onChange={(v) => {
                    const children = form.children.map((c, j) => (j === i ? { ...c, meal: v } : c));
                    update({ children });
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ children: form.children.filter((_, j) => j !== i) })}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={addChild} className="mt-3">
            + Add child
          </Button>
        </div>

        {/* Guests */}
        <div className="rounded-xl border border-[#f0ede8] p-4">
          <h3 className="text-sm font-semibold text-charcoal mb-3">Guests (optional)</h3>
          {form.guests.length === 0 && (
            <p className="text-xs text-muted mb-3">No guests added.</p>
          )}
          <div className="space-y-3">
            {form.guests.map((guest, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
                <div>
                  <Input
                    value={guest.name}
                    onChange={(e) => {
                      const guests = form.guests.map((g, j) => (j === i ? { ...g, name: e.target.value } : g));
                      update({ guests });
                    }}
                    error={Boolean(err(`guests.${i}.name`))}
                    placeholder="Guest's name"
                    aria-label={`Guest ${i + 1} name`}
                  />
                </div>
                <MealToggle
                  value={guest.meal}
                  onChange={(v) => {
                    const guests = form.guests.map((g, j) => (j === i ? { ...g, meal: v } : g));
                    update({ guests });
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ guests: form.guests.filter((_, j) => j !== i) })}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={addGuest} className="mt-3">
            + Add guest
          </Button>
        </div>

        {submitError && (
          <p role="alert" className="text-sm text-terracotta-deep" data-testid="desk-spot-error">
            {submitError}
          </p>
        )}

        <Button
          type="submit"
          disabled={!form.photoFileKey || photo.uploading}
          className="w-full"
          data-testid="desk-spot-review"
        >
          Review registration
        </Button>
        {!form.photoFileKey && !photo.uploading && (
          <p className="text-xs text-muted text-center">
            Upload a photo to enable review.
          </p>
        )}
      </form>
    </section>
  );
}
