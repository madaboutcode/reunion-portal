import { useState } from "react";
import { useStepValidation } from "@/hooks/useStepValidation";
import { useFileUpload } from "@/hooks/useFileUpload";
import { photoIdSchema } from "@/lib/validation";
import { FileUpload } from "@/components/ui/FileUpload";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/form/FormField";
import { WizardStepLayout } from "@/components/registration/WizardStepLayout";
import { Note } from "@/components/ui/Note";
import type { WizardDraft } from "@/types/registration";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PhotoIdProps {
  data: WizardDraft;
  update: (changes: Partial<WizardDraft>) => void;
  onNext: () => void;
  onBack: () => void;
  /** Reserved for wizard shell compatibility — not used by this step. */
  goToStep?: (step: number) => void;
}

// ── Upload config ─────────────────────────────────────────────────────────

const PHOTO_UPLOAD_URL = "/api/uploads/photo";
const ID_UPLOAD_URL = "/api/uploads/id-document";

const ACCEPTED_IDS = [
  "Aadhaar Card",
  "PAN Card",
  "Passport",
  "Driving Licence",
];

// ── Privacy notice ─────────────────────────────────────────────────────────

function PrivacyNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-2.5 px-3.5 bg-[#f8f9fb] rounded-[10px] mb-4">
      <span className="text-sm text-subtle leading-[1.5]">{children}</span>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function PhotoId({ data, update, onNext, onBack }: PhotoIdProps) {
  const { errors, validate, clearError } = useStepValidation(photoIdSchema);
  const [idRequiredError, setIdRequiredError] = useState<string | null>(null);

  const isDonationOnly = data.participationType === "donation_only";

  // ID is required for non-donation-only users who are attending
  const idRequired =
    !isDonationOnly &&
    data.participationType != null;

  const commonFields = {
    fullName: data.fullName,
    branch: data.branch,
    email: data.email,
  };

  const photo = useFileUpload(PHOTO_UPLOAD_URL, commonFields, {
    onSuccess: (fileKey, file) => {
      update({
        photoFileName: file.name,
        photoFileKey: fileKey,
        photoFileType: file.type,
        photoFileSizeBytes: file.size,
      });
      clearError("photoFileName");
      clearError("photoFileKey");
    },
    onClear: () =>
      update({
        photoFileName: "",
        photoFileKey: undefined,
        photoFileType: undefined,
        photoFileSizeBytes: undefined,
      }),
  });

  const id = useFileUpload(ID_UPLOAD_URL, commonFields, {
    onSuccess: (fileKey, file) => {
      update({
        idFileName: file.name,
        idFileKey: fileKey,
        idFileType: file.type,
        idFileSizeBytes: file.size,
      });
      setIdRequiredError(null);
    },
    onClear: () =>
      update({
        idFileName: "",
        idFileKey: undefined,
        idFileType: undefined,
        idFileSizeBytes: undefined,
      }),
  });

  const anyUploading = photo.uploading || id.uploading;

  const nextLabel = "Continue to Review →";

  const handleContinue = () => {
    if (anyUploading) return;

    // ID requirement depends on attendance intent + accommodation — not encodable in Zod schema
    if (idRequired && !data.idFileKey) {
      setIdRequiredError("Please upload your ID document");
      return;
    }
    setIdRequiredError(null);

    if (validate(data)) onNext();
  };

  // ── Form body ─────────────────────────────────────────────────────────────

  const formBody = (
    <div
      className={[
        "bg-surface",
        "rounded-[20px]",
        "border border-border-warm",
        "py-5 px-4 sm:py-8 sm:px-7",
        "shadow-[0_4px_28px_rgba(80,60,40,0.08)]",
      ].join(" ")}
    >
      {/* ── Title ── */}
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-heading text-[22px] sm:text-[26px] text-charcoal font-bold">
          Photo &amp; ID
        </h2>
        <span className="text-xl" aria-hidden="true">📸</span>
      </div>

      {/* ── Subtitle ── */}
      <p className="font-accent text-sm text-terracotta italic mb-6">
        Upload your photo{!isDonationOnly ? " and a valid ID document" : ""}
      </p>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Section A: Your Photo                                               */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      <div className="mb-7">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-heading text-[17px] sm:text-[19px] text-charcoal font-semibold">
            Your Photo
          </h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold font-body bg-terracotta/10 text-terracotta">
            Required
          </span>
        </div>

        {/* Purpose note */}
        <p className="text-sm text-subtle leading-relaxed mb-3">
          Your photo will be featured in the event magazine — a yearbook-style
          keepsake with everyone's photos and memories. Please upload a
          passport-size photo.
        </p>

        {/* Privacy notice */}
        <PrivacyNotice>
          Your photo is stored securely and is only accessible to the event
          committee. It is never publicly visible and will be deleted after
          the event.
        </PrivacyNotice>

        {/* File upload zone */}
        <FileUpload
          accept="image/*"
          maxSizeMB={5}
          data-testid="upload-photo"
          onFileSelect={photo.handleFileSelect}
          uploading={photo.uploading}
          uploadProgress={photo.progress}
          uploadedFileName={data.photoFileKey ? data.photoFileName : undefined}
          onRemoveUploaded={photo.handleRemove}
          error={photo.error || undefined}
          disabled={photo.uploading}
        />

        {(errors.photoFileName || errors.photoFileKey) && (
          <p className="text-sm text-terracotta mt-2">
            ⚠ {errors.photoFileName || errors.photoFileKey}
          </p>
        )}

        <Note className="mt-3">
          <span className="block">Format: JPG or PNG &middot; Max size: 5 MB</span>
        </Note>
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Section B: ID Proof (attending / not_sure users only)               */}
      {/* ════════════════════════════════════════════════════════════════════ */}

      {!isDonationOnly && (
        <>
          <div className="border-t border-[#f0ede8] mb-7" />

          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-heading text-[17px] sm:text-[19px] text-charcoal font-semibold">
                Verify Your Identity
              </h3>
              {idRequired && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold font-body bg-terracotta/10 text-terracotta">
                  Required
                </span>
              )}
            </div>

            {/* Why needed */}
            <p className="text-sm text-subtle leading-relaxed mb-3">
              The venue requires valid ID for accommodation check-in.
              Verification also ensures safety and security for all attendees.
            </p>

            {/* Privacy notice */}
            <PrivacyNotice>
              Your document is stored securely and is only accessible to our
              team. It is never publicly visible and will be deleted after the
              event.
            </PrivacyNotice>

            {/* File upload zone */}
            <div className="mb-4">
              <FileUpload
                accept=".jpg,.jpeg,.png,.pdf"
                maxSizeMB={5}
                data-testid="upload-id"
                onFileSelect={id.handleFileSelect}
                uploading={id.uploading}
                uploadProgress={id.progress}
                uploadedFileName={data.idFileKey ? data.idFileName : undefined}
                onRemoveUploaded={id.handleRemove}
                error={id.error || undefined}
                disabled={id.uploading}
              />

              {(idRequiredError || errors.idFileName || errors.idFileKey || errors.idFileType) && (
                <p className="text-sm text-terracotta mt-2">
                  ⚠ {idRequiredError || errors.idFileName || errors.idFileKey || errors.idFileType}
                </p>
              )}
            </div>

            {/* Accepted ID types */}
            <Note className="mb-5">
              <span className="block mb-1">
                Accepted documents: {ACCEPTED_IDS.join(", ")}
              </span>
              <span className="block">
                Format: JPG, PNG, or PDF &middot; Max size: 5 MB
              </span>
            </Note>

            {/* Optional note */}
            <FormField
              label="Note for our team (optional)"
              hint='Any context about your ID document, e.g. "Name on ID differs from registered name"'
            >
              <Textarea
                value={data.idNote}
                onChange={(e) => update({ idNote: e.target.value })}
                placeholder="Any context about your ID document…"
                rows={2}
              />
            </FormField>
          </div>
        </>
      )}

    </div>
  );

  return (
    <WizardStepLayout
      data={data}
      onBack={onBack}
      onNext={handleContinue}
      nextLabel={nextLabel}
      nextDisabled={anyUploading}
      animate
    >
      {formBody}
    </WizardStepLayout>
  );
}
