import { useState } from "react";
import type { WizardDraft } from "@/types/registration";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useStepValidation } from "@/hooks/useStepValidation";
import { attendeesMealsSchema } from "@/lib/validation";
import { generateId } from "@/lib/constants";
import { MealToggle } from "@/components/form/MealToggle";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader } from "@/components/ui/Card";
import { Note } from "@/components/ui/Note";
import { Switch } from "@/components/ui/Switch";
import type { TshirtSize } from "@/types/registration";
import { AttendeeRow } from "@/components/form/AttendeeRow";
import { Button } from "@/components/ui/Button";
import { WizardStepLayout } from "@/components/registration/WizardStepLayout";
import { HeartDoodle } from "@/components/ui/Doodles";
import { PolaroidFrame } from "@/components/polaroids/PolaroidFrame";
import { getTshirtOptions } from "@/lib/tshirt-options";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AttendeesMealsProps {
  data: WizardDraft;
  update: (changes: Partial<WizardDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

// ── Add-row button ─────────────────────────────────────────────────────────

function AddRowButton({ label, onClick, ...rest }: { label: string; onClick: () => void; [key: string]: unknown }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className={[
        "w-full h-[42px]",
        "border-[1.5px] border-dashed border-soft-aqua",
        "rounded-[10px] bg-white",
        "text-[#2A7A80] text-[13px] font-semibold font-body",
        "flex items-center justify-center gap-1.5",
        "cursor-pointer",
        "hover:bg-soft-aqua-light active:bg-[#D4EAEC]",
        "transition-colors duration-150",
      ].join(" ")}
    >
      <span className="text-base leading-none">+</span> {label}
    </button>
  );
}

// ── Section add button (compact, in header) ────────────────────────────────

function SectionAddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-3 py-[5px]",
        "border-[1.5px] border-terracotta rounded-lg",
        "bg-white",
                "text-terracotta text-sm font-bold font-body",
        "cursor-pointer",
        "hover:bg-terracotta-light active:bg-[#FDE2D8]",
        "transition-colors duration-150",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

// ── Step 2 ─────────────────────────────────────────────────────────────────

export function AttendeesMeals({ data, update, onNext, onBack }: AttendeesMealsProps) {
  const isMobile = useIsMobile();
  const { errors, validate, clearError } = useStepValidation(attendeesMealsSchema);
  // hasSpouse lives in local component state, not the draft, because:
  // 1. The toggle is a pure UI concern — "show spouse fields" vs "hide spouse fields"
  // 2. Keeping it out of the draft prevents the dual-source-of-truth bugs where
  //    hasSpouse=true could exist alongside an empty spouseName
  // 3. The real signal is spouseName presence — toRegistration derives spouse
  //    from spouseName.trim().length > 0, not from any flag
  const [hasSpouse, setHasSpouse] = useState<boolean>(
    () => data.spouseName.trim().length > 0,
  );

  const handleContinue = () => {
    if (validate(data)) onNext();
  };

  // ── Child operations ──────────────────────────────────────────────────────

  const addChild = () =>
    update({
      children: [
        ...data.children,
        { id: generateId(), name: "", age: Number.NaN, meal: "veg" },
      ],
    });

  const removeChild = (id: string) =>
    update({ children: data.children.filter((c) => c.id !== id) });

  const updateChild = (id: string, field: string, value: unknown) =>
    update({
      children: data.children.map((c) =>
        c.id === id ? { ...c, [field]: value } : c,
      ),
    });

  // ── Guest operations ──────────────────────────────────────────────────────

  const addGuest = () =>
    update({
      guests: [
        ...data.guests,
        { id: generateId(), name: "", relationship: "", meal: "veg" },
      ],
    });

  const removeGuest = (id: string) =>
    update({ guests: data.guests.filter((g) => g.id !== id) });

  const updateGuest = (id: string, field: string, value: unknown) =>
    update({
      guests: data.guests.map((g) =>
        g.id === id ? { ...g, [field]: value } : g,
      ),
    });

  // ── Donation-only simplified view ─────────────────────────────────────────

  if (data.participationType === "donation_only") {
    return (
      <div className="max-w-[600px] mx-auto py-10 px-5 animate-step-in">
        <div className="bg-white rounded-[20px] p-10 text-center border border-border shadow-[0_4px_24px_rgba(31,42,51,0.07)]">
          <div className="mb-4 flex justify-center" aria-hidden="true">
            <HeartDoodle size={56} color="#D76B51" />
          </div>
          <h2 className="font-heading text-[22px] text-charcoal mb-2.5 font-bold">
            Thank you for contributing
          </h2>
          <p className="text-base text-muted leading-relaxed mb-7 max-w-[420px] mx-auto">
            As a donation-only registration, you don&rsquo;t need to add
            attendees or meal preferences. Head to the next step to add your
            contribution details.
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="secondary" onClick={onBack}>← Back</Button>
            <Button variant="primary" onClick={handleContinue}>Continue →</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form content ──────────────────────────────────────────────────────────

  const formContent = (
    <div className="animate-step-in">
      {/* ── Title ── */}
      <div className="flex items-center gap-2">
        <h2 className="font-heading font-bold text-charcoal text-[22px] sm:text-[26px] m-0">
          Who&rsquo;s coming along?
        </h2>
        <span className="text-xl" aria-hidden="true">🎉</span>
      </div>
      <p className="font-accent text-base text-terracotta italic mb-3">
        Add your fellow travelers and what&rsquo;s on the plate.
      </p>

      {/* ── 1. Alumni Attendee ── */}
      <Card>
        <CardHeader
          icon={<span className="text-lg" aria-hidden="true">🎓</span>}
          title={data.fullName || "You (Primary)"}
          accent="var(--color-success)"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap p-5 pb-3">
          <div>
            <span className="text-sm text-muted">
              {data.fullName ? `${data.fullName}'s meal preference` : "Your meal preference"}
            </span>
          </div>
          <div className="w-[180px] flex-shrink-0">
            <MealToggle
              value={data.alumniMeal}
              onChange={(v) => update({ alumniMeal: v })}
            />
          </div>
        </div>
        <div className="mx-5 mb-4 rounded-2xl border-[1.5px] border-amber-300 bg-amber-50 p-4">
          <div className="flex gap-3">
            <span className="text-lg leading-none text-amber-500 mt-0.5" aria-hidden="true">⚠</span>
            <div>
              <p className="font-heading text-[16px] sm:text-[17px] font-bold text-amber-950 leading-snug mb-1">
                Heads up — t-shirt order already placed
              </p>
              <p className="text-[13px] sm:text-sm text-amber-800 leading-[1.55]">
                Your custom reunion t-shirt is included in your registration, and the
                order&rsquo;s already with the vendor. Pick your preferred size below
                and we&rsquo;ll try our best to match it — but we can&rsquo;t guarantee
                the exact size will be available on the day.
              </p>
              <div className="mt-2.5">
                <a
                  href={`/size-chart${data.gender ? `?g=${data.gender}` : ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-charcoal no-underline hover:border-terracotta hover:text-terracotta transition"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                  View size chart
                </a>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap px-5 pb-5">
          <label htmlFor="tshirt-size" className="text-sm text-muted">
            T-Shirt Size
          </label>
          <div className="w-[180px] flex-shrink-0">
            <Select
              id="tshirt-size"
              data-testid="tshirt-size"
              value={data.tshirtSize ?? ""}
              onChange={(e) => update({ tshirtSize: e.target.value as TshirtSize })}
              options={getTshirtOptions(data.gender)}
              placeholder="Select size"
              required
            />
          </div>
        </div>
      </Card>

      {/* ── Family note ── */}
      <Note variant="info" className="mt-5">
        This reunion is mainly for reconnecting with batchmates and reliving old memories, so no separate family activities are planned. However, families are welcome to join.
      </Note>

      {/* ── 2. Spouse / Partner ── */}
      <Card className="mt-4">
        <CardHeader
          icon={<span className="text-lg" aria-hidden="true">💑</span>}
          title="Spouse / Partner"
          accent="var(--color-soft-aqua)"
        />
        <div className="p-5">
          <Switch
            checked={hasSpouse}
            data-testid="spouse-switch"
            onChange={(v) => {
              setHasSpouse(v);
              if (v) {
                // Toggled ON — show fields and focus the name input.
                // Use rAF to wait for React to render the input before focusing.
                requestAnimationFrame(() => {
                  document.getElementById("spouse-name-input")?.focus();
                });
              } else {
                // Toggled OFF — clear spouse data in the draft
                update({ spouseName: "", spouseMeal: "veg" });
              }
            }}
            label={
              hasSpouse
                ? "Bringing spouse / partner"
                : "Add spouse or partner?"
            }
          />
          {hasSpouse && (
            <div className="mt-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3 items-center">
                <Input
                  id="spouse-name-input"
                  value={data.spouseName}
                  onChange={(e) => { update({ spouseName: e.target.value }); clearError("spouseName"); }}
                  placeholder="Partner's name"
                  error={!!errors.spouseName}
                />
                <MealToggle
                  value={data.spouseMeal}
                  onChange={(v) => update({ spouseMeal: v })}
                />
              </div>
              {errors.spouseName && (
                <p className="text-sm text-terracotta mt-1">⚠ {errors.spouseName}</p>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* ── 3. Children ── */}
      <Card className="mt-4">
        <CardHeader
          icon={<span className="text-lg" aria-hidden="true">👧</span>}
          title="Children"
          accent="var(--color-warning)"
        />
        <div className="p-5">
          {data.children.length === 0 ? (
            <p className="text-[13px] text-subtle text-center py-2.5 italic">
              No children added yet
            </p>
          ) : (
            <div className="mb-1">
              {/* Desktop column headers */}
              {!isMobile && (
                <div className="flex gap-2.5 mb-2">
                  <span className="w-14" />
                  <span className="flex-1 text-[13px] font-semibold text-subtle uppercase tracking-[0.3px]">
                    Name (optional)
                  </span>
                  <span className="w-20 text-[13px] font-semibold text-subtle uppercase tracking-[0.3px]">
                    Age
                  </span>
                  <span className="w-[164px] text-[13px] font-semibold text-subtle uppercase tracking-[0.3px]">
                    Meal
                  </span>
                  <span className="w-9" />
                </div>
              )}

              {data.children.map((child) => (
                <AttendeeRow
                  key={child.id}
                  label="Child"
                  isMobile={isMobile}
                  onRemove={() => removeChild(child.id)}
                >
                  <Input
                    value={child.name}
                    onChange={(e) => updateChild(child.id, "name", e.target.value)}
                    placeholder="Name (optional)"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={child.age || ""}
                    onChange={(e) =>
                      updateChild(
                        child.id,
                        "age",
                        Number.isNaN(Number.parseInt(e.target.value, 10))
                          ? Number.NaN
                          : Number.parseInt(e.target.value, 10),
                      )
                    }
                    placeholder="Age"
                    className="w-20 flex-shrink-0"
                  />
                  <div className="w-[164px] flex-shrink-0">
                    <MealToggle
                      value={child.meal}
                      onChange={(v) => updateChild(child.id, "meal", v)}
                    />
                  </div>
                </AttendeeRow>
              ))}
            </div>
          )}

          <AddRowButton
            label={data.children.length === 0 ? "Add child" : "Add another"}
            onClick={addChild}
            data-testid="add-child"
          />

          <Note className="mt-3">
            ℹ Children under 6 attend free &middot; above 6 are chargeable
          </Note>
        </div>
      </Card>

      {/* ── 4. Additional Guests ── */}
      <Card className="mt-4">
        <CardHeader
          icon={<span className="text-lg" aria-hidden="true">🤝</span>}
          title="Additional Guests"
          accent="var(--color-soft-aqua)"
          action={<SectionAddBtn label="+ Add" onClick={addGuest} />}
        />
        <div className="p-5">
          {data.guests.length === 0 ? (
            <p className="text-[13px] text-subtle text-center py-2.5 italic">
              No additional guests yet
            </p>
          ) : (
            <div className="mb-1">
              {/* Desktop column headers */}
              {!isMobile && (
                <div className="flex gap-2.5 mb-2">
                  <span className="w-14" />
                  <span className="flex-1 text-[13px] font-semibold text-subtle uppercase tracking-[0.3px]">
                    Name
                  </span>
                  <span className="w-[130px] text-[13px] font-semibold text-subtle uppercase tracking-[0.3px]">
                    Relationship
                  </span>
                  <span className="w-[164px] text-[13px] font-semibold text-subtle uppercase tracking-[0.3px]">
                    Meal
                  </span>
                  <span className="w-9" />
                </div>
              )}

              {data.guests.map((guest) => (
                <AttendeeRow
                  key={guest.id}
                  label="Guest"
                  isMobile={isMobile}
                  onRemove={() => removeGuest(guest.id)}
                >
                  <Input
                    value={guest.name}
                    onChange={(e) => updateGuest(guest.id, "name", e.target.value)}
                    placeholder="Guest name"
                    className="flex-1"
                  />
                  <Input
                    value={guest.relationship}
                    onChange={(e) =>
                      updateGuest(guest.id, "relationship", e.target.value)
                    }
                    placeholder="e.g. Brother"
                    className="w-[130px] flex-shrink-0"
                  />
                  <div className="w-[164px] flex-shrink-0">
                    <MealToggle
                      value={guest.meal}
                      onChange={(v) => updateGuest(guest.id, "meal", v)}
                    />
                  </div>
                </AttendeeRow>
              ))}
            </div>
          )}

          <AddRowButton
            label={data.guests.length === 0 ? "Add guest" : "Add another"}
            onClick={addGuest}
            data-testid="add-guest"
          />
        </div>
      </Card>

      {/* ── Decorative polaroid strip ── */}
      <div className="flex justify-center mb-4 relative pt-4">
        <PolaroidFrame
          slotId="step2-0"
          rotation={-4}
          width={isMobile ? 160 : 180}
        />
        {!isMobile && (
          <PolaroidFrame
            slotId="step2-1"
            rotation={5}
            width={160}
            className="-ml-5 mt-5"
          />
        )}
        <HeartDoodle
          size={16}
          className={`absolute -top-1 ${isMobile ? "right-[40px]" : "right-[120px]"}`}
        />
      </div>

    </div>
  );

  return (
    <WizardStepLayout data={data} onBack={onBack} onNext={handleContinue}>
      {formContent}
    </WizardStepLayout>
  );
}
