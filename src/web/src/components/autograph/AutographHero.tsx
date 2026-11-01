export function AutographHero() {
  return (
    <header className="autograph-hero relative overflow-hidden px-6 py-16 sm:py-20 lg:py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--coral-deep)]">
            <svg
              className="h-4 w-4 text-[var(--coral)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Memories · Smriti 2026
          </p>

          <h1 className="awards-hero-title font-heading mt-4 text-[clamp(3rem,5vw+1rem,5.5rem)] font-bold leading-[1.02] text-[var(--ink)]">
            The
            <br />
            <em>Autograph</em>
            <br />
            Book
          </h1>

          <p className="mt-6 max-w-md text-lg text-[var(--muted)]">
            Fifty hours together and twenty years of catching up. This is what stayed with us
            after we left.
          </p>

          <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--paper-warm)] px-5 py-2.5 text-sm font-semibold text-[var(--coral-deep)]">
            <span aria-hidden="true">✦</span> Old jokes, new stories, same old us
          </p>
        </div>

        <div className="awards-hero-image-frame mx-auto w-full max-w-md lg:max-w-none">
          <img
            src="/assets/stories/stories-page-hero.webp"
            alt="An open autograph book filled with handwritten notes from Smriti 2026 batchmates"
            className="awards-hero-image w-full"
          />
          <span className="awards-hero-badge" aria-hidden="true">
            In our own words
          </span>
        </div>
      </div>
    </header>
  );
}
