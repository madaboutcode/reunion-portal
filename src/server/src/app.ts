import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestLogger } from "./middleware/request-logger.js";
import { secureHeaders } from "hono/secure-headers";
import { PRICING_DEFAULTS } from "@smriti/shared";
import type { AppEnv } from "./env.js";
import { allowedOrigins, assetOrigins, requireVar } from "./lib/site-config.js";

import { D1RegistrationRepository } from "./repositories/registration.repo.js";
import { D1AttendeeRepository } from "./repositories/attendee.repo.js";
import { D1PaymentRepository } from "./repositories/payment.repo.js";
import { D1AuditRepository } from "./repositories/audit.repo.js";
import { D1DocumentRepository } from "./repositories/document.repo.js";
import { D1RefundRepository } from "./repositories/refund.repo.js";
import { R2FileStorage } from "./repositories/file-storage.js";
import { D1BankTransactionRepository } from "./repositories/bank-transaction.repo.js";
import { D1TshirtRepository } from "./repositories/tshirt.repo.js";
import { D1AdditionalChargeRepository } from "./repositories/additional-charge.repo.js";

import { MockEmailService, MailgunEmailService } from "./infra/email.service.js";
import { PricingService } from "./services/pricing.service.js";
import { RegistrationService } from "./services/registration.service.js";
import { PaymentService } from "./services/payment.service.js";

import { handleError } from "./middleware/error.middleware.js";
import { registrationRoutes } from "./routes/registration.routes.js";
import { paymentRoutes } from "./routes/payment.routes.js";
import { uploadRoutes } from "./routes/upload.routes.js";
import { staffRoutes } from "./routes/staff.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { passRoutes } from "./routes/pass.routes.js";

import { D1ArchivedRepository } from "./repositories/archived.repo.js";
import { ArchiveService } from "./services/archive.service.js";
import { CancellationService } from "./services/cancellation.service.js";
import { EditService } from "./services/edit.service.js";
import { D1UserRepository } from "./repositories/user.repo.js";
import { D1InventoryRepository } from "./repositories/inventory.repo.js";
import { D1SystemAuditRepository } from "./repositories/system-audit.repo.js";
import { AuthService } from "./services/auth.service.js";
import { D1AuthRepository } from "./repositories/auth.repo.js";
import { GoogleSheetsProvider } from "./services/google-sheets.provider.js";
import { DataSourceRegistry } from "./services/datasource.registry.js";
import type { DataSourceProvider } from "./services/datasource.types.js";
import { datasourcesRoutes } from "./routes/datasources.routes.js";
import { CommitteeService } from "./services/committee.service.js";
import { committeeRoutes } from "./routes/committee.routes.js";
import { flagsRoutes } from "./routes/flags.routes.js";
import { featureFlagsRoutes } from "./routes/feature-flags.routes.js";
import { publicRoutes } from "./routes/public.routes.js";
import { accommodationRoutes } from "./routes/accommodation.routes.js";
import { allocationRoutes } from "./routes/allocation.routes.js";
import { AvailabilityService } from "./services/availability.service.js";
import { bankTransactionRoutes } from "./routes/bank-transaction.routes.js";
import { TshirtChargeService } from "./services/tshirt-charge.service.js";
import { D1DeskRepository } from "./repositories/desk.repo.js";
import { RegistrationDeskService } from "./services/registration-desk.service.js";
import { registrationDeskRoutes } from "./routes/registration-desk.routes.js";
import { D1RoomRepository } from "./repositories/room.repo.js";
import { RoomAssignmentService } from "./services/room-assignment.service.js";
import { roomAssignmentRoutes } from "./routes/room-assignment.routes.js";
import { D1FeatureFlagRepository } from "./repositories/feature-flag.repo.js";
import { FeatureFlagService } from "./services/feature-flag.service.js";
import { publicConfigRoutes, adminConfigRoutes } from "./routes/config.routes.js";
import { D1MemoryStoryRepository } from "./repositories/memory-story.repo.js";
import { MemoryStoryService } from "./services/memory-story.service.js";
import { publicMemoryStoryRoutes, authorMemoryStoryRoutes } from "./routes/memory-stories.routes.js";
import { adminMemoryStoryRoutes } from "./routes/admin-memory-stories.routes.js";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath("/api");

  // Fail closed: without APP_BASE_URL the API cannot build links, CORS or CSP, so every
  // request gets a clear 500 instead of running against the wrong site.
  app.use("*", async (c, next) => {
    allowedOrigins(c.env); // throws ConfigError, which handleError turns into the 500
    await next();
  });

  app.use("*", (c, next) => {
    const assets = assetOrigins(c.env);
    return secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:", ...assets],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", ...assets],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
      },
    })(c, next);
  });
  app.use(
    "*",
    cors({
      origin: (origin, c) => (allowedOrigins(c.env).includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
    }),
  );

  app.use("*", requestLogger());
  app.onError(handleError);

  app.use("*", async (c, next) => {
    c.set("requestMeta", {});
    const db = c.env.DB;
    const storage = c.env.STORAGE;

    const registrationRepo = new D1RegistrationRepository(db);
    const attendeeRepo = new D1AttendeeRepository(db);
    const paymentRepo = new D1PaymentRepository(db);
    const auditRepo = new D1AuditRepository(db);
    const documentRepo = new D1DocumentRepository(db);
    const refundRepo = new D1RefundRepository(db);
    const tshirtRepo = new D1TshirtRepository(db);
    const chargeRepo = new D1AdditionalChargeRepository(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- workers-types R2Bucket vs global R2Bucket mismatch
    const fileStorage = new R2FileStorage(storage as any);

    const logLevel = c.env.LOG_LEVEL;
    const appBaseUrl = requireVar(c.env, "APP_BASE_URL");

    const emailService = c.env.MAILGUN_API_KEY && c.env.MAILGUN_DOMAIN
      ? new MailgunEmailService(
          c.env.MAILGUN_API_KEY,
          c.env.MAILGUN_DOMAIN,
          c.env.EMAIL_ALLOWED_DOMAINS ? c.env.EMAIL_ALLOWED_DOMAINS.split(",") : [],
          logLevel,
          appBaseUrl,
          requireVar(c.env, "SENDER_NAME"),
        )
      : new MockEmailService(appBaseUrl);
    const pricingService = new PricingService();
    const userRepo = new D1UserRepository(db);
    const inventoryRepo = new D1InventoryRepository(db);
    const systemAuditRepo = new D1SystemAuditRepository(db);

    // Links in emails (login, payment) point at the web app, never at the API.
    const baseUrl = appBaseUrl;

    const authService = new AuthService({
      userRepo,
      registrationRepo,
      authRepo: new D1AuthRepository(db),
      emailService,
      systemAuditRepo,
      jwtSecret: c.env.JWT_SECRET,
      baseUrl,
    });
    c.set("authService", authService);
    c.set("emailService", emailService);

    const availabilityService = new AvailabilityService({ attendeeRepo, inventoryRepo });
    c.set("availabilityService", availabilityService);

    c.set("registrationService", new RegistrationService({
      registrationRepo,
      attendeeRepo,
      auditRepo,
      documentRepo,
      emailService,
      fileStorage,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- workers-types R2Bucket mismatch
      publicThumbsBucket: c.env.PUBLIC_THUMBS as any,
      imagesBinding: c.env.IMAGES,
      tshirtRepo,
      pricingService,
      availabilityService,
      authService,
      logLevel,
    }));

    c.set("paymentService", new PaymentService({
      db,
      registrationRepo,
      paymentRepo,
      attendeeRepo,
      auditRepo,
      fileStorage,
      emailService,
      appBaseUrl,
      authService,
      refundRepo,
      logLevel,
    }));

    c.set("userRepo", userRepo);
    c.set("systemAuditRepo", systemAuditRepo);

    const archivedRepo = new D1ArchivedRepository(db);
    c.set("archivedRepo", archivedRepo);

    c.set("archiveService", new ArchiveService({
      db,
      registrationRepo,
      paymentRepo,
      attendeeRepo,
      auditRepo,
      documentRepo,
      refundRepo,
      tshirtRepo,
      chargeRepo,
    }));

    c.set("cancellationService", new CancellationService({
      db,
      registrationRepo,
      paymentRepo,
      attendeeRepo,
      auditRepo,
      documentRepo,
      refundRepo,
      tshirtRepo,
      chargeRepo,
    }));

    c.set("editService", new EditService({
      db,
      registrationRepo,
      paymentRepo,
      attendeeRepo,
      auditRepo,
      emailService,
      authService,
      availabilityService,
      tshirtRepo,
      chargeRepo,
      logLevel,
    }));

    const tshirtChargeService = new TshirtChargeService({
      registrationRepo,
      attendeeRepo,
      paymentRepo,
      auditRepo,
      tshirtRepo,
      chargeRepo,
    });
    c.set("tshirtChargeService", tshirtChargeService);

    const roomRepo = new D1RoomRepository(db);
    c.set("roomRepo", roomRepo);
    c.set("roomAssignmentService", new RoomAssignmentService({ roomRepo, systemAuditRepo }));

    const flagRepo = new D1FeatureFlagRepository(db);
    const featureFlagService = new FeatureFlagService({ flagRepo, systemAuditRepo });
    c.set("featureFlagService", featureFlagService);

    const memoryStoryRepo = new D1MemoryStoryRepository(db);
    c.set("memoryStoryService", new MemoryStoryService({
      storyRepo: memoryStoryRepo,
      registrationRepo,
      featureFlagService,
      emailService,
      systemAuditRepo,
      publicThumbsUrl: c.env.PUBLIC_THUMBS_URL ?? "/api/public/photos",
    }));

    const deskRepo = new D1DeskRepository(db);
    c.set("deskRepo", deskRepo);
    c.set("deskService", new RegistrationDeskService({
      deskRepo,
      registrationRepo,
      attendeeRepo,
      paymentRepo,
      roomRepo,
      pricingService,
      auditRepo,
      tshirtChargeService,
      emailService,
      refundRepo,
      appBaseUrl,
      authService,
      logLevel,
    }));

    c.set("registrationRepo", registrationRepo);
    c.set("attendeeRepo", attendeeRepo);
    c.set("paymentRepo", paymentRepo);
    c.set("auditRepo", auditRepo);
    c.set("documentRepo", documentRepo);
    c.set("fileStorage", fileStorage);
    c.set("refundRepo", refundRepo);
    c.set("inventoryRepo", inventoryRepo);
    c.set("bankTransactionRepo", new D1BankTransactionRepository(db));
    c.set("tshirtRepo", tshirtRepo);
    c.set("chargeRepo", chargeRepo);

    // Data source registry — only wired when Google Sheets credentials are present.
    const sources: Record<string, DataSourceProvider> = {};
    if (c.env.GOOGLE_SA_KEY && c.env.GOOGLE_SPREADSHEET_ID) {
      sources["predictions"] = new GoogleSheetsProvider(
        c.env.GOOGLE_SA_KEY,
        c.env.GOOGLE_SPREADSHEET_ID,
      );
    }
    if (Object.keys(sources).length > 0) {
      c.set("dataSourceRegistry", new DataSourceRegistry(sources));
    }

    // Committee todo — separate workbook, write-capable SA (Editor on that sheet only).
    if (c.env.GOOGLE_SA_KEY && c.env.GOOGLE_COMMITTEE_SHEET_ID) {
      c.set("committeeService", new CommitteeService(
        c.env.GOOGLE_SA_KEY,
        c.env.GOOGLE_COMMITTEE_SHEET_ID,
        c.env.PUBLIC_THUMBS_URL ?? "/api/public/photos",
      ));
    }

    await next();
  });

  app.route("/datasources", datasourcesRoutes);
  app.route("/committee", committeeRoutes);
  app.route("/flags", flagsRoutes);
  app.route("/feature-flags", featureFlagsRoutes);
  app.route("/accommodation", accommodationRoutes);
  app.route("/public", publicRoutes);
  app.route("/auth", authRoutes);
  app.route("/staff/allocation", allocationRoutes);
  app.route("/staff/allocation", roomAssignmentRoutes);
  app.route("/staff", staffRoutes);
  app.route("/staff/bank-transactions", bankTransactionRoutes);
  app.route("/staff/desk", registrationDeskRoutes);
  app.route("/admin", adminRoutes);
  app.route("/admin/config", adminConfigRoutes);
  app.route("/admin/memory-stories", adminMemoryStoryRoutes);
  app.route("/config", publicConfigRoutes);
  app.route("/public", publicMemoryStoryRoutes);
  app.route("/memory-stories", authorMemoryStoryRoutes);
  app.route("/", registrationRoutes);
  app.route("/", paymentRoutes);
  app.route("/", uploadRoutes);
  app.route("/", passRoutes);

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/config/pricing", (c) => c.json(PRICING_DEFAULTS));

  return app;
}
