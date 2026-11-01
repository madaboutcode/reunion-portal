/**
 * CONTRACT: Cloudflare Workers environment bindings.
 *
 * GUARANTEES:
 *   - DB is always a D1Database — available via c.env.DB in every route handler.
 *   - STORAGE is always an R2Bucket — available via c.env.STORAGE in every route handler.
 *   - JWT_SECRET is always a non-empty string — set via `wrangler secret put JWT_SECRET`.
 *
 * EXPECTS:
 *   - wrangler.toml declares [[d1_databases]] with binding = "DB".
 *   - wrangler.toml declares [[r2_buckets]] with binding = "STORAGE".
 *   - JWT_SECRET is configured as a Workers secret (never hardcoded).
 *
 * FAILURE BEHAVIOR:
 *   - If any binding is absent at runtime, wrangler dev will fail to start with a binding error.
 *   - If JWT_SECRET is absent, JWT sign/verify operations will throw at call time.
 */
export interface ImagesTransformable {
  transform(options: {
    width?: number; height?: number;
    fit?: string; gravity?: string;
    blur?: number; rotate?: number;
  }): ImagesTransformable;
  output(options: { format: string; quality?: number }): Promise<ImagesOutputHandle>;
}

export interface ImagesOutputHandle {
  response(): Response;
}

export interface ImagesBinding {
  input(stream: ReadableStream): ImagesTransformable;
}

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  PUBLIC_THUMBS?: R2Bucket;
  IMAGES?: ImagesBinding;
  JWT_SECRET: string;
  /**
   * Optional environment identifier. Set to "development" in .dev.vars for
   * local wrangler dev. Not set in production — absence means production.
   * Used to gate dev-only routes (e.g. /api/debug/*).
   */
  ENVIRONMENT?: string;
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  EMAIL_ALLOWED_DOMAINS?: string;
  RATE_LIMIT_UPLOAD_MAX?: string;
  RATE_LIMIT_UPLOAD_WINDOW_MS?: string;
  RATE_LIMIT_AUTH_MAX?: string;
  RATE_LIMIT_AUTH_WINDOW_MS?: string;
  RATE_LIMIT_MUTATION_MAX?: string;
  RATE_LIMIT_MUTATION_WINDOW_MS?: string;
  RATE_LIMIT_QUERY_MAX?: string;
  RATE_LIMIT_QUERY_WINDOW_MS?: string;
  RATE_LIMIT_PHOTO_MAX?: string;
  RATE_LIMIT_PHOTO_WINDOW_MS?: string;
  LOG_LEVEL?: string;
  /**
   * Public URL of the web app (no trailing slash). REQUIRED: links in emails, QR codes
   * and the CORS allow-list are built from it. A request without it gets a 500.
   * Deployed: scripts/deploy.sh passes it from site.config.json. Local: .dev.vars.
   */
  APP_BASE_URL?: string;
  /** Sender display name for Mailgun email. Required when Mailgun is configured. */
  SENDER_NAME?: string;
  PUBLIC_THUMBS_URL?: string;
  PUBLIC_PORTRAITS_URL?: string;
  /**
   * Base64-encoded Google service account JSON key.
   * Set via `wrangler secret put GOOGLE_SA_KEY` (production).
   * For local dev, add to src/server/.dev.vars:
   *   GOOGLE_SA_KEY=$(base64 < service-account.json)
   */
  GOOGLE_SA_KEY?: string;
  /**
   * Google Sheets spreadsheet ID (plain string, not base64).
   * Set via `wrangler secret put GOOGLE_SPREADSHEET_ID` (production).
   */
  GOOGLE_SPREADSHEET_ID?: string;
  /**
   * Committee-todo workbook ID (plain string). Same service account as
   * GOOGLE_SA_KEY, but the SA must be shared as EDITOR on this workbook only.
   * Without it, /api/committee routes return 404.
   * Set via `wrangler secret put GOOGLE_COMMITTEE_SHEET_ID` (production).
   */
  GOOGLE_COMMITTEE_SHEET_ID?: string;
}

export type AuthContext =
  | { role: 'attendee'; registrationId: number }
  | { role: 'staff' | 'admin'; userId: number; email: string };

export interface RequestMeta {
  reqType?: string;
  email?: string;
  regCode?: string;
  regId?: number;
  userId?: number;
  [key: string]: unknown;
}

export interface AppVariables {
  auth: AuthContext;
  requestMeta: RequestMeta;
  registrationService: import('./services/registration.service.js').RegistrationService;
  paymentService: import('./services/payment.service.js').PaymentService;
  editService: import('./services/edit.service.js').EditService;
  authService: import('./services/auth.service.js').AuthService;
  emailService: import('./repositories/interfaces.js').IEmailService;
  userRepo: import('./repositories/interfaces.js').IUserRepository;
  systemAuditRepo: import('./repositories/interfaces.js').ISystemAuditRepository;
  archiveService: import('./services/archive.service.js').ArchiveService;
  cancellationService: import('./services/cancellation.service.js').CancellationService;
  // Direct repo/storage access for staff routes
  registrationRepo: import('./repositories/interfaces.js').IRegistrationRepository;
  attendeeRepo: import('./repositories/interfaces.js').IAttendeeRepository;
  paymentRepo: import('./repositories/interfaces.js').IPaymentRepository;
  auditRepo: import('./repositories/interfaces.js').IAuditRepository;
  documentRepo: import('./repositories/interfaces.js').IDocumentRepository;
  refundRepo: import('./repositories/interfaces.js').IRefundRepository;
  fileStorage: import('./repositories/interfaces.js').IFileStorage;
  archivedRepo: import('./repositories/archived.repo.js').IArchivedRepository;
  inventoryRepo: import('./repositories/interfaces.js').IInventoryRepository;
  availabilityService: import('./services/availability.service.js').AvailabilityService;
  dataSourceRegistry?: import('./services/datasource.registry.js').DataSourceRegistry;
  committeeService?: import('./services/committee.service.js').CommitteeService;
  bankTransactionRepo: import('./repositories/interfaces.js').IBankTransactionRepository;
  tshirtRepo: import('./repositories/interfaces.js').ITshirtRepository;
  chargeRepo: import('./repositories/interfaces.js').IAdditionalChargeRepository;
  tshirtChargeService: import('./services/tshirt-charge.service.js').TshirtChargeService;
  deskRepo: import('./repositories/interfaces.js').IDeskRepository;
  deskService: import('./services/registration-desk.service.js').RegistrationDeskService;
  roomRepo: import('./repositories/interfaces.js').IRoomRepository;
  roomAssignmentService: import('./services/room-assignment.service.js').RoomAssignmentService;
  featureFlagService: import('./services/feature-flag.service.js').FeatureFlagService;
  memoryStoryService: import('./services/memory-story.service.js').MemoryStoryService;
}

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
