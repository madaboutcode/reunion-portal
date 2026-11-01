import { PAGE_META } from "@/lib/awards-data";

export function AwardsHero() {
  return (
    <header className="awards-hero relative overflow-hidden px-6 py-16 sm:py-20 lg:py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--coral-deep)]">
            <svg
              className="h-4 w-4 text-[var(--coral)]"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path
                d="m12 6 3.5 2.5-1.3 4.1h-4.4L8.5 8.5zM6 9.5l4.7 2.3m3.6 0 4.7-2.3M9 17l1.8-6.3m3.4 6.3L12.4 10.7"
                fill="none"
                stroke="#fff"
                strokeWidth="0.9"
                strokeLinejoin="round"
              />
            </svg>
            {PAGE_META.eyebrow} · Smriti 2026
          </p>

          <h1 className="awards-hero-title font-heading mt-4 text-[clamp(3rem,5vw+1rem,5.5rem)] font-bold leading-[1.02] text-[var(--ink)]">
            Prediction
            <br />
            <em>Awards</em>
          </h1>

          <p className="mt-6 max-w-md text-lg text-[var(--muted)]">{PAGE_META.intro}</p>

          <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--paper-warm)] px-5 py-2.5 text-sm font-semibold text-[var(--coral-deep)]">
            <span aria-hidden="true">✦</span> Ten ways to win the bragging rights
          </p>
        </div>

        <div className="awards-hero-image-frame mx-auto w-full max-w-md lg:max-w-none">
          <img
            src="/assets/awards/hero/awards-page-hero.png"
            alt="Illustrated trophy shelf celebrating Smriti 2026 prediction league winners"
            className="awards-hero-image w-full"
          />
          <span className="awards-hero-badge" aria-hidden="true">
            10 small legends
          </span>
        </div>
      </div>
    </header>
  );
}
