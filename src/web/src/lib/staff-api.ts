import type { RegistrationResponse } from "@smriti/shared";
import { publicClient, staffClient, toQueryString } from "./http";
import type {
  DashboardStats,
  DashboardParams,
  StaffRegistrationListResponse,
  StaffRegistrationDetailResponse,
  VerifyResponse,
  RejectResponse,
  MagicLinkResponse,
  AuthVerifyResponse,
  UploadProofResponse,
  StaffUser,
  UsersListResponse,
  CreateUserRequest,
  UpdateUserRequest,
  ResendInviteResponse,
  GenerateLoginLinkResponse,
  ListParams,
  ExportParams,
  ResourceCounts,
  ResourcesParams,
  ReportsResponse,
  EditRegistrationRequest,
  EditRegistrationResponse,
  ArchiveResponse,
  ArchivedListResponse,
  ArchivedRegistration,
  RefundListResponse,
  BalancePaymentResponse,
  CompleteRefundResponse,
  CancelRegistrationResponse,
  ImportBankStatementResponse,
  BankTransactionListResponse,
  BankTransactionParams,
  BankTransactionSummary,
  MyPermissionsResponse,
  AllocationListResponse,
  PreferencesResponse,
  ConvertAccommodationResponse,
  AllocationPaymentLinkResponse,
  AddTshirtRequest,
  AddTshirtResponse,
  UpdateTshirtRequest,
  UpdateTshirtResponse,
  RemoveTshirtResponse,
  AddChargeRequest,
  AddChargeResponse,
  RemoveChargeResponse,
  CreateDonorRequest,
  CreateDonorResponse,
  DeskSearchResponse,
  DeskLookupResponse,
  DeskCheckInResponse,
  DeskSpotRegistrationResponse,
  DeskSpotRegistrationRequest,
  DeskCollectPaymentRequest,
  DeskCollectPaymentResponse,
  DeskAddChargeRequest,
  DeskAddChargeResponse,
  DeskStatsResponse,
  AdminConfigResponse,
  FeatureFlagChangeRequest,
} from "./staff-types";

// ---------------------------------------------------------------------------
// Public auth endpoints — no auth required
// ---------------------------------------------------------------------------

export function requestMagicLink(email: string, returnTo?: string): Promise<MagicLinkResponse> {
  return publicClient<MagicLinkResponse>("/api/auth/magic-link", {
    method: "POST",
    json: { email, ...(returnTo ? { returnTo } : {}) },
  });
}

export function verifyMagicLink(token: string): Promise<AuthVerifyResponse> {
  return publicClient<AuthVerifyResponse>(
    `/api/auth/verify?token=${encodeURIComponent(token)}`,
  );
}

// ---------------------------------------------------------------------------
// Staff endpoints — require staff/admin JWT
// ---------------------------------------------------------------------------

export function fetchDashboardStats(
  params?: DashboardParams,
): Promise<{ stats: DashboardStats }> {
  return staffClient<{ stats: DashboardStats }>(
    `/api/staff/dashboard${toQueryString(params)}`,
  );
}

export function fetchResources(
  params?: ResourcesParams,
): Promise<{ resources: ResourceCounts }> {
  return staffClient<{ resources: ResourceCounts }>(
    `/api/staff/resources${toQueryString(params)}`,
  );
}

export function fetchReports(): Promise<ReportsResponse> {
  return staffClient<ReportsResponse>("/api/staff/reports");
}

export function fetchRegistrations(
  params: ListParams,
): Promise<StaffRegistrationListResponse> {
  return staffClient<StaffRegistrationListResponse>(
    `/api/staff/registrations${toQueryString(params)}`,
  );
}

export function fetchRegistrationDetail(
  id: number,
): Promise<StaffRegistrationDetailResponse> {
  return staffClient<StaffRegistrationDetailResponse>(
    `/api/staff/registrations/${id}`,
  );
}

export function verifyPayment(
  paymentId: number,
  referenceId: string,
  actualAmount: number,
  opts?: { withShortfallPayment?: boolean },
): Promise<VerifyResponse> {
  const json: Record<string, unknown> = { referenceId, actualAmount };
  if (opts?.withShortfallPayment) json.withShortfallPayment = true;
  return staffClient<VerifyResponse>(
    `/api/staff/payments/${paymentId}/verify`,
    { method: "POST", json },
  );
}

export function rejectPayment(
  paymentId: number,
  comment: string,
): Promise<RejectResponse> {
  return staffClient<RejectResponse>(
    `/api/staff/payments/${paymentId}/reject`,
    { method: "POST", json: { comment } },
  );
}

export function uploadProofOnBehalf(
  regId: number,
  file: File,
): Promise<UploadProofResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return staffClient<UploadProofResponse>(
    `/api/staff/registrations/${regId}/upload-proof`,
    { method: "POST", body: formData },
  );
}

export function replacePhoto(
  regId: number,
  file: File,
): Promise<{ status: "ok"; message: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return staffClient<{ status: "ok"; message: string }>(
    `/api/staff/registrations/${regId}/photo`,
    { method: "POST", body: formData },
  );
}

export function sendPaymentLink(regId: number): Promise<{ ok: boolean; sentTo: string }> {
  return staffClient<{ ok: boolean; sentTo: string }>(`/api/staff/registrations/${regId}/send-payment-link`, {
    method: "POST",
  });
}

export function generatePaymentLink(regId: number): Promise<{ link: string }> {
  return staffClient<{ link: string }>(`/api/staff/registrations/${regId}/generate-payment-link`, {
    method: "POST",
  });
}

export function createDonor(data: CreateDonorRequest): Promise<CreateDonorResponse> {
  return staffClient<CreateDonorResponse>("/api/staff/registrations", {
    method: "POST",
    json: data,
  });
}

export function fetchMyRegistration(): Promise<RegistrationResponse> {
  return staffClient<RegistrationResponse>("/api/staff/my-registration");
}

export function fetchMyPermissions(): Promise<MyPermissionsResponse> {
  return staffClient<MyPermissionsResponse>("/api/staff/me/permissions");
}

export function createBalancePayment(
  regId: number,
  amount: number,
  sourcePaymentId: number,
): Promise<BalancePaymentResponse> {
  return staffClient<BalancePaymentResponse>(
    `/api/staff/registrations/${regId}/balance-payment`,
    { method: "POST", json: { amount, sourcePaymentId } },
  );
}

export function fetchRefunds(
  status?: string,
): Promise<RefundListResponse> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return staffClient<RefundListResponse>(`/api/staff/refunds${qs}`);
}

export function completeRefund(
  refundId: number,
  bankReference: string,
): Promise<CompleteRefundResponse> {
  return staffClient<CompleteRefundResponse>(
    `/api/staff/refunds/${refundId}/complete`,
    { method: "POST", json: { bankReference } },
  );
}

export async function fetchFile(
  key: string,
): Promise<{ url: string; contentType: string }> {
  const response = await staffClient<Response>(`/api/staff/files/${key}`, {
    raw: true,
  });
  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob), contentType };
}

export async function exportCsv(params: ExportParams): Promise<void> {
  const response = await staffClient<Response>(
    `/api/staff/export${toQueryString(params)}`,
    { raw: true },
  );
  const blob = await response.blob();

  const today = new Date().toISOString().slice(0, 10);
  const filename = `registrations-${today}.csv`;

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

// ---------------------------------------------------------------------------
// Admin endpoints — require admin JWT
// ---------------------------------------------------------------------------

export function createUser(data: CreateUserRequest): Promise<StaffUser> {
  return staffClient<StaffUser>("/api/admin/users", {
    method: "POST",
    json: data,
  });
}

export function fetchUsers(): Promise<UsersListResponse> {
  return staffClient<UsersListResponse>("/api/admin/users");
}

export function updateUser(
  id: number,
  data: UpdateUserRequest,
): Promise<StaffUser> {
  return staffClient<StaffUser>(`/api/admin/users/${id}`, {
    method: "PATCH",
    json: data,
  });
}

export function resendInvite(id: number): Promise<ResendInviteResponse> {
  return staffClient<ResendInviteResponse>(
    `/api/admin/users/${id}/resend-invite`,
    { method: "POST" },
  );
}

export function generateLoginLink(id: number): Promise<GenerateLoginLinkResponse> {
  return staffClient<GenerateLoginLinkResponse>(
    `/api/admin/users/${id}/generate-login-link`,
    { method: "POST" },
  );
}

export interface RegenerateThumbnailsResponse {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ id: number; regCode: string; error: string }>;
}

export function regenerateThumbnails(): Promise<RegenerateThumbnailsResponse> {
  return staffClient<RegenerateThumbnailsResponse>(
    "/api/staff/regenerate-thumbnails",
    { method: "POST" },
  );
}

export interface SyncPublicThumbsResponse {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ id: number; error: string }>;
}

export function syncPublicThumbnails(): Promise<SyncPublicThumbsResponse> {
  return staffClient<SyncPublicThumbsResponse>(
    "/api/staff/sync-public-thumbnails",
    { method: "POST" },
  );
}

export interface ReconcileStatusesResponse {
  total: number;
  fixed: number;
  fixes: Array<{ id: number; regCode: string; from: string; to: string }>;
  dryRun: boolean;
}

export function reconcileStatuses(dryRun: boolean = true): Promise<ReconcileStatusesResponse> {
  return staffClient<ReconcileStatusesResponse>(
    "/api/staff/reconcile-statuses",
    { method: "POST", json: { dryRun } },
  );
}

// ---------------------------------------------------------------------------
// Edit & archive endpoints
// ---------------------------------------------------------------------------

export function editRegistration(
  id: number,
  data: EditRegistrationRequest,
): Promise<EditRegistrationResponse> {
  return staffClient<EditRegistrationResponse>(
    `/api/staff/registrations/${id}`,
    { method: "PUT", json: data },
  );
}

// ---------------------------------------------------------------------------
// T-shirt & additional charge sub-resources (R34-R40)
// ---------------------------------------------------------------------------

export function addTshirt(
  regId: number,
  data: AddTshirtRequest,
): Promise<AddTshirtResponse> {
  return staffClient<AddTshirtResponse>(
    `/api/staff/registrations/${regId}/tshirts`,
    { method: "POST", json: data },
  );
}

export function updateTshirt(
  regId: number,
  tshirtId: number,
  data: UpdateTshirtRequest,
): Promise<UpdateTshirtResponse> {
  return staffClient<UpdateTshirtResponse>(
    `/api/staff/registrations/${regId}/tshirts/${tshirtId}`,
    { method: "PUT", json: data },
  );
}

export function removeTshirt(
  regId: number,
  tshirtId: number,
): Promise<RemoveTshirtResponse> {
  return staffClient<RemoveTshirtResponse>(
    `/api/staff/registrations/${regId}/tshirts/${tshirtId}`,
    { method: "DELETE" },
  );
}

export function addCharge(
  regId: number,
  data: AddChargeRequest,
): Promise<AddChargeResponse> {
  return staffClient<AddChargeResponse>(
    `/api/staff/registrations/${regId}/charges`,
    { method: "POST", json: data },
  );
}

export function removeCharge(
  regId: number,
  chargeId: number,
): Promise<RemoveChargeResponse> {
  return staffClient<RemoveChargeResponse>(
    `/api/staff/registrations/${regId}/charges/${chargeId}`,
    { method: "DELETE" },
  );
}

export function archiveRegistration(id: number): Promise<ArchiveResponse> {
  return staffClient<ArchiveResponse>(
    `/api/staff/registrations/${id}/archive`,
    { method: "POST" },
  );
}

/**
 * Cancels a registration with verified payments: archives a full snapshot,
 * creates one pending cancellation refund per verified payment, deletes the
 * registration, and writes system-audit events — all server-side atomically.
 * Requires a non-empty reason (422 otherwise); 409 when a payment is
 * pending_verification or the registration was already archived/cancelled.
 */
export function cancelRegistration(
  id: number,
  reason: string,
): Promise<CancelRegistrationResponse> {
  return staffClient<CancelRegistrationResponse>(
    `/api/staff/registrations/${id}/cancel`,
    { method: "POST", json: { reason } },
  );
}

export function fetchArchivedRegistrations(params: {
  search?: string;
  page?: number;
  limit?: number;
}): Promise<ArchivedListResponse> {
  return staffClient<ArchivedListResponse>(
    `/api/staff/archived${toQueryString(params)}`,
  );
}

export function fetchArchivedDetail(id: number): Promise<ArchivedRegistration> {
  return staffClient<ArchivedRegistration>(`/api/staff/archived/${id}`);
}

// ---------------------------------------------------------------------------
// Bank transactions
// ---------------------------------------------------------------------------

export function importBankStatement(text: string): Promise<ImportBankStatementResponse> {
  return staffClient<ImportBankStatementResponse>(
    "/api/staff/bank-transactions/import",
    {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: text,
    },
  );
}

export function fetchBankTransactions(
  params?: BankTransactionParams,
): Promise<BankTransactionListResponse> {
  return staffClient<BankTransactionListResponse>(
    `/api/staff/bank-transactions${toQueryString(params)}`,
  );
}

export function fetchBankTransactionSummary(
  params?: { fromDate?: string; toDate?: string },
): Promise<BankTransactionSummary> {
  return staffClient<BankTransactionSummary>(
    `/api/staff/bank-transactions/summary${toQueryString(params)}`,
  );
}

export function updateBankTransactionComment(
  id: number,
  comment: string | null,
): Promise<{ ok: true }> {
  return staffClient<{ ok: true }>(
    `/api/staff/bank-transactions/${id}/comment`,
    { method: "POST", json: { comment } },
  );
}

export function fetchBankCredits(
  showAll?: boolean,
): Promise<BankTransactionListResponse> {
  const params = showAll
    ? "?type=credit&limit=500"
    : "?type=credit&reconciled=false&limit=500";
  return staffClient<BankTransactionListResponse>(
    `/api/staff/bank-transactions${params}`,
  );
}

export function linkBankTransaction(
  txnId: number,
  paymentIds: number[],
): Promise<{ ok: boolean; linked: number }> {
  return staffClient<{ ok: boolean; linked: number }>(
    `/api/staff/bank-transactions/${txnId}/link`,
    { method: "POST", json: { paymentIds } },
  );
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

export function fetchAllocationRegistrations(): Promise<AllocationListResponse> {
  return staffClient<AllocationListResponse>(
    "/api/staff/allocation/registrations",
  );
}

export function fetchPreferences(
  registrationId: number,
): Promise<PreferencesResponse> {
  return staffClient<PreferencesResponse>(
    `/api/staff/allocation/registrations/${registrationId}/preferences`,
  );
}

export function savePreferences(
  registrationId: number,
  preferences: { preferredRegistrationId: number; preferenceOrder: number }[],
  version: number | null,
): Promise<PreferencesResponse> {
  // version carries the optimistic-lock token (staff-api R29.8). Stale/mismatch → 409.
  return staffClient<PreferencesResponse>(
    `/api/staff/allocation/registrations/${registrationId}/preferences`,
    { method: "PUT", json: { preferences, version } },
  );
}

export function clearPreferences(
  registrationId: number,
  version: number | null,
): Promise<void> {
  // DELETE requires the version token in the body (staff-api R30.5). 204 on success.
  return staffClient<void>(
    `/api/staff/allocation/registrations/${registrationId}/preferences`,
    { method: "DELETE", json: { version }, raw: true },
  ).then(() => undefined);
}

export function convertAccommodation(
  registrationId: number,
  updatedAt: number,
): Promise<ConvertAccommodationResponse> {
  // One-way shared_triple -> shared_double conversion (staff-api R41). updatedAt
  // carries the registration concurrency token (R41.1/R41.4) — stale/mismatch → 409.
  return staffClient<ConvertAccommodationResponse>(
    `/api/staff/allocation/registrations/${registrationId}/accommodation`,
    { method: "PUT", json: { accommodationType: "shared_double", updatedAt } },
  );
}

export function generateAllocationPaymentLink(
  registrationId: number,
): Promise<AllocationPaymentLinkResponse> {
  // 24h magic link for a non-confirmed listed registration (staff-api R42). 409 if
  // the registration is already confirmed.
  return staffClient<AllocationPaymentLinkResponse>(
    `/api/staff/allocation/registrations/${registrationId}/payment-link`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Registration Desk endpoints — require staff/admin JWT + registration_desk
// scope (registration-desk-api.ispec.md R1). The desk page uses ONLY these
// endpoints plus the public photo upload; it never calls dashboard APIs.
// ---------------------------------------------------------------------------

export function deskSearch(query: string): Promise<DeskSearchResponse> {
  return staffClient<DeskSearchResponse>(
    `/api/staff/desk/search?q=${encodeURIComponent(query)}`,
  );
}

/** Live roster counts for the desk footer — overall total + present, broken
 *  down by participation type. Counts only; no registration data. */
export function deskStats(): Promise<DeskStatsResponse> {
  return staffClient<DeskStatsResponse>("/api/staff/desk/stats");
}

export function deskLookup(code: string): Promise<DeskLookupResponse> {
  return staffClient<DeskLookupResponse>(
    `/api/staff/desk/lookup?code=${encodeURIComponent(code)}`,
  );
}

/**
 * Fetches the attendee's private profile photo as a blob and returns a
 * revocable object URL. The endpoint requires the Authorization header, so it
 * must go through the authenticated client — a plain <img src> would send an
 * unauthenticated request and get 401 (registration-desk.spec.md R3.3).
 *
 * `size` is allowlisted server-side to 200 | 560 | 960. Omit it (or pass 200)
 * for the existing 200px thumbnail; 560/960 request the server-resized
 * square face-cropped variant (560 for mobile, 960 for desktop — the original
 * bytes and storage key never leave the server).
 */
export async function deskPhoto(
  registrationId: number,
  size?: 200 | 560 | 960,
): Promise<{ url: string; contentType: string }> {
  const query = size !== undefined ? `?size=${size}` : "";
  const response = await staffClient<Response>(
    `/api/staff/desk/registrations/${registrationId}/photo${query}`,
    { raw: true },
  );
  // FALLBACK-OK: same construct as fetchFile above — the desk photo endpoint
  // always sets Content-Type on 200 (registration-desk.routes.ts), and
  // octet-stream is only a fallback for a header absent in practice.
  const contentType =
    response.headers.get("content-type") ?? "application/octet-stream";
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob), contentType };
}

/** Idempotent check-in (ispec R4.1) — a repeat returns the original timestamp. */
export function deskMarkPresent(
  registrationId: number,
): Promise<DeskCheckInResponse> {
  return staffClient<DeskCheckInResponse>(
    `/api/staff/desk/registrations/${registrationId}/present`,
    { method: "POST" },
  );
}

/**
 * Reverses a check-in (ispec R4.5). Idempotent in both directions — a repeat
 * undo, or an undo on a never-checked-in registration, returns the same
 * `{ present: false, checkedInAt: null }` and writes no second audit row.
 * Same shape as deskMarkPresent so the UI updates identically.
 */
export function deskMarkAbsent(
  registrationId: number,
): Promise<DeskCheckInResponse> {
  return staffClient<DeskCheckInResponse>(
    `/api/staff/desk/registrations/${registrationId}/absent`,
    { method: "POST" },
  );
}

export function deskCreateSpotRegistration(
  data: DeskSpotRegistrationRequest,
  idempotencyKey: string,
): Promise<DeskSpotRegistrationResponse> {
  return staffClient<DeskSpotRegistrationResponse>(
    "/api/staff/desk/registrations",
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      json: data,
    },
  );
}

/**
 * Full settlement of the outstanding balance (desk-payment-collection plan,
 * req #1) — there is no partial-amount field by design. Returns the fresh
 * allowlisted overview (payment.state now 'confirmed').
 */
export function deskCollectPayment(
  registrationId: number,
  data: DeskCollectPaymentRequest,
): Promise<DeskCollectPaymentResponse> {
  return staffClient<DeskCollectPaymentResponse>(
    `/api/staff/desk/registrations/${registrationId}/payment`,
    { method: "POST", json: data },
  );
}

/**
 * Adds an ad-hoc charge (desk-payment-collection plan, req #2) — raises the
 * balance; collection happens as a separate step. Returns the fresh
 * allowlisted overview (payment.state now 'payment_pending'). 409 when the
 * registration's payment is `pending_verification` (the only reasoned 409
 * case for this endpoint per the plan's guard-test list).
 */
export function deskAddCharge(
  registrationId: number,
  data: DeskAddChargeRequest,
): Promise<DeskAddChargeResponse> {
  return staffClient<DeskAddChargeResponse>(
    `/api/staff/desk/registrations/${registrationId}/charge`,
    { method: "POST", json: data },
  );
}

// ---------------------------------------------------------------------------
// Admin feature-flag config (runtime-feature-flags.ispec.md)
// ---------------------------------------------------------------------------

export function fetchFeatureFlagConfig(): Promise<AdminConfigResponse> {
  return staffClient<AdminConfigResponse>("/api/admin/config/features");
}

export function updateFeatureFlagConfig(
  changes: FeatureFlagChangeRequest[],
): Promise<AdminConfigResponse> {
  return staffClient<AdminConfigResponse>("/api/admin/config/features", {
    method: "PUT",
    json: { changes },
  });
}
