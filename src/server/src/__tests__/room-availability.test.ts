/**
 * Room Availability — tests enforcing docs/specs/room-availability.spec.md
 *
 * WHAT THIS FILE GUARDS (by spec requirement):
 *
 *   R1.3 — no inventory configured -> everything open, no gating
 *   R2   — occupancy computed from private/shared_double/shared_triple room-equivalents
 *   R3   — per-night quotas, 14th check-in spans both nights, 15th spans one
 *   R4   — room-type availability from open partial slots + empty rooms
 *   R5   — GET /api/accommodation/availability response shape (HTTP boundary)
 *   R6   — POST /api/registrations submission gate (HTTP boundary, incl. exact
 *          409 error body — this is where a real spec violation was found)
 *   R7   — staff edit constraints: upgrades blocked at capacity, downgrades allowed
 *   R8   — GET/PUT /api/staff/room-inventory (HTTP boundary: auth, shape, R8.2 warning)
 *
 * BOUNDARIES:
 *   - AvailabilityService.getAvailability()/isAccommodationAvailable() is tested
 *     directly as a library boundary (its own public exported API, consumed by
 *     3 independent callers: the HTTP route, RegistrationService, EditService).
 *     Backed by fakes of its real collaborators (IAttendeeRepository,
 *     IInventoryRepository) — no internal method of the service is touched.
 *   - The three HTTP surfaces (GET /accommodation/availability, POST
 *     /registrations, GET+PUT /staff/room-inventory) are tested by mounting the
 *     real route modules on a Hono app with real error middleware, exactly as
 *     payment-partial-refund-routes.test.ts does for the payment routes. This is
 *     the actual boundary the frontend and staff dashboard call.
 *   - EditService.edit() is tested as a service boundary (its own public API) —
 *     R7 does not specify an HTTP response shape (unlike R6.3), so the exact
 *     JSON envelope is not a discriminating factor; the service call is the
 *     smallest boundary that observably proves accept/reject behavior.
 *   - D1InventoryRepository (the raw D1 SQL wrapper) is NOT tested here. No
 *     test file in this codebase exercises a D1*Repository implementation
 *     directly (confirmed: every existing route/service test fakes the
 *     I*Repository interface instead) — there is no real-SQL test harness to
 *     build on, and faking D1 upsert semantics well enough to be meaningful
 *     would mean re-implementing SQLite, which tests nothing about our code.
 *
 * GAPS FLAGGED (not resolved, not invented — see inline comments at point of use):
 *   - R5.3 says the unconfigured state has "no remaining counts" but
 *     RoomTypeAvailability.remaining is a non-nullable `number`. The spec never
 *     states the sentinel value. Tests assert `available: true` (the specified
 *     part) and do NOT assert a specific `remaining`/`totalAvailable` number in
 *     the unconfigured case.
 *   - R7.1/R7.2 enumerate accommodation *type* transitions as upgrade/downgrade.
 *     The implementation's upgrade check compares type rank only — an edit that
 *     changes ONLY the check-in date (same type, e.g. private on the 14th ->
 *     private on the 15th) never triggers the availability check at all, even
 *     if the new date is sold out. The spec's "same availability rules" language
 *     doesn't resolve whether this is intended. Not tested here; flagged as a gap.
 *   - R8.4 documents the PUT body shape but not validation rules (integer?
 *     non-negative? both dates required?). The implementation enforces
 *     non-negative integers with 422, but since the spec doesn't state this,
 *     validation-rejection tests are not written here (would be testing an
 *     invented requirement, not the spec).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { getPublicFailureValues } from "@smriti/shared";
import type {
  SubmitRegistrationRequest,
  PricingBreakup,
} from "@smriti/shared";

import { AvailabilityService } from "../services/availability.service.js";
import { RegistrationService } from "../services/registration.service.js";
import { EditService } from "../services/edit.service.js";
import { PricingService } from "../services/pricing.service.js";
import { accommodationRoutes } from "../routes/accommodation.routes.js";
import { registrationRoutes } from "../routes/registration.routes.js";
import { staffRoutes } from "../routes/staff.routes.js";
import { handleError } from "../middleware/error.middleware.js";
import { clearRateLimitStore } from "../middleware/rate-limit.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { createFakePermissionsDb } from "./helpers/fake-permissions-db.js";
import { signToken } from "../infra/jwt.js";
import type { AppEnv } from "../env.js";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  IDocumentRepository,
  IEmailService,
  IInventoryRepository,
  ISystemAuditRepository,
} from "../repositories/interfaces.js";
import type {
  Registration,
  NewRegistration,
  RegistrationUpdate,
  RegistrationFilters,
  Attendee,
  NewAttendee,
  Payment,
  NewPayment,
  AuditEntry,
  NewAuditEntry,
  IdDocument,
  NewIdDocument,
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";
import type { FeatureFlagSnapshot } from "../services/feature-flag.service.js";

const TEST_JWT_SECRET = "test-secret-key-for-integration-tests-32chars!";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as import("../env.js").Env;

function makeRegistrationFeatureFlagService(
  acceptNew: boolean,
): AppEnv["Variables"]["featureFlagService"] {
  const snapshot: FeatureFlagSnapshot = {
    isEnabled: (key) => key === "registration_accept_new" && acceptNew,
    publicValues: () => ({ ...getPublicFailureValues(), registration_accept_new: acceptNew }),
    adminValues: () => [],
  };

  return { resolve: async () => snapshot } as unknown as AppEnv["Variables"]["featureFlagService"];
}

// ===========================================================================
// Occupancy fake — the direct collaborators of AvailabilityService
// ===========================================================================

type NightOccupancy = {
  private: number;
  privateByGender: { male: number; female: number; other: number };
  shared_double: { count: number; rooms: number };
  shared_doubleByGender: { male: number; female: number; other: number };
  shared_triple: { count: number; rooms: number };
  shared_tripleByGender: { male: number; female: number; other: number };
  extraBeds: number;
};

function zeroOccupancy(): NightOccupancy {
  return {
    private: 0,
    privateByGender: { male: 0, female: 0, other: 0 },
    shared_double: { count: 0, rooms: 0 },
    shared_doubleByGender: { male: 0, female: 0, other: 0 },
    shared_triple: { count: 0, rooms: 0 },
    shared_tripleByGender: { male: 0, female: 0, other: 0 },
    extraBeds: 0,
  };
}

/** ceil(n/groupSize) rooms — mirrors R2.1's occupancy formula, used only to build fixtures. */
function sharedOf(count: number, groupSize: 2 | 3): { count: number; rooms: number } {
  return { count, rooms: Math.ceil(count / groupSize) };
}

/**
 * Fake IAttendeeRepository. `occupancy` is directly settable per test so
 * scenarios from the spec (partial rooms, cross-date pairing, sold out, ...)
 * can be constructed without driving hundreds of registrations through the
 * full submission pipeline. This is the real collaborator AvailabilityService
 * queries (`accommodationByNight()`), not a stand-in for AvailabilityService
 * itself.
 */
class FakeAttendeeRepo implements IAttendeeRepository {
  occupancy: Record<string, NightOccupancy> = {
    "2026-08-14": zeroOccupancy(),
    "2026-08-15": zeroOccupancy(),
  };

  private attendees: Map<number, Attendee[]> = new Map();
  private nextId = 1;

  async findByRegistration(registrationId: number): Promise<Attendee[]> {
    return this.attendees.get(registrationId) ?? [];
  }

  async replaceForRegistration(registrationId: number, newAttendees: NewAttendee[]): Promise<void> {
    const converted: Attendee[] = newAttendees.map((na) => ({
      id: this.nextId++,
      registrationId,
      type: na.type,
      name: na.name,
      age: na.age,
      relationship: na.relationship,
      meal: na.meal,
      isChargeable: na.is_chargeable !== 0,
      createdAt: Date.now(),
    }));
    this.attendees.set(registrationId, converted);
  }

  async countGrouped(): Promise<Array<{ type: string; meal: string; count: number }>> {
    return [];
  }

  async accommodationByNight(): Promise<Record<string, NightOccupancy>> {
    return this.occupancy;
  }

  async mealsByParticipationType() {
    return {
      campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 },
      ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 },
    };
  }

  async childrenByAgeBand() {
    return { under6: 0, age6to12: 0, age12plus: 0 };
  }
}

/** Fake IInventoryRepository — real Map-backed read/write semantics (rung 4: fake with real logic). */
class FakeInventoryRepo implements IInventoryRepository {
  private rows: Map<string, number> = new Map();

  async get(): Promise<Record<string, number>> {
    return Object.fromEntries(this.rows);
  }

  async set(inventory: Record<string, number>): Promise<void> {
    for (const [night, total] of Object.entries(inventory)) {
      this.rows.set(night, total);
    }
  }
}

// ===========================================================================
// SECTION A — AvailabilityService: occupancy & availability computation
// (R1.3, R2, R3, R4)
// ===========================================================================

describe("AvailabilityService — R1.3 no inventory configured", () => {
  it("A1: inventoryConfigured is false and all types available with no gating when no inventory rows exist", async () => {
    // Catches: generator that defaults to fully closed (0 rooms) instead of
    // fully open when inventory has never been set.
    const service = new AvailabilityService({
      attendeeRepo: new FakeAttendeeRepo(),
      inventoryRepo: new FakeInventoryRepo(),
    });

    const result = await service.getAvailability();

    expect(result.inventoryConfigured).toBe(false);
    for (const checkIn of ["2026-08-14", "2026-08-15"]) {
      const avail = result.availability[checkIn];
      expect(avail.types.private.available).toBe(true);
      expect(avail.types.shared_double.available).toBe(true);
      expect(avail.types.shared_triple.available).toBe(true);
      // GAP: spec says "no remaining counts" but the type is a non-nullable
      // number, and the spec never states the sentinel — not asserting an
      // exact remaining/totalAvailable value here.
    }
  });

  it("A2: isAccommodationAvailable() returns true for any real type when inventory not configured", async () => {
    const service = new AvailabilityService({
      attendeeRepo: new FakeAttendeeRepo(),
      inventoryRepo: new FakeInventoryRepo(),
    });

    expect(await service.isAccommodationAvailable("private", "2026-08-14")).toBe(true);
    expect(await service.isAccommodationAvailable("shared_double", "2026-08-15")).toBe(true);
  });
});

describe("AvailabilityService — R2/R4 occupancy and room-type availability", () => {
  let attendeeRepo: FakeAttendeeRepo;
  let inventoryRepo: FakeInventoryRepo;
  let service: AvailabilityService;

  beforeEach(() => {
    attendeeRepo = new FakeAttendeeRepo();
    inventoryRepo = new FakeInventoryRepo();
    service = new AvailabilityService({ attendeeRepo, inventoryRepo });
  });

  it("A3: empty rooms available -> all types available with correct remaining counts", async () => {
    // 5 rooms, nobody has checked in yet.
    await inventoryRepo.set({ "2026-08-14": 5, "2026-08-15": 5 });

    const result = await service.getAvailability();

    expect(result.inventoryConfigured).toBe(true);
    const d14 = result.availability["2026-08-14"];
    expect(d14.totalAvailable).toBe(5);
    expect(d14.types.private).toEqual({ available: true, remaining: 5 });
    // R5.2: sd remaining = open slots (0, room empty) + empty*2
    expect(d14.types.shared_double).toEqual({ available: true, remaining: 10 });
    expect(d14.types.shared_triple).toEqual({ available: true, remaining: 15 });
  });

  it("A4: private rooms fill up -> private unavailable, and shared types have no empty rooms or partial slots either", async () => {
    // 2 rooms total, both taken by private registrations on the 14th (spans both nights).
    await inventoryRepo.set({ "2026-08-14": 2, "2026-08-15": 2 });
    attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 2 },
      "2026-08-15": { ...zeroOccupancy(), private: 2 },
    };

    const avail = (await service.getAvailability()).availability["2026-08-14"];

    expect(avail.types.private.available).toBe(false);
    expect(avail.types.private.remaining).toBe(0);
    // Room type is fully committed to private (R2.2) — no partial slots for
    // shared types either, so shared is only "available" via empty rooms,
    // and there are none left.
    expect(avail.types.shared_double.available).toBe(false);
    expect(avail.types.shared_triple.available).toBe(false);
  });

  it("A5: shared_double partial room -> 1 open slot, another shared_double person fits", async () => {
    // 3 rooms, 1 shared_double person checked in on the 15th (1 room committed, 1 open slot).
    await inventoryRepo.set({ "2026-08-14": 0, "2026-08-15": 3 });
    attendeeRepo.occupancy = {
      "2026-08-14": zeroOccupancy(),
      "2026-08-15": { ...zeroOccupancy(), shared_double: sharedOf(1, 2) },
    };

    const avail = (await service.getAvailability()).availability["2026-08-15"];

    // 1 room consumed by the partial sd, 2 empty rooms remain.
    expect(avail.totalAvailable).toBe(2);
    expect(avail.types.shared_double.available).toBe(true);
    // remaining = open slot (1) + empty*2 (2*2=4) = 5
    expect(avail.types.shared_double.remaining).toBe(5);
  });

  it("A6: shared_triple partial room -> 2 open slots", async () => {
    await inventoryRepo.set({ "2026-08-14": 0, "2026-08-15": 3 });
    attendeeRepo.occupancy = {
      "2026-08-14": zeroOccupancy(),
      "2026-08-15": { ...zeroOccupancy(), shared_triple: sharedOf(1, 3) },
    };

    const avail = (await service.getAvailability()).availability["2026-08-15"];

    expect(avail.types.shared_triple.available).toBe(true);
    // open slots = ceil(1/3)*3 - 1 = 2; remaining = 2 + empty(2)*3 = 8
    expect(avail.types.shared_triple.remaining).toBe(8);
  });

  it("A7 (spec Edge Case): 1 room remaining, 1 person picks shared_double -> private unavailable, sd has exactly 1 slot, st unavailable", async () => {
    await inventoryRepo.set({ "2026-08-14": 0, "2026-08-15": 1 });
    attendeeRepo.occupancy = {
      "2026-08-14": zeroOccupancy(),
      "2026-08-15": { ...zeroOccupancy(), shared_double: sharedOf(1, 2) },
    };

    const avail = (await service.getAvailability()).availability["2026-08-15"];

    expect(avail.types.private.available).toBe(false);
    expect(avail.types.private.remaining).toBe(0);
    expect(avail.types.shared_double.available).toBe(true);
    expect(avail.types.shared_double.remaining).toBe(1);
    expect(avail.types.shared_triple.available).toBe(false);
    expect(avail.types.shared_triple.remaining).toBe(0);
  });

  it("A8: none is always available even when all room types are sold out", async () => {
    await inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 1 });
    attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 1 },
      "2026-08-15": { ...zeroOccupancy(), private: 1 },
    };

    // R4.4: none doesn't even consult inventory — verified independent of checkIn.
    expect(await service.isAccommodationAvailable("none", "2026-08-14")).toBe(true);
    expect(await service.isAccommodationAvailable("none", "2026-08-15")).toBe(true);
  });

  it("A9: all rooms sold out -> totalAvailable 0, private/shared_double/shared_triple all unavailable", async () => {
    await inventoryRepo.set({ "2026-08-14": 2, "2026-08-15": 2 });
    attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), shared_double: sharedOf(4, 2) }, // 2 full rooms
      "2026-08-15": { ...zeroOccupancy(), shared_double: sharedOf(4, 2) },
    };

    const avail = (await service.getAvailability()).availability["2026-08-14"];

    expect(avail.totalAvailable).toBe(0);
    expect(avail.types.private.available).toBe(false);
    expect(avail.types.shared_double.available).toBe(false);
    expect(avail.types.shared_triple.available).toBe(false);
  });

  it("A10 — edge case: rooms_14th=0 and rooms_15th=0 -> every real type disabled for both dates", async () => {
    await inventoryRepo.set({ "2026-08-14": 0, "2026-08-15": 0 });

    const result = await service.getAvailability();
    for (const checkIn of ["2026-08-14", "2026-08-15"]) {
      const avail = result.availability[checkIn];
      expect(avail.types.private.available).toBe(false);
      expect(avail.types.shared_double.available).toBe(false);
      expect(avail.types.shared_triple.available).toBe(false);
    }
    expect(await service.isAccommodationAvailable("none", "2026-08-14")).toBe(true);
  });

  it("A11 — over-committed: staff reduces inventory below occupancy -> remaining floors at 0, not negative", async () => {
    // Catches: generator computing emptyRooms as totalRooms - roomsConsumed
    // without the Math.max(0, ...) floor, producing a negative "remaining".
    await inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 1 }); // staff reduced to 1
    attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 3 }, // 3 already occupying
      "2026-08-15": { ...zeroOccupancy(), private: 3 },
    };

    const avail = (await service.getAvailability()).availability["2026-08-14"];

    expect(avail.totalAvailable).toBe(0);
    expect(avail.types.private.remaining).toBe(0);
    expect(avail.types.private.available).toBe(false);
  });
});

describe("AvailabilityService — R3 per-date rules (14th spans both nights, 15th spans one)", () => {
  let attendeeRepo: FakeAttendeeRepo;
  let inventoryRepo: FakeInventoryRepo;
  let service: AvailabilityService;

  beforeEach(() => {
    attendeeRepo = new FakeAttendeeRepo();
    inventoryRepo = new FakeInventoryRepo();
    service = new AvailabilityService({ attendeeRepo, inventoryRepo });
  });

  it("A12: 15th night is the bottleneck -> 14th check-in availability limited by 15th night capacity", async () => {
    // 14th has plenty of rooms; 15th is nearly full. A 14th check-in occupies
    // both nights, so it must respect the 15th's tighter capacity (R3.4/R3.5).
    await inventoryRepo.set({ "2026-08-14": 10, "2026-08-15": 1 });
    attendeeRepo.occupancy = {
      "2026-08-14": zeroOccupancy(),
      "2026-08-15": { ...zeroOccupancy(), private: 1 }, // 15th night: 1/1 used
    };

    const d14 = (await service.getAvailability()).availability["2026-08-14"];
    const d15 = (await service.getAvailability()).availability["2026-08-15"];

    expect(d14.types.private.available).toBe(false); // bottlenecked by 15th night
    expect(d15.types.private.available).toBe(false); // 15th itself is full
  });

  it("A13: 14th check-in rejected when 15th night is full even though the 14th night alone has capacity", async () => {
    await inventoryRepo.set({ "2026-08-14": 5, "2026-08-15": 5 });
    attendeeRepo.occupancy = {
      "2026-08-14": zeroOccupancy(), // 14th night wide open
      "2026-08-15": { ...zeroOccupancy(), private: 5 }, // 15th night: fully occupied
    };

    expect(await service.isAccommodationAvailable("private", "2026-08-14")).toBe(false);
    // 15th check-in only touches the 15th night — also unavailable here since it's full.
    expect(await service.isAccommodationAvailable("private", "2026-08-15")).toBe(false);
  });

  it("A14: a 15th check-in is available when only the 15th night has capacity, independent of the 14th night", async () => {
    // 14th night is completely sold out, but that must not affect a 15th check-in.
    await inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 5 });
    attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 1 }, // 14th night full (only from 14th check-ins)
      "2026-08-15": zeroOccupancy(), // 15th night: nobody yet
    };

    expect(await service.isAccommodationAvailable("private", "2026-08-15")).toBe(true);
    expect(await service.isAccommodationAvailable("private", "2026-08-14")).toBe(false);
  });

  it("A15 (R2.3 / spec Edge Case): shared_double people from different check-in dates are combined on the overlap night, and can fill each other's partial room", async () => {
    // 1 shared_double person checks in on the 14th (occupies both nights) and
    // 1 shared_double person checks in on the 15th (occupies 15th only). On
    // the night of the 15th they are counted TOGETHER: ceil(2/2) = 1 room,
    // not 2 separate partial rooms.
    await inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 1 });
    attendeeRepo.occupancy = {
      // Night of 14th: only the 14th-check-in sd person is present -> 1 person, 1 room (partial).
      "2026-08-14": { ...zeroOccupancy(), shared_double: sharedOf(1, 2) },
      // Night of 15th: both the 14th-check-in AND 15th-check-in sd people are present -> combined count 2, ceil(2/2)=1 room.
      "2026-08-15": { ...zeroOccupancy(), shared_double: sharedOf(2, 2) },
    };

    const availability = await service.getAvailability();

    // Because they pair up into exactly 1 room on the 15th (no partial, no
    // empty rooms left in a 1-room inventory), no further sd person can be
    // accepted for a 15th check-in.
    expect(availability.availability["2026-08-15"].types.shared_double.available).toBe(false);
    // But the 14th night has an open slot (1 person in a 2-person room) that
    // a further 14th-check-in sd person could theoretically fill for that
    // night alone — however overall 14th-check-in availability is still
    // gated by the 15th night (R3.4), which is full.
    expect(availability.availability["2026-08-14"].types.shared_double.available).toBe(false);
  });

  it("A16 (spec Edge Case): a single shared_triple 14th check-in plus a shared_triple 15th check-in combine on the overlap night", async () => {
    await inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 1 });
    attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), shared_triple: sharedOf(1, 3) },
      "2026-08-15": { ...zeroOccupancy(), shared_triple: sharedOf(2, 3) }, // combined count 2 -> ceil(2/3)=1 room
    };

    const d15 = (await service.getAvailability()).availability["2026-08-15"];
    // 1 room total, 1 room consumed by the combined partial triple -> 1 open slot remains (3rd seat).
    expect(d15.totalAvailable).toBe(0); // no fully empty rooms
    expect(d15.types.shared_triple.available).toBe(true); // but 1 open slot in the partial room
    expect(d15.types.shared_triple.remaining).toBe(1);
  });
});

describe("AvailabilityService.isAccommodationAvailable — R6/R7 boolean gate", () => {
  it("A17: returns false for a sold-out type and true for an available type on the same date", async () => {
    const attendeeRepo = new FakeAttendeeRepo();
    const inventoryRepo = new FakeInventoryRepo();
    await inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 1 });
    attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 1 },
      "2026-08-15": { ...zeroOccupancy(), private: 1 },
    };
    const service = new AvailabilityService({ attendeeRepo, inventoryRepo });

    expect(await service.isAccommodationAvailable("private", "2026-08-14")).toBe(false);
    expect(await service.isAccommodationAvailable("none", "2026-08-14")).toBe(true);
  });
});

// ===========================================================================
// SECTION B — HTTP boundary: GET /api/accommodation/availability (R5)
// ===========================================================================

function mountAccommodationApp(availabilityService: AvailabilityService) {
  _scopeCache.clear();
  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("availabilityService", availabilityService);
    await next();
  });
  app.route("/accommodation", accommodationRoutes);
  return (input: string, init?: RequestInit) => app.request(input, init, TEST_ENV);
}

describe("HTTP boundary — GET /api/accommodation/availability (R5)", () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it("B1: R5.3 — inventoryConfigured:false, availability object present, all types available:true", async () => {
    const service = new AvailabilityService({
      attendeeRepo: new FakeAttendeeRepo(),
      inventoryRepo: new FakeInventoryRepo(),
    });
    const req = mountAccommodationApp(service);

    const res = await req("/api/accommodation/availability");
    expect(res.status).toBe(200);
    const body = await res.json() as { availability: Record<string, unknown>; inventoryConfigured: boolean };

    expect(body.inventoryConfigured).toBe(false);
    expect(body.availability["2026-08-14"]).toBeDefined();
    expect(body.availability["2026-08-15"]).toBeDefined();
  });

  it("B2: R5.1 — configured inventory produces the documented response shape with real remaining counts", async () => {
    // Proves the route is actually wired to the real service (not a stub) —
    // catches a generator that hard-codes the response or forgets to call
    // getAvailability() with the request's actual inventory/occupancy.
    const attendeeRepo = new FakeAttendeeRepo();
    const inventoryRepo = new FakeInventoryRepo();
    await inventoryRepo.set({ "2026-08-14": 3, "2026-08-15": 2 });
    attendeeRepo.occupancy = {
      "2026-08-14": zeroOccupancy(),
      "2026-08-15": { ...zeroOccupancy(), shared_triple: sharedOf(1, 3) },
    };
    const service = new AvailabilityService({ attendeeRepo, inventoryRepo });
    const req = mountAccommodationApp(service);

    const res = await req("/api/accommodation/availability");
    const body = await res.json() as {
      inventoryConfigured: boolean;
      availability: Record<string, { totalAvailable: number; types: Record<string, { available: boolean; remaining: number }> }>;
    };

    expect(body.inventoryConfigured).toBe(true);
    // 15th night: totalRooms=2, 1 room consumed by the partial triple (1 of 3
    // seats filled) -> emptyRooms=1, open slots=2 -> remaining = 2 + 1*3 = 5.
    expect(body.availability["2026-08-15"].types.shared_triple.remaining).toBe(5);
    // 14th check-in spans both nights (R3.4): 14th night has 3 empty rooms,
    // but 15th night has only 1 empty room (1 consumed by the triple) -> the
    // intersection takes the min across both nights, so private.remaining = 1.
    expect(body.availability["2026-08-14"].types.private).toEqual({ available: true, remaining: 1 });
  });
});

// ===========================================================================
// SECTION C — HTTP boundary: POST /api/registrations submission gate (R6)
// ===========================================================================

class InMemoryRegistrationRepo implements IRegistrationRepository {
  readonly registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  companionAttendeeRepo?: IAttendeeRepository & { replaceForRegistration(id: number, attendees: NewAttendee[]): Promise<void> };
  companionPaymentRepo?: IPaymentRepository;
  companionDocumentRepo?: IDocumentRepository;

  async create(registration: NewRegistration): Promise<{ id: number }> {
    const id = this.nextId++;
    const now = Date.now();
    const reg: Registration = {
      id,
      regCode: registration.reg_code,
      status: "pending",
      fullName: registration.full_name,
      branch: registration.branch,
      email: registration.email,
      whatsapp: registration.whatsapp,
      mobileAlternate: registration.mobile_alternate,
      city: registration.city,
      country: registration.country,
      attendanceIntent: registration.attendance_intent,
      participationType: registration.participation_type,
      gender: registration.gender,
      tshirtSize: registration.tshirt_size,
      alumniMeal: registration.alumni_meal,
      accommodation: registration.accommodation,
      checkIn: registration.check_in,
      checkOut: registration.check_out,
      extraBed: registration.extra_bed !== 0,
      breakfastAdult: 0,
      breakfastChild: 0,
      donationAmount: registration.donation_amount,
      publicAck: registration.public_ack !== 0,
      ackDisplayName: registration.ack_display_name,
      felicitation: registration.felicitation !== 0,
      contributionSplits: {},
      pricingSnapshot: JSON.parse(registration.pricing_snapshot) as PricingBreakup,
      totalAmount: registration.total_amount,
      idNote: registration.id_note,
      photoFileKey: registration.photo_file_key,
      photoThumbKey: null,
      createdAt: now,
      updatedAt: now,
    };
    this.registrations.set(id, reg);
    return { id };
  }

  async createWithRelations(insertSet: RegistrationInsertSet): Promise<{ id: number }> {
    const { id } = await this.create(insertSet.registration);
    if (this.companionAttendeeRepo && insertSet.attendees.length > 0) {
      const withFk = insertSet.attendees.map((a) => ({ ...a, registration_id: id }));
      await this.companionAttendeeRepo.replaceForRegistration(id, withFk);
    }
    if (this.companionDocumentRepo && insertSet.document) {
      await this.companionDocumentRepo.create({ ...insertSet.document, registration_id: id });
    }
    if (this.companionPaymentRepo) {
      await this.companionPaymentRepo.create({ ...insertSet.payment, registration_id: id });
    }
    return { id };
  }

  async findById(id: number): Promise<Registration | null> {
    return this.registrations.get(id) ?? null;
  }

  async findByRegCode(regCode: string): Promise<Registration | null> {
    for (const reg of this.registrations.values()) if (reg.regCode === regCode) return reg;
    return null;
  }

  async findByEmail(email: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter((r) => r.email === email);
  }

  async findByWhatsapp(whatsapp: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter((r) => r.whatsapp === whatsapp);
  }

  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    const reg = this.registrations.get(id);
    if (reg) { reg.status = status; reg.updatedAt = Date.now(); }
  }

  async update(id: number, data: RegistrationUpdate): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    if (data.accommodation !== undefined) reg.accommodation = data.accommodation;
    reg.updatedAt = Date.now();
  }

  async list(_filters?: RegistrationFilters): Promise<Registration[]> { return [...this.registrations.values()]; }
  async count(): Promise<number> { return this.registrations.size; }
  async countByStatus(): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    return { pending: 0, pendingVerification: 0, confirmed: 0 };
  }
  async geographyAggregates() { return { cities: [], countries: [] }; }
  async donorRecognitionRows() { return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 }; }
  async getContributionAggregates() { return []; }
  async getDonationTotals() { return { count: 0, total: 0 }; }
  async countByParticipationAndStatus() {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    return { full_celebration: zero(), campus_only: zero(), donation_only: zero() };
  }
  async findMissingThumbnails() { return []; }
  async findWithThumbnails() { return []; }
  async updateWithLock(
    id: number,
    data: RegistrationUpdate,
    _expectedUpdatedAt: number,
    _attendees?: NewAttendee[],
  ): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    if (data.accommodation !== undefined) reg.accommodation = data.accommodation as Registration["accommodation"];
    if (data.check_in !== undefined) reg.checkIn = data.check_in;
    reg.updatedAt = Date.now();
  }
}

class InMemoryPaymentRepo implements IPaymentRepository {
  private payments: Map<number, Payment> = new Map();
  private nextId = 1;

  async create(payment: NewPayment): Promise<{ id: number }> {
    const id = this.nextId++;
    const now = Date.now();
    this.payments.set(id, {
      id,
      registrationId: payment.registration_id,
      amount: payment.amount,
      status: payment.status,
      gateway: payment.gateway,
      gatewayRef: payment.gateway_ref,
      gatewayResponse: payment.gateway_response,
      proofFileKey: payment.proof_file_key,
      verifiedBy: payment.verified_by,
      verifiedAt: payment.verified_at,
      method: null,
      note: null,
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  async findById(id: number): Promise<Payment | null> { return this.payments.get(id) ?? null; }
  async findByRegistration(registrationId: number): Promise<Payment[]> {
    return [...this.payments.values()].filter((p) => p.registrationId === registrationId);
  }
  async updateStatus(id: number, status: PaymentStatus): Promise<void> {
    const p = this.payments.get(id);
    if (p) { p.status = status; p.updatedAt = Date.now(); }
  }
  async sumVerified(): Promise<number> { return 0; }
  async sumVerifiedByBranch() { return []; }
  async verify(): Promise<void> {}
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(): Promise<Payment | null> { return null; }
  async deletePending(): Promise<void> {}
  async updatePendingAmount(): Promise<void> {}
  async sumVerifiedByRegistration(): Promise<number> { return 0; }
}

class InMemoryAuditRepo implements IAuditRepository {
  entries: AuditEntry[] = [];
  private nextId = 1;
  async append(entry: NewAuditEntry): Promise<void> {
    this.entries.push({
      id: this.nextId++,
      registrationId: entry.registration_id,
      action: entry.action,
      actor: entry.actor,
      changes: entry.changes ? JSON.parse(entry.changes) : null,
      snapshot: JSON.parse(entry.snapshot),
      createdAt: Date.now(),
    });
  }
  async findByRegistration(registrationId: number): Promise<AuditEntry[]> {
    return this.entries.filter((e) => e.registrationId === registrationId);
  }
}

class StubDocumentRepo implements IDocumentRepository {
  created: NewIdDocument[] = [];
  async create(doc: NewIdDocument): Promise<{ id: number }> { this.created.push(doc); return { id: this.created.length }; }
  async findByRegistration(): Promise<IdDocument[]> { return []; }
  async updateR2Key(): Promise<void> {}
}

class StubEmailService implements IEmailService {
  confirmationCalls = 0;
  async sendConfirmation(): Promise<void> { this.confirmationCalls += 1; }
  async sendMagicLink(): Promise<void> {}
  async sendPaymentConfirmed(): Promise<void> {}
  async sendPaymentRejected(): Promise<void> {}
  async sendStaffWelcome(): Promise<void> {}
  async sendPaymentLink(): Promise<void> {}
  async sendRevisedPayment(): Promise<void> {}
  async sendAdditionalPayment(): Promise<void> {}
  async sendStoryHidden(): Promise<void> {}
}

const BASE_SUBMIT: SubmitRegistrationRequest = {
  contact: {
    fullName: "Test Alumnus",
    branch: "Computer Science & Engineering",
    gender: "male",
    email: "placeholder@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: "",
    city: "Kochi",
    country: "India",
  },
  attendance: {
    intent: "attending",
    participationType: "full_celebration",
    alumniMeal: "non_veg",
    tshirtSize: "L",
  },
  attendees: { children: [], guests: [] },
  idDocument: {
    fileKey: "test-doc-key",
    fileType: "image/jpeg",
    sizeBytes: 1024,
    fileName: "id.jpg",
    note: "",
  },
};

function submitBody(email: string, overrides: Partial<SubmitRegistrationRequest> = {}): SubmitRegistrationRequest {
  return { ...BASE_SUBMIT, contact: { ...BASE_SUBMIT.contact, email }, ...overrides };
}

interface RegAppContext {
  req: (input: string, init?: RequestInit) => Promise<Response>;
  regRepo: InMemoryRegistrationRepo;
  attendeeRepo: FakeAttendeeRepo;
  inventoryRepo: FakeInventoryRepo;
  emailService: StubEmailService;
  execution: { waitUntilCalls: number };
}

function mountRegistrationApp(options: { acceptNew?: boolean } = {}): RegAppContext {
  const { acceptNew = true } = options;
  const regRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new FakeAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  const documentRepo = new StubDocumentRepo();
  const emailService = new StubEmailService();
  const execution = { waitUntilCalls: 0 };
  const pricingService = new PricingService();
  const inventoryRepo = new FakeInventoryRepo();
  const availabilityService = new AvailabilityService({ attendeeRepo, inventoryRepo });

  regRepo.companionAttendeeRepo = attendeeRepo;
  regRepo.companionPaymentRepo = paymentRepo;
  regRepo.companionDocumentRepo = documentRepo;

  const registrationService = new RegistrationService({
    registrationRepo: regRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    emailService,
    pricingService,
    availabilityService,
    authService: {
      async issueAttendeeToken(registrationId: number) {
        return signToken({ sub: String(registrationId), role: "attendee" }, TEST_JWT_SECRET);
      },
      async createPaymentLinkUrl(_id: number, regCode: string) {
        return `/pay/${regCode}?code=test`;
      },
    },
  });

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("registrationService", registrationService);
    c.set("featureFlagService", makeRegistrationFeatureFlagService(acceptNew));
    await next();
  });
  app.route("/", registrationRoutes);

  // registration.routes.ts calls c.executionCtx.waitUntil() to relocate files
  // in the background — Hono's app.request() needs a fake ExecutionContext or
  // that call throws "This context has no ExecutionContext".
  const fakeExecutionCtx = {
    waitUntil: (promise: Promise<unknown>) => {
      execution.waitUntilCalls += 1;
      promise.catch(() => {});
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  const req = (input: string, init?: RequestInit) =>
    app.request(input, init, TEST_ENV, fakeExecutionCtx) as Promise<Response>;
  return { req, regRepo, attendeeRepo, inventoryRepo, emailService, execution };
}

function postRegistration(ctx: RegAppContext, body: SubmitRegistrationRequest) {
  return ctx.req("/api/registrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("HTTP boundary — POST /api/registrations submission gate (R6)", () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it("C0: closed registration returns the exact 403 body without persisting or triggering route side effects", async () => {
    const ctx = mountRegistrationApp({ acceptNew: false });

    const res = await postRegistration(ctx, submitBody("closed@example.com"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Registration is currently closed",
      code: "REGISTRATION_CLOSED",
    });
    expect(ctx.regRepo.registrations.size).toBe(0);
    expect(ctx.emailService.confirmationCalls).toBe(0);
    expect(ctx.execution.waitUntilCalls).toBe(0);
  });

  it("C1: accepted (201) when the selected accommodation is available", async () => {
    const ctx = mountRegistrationApp();
    await ctx.inventoryRepo.set({ "2026-08-14": 5, "2026-08-15": 5 });

    const res = await postRegistration(ctx, submitBody("c1@example.com", {
      accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    }));

    expect(res.status).toBe(201);
    expect(ctx.regRepo.registrations.size).toBe(1);
  });

  it("C2 (R6.3): rejected with 409 and the EXACT documented error body when accommodation is sold out", async () => {
    // R6.3 mandates { error: "...", code: "ACCOMMODATION_UNAVAILABLE" }.
    // AppError (services/errors.ts) has no `code` field at all, and
    // registration.service.ts throws `new AppError('Selected accommodation is
    // no longer available', 409)` with no code — the response body will be
    // { error: "..." } with NO `code` property. This test is expected to fail
    // against the current implementation; that failure is the bug report.
    const ctx = mountRegistrationApp();
    await ctx.inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 1 });
    ctx.attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 1 },
      "2026-08-15": { ...zeroOccupancy(), private: 1 },
    };

    const res = await postRegistration(ctx, submitBody("c2@example.com", {
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    }));

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; code?: string };
    expect(body.error).toBe("Selected accommodation is no longer available");
    expect(body.code).toBe("ACCOMMODATION_UNAVAILABLE");
  });

  it("C3 (R6.1): a rejected submission writes nothing — no registration is persisted", async () => {
    const ctx = mountRegistrationApp();
    await ctx.inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 1 });
    ctx.attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 1 },
      "2026-08-15": { ...zeroOccupancy(), private: 1 },
    };

    const res = await postRegistration(ctx, submitBody("c3@example.com", {
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    }));

    expect(res.status).toBe(409);
    expect(ctx.regRepo.registrations.size).toBe(0);
  });

  it("C4 (R6.2): skipped when accommodation is 'none' — submission succeeds even though rooms are full", async () => {
    const ctx = mountRegistrationApp();
    await ctx.inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 1 });
    ctx.attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 1 },
      "2026-08-15": { ...zeroOccupancy(), private: 1 },
    };

    const res = await postRegistration(ctx, submitBody("c4@example.com", { accommodation: undefined }));

    expect(res.status).toBe(201);
  });

  it("C5 (R6.2): skipped when inventory has not been configured — submission succeeds with no inventory rows at all", async () => {
    const ctx = mountRegistrationApp();
    // Deliberately do NOT set any inventory.

    const res = await postRegistration(ctx, submitBody("c5@example.com", {
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    }));

    expect(res.status).toBe(201);
  });
});

// ===========================================================================
// SECTION D — EditService.edit(): staff edit constraints (R7)
// ===========================================================================

class MinimalEditRegRepo implements IRegistrationRepository {
  reg: Registration;
  constructor(reg: Registration) { this.reg = reg; }
  async createWithRelations(): Promise<{ id: number }> { return { id: this.reg.id }; }
  async findById(id: number): Promise<Registration | null> { return id === this.reg.id ? this.reg : null; }
  async findByRegCode(): Promise<Registration | null> { return null; }
  async findByEmail(): Promise<Registration[]> { return []; }
  async findByWhatsapp(): Promise<Registration[]> { return []; }
  async updateStatus(): Promise<void> {}
  async update(): Promise<void> {}
  async list(): Promise<Registration[]> { return [this.reg]; }
  async count(): Promise<number> { return 1; }
  async countByStatus() { return { pending: 0, pendingVerification: 0, confirmed: 0 }; }
  async geographyAggregates() { return { cities: [], countries: [] }; }
  async donorRecognitionRows() { return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 }; }
  async getContributionAggregates() { return []; }
  async getDonationTotals() { return { count: 0, total: 0 }; }
  async countByParticipationAndStatus() {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    return { full_celebration: zero(), campus_only: zero(), donation_only: zero() };
  }
  async findMissingThumbnails() { return []; }
  async findWithThumbnails() { return []; }
  // Deliberately a no-op: R7 is about whether edit() ACCEPTS or REJECTS the
  // attempt (observable via throw/no-throw), not about persistence fidelity —
  // that's covered by other specs, not room-availability.spec.md.
  async updateWithLock(): Promise<void> {}
}

class NoPaymentsPaymentRepo implements IPaymentRepository {
  async create(): Promise<{ id: number }> { return { id: 1 }; }
  async findById(): Promise<Payment | null> { return null; }
  async findByRegistration(): Promise<Payment[]> { return []; }
  async updateStatus(): Promise<void> {}
  async sumVerified(): Promise<number> { return 0; }
  async sumVerifiedByBranch() { return []; }
  async verify(): Promise<void> {}
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(): Promise<Payment | null> { return null; }
  async deletePending(): Promise<void> {}
  async updatePendingAmount(): Promise<void> {}
  async sumVerifiedByRegistration(): Promise<number> { return 0; }
}

class NoAttendeesRepo implements IAttendeeRepository {
  async findByRegistration(): Promise<Attendee[]> { return []; }
  async replaceForRegistration(): Promise<void> {}
  async countGrouped() { return []; }
  async accommodationByNight(): Promise<Record<string, NightOccupancy>> { return {}; }
  async mealsByParticipationType() {
    return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } };
  }
  async childrenByAgeBand() { return { under6: 0, age6to12: 0, age12plus: 0 }; }
}

class NoopAuditRepo implements IAuditRepository {
  async append(): Promise<void> {}
  async findByRegistration(): Promise<AuditEntry[]> { return []; }
}

class NoopEmailService implements IEmailService {
  async sendConfirmation(): Promise<void> {}
  async sendMagicLink(): Promise<void> {}
  async sendPaymentConfirmed(): Promise<void> {}
  async sendPaymentRejected(): Promise<void> {}
  async sendStaffWelcome(): Promise<void> {}
  async sendPaymentLink(): Promise<void> {}
  async sendRevisedPayment(): Promise<void> {}
  async sendAdditionalPayment(): Promise<void> {}
  async sendStoryHidden(): Promise<void> {}
}

function baseRegistration(overrides: Partial<Registration> = {}): Registration {
  const now = Date.now();
  return {
    id: 5001,
    regCode: "SMRTEDITTEST0001",
    status: "confirmed",
    fullName: "Edit Target",
    branch: "2010",
    email: "edit-target@example.com",
    whatsapp: "+919000000000",
    mobileAlternate: null,
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    gender: "male",
    tshirtSize: "M",
    alumniMeal: "veg",
    accommodation: "shared_triple",
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
    extraBed: false,
    breakfastAdult: 0,
    breakfastChild: 0,
    donationAmount: 0,
    publicAck: false,
    ackDisplayName: null,
    felicitation: false,
    contributionSplits: {},
    pricingSnapshot: { base: 8500, lines: [], donation: 0, collegeContribution: 0, total: 8500 } as unknown as PricingBreakup,
    totalAmount: 8500,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEditService(reg: Registration, availabilityService: AvailabilityService): EditService {
  return new EditService({
    db: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
    registrationRepo: new MinimalEditRegRepo(reg),
    paymentRepo: new NoPaymentsPaymentRepo(),
    attendeeRepo: new NoAttendeesRepo(),
    auditRepo: new NoopAuditRepo(),
    emailService: new NoopEmailService(),
    availabilityService,
  });
}

describe("EditService.edit() — R7 staff edit constraints", () => {
  it("D1 (R7.2): upgrade blocked with 409 when the target type has no capacity", async () => {
    // shared_triple -> private is an upgrade (rank 1 -> 3). Private has 0 empty rooms.
    const reg = baseRegistration({ accommodation: "shared_triple", checkIn: "2026-08-14" });
    const attendeeRepo = new FakeAttendeeRepo();
    const inventoryRepo = new FakeInventoryRepo();
    await inventoryRepo.set({ "2026-08-14": 1, "2026-08-15": 1 });
    attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 1 },
      "2026-08-15": { ...zeroOccupancy(), private: 1 },
    };
    const availabilityService = new AvailabilityService({ attendeeRepo, inventoryRepo });
    const editService = makeEditService(reg, availabilityService);

    await expect(
      editService.edit(reg.id, { fields: { accommodation: "private" }, updatedAt: reg.updatedAt }, "staff@example.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("D2 (R7.1): downgrade always allowed even at full capacity — shared_double -> shared_triple", async () => {
    const reg = baseRegistration({ accommodation: "shared_double", checkIn: "2026-08-14" });
    const attendeeRepo = new FakeAttendeeRepo();
    const inventoryRepo = new FakeInventoryRepo();
    await inventoryRepo.set({ "2026-08-14": 0, "2026-08-15": 0 }); // fully sold out
    const availabilityService = new AvailabilityService({ attendeeRepo, inventoryRepo });
    const editService = makeEditService(reg, availabilityService);

    await expect(
      editService.edit(reg.id, { fields: { accommodation: "shared_triple" }, updatedAt: reg.updatedAt }, "staff@example.com"),
    ).resolves.toBeDefined();
  });

  it("D3 (R7.1): release to 'none' always allowed even at full capacity", async () => {
    const reg = baseRegistration({ accommodation: "private", checkIn: "2026-08-14" });
    const attendeeRepo = new FakeAttendeeRepo();
    const inventoryRepo = new FakeInventoryRepo();
    await inventoryRepo.set({ "2026-08-14": 0, "2026-08-15": 0 });
    const availabilityService = new AvailabilityService({ attendeeRepo, inventoryRepo });
    const editService = makeEditService(reg, availabilityService);

    await expect(
      editService.edit(reg.id, { fields: { accommodation: "none" }, updatedAt: reg.updatedAt }, "staff@example.com"),
    ).resolves.toBeDefined();
  });

  it("D4 (R7.2 counter-case): upgrade allowed when the target type has capacity", async () => {
    const reg = baseRegistration({ accommodation: "shared_triple", checkIn: "2026-08-14" });
    const attendeeRepo = new FakeAttendeeRepo();
    const inventoryRepo = new FakeInventoryRepo();
    await inventoryRepo.set({ "2026-08-14": 5, "2026-08-15": 5 }); // wide open
    const availabilityService = new AvailabilityService({ attendeeRepo, inventoryRepo });
    const editService = makeEditService(reg, availabilityService);

    await expect(
      editService.edit(reg.id, { fields: { accommodation: "private" }, updatedAt: reg.updatedAt }, "staff@example.com"),
    ).resolves.toBeDefined();
  });
});

// ===========================================================================
// SECTION E — HTTP boundary: GET/PUT /api/staff/room-inventory (R8)
// ===========================================================================

interface StaffAppContext {
  req: (input: string, init?: RequestInit) => Promise<Response>;
  inventoryRepo: FakeInventoryRepo;
  attendeeRepo: FakeAttendeeRepo;
}

function mountStaffApp(): StaffAppContext {
  _scopeCache.clear();
  const inventoryRepo = new FakeInventoryRepo();
  const attendeeRepo = new FakeAttendeeRepo();

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("inventoryRepo", inventoryRepo);
    c.set("attendeeRepo", attendeeRepo);
    c.set("systemAuditRepo", { append: async () => {} } as ISystemAuditRepository);
    await next();
  });
  app.route("/staff", staffRoutes);

  const req = (input: string, init?: RequestInit) => app.request(input, init, TEST_ENV) as Promise<Response>;
  return { req, inventoryRepo, attendeeRepo };
}

async function staffToken(): Promise<string> {
  return signToken({ sub: "1", role: "staff", email: "staff@example.com" }, TEST_JWT_SECRET);
}

async function attendeeToken(): Promise<string> {
  return signToken({ sub: "42", role: "attendee" }, TEST_JWT_SECRET);
}

describe("HTTP boundary — GET/PUT /api/staff/room-inventory (R8)", () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it("E1 (R8.3): GET without a token is rejected with 401", async () => {
    const ctx = mountStaffApp();
    const res = await ctx.req("/api/staff/room-inventory");
    expect(res.status).toBe(401);
  });

  it("E2 (R8.3): GET with an attendee-role token is rejected with 403 — staff/admin only", async () => {
    const ctx = mountStaffApp();
    const token = await attendeeToken();
    const res = await ctx.req("/api/staff/room-inventory", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
  });

  it("E3 (R8.4): GET with staff auth returns quotas and rooms-consumed per night", async () => {
    const ctx = mountStaffApp();
    await ctx.inventoryRepo.set({ "2026-08-14": 5, "2026-08-15": 3 });
    ctx.attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 2 },
      "2026-08-15": { ...zeroOccupancy(), private: 2, shared_double: sharedOf(1, 2) },
    };
    const token = await staffToken();

    const res = await ctx.req("/api/staff/room-inventory", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      inventory: Record<string, { totalRooms: number; roomsConsumed: number }>;
      overCommitted: Record<string, boolean>;
    };

    expect(body.inventory["2026-08-14"]).toEqual({ totalRooms: 5, roomsConsumed: 2 });
    // 15th: private(2) + shared_double rooms(ceil(1/2)=1) = 3 consumed
    expect(body.inventory["2026-08-15"]).toEqual({ totalRooms: 3, roomsConsumed: 3 });
    expect(body.overCommitted["2026-08-14"]).toBe(false);
    expect(body.overCommitted["2026-08-15"]).toBe(false);
  });

  it("E4 (R8.2): PUT reducing inventory below current occupancy is NOT blocked, and flags overCommitted", async () => {
    const ctx = mountStaffApp();
    ctx.attendeeRepo.occupancy = {
      "2026-08-14": { ...zeroOccupancy(), private: 3 }, // 3 rooms already occupied
      "2026-08-15": { ...zeroOccupancy(), private: 3 },
    };
    const token = await staffToken();

    const res = await ctx.req("/api/staff/room-inventory", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ "2026-08-14": 1, "2026-08-15": 1 }), // staff reduces below occupancy
    });

    // R8.2: "The save is not blocked" — must succeed, not reject.
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; overCommitted: Record<string, boolean> };
    expect(body.ok).toBe(true);
    expect(body.overCommitted["2026-08-14"]).toBe(true);
    expect(body.overCommitted["2026-08-15"]).toBe(true);
  });

  it("E5 (R8.4): PUT persists quotas — a subsequent GET reflects the update", async () => {
    const ctx = mountStaffApp();
    const token = await staffToken();

    await ctx.req("/api/staff/room-inventory", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ "2026-08-14": 8, "2026-08-15": 6 }),
    });

    const res = await ctx.req("/api/staff/room-inventory", { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json() as { inventory: Record<string, { totalRooms: number }> };
    expect(body.inventory["2026-08-14"].totalRooms).toBe(8);
    expect(body.inventory["2026-08-15"].totalRooms).toBe(6);
  });

  it("E6 (R8.3): PUT without a token is rejected with 401", async () => {
    const ctx = mountStaffApp();
    const res = await ctx.req("/api/staff/room-inventory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "2026-08-14": 5 }),
    });
    expect(res.status).toBe(401);
  });
});
