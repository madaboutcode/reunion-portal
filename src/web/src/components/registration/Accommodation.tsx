import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useStepValidation } from "@/hooks/useStepValidation";
import { accommodationSchema } from "@/lib/validation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { WizardStepLayout } from "@/components/registration/WizardStepLayout";
import { getAccommodationAvailability } from "@/lib/api";
import {
  ACCOMMODATION_VENUE,
  CHECKIN_OPTIONS,
  CHECKOUT_OPTIONS,
  PRICING_DEFAULTS,
  ACCOMMODATION_LABELS,
  ACCOMMODATION_COPY,
  getAccommodationCatalog,
  formatINR,
} from "@/lib/constants";
import type { WizardDraft } from "@/types/registration";
import type { AccommodationAvailabilityResponse } from "@smriti/shared";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AccommodationProps {
  data: WizardDraft;
  update: (changes: Partial<WizardDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

// ── Accommodation helpers ───────────────────────────────────────────────────

const ACCOMM_ICONS: Record<string, string> = {
  none: "🏠",
  private: "🚪",
  shared_double: "🛏️",
  shared_triple: "🛏️",
};

function formatCheckinLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function isTypeAvailableOnDate(
  availability: AccommodationAvailabilityResponse | null,
  date: string,
  type: string,
): boolean {
  if (!availability) return true;
  const dateAvail = availability.availability[date];
  if (!dateAvail) return true;
  const typeKey = type as keyof typeof dateAvail.types;
  return dateAvail.types[typeKey]?.available ?? true;
}

function getRemainingOnDate(
  availability: AccommodationAvailabilityResponse | null,
  date: string,
  type: string,
): number | null {
  if (!availability) return null;
  const dateAvail = availability.availability[date];
  if (!dateAvail) return null;
  const typeKey = type as keyof typeof dateAvail.types;
  return dateAvail.types[typeKey]?.remaining ?? null;
}

// ── Step 3 ─────────────────────────────────────────────────────────────────

export function Accommodation({ data, update, onNext, onBack }: AccommodationProps) {
  const isMobile = useIsMobile();
  const { validate } = useStepValidation(accommodationSchema);
  const hasMultipleAttendees =
    !!data.spouseName?.trim() ||
    (data.children || []).length > 0 ||
    (data.guests || []).length > 0;

  const catalog = getAccommodationCatalog(PRICING_DEFAULTS);
  // Shared Room (3 persons) is no longer offered to alumni via the public wizard —
  // staff can still assign it from the registration detail page.
  const offeredCatalog = catalog.filter((entry) => entry.value !== "shared_triple");
  const childBedAge = PRICING_DEFAULTS.accommodationChildBedAge ?? 12;
  const hasOver12 = (data.children || []).some((c) => (c.age || 0) > childBedAge);

  const [availability, setAvailability] = useState<AccommodationAvailabilityResponse | null>(null);

  useEffect(() => {
    getAccommodationAvailability()
      .then(setAvailability)
      .catch(() => {}); // graceful degradation — backend validates on submit
  }, []);

  const gatingActive = availability?.inventoryConfigured ?? false;
  const activeCheckIn = data.checkIn || "2026-08-15";

  const isTypeAvailable = (type: string): boolean =>
    !gatingActive || isTypeAvailableOnDate(availability, activeCheckIn, type);

  const getRemaining = (type: string): number | null =>
    gatingActive ? getRemainingOnDate(availability, activeCheckIn, type) : null;

  const allRoomsSoldOut =
    gatingActive &&
    offeredCatalog.every((entry) =>
      CHECKIN_OPTIONS.every((iso) => !isTypeAvailableOnDate(availability, iso, entry.value)),
    );

  const selectionUnavailable =
    gatingActive &&
    data.accommodation !== "none" &&
    !!data.checkIn &&
    !isTypeAvailableOnDate(availability, data.checkIn, data.accommodation);

  useEffect(() => {
    if (
      hasMultipleAttendees &&
      (data.accommodation === "shared_double" || data.accommodation === "shared_triple")
    ) {
      update({ accommodation: "none", checkIn: "", checkOut: "", extraBed: false });
    } else if (data.accommodation === "private" && hasOver12 && !data.extraBed) {
      update({ extraBed: true });
    } else if (data.accommodation !== "private" && data.extraBed) {
      update({ extraBed: false });
    }
  }, [hasMultipleAttendees, data.accommodation, data.extraBed, hasOver12, update]);

  const handleContinue = () => {
    if (selectionUnavailable) return;
    if (validate(data)) onNext();
  };

  // ── Form body (shared by mobile & desktop) ──────────────────────────────

  const formContent = (
    <div className="animate-step-in">
      {/* ── Title ── */}
      <div className="flex items-center gap-2">
        <h2 className="font-heading font-bold text-charcoal text-[22px] sm:text-[26px] m-0">
          My Stay
        </h2>
        <span className="text-xl" aria-hidden="true">🌴</span>
      </div>
      <p className="font-accent text-base text-terracotta italic mb-5">
        Help us plan your stay and make this reunion even more memorable.
      </p>

      {/* ── Accommodation ── */}
      <Card className="mb-4">
          <CardHeader
            icon={<span className="text-lg" aria-hidden="true">🏨</span>}
            title="Accommodation"
            accent="var(--color-soft-aqua)"
          />
          <div className="p-5">
            <p className="text-sm text-subtle mb-1 leading-[1.5]">
              {ACCOMMODATION_VENUE}
            </p>
            <p className="text-[13px] text-subtle mb-3 leading-[1.5]">
              {ACCOMMODATION_COPY.allocationExplainer}
            </p>

            {allRoomsSoldOut && (
              <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 mb-4 leading-[1.5]">
                Rooms are fully booked. You can continue without accommodation.
              </p>
            )}

            {hasMultipleAttendees && (
              <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 mb-4 leading-[1.5]">
                {ACCOMMODATION_COPY.sharedUnavailableNote}
              </p>
            )}

            {/* Room type cards */}
            <div
              className={[
                "grid gap-[10px] mb-4",
                isMobile ? "grid-cols-1" : "grid-cols-2",
              ].join(" ")}
            >
              {/* "none" card */}
              {(() => {
                const active = data.accommodation === "none";
                return (
                  <button
                    key="none"
                    type="button"
                    data-testid="accom-none"
                    onClick={() =>
                      update({ accommodation: "none", checkIn: "", checkOut: "", extraBed: false })
                    }
                    className={[
                      "p-4 px-3.5",
                      "border-2 rounded-[14px]",
                      "text-left",
                      "transition-all duration-150",
                      "flex items-center gap-3",
                      active
                        ? "border-soft-aqua bg-soft-aqua-light cursor-pointer"
                        : "border-border bg-[#fafafa] cursor-pointer",
                    ].join(" ")}
                  >
                    <span className="text-xl leading-none shrink-0" aria-hidden="true">
                      {ACCOMM_ICONS["none"]}
                    </span>
                    <div>
                      <div
                        className={[
                          "text-[13px] font-bold mb-[3px]",
                          active ? "text-[#2a7a80]" : "text-charcoal",
                        ].join(" ")}
                      >
                        {ACCOMMODATION_LABELS["none"]}
                      </div>
                      <div className="text-sm text-subtle leading-[1.4]">
                        {ACCOMMODATION_COPY.noneDescription}
                      </div>
                    </div>
                  </button>
                );
              })()}

              {/* Catalog cards */}
              {catalog.map((entry) => {
                const isShared = entry.basis === "head";
                const isRetired = entry.value === "shared_triple";
                const isSoldOut = isRetired || (gatingActive && !isTypeAvailable(entry.value));
                const isDisabled = (hasMultipleAttendees && isShared) || isSoldOut;
                const remaining = isRetired ? null : getRemaining(entry.value);
                const active = data.accommodation === entry.value && !isDisabled;
                return (
                  <button
                    key={entry.value}
                    type="button"
                    data-testid={`accom-${entry.value}`}
                    disabled={isDisabled}
                    onClick={() => {
                      if (isShared) {
                        update({
                          accommodation: entry.value,
                          extraBed: false,
                          checkIn: data.checkIn || "2026-08-15",
                          checkOut: data.checkOut || CHECKOUT_OPTIONS[0],
                        });
                      } else {
                        // private
                        update({
                          accommodation: "private",
                          checkIn: data.checkIn || "2026-08-15",
                          checkOut: data.checkOut || CHECKOUT_OPTIONS[0],
                          extraBed: hasOver12 ? true : data.extraBed,
                        });
                      }
                    }}
                    className={[
                      "relative p-4 px-3.5",
                      "border-2 rounded-[14px]",
                      "text-left",
                      "transition-all duration-150",
                      "flex items-center gap-3",
                      isDisabled
                        ? "border-border bg-[#f3f4f6] opacity-50 cursor-not-allowed"
                        : active
                        ? "border-soft-aqua bg-soft-aqua-light cursor-pointer"
                        : "border-border bg-[#fafafa] cursor-pointer",
                    ].join(" ")}
                  >
                    {isSoldOut && (
                      <span className="absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wide text-white bg-terracotta rounded-full px-2 py-0.5">
                        Sold Out
                      </span>
                    )}
                    <span className="text-xl leading-none shrink-0" aria-hidden="true">
                      {ACCOMM_ICONS[entry.value]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div
                        className={[
                          "text-[13px] font-bold mb-[3px]",
                          active ? "text-[#2a7a80]" : "text-charcoal",
                        ].join(" ")}
                      >
                        {entry.label}
                      </div>
                      <div className="text-sm text-subtle leading-[1.4]">
                        {entry.description}
                      </div>
                      <div className="text-[12px] text-terracotta font-semibold mt-1">
                        {formatINR(entry.perNight)}
                        {entry.basis === "head" ? " / head · per night" : " / night"}
                      </div>
                      {!isSoldOut && remaining !== null && (
                        <div className="text-[12px] text-subtle mt-0.5">
                          {remaining} available
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Shared match note */}
            {(data.accommodation === "shared_double" || data.accommodation === "shared_triple") && (
              <p className="text-[13px] text-[#374151] bg-blue-50 border border-blue-200 rounded-xl px-3.5 py-2.5 mb-4 leading-[1.5]">
                {ACCOMMODATION_COPY.sharedMatchNote}
              </p>
            )}

            {/* Private: extra bed toggle + tax disclaimer */}
            {data.accommodation === "private" && (
              <div className="mb-4 space-y-3">
                <div>
                  <Switch
                    checked={data.extraBed}
                    onChange={(checked) => update({ extraBed: checked })}
                    disabled={hasOver12}
                    label={`${ACCOMMODATION_COPY.extraBedToggleLabel} (+${formatINR(PRICING_DEFAULTS.accommodationExtraBedFee ?? 0)}/night + tax)`}
                  />
                  {hasOver12 && (
                    <p className="text-[12px] text-subtle mt-1 leading-[1.5]">
                      {ACCOMMODATION_COPY.extraBedAutoNote}
                    </p>
                  )}
                </div>
                <p className="text-[12px] text-subtle leading-[1.5]">
                  {ACCOMMODATION_COPY.taxDisclaimer}
                </p>
              </div>
            )}

            {/* Date pickers — shown when accommodation is selected */}
            {data.accommodation !== "none" && (
              <div className="border-t border-[#f4f4f4] pt-5 space-y-4">
                {/* Check-in */}
                <div>
                  <p className="text-sm font-semibold text-charcoal mb-3">Check-in</p>
                  <div className="flex gap-2">
                    {CHECKIN_OPTIONS.map((iso) => {
                      const active = data.checkIn === iso;
                      const dateSoldOut =
                        gatingActive &&
                        data.accommodation !== "none" &&
                        !isTypeAvailableOnDate(availability, iso, data.accommodation);
                      return (
                        <button
                          key={iso}
                          type="button"
                          data-testid={`checkin-${iso}`}
                          disabled={dateSoldOut}
                          onClick={() => update({ checkIn: iso })}
                          className={[
                            "px-5 py-2.5",
                            "border-2 rounded-xl",
                            "text-sm font-semibold font-body",
                            "transition-all duration-150",
                            dateSoldOut
                              ? "border-border bg-[#f3f4f6] text-subtle opacity-50 cursor-not-allowed"
                              : active
                              ? "border-soft-aqua bg-soft-aqua-light text-[#2a7a80] cursor-pointer"
                              : "border-border bg-white text-muted cursor-pointer",
                          ].join(" ")}
                        >
                          {formatCheckinLabel(iso)}
                          {dateSoldOut ? " (sold out)" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Check-out */}
                <div>
                  <p className="text-sm font-semibold text-charcoal mb-3">Check-out</p>
                  {CHECKOUT_OPTIONS.length === 1 ? (
                    <p className="text-sm text-[#2a7a80] font-medium">
                      {formatCheckinLabel(CHECKOUT_OPTIONS[0])}
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      {CHECKOUT_OPTIONS.map((iso) => {
                        const active = data.checkOut === iso;
                        return (
                          <button
                            key={iso}
                            type="button"
                            onClick={() => update({ checkOut: iso })}
                            className={[
                              "px-5 py-2.5",
                              "border-2 rounded-xl",
                              "text-sm font-semibold font-body",
                              "cursor-pointer",
                              "transition-all duration-150",
                              active
                                ? "border-soft-aqua bg-soft-aqua-light text-[#2a7a80]"
                                : "border-border bg-white text-muted",
                            ].join(" ")}
                          >
                            {formatCheckinLabel(iso)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Breakfast note from catalog */}
                {(() => {
                  const breakfastFor = catalog.find(
                    (e) => e.value === data.accommodation,
                  )?.breakfastFor;
                  if (!breakfastFor) return null;
                  return (
                    <p className="text-[12px] text-subtle leading-[1.5] pt-1">
                      ☕ Breakfast for {breakfastFor} included
                    </p>
                  );
                })()}
              </div>
            )}

            {selectionUnavailable && (
              <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 mt-4 leading-[1.5]">
                This room type is not available for the selected check-in date. Please choose a
                different option.
              </p>
            )}
          </div>
        </Card>

    </div>
  );

  return (
    <WizardStepLayout
      data={data}
      onBack={onBack}
      onNext={handleContinue}
      nextDisabled={selectionUnavailable}
    >
      {formContent}
    </WizardStepLayout>
  );
}
