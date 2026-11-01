/**
 * MemoryStoryService — exercises the error-code/status mapping against
 * interfaces/memory-stories.ispec.md (R2.3, R2.4, R3.4/R3.5, R4.2, R4.3,
 * R5.2, R8.3, R8.5) and the identity-resolution + hide-notification logic,
 * against lightweight in-memory fakes (no D1 — that's memory-story.repo.test.ts).
 */

import { describe, it, expect, vi } from "vitest";
import { MemoryStoryService } from "../services/memory-story.service.js";
import type { IMemoryStoryRepository, MemoryStoryVisibilityTransition } from "../repositories/interfaces.js";
import type { IRegistrationRepository, IEmailService, ISystemAuditRepository } from "../repositories/interfaces.js";
import type { MemoryStoryRow, MemoryStoryVisibleRow } from "../domain/memory-story-types.js";
import type { Registration } from "../domain/types.js";
import type { AuthContext } from "../env.js";
import type { FeatureFlagSnapshot } from "../services/feature-flag.service.js";

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1,
    regCode: "SMRTTEST0000001",
    status: "confirmed",
    fullName: "Anjali Nair",
    branch: "Computer Science & Engineering",
    email: "anjali@example.com",
    whatsapp: "+919800000000",
    mobileAlternate: null,
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    gender: "female",
    tshirtSize: "M",
    alumniMeal: "veg",
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
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeStoryRow(overrides: Partial<MemoryStoryRow> = {}): MemoryStoryRow {
  return {
    id: 42,
    registration_id: 1,
    author_name: "Anjali Nair",
    author_branch: "Computer Science & Engineering",
    text: "x".repeat(60),
    visibility: "visible",
    published_at: 1000,
    updated_at: 1000,
    hidden_at: null,
    hidden_by_user_id: null,
    moderation_comment: null,
    ...overrides,
  };
}

function makeFlagSnapshot(overrides: Partial<Record<string, boolean>> = {}): { resolve(): Promise<FeatureFlagSnapshot> } {
  const values: Record<string, boolean> = {
    memories_show_stories: true,
    memory_stories_accept_submissions: true,
    ...overrides,
  };
  const snapshot: FeatureFlagSnapshot = {
    isEnabled: (key: string) => values[key] ?? false,
    publicValues: () => ({}) as never,
    adminValues: () => [],
  };
  return { resolve: async () => snapshot };
}

function makeStoryRepo(overrides: Partial<IMemoryStoryRepository> = {}): IMemoryStoryRepository {
  return {
    listVisible: async (): Promise<MemoryStoryVisibleRow[]> => [],
    listAllForAdmin: async (): Promise<MemoryStoryRow[]> => [],
    findByRegistrationId: async () => [],
    countByRegistrationId: async () => 0,
    create: async () => makeStoryRow(),
    updateOwned: async () => makeStoryRow(),
    deleteOwned: async () => true,
    setVisibility: async () => ({ changed: false, row: null }),
    ...overrides,
  };
}

function makeRegistrationRepo(overrides: Partial<IRegistrationRepository> = {}): IRegistrationRepository {
  return {
    ...overrides,
  } as unknown as IRegistrationRepository;
}

function makeEmailService(overrides: Partial<IEmailService> = {}): IEmailService {
  return {
    sendConfirmation: async () => {},
    sendMagicLink: async () => {},
    sendPaymentConfirmed: async () => {},
    sendPaymentRejected: async () => {},
    sendStaffWelcome: async () => {},
    sendPaymentLink: async () => {},
    sendRevisedPayment: async () => {},
    sendAdditionalPayment: async () => {},
    sendStoryHidden: async () => {},
    ...overrides,
  };
}

function makeSystemAuditRepo(overrides: Partial<ISystemAuditRepository> = {}): ISystemAuditRepository {
  return {
    append: async () => {},
    ...overrides,
  };
}

const ATTENDEE_AUTH: AuthContext = { role: "attendee", registrationId: 1 };
const ADMIN_AUTH = { role: "admin" as const, userId: 9, email: "admin@example.com" };

describe("MemoryStoryService.listPublic", () => {
  it("throws 404 FEATURE_UNAVAILABLE when memories_show_stories is off", async () => {
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo(),
      registrationRepo: makeRegistrationRepo(),
      featureFlagService: makeFlagSnapshot({ memories_show_stories: false }),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "https://thumbs.example.test",
    });

    await expect(service.listPublic()).rejects.toMatchObject({
      statusCode: 404,
      code: "FEATURE_UNAVAILABLE",
    });
  });

  it("throws 503 STORIES_UNAVAILABLE when the story read fails", async () => {
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo({
        listVisible: async () => {
          throw new Error("D1 outage");
        },
      }),
      registrationRepo: makeRegistrationRepo(),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "https://thumbs.example.test",
    });

    await expect(service.listPublic()).rejects.toMatchObject({
      statusCode: 503,
      code: "STORIES_UNAVAILABLE",
    });
  });

  it("builds photoUrl only for rows with has_photo=1", async () => {
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo({
        listVisible: async () => [
          { ...makeStoryRow({ id: 1, registration_id: 10 }), has_photo: 1 },
          { ...makeStoryRow({ id: 2, registration_id: 20 }), has_photo: 0 },
        ],
      }),
      registrationRepo: makeRegistrationRepo(),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "https://thumbs.example.test",
    });

    const { stories, count } = await service.listPublic();
    expect(count).toBe(2);
    expect(stories[0]?.photoUrl).toBe("https://thumbs.example.test/10.jpg");
    expect(stories[1]?.photoUrl).toBeNull();
  });
});

describe("MemoryStoryService identity resolution", () => {
  it("throws 403 REGISTRATION_REQUIRED for an attendee whose registration no longer exists", async () => {
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo(),
      registrationRepo: makeRegistrationRepo({ findById: async () => null }),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "",
    });

    await expect(service.getAuthorState(ATTENDEE_AUTH)).rejects.toMatchObject({
      statusCode: 403,
      code: "REGISTRATION_REQUIRED",
    });
  });

  it("resolves a staff/admin JWT to its newest matching registration by email", async () => {
    const older = makeRegistration({ id: 5, fullName: "Older Reg" });
    const newer = makeRegistration({ id: 8, fullName: "Newer Reg" });
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo(),
      registrationRepo: makeRegistrationRepo({ findByEmail: async () => [older, newer] }),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "",
    });

    const result = await service.getAuthorState({ role: "staff", userId: 1, email: "staff@example.com" });
    expect(result.author.name).toBe("Newer Reg");
  });
});

describe("MemoryStoryService.create", () => {
  it("throws 409 SUBMISSIONS_DISABLED when the submissions flag is off", async () => {
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo(),
      registrationRepo: makeRegistrationRepo({ findById: async () => makeRegistration() }),
      featureFlagService: makeFlagSnapshot({ memory_stories_accept_submissions: false }),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "",
    });

    await expect(service.create(ATTENDEE_AUTH, "x".repeat(60))).rejects.toMatchObject({
      statusCode: 409,
      code: "SUBMISSIONS_DISABLED",
    });
  });

  it("throws 409 MAX_STORIES_REACHED when the person already has STORIES_PER_PERSON_MAX stories", async () => {
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo({
        countByRegistrationId: async () => 3,
      }),
      registrationRepo: makeRegistrationRepo({ findById: async () => makeRegistration() }),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "",
    });

    await expect(service.create(ATTENDEE_AUTH, "x".repeat(60))).rejects.toMatchObject({
      statusCode: 409,
      code: "MAX_STORIES_REACHED",
    });
  });
});

describe("MemoryStoryService.updateMine", () => {
  it("throws 404 STORY_NOT_FOUND when the registration has no story", async () => {
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo({ updateOwned: async () => null }),
      registrationRepo: makeRegistrationRepo({ findById: async () => makeRegistration() }),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "",
    });

    await expect(service.updateMine(ATTENDEE_AUTH, 42, "x".repeat(60))).rejects.toMatchObject({
      statusCode: 404,
      code: "STORY_NOT_FOUND",
    });
  });
});

describe("MemoryStoryService.changeVisibility", () => {
  it("hide success + email success returns notification: 'sent'", async () => {
    let sentTo: string | undefined;
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo({
        setVisibility: async (_id, transition: MemoryStoryVisibilityTransition) => ({
          changed: true,
          row: makeStoryRow({ visibility: "hidden", hidden_at: transition.now }),
        }),
      }),
      registrationRepo: makeRegistrationRepo({ findById: async () => makeRegistration({ email: "author@example.com" }) }),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService({
        sendStoryHidden: async (to) => {
          sentTo = to;
        },
      }),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "",
    });

    const result = await service.changeVisibility(42, { visibility: "hidden", comment: "z".repeat(15) }, ADMIN_AUTH);
    expect(result).toEqual({ story: { id: 42, visibility: "hidden" }, notification: "sent" });
    expect(sentTo).toBe("author@example.com");
  });

  it("hide success + email failure returns notification: 'failed' and writes a failure audit entry, without reverting visibility", async () => {
    const auditAppend = vi.fn(async () => {});
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo({
        setVisibility: async () => ({ changed: true, row: makeStoryRow({ visibility: "hidden" }) }),
      }),
      registrationRepo: makeRegistrationRepo({ findById: async () => makeRegistration() }),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService({
        sendStoryHidden: async () => {
          throw new Error("Mailgun down");
        },
      }),
      systemAuditRepo: { append: auditAppend },
      publicThumbsUrl: "",
    });

    const result = await service.changeVisibility(42, { visibility: "hidden", comment: "z".repeat(15) }, ADMIN_AUTH);
    expect(result).toEqual({ story: { id: 42, visibility: "hidden" }, notification: "failed" });
    expect(auditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: "memory_story_hide_notification_failed", targetId: 42 }),
    );
  });

  it("idempotent repeat (changed:false) never sends email and returns notification: 'not_requested'", async () => {
    let emailCalled = false;
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo({
        setVisibility: async () => ({ changed: false, row: makeStoryRow({ visibility: "hidden" }) }),
      }),
      registrationRepo: makeRegistrationRepo(),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService({
        sendStoryHidden: async () => {
          emailCalled = true;
        },
      }),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "",
    });

    const result = await service.changeVisibility(42, { visibility: "hidden", comment: "z".repeat(15) }, ADMIN_AUTH);
    expect(result.notification).toBe("not_requested");
    expect(emailCalled).toBe(false);
  });

  it("unhide success returns notification: 'not_requested'", async () => {
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo({
        setVisibility: async () => ({ changed: true, row: makeStoryRow({ visibility: "visible" }) }),
      }),
      registrationRepo: makeRegistrationRepo(),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "",
    });

    const result = await service.changeVisibility(42, { visibility: "visible" }, ADMIN_AUTH);
    expect(result).toEqual({ story: { id: 42, visibility: "visible" }, notification: "not_requested" });
  });

  it("throws 404 STORY_NOT_FOUND for an unknown story id", async () => {
    const service = new MemoryStoryService({
      storyRepo: makeStoryRepo({ setVisibility: async () => ({ changed: false, row: null }) }),
      registrationRepo: makeRegistrationRepo(),
      featureFlagService: makeFlagSnapshot(),
      emailService: makeEmailService(),
      systemAuditRepo: makeSystemAuditRepo(),
      publicThumbsUrl: "",
    });

    await expect(service.changeVisibility(999, { visibility: "visible" }, ADMIN_AUTH)).rejects.toMatchObject({
      statusCode: 404,
      code: "STORY_NOT_FOUND",
    });
  });
});
