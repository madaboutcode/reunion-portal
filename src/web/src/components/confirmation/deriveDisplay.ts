// Pure utility: compute display values from canonical Registration.
// Separated from the component file to satisfy react-refresh/only-export-components.

import type { Registration, ParticipationType } from "@/types/registration";
import type { RegistrationResponseData } from "@smriti/shared";
import { getAttendeeCounts } from "@/lib/pricing";
import { ACCOMMODATION_LABELS, INTENT_LABELS, PARTICIPATION_LABELS, formatINR } from "@/lib/constants";

export interface DerivedDisplay {
  reg: string;
  name: string;
  email: string;
  tshirtLabel: string;
  attendanceLabel: string;
  ticketsLabel: string;
  foodLabel: { text: string; color: string };
  accomLabel: string;
  donationLabel: string;
  participationType: ParticipationType | undefined;
  participationLabel: string;
  counts: { veg: number; nonveg: number; total: number };
}

export function deriveDisplay(
  data: RegistrationResponseData,
  reg: string,
): DerivedDisplay {
  // getAttendeeCounts accesses intent/alumniMeal/attendees — none of which are
  // nullable in RegistrationResponseData. The only nullable overrides are
  // contact.gender and attendance.tshirtSize, which getAttendeeCounts never reads.
  const counts = getAttendeeCounts(data as unknown as Registration);
  const totalAttendees = counts.total || 1;
  const ticketsLabel =
    totalAttendees === 1
      ? "1 Adult"
      : `${totalAttendees} (You${totalAttendees > 1 ? ` + ${totalAttendees - 1} Guest${totalAttendees > 2 ? "s" : ""}` : ""})`;

  const foodLabel = (() => {
    if (counts.veg && !counts.nonveg)
      return { text: "Vegetarian", color: "#2d9b67" };
    if (!counts.veg && counts.nonveg)
      return { text: "Non-vegetarian", color: "#c4512f" };
    if (counts.veg && counts.nonveg)
      return {
        text: `${counts.veg} Veg, ${counts.nonveg} Non-veg`,
        color: "#1F2A33",
      };
    return { text: "Vegetarian", color: "#2d9b67" };
  })();

  const accomLabel = (() => {
    const type = data.accommodation?.type;
    if (!type) return "Not required";
    return ACCOMMODATION_LABELS[type] ?? "Not required";
  })();

  const genderLabel: Record<string, string> = { male: "Male", female: "Female" };
  const gender = data.contact?.gender ?? undefined;
  const g = (gender != null ? genderLabel[gender] : undefined) ?? "";
  const size = data.attendance?.tshirtSize ?? "";
  const tshirtLabel = g ? `${size} (${g})` : size;

  return {
    reg,
    name: data.contact?.fullName || "Attendee",
    email: data.contact?.email || "your registered email",
    tshirtLabel,
    attendanceLabel: INTENT_LABELS[data.attendance?.intent] ?? "Attending",
    ticketsLabel,
    foodLabel,
    accomLabel,
    donationLabel:
      data.donation?.amount && data.donation.amount > 0
        ? formatINR(data.donation.amount)
        : "None",
    participationType: data.attendance?.participationType,
    participationLabel: PARTICIPATION_LABELS[data.attendance?.participationType] ?? "Attending",
    counts,
  };
}
