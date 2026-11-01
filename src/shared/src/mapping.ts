import type { Registration, WizardDraft, NonNoneAccommodation } from "./types.ts";
import { PRICING_DEFAULTS } from "./constants.ts";
import { sanitizeRegistration } from "./sanitize.ts";

export function toRegistration(draft: WizardDraft): Registration {
  const donationAmount = parseFloat(draft.donationAmount || "0") || 0;
  const spouseName = draft.spouseName.trim();

  return sanitizeRegistration({
    contact: {
      fullName: draft.fullName,
      branch: draft.branch,
      gender: draft.gender,
      email: draft.email,
      whatsapp: draft.whatsapp,
      mobileAlternate: draft.mobileAlternate?.trim() || undefined,
      city: draft.city,
      country: draft.country,
    },
    attendance: {
      intent: draft.participationType === "donation_only" ? "donation_only" : "attending",
      participationType: draft.participationType,
      ...(draft.participationType !== "donation_only" && {
        alumniMeal: draft.alumniMeal,
        tshirtSize: draft.tshirtSize!,
      }),
    },
    attendees: {
      spouse: spouseName.length > 0
        ? { name: spouseName, meal: draft.spouseMeal }
        : undefined,
      children: [...draft.children],
      guests: [...draft.guests],
    },
    accommodation: draft.accommodation !== "none"
      ? (() => {
          const type = draft.accommodation as NonNoneAccommodation;
          const isShared = type === "shared_double" || type === "shared_triple";
          const hasOver12Child = draft.children.some(
            (c) => (c.age || 0) > (PRICING_DEFAULTS.accommodationChildBedAge ?? 12),
          );
          const totalOccupants = 1 +
            (draft.spouseName.trim().length > 0 ? 1 : 0) +
            draft.children.filter((c) => (c.age || 0) >= PRICING_DEFAULTS.childFreeAgeThreshold).length +
            draft.guests.length;
          const extraBed = isShared ? false : (draft.extraBed || hasOver12Child || totalOccupants > 2);
          return {
            type,
            checkIn: draft.checkIn,
            checkOut: draft.checkOut,
            extraBed,
          };
        })()
      : undefined,
    donation: donationAmount > 0
      ? {
          amount: donationAmount,
          publicAcknowledgement: draft.publicAcknowledgement,
          acknowledgementDisplayName:
            draft.acknowledgementDisplayName.trim() || undefined,
          felicitationConsent: draft.felicitationConsent,
        }
      : undefined,
    idDocument: draft.idFileKey
      ? {
          fileKey: draft.idFileKey,
          fileType: draft.idFileType ?? "",
          sizeBytes: draft.idFileSizeBytes ?? 0,
          fileName: draft.idFileName,
          note: draft.idNote,
        }
      : undefined,
    contributionSplits:
      draft.collegeContribution > 0 && draft.collegeContributionCause !== ""
        ? { [draft.collegeContributionCause]: draft.collegeContribution }
        : undefined,
    photo: draft.photoFileKey
      ? {
          fileKey: draft.photoFileKey,
          fileType: draft.photoFileType ?? "",
          sizeBytes: draft.photoFileSizeBytes ?? 0,
          fileName: draft.photoFileName,
        }
      : undefined,
  });
}
