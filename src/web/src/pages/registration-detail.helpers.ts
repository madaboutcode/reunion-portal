import { PRICING_DEFAULTS } from "@/lib/constants";
import type { EditRegistrationRequest } from "@/lib/staff-types";
import type { MealPreference } from "@smriti/shared";

export interface EditableAttendee {
  _tempId: string;
  type: "spouse" | "child" | "guest";
  name: string;
  age: string;
  relationship: string;
  meal: MealPreference;
}

export function mapEditAttendees(
  attendees: EditableAttendee[],
): NonNullable<EditRegistrationRequest["attendees"]> {
  return attendees.map((attendee) => {
    const childAge = attendee.type === "child" && attendee.age !== ""
      ? Number(attendee.age)
      : null;

    return {
      type: attendee.type,
      name: attendee.name.trim() || null,
      age: childAge,
      relationship: attendee.relationship.trim() || null,
      meal: attendee.meal,
      isChargeable: attendee.type !== "child"
        || (childAge !== null && childAge >= PRICING_DEFAULTS.childFreeAgeThreshold),
    };
  });
}
