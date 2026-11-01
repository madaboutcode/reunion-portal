import { Link } from "react-router-dom";
import { TOURNAMENT_PREDICTIONS, type TournamentPrediction, type TournamentPredictor } from "@/lib/awards-data";
import { useInView } from "@/hooks/useInView";

const WHEN_LABEL: Record<TournamentPredictor["when"], string> = {
  "pre-tournament": "Pre-tournament",
  r16: "Round of 16",
  both: "Both rounds",
};

function PredictionCard({ prediction }: { prediction: TournamentPrediction }) {
  const { ref, visible } = useInView<HTMLElement>(0.15);

  return (
    <article
      ref={ref}
      className={`awards-reveal rounded-2xl border border-[var(--line)] bg-[var(--paper-warm)] p-6${visible ? " is-visible" : ""}`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--aqua-deep)]">
        {prediction.label}
      </p>
      <p className="font-heading mt-1 text-2xl font-bold text-[var(--ink)]">{prediction.actual}</p>
      <ul className="mt-4 flex flex-wrap gap-2" aria-label={`${prediction.label} predictors`}>
        {prediction.predictors.map((p) => (
          <li
            key={p.name}
            className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs"
          >
            <Link
              to={`/predictions?player=${encodeURIComponent(p.name)}`}
              className="font-semibold text-[var(--ink)] no-underline hover:text-[var(--coral)] transition-colors"
            >
              {p.name}
            </Link>
            <span className="text-[var(--muted)]">· {p.branch}</span>
            <span className="text-[var(--aqua-deep)]">· {WHEN_LABEL[p.when]}</span>
            <span className="font-semibold text-[var(--coral-deep)]">+{p.points}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function TournamentPredictions() {
  const { ref: headingRef, visible: headingVisible } = useInView<HTMLDivElement>(0.15);

  return (
    <section aria-labelledby="tournament-predictions-heading" className="px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div
          ref={headingRef}
          className={`awards-reveal text-center${headingVisible ? " is-visible" : ""}`}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--aqua-deep)]">
            Tournament calls
          </p>
          <h2
            id="tournament-predictions-heading"
            className="font-heading mt-2 text-4xl font-bold text-[var(--ink)] sm:text-5xl"
          >
            Who Called It?
          </h2>
          <p className="mt-3 text-[var(--muted)]">
            Champion, runner-up, golden boot, golden glove — who saw it coming.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {TOURNAMENT_PREDICTIONS.map((prediction) => (
            <PredictionCard key={prediction.category} prediction={prediction} />
          ))}
        </div>
      </div>
    </section>
  );
}
