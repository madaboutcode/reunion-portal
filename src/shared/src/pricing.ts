import type {
  PricingBreakup,
  PricingConfig,
  PricingExtras,
  PricingLineItem,
  ParticipationType,
  Registration,
  PricingRegistration,
  WizardDraft,
} from "./types.ts";
import {
  PRICING_DEFAULTS,
  ACCOMMODATION_LABELS,
  COLLEGE_CONTRIBUTION_COPY,
  CONTRIBUTION_CAUSE_LABELS,
  generateId,
} from "./constants.ts";
import type { ContributionCause } from "./types.ts";

/** One line item per cause; label falls back to the raw key for unknown/legacy causes. */
function contributionLines(
  splits: PricingRegistration["contributionSplits"],
): { lines: PricingBreakup["lines"]; total: number } {
  const lines: PricingBreakup["lines"] = [];
  let total = 0;
  for (const [cause, amount] of Object.entries(splits ?? {})) {
    if (!amount || amount <= 0) continue;
    const causeLabel = CONTRIBUTION_CAUSE_LABELS[cause as ContributionCause] ?? cause;
    lines.push({
      label: `${COLLEGE_CONTRIBUTION_COPY.sectionTitle} — ${causeLabel}`,
      fee: amount,
      free: false,
      category: "event",
    });
    total += amount;
  }
  return { lines, total };
}

function resolveAdditionalPersonFees(
  participationType: ParticipationType,
  config: PricingConfig,
): {
  spouseFee: number;
  childFee6to12: number;
  childFee12plus: number;
  guestFee: number;
  foodLabelSuffix: string;
} {
  const isCampusOnly = participationType === "campus_only";
  if (isCampusOnly) {
    return {
      spouseFee: config.campusOnlySpouseFee ?? 550,
      childFee6to12: config.campusOnlyChildFee6to12 ?? 275,
      childFee12plus: config.campusOnlyChildFee12plus ?? 550,
      guestFee: config.campusOnlyGuestFee ?? 550,
      foodLabelSuffix: "Lunch",
    };
  }
  return {
    spouseFee: config.spouseFee ?? config.additionalPersonFee,
    childFee6to12: config.childFee6to12 ?? Math.round((config.spouseFee ?? config.additionalPersonFee) / 2),
    childFee12plus: config.childFee12plus ?? config.spouseFee ?? config.additionalPersonFee,
    guestFee: config.guestFee ?? config.additionalPersonFee,
    foodLabelSuffix: "Lunch & Dinner",
  };
}

function countNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 1;
  const msPerDay = 86400000;
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  const nights = Math.round(diff / msPerDay);
  return nights > 0 ? nights : 1;
}

export function calculateTotal(
  data: PricingRegistration,
  config: PricingConfig = PRICING_DEFAULTS,
  extras?: PricingExtras,
): PricingBreakup {
  if (data.attendance.intent === "donation_only") {
    const donation = data.donation?.amount ?? 0;
    const contributions = contributionLines(data.contributionSplits);
    return {
      base: 0,
      collegeContribution: contributions.total,
      lines: contributions.lines,
      donation,
      total: donation + contributions.total,
    };
  }

  const lines: PricingBreakup["lines"] = [];
  const { participationType } = data.attendance;
  const baseFee = participationType === "campus_only"
    ? (config.campusOnlyBaseFee ?? config.alumniBaseFee)
    : config.alumniBaseFee;
  const { spouseFee, childFee6to12, childFee12plus, guestFee, foodLabelSuffix } =
    resolveAdditionalPersonFees(participationType, config);
  let subtotal = baseFee;

  const contributions = contributionLines(data.contributionSplits);
  const collegeContribution = contributions.total;
  lines.push(...contributions.lines);
  subtotal += collegeContribution;

  if (data.attendees.spouse) {
    lines.push({
      label: `Spouse — ${data.attendees.spouse.name} · ${foodLabelSuffix}`,
      fee: spouseFee,
      free: false,
      category: "event",
    });
    subtotal += spouseFee;
  }

  const childBedAge = config.accommodationChildBedAge ?? 12;
  data.attendees.children.forEach((c) => {
    const age = c.age || 0;
    const free = age < config.childFreeAgeThreshold;
    const fee = free ? 0 : (age <= childBedAge ? childFee6to12 : childFee12plus);
    lines.push({
      label: `${c.name || "Child"}${age ? ` (${age} yrs)` : ""} · ${foodLabelSuffix}`,
      fee,
      free,
      category: "event",
    });
    subtotal += fee;
  });

  data.attendees.guests.forEach((g) => {
    lines.push({
      label: g.name
        ? `Guest — ${g.name} · ${foodLabelSuffix}`
        : `Additional Guest · ${foodLabelSuffix}`,
      fee: guestFee,
      free: false,
      category: "event",
    });
    subtotal += guestFee;
  });

  if (config.accommodationEnabled && data.accommodation && participationType !== "campus_only") {
    const { type, checkIn, checkOut, extraBed, breakfastAdult, breakfastChild } = data.accommodation;
    const nights = countNights(checkIn, checkOut);
    const nightLabel = `${nights} night${nights > 1 ? "s" : ""}`;
    const childFreeAgeThreshold = config.childFreeAgeThreshold;
    const accommodationChildBedAge = config.accommodationChildBedAge ?? 12;
    let accommodationSubtotal = 0;

    if (type === "private") {
      const roomFee = (config.accommodationPrivateFee ?? 0) * nights;
      if (roomFee > 0) {
        lines.push({
          label: `Accommodation — ${ACCOMMODATION_LABELS[type]} · ${nightLabel}`,
          fee: roomFee,
          free: false,
          category: "accommodation",
        });
      }
      accommodationSubtotal += roomFee;

      // Child charges
      data.attendees.children.forEach((c) => {
        const age = c.age || 0;
        if (age < childFreeAgeThreshold) {
          lines.push({
            label: `${c.name || "Child"} (${age} yrs) — accommodation`,
            fee: 0,
            free: true,
            category: "accommodation",
          });
        } else if (age <= accommodationChildBedAge) {
          // 6–12: child charge
          const childFee = (config.accommodationChild6to12Fee ?? 0) * nights;
          if (childFee > 0) {
            lines.push({
              label: `${c.name || "Child"} (${age} yrs) — accommodation`,
              fee: childFee,
              free: false,
              category: "accommodation",
            });
          }
          accommodationSubtotal += childFee;
        }
        // >12: covered by extra bed — no separate line
      });

      // Extra bed (manual or auto-from->12-child): max one, do NOT multiply by count
      if (extraBed) {
        const bedFee = (config.accommodationExtraBedFee ?? 0) * nights;
        if (bedFee > 0) {
          lines.push({
            label: `Extra bed · ${nightLabel}`,
            fee: bedFee,
            free: false,
            category: "accommodation",
          });
        }
        accommodationSubtotal += bedFee;
      }
    } else if (type === "shared_double") {
      const sharedFee = (config.accommodationSharedDoubleFee ?? 0) * nights;
      if (sharedFee > 0) {
        lines.push({
          label: `Accommodation — ${ACCOMMODATION_LABELS[type]} · ${nightLabel}`,
          fee: sharedFee,
          free: false,
          category: "accommodation",
        });
      }
      accommodationSubtotal += sharedFee;
    } else if (type === "shared_triple") {
      const sharedFee = (config.accommodationSharedTripleFee ?? 0) * nights;
      if (sharedFee > 0) {
        lines.push({
          label: `Accommodation — ${ACCOMMODATION_LABELS[type]} · ${nightLabel}`,
          fee: sharedFee,
          free: false,
          category: "accommodation",
        });
      }
      accommodationSubtotal += sharedFee;
    }

    if (breakfastAdult && breakfastAdult > 0) {
      const breakfastAdultFee = (config.breakfastAdultFee ?? 0) * breakfastAdult;
      if (breakfastAdultFee > 0) {
        lines.push({
          label: `Additional Breakfast (12+) × ${breakfastAdult}`,
          fee: breakfastAdultFee,
          free: false,
          category: "accommodation",
        });
      }
      accommodationSubtotal += breakfastAdultFee;
    }

    if (breakfastChild && breakfastChild > 0) {
      const breakfastChildFee = (config.breakfastChildFee ?? 0) * breakfastChild;
      if (breakfastChildFee > 0) {
        lines.push({
          label: `Additional Breakfast (6-12) × ${breakfastChild}`,
          fee: breakfastChildFee,
          free: false,
          category: "accommodation",
        });
      }
      accommodationSubtotal += breakfastChildFee;
    }

    // GST line on accommodation subtotal
    const taxPercent = config.accommodationTaxPercent ?? 18;
    const gst = Math.round(accommodationSubtotal * (taxPercent / 100));
    if (gst > 0) {
      lines.push({
        label: `GST (${taxPercent}%) — accommodation`,
        fee: gst,
        free: false,
        category: "accommodation",
      });
    }

    subtotal += accommodationSubtotal + gst;
  }

  // T-shirt extras — derived from rows, never stored
  const tshirtExtraCount = extras?.tshirts?.filter(t => !t.isIncluded).length ?? 0;
  if (tshirtExtraCount > 0) {
    const tshirtRate = config.tshirtExtraRate ?? 500;
    const tshirtFee = tshirtExtraCount * tshirtRate;
    lines.push({
      label: `Extra T-Shirts (${tshirtExtraCount})`,
      fee: tshirtFee,
      free: false,
      category: "event",
    });
    subtotal += tshirtFee;
  }

  // Additional charges — exact amounts, no GST markup (R18)
  if (extras?.additionalCharges) {
    for (const charge of extras.additionalCharges) {
      lines.push({
        label: charge.description,
        fee: charge.amount,
        free: false,
        category: "event",
      });
      subtotal += charge.amount;
    }
  }

  if (config.platformFeeEnabled) {
    const flat = config.platformFeeFlat ?? 0;
    const percent = config.platformFeePercent ?? 0;
    const platformFee = flat + subtotal * percent;
    if (platformFee > 0) {
      lines.push({
        label: "Platform fee",
        fee: platformFee,
        free: false,
        category: "event",
      });
      subtotal += platformFee;
    }
  }

  const donation = data.donation?.amount ?? 0;

  return {
    base: baseFee,
    collegeContribution,
    lines,
    donation,
    total: subtotal + donation,
  };
}

/**
 * Label pattern for accommodation-related lines, used as a fallback for
 * registrations submitted before `PricingLineItem.category` existed (their
 * `pricing_snapshot` is frozen JSON without the field). Matches the exact
 * label shapes `calculateTotal()` produces: "Accommodation — X · N nights",
 * "{child} (age yrs) — accommodation", "Extra bed · N nights",
 * "GST (N%) — accommodation".
 */
const ACCOMMODATION_LABEL_PATTERN = /^Accommodation —|— accommodation$|^Extra bed\b/i;

/** True if a pricing line belongs to the accommodation budget bucket (tagged, or legacy label match). */
export function isAccommodationLine(line: PricingLineItem): boolean {
  if (line.category) return line.category === "accommodation";
  return ACCOMMODATION_LABEL_PATTERN.test(line.label);
}

/**
 * Splits a registration's total into accommodation vs. everything else ("event").
 * Exact by construction — `accommodation + event === totalAmount` always, since
 * `event` is derived by subtraction rather than summed from "event" lines (the
 * base fee isn't itself a line item, so summing would under-count).
 */
export function splitPricingBreakup(
  breakup: PricingBreakup,
  totalAmount: number,
): { accommodation: number; event: number } {
  const accommodation = breakup.lines
    .filter(isAccommodationLine)
    .reduce((sum, line) => sum + line.fee, 0);
  return { accommodation, event: totalAmount - accommodation };
}

export function getAttendeeCounts(data: Registration): {
  veg: number;
  nonveg: number;
  total: number;
} {
  let veg = 0;
  let nonveg = 0;

  if (data.attendance.intent !== "donation_only") {
    if (data.attendance.alumniMeal === "veg") veg++;
    else if (data.attendance.alumniMeal === "non_veg") nonveg++;

    if (data.attendees.spouse) {
      if (data.attendees.spouse.meal === "veg") veg++;
      else if (data.attendees.spouse.meal === "non_veg") nonveg++;
    }

    data.attendees.children.forEach((c) => {
      if (c.meal === "veg") veg++;
      else if (c.meal === "non_veg") nonveg++;
    });

    data.attendees.guests.forEach((g) => {
      if (g.meal === "veg") veg++;
      else if (g.meal === "non_veg") nonveg++;
    });
  }

  return { veg, nonveg, total: veg + nonveg };
}

export function createInitialData(): WizardDraft {
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
    collegeContribution: 0,
    collegeContributionCause: "",
    photoFileName: "",
  };
}

export { generateId };
