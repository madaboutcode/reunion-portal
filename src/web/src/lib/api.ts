import type {
  SubmitRegistrationRequest,
  SubmitRegistrationResponse,
  RegistrationResponse,
  ProofUploadResponse,
  AccommodationAvailabilityResponse,
  PublicStoriesResponse,
  AuthorStateResponse,
  StoryMutationResponse,
} from "@smriti/shared";
import { publicClient, authClient, toQueryString } from "./http";

export function submitRegistration(
  data: SubmitRegistrationRequest,
): Promise<SubmitRegistrationResponse> {
  return publicClient<SubmitRegistrationResponse>("/api/registrations", {
    method: "POST",
    json: data,
  });
}

export function getAccommodationAvailability(): Promise<AccommodationAvailabilityResponse> {
  return publicClient<AccommodationAvailabilityResponse>("/api/accommodation/availability");
}

export function getMyRegistration(): Promise<RegistrationResponse> {
  return authClient<RegistrationResponse>("/api/registrations/me");
}

export function getRegistration(
  regId: string,
): Promise<RegistrationResponse> {
  return authClient<RegistrationResponse>(`/api/registrations/${regId}`);
}

export interface PassData {
  name: string;
  regCode: string;
  attendanceIntent: string;
  participationType: string;
  attendeeCount: number;
  accommodation: string;
}

export function lookupByCode(regCode: string): Promise<PassData> {
  return publicClient<PassData>("/api/registrations/lookup", {
    method: "POST",
    json: { regCode },
  });
}

export async function checkEmail(email: string): Promise<boolean> {
  const data = await publicClient<{ registered: boolean }>(
    `/api/registrations/check-email?email=${encodeURIComponent(email.trim().toLowerCase())}`,
  );
  return data.registered;
}

export function requestMagicLink(email: string): Promise<void> {
  return publicClient<void>("/api/auth/magic-link", {
    method: "POST",
    json: { email: email.trim().toLowerCase() },
  });
}

export function uploadPaymentProof(
  regCode: string,
  file: File,
  utr?: string,
): Promise<ProofUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (utr?.trim()) formData.append("utr", utr.trim());
  return authClient<ProofUploadResponse>(
    `/api/registrations/${regCode}/pay/upload-proof`,
    { method: "POST", body: formData },
  );
}

export function requestPaymentLink(
  regCode: string,
): Promise<{ ok: boolean; message: string }> {
  return publicClient<{ ok: boolean; message: string }>(
    "/api/auth/payment-link",
    { method: "POST", json: { regCode } },
  );
}

export interface PublicAttendee {
  id: number;
  fullName: string;
  branch: string;
  city: string;
  country: string;
  hasPhoto: boolean;
  createdAt: number;
}

export interface WhosComingResponse {
  people: PublicAttendee[];
  count: number;
  thumbsBaseUrl: string;
  photosVersion: number;
}

export function fetchWhosComingPublic(): Promise<WhosComingResponse> {
  return publicClient<WhosComingResponse>("/api/public/whos-coming");
}

export function publicPhotoUrl(
  id: number,
  thumbsBaseUrl: string,
  photosVersion: number,
): string {
  return `${thumbsBaseUrl}/${id}.jpg?v=${photosVersion}`;
}

export interface DeskRosterEntry {
  registrationId: number;
  name: string;
  branch: string;
  checkedInAt: number;
  portraitUrl: string | null;
  thumbnailUrl: string | null;
}

export interface DeskRosterFullResponse {
  now: number;
  seq: number;
  count: number;
  entries: DeskRosterEntry[];
}

export type DeskRosterEvent =
  | ({ type: "arrival" } & DeskRosterEntry & { seq: number })
  | { type: "departure"; seq: number; registrationId: number };

export interface DeskRosterDeltaResponse {
  now: number;
  seq: number;
  events: DeskRosterEvent[];
}

export function getDeskRoster(
  since?: number,
): Promise<DeskRosterFullResponse | DeskRosterDeltaResponse> {
  return publicClient<DeskRosterFullResponse | DeskRosterDeltaResponse>(
    `/api/public/desk-roster${toQueryString({ since })}`,
  );
}

export interface WallImage {
  id: number;
  portraitUrl: string | null;
  thumbnailUrl: string | null;
}

export interface WallImageManifest {
  count: number;
  images: WallImage[];
}

/**
 * Every eligible-with-photo attendee's wall image URLs, for pre-caching the
 * LED wall (`/led-wall/precache`). URLs are byte-identical to what the wall
 * requests via desk-roster — the pre-cache is keyed by exact URL.
 */
export function fetchWallImageManifest(): Promise<WallImageManifest> {
  return publicClient<WallImageManifest>("/api/public/wall-image-manifest");
}

export function fetchPublicStories(): Promise<PublicStoriesResponse> {
  return publicClient<PublicStoriesResponse>("/api/public/memory-stories");
}

export function fetchAuthorState(): Promise<AuthorStateResponse> {
  return authClient<AuthorStateResponse>("/api/memory-stories/mine");
}

export function createStory(text: string): Promise<StoryMutationResponse> {
  return authClient<StoryMutationResponse>("/api/memory-stories", {
    method: "POST",
    json: { text },
  });
}

export function updateStory(
  storyId: number,
  text: string,
): Promise<StoryMutationResponse> {
  return authClient<StoryMutationResponse>(`/api/memory-stories/mine/${storyId}`, {
    method: "PUT",
    json: { text },
  });
}

export function deleteStory(storyId: number): Promise<void> {
  return authClient<void>(`/api/memory-stories/mine/${storyId}`, {
    method: "DELETE",
  });
}
