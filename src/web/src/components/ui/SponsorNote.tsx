/** Scrapbook-style sticker callout for the sponsorship note. */

function Sparkle({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 1 L13.8 10.2 L23 12 L13.8 13.8 L12 23 L10.2 13.8 L1 12 L10.2 10.2 Z"
        fill="#D76B51"
      />
    </svg>
  );
}

function SmallStar({ className }: { className?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <polygon
        points="12,2 15.1,8.6 22,9.3 17,14.1 18.2,21.1 12,17.7 5.8,21.1 7,14.1 2,9.3 8.9,8.6"
        fill="#F5C242"
      />
    </svg>
  );
}

export function SponsorNote() {
  return (
    <div className="relative mt-5 mx-1">
      {/* Washi tape strip */}
      <div
        className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-[55%] h-[14px] rounded-sm bg-soft-aqua/60 rotate-[-1.5deg]"
        aria-hidden="true"
      />

      {/* Corner stickers */}
      <Sparkle className="absolute -top-3 -left-2 rotate-12" />
      <SmallStar className="absolute -top-2 -right-1.5 -rotate-6" />
      <SmallStar className="absolute -bottom-2 -left-1.5 rotate-6" />
      <Sparkle className="absolute -bottom-3 -right-2 -rotate-12" />

      {/* Card */}
      <div
        className={[
          "rounded-xl px-3 pt-4 pb-3 text-center",
          "bg-[#FFFBEC] border border-[#F0DC8A]/70",
          "rotate-[-0.7deg]",
          "shadow-[0_2px_8px_rgba(240,180,60,0.12)]",
        ].join(" ")}
      >
        <p className="font-accent text-[15px] leading-snug text-[#8B6914]">
          DJ & violin concert at Raviz
          <br />— sponsored, not included in fee
        </p>
      </div>
    </div>
  );
}
