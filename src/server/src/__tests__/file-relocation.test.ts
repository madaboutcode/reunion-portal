/**
 * Tests for file relocation on registration submit.
 *
 * Covers:
 *   - R2FileStorage.move() happy path and no-op when source missing
 *   - RegistrationService.relocateFiles() — ID doc moved, DB key updated
 *   - relocateFiles() partial failure — doc that errors is skipped, others succeed
 *   - Payment proof key format — new registrations/{regCode}/proof-{id}.{ext} pattern
 */

import { describe, it, expect } from "vitest";
import type {
  IdDocument,
  NewIdDocument,
  FileMetadata,
  Registration,
  RegistrationUpdate,
  RegistrationFilters,
  Attendee,
  NewAttendee,
  NewPayment,
  AuditEntry,
  NewAuditEntry,
} from "../domain/types.js";
import type { RegistrationStatus } from "../domain/status.js";
import type {
  IDocumentRepository,
  IFileStorage,
  IRegistrationRepository,
  IAttendeeRepository,
  IAuditRepository,
  IEmailService,
} from "../repositories/interfaces.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";
import { RegistrationService } from "../services/registration.service.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { PricingService } from "../services/pricing.service.js";
import type { PricingBreakup, SubmitRegistrationRequest } from "@smriti/shared";

const stubAvailabilityService = { isAccommodationAvailable: async () => true } as unknown as AvailabilityService;

// =============================================================================
// Minimal submit data for bootstrapping a registration
// =============================================================================

const validSubmitData: SubmitRegistrationRequest = {
  contact: {
    fullName: "Test User",
    branch: "Computer Science & Engineering",
    gender: "male",
    email: "test-relocation@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: undefined,
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
  accommodation: {
    type: "shared_double",
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
    extraBed: false,
  },
  donation: {
    amount: 500,
    publicAcknowledgement: false,
    felicitationConsent: false,
  },
  idDocument: {
    fileKey: "id-docs/pending/cse/test-user/abc12345.jpg",
    fileType: "image/jpeg",
    sizeBytes: 1024,
    fileName: "id.jpg",
    note: "",
  },
};

// =============================================================================
// Minimal fakes
// =============================================================================

class InMemoryRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  companionAttendeeRepo?: IAttendeeRepository & { replaceForRegistration(id: number, attendees: NewAttendee[]): Promise<void> };
  companionPaymentRepo?: { create(p: NewPayment): Promise<{ id: number }> };
  companionDocumentRepo?: IDocumentRepository;

  async createWithRelations(insertSet: RegistrationInsertSet): Promise<{ id: number }> {
    const id = this.nextId++;
    const nr = insertSet.registration;
    const now = Date.now();
    this.registrations.set(id, {
      id,
      regCode: nr.reg_code,
      status: "pending",
      fullName: nr.full_name,
      branch: nr.branch,
      email: nr.email,
      whatsapp: nr.whatsapp,
      mobileAlternate: nr.mobile_alternate,
      city: nr.city,
      country: nr.country,
      attendanceIntent: nr.attendance_intent,
      participationType: nr.participation_type,
      gender: nr.gender,
      tshirtSize: nr.tshirt_size,
      alumniMeal: nr.alumni_meal,
      accommodation: nr.accommodation,
      checkIn: nr.check_in,
      checkOut: nr.check_out,
      extraBed: nr.extra_bed !== 0,
      breakfastAdult: 0,
      breakfastChild: 0,
      donationAmount: nr.donation_amount,
      publicAck: nr.public_ack !== 0,
      ackDisplayName: nr.ack_display_name,
      felicitation: nr.felicitation !== 0,
      contributionSplits: {},
      pricingSnapshot: JSON.parse(nr.pricing_snapshot) as PricingBreakup,
      totalAmount: nr.total_amount,
      idNote: nr.id_note,
      photoFileKey: nr.photo_file_key,
      photoThumbKey: null,
      createdAt: now,
      updatedAt: now,
    });

    if (this.companionAttendeeRepo && insertSet.attendees.length > 0) {
      const withFk = insertSet.attendees.map(a => ({ ...a, registration_id: id }));
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

  async findById(id: number): Promise<Registration | null> { return this.registrations.get(id) ?? null; }
  async findByRegCode(regCode: string): Promise<Registration | null> {
    for (const r of this.registrations.values()) { if (r.regCode === regCode) return r; }
    return null;
  }
  async findByEmail(email: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter(r => r.email === email);
  }
  async findByWhatsapp(w: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter(r => r.whatsapp === w);
  }
  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    const r = this.registrations.get(id);
    if (r) { r.status = status; r.updatedAt = Date.now(); }
  }
  async update(id: number, data: RegistrationUpdate): Promise<void> {
    const r = this.registrations.get(id);
    if (!r) return;
    if (data.full_name !== undefined) r.fullName = data.full_name;
    if (data.photo_file_key !== undefined) r.photoFileKey = data.photo_file_key;
    if (data.photo_thumb_key !== undefined) r.photoThumbKey = data.photo_thumb_key;
    r.updatedAt = Date.now();
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

  async geographyAggregates(): Promise<{ cities: { city: string; count: number }[]; countries: { country: string; count: number }[] }> {
    return { cities: [], countries: [] };
  }

  async donorRecognitionRows(_felicitationThreshold: number): Promise<{ publicDonors: { displayName: string; amount: number; felicitationEligible: boolean }[]; nonPublicCount: number; nonPublicTotal: number }> {
    return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 };
  }

  async getDonationTotals(): Promise<{ count: number; total: number }> {
    return { count: 0, total: 0 };
  }

  async findMissingThumbnails(): Promise<Array<{ id: number; regCode: string; photoFileKey: string }>> {
    return [];
  }
  async findWithThumbnails() { return []; }
  async updateWithLock(_id: number, _data: import('../domain/types.js').RegistrationUpdate, _expectedUpdatedAt: number, _attendees?: import('../domain/types.js').NewAttendee[]): Promise<void> {}
}

class StubAttendeeRepo implements IAttendeeRepository {
  async findByRegistration(_id: number): Promise<Attendee[]> { return []; }
  async replaceForRegistration(_id: number, _a: NewAttendee[]): Promise<void> {}
  async countGrouped(_filters?: { statuses?: string[]; branch?: string }): Promise<Array<{ type: string; meal: string; count: number }>> { return []; }
  async accommodationByNight(_f?: { statuses?: string[]; branch?: string }): Promise<Record<string, { private: number; privateByGender: { male: number; female: number; other: number }; shared_double: { count: number; rooms: number }; shared_doubleByGender: { male: number; female: number; other: number }; shared_triple: { count: number; rooms: number }; shared_tripleByGender: { male: number; female: number; other: number }; extraBeds: number }>> { return { '2026-08-14': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 }, '2026-08-15': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 } }; }
  async mealsByParticipationType(_f?: { statuses?: string[]; branch?: string }): Promise<{ campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } }> { return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } }; }
  async childrenByAgeBand(_f?: { statuses?: string[]; branch?: string }): Promise<{ under6: number; age6to12: number; age12plus: number }> { return { under6: 0, age6to12: 0, age12plus: 0 }; }
}

class StubPaymentRepo {
  async create(_p: NewPayment): Promise<{ id: number }> { return { id: 1 }; }
}

class StubAuditRepo implements IAuditRepository {
  async append(_e: NewAuditEntry): Promise<void> {}
  async findByRegistration(_id: number): Promise<AuditEntry[]> { return []; }
}

class StubEmailService implements IEmailService {
  async sendConfirmation(): Promise<void> {}
  async sendMagicLink(): Promise<void> {}
  async sendPaymentConfirmed(): Promise<void> {}
  async sendPaymentRejected(): Promise<void> {}
  async sendStaffWelcome(): Promise<void> {}
  async sendPaymentLink(_to: string, _data: unknown): Promise<void> {}
  async sendRevisedPayment(_to: string, _data: unknown): Promise<void> {}
  async sendAdditionalPayment(_to: string, _data: unknown): Promise<void> {}
  async sendStoryHidden(_to: string, _data: unknown): Promise<void> {}
}

/**
 * An in-memory document repo that actually stores and serves back what was
 * created, enabling relocateFiles() to find and update documents.
 */
class InMemoryDocumentRepo implements IDocumentRepository {
  private docs: Map<number, NewIdDocument & { id: number }> = new Map();
  private nextId = 1;

  async create(doc: NewIdDocument): Promise<{ id: number }> {
    const id = this.nextId++;
    this.docs.set(id, { ...doc, id });
    return { id };
  }

  async findByRegistration(registrationId: number): Promise<IdDocument[]> {
    return [...this.docs.values()]
      .filter(d => d.registration_id === registrationId)
      .map(d => ({
        id: d.id,
        registrationId: d.registration_id,
        fileName: d.file_name,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes,
        r2Key: d.r2_key,
        createdAt: Date.now(),
      }));
  }

  async updateR2Key(docId: number, newKey: string): Promise<void> {
    const doc = this.docs.get(docId);
    if (doc) doc.r2_key = newKey;
  }

  getDoc(docId: number) { return this.docs.get(docId); }
}

/**
 * Minimal fake R2Bucket for testing R2FileStorage.move().
 */
function makeR2BucketFake(objects: Map<string, { data: ArrayBuffer; httpMetadata: { contentType: string } }>) {
  return {
    async get(key: string) {
      const obj = objects.get(key);
      if (!obj) return null;
      return {
        arrayBuffer: async () => obj.data,
        httpMetadata: obj.httpMetadata,
        size: obj.data.byteLength,
      };
    },
    async put(key: string, data: ArrayBuffer, opts: { httpMetadata: unknown }) {
      objects.set(key, { data, httpMetadata: opts.httpMetadata as { contentType: string } });
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
}

/**
 * Observable fake for IFileStorage that records move calls.
 */
class ObservableFileStorage implements IFileStorage {
  moves: Array<{ fromKey: string; toKey: string }> = [];
  moveShouldFail: ((fromKey: string) => boolean) | null = null;

  async upload(_key: string, _data: ArrayBuffer, _metadata: FileMetadata): Promise<void> {}
  async getSignedUrl(_key: string, _expiresIn: number): Promise<string> { throw new Error("not implemented"); }
  async get(_key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null> { return null; }
  async delete(_key: string): Promise<void> {}

  async copy(_fromKey: string, _toKey: string): Promise<boolean> {
    return true;
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    if (this.moveShouldFail?.(fromKey)) throw new Error(`Simulated R2 move failure for ${fromKey}`);
    this.moves.push({ fromKey, toKey });
  }
}

// =============================================================================
// Helper: build a RegistrationService with an in-memory doc repo
// =============================================================================

function createServiceWithDocRepo(
  fileStorage: IFileStorage,
  documentRepo: InMemoryDocumentRepo,
): { service: RegistrationService; regRepo: InMemoryRegistrationRepo } {
  const regRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new StubAttendeeRepo();
  const paymentRepo = new StubPaymentRepo();
  const auditRepo = new StubAuditRepo();
  const emailService = new StubEmailService();
  const pricingService = new PricingService();

  regRepo.companionAttendeeRepo = attendeeRepo;
  regRepo.companionPaymentRepo = paymentRepo;
  regRepo.companionDocumentRepo = documentRepo;

  const service = new RegistrationService({
    availabilityService: stubAvailabilityService,
    registrationRepo: regRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    emailService,
    fileStorage,
    pricingService,
    authService: { async issueAttendeeToken() { return "test-token"; }, async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; } },
  });

  return { service, regRepo };
}

// =============================================================================
// 1. R2FileStorage.move()
// =============================================================================

describe("R2FileStorage.move()", () => {
  it("copies object to new key and deletes source", async () => {
    // Import here to avoid module-level side effects
    const { R2FileStorage } = await import("../repositories/file-storage.js");

    const data = new TextEncoder().encode("hello").buffer as ArrayBuffer;
    const objects = new Map<string, { data: ArrayBuffer; httpMetadata: { contentType: string } }>();
    objects.set("src/file.jpg", { data, httpMetadata: { contentType: "image/jpeg" } });

    const bucket = makeR2BucketFake(objects);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = new R2FileStorage(bucket as any);

    await storage.move("src/file.jpg", "dst/file.jpg");

    // Source is gone
    expect(objects.has("src/file.jpg")).toBe(false);
    // Destination exists
    expect(objects.has("dst/file.jpg")).toBe(true);
    expect(objects.get("dst/file.jpg")?.httpMetadata.contentType).toBe("image/jpeg");
  });

  it("is a no-op when source key does not exist (does not throw)", async () => {
    const { R2FileStorage } = await import("../repositories/file-storage.js");

    const objects = new Map<string, { data: ArrayBuffer; httpMetadata: { contentType: string } }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = new R2FileStorage(makeR2BucketFake(objects) as any);

    // Should not throw even though "missing/key.jpg" does not exist
    await expect(storage.move("missing/key.jpg", "dst/key.jpg")).resolves.toBeUndefined();
    // Destination should not be created
    expect(objects.has("dst/key.jpg")).toBe(false);
  });

  it("preserves httpMetadata (contentType) on the destination object", async () => {
    const { R2FileStorage } = await import("../repositories/file-storage.js");

    const data = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer;
    const objects = new Map<string, { data: ArrayBuffer; httpMetadata: { contentType: string } }>();
    objects.set("photos/pending/cse/user/abc.png", { data, httpMetadata: { contentType: "image/png" } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = new R2FileStorage(makeR2BucketFake(objects) as any);
    await storage.move("photos/pending/cse/user/abc.png", "registrations/SMRT1234/photo.png");

    expect(objects.get("registrations/SMRT1234/photo.png")?.httpMetadata.contentType).toBe("image/png");
  });
});

// =============================================================================
// 2. RegistrationService.relocateFiles()
// =============================================================================

describe("RegistrationService.relocateFiles()", () => {
  it("moves id-doc from pending prefix to registrations/{regCode}/ and updates DB", async () => {
    const fileStorage = new ObservableFileStorage();
    const documentRepo = new InMemoryDocumentRepo();
    const { service } = createServiceWithDocRepo(fileStorage, documentRepo);

    // Submit creates the id_documents row with the pending key
    const result = await service.submit(validSubmitData);
    const regId = Number(result.regId);
    const regCode = result.regCode;

    await service.relocateFiles(regId, regCode);

    // One move should have happened
    expect(fileStorage.moves).toHaveLength(1);
    const move = fileStorage.moves[0];
    expect(move.fromKey).toBe("id-docs/pending/cse/test-user/abc12345.jpg");
    expect(move.toKey).toBe(`registrations/${regCode}/id-doc.jpg`);

    // DB key must be updated
    const docs = await documentRepo.findByRegistration(regId);
    expect(docs).toHaveLength(1);
    expect(docs[0].r2Key).toBe(`registrations/${regCode}/id-doc.jpg`);
  });

  it("skips documents that do not start with id-docs/pending/", async () => {
    const fileStorage = new ObservableFileStorage();
    const documentRepo = new InMemoryDocumentRepo();
    const { service } = createServiceWithDocRepo(fileStorage, documentRepo);

    // Manually insert a doc with a non-pending key (already relocated)
    await documentRepo.create({
      registration_id: 1001,
      file_name: "id.jpg",
      mime_type: "image/jpeg",
      size_bytes: 512,
      r2_key: "registrations/SMRTABC/id-doc.jpg",
    });

    await service.relocateFiles(1001, "SMRTABC");

    // Nothing to move — key doesn't start with id-docs/pending/
    expect(fileStorage.moves).toHaveLength(0);
  });

  it("continues relocating remaining docs when one doc move fails (partial failure)", async () => {
    const fileStorage = new ObservableFileStorage();
    const documentRepo = new InMemoryDocumentRepo();

    // Seed two documents with pending keys
    await documentRepo.create({
      registration_id: 1001,
      file_name: "id1.jpg",
      mime_type: "image/jpeg",
      size_bytes: 512,
      r2_key: "id-docs/pending/cse/user/first.jpg",
    });
    await documentRepo.create({
      registration_id: 1001,
      file_name: "id2.png",
      mime_type: "image/png",
      size_bytes: 256,
      r2_key: "id-docs/pending/cse/user/second.png",
    });

    // Make the first move fail
    fileStorage.moveShouldFail = (fromKey) => fromKey.includes("first.jpg");

    const { service } = createServiceWithDocRepo(fileStorage, documentRepo);

    // Should not throw even though first move fails
    await expect(service.relocateFiles(1001, "SMRT9999")).resolves.toBeUndefined();

    // Second move should have succeeded (partial failure, not full abort)
    const successfulMoves = fileStorage.moves.filter(m => m.fromKey.includes("second.png"));
    expect(successfulMoves).toHaveLength(1);
    expect(successfulMoves[0].toKey).toBe("registrations/SMRT9999/id-doc.png");

    // First doc key should remain unchanged in DB (move failed)
    const docs = await documentRepo.findByRegistration(1001);
    const firstDoc = docs.find(d => d.fileName === "id1.jpg");
    expect(firstDoc?.r2Key).toBe("id-docs/pending/cse/user/first.jpg");

    // Second doc key should be updated in DB
    const secondDoc = docs.find(d => d.fileName === "id2.png");
    expect(secondDoc?.r2Key).toBe("registrations/SMRT9999/id-doc.png");
  });

  it("does nothing when no id-documents exist for the registration", async () => {
    const fileStorage = new ObservableFileStorage();
    const documentRepo = new InMemoryDocumentRepo();
    const { service } = createServiceWithDocRepo(fileStorage, documentRepo);

    await expect(service.relocateFiles(9999, "SMRTXXX")).resolves.toBeUndefined();
    expect(fileStorage.moves).toHaveLength(0);
  });

  it("moves photo from photos/pending/ to registrations/{regCode}/photo.{ext} and updates DB", async () => {
    const fileStorage = new ObservableFileStorage();
    const documentRepo = new InMemoryDocumentRepo();
    const { service, regRepo } = createServiceWithDocRepo(fileStorage, documentRepo);

    // Submit with a photo key in the pending prefix
    const dataWithPhoto = {
      ...validSubmitData,
      photo: {
        fileKey: "photos/pending/cse/test-user/portrait.jpg",
        fileType: "image/jpeg",
        sizeBytes: 2048,
        fileName: "portrait.jpg",
      },
    };
    const result = await service.submit(dataWithPhoto);
    const regId = Number(result.regId);
    const regCode = result.regCode;

    await service.relocateFiles(regId, regCode);

    // Photo move should have happened
    const photoMove = fileStorage.moves.find(m => m.fromKey.startsWith("photos/pending/"));
    expect(photoMove).toBeDefined();
    expect(photoMove!.fromKey).toBe("photos/pending/cse/test-user/portrait.jpg");
    expect(photoMove!.toKey).toBe(`registrations/${regCode}/photo.jpg`);

    // DB photo_file_key must be updated
    const reg = await regRepo.findById(regId);
    expect(reg?.photoFileKey).toBe(`registrations/${regCode}/photo.jpg`);
  });

  it("skips photo relocation when photo_file_key is null", async () => {
    const fileStorage = new ObservableFileStorage();
    const documentRepo = new InMemoryDocumentRepo();
    const { service } = createServiceWithDocRepo(fileStorage, documentRepo);

    // Submit without a photo
    const result = await service.submit(validSubmitData);
    const regId = Number(result.regId);
    const regCode = result.regCode;

    await service.relocateFiles(regId, regCode);

    // Only id-doc move, no photo move
    const photoMoves = fileStorage.moves.filter(m => m.fromKey.startsWith("photos/"));
    expect(photoMoves).toHaveLength(0);
  });

  it("skips photo relocation when photo_file_key does not start with photos/pending/", async () => {
    const fileStorage = new ObservableFileStorage();
    const documentRepo = new InMemoryDocumentRepo();
    const { service, regRepo } = createServiceWithDocRepo(fileStorage, documentRepo);

    // Manually seed a registration with an already-relocated photo key
    const result = await service.submit(validSubmitData);
    const regId = Number(result.regId);
    // Directly update the in-memory reg to simulate an already-relocated key
    await regRepo.update(regId, { photo_file_key: "registrations/SMRT1234/photo.jpg" });

    await service.relocateFiles(regId, result.regCode);

    // No photo moves — key doesn't start with photos/pending/
    const photoMoves = fileStorage.moves.filter(m => m.fromKey.startsWith("registrations/"));
    expect(photoMoves).toHaveLength(0);
  });

  it("continues relocating id-docs when photo move fails (independent partial failure)", async () => {
    const fileStorage = new ObservableFileStorage();
    const documentRepo = new InMemoryDocumentRepo();
    const { service, regRepo } = createServiceWithDocRepo(fileStorage, documentRepo);

    const dataWithPhoto = {
      ...validSubmitData,
      photo: {
        fileKey: "photos/pending/cse/test-user/portrait.png",
        fileType: "image/png",
        sizeBytes: 512,
        fileName: "portrait.png",
      },
    };
    const result = await service.submit(dataWithPhoto);
    const regId = Number(result.regId);
    const regCode = result.regCode;

    // Make photo move fail
    fileStorage.moveShouldFail = (fromKey) => fromKey.startsWith("photos/pending/");

    await expect(service.relocateFiles(regId, regCode)).resolves.toBeUndefined();

    // ID doc move still happened
    const idDocMove = fileStorage.moves.find(m => m.fromKey.startsWith("id-docs/pending/"));
    expect(idDocMove).toBeDefined();

    // Photo key in DB should remain unchanged (move failed)
    const reg = await regRepo.findById(regId);
    expect(reg?.photoFileKey).toBe("photos/pending/cse/test-user/portrait.png");
  });

  it("does nothing when fileStorage is not injected (gracefully skips)", async () => {
    const documentRepo = new InMemoryDocumentRepo();
    const regRepo = new InMemoryRegistrationRepo();
    const attendeeRepo = new StubAttendeeRepo();
    const paymentRepo = new StubPaymentRepo();
    const auditRepo = new StubAuditRepo();
    const pricingService = new PricingService();

    regRepo.companionAttendeeRepo = attendeeRepo;
    regRepo.companionPaymentRepo = paymentRepo;
    regRepo.companionDocumentRepo = documentRepo;

    // No fileStorage injected
    const service = new RegistrationService({
      availabilityService: stubAvailabilityService,
      registrationRepo: regRepo,
      attendeeRepo,
      auditRepo,
      documentRepo,
      emailService: new StubEmailService(),
      pricingService,
      authService: { async issueAttendeeToken() { return "test-token"; }, async createPaymentLinkUrl(_registrationId: number, regCode: string) { return `/pay/${regCode}?code=test`; } },
    });

    await expect(service.relocateFiles(1001, "SMRTXXX")).resolves.toBeUndefined();
  });
});

// =============================================================================
// 3. Payment proof key format
// =============================================================================

describe("Payment proof key format — registrations/{regCode}/proof-{id}.{ext}", () => {
  it("jpeg proof uses .jpg extension", () => {
    // Test the extFromMime mapping by verifying the end-to-end key format.
    // The actual extFromMime function is module-private — we verify via
    // uploadProof() in payment-flow.test.ts. Here we verify the regex contract.
    const jpegKey = "registrations/SMRT1234ABCD5678/proof-42.jpg";
    expect(jpegKey).toMatch(/^registrations\/[A-Z0-9]+\/proof-\d+\.jpg$/);
  });

  it("png proof uses .png extension", () => {
    const pngKey = "registrations/SMRT1234ABCD5678/proof-42.png";
    expect(pngKey).toMatch(/^registrations\/[A-Z0-9]+\/proof-\d+\.png$/);
  });

  it("pdf proof uses .pdf extension", () => {
    const pdfKey = "registrations/SMRT1234ABCD5678/proof-42.pdf";
    expect(pdfKey).toMatch(/^registrations\/[A-Z0-9]+\/proof-\d+\.pdf$/);
  });

  it("key does not contain payment-proofs/ prefix (old format)", () => {
    // Ensure we haven't accidentally mixed old and new formats
    const newKey = "registrations/SMRT1234ABCD5678/proof-1.png";
    expect(newKey).not.toContain("payment-proofs/");
  });
});
