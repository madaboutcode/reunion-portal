/**
 * CONTRACT
 *
 * GUARANTEE: SUBMIT_VALIDATES — submit() runs registrationSchema validation
 *   before any DB access. Validation failures throw ValidationError (400).
 *
 * GUARANTEE: SUBMIT_REJECTS_DUPLICATE_EMAIL — submit() checks for existing
 *   registrations with the same email before any writes. Duplicates throw
 *   AppError with status 409.
 *
 * GUARANTEE: SUBMIT_REJECTS_ZERO_TOTAL — submit() rejects any submission where
 *   the server-computed pricing total is ≤ 0. Throws ValidationError (400).
 *   This is enforced before any DB writes.
 *
 * GUARANTEE: SUBMIT_REJECTS_UNAVAILABLE_ACCOMMODATION — submit() checks room
 *   availability for the selected accommodation type/check-in date before any
 *   writes. If unavailable, throws AppError with status 409.
 *
 * GUARANTEE: SUBMIT_ATOMIC — the registration, attendees, document (if
 *   provided), and payment record are persisted via a single
 *   createWithRelations() call. If any part of the persistence fails, the
 *   whole submission fails with a 500. No partial state is committed.
 *
 * GUARANTEE: SUBMIT_PAYMENT_ALWAYS — a payment record with
 *   status: "payment_pending" is always created on success. There is no
 *   conditional on payment creation — the total > 0 gate ensures every
 *   successful submission has a positive total.
 *
 * GUARANTEE: SUBMIT_PAYMENT_URL_ALWAYS_SET — the paymentUrl in the response
 *   is always non-empty ("/pay/:regCode"). Zero-total submissions are rejected
 *   before any writes, so a successful response always has a valid payment URL.
 *
 * GUARANTEE: SUBMIT_JWT — submit() issues a signed attendee JWT via
 *   authService.issueAttendeeToken() after a successful write. The token
 *   is returned in the response.
 *
 * GUARANTEE: SUBMIT_AUDIT_NON_FATAL — audit logging is wrapped in try/catch.
 *   Failure is logged but not thrown. A failed audit does not roll back the
 *   registration.
 *
 * GUARANTEE: SUBMIT_EMAIL_FIRE_AND_FORGET — confirmation email is sent async
 *   but not awaited for the response. Email failures are logged and swallowed.
 *
 * GUARANTEE: RELOCATE_BEST_EFFORT — relocateFiles() moves ID document files
 *   from id-docs/pending/ to registrations/{regCode}/id-doc.{ext} in R2, then
 *   updates the corresponding id_documents.r2_key in D1. It also relocates the
 *   photo from photos/pending/ to registrations/{regCode}/photo.{ext} in R2 and
 *   updates photo_file_key on the registrations row. Each file is moved
 *   independently — if one fails, others still proceed. Failures are logged but
 *   not thrown. The original key continues to work if the move fails.
 *
 * EXPECTS: registrationRepo, auditRepo, emailService, pricingService, and
 *   authService are fully initialised and bound to the current request's D1
 *   and environment bindings before submit() is called.
 *
 * FAILURE BEHAVIOR: Any unhandled error from createWithRelations() propagates
 *   up to the route handler which maps it to a 500 response.
 */

import type { PricingBreakup, SubmitRegistrationRequest, SubmitRegistrationResponse, RegistrationResponse } from '@smriti/shared';
import { registrationSchema, sanitizeRegistration } from '@smriti/shared';
import type { IRegistrationRepository, IAttendeeRepository, IAuditRepository, IDocumentRepository, IEmailService, IFileStorage, ITshirtRepository } from '../repositories/interfaces.js';
import type { Registration, Attendee, NewAttendee } from '../domain/types.js';
import type { ImagesBinding } from '../env.js';
import type { RegistrationInsertSet } from '../domain/registration-insert-set.js';
import { generateRegCode } from '../domain/reg-id.js';
import { createSnapshot } from '../domain/audit.js';
import { buildInsertSet } from '../domain/registration-insert-set.js';
import { mapToResponse } from '../domain/registration-mapper.js';
import { PricingService } from './pricing.service.js';
import { AvailabilityService } from './availability.service.js';
import { ValidationError, NotFoundError, AppError } from './errors.js';
import { createLogger, parseLogLevel, type Logger } from '../infra/logger.js';
import { PhotoThumbnailService, PUBLIC_THUMB_CACHE_CONTROL } from './photo-thumbnail.service.js';

export class RegistrationService {
  private registrationRepo: IRegistrationRepository;
  private attendeeRepo: IAttendeeRepository;
  private auditRepo: IAuditRepository;
  private documentRepo: IDocumentRepository;
  private emailService: IEmailService;
  private fileStorage: IFileStorage | null;
  private publicThumbsBucket: R2Bucket | null;
  private imagesBinding: ImagesBinding | null;
  private tshirtRepo: ITshirtRepository | null;
  private pricingService: PricingService;
  private availabilityService: AvailabilityService;
  private photoThumbnailService: PhotoThumbnailService;
  private authService: {
    issueAttendeeToken(registrationId: number, status: string): Promise<string>;
    createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string>;
  };
  private log: Logger;

  constructor(deps: {
    registrationRepo: IRegistrationRepository;
    attendeeRepo: IAttendeeRepository;
    auditRepo: IAuditRepository;
    documentRepo: IDocumentRepository;
    emailService: IEmailService;
    fileStorage?: IFileStorage;
    publicThumbsBucket?: R2Bucket;
    imagesBinding?: ImagesBinding;
    tshirtRepo?: ITshirtRepository;
    pricingService: PricingService;
    availabilityService: AvailabilityService;
    authService: {
      issueAttendeeToken(registrationId: number, status: string): Promise<string>;
      createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string>;
    };
    logLevel?: string;
  }) {
    this.registrationRepo = deps.registrationRepo;
    this.attendeeRepo = deps.attendeeRepo;
    this.auditRepo = deps.auditRepo;
    this.documentRepo = deps.documentRepo;
    this.emailService = deps.emailService;
    this.fileStorage = deps.fileStorage ?? null;
    this.publicThumbsBucket = deps.publicThumbsBucket ?? null;
    this.imagesBinding = deps.imagesBinding ?? null;
    this.tshirtRepo = deps.tshirtRepo ?? null;
    this.pricingService = deps.pricingService;
    this.availabilityService = deps.availabilityService;
    this.authService = deps.authService;
    this.log = createLogger('registration', parseLogLevel(deps.logLevel));
    this.photoThumbnailService = new PhotoThumbnailService({
      registrationRepo: deps.registrationRepo,
      fileStorage: deps.fileStorage,
      imagesBinding: deps.imagesBinding,
      publicThumbsBucket: deps.publicThumbsBucket,
      logLevel: deps.logLevel,
    });
  }

  async submit(data: SubmitRegistrationRequest): Promise<SubmitRegistrationResponse> {
    const errors = this.validateSubmission(data);
    if (Object.keys(errors).length > 0) {
      throw new ValidationError(errors);
    }

    const registration = sanitizeRegistration(data);

    const existing = await this.registrationRepo.findByEmail(registration.contact.email);
    if (existing.length > 0) {
      throw new AppError('A registration with this email already exists', 409);
    }

    const regCode = generateRegCode();
    const pricingBreakup = this.pricingService.computePricing(registration);

    if (pricingBreakup.total <= 0) {
      throw new ValidationError({ total: 'Registration requires a payable amount' });
    }

    const accomType = registration.accommodation?.type;
    const checkIn = registration.accommodation?.checkIn;
    if (accomType && checkIn) {
      const available = await this.availabilityService.isAccommodationAvailable(accomType, checkIn);
      if (!available) {
        throw new AppError('Selected accommodation is no longer available', 409, 'ACCOMMODATION_UNAVAILABLE');
      }
    }

    const insertSet = buildInsertSet(registration, regCode, pricingBreakup,
      (age) => this.pricingService.isChildChargeable(age));

    const { id } = await this.registrationRepo.createWithRelations(insertSet);

    // Create the included tshirts row for non-donation-only registrations (R17.6)
    const tshirtSize = registration.attendance.tshirtSize;
    if (this.tshirtRepo && tshirtSize && registration.attendance.intent !== 'donation_only') {
      try {
        await this.tshirtRepo.create({
          registrationId: id,
          gender: registration.contact.gender ?? null,
          size: tshirtSize,
          isIncluded: true,
        });
      } catch (err) {
        this.log.error('Failed to create included tshirt row', { registrationId: id, error: String(err) });
      }
    }

    const token = await this.authService.issueAttendeeToken(id, 'pending');

    // Audit — failure logged, not thrown
    try {
      const snapshot = createSnapshot(
        buildSnapshotRegistration(id, regCode, insertSet, pricingBreakup),
        insertSet.attendees.map((a, i) => buildSnapshotAttendee(i + 1, id, a)),
      );
      await this.auditRepo.append({
        registration_id: id,
        action: 'created',
        actor: registration.contact.email,
        changes: null,
        snapshot,
      });
    } catch (err) {
      this.log.error('Audit entry failed', { registrationId: id, error: String(err) });
    }

    // Email — fire and forget (not awaited, response returns immediately)
    // Payment URL generation is wrapped in the same catch so a token creation
    // failure never fails the registration.
    this.log.info('Sending confirmation email', { to: registration.contact.email, regCode });
    this.authService.createPaymentLinkUrl(id, regCode).then(
      (paymentUrl) => this.emailService.sendConfirmation(registration.contact.email, {
        regId: String(id),
        regCode,
        fullName: registration.contact.fullName,
        totalAmount: pricingBreakup.total,
        attendanceIntent: registration.attendance.intent,
        participationType: registration.attendance.participationType,
        alumniMeal: registration.attendance.alumniMeal ?? 'none',
        tshirtSize: registration.attendance.tshirtSize ?? null,
        spouseName: registration.attendees.spouse?.name ?? null,
        childCount: registration.attendees.children.length,
        guestCount: registration.attendees.guests.length,
        accommodation: registration.accommodation?.type ?? 'none',
        checkIn: registration.accommodation?.checkIn ?? null,
        checkOut: registration.accommodation?.checkOut ?? null,
        extraBed: registration.accommodation?.extraBed ?? false,
        pricingBreakup,
        paymentUrl,
      }),
    ).then(
      () => this.log.info('Confirmation email sent', { to: registration.contact.email }),
      (err) => this.log.error('Confirmation email failed', { to: registration.contact.email, error: String(err) }),
    );

    return {
      regId: String(id),
      regCode,
      token,
      status: 'pending',
      pricingBreakup,
      paymentUrl: '/pay/' + regCode,
    };
  }

  /**
   * Relocates uploaded files from their pending staging prefix to the canonical
   * registrations/{regCode}/ prefix in R2, then updates the corresponding DB
   * keys.
   *
   * - ID documents: moves id-docs/pending/... to registrations/{regCode}/id-doc.{ext}
   *   and updates id_documents.r2_key
   * - Photo: moves photos/pending/... to registrations/{regCode}/photo.{ext}
   *   and updates registrations.photo_file_key
   *
   * This is intended to be called via waitUntil() after a successful submit —
   * the registration response returns immediately while this runs in the
   * background. If any move fails, the original key is preserved and still
   * works. Errors are logged and do not propagate.
   */
  async relocateFiles(regId: number, regCode: string): Promise<void> {
    if (!this.fileStorage) {
      this.log.warn('relocateFiles called but fileStorage not injected — skipping');
      return;
    }

    // --- ID documents ---
    const docs = await this.documentRepo.findByRegistration(regId);

    for (const doc of docs) {
      if (!doc.r2Key.startsWith('id-docs/pending/')) continue;

      const ext = doc.r2Key.split('.').pop() ?? 'bin';
      const newKey = `registrations/${regCode}/id-doc.${ext}`;

      try {
        await this.fileStorage.move(doc.r2Key, newKey);
        await this.documentRepo.updateR2Key(doc.id, newKey);
        this.log.info(`Relocated id-doc: ${doc.r2Key} → ${newKey}`);
      } catch (err) {
        this.log.warn(`File relocation failed for id_documents id=${doc.id}: ${doc.r2Key} → ${newKey}`, { error: String(err) });
      }
    }

    // --- Photo ---
    let photoKey: string | null = null;
    const reg = await this.registrationRepo.findById(regId);
    if (reg?.photoFileKey?.startsWith('photos/pending/')) {
      const ext = reg.photoFileKey.split('.').pop() ?? 'bin';
      const newKey = `registrations/${regCode}/photo.${ext}`;

      try {
        await this.fileStorage.move(reg.photoFileKey, newKey);
        await this.registrationRepo.update(regId, { photo_file_key: newKey });
        this.log.info(`Relocated photo: ${reg.photoFileKey} → ${newKey}`);
        photoKey = newKey;
      } catch (err) {
        this.log.warn(`File relocation failed for photo reg_id=${regId}: ${reg.photoFileKey} → ${newKey}`, { error: String(err) });
        photoKey = reg.photoFileKey;
      }
    } else if (reg?.photoFileKey) {
      photoKey = reg.photoFileKey;
    }

    // --- Photo thumbnail ---
    await this.generatePhotoThumbnail(regId, regCode, photoKey);
  }

  /**
   * Delegates to PhotoThumbnailService (photo-thumbnail.service.ts) — the
   * single definition of thumbnail generation, also reused (via
   * relocateFiles) by the desk spot-registration route. See that file's
   * CONTRACT for the guarded no-op / never-throws behavior and what the
   * returned ThumbnailResult means. relocateFiles ignores the result
   * (fire-and-forget); regenerateMissingThumbnails uses it to count real
   * successes vs. silent failures.
   */
  private async generatePhotoThumbnail(regId: number, regCode: string, photoKey: string | null) {
    return this.photoThumbnailService.generateAndStore(regId, regCode, photoKey);
  }

  async replacePhoto(
    regId: number,
    actorEmail: string,
    file: { bytes: ArrayBuffer; mimeType: string; sizeBytes: number },
  ): Promise<void> {
    const registration = await this.registrationRepo.findById(regId);
    if (!registration) throw new NotFoundError('Registration not found');
    if (!this.fileStorage || !this.imagesBinding || !this.publicThumbsBucket) {
      throw new AppError('Photo replacement is not configured', 500);
    }

    let thumbBytes: ArrayBuffer;
    try {
      const input = new Response(file.bytes).body;
      if (!input) throw new Error('Could not create image stream');
      thumbBytes = await this.photoThumbnailService.render(input);
    } catch (err) {
      this.log.warn(`Photo rendering failed for reg_id=${regId}: ${String(err)}`);
      throw new AppError('Could not process image', 422);
    }

    const extension = file.mimeType === 'image/png' ? 'png' : 'jpg';
    const originalKey = `registrations/${registration.regCode}/photo.${extension}`;
    const thumbKey = `registrations/${registration.regCode}/photo-thumb.jpg`;

    await this.fileStorage.upload(originalKey, file.bytes, {
      mimeType: file.mimeType,
      fileName: `photo.${extension}`,
      sizeBytes: file.sizeBytes,
    });
    await this.fileStorage.upload(thumbKey, thumbBytes, {
      mimeType: 'image/jpeg',
      fileName: 'photo-thumb.jpg',
      sizeBytes: thumbBytes.byteLength,
    });
    await this.publicThumbsBucket.put(`${regId}.jpg`, thumbBytes, {
      httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: PUBLIC_THUMB_CACHE_CONTROL,
      },
    });
    await this.registrationRepo.update(regId, {
      photo_file_key: originalKey,
      photo_thumb_key: thumbKey,
    });

    const previousExtension = registration.photoFileKey?.split('.').pop()?.toLowerCase();
    if (registration.photoFileKey && previousExtension !== extension) {
      try {
        await this.fileStorage.delete(registration.photoFileKey);
      } catch (err) {
        this.log.warn(`Stale photo delete failed for reg_id=${regId}: ${String(err)}`);
      }
    }

    try {
      const attendees = await this.attendeeRepo.findByRegistration(regId);
      const updated = await this.registrationRepo.findById(regId) ?? {
        ...registration,
        photoFileKey: originalKey,
        photoThumbKey: thumbKey,
      };
      await this.auditRepo.append({
        registration_id: regId,
        action: 'photo_replaced',
        actor: actorEmail,
        changes: JSON.stringify({
          photoFileKey: { old: registration.photoFileKey, new: originalKey },
        }),
        snapshot: createSnapshot(updated, attendees),
      });
    } catch (err) {
      this.log.error('Audit entry failed', { registrationId: regId, error: String(err) });
    }
  }

  async regenerateMissingThumbnails(): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    errors: Array<{ id: number; regCode: string; error: string }>;
  }> {
    const missing = await this.registrationRepo.findMissingThumbnails();
    const errors: Array<{ id: number; regCode: string; error: string }> = [];
    let succeeded = 0;

    // generatePhotoThumbnail() never throws (PhotoThumbnailService
    // GENERATE_NEVER_THROWS) — a silent no-op or render/upload failure would
    // fall through a try/catch here and be miscounted as succeeded. Count
    // from the returned result instead.
    for (const row of missing) {
      const result = await this.generatePhotoThumbnail(row.id, row.regCode, row.photoFileKey);
      if (result.ok) {
        succeeded++;
      } else {
        errors.push({
          id: row.id,
          regCode: row.regCode,
          error: result.error ?? 'Thumbnail generation failed',
        });
      }
    }

    return { total: missing.length, succeeded, failed: errors.length, errors };
  }

  async syncThumbsToPublicBucket(): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    errors: Array<{ id: number; error: string }>;
  }> {
    if (!this.publicThumbsBucket || !this.fileStorage) {
      throw new AppError('Public thumbs bucket not configured', 500);
    }

    const rows = await this.registrationRepo.findWithThumbnails();
    const errors: Array<{ id: number; error: string }> = [];
    let succeeded = 0;

    for (const row of rows) {
      try {
        const file = await this.fileStorage.get(row.photoThumbKey);
        if (!file) {
          errors.push({ id: row.id, error: 'Thumbnail not found in private bucket' });
          continue;
        }
        const bytes = await new Response(file.body).arrayBuffer();
        await this.publicThumbsBucket.put(`${row.id}.jpg`, bytes, {
          httpMetadata: {
            contentType: 'image/jpeg',
            cacheControl: PUBLIC_THUMB_CACHE_CONTROL,
          },
        });
        succeeded++;
      } catch (err) {
        errors.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    this.log.info(`Synced ${succeeded}/${rows.length} thumbnails to public bucket`);
    return { total: rows.length, succeeded, failed: errors.length, errors };
  }

  async getByToken(registrationId: number): Promise<RegistrationResponse> {
    const reg = await this.registrationRepo.findById(registrationId);
    if (!reg) throw new NotFoundError('Registration not found');

    const attendees = await this.attendeeRepo.findByRegistration(registrationId);
    const docs = await this.documentRepo.findByRegistration(registrationId);
    return { registration: mapToResponse(reg, attendees, docs[0] ?? null) };
  }

  async getByRegCode(regCode: string): Promise<RegistrationResponse> {
    const reg = await this.registrationRepo.findByRegCode(regCode);
    if (!reg) throw new NotFoundError('Registration not found');

    const attendees = await this.attendeeRepo.findByRegistration(reg.id);
    const docs = await this.documentRepo.findByRegistration(reg.id);
    return { registration: mapToResponse(reg, attendees, docs[0] ?? null) };
  }

  async getPassData(regCode: string): Promise<{
    name: string;
    regCode: string;
    attendanceIntent: string;
    participationType: string;
    attendeeCount: number;
    accommodation: string;
  }> {
    const reg = await this.registrationRepo.findByRegCode(regCode);
    if (!reg) throw new NotFoundError('Registration not found');

    const attendees = await this.attendeeRepo.findByRegistration(reg.id);

    return {
      name: reg.fullName,
      regCode: reg.regCode,
      attendanceIntent: reg.attendanceIntent,
      participationType: reg.participationType,
      attendeeCount: attendees.length,
      accommodation: reg.accommodation,
    };
  }

  private validateSubmission(data: SubmitRegistrationRequest): Record<string, string> {
    const result = registrationSchema.safeParse(data);
    if (result.success) return {};

    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      if (!errors[path]) {
        errors[path] = issue.message;
      }
    }
    return errors;
  }
}

function buildSnapshotRegistration(
  id: number,
  regCode: string,
  insertSet: RegistrationInsertSet,
  pricing: PricingBreakup,
): Registration {
  const nr = insertSet.registration;
  const now = Date.now();
  return {
    id,
    regCode,
    status: 'pending',
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
    contributionSplits: (() => {
      try {
        const parsed = JSON.parse(nr.contribution_splits);
        return (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
          ? parsed as Record<string, number>
          : {};
      } catch {
        return {};
      }
    })(),
    pricingSnapshot: pricing,
    totalAmount: nr.total_amount,
    idNote: nr.id_note,
    photoFileKey: nr.photo_file_key,
    photoThumbKey: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildSnapshotAttendee(id: number, registrationId: number, na: NewAttendee): Attendee {
  return {
    id,
    registrationId,
    type: na.type,
    name: na.name,
    age: na.age,
    relationship: na.relationship,
    meal: na.meal,
    isChargeable: na.is_chargeable !== 0,
    createdAt: Date.now(),
  };
}
