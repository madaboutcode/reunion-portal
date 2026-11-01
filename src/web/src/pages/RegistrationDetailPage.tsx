import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  formatRegCodeForDisplay,
  ACCOMMODATION_LABELS,
  PARTICIPATION_LABELS,
  BRANCHES,
  CHECKIN_OPTIONS,
  CHECKOUT_OPTIONS,
  PRICING_DEFAULTS,
  getAccommodationCatalog,
  CONTRIBUTION_CAUSES,
} from "@/lib/constants";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatINR, calculateTotal } from "@/lib/pricing";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { ParticipationPill } from "@/components/ui/ParticipationPill";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  fetchRegistrationDetail,
  verifyPayment,
  rejectPayment,
  uploadProofOnBehalf,
  replacePhoto,
  fetchFile,
  sendPaymentLink,
  generatePaymentLink,
  archiveRegistration,
  cancelRegistration,
  editRegistration,
  fetchRefunds,
  fetchBankCredits,
  linkBankTransaction,
} from "@/lib/staff-api";
import { useStaffScopes } from "@/hooks/useStaffScopes";
import type {
  StaffRegistrationDetailResponse,
  StaffRegistrationDetail,
  AttendeeRecord,
  PaymentRecord,
  PricingBreakup,
  EditRegistrationRequest,
  RefundRecord,
  BankTransaction,
} from "@/lib/staff-types";
import type { Registration, MealPreference, ParticipationType } from "@smriti/shared";
import { parseBankDescription } from "@smriti/shared";
import {
  mapEditAttendees,
  type EditableAttendee,
} from "./registration-detail.helpers";
import { TshirtsCard, type TshirtItem } from "@/components/staff/TshirtsCard";
import { AdditionalChargesCard, type ChargeItem } from "@/components/staff/AdditionalChargesCard";

// ── Helpers ────────────────────────────────────────────────────────────────

function statusVariant(status: string): BadgeVariant {
  if (status === "confirmed") return "success";
  if (status === "pending_verification") return "info";
  return "warning";
}

function statusLabel(status: string): string {
  if (status === "pending_verification") return "Needs Verification";
  if (status === "confirmed") return "Confirmed";
  if (status === "payment_pending") return "Pending Payment";
  return "Pending";
}

function formatAuditAmount(entry: { action: string; changes: Record<string, unknown> | null }): string | null {
  const c = entry.changes as Record<string, unknown> | null;
  if (!c) return null;
  if (entry.action === 'payment_verified') {
    const actual = c.actualAmount as number | undefined;
    const expected = c.expectedAmount as number | undefined;
    if (actual != null) {
      if (expected != null && actual !== expected) return `${formatINR(actual)} (expected ${formatINR(expected)})`;
      return formatINR(actual);
    }
  }
  if (entry.action === 'payment_created' || entry.action === 'refund_created' || entry.action === 'refund_completed') {
    const amount = c.amount as number | undefined;
    if (amount != null) return formatINR(amount);
  }
  return null;
}


interface BreakdownRow { label: string; value: string; muted?: boolean }
interface BreakdownSection { title: string; rows: BreakdownRow[] }

function buildPaymentBreakdownSections(pricingBreakup: PricingBreakup, baseLabel?: string): BreakdownSection[] {
  const sections: BreakdownSection[] = [];

  // Registration
  if (pricingBreakup.base > 0) {
    sections.push({
      title: "Registration",
      rows: [{ label: baseLabel ?? "Reunion contribution", value: formatINR(pricingBreakup.base) }],
    });
  }

  // Categorize line items
  const guestRows: BreakdownRow[] = [];
  const accommodationRows: BreakdownRow[] = [];
  const givingBackRows: BreakdownRow[] = [];

  for (const line of pricingBreakup.lines) {
    const row: BreakdownRow = {
      label: line.label,
      value: line.free ? "Free" : formatINR(line.fee),
      muted: line.free,
    };

    if (line.label.startsWith("Batch Contribution to College")) {
      givingBackRows.push({ ...row, label: line.label.replace("Batch Contribution to College — ", "") });
    } else if (
      line.label.startsWith("Accommodation") ||
      line.label.includes("— accommodation") ||
      line.label.startsWith("Extra bed") ||
      line.label.startsWith("GST")
    ) {
      accommodationRows.push(row);
    } else {
      guestRows.push(row);
    }
  }

  if (guestRows.length > 0) sections.push({ title: "Guests & Meals", rows: guestRows });
  if (accommodationRows.length > 0) sections.push({ title: "Accommodation", rows: accommodationRows });

  if (pricingBreakup.donation > 0) {
    givingBackRows.push({ label: "Reunion Event Donation", value: formatINR(pricingBreakup.donation) });
  }
  if (givingBackRows.length > 0) sections.push({ title: "Giving Back", rows: givingBackRows });

  return sections;
}

// ── DetailField ─────────────────────────────────────────────────────────────

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined | null;
}) {
  return (
    <div className="py-1">
      <dt className="text-[10px] text-muted uppercase tracking-wider leading-none">{label}</dt>
      <dd className="text-sm text-charcoal mt-0.5">
        {value !== undefined && value !== null && value !== "" ? String(value) : "—"}
      </dd>
    </div>
  );
}

// ── Edit form types ───────────────────────────────────────────────────────────

type EditAttendee = EditableAttendee;

interface EditFormState {
  // Cosmetic
  fullName: string;
  whatsapp: string;
  mobileAlternate: string;
  branch: string;
  city: string;
  country: string;
  gender: string;
  tshirtSize: string;
  alumniMeal: MealPreference;
  // Cost-affecting
  participationType: ParticipationType;
  accommodation: string;
  checkIn: string;
  checkOut: string;
  extraBed: boolean;
  breakfastAdult: string;
  breakfastChild: string;
  donationAmount: string;
  contributionSplits: Record<string, string>; // cause → string amount for inputs
  attendees: EditAttendee[];
  // Gated
  email: string;
  emailEditing: boolean;
}

function initEditState(
  reg: StaffRegistrationDetail,
  attendees: AttendeeRecord[],
): EditFormState {
  return {
    fullName: reg.fullName,
    whatsapp: reg.whatsapp,
    mobileAlternate: reg.mobileAlternate ?? "",
    branch: reg.branch,
    city: reg.city,
    country: reg.country,
    gender: reg.gender ?? "",
    tshirtSize: reg.attendance.tshirtSize ?? "",
    alumniMeal: (reg.attendance.mealPreference as MealPreference) ?? "non_veg",
    participationType: (reg.attendance.participationType as ParticipationType) ?? "full_celebration",
    accommodation: reg.accommodation?.type ?? "none",
    checkIn: reg.accommodation?.checkIn ?? CHECKIN_OPTIONS[1],
    checkOut: reg.accommodation?.checkOut ?? CHECKOUT_OPTIONS[0],
    extraBed: reg.accommodation?.extraBed ?? false,
    breakfastAdult: String(reg.accommodation?.breakfastAdult ?? 0),
    breakfastChild: String(reg.accommodation?.breakfastChild ?? 0),
    donationAmount: reg.donation ? String(reg.donation) : "",
    contributionSplits: Object.fromEntries(
      Object.entries(reg.contributionSplits ?? {}).map(([cause, amount]) => [cause, String(amount)])
    ),
    attendees: attendees.map((a, i) => ({
      _tempId: `existing-${a.id}-${i}`,
      type: a.type as "spouse" | "child" | "guest",
      name: a.name ?? "",
      age: a.age !== null && a.age !== undefined ? String(a.age) : "",
      relationship: a.relationship ?? "",
      meal: (a.mealPreference as MealPreference) ?? "non_veg",
    })),
    email: reg.email,
    emailEditing: false,
  };
}

function initEditableTshirts(tshirts: import("@/lib/staff-types").Tshirt[]): TshirtItem[] {
  return tshirts.map((t) => ({
    _key: `existing-${t.id}`,
    id: t.id,
    gender: t.gender,
    size: t.size,
    isIncluded: t.isIncluded,
  }));
}

function initEditableCharges(charges: import("@/lib/staff-types").AdditionalCharge[]): ChargeItem[] {
  return charges.map((c) => ({
    _key: `existing-${c.id}`,
    id: c.id,
    description: c.description,
    amount: c.amount,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
  }));
}

/** Map edit form state → Registration shape for calculateTotal(). */
function formStateToRegistration(form: EditFormState): Registration {
  const spouse = form.attendees.find((a) => a.type === "spouse");
  const children = form.attendees
    .filter((a) => a.type === "child")
    .map((a) => ({
      id: a._tempId,
      name: a.name,
      age: Number(a.age) || 0,
      meal: a.meal,
    }));
  const guests = form.attendees
    .filter((a) => a.type === "guest")
    .map((a) => ({
      id: a._tempId,
      name: a.name,
      relationship: a.relationship,
      meal: a.meal,
    }));

  const hasAccommodation =
    form.accommodation !== "none" && form.participationType !== "campus_only";

  const contributionSplits: Partial<Record<string, number>> = {};
  for (const [cause, val] of Object.entries(form.contributionSplits)) {
    const num = Number(val);
    if (num > 0) contributionSplits[cause] = num;
  }

  const donationAmount = Number(form.donationAmount) || 0;

  return {
    contact: {
      fullName: form.fullName,
      branch: form.branch,
      gender: (form.gender as "male" | "female") || "male",
      email: form.email,
      whatsapp: form.whatsapp,
      city: form.city,
      country: form.country,
    },
    attendance: {
      intent: form.participationType === "donation_only" ? "donation_only" : "attending",
      participationType: form.participationType,
      alumniMeal: form.alumniMeal,
      tshirtSize: (form.tshirtSize as Registration["attendance"]["tshirtSize"]) || "M",
    },
    attendees: {
      spouse: spouse ? { name: spouse.name, meal: spouse.meal } : undefined,
      children,
      guests,
    },
    accommodation:
      hasAccommodation
        ? {
            type: form.accommodation as import("@smriti/shared").NonNoneAccommodation,
            checkIn: form.checkIn,
            checkOut: form.checkOut,
            extraBed: form.extraBed,
            breakfastAdult: parseInt(form.breakfastAdult) || 0,
            breakfastChild: parseInt(form.breakfastChild) || 0,
          }
        : undefined,
    donation:
      donationAmount > 0
        ? {
            amount: donationAmount,
            publicAcknowledgement: false,
            felicitationConsent: false,
          }
        : undefined,
    contributionSplits: Object.keys(contributionSplits).length > 0
      ? (contributionSplits as Partial<Record<import("@smriti/shared").ContributionCause, number>>)
      : undefined,
  };
}

// ── FormField wrapper ────────────────────────────────────────────────────────

function FormField({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="py-1.5">
      <label className="block text-[10px] text-muted uppercase tracking-wider leading-none mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
}

// ── EditForm component ────────────────────────────────────────────────────────

interface EditFormProps {
  data: StaffRegistrationDetailResponse;
  hasPendingVerification: boolean;
  verifiedTotal: number;
  onSave: (updatedReg: StaffRegistrationDetail) => void;
  onCancel: () => void;
}

function EditForm({ data, hasPendingVerification, verifiedTotal, onSave, onCancel }: EditFormProps) {
  const toast = useToast();
  const reg = data.registration;
  const [form, setForm] = useState<EditFormState>(() =>
    initEditState(reg, data.attendees)
  );
  const [editTshirts, setEditTshirts] = useState<TshirtItem[]>(() => initEditableTshirts(data.tshirts));
  const [editCharges, setEditCharges] = useState<ChargeItem[]>(() => initEditableCharges(data.additionalCharges));
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelta, setPendingDelta] = useState<number>(0);

  const accommodationCatalog = getAccommodationCatalog(PRICING_DEFAULTS);
  const selectedRoom = accommodationCatalog.find((r) => r.value === form.accommodation);

  // Live cost preview — includes the pending (unsaved) tshirts/charges edits
  // as extras so the preview total matches what the server would compute
  // once this single save commits (R35.3/R39.4, single-save rework).
  const pricingExtras = {
    tshirts: editTshirts.map((t) => ({ isIncluded: t.isIncluded })),
    additionalCharges: editCharges.map((c) => ({ description: c.description, amount: c.amount })),
  };
  const costPreview = (() => {
    try {
      const registration = formStateToRegistration(form);
      return calculateTotal(registration, PRICING_DEFAULTS, pricingExtras);
    } catch {
      return null;
    }
  })();

  const currentTotal = reg.pricingBreakup.total;
  const newTotal = costPreview?.total ?? currentTotal;
  const delta = newTotal - currentTotal;

  // Cost-affecting fields are locked when a payment is pending_verification
  const costLocked = hasPendingVerification;

  function setField<K extends keyof EditFormState>(key: K, value: EditFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateAttendee(idx: number, patch: Partial<EditAttendee>) {
    setForm((f) => {
      const next = [...f.attendees];
      next[idx] = { ...next[idx], ...patch };
      return { ...f, attendees: next };
    });
  }

  function removeAttendee(idx: number) {
    setForm((f) => ({
      ...f,
      attendees: f.attendees.filter((_, i) => i !== idx),
    }));
  }

  function addAttendee(type: "spouse" | "child" | "guest") {
    const tempId = `new-${type}-${Date.now()}`;
    setForm((f) => ({
      ...f,
      attendees: [
        ...f.attendees,
        { _tempId: tempId, type, name: "", age: "", relationship: "", meal: "non_veg" },
      ],
    }));
  }

  const hasDuplicateSpouse = form.attendees.filter((a) => a.type === "spouse").length > 1;

  function buildRequest(): EditRegistrationRequest {
    const donationNum = Number(form.donationAmount) || 0;
    const splits: Record<string, number> = {};
    for (const [cause, val] of Object.entries(form.contributionSplits)) {
      const n = Number(val);
      if (n > 0) splits[cause] = n;
    }

    return {
      updatedAt: reg.updatedAt,
      fields: {
        fullName: form.fullName.trim() || undefined,
        email: form.emailEditing ? form.email.trim() || undefined : undefined,
        whatsapp: form.whatsapp.trim() || undefined,
        mobileAlternate: form.mobileAlternate.trim() ? form.mobileAlternate.trim() : undefined,
        branch: form.branch || undefined,
        city: form.city.trim() || undefined,
        country: form.country.trim() || undefined,
        gender: form.gender || undefined,
        tshirtSize: form.tshirtSize || undefined,
        alumniMeal: form.alumniMeal || undefined,
        ...(costLocked
          ? {}
          : {
              participationType: form.participationType || undefined,
              accommodation: form.accommodation || undefined,
              checkIn: form.accommodation !== "none" ? form.checkIn || null : null,
              checkOut: form.accommodation !== "none" ? form.checkOut || null : null,
              extraBed: form.extraBed,
              breakfastAdult: parseInt(form.breakfastAdult) || 0,
              breakfastChild: parseInt(form.breakfastChild) || 0,
              donationAmount: donationNum,
              contributionSplits: Object.keys(splits).length > 0 ? splits : undefined,
            }),
      },
      attendees: costLocked
        ? undefined
        : mapEditAttendees(form.attendees),
      tshirts: editTshirts.map(({ id, gender, size, isIncluded }) => ({ id, gender, size, isIncluded })),
      additionalCharges: editCharges.map(({ id, description, amount }) => ({ id, description, amount })),
    };
  }

  async function handleSave() {
    // If delta > 0, show confirmation first
    if (!costLocked && delta > 0) {
      setPendingDelta(delta);
      setConfirmOpen(true);
      return;
    }
    await submitSave();
  }

  async function submitSave() {
    setSaving(true);
    try {
      const result = await editRegistration(reg.id, buildRequest());
      toast.success("Registration updated.");
      onSave({
        ...reg,
        ...result.registration,
        // updatedAt comes back from server
        updatedAt: result.registration.updatedAt,
      } as StaffRegistrationDetail);
    } catch (e: unknown) {
      const err = e as { status?: number };
      if (err?.status === 409) {
        toast.error("Registration was modified by someone else. Please refresh.");
      } else {
        toast.error("Failed to save. Please try again.");
      }
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      {/* Cost-lock warning */}
      {costLocked && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-sm text-amber-800">
          <strong>Cost fields locked</strong> — verify the pending payment before editing cost-affecting fields.
          <br />
          <span className="text-xs">Current verified total: {formatINR(verifiedTotal)}</span>
        </div>
      )}

      <div className="detail-columns grid grid-cols-1 gap-6">
        <style>{`.detail-columns { grid-template-columns: 1fr; } @media (min-width: 900px) { .detail-columns { grid-template-columns: 1fr 1fr; } }`}</style>

        {/* ── Left column ── */}
        <div className="space-y-4">
          {/* Contact */}
          <Card padding={false}>
            <CardHeader title="Contact" />
            <div className="px-5 pb-4 space-y-0.5">
              <FormField label="Full Name">
                <Input
                  value={form.fullName}
                  onChange={(e) => setField("fullName", e.target.value)}
                  placeholder="Full name"
                />
              </FormField>
              <FormField
                label="Email"
                hint={form.emailEditing ? "Changing email updates login identity. Be sure." : undefined}
              >
                <div className="flex gap-2 items-center">
                  <Input
                    value={form.email}
                    onChange={(e) => setField("email", e.target.value)}
                    type="email"
                    disabled={!form.emailEditing}
                    placeholder="Email"
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setField("emailEditing", !form.emailEditing)}
                    className="text-xs text-[#2A7A80] hover:underline whitespace-nowrap"
                  >
                    {form.emailEditing ? "Cancel" : "Edit"}
                  </button>
                </div>
              </FormField>
              <FormField label="WhatsApp">
                <Input
                  value={form.whatsapp}
                  onChange={(e) => setField("whatsapp", e.target.value)}
                  placeholder="WhatsApp number"
                />
              </FormField>
              <FormField label="Mobile (Alt)">
                <Input
                  value={form.mobileAlternate}
                  onChange={(e) => setField("mobileAlternate", e.target.value)}
                  placeholder="Alternate number (optional)"
                />
              </FormField>
              <FormField label="Branch">
                <Select
                  value={form.branch}
                  onChange={(e) => setField("branch", e.target.value)}
                  options={BRANCHES.map((b) => ({ value: b, label: b }))}
                  placeholder="Select branch"
                />
              </FormField>
              <FormField label="City">
                <Input
                  value={form.city}
                  onChange={(e) => setField("city", e.target.value)}
                  placeholder="City"
                />
              </FormField>
              <FormField label="Country">
                <Input
                  value={form.country}
                  onChange={(e) => setField("country", e.target.value)}
                  placeholder="Country"
                />
              </FormField>
              <FormField label="Gender">
                <Select
                  value={form.gender}
                  onChange={(e) => setField("gender", e.target.value)}
                  options={[
                    { value: "male", label: "Male" },
                    { value: "female", label: "Female" },
                  ]}
                  placeholder="Select gender"
                />
              </FormField>
            </div>
          </Card>

          {/* Attendance */}
          <Card padding={false}>
            <CardHeader title="Attendance" />
            <div className="px-5 pb-4 space-y-0.5">
              <FormField label="Participation Type">
                <Select
                  value={form.participationType}
                  onChange={(e) => {
                    if (!costLocked) setField("participationType", e.target.value as ParticipationType);
                  }}
                  disabled={costLocked}
                  options={[
                    { value: "full_celebration", label: "Full Celebration (₹8,500)" },
                    { value: "campus_only", label: "Campus Celebration (₹5,500)" },
                    { value: "donation_only", label: "Donation Only" },
                  ]}
                />
              </FormField>
              {form.participationType !== "donation_only" && (
                <>
                  <FormField label="Alumni Meal">
                    <Select
                      value={form.alumniMeal}
                      onChange={(e) => setField("alumniMeal", e.target.value as MealPreference)}
                      options={[
                        { value: "veg", label: "Veg" },
                        { value: "non_veg", label: "Non-veg" },
                      ]}
                    />
                  </FormField>
                </>
              )}
            </div>
          </Card>

          {/* T-Shirts — hidden for donation-only (R22) */}
          {form.participationType !== "donation_only" && (
            <TshirtsCard
              tshirts={editTshirts}
              costLocked={costLocked}
              onChange={setEditTshirts}
            />
          )}

          {/* Attendees */}
          <Card padding={false}>
            <CardHeader title="Attendees" />
            <div className="px-5 pb-4">
              {costLocked && (
                <p className="text-xs text-amber-700 mb-3">Locked — verify payment first</p>
              )}
              {hasDuplicateSpouse && (
                <p className="text-xs text-red-600 mb-2">Only one spouse allowed.</p>
              )}

              {form.attendees.length === 0 && (
                <p className="text-sm text-muted py-1">No attendees added.</p>
              )}

              <div className="space-y-3">
                {form.attendees.map((a, idx) => (
                  <div key={a._tempId} className="border border-border/60 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                        {a.type}
                      </span>
                      {!costLocked && (
                        <button
                          type="button"
                          onClick={() => removeAttendee(idx)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <Input
                      value={a.name}
                      onChange={(e) => updateAttendee(idx, { name: e.target.value })}
                      placeholder="Name"
                      disabled={costLocked}
                    />
                    {a.type === "child" && (
                      <Input
                        value={a.age}
                        onChange={(e) => updateAttendee(idx, { age: e.target.value })}
                        placeholder="Age"
                        type="number"
                        disabled={costLocked}
                      />
                    )}
                    {a.type === "guest" && (
                      <Input
                        value={a.relationship}
                        onChange={(e) => updateAttendee(idx, { relationship: e.target.value })}
                        placeholder="Relationship"
                        disabled={costLocked}
                      />
                    )}
                    <Select
                      value={a.meal}
                      onChange={(e) => updateAttendee(idx, { meal: e.target.value as MealPreference })}
                      disabled={costLocked}
                      options={[
                        { value: "veg", label: "Veg" },
                        { value: "non_veg", label: "Non-veg" },
                      ]}
                    />
                  </div>
                ))}
              </div>

              {!costLocked && (
                <div className="flex gap-2 mt-3 flex-wrap">
                  {form.attendees.filter((a) => a.type === "spouse").length === 0 && (
                    <button
                      type="button"
                      onClick={() => addAttendee("spouse")}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-gray-50 text-charcoal"
                    >
                      + Spouse
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => addAttendee("child")}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-gray-50 text-charcoal"
                  >
                    + Child
                  </button>
                  <button
                    type="button"
                    onClick={() => addAttendee("guest")}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-gray-50 text-charcoal"
                  >
                    + Guest
                  </button>
                </div>
              )}
            </div>
          </Card>

          {/* Accommodation */}
          {form.participationType !== "campus_only" && form.participationType !== "donation_only" && (
            <Card padding={false}>
              <CardHeader title="Accommodation" />
              <div className="px-5 pb-4 space-y-0.5">
                <FormField label="Type">
                  <Select
                    value={form.accommodation}
                    onChange={(e) => {
                      if (!costLocked) setField("accommodation", e.target.value);
                    }}
                    disabled={costLocked}
                    options={[
                      { value: "none", label: "Not Needed" },
                      { value: "private", label: "Private Room" },
                      { value: "shared_double", label: "Shared Room (2 persons)" },
                      { value: "shared_triple", label: "Shared Room (3 persons)" },
                    ]}
                  />
                </FormField>
                {form.accommodation !== "none" && (
                  <>
                    <FormField label="Check-in">
                      <Select
                        value={form.checkIn}
                        onChange={(e) => {
                          if (!costLocked) setField("checkIn", e.target.value);
                        }}
                        disabled={costLocked}
                        options={[...CHECKIN_OPTIONS].map((d) => ({ value: d, label: d }))}
                      />
                    </FormField>
                    <FormField label="Check-out">
                      <Select
                        value={form.checkOut}
                        onChange={(e) => {
                          if (!costLocked) setField("checkOut", e.target.value);
                        }}
                        disabled={costLocked}
                        options={[...CHECKOUT_OPTIONS].map((d) => ({ value: d, label: d }))}
                      />
                    </FormField>
                    <FormField label="Extra Bed">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.extraBed}
                          onChange={(e) => {
                            if (!costLocked) setField("extraBed", e.target.checked);
                          }}
                          disabled={costLocked}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm text-charcoal">Add extra bed</span>
                      </label>
                    </FormField>
                    <FormField
                      label="Additional Breakfast (12+)"
                      hint={selectedRoom ? `Room includes ${selectedRoom.breakfastFor} breakfast${selectedRoom.breakfastFor > 1 ? "s" : ""} — enter extras only` : undefined}
                    >
                      <Input
                        value={form.breakfastAdult}
                        onChange={(e) => {
                          if (!costLocked) setField("breakfastAdult", e.target.value);
                        }}
                        type="number"
                        min={0}
                        disabled={costLocked}
                        placeholder="0"
                      />
                    </FormField>
                    <FormField label="Additional Breakfast (6-12)">
                      <Input
                        value={form.breakfastChild}
                        onChange={(e) => {
                          if (!costLocked) setField("breakfastChild", e.target.value);
                        }}
                        type="number"
                        min={0}
                        disabled={costLocked}
                        placeholder="0"
                      />
                    </FormField>
                  </>
                )}
              </div>
            </Card>
          )}

          {/* Donation card removed — donation amount now lives in the Contribution Splits card */}
        </div>

        {/* ── Right column ── */}
        <div className="space-y-4">
          {/* Cost Preview */}
          {!costLocked && costPreview !== null && (
            <Card padding={false}>
              <CardHeader
                title="Cost Preview"
                action={
                  <span className="text-sm font-semibold text-charcoal tabular-nums">
                    {formatINR(newTotal)}
                  </span>
                }
              />
              <div className="px-5 pb-4">
                <div className="space-y-1.5 mb-3">
                  {costPreview.base > 0 && (
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-charcoal">Base</span>
                      <span className="tabular-nums">{formatINR(costPreview.base)}</span>
                    </div>
                  )}
                  {costPreview.lines.map((line, i) => (
                    <div key={i} className="flex items-baseline justify-between text-sm">
                      <span className={line.free ? "text-muted" : "text-charcoal"}>{line.label}</span>
                      <span className={`tabular-nums ${line.free ? "text-muted" : ""}`}>
                        {line.free ? "Free" : formatINR(line.fee)}
                      </span>
                    </div>
                  ))}
                  {costPreview.donation > 0 && (
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-charcoal">Donation</span>
                      <span className="tabular-nums">{formatINR(costPreview.donation)}</span>
                    </div>
                  )}
                </div>
                <div className="border-t border-border/50 pt-3">
                  <div className="flex items-baseline justify-between text-sm font-semibold">
                    <span className="text-charcoal">New total</span>
                    <span className="text-charcoal tabular-nums">{formatINR(newTotal)}</span>
                  </div>
                  {delta !== 0 && (
                    <div className="flex items-baseline justify-between text-sm mt-1">
                      <span className="text-muted">Delta vs current</span>
                      <span
                        className={`tabular-nums font-semibold ${
                          delta > 0 ? "text-terracotta" : "text-success"
                        }`}
                      >
                        {delta > 0 ? "+" : ""}{formatINR(delta)}
                      </span>
                    </div>
                  )}
                  {delta === 0 && (
                    <p className="text-xs text-muted mt-1">No payment change</p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Additional Charges */}
          <AdditionalChargesCard
            charges={editCharges}
            costLocked={costLocked}
            onChange={setEditCharges}
          />

          {/* Donations & Contribution splits */}
          <Card padding={false}>
            <CardHeader title="Donations" />
            <div className="px-5 pb-4 space-y-0.5">
              <FormField label="Donation Amount (₹)">
                <Input
                  value={form.donationAmount}
                  onChange={(e) => {
                    if (costLocked) return;
                    setField("donationAmount", e.target.value);
                  }}
                  type="number"
                  disabled={costLocked}
                  placeholder="0"
                />
              </FormField>
              <p className="text-xs text-muted pt-2 pb-1">Contribution splits</p>
              {CONTRIBUTION_CAUSES.map((cause) => (
                <FormField key={cause.value} label={cause.label}>
                  <Input
                    value={form.contributionSplits[cause.value] ?? ""}
                    onChange={(e) => {
                      if (costLocked) return;
                      setField("contributionSplits", {
                        ...form.contributionSplits,
                        [cause.value]: e.target.value,
                      });
                    }}
                    type="number"
                    min={0}
                    disabled={costLocked}
                    placeholder="0"
                  />
                </FormField>
              ))}
            </div>
          </Card>

          {/* Save / Cancel bar (sticky on right column) */}
          <div className="bg-surface border border-border-warm rounded-2xl px-5 py-4">
            <div className="flex gap-3 flex-wrap">
              <Button
                variant="primary"
                onClick={handleSave}
                loading={saving}
                disabled={saving || hasDuplicateSpouse}
              >
                Save Changes
              </Button>
              <Button variant="secondary" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
            </div>
            {delta !== 0 && !costLocked && (
              <p className="text-xs text-muted mt-2">
                {delta > 0
                  ? `Saving will create an additional payment of ${formatINR(delta)}.`
                  : `Saving will reduce the total by ${formatINR(Math.abs(delta))}.`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation dialog for payment-creating edits */}
      <ConfirmDialog
        open={confirmOpen}
        title="Create additional payment?"
        message={`This edit will create an additional payment of ${formatINR(pendingDelta)}. The attendee will be notified via email with a payment link.`}
        confirmLabel="Confirm & Save"
        onConfirm={submitSave}
        onCancel={() => setConfirmOpen(false)}
        loading={saving}
      />
    </>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-surface border border-border-warm rounded-2xl overflow-hidden animate-pulse">
      <div className="px-5 py-4 border-b border-border-warm">
        <div className="h-5 w-32 bg-gray-200 rounded" />
      </div>
      <div className="p-5 space-y-3">
        <div className="h-4 w-full bg-gray-100 rounded" />
        <div className="h-4 w-3/4 bg-gray-100 rounded" />
        <div className="h-4 w-5/6 bg-gray-100 rounded" />
      </div>
    </div>
  );
}

// ── VerifyRejectBar ────────────────────────────────────────────────────────

type VerifyType = "full" | "short" | "over";

interface VerifyRejectBarProps {
  payment: PaymentRecord;
  onStatusChange: () => void;
}

function VerifyRejectBar({ payment, onStatusChange }: VerifyRejectBarProps) {
  const toast = useToast();
  const [referenceId, setReferenceId] = useState("");
  const [showRejectTextarea, setShowRejectTextarea] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [proofData, setProofData] = useState<{ url: string; contentType: string } | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [verifyType, setVerifyType] = useState<VerifyType>("full");
  const [actualAmountValue, setActualAmountValue] = useState<number>(0);
  const { hasScope } = useStaffScopes();
  const hasBankTxnScope = hasScope("bank_txns");
  const [showBankTxnModal, setShowBankTxnModal] = useState(false);
  const [selectedBankTxn, setSelectedBankTxn] = useState<BankTransaction | null>(null);
  // Keep ref in sync so cleanup always revokes the current URL
  const proofUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!payment.proofFileKey) return;
    let alive = true;
    fetchFile(payment.proofFileKey)
      .then((data) => {
        if (alive) {
          setProofData(data);
          proofUrlRef.current = data.url;
        } else {
          // Component unmounted before the fetch resolved — revoke immediately
          URL.revokeObjectURL(data.url);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [payment.proofFileKey]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (proofUrlRef.current) {
        URL.revokeObjectURL(proofUrlRef.current);
        proofUrlRef.current = null;
      }
    };
  }, []);

  const handleVerify = async () => {
    setLoading(true);
    try {
      if (verifyType === "short") {
        await verifyPayment(payment.id, referenceId, actualAmountValue, { withShortfallPayment: true });
        const shortfall = payment.amount - actualAmountValue;
        toast.success(`Payment verified for ₹${actualAmountValue.toLocaleString("en-IN")}. Balance payment of ₹${shortfall.toLocaleString("en-IN")} created — notification sent.`);
      } else if (verifyType === "over") {
        await verifyPayment(payment.id, referenceId, actualAmountValue);
        const excess = actualAmountValue - payment.amount;
        toast.success(`Payment verified. Refund of ₹${excess.toLocaleString("en-IN")} recorded.`);
      } else {
        await verifyPayment(payment.id, referenceId, payment.amount);
        toast.success("Payment verified. Registration confirmed.");
      }
      if (selectedBankTxn) {
        linkBankTransaction(selectedBankTxn.id, [payment.id]).catch((err) => {
          console.warn("Bank txn link failed (verification succeeded):", err);
        });
      }
      onStatusChange();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to verify payment. Please try again.";
      toast.error(msg);
    } finally {
      setLoading(false);
      setConfirmOpen(false);
    }
  };

  const verifyLabel =
    verifyType === "short" ? "Verify & Create Balance" : verifyType === "over" ? "Verify & Record Refund" : "Verify Payment";

  const canVerify = Boolean(
    referenceId.trim() &&
      (verifyType === "full" ||
        (verifyType === "short" && actualAmountValue > 0 && actualAmountValue < payment.amount) ||
        (verifyType === "over" && actualAmountValue > payment.amount)),
  );

  const dialogTitle =
    verifyType === "short" ? "Verify Short Payment" : verifyType === "over" ? "Verify Overpayment" : "Verify Payment";

  const dialogMessage =
    verifyType === "short"
      ? `Verify ₹${actualAmountValue.toLocaleString("en-IN")} of ₹${payment.amount.toLocaleString("en-IN")} expected.\n\nThis will:\n• Verify the payment for ₹${actualAmountValue.toLocaleString("en-IN")}\n• Create a ₹${(payment.amount - actualAmountValue).toLocaleString("en-IN")} balance payment\n• Notify the registrant via email`
      : verifyType === "over"
        ? `₹${actualAmountValue.toLocaleString("en-IN")} received against ₹${payment.amount.toLocaleString("en-IN")} expected.\n\nThis will:\n• Verify the payment for ₹${payment.amount.toLocaleString("en-IN")}\n• Record a ₹${(actualAmountValue - payment.amount).toLocaleString("en-IN")} refund`
        : `Verify payment of ₹${payment.amount.toLocaleString("en-IN")} with reference ${referenceId}?`;

  const handleReject = async () => {
    setLoading(true);
    try {
      await rejectPayment(payment.id, rejectComment);
      toast.success("Proof rejected. Alumni notified.");
      onStatusChange();
    } catch {
      toast.error("Failed to reject payment. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBankTxn = (txn: BankTransaction) => {
    const parsed = parseBankDescription(txn.description);
    setReferenceId(parsed.txnRef ?? txn.refNo ?? "");
    const amount = txn.creditPaise / 100;
    if (amount === payment.amount) {
      setVerifyType("full");
      setActualAmountValue(0);
    } else if (amount < payment.amount) {
      setVerifyType("short");
      setActualAmountValue(amount);
    } else {
      setVerifyType("over");
      setActualAmountValue(amount);
    }
    setSelectedBankTxn(txn);
    setShowBankTxnModal(false);
  };

  const clearBankTxnSelection = () => {
    setSelectedBankTxn(null);
    setReferenceId("");
    setVerifyType("full");
    setActualAmountValue(0);
  };

  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
        <p className="font-heading font-bold text-charcoal mb-4">
          Payment proof uploaded — review and verify
        </p>

        {proofData && (
          <div className="mb-4">
            {proofData.contentType === "application/pdf" || imgFailed ? (
              <a
                href={proofData.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-border rounded-lg text-sm font-semibold text-charcoal hover:bg-gray-50 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                View Payment Proof
                {proofData.contentType === "application/pdf" && <span className="text-xs text-muted-foreground">(PDF)</span>}
              </a>
            ) : (
              <img
                src={proofData.url}
                alt="Payment proof"
                className="max-w-full max-h-[400px] rounded-lg border border-border object-contain"
                onError={() => setImgFailed(true)}
              />
            )}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-semibold text-charcoal mb-1.5">
            Bank Reference / UTR Number
          </label>
          <div className="flex gap-2">
            <Input
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
              placeholder="Enter reference ID from the proof"
              className="flex-1"
            />
            {hasBankTxnScope && (
              <button
                type="button"
                onClick={() => setShowBankTxnModal(true)}
                title="Match bank transaction"
                className="shrink-0 min-h-11 min-w-11 px-3 rounded-lg border border-border text-charcoal/60 hover:text-charcoal hover:border-soft-aqua hover:bg-soft-aqua/10 transition flex items-center justify-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              </button>
            )}
          </div>
        </div>

        {selectedBankTxn && (
          <div className="mb-4 text-sm text-charcoal/70 bg-soft-aqua/10 border border-soft-aqua/30 rounded-lg px-3 py-2 flex justify-between items-center gap-2">
            <span>
              Linked to bank txn #{selectedBankTxn.id} · {parseBankDescription(selectedBankTxn.description).name ?? "Unknown"} · ₹
              {(selectedBankTxn.creditPaise / 100).toLocaleString("en-IN")}
            </span>
            <button
              type="button"
              onClick={clearBankTxnSelection}
              className="text-charcoal/50 hover:text-charcoal ml-2 shrink-0"
            >
              ✕
            </button>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-semibold text-charcoal mb-1.5">Verification Type</label>
          <div className="flex border border-border rounded-lg overflow-hidden">
            {([
              { value: "full" as const, label: `Full ₹${payment.amount.toLocaleString("en-IN")}` },
              { value: "short" as const, label: `< ₹${payment.amount.toLocaleString("en-IN")}` },
              { value: "over" as const, label: `> ₹${payment.amount.toLocaleString("en-IN")}` },
            ]).map((opt) => (
              <label
                key={opt.value}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium tabular-nums cursor-pointer border-r border-border last:border-r-0 transition ${
                  verifyType === opt.value ? "bg-blue-50" : "bg-white hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="verify-type"
                  checked={verifyType === opt.value}
                  onChange={() => { setVerifyType(opt.value); setActualAmountValue(0); }}
                  className="accent-charcoal"
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {verifyType !== "full" && (
          <div className="bg-gray-50 border border-border rounded-lg p-3 mb-4">
            <label className="block text-xs font-semibold text-muted mb-1">Amount Actually Received (₹)</label>
            <Input
              type="number"
              value={actualAmountValue || ""}
              onChange={(e) => setActualAmountValue(Number(e.target.value))}
              min={1}
            />
            {verifyType === "short" && actualAmountValue > 0 && actualAmountValue < payment.amount && (
              <div className="mt-2 text-xs bg-amber-50 border-l-3 border-amber-400 text-amber-800 p-2 rounded">
                A balance payment of <strong>₹{(payment.amount - actualAmountValue).toLocaleString("en-IN")}</strong> will
                be created and the registrant will be notified via email with a payment link.
              </div>
            )}
            {verifyType === "over" && actualAmountValue > payment.amount && (
              <div className="mt-2 text-xs bg-blue-50 border-l-3 border-blue-400 text-blue-800 p-2 rounded">
                The payment will be verified for <strong>₹{payment.amount.toLocaleString("en-IN")}</strong> (the expected
                amount). A refund of <strong>₹{(actualAmountValue - payment.amount).toLocaleString("en-IN")}</strong> will
                be recorded.
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={!canVerify}
            loading={loading && confirmOpen}
          >
            {verifyLabel}
          </Button>
          <button
            type="button"
            onClick={() => setShowRejectTextarea((v) => !v)}
            className="px-4 py-2 rounded-xl border-2 border-red-400 text-red-600 font-semibold text-sm hover:bg-red-50 transition"
          >
            {showRejectTextarea ? "Cancel" : "Reject"}
          </button>
        </div>

        {showRejectTextarea && (
          <div className="mt-4 border-t border-amber-200 pt-4">
            <Textarea
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              placeholder="Reason for rejection (min 10 characters)"
              rows={3}
            />
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              onClick={handleReject}
              disabled={rejectComment.length < 10}
              loading={loading && !confirmOpen}
            >
              Confirm Rejection
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={dialogTitle}
        message={dialogMessage}
        confirmLabel={verifyLabel}
        onConfirm={handleVerify}
        onCancel={() => setConfirmOpen(false)}
        loading={loading}
      />

      <BankTxnMatchModal
        open={showBankTxnModal}
        onClose={() => setShowBankTxnModal(false)}
        onSelect={handleSelectBankTxn}
        expectedAmount={payment.amount}
      />
    </>
  );
}

// ── BankTxnMatchModal ──────────────────────────────────────────────────────

interface BankTxnMatchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (txn: BankTransaction) => void;
  expectedAmount: number;
}

function bankTxnTypeBadgeClass(type: string): string {
  if (type === "UPI") return "bg-blue-100 text-blue-700";
  if (type === "NEFT") return "bg-green-100 text-green-700";
  if (type === "IMPS") return "bg-purple-100 text-purple-700";
  if (type === "SBI") return "bg-orange-100 text-orange-700";
  return "bg-gray-100 text-muted";
}

function BankTxnMatchModal({ open, onClose, onSelect, expectedAmount }: BankTxnMatchModalProps) {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchBankCredits(showAll)
      .then((res) => setTransactions(res.transactions))
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [open, showAll]);

  if (!open) return null;

  const q = search.trim().toLowerCase();
  const filtered = transactions.filter((tx) => {
    if (!q) return true;
    const parsed = parseBankDescription(tx.description);
    const amountStr = (tx.creditPaise / 100).toString();
    return (
      (parsed.name ?? "").toLowerCase().includes(q) ||
      amountStr.includes(q) ||
      tx.txnDate.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort(
    (a, b) =>
      Math.abs(a.creditPaise / 100 - expectedAmount) - Math.abs(b.creditPaise / 100 - expectedAmount),
  );

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <h2 className="font-heading text-lg font-semibold text-charcoal">Match Bank Transaction</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-charcoal text-xl leading-none px-2 min-h-11 min-w-11"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border/50 flex flex-wrap items-center gap-3">
          <div className="flex border border-border rounded-lg overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className={`px-3 py-2 font-medium ${!showAll ? "bg-soft-aqua/30 text-charcoal" : "bg-white text-muted hover:bg-gray-50"}`}
            >
              Unreconciled
            </button>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className={`px-3 py-2 font-medium border-l border-border ${showAll ? "bg-soft-aqua/30 text-charcoal" : "bg-white text-muted hover:bg-gray-50"}`}
            >
              All
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, amount, or date…"
            className="flex-1 min-w-[160px] h-9 px-3 text-sm rounded-lg border border-border bg-white text-charcoal outline-none focus:border-soft-aqua"
          />
        </div>

        <div className="overflow-y-auto flex-1 px-2 py-2">
          {loading ? (
            <p className="text-sm text-muted py-6 text-center">Loading…</p>
          ) : sorted.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">No transactions found.</p>
          ) : (
            <div className="divide-y divide-border/30">
              {sorted.map((tx) => {
                const parsed = parseBankDescription(tx.description);
                const amount = tx.creditPaise / 100;
                const diff = amount - expectedAmount;
                const reconciled = tx.linkedPayments.length > 0;

                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => onSelect(tx)}
                    className="w-full text-left px-3 py-3 hover:bg-[#FAFAF8] transition rounded-lg flex items-center justify-between gap-3 min-h-11"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-charcoal">{parsed.name ?? "Unknown"}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${bankTxnTypeBadgeClass(parsed.type)}`}>
                          {parsed.type}
                        </span>
                        {reconciled && <Badge variant="success">Reconciled</Badge>}
                      </div>
                      <div className="text-xs text-muted mt-0.5">{tx.txnDate}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-charcoal tabular-nums">
                        ₹{amount.toLocaleString("en-IN")}
                      </div>
                      <div className={`text-xs tabular-nums ${diff === 0 ? "text-green-600" : "text-muted"}`}>
                        {diff === 0 ? "Exact match" : `${diff > 0 ? "+" : ""}₹${diff.toLocaleString("en-IN")}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── UploadOnBehalf ─────────────────────────────────────────────────────────

interface UploadOnBehalfProps {
  regId: number;
  onStatusChange: () => void;
}

function UploadOnBehalf({ regId, onStatusChange }: UploadOnBehalfProps) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadProofOnBehalf(regId, file);
      toast.success("Proof uploaded. Payment is now pending verification.");
      onStatusChange();
    } catch {
      toast.error("Failed to upload proof. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-6">
      <p className="font-heading font-bold text-charcoal mb-2">Upload Payment Proof</p>
      <p className="text-sm text-muted mb-4">Upload proof on behalf of this alumni</p>
      <input
        type="file"
        accept="image/jpeg,image/png,image/jpg,application/pdf"
        onChange={handleFileUpload}
        disabled={uploading}
        className="text-sm text-charcoal"
      />
      {uploading && <p className="text-sm text-muted mt-2">Uploading...</p>}
    </div>
  );
}

// ── PaymentStatusBadge ─────────────────────────────────────────────────────

function paymentStatusVariant(status: string): BadgeVariant {
  if (status === "verified") return "success";
  if (status === "pending_verification") return "info";
  if (status === "rejected") return "error";
  return "warning";
}

function paymentStatusLabel(status: string): string {
  if (status === "verified") return "Verified";
  if (status === "pending_verification") return "Needs Verification";
  if (status === "rejected") return "Rejected";
  if (status === "payment_pending") return "Pending";
  return status;
}

// ── File type icon ──────────────────────────────────────────────────────────

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-red-400">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  if (mimeType.startsWith("image/")) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-blue-400">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-muted">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

// ── DocumentViewLink ────────────────────────────────────────────────────────

function DocumentViewLink({ r2Key, fileName, mimeType }: { r2Key: string; fileName: string; mimeType: string }) {
  const handleView = async () => {
    try {
      const { url } = await fetchFile(r2Key);
      window.open(url, "_blank");
    } catch {
      // silent
    }
  };

  return (
    <button
      type="button"
      onClick={handleView}
      className="inline-flex items-center gap-1.5 text-sm text-[#2A7A80] hover:underline font-medium"
    >
      <FileTypeIcon mimeType={mimeType} />
      {fileName}
    </button>
  );
}

// ── PhotoAvatar ────────────────────────────────────────────────────────────

interface PhotoAvatarProps {
  thumbKey: string | null;
  fullKey: string | null;
}

function PhotoAvatar({ thumbKey, fullKey }: PhotoAvatarProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const urlRef = useRef<string | null>(null);

  const fetchKey = thumbKey ?? fullKey;

  useEffect(() => {
    if (!fetchKey) return;
    let alive = true;
    setLoading(true);
    fetchFile(fetchKey)
      .then((data) => {
        if (alive) {
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          setPhotoUrl(data.url);
          urlRef.current = data.url;
        } else {
          URL.revokeObjectURL(data.url);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [fetchKey]);

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  const handleClick = async () => {
    if (!fullKey) return;
    try {
      const { url } = await fetchFile(fullKey);
      window.open(url, "_blank");
    } catch {
      // silent
    }
  };

  if (!fetchKey) {
    return (
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-16 h-16 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
    );
  }

  return (
    <button
      type="button"
      onClick={fullKey ? handleClick : undefined}
      className={`w-16 h-16 rounded-full overflow-hidden flex-shrink-0 ${fullKey ? "cursor-pointer" : "cursor-default"}`}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt="Profile photo"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      )}
    </button>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function RegistrationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const listType = searchParams.get("type") ?? "attendee";
  const [data, setData] = useState<StaffRegistrationDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingLink, setSendingLink] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [replacingPhoto, setReplacingPhoto] = useState(false);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "payments" | "activity">("overview");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const loadDetail = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetchRegistrationDetail(Number(id))
      .then((detail) => {
        setData(detail);
        const regId = detail.registration.id;
        fetchRefunds()
          .then((refundData) => {
            setRefunds(refundData.refunds.filter((r) => r.registrationId === regId));
          })
          .catch(() => {});
      })
      .catch((e: { status?: number }) => {
        setError(e?.status === 404 ? "Registration not found" : "Failed to load registration");
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const reg = data?.registration;
  useDocumentTitle(reg ? `${formatRegCodeForDisplay(reg.regCode)} — ${reg.fullName}` : "Registration Detail");

  // Derive action-bar targets
  const pendingVerificationPayment = data?.payments.find((p) => p.status === "pending_verification") ?? null;
  const latestPayment = data?.payments.length
    ? [...data.payments].sort((a, b) => b.createdAt - a.createdAt)[0]
    : null;

  // Payment summary
  const collected = data?.payments.reduce((sum, p) => p.status === "verified" ? sum + p.amount : sum, 0) ?? 0;
  const totalOwed = data?.registration.totalAmount ?? 0;
  // Action-bar flags: verified money → cancellation; stubs only → archive.
  // BOTH are gated on having no pending_verification payment: the server
  // rejects archive and cancellation with 409 while a proof is unreviewed,
  // so a mixed verified + pending_verification registration must offer
  // neither action — the Verify/Reject bar is the only decision point.
  const hasVerifiedPayments = (data?.payments.some((p) => p.status === "verified")) ?? false;
  const isAllStubs = (data?.payments.every((p) => p.status === "payment_pending")) ?? false;
  const hasPendingVerification = pendingVerificationPayment !== null;
  const canArchive = isAllStubs && !hasPendingVerification;
  const canCancel = hasVerifiedPayments && !hasPendingVerification;
  const participationLabel = data?.registration.attendance.participationType
    ? PARTICIPATION_LABELS[data.registration.attendance.participationType]
    : undefined;
  const paymentBreakdownSections = data ? buildPaymentBreakdownSections(data.registration.pricingBreakup, participationLabel) : [];

  // ── Loading skeleton ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="py-2">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-9 w-28 bg-gray-200 rounded-lg animate-pulse" />
          <div className="h-5 w-24 bg-gray-200 rounded animate-pulse" />
          <div className="h-6 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="h-5 w-20 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="h-32 bg-amber-50 border border-amber-100 rounded-2xl mb-6 animate-pulse" />
        <div className="detail-columns grid grid-cols-1 gap-6">
          <style>{`.detail-columns { grid-template-columns: 1fr; } @media (min-width: 900px) { .detail-columns { grid-template-columns: 1fr 1fr; } }`}</style>
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </div>
    );
  }

  // ── Error states ─────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="py-2">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/staff/dashboard?type=${listType}`)}>
            ← Back to list
          </Button>
        </div>
        <div className="text-center py-16">
          <p className="text-lg font-heading font-bold text-charcoal mb-2">{error}</p>
          {error !== "Registration not found" && (
            <Button variant="secondary" onClick={loadDetail} className="mt-4">
              Try Again
            </Button>
          )}
          {error === "Registration not found" && (
            <Button variant="secondary" onClick={() => navigate(`/staff/dashboard?type=${listType}`)} className="mt-4">
              Back to List
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!reg || !data) return null;

  const handlePhotoSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setReplacingPhoto(true);
    try {
      const result = await replacePhoto(reg.id, file);
      toast.success(result.message || "Photo updated.");
      loadDetail();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to replace photo.");
    } finally {
      setReplacingPhoto(false);
    }
  };

  // ── Full page ─────────────────────────────────────────────────────────────

  const hasAccommodation =
    data.registration.accommodation &&
    data.registration.accommodation.type;

  return (
    <div className="py-2">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/staff/dashboard?type=${listType}`)}>
          ← Back to list
        </Button>
        <span className="font-mono text-terracotta font-semibold text-sm">{formatRegCodeForDisplay(reg.regCode)}</span>
        <h1 className="font-heading text-xl font-bold text-charcoal">{reg.fullName}</h1>
        <Badge variant={statusVariant(reg.status)}>{statusLabel(reg.status)}</Badge>
        {reg.attendance.participationType && (
          <ParticipationPill participationType={reg.attendance.participationType} />
        )}
        <div className="ml-auto">
          {isEditing ? (
            <Button variant="secondary" size="sm" onClick={() => setIsEditing(false)}>
              ✕ Cancel Edit
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* ── Send Payment Link ── */}
      {reg.status !== "confirmed" && (
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={sendingLink}
            onClick={async () => {
              setSendingLink(true);
              try {
                const result = await sendPaymentLink(reg.id);
                toast.success(`Payment link sent to ${result.sentTo}`);
              } catch {
                toast.error("Failed to send payment link");
              } finally {
                setSendingLink(false);
              }
            }}
          >
            {sendingLink ? "Sending…" : "Send Payment Link"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={copyingLink}
            onClick={async () => {
              setCopyingLink(true);
              try {
                const result = await generatePaymentLink(reg.id);
                await navigator.clipboard.writeText(result.link);
                toast.success("Payment link copied to clipboard");
              } catch {
                toast.error("Failed to generate payment link");
              } finally {
                setCopyingLink(false);
              }
            }}
          >
            {copyingLink ? "Copying…" : "Copy Payment Link"}
          </Button>
        </div>
      )}

      {/* ── Archive / Cancel actions ──
          Registrations with verified payments must use the cancellation
          route — it preserves the source payments as refunds. Ordinary
          archive remains for registrations with no real payment activity
          (payment_pending stubs only). A registration with ANY
          pending_verification payment (even alongside verified money)
          offers neither action: the Verify/Reject bar above is the
          decision point, and both archive and cancellation are rejected
          server-side until the proof is decided. */}
      {canArchive ? (
        <div className="mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setArchiveDialogOpen(true)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            Archive Registration
          </Button>
        </div>
      ) : canCancel ? (
        <div className="mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCancelDialogOpen(true)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            Cancel and create refund
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={archiveDialogOpen}
        title="Archive this registration?"
        message="This will permanently remove the registration. Data is preserved in the archive and can be viewed there."
        confirmLabel="Archive"
        confirmVariant="danger"
        loading={archiving}
        onCancel={() => setArchiveDialogOpen(false)}
        onConfirm={async () => {
          setArchiving(true);
          try {
            await archiveRegistration(reg.id);
            toast.success("Registration archived.");
            navigate(`/staff/dashboard?type=${listType}`);
          } catch {
            toast.error("Failed to archive registration. Please try again.");
            setArchiving(false);
            setArchiveDialogOpen(false);
          }
        }}
      />

      {/* ── Cancellation confirmation (paid registrations) ── */}
      <ConfirmDialog
        open={cancelDialogOpen}
        title="Cancel and create refund?"
        message={`This will permanently remove the registration, archive its full record, and create a pending refund of ${formatINR(collected)} (the verified payment amount). The refund can be completed later with a bank reference.`}
        confirmLabel="Cancel & Create Refund"
        confirmVariant="danger"
        loading={cancelling}
        confirmDisabled={!cancelReason.trim()}
        onCancel={() => {
          setCancelDialogOpen(false);
          setCancelReason("");
        }}
        onConfirm={async () => {
          setCancelling(true);
          try {
            await cancelRegistration(reg.id, cancelReason.trim());
            toast.success("Registration cancelled. Refund created.");
            navigate("/staff/refunds");
          } catch (err: unknown) {
            const status = (err as { status?: number } | null)?.status;
            if (status === 409) {
              toast.error("Cannot cancel: a payment may be awaiting verification, or the registration was already cancelled.");
            } else {
              // FALLBACK-OK: src/web/src/lib/staff-api.ts cancelRegistration —
              // the API contract enumerates exactly the 409 (pending
              // verification / already cancelled) and 422 (blank reason)
              // business states. This UI sends a trimmed non-blank reason, so
              // 409 is the only business error reachable here; any other
              // status (0 network, 4xx/5xx) is a transport/server failure
              // whose reasoned recovery is a retry prompt.
              toast.error("Failed to cancel registration. Please try again.");
            }
            setCancelling(false);
            setCancelDialogOpen(false);
            setCancelReason("");
          }
        }}
      >
        <div className="mb-4">
          <label htmlFor="cancel-reason" className="block text-xs font-semibold text-charcoal mb-1.5">
            Reason (required)
          </label>
          <Textarea
            id="cancel-reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Why is this registration being cancelled?"
          />
          {collected > 0 && (
            <p className="text-xs text-muted mt-2">
              Refund amount: <strong className="text-charcoal">{formatINR(collected)}</strong>
            </p>
          )}
        </div>
      </ConfirmDialog>

      {/* ── Verify/Reject action bar ── */}
      {!isEditing && pendingVerificationPayment && (
        <VerifyRejectBar payment={pendingVerificationPayment} onStatusChange={loadDetail} />
      )}

      {/* ── Upload-on-behalf ── */}
      {!isEditing && !pendingVerificationPayment && latestPayment?.status === "payment_pending" && (
        <UploadOnBehalf regId={reg.id} onStatusChange={loadDetail} />
      )}

      {/* ── Edit mode ── */}
      {isEditing && (
        <EditForm
          data={data}
          hasPendingVerification={!!pendingVerificationPayment}
          verifiedTotal={collected}
          onSave={(updatedReg) => {
            setData((prev) => prev ? { ...prev, registration: updatedReg } : prev);
            setIsEditing(false);
            loadDetail(); // reload to get fresh attendees, payments, audit
          }}
          onCancel={() => setIsEditing(false)}
        />
      )}

      {/* ── Tab navigation ── */}
      {!isEditing && <>
        <div className="flex gap-1 border-b border-border/50 mb-5">
          {([
            { key: "overview", label: "Overview" },
            { key: "payments", label: "Payments" },
            { key: "activity", label: "Activity" },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? "border-terracotta text-charcoal"
                  : "border-transparent text-muted hover:text-charcoal"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Overview ── */}
        {activeTab === "overview" && (
          <div className="space-y-4 max-w-2xl">
            {/* Contact */}
            <Card padding={false}>
              <CardHeader title="Contact" />
              <div className="px-5 pt-1 pb-3 flex items-center gap-4">
                <PhotoAvatar thumbKey={reg.photoThumbKey} fullKey={reg.photoFileKey} />
                <div>
                  <p className="text-base font-semibold text-primary">{reg.fullName}</p>
                  <p className="text-sm text-muted">{reg.branch}</p>
                </div>
                <div className="ml-auto">
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="sr-only"
                    aria-label="Choose replacement photo"
                    onChange={handlePhotoSelected}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={replacingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    Replace Photo
                  </Button>
                </div>
              </div>
              <dl className="px-5 pb-4 divide-y divide-border/50">
                <DetailField label="Email" value={reg.email} />
                <DetailField label="WhatsApp" value={reg.whatsapp} />
                <DetailField label="City" value={reg.city} />
                <DetailField label="Country" value={reg.country} />
                <DetailField label="Registered" value={formatDate(reg.createdAt)} />
              </dl>
            </Card>

            {/* Attendance */}
            <Card padding={false}>
              <CardHeader title="Attendance" />
              <dl className="px-5 pb-4 divide-y divide-border/50">
                <DetailField label="Intent" value={reg.attendance.intent} />
                {reg.attendance.intent !== 'donation_only' && (
                  <>
                    <DetailField label="Meal Preference" value={reg.attendance.mealPreference} />
                    <DetailField
                      label={`T-Shirts${data.tshirts.length > 0 ? ` (${data.tshirts.length})` : ''}`}
                      value={
                        data.tshirts.length > 0
                          ? data.tshirts.map((t) => {
                              const g = t.gender === 'male' ? 'M' : t.gender === 'female' ? 'W' : '?';
                              return `${t.size} (${g})${t.isIncluded ? ' · Included' : ''}`;
                            }).join(', ')
                          : reg.attendance.tshirtSize || '—'
                      }
                    />
                  </>
                )}
              </dl>
            </Card>

            {/* Attendees */}
            {data.attendees.length > 0 && (
              <Card padding={false}>
                <CardHeader title={`Attendees (${data.attendees.length})`} />
                <div className="px-5 pb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50">
                        <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">Name</th>
                        <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">Type</th>
                        <th className="text-left text-xs text-muted uppercase tracking-wider py-2">Meal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {data.attendees.map((attendee) => (
                        <tr key={attendee.id}>
                          <td className="py-2 pr-3 text-charcoal font-medium">{attendee.name}</td>
                          <td className="py-2 pr-3"><Badge variant="default">{attendee.type}</Badge></td>
                          <td className="py-2 text-charcoal">{attendee.mealPreference || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Accommodation */}
            {hasAccommodation && (
              <Card padding={false}>
                <CardHeader title="Accommodation" />
                <dl className="px-5 pb-4 divide-y divide-border/50">
                  <DetailField label="Type" value={ACCOMMODATION_LABELS[reg.accommodation.type as keyof typeof ACCOMMODATION_LABELS] ?? reg.accommodation.type} />
                  <DetailField label="Check-in" value={reg.accommodation.checkIn} />
                  <DetailField label="Check-out" value={reg.accommodation.checkOut} />
                  {reg.accommodation.extraBed && <DetailField label="Extra bed" value="Yes" />}
                  {reg.accommodation.breakfastAdult > 0 && (
                    <DetailField label="Additional Breakfast (12+)" value={reg.accommodation.breakfastAdult} />
                  )}
                  {reg.accommodation.breakfastChild > 0 && (
                    <DetailField label="Additional Breakfast (6-12)" value={reg.accommodation.breakfastChild} />
                  )}
                </dl>
              </Card>
            )}
          </div>
        )}

        {/* ── Tab: Payments ── */}
        {activeTab === "payments" && (
          <div className="space-y-4 max-w-2xl">
            {/* Payment Breakdown */}
            <Card padding={false}>
              <CardHeader
                title="Payment Breakdown"
                action={
                  <span className="text-sm font-semibold text-charcoal tabular-nums">
                    {formatINR(reg.pricingBreakup.total)}
                  </span>
                }
              />
              <div className="px-5 pb-4">
                {paymentBreakdownSections.length === 0 ? (
                  <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
                    <span className="text-charcoal">Total</span>
                    <span className="font-semibold text-charcoal tabular-nums">
                      {formatINR(reg.pricingBreakup.total)}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {paymentBreakdownSections.map((section) => (
                      <div key={section.title}>
                        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">
                          {section.title}
                        </p>
                        {section.rows.map((row) => (
                          <div
                            key={`${row.label}-${row.value}`}
                            className="flex items-baseline justify-between gap-3 text-sm py-0.5"
                          >
                            <span className={row.muted ? "text-muted" : "text-charcoal"}>
                              {row.label}
                            </span>
                            <span
                              className={`tabular-nums whitespace-nowrap ${row.muted ? "text-muted" : "text-charcoal"}`}
                            >
                              {row.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-3">
                      <span className="font-semibold text-charcoal">Total</span>
                      <span className="font-semibold text-charcoal tabular-nums whitespace-nowrap">
                        {formatINR(reg.pricingBreakup.total)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Payment History */}
            <Card padding={false}>
              <CardHeader
                title="Payments"
                action={
                  totalOwed > 0 ? (
                    <span className={`text-sm font-semibold tabular-nums ${collected >= totalOwed ? "text-success" : "text-warning"}`}>
                      ₹{collected.toLocaleString("en-IN")}
                      {collected < totalOwed && (
                        <span className="text-muted font-normal"> / ₹{totalOwed.toLocaleString("en-IN")}</span>
                      )}
                    </span>
                  ) : undefined
                }
              />
              <div className="px-5 pb-4">
                {data.payments.length === 0 ? (
                  <p className="text-sm text-muted py-2">No payment records.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50">
                          <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">Date</th>
                          <th className="text-right text-xs text-muted uppercase tracking-wider py-2 pr-3">Amount</th>
                          <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">Status</th>
                          <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">Reference</th>
                          <th className="text-left text-xs text-muted uppercase tracking-wider py-2">Proof</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {[...data.payments]
                          .sort((a, b) => b.createdAt - a.createdAt)
                          .map((payment) => (
                            <tr key={payment.id}>
                              <td className="py-2 pr-3 text-charcoal whitespace-nowrap">
                                {formatDate(payment.createdAt)}
                              </td>
                              <td className="py-2 pr-3 text-charcoal text-right whitespace-nowrap">
                                ₹{payment.amount.toLocaleString("en-IN")}
                              </td>
                              <td className="py-2 pr-3">
                                <Badge variant={paymentStatusVariant(payment.status)}>
                                  {paymentStatusLabel(payment.status)}
                                </Badge>
                              </td>
                              <td className="py-2 pr-3 text-charcoal font-mono text-xs">
                                {payment.gatewayRef ?? "—"}
                              </td>
                              <td className="py-2">
                                {payment.proofFileKey ? (
                                  <ProofViewLink fileKey={payment.proofFileKey} />
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>

            {/* Refunds */}
            {refunds.length > 0 && (
              <Card padding={false}>
                <CardHeader
                  title="Refunds"
                  action={
                    <Link to="/staff/refunds" className="text-xs text-[#2A7A80] hover:underline font-medium">
                      Manage →
                    </Link>
                  }
                />
                <div className="px-5 pb-4 space-y-3">
                  {refunds.map((r) => (
                    <div key={r.id} className="flex items-start justify-between gap-3 py-2 border-b border-border/30 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-charcoal tabular-nums">
                          {formatINR(r.amount)}
                        </p>
                        <p className="text-xs text-muted mt-0.5">
                          {formatDate(r.createdAt)}
                          {r.bankReference && (
                            <span> · Ref: <span className="font-mono">{r.bankReference}</span></span>
                          )}
                        </p>
                      </div>
                      <Badge variant={r.status === "completed" ? "success" : "warning"}>
                        {r.status === "completed" ? "Completed" : "Pending"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── Tab: Activity ── */}
        {activeTab === "activity" && (
          <div className="space-y-4 max-w-2xl">
            {/* Documents */}
            <Card padding={false}>
              <CardHeader title="Documents" />
              <div className="px-5 pb-4">
                {data.documents.length === 0 && reg.status !== "confirmed" && (
                  <p className="text-sm text-muted py-2">No documents uploaded.</p>
                )}
                <div className="space-y-2">
                  {data.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-b-0">
                      <DocumentViewLink r2Key={doc.r2Key} fileName={doc.fileName} mimeType={doc.mimeType} />
                      <span className="text-xs text-muted ml-3 whitespace-nowrap">
                        {formatBytes(doc.sizeBytes)}
                      </span>
                    </div>
                  ))}
                  {reg.status === "confirmed" && (
                    <div className="flex items-center py-1.5 border-b border-border/30 last:border-b-0">
                      <a
                        href={`/api/registrations/${reg.regCode}/pass.pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-[#2A7A80] hover:underline font-medium"
                      >
                        <FileTypeIcon mimeType="application/pdf" />
                        Entry Pass
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* Audit Trail */}
            <Card padding={false}>
              <CardHeader title="Audit Trail" />
              <div className="px-5 pb-4">
                {data.audit.length === 0 ? (
                  <p className="text-sm text-muted py-2">No audit entries.</p>
                ) : (
                  <ol className="space-y-3">
                    {[...data.audit]
                      .sort((a, b) => a.createdAt - b.createdAt)
                      .map((entry, i) => {
                        const amountDetail = formatAuditAmount(entry);
                        return (
                          <li key={i} className="flex gap-3">
                            <div className="flex-shrink-0 mt-1">
                              <div className="w-2 h-2 rounded-full bg-terracotta/60 mt-0.5" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm text-charcoal font-medium">
                                {entry.action}
                                {amountDetail && (
                                  <span className="font-normal text-muted"> — {amountDetail}</span>
                                )}
                              </p>
                              <p className="text-xs text-muted mt-0.5">
                                {entry.actor} · {formatDateTime(entry.createdAt)}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                  </ol>
                )}
              </div>
            </Card>
          </div>
        )}
      </>}
    </div>
  );
}

// ── ProofViewLink (inline — needs toast, avoids prop-drilling) ─────────────

function ProofViewLink({ fileKey }: { fileKey: string }) {
  const handleView = async () => {
    try {
      const { url } = await fetchFile(fileKey);
      window.open(url, "_blank");
    } catch {
      // silent
    }
  };

  return (
    <button
      type="button"
      onClick={handleView}
      className="text-sm text-[#2A7A80] hover:underline font-medium"
    >
      View
    </button>
  );
}

// ── Utility ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
