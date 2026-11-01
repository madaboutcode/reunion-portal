/**
 * CONTRACT: Registration-desk domain types and pure policy (see
 * docs/specs/interfaces/registration-desk-api.ispec.md and
 * docs/specs/registration-desk.spec.md).
 *
 * GUARANTEE: SEARCH_RANKING_DETERMINISTIC — rankDeskSearch orders candidates
 *   by: exact full-name match (rank 0), name prefix (rank 1), name substring
 *   (rank 2), registration-code match (rank 3), then case-insensitive
 *   full-name order as the final tie-breaker. The result is capped at 20 and
 *   every returned candidate must match the query on name or code; a
 *   candidate that matches neither is a caller bug and throws.
 *
 * GUARANTEE: PAYMENT_STATE_EXPLICIT — mapDeskPaymentState maps only the three
 *   documented registration statuses: 'pending' and 'pending_verification'
 *   become 'payment_pending'; 'confirmed' becomes 'confirmed'. Any other
 *   status throws DeskStateError — undefined payment state is a hard failure,
 *   never a guessed default (plan "Undefined states are hard failures").
 *
 * GUARANTEE: DESK_SAFE_OVERRESPONSE_GUARD — the response mapper types here
 *   carry only the documented allowlisted fields. No email, donation, payment
 *   history, proof, bank reference, ID document, pricing snapshot, storage
 *   key, or audit data appears in any desk response type. Two narrowly-scoped
 *   exceptions are permitted: the primary registrant's `whatsapp` number
 *   (registration-desk.spec.md R1.2/R3.6 — helpdesk contact channel; email
 *   remains forbidden) and `rooms` (R3.7 — distinct assigned room numbers,
 *   read-only display). T-shirt rows are display-only (size, gender,
 *   isIncluded) — never amount/price/charge fields from the separate
 *   additional_charges table.
 *
 * EXPECTS: rankDeskSearch receives candidates already filtered to eligible
 *   registrations (full_celebration / campus_only) by the repository query —
 *   donation-only rows never reach the ranker.
 *
 * FAILURE BEHAVIOR: mapDeskPaymentState throws DeskStateError for an unknown
 *   status. rankDeskSearch throws for a non-matching candidate (invariant
 *   violation, not a user error).
 *
 * KNOWN LIMITATIONS: ranking is computed in JS after a LIKE-based SQL fetch,
 *   not in SQL; the fetch is bounded by the query term, not by the result
 *   cap, so a very broad one-character query may scan many rows (acceptable
 *   at venue scale; see desk.repo.ts searchCandidates).
 */

import type { ParticipationType, MealPreference } from '@smriti/shared';
import type { RegistrationStatus } from './status.js';

// ---------------------------------------------------------------------------
// Payment state
// ---------------------------------------------------------------------------

/** Desk payment state — exactly two values (ispec R3.1). */
export type DeskPaymentState = 'payment_pending' | 'confirmed';

export class DeskStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeskStateError';
  }
}

/**
 * Maps a registration status to the desk payment state.
 *   pending / pending_verification -> payment_pending
 *   confirmed                      -> confirmed
 *   anything else                  -> throw (undefined state is a hard failure)
 */
export function mapDeskPaymentState(status: RegistrationStatus): DeskPaymentState {
  if (status === 'pending' || status === 'pending_verification') return 'payment_pending';
  if (status === 'confirmed') return 'confirmed';
  throw new DeskStateError(`Unknown registration status for desk payment state: ${status}`);
}

// ---------------------------------------------------------------------------
// Check-in state
// ---------------------------------------------------------------------------

export interface DeskCheckInState {
  present: boolean;
  checkedInAt: number | null;
}

export function toDeskCheckInState(checkedInAt: number | null): DeskCheckInState {
  return { present: checkedInAt !== null, checkedInAt };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Narrow row returned by the desk search repository query. */
export interface DeskSearchRow {
  id: number;
  full_name: string;
  reg_code: string;
  branch: string;
  participation_type: ParticipationType;
  checked_in_at: number | null;
  checked_in_by: number | null;
  photo_thumb_key: string | null;
  updated_at: number;
}

/**
 * Narrow row for the LED-wall photo pre-cache manifest
 * (desk.repo.listWallImageRows). Only the columns the manifest needs to build
 * a portrait/thumbnail URL — the raw `photo_thumb_key` is a private bucket key
 * and is reduced to public CDN URLs by the route, never returned as-is.
 */
export interface DeskWallImageRow {
  id: number;
  photo_thumb_key: string | null;
}

/**
 * One grouped counts row from desk.repo.countStats — a single participation
 * type with its total registrations and how many are present. Only the
 * eligible types (`full_celebration` / `campus_only`) are ever produced;
 * donation-only is excluded in SQL. A type with zero registrations does not
 * appear as a row — the mapper defaults it to zero.
 */
export interface DeskStatsRow {
  participation_type: 'full_celebration' | 'campus_only';
  total: number;
  checked_in: number;
}

/** Parsed search candidate consumed by rankDeskSearch. */
export interface DeskSearchCandidate {
  id: number;
  fullName: string;
  regCode: string;
  branch: string;
  participationType: ParticipationType;
  checkedInAt: number | null;
  checkedInBy: number | null;
  hasPhoto: boolean;
  updatedAt: number;
}

export function toDeskSearchCandidate(row: DeskSearchRow): DeskSearchCandidate {
  return {
    id: row.id,
    fullName: row.full_name,
    regCode: row.reg_code,
    branch: row.branch,
    participationType: row.participation_type,
    checkedInAt: row.checked_in_at,
    checkedInBy: row.checked_in_by,
    hasPhoto: row.photo_thumb_key !== null && row.photo_thumb_key !== '',
    updatedAt: row.updated_at,
  };
}

/**
 * Max updated_at across the returned search candidates (ispec R2 —
 * `photosVersion` mirrors the public Who's Coming contract). Returns 0 for
 * an empty result list — there is no meaningful version with no rows.
 */
export function toDeskPhotosVersion(candidates: Array<{ updatedAt: number }>): number {
  return candidates.reduce((max, c) => Math.max(max, c.updatedAt), 0);
}

export const DESK_SEARCH_LIMIT = 20;

/**
 * Orders eligible candidates by documented ranking (requirements R20 /
 * ispec R2.3) and caps the result at 20.
 */
export function rankDeskSearch(
  candidates: DeskSearchCandidate[],
  query: string,
): DeskSearchCandidate[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  const ranked = candidates.map((c) => {
    const name = c.fullName.toLowerCase();
    const code = c.regCode.replace(/-/g, '').toLowerCase();
    let rank: number;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (code.includes(q)) rank = 3;
    else {
      // The repository pre-filters on name/code LIKE; a candidate that
      // reaches the ranker without either match is a query/filter bug.
      throw new Error(
        `Desk search candidate ${c.id} does not match query "${query}" on name or reg code`,
      );
    }
    return { c, rank };
  });

  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.c.fullName.localeCompare(b.c.fullName, undefined, { sensitivity: 'base' });
  });

  return ranked.slice(0, DESK_SEARCH_LIMIT).map((x) => x.c);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** Narrow row returned by the desk overview query (see desk.repo.ts). */
export interface DeskOverviewRow {
  id: number;
  reg_code: string;
  full_name: string;
  branch: string;
  participation_type: ParticipationType;
  alumni_meal: string;
  accommodation: string;
  check_in: string | null;
  check_out: string | null;
  photo_thumb_key: string | null;
  checked_in_at: number | null;
  checked_in_by: number | null;
  status: RegistrationStatus;
  total_amount: number;
  /** Primary registrant's stored WhatsApp number, passed through unmodified (R1.2/R3.6). */
  whatsapp: string;
}

/**
 * Reduces a registration's room assignments across nights to the distinct
 * room numbers, sorted ascending by string sort (ispec R3.7). Pure — the
 * caller fetches assignments via room.repo.ts listAssignmentsByRegistration;
 * this only collapses the per-night rows to the overview's flat list.
 */
export function toDeskRoomNumbers(assignments: Array<{ roomNumber: string }>): string[] {
  return Array.from(new Set(assignments.map((a) => a.roomNumber))).sort();
}

export interface DeskOverviewAttendee {
  name: string | null;
  mealPreference: MealPreference;
  age?: number;
}

export interface DeskOverviewGroup {
  spouse: DeskOverviewAttendee[];
  children: Array<{ name: string | null; age: number | null; mealPreference: MealPreference }>;
  guests: DeskOverviewAttendee[];
}

// ---------------------------------------------------------------------------
// T-shirts (display only — see desk.repo.ts findTshirts)
// ---------------------------------------------------------------------------

/** Narrow row returned by the desk t-shirt query (see desk.repo.ts). */
export interface DeskTshirtRow {
  size: string;
  gender: string | null;
  is_included: number; // 0 | 1
}

/** Desk-safe t-shirt entry — size, gender, and included flag only. */
export interface DeskOverviewTshirt {
  size: string;
  gender: string | null;
  isIncluded: boolean;
}

export function toDeskOverviewTshirt(row: DeskTshirtRow): DeskOverviewTshirt {
  return {
    size: row.size,
    gender: row.gender,
    isIncluded: row.is_included !== 0,
  };
}

// ---------------------------------------------------------------------------
// Spot registration input (validated desk request shape, ispec R5)
// ---------------------------------------------------------------------------

export interface DeskSpotRegistrationInput {
  fullName: string;
  whatsapp: string;
  branch: string;
  participationType: 'full_celebration' | 'campus_only';
  alumniMeal: MealPreference;
  photoFileKey: string;
  email: string;
  donationAmount?: number;
  spouse?: { name: string; mealPreference: MealPreference };
  children: Array<{ name: string; age: number; mealPreference: MealPreference }>;
  guests: Array<{ name: string; mealPreference: MealPreference }>;
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

export interface DeskIdempotencyEntry {
  actorId: number;
  key: string;
  fingerprint: string;
  response: string;
}

export interface DeskIdempotencyRow {
  id: number;
  actor_id: number;
  idem_key: string;
  fingerprint: string;
  response: string;
  created_at: number;
}

/** Idempotency retention window — 30 days (settled decision, plan §Idempotency). */
export const DESK_IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
