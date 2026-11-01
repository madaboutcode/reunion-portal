/**
 * Tests for GET /api/registrations/check-email route.
 *
 * Route-level tests: minimal Hono app with in-memory repo, validates the
 * check-email endpoint behavior per spec requirements.
 *
 * @module check-email.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { registrationRoutes } from "../routes/registration.routes.js";
import { clearRateLimitStore } from "../middleware/rate-limit.js";
import type {
  IRegistrationRepository,
} from "../repositories/interfaces.js";
import type {
  Registration,
  NewRegistration,
  RegistrationUpdate,
  RegistrationFilters,
  NewAttendee,
  NewPayment,
  NewIdDocument,
} from "../domain/types.js";
import type { RegistrationStatus } from "../domain/status.js";
import type { PricingBreakup } from "@smriti/shared";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";

// ---------------------------------------------------------------------------
// Minimal in-memory repo — only findByEmail is exercised by check-email
// ---------------------------------------------------------------------------

class InMemoryRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  // Companion repos for createWithRelations
  companionAttendeeRepo?: { replaceForRegistration(id: number, attendees: NewAttendee[]): Promise<void> };
  companionPaymentRepo?: { create(payment: NewPayment): Promise<{ id: number }> };
  companionDocumentRepo?: { create(doc: NewIdDocument): Promise<{ id: number }> };

  async create(
    registration: NewRegistration,
    _attendees: NewAttendee[],
  ): Promise<{ id: number }> {
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
      pricingSnapshot: JSON.parse(
        registration.pricing_snapshot,
      ) as PricingBreakup,
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
    const { id } = await this.create(insertSet.registration, insertSet.attendees);
    if (this.companionAttendeeRepo && insertSet.attendees.length > 0) {
      await this.companionAttendeeRepo.replaceForRegistration(id, insertSet.attendees.map(a => ({ ...a, registration_id: id })));
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
    for (const reg of this.registrations.values()) {
      if (reg.regCode === regCode) return reg;
    }
    return null;
  }

  async findByEmail(email: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter((r) => r.email === email);
  }

  async findByWhatsapp(whatsapp: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter(
      (r) => r.whatsapp === whatsapp,
    );
  }

  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    const reg = this.registrations.get(id);
    if (reg) {
      reg.status = status;
      reg.updatedAt = Date.now();
    }
  }

  async update(
    id: number,
    data: RegistrationUpdate,
    _attendees?: NewAttendee[],
  ): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    if (data.full_name !== undefined) reg.fullName = data.full_name;
    reg.updatedAt = Date.now();
  }

  async list(_filters?: RegistrationFilters): Promise<Registration[]> {
    return [...this.registrations.values()];
  }

  async count(_filters?: RegistrationFilters): Promise<number> {
    return this.registrations.size;
  }

  async countByStatus(_filters?: { type?: 'attendee' | 'donor' }): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    return { pending: 0, pendingVerification: 0, confirmed: 0 };
  }

  async geographyAggregates(): Promise<{ cities: { city: string; count: number }[]; countries: { country: string; count: number }[] }> {
    return { cities: [], countries: [] };
  }

  async donorRecognitionRows(_felicitationThreshold: number): Promise<{ publicDonors: { displayName: string; amount: number; felicitationEligible: boolean }[]; nonPublicCount: number; nonPublicTotal: number }> {
    return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 };
  }

  async getContributionAggregates(): Promise<Array<{ cause: string; count: number; total: number }>> {
    return [];
  }

  async countByParticipationAndStatus(): Promise<Record<
    'full_celebration' | 'campus_only' | 'donation_only',
    { total: number; confirmed: number; pending: number; pendingVerification: number }
  >> {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    const out: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }> = {
      full_celebration: zero(),
      campus_only: zero(),
      donation_only: zero(),
    };
    return out as Record<
      'full_celebration' | 'campus_only' | 'donation_only',
      { total: number; confirmed: number; pending: number; pendingVerification: number }
    >;
  }

  async getDonationTotals(): Promise<{ count: number; total: number }> {
    return { count: 0, total: 0 };
  }

  async findMissingThumbnails(): Promise<Array<{ id: number; regCode: string; photoFileKey: string }>> {
    return [];
  }
  async findWithThumbnails() { return []; }

  // Helper: seed a registration with a given email directly
  seed(email: string): void {
    const id = this.nextId++;
    const now = Date.now();
    this.registrations.set(id, {
      id,
      regCode: `SMRT${id.toString().padStart(12, "0")}`,
      status: "pending",
      fullName: "Test User",
      branch: "Electronics & Communication Engineering",
      email,
      whatsapp: "+919876543210",
      mobileAlternate: null,
      city: "Kochi",
      country: "India",
      attendanceIntent: "attending",
      participationType: "full_celebration",
      gender: "male",
      tshirtSize: "M",
      alumniMeal: "non_veg",
      accommodation: "none",
      checkIn: null,
      checkOut: null,
      extraBed: false,
      breakfastAdult: 0,
      breakfastChild: 0,
      donationAmount: 0,
      publicAck: false,
      ackDisplayName: null,
      felicitation: false,
      contributionSplits: {},
      pricingSnapshot: { base: 0, lines: [], donation: 0, collegeContribution: 0, total: 0 },
      totalAmount: 0,
      idNote: null,
      photoFileKey: null,
      photoThumbKey: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  async updateWithLock(_id: number, _data: import('../domain/types.js').RegistrationUpdate, _expectedUpdatedAt: number, _attendees?: import('../domain/types.js').NewAttendee[]): Promise<void> {}
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function createApp(regRepo: InMemoryRegistrationRepo) {
  const app = new Hono<AppEnv>().basePath("/api");
  app.use("*", async (c, next) => {
    c.set("registrationRepo", regRepo as AppEnv["Variables"]["registrationRepo"]);
    // registrationService not needed for check-email, but set a stub to avoid errors
    // on other routes that might be matched
    await next();
  });
  app.route("/", registrationRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/registrations/check-email", () => {
  let repo: InMemoryRegistrationRepo;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    clearRateLimitStore();
    repo = new InMemoryRegistrationRepo();
    app = createApp(repo);
  });

  it("returns { registered: false } for an email that has no registration", async () => {
    const res = await app.request(
      "/api/registrations/check-email?email=new@example.com",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ registered: boolean }>();
    expect(body.registered).toBe(false);
  });

  it("returns { registered: true } after a registration exists for that email", async () => {
    repo.seed("existing@example.com");

    const res = await app.request(
      "/api/registrations/check-email?email=existing@example.com",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ registered: boolean }>();
    expect(body.registered).toBe(true);
  });

  it("returns 400 when email query param is missing", async () => {
    const res = await app.request("/api/registrations/check-email");
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when email query param is an empty string", async () => {
    const res = await app.request(
      "/api/registrations/check-email?email=",
    );
    expect(res.status).toBe(400);
  });

  it("normalizes email to lowercase before lookup — finds match regardless of case in request", async () => {
    repo.seed("lowercase@example.com");

    const res = await app.request(
      "/api/registrations/check-email?email=LOWERCASE@EXAMPLE.COM",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ registered: boolean }>();
    // The repo stores lowercase; the route lowercases the query param before lookup
    expect(body.registered).toBe(true);
  });
});
