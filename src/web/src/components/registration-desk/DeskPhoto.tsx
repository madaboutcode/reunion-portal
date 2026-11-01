export interface DeskPhotoProps {
  /** Image URL, or null to render the initial-letter placeholder. */
  src: string | null;
  alt: string;
  /** Shown when `src` is null (registration-desk.spec.md R3.3 / R2.5). */
  fallbackLetter: string;
  /** Sizing/shape utilities — applied to whichever branch renders. */
  className?: string;
  testId?: string;
}

/**
 * Shared photo-with-placeholder primitive (registration-desk-ui plan, shared
 * primitives). Used by both the Ribbon result card (public CDN thumbnail) and
 * the Ledger detail (authenticated private blob) — the two callers differ
 * only in what URL they pass in and how they size/shape the result via
 * `className`.
 */
export function DeskPhoto({ src, alt, fallbackLetter, className = "", testId }: DeskPhotoProps) {
  if (src) {
    return <img src={src} alt={alt} data-testid={testId} className={`object-cover ${className}`} />;
  }
  return (
    <div
      role="img"
      data-testid={testId}
      aria-label={alt || "No photo available"}
      className={`flex items-center justify-center bg-soft-aqua-light font-heading text-soft-aqua-deep ${className}`}
    >
      {fallbackLetter}
    </div>
  );
}
