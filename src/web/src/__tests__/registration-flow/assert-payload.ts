import { expect } from "vitest";
import {
  registrationSchema,
  calculateTotal,
  type SubmitRegistrationRequest,
  type ParticipationType,
  type AttendanceIntent,
} from "@smriti/shared";

/** submission-flow + submission-api: server-bound payload must parse and have positive total */
export function expectValidSubmitPayload(payload: SubmitRegistrationRequest) {
  const parsed = registrationSchema.safeParse(payload);
  expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.flatten())).toBe(
    true,
  );
  expect(calculateTotal(payload).total).toBeGreaterThan(0);
}

/** registration-page.spec.md — attendanceIntent derived from participationType */
export function expectAttendance(
  payload: SubmitRegistrationRequest,
  participationType: ParticipationType,
  intent: AttendanceIntent,
) {
  expect(payload.attendance.participationType).toBe(participationType);
  expect(payload.attendance.intent).toBe(intent);
}