/**
 * CONTRACT: api-types
 *
 * GUARANTEES:
 * - API_TYPES_IMPORTABLE: All types are exported from @smriti/shared and can
 *   be imported by both the web and server packages without type errors.
 * - SUBMIT_IS_CANONICAL: SubmitRegistrationRequest is the canonical Registration
 *   shape — no flags, presence semantics.
 * - RESPONSE_IS_CANONICAL: RegistrationResponseData extends canonical Registration
 *   with server-generated fields.
 *
 * EXPECTS:
 * - Registration is defined in ./types.ts.
 * - PricingBreakup is defined in ./types.ts.
 * - PricingConfig is defined in ./types.ts (re-exported from ./pricing.ts).
 */

import type { Gender, ParticipationType, PricingBreakup, PricingConfig, Registration, TshirtSize } from "./types.ts";

export type SubmitRegistrationRequest = Registration;

export interface SubmitRegistrationResponse {
  regId: string;
  regCode: string;
  token: string;
  status: "pending" | "pending_verification" | "confirmed";
  pricingBreakup: PricingBreakup;
  paymentUrl: string;
}

export interface ProofUploadResponse {
  status: "pending_verification";
  message: string;
}

export interface UploadResponse {
  fileKey: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface PricingConfigResponse {
  config: PricingConfig;
}

export interface RegistrationResponseData extends Omit<Registration, "contact" | "attendance"> {
  regId: string;
  regCode: string;
  status: "pending" | "pending_verification" | "confirmed";
  pricingBreakup: PricingBreakup;
  createdAt: number;
  contact: Omit<Registration["contact"], "gender"> & { gender: Gender | null };
  attendance: Omit<Registration["attendance"], "tshirtSize"> & { tshirtSize: TshirtSize | null };
  /** Amount of the current payment_pending record, or null if none. */
  pendingPaymentAmount: number | null;
  /** True when at least one verified payment exists for this registration. */
  hasVerifiedPayments: boolean;
  /** Numeric sum of all verified payments applied to this registration. */
  verifiedPaymentAmount: number;
}

export interface RegistrationResponse {
  registration: RegistrationResponseData;
}

export interface PublicRegistrationView {
  fullName: string;
  regCode: string;
  regId: string;
  status: "pending" | "pending_verification" | "confirmed";
  totalAmount: number;
  attendanceIntent: string;
  participationType: ParticipationType;
}

export interface PagedResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export function toPagedResponse<T>(data: T[], page: number, pageSize: number, totalItems: number): PagedResponse<T> {
  return {
    data,
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

// ---------------------------------------------------------------------------
// Room availability
// ---------------------------------------------------------------------------

export interface RoomTypeAvailability {
  available: boolean;
  remaining: number;
}

export interface NightAvailability {
  totalAvailable: number;
  types: {
    private: RoomTypeAvailability;
    shared_double: RoomTypeAvailability;
    shared_triple: RoomTypeAvailability;
  };
}

export interface AccommodationAvailabilityResponse {
  availability: Record<string, NightAvailability>;
  inventoryConfigured: boolean;
}

export interface RoomInventoryEntry {
  totalRooms: number;
  roomsConsumed: number;
}

export interface RoomInventoryResponse {
  inventory: Record<string, RoomInventoryEntry>;
  overCommitted: Record<string, boolean>;
}
