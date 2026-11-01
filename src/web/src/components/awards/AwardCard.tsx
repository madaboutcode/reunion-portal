import { Link } from "react-router-dom";
import type { Award, AwardWinner } from "@/lib/awards-data";
import { useInView } from "@/hooks/useInView";

function PlayerLink({
  name,
  linkName,
  className,
}: {
  name: string;
  linkName?: string;
  className?: string;
}) {
  return (
    <Link
      to={`/predictions?player=${encodeURIComponent(linkName ?? name)}`}
      className={`hover:text-[var(--coral)] transition-colors ${className ?? ""}`}
    >
      {name}
    </Link>
  );
}

// Short paraphrase of each award's own `criteria` field, used as the eyebrow
// tag next to the award number (e.g. "01 · Overall points"). Presentational
// only — not a new data field, just a compact label for the existing text.
const CATEGORY_LABEL: Record<string, string> = {
  "nostradamus-of-karicode": "Overall points",
  "chacko-master": "Exact scores",
  velichappadu: "Upset calls",
  "thuruppu-gulan": "Joker plays",
  fazil: "Man of the Match",
  "nokia-3310": "Hit rate",
  "series-exam-star": "Group stage",
  "desert-storm": "Knockout rounds",
  "kanippayyur-jr": "Branch leaders",
  "rolling-trophy": "Department ranking",
};

interface AwardCardProps {
  award: Award;
}

function WinnerEntry({
  winner,
  large = false,
  linkable = true,
}: {
  winner: AwardWinner;
  large?: boolean;
  linkable?: boolean;
}) {
  return (
    <div>
      <p
        className={`font-heading font-bold text-[var(--ink)] ${large ? "text-[2.1rem]" : "text-[1.78rem]"}`}
      >
        {linkable ? (
          <PlayerLink name={winner.name} linkName={winner.linkName} className="text-inherit no-underline" />
        ) : (
          winner.name
        )}
      </p>
      {winner.branch && (
        <p className="text-sm font-semibold text-[var(--aqua-deep)] mt-0.5">{winner.branch}</p>
      )}
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--coral)]">
        {winner.metric}
      </p>
      {winner.detail && <p className="mt-1 text-xs text-[var(--muted)]">{winner.detail}</p>}
    </div>
  );
}

function ContendersList({
  contenders,
  linkable = true,
}: {
  contenders: AwardWinner[];
  linkable?: boolean;
}) {
  if (contenders.length === 0) return null;
  return (
    <ol className="mt-4 space-y-1.5 list-none p-0">
      {contenders.map((c, i) => (
        <li key={c.name} className="flex items-baseline gap-2 text-sm">
          <span className="shrink-0 text-xs font-semibold text-[var(--muted)]">{i + 2}.</span>
          {linkable ? (
            <PlayerLink name={c.name} linkName={c.linkName} className="font-medium text-[var(--ink)] no-underline" />
          ) : (
            <span className="font-medium text-[var(--ink)]">{c.name}</span>
          )}
          <span className="text-xs text-[var(--muted)]">{c.metric}</span>
        </li>
      ))}
    </ol>
  );
}

function BranchRollGrid({ winners }: { winners: AwardWinner[] }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {winners.map((w) => (
        <div key={w.name}>
          <p className="font-heading text-lg font-bold text-[var(--ink)]">
            <PlayerLink name={w.name} linkName={w.linkName} className="text-inherit no-underline" />
          </p>
          <p className="text-xs font-semibold text-[var(--aqua-deep)]">{w.branch}</p>
          <p className="text-xs font-semibold text-[var(--coral-deep)]">{w.metric}</p>
        </div>
      ))}
    </div>
  );
}

function ResultColumn({ award }: { award: Award }) {
  if (award.layoutVariant === "branch_roll") {
    return (
      <div>
        <BranchRollGrid winners={award.winners} />
        <ContendersList contenders={award.contenders} />
      </div>
    );
  }

  const isDepartment = award.layoutVariant === "department";
  const multi = award.winners.length > 1;

  return (
    <div className="awards-winner p-5 sm:p-6 text-left">
      {multi ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {award.winners.map((w) => (
            <WinnerEntry key={w.name} winner={w} large={isDepartment} linkable={!isDepartment} />
          ))}
        </div>
      ) : (
        <WinnerEntry winner={award.winners[0]} large={isDepartment} linkable={!isDepartment} />
      )}
      {award.prize && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--gold-soft)] px-3 py-2">
          <span className="text-sm" aria-hidden="true">🏆</span>
          <span className="text-xs font-semibold text-[var(--ink)]">{award.prize}</span>
        </div>
      )}
      <ContendersList contenders={award.contenders} linkable={!isDepartment} />
    </div>
  );
}

export function AwardCard({ award }: AwardCardProps) {
  const categoryLabel = CATEGORY_LABEL[award.slug] ?? award.subtitle;
  const isGoldStage = award.layoutVariant === "department";
  const { ref, visible } = useInView<HTMLElement>(0.15);

  return (
    <article
      ref={ref}
      className={`awards-row awards-reveal${visible ? " is-visible" : ""}`}
      aria-label={award.title}
    >
      <div className={`awards-medal-stage${isGoldStage ? " is-gold" : ""}`}>
        <img
          src={award.stickerPath}
          alt={`${award.title} sticker`}
          className="awards-sticker w-36 sm:w-44"
          loading="lazy"
        />
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
          {String(award.order).padStart(2, "0")} · {categoryLabel}
        </p>
        <h3 className="font-heading font-bold text-[var(--ink)] mt-2 text-[clamp(2.55rem,4vw+1rem,4.55rem)] leading-[1.05]">
          {award.title}
        </h3>
        <p className="font-accent text-2xl text-[var(--coral)] mt-2">{award.subtitle}</p>
        <p className="awards-criteria mt-5 max-w-md text-sm text-[var(--muted)]">
          {award.criteria}
        </p>
      </div>

      <ResultColumn award={award} />
    </article>
  );
}
