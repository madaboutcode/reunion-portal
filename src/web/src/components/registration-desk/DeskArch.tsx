/**
 * Ceremonial intro for the Ribbon landing (registration-desk-ui plan,
 * mockup `data-design="ribbon"` .intro + .memory-frame). The circular "memory
 * frame" carries the Smriti logo.
 *
 * Background artwork: the watercolour courtyard arch is rendered by the landing
 * PAGE (RegistrationDeskPage) as an absolute backdrop BEHIND this composition.
 * The heading, sub-line and logo sit directly over the art's own painted arch —
 * there is deliberately NO CSS arch card here, so the art frames the copy rather
 * than a rounded box competing with it. Legibility comes from a soft cream glow
 * the page places behind this heading, not from a surface panel.
 */
export function DeskArch() {
  return (
    <div className="text-center">
      <div className="px-6 pt-10 sm:pt-14">
        <p className="font-accent text-xl text-terracotta">Welcome them in</p>
        <h1 className="mt-1 font-heading text-[clamp(38px,10vw,64px)] font-bold leading-[0.96] tracking-[-0.035em] text-charcoal">
          Find an attendee.
        </h1>
        <p className="mx-auto mt-2 max-w-[490px] text-[13px] leading-relaxed text-muted">
          Search the reunion register by name or full pass ID, then confirm their arrival.
        </p>
      </div>
      <div
        aria-hidden="true"
        className="relative z-10 mx-auto mt-6 h-[116px] w-[116px] overflow-hidden rounded-full border-[7px] border-surface bg-surface shadow-[0_8px_24px_rgba(80,60,40,0.17)]"
      >
        <img src="/assets/smriti-logo.png" alt="" className="h-full w-full object-cover" />
      </div>
    </div>
  );
}
