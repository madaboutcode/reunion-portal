import { SmritiLogo } from "@/components/ui/SmritiLogo";
import type { CommitteePerson, CommitteeTask } from "./model";
import { openTopLevelCount, unassignedTasks } from "./model";
import { SquareAvatar, RowChevron } from "./parts";

export interface PeopleGridProps {
  people: CommitteePerson[];
  tasks: CommitteeTask[];
  onOpenPerson: (name: string) => void;
  onOpenUnassigned: () => void;
}

/** Landing (Concept 4 — Full-Bleed Cover): the campus watercolor as a cover
 *  fading into cream, the brand lockup over it, then an editorial roster of
 *  every committee member + an Unassigned row. Tapping a row opens their list. */
export function PeopleGrid({ people, tasks, onOpenPerson, onOpenUnassigned }: PeopleGridProps) {
  const unassignedCount = unassignedTasks(tasks, people).length;
  const totalOpen = people.reduce((n, p) => n + openTopLevelCount(p.name, tasks), 0);

  return (
    <div className="committee-header-anim animate-committee-header">
      {/* Cover: the college watercolor, faded into the cream page. */}
      <div className="relative h-[300px] overflow-hidden">
        <img
          src="/assets/tkmce-building-hero-centered.png"
          alt="TKMCE College"
          className="h-full w-full object-cover object-center"
        />
        {/* Top vignette keeps the dark status-bar glyphs legible over the sky. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-16"
          style={{ background: "linear-gradient(180deg, rgba(245,240,232,0.55) 0%, rgba(245,240,232,0) 100%)" }}
        />
        {/* Bottom fade into the cream page. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[120px]"
          style={{ background: "linear-gradient(0deg, #F5F0E8 0%, rgba(245,240,232,0.7) 50%, transparent 100%)" }}
        />
        {/* Brand lockup: logo left of the title. */}
        <div className="absolute inset-x-0 bottom-[18px] flex items-center justify-center gap-2.5">
          <SmritiLogo size={44} />
          <div className="flex flex-col items-start">
            <span className="font-heading text-[32px] font-black leading-none tracking-tight text-charcoal">
              Smriti 2026
            </span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-[2.5px] text-terracotta">
              Backstage
            </span>
          </div>
        </div>
      </div>

      {/* Meta line */}
      <p className="px-6 pb-3 pt-4 text-center text-[12px] font-semibold uppercase tracking-[1.8px] text-subtle">
        {people.length} on the team · {totalOpen} open
        {unassignedCount > 0 ? ` · ${unassignedCount} unclaimed` : ""}
      </p>

      {/* Roster */}
      <div className="pb-10 pt-1">
        {people.map((p, i) => {
          const count = openTopLevelCount(p.name, tasks);
          return (
            <button
              key={p.regid ?? p.name}
              type="button"
              onClick={() => onOpenPerson(p.name)}
              style={{ animationDelay: `${60 + i * 35}ms` }}
              className={`flex w-full items-center px-5 py-3.5 text-left transition animate-[fadeSlideIn_0.4s_ease_both] active:bg-soft-aqua/[0.12] ${
                i > 0 ? "border-t border-charcoal/[0.06]" : ""
              }`}
            >
              <SquareAvatar name={p.name} photoSrc={p.photoSrc} size={48} radius={11} />
              <span className="ml-3.5 flex-1 truncate text-[17px] font-semibold text-charcoal">
                {p.name}
              </span>
              <span
                className={`mr-2.5 min-w-7 text-right font-heading text-[22px] font-bold ${
                  count === 0 ? "text-subtle/50" : "text-terracotta"
                }`}
              >
                {count}
              </span>
              <RowChevron />
            </button>
          );
        })}

        {/* Unassigned, set apart with a heavier divider. */}
        <button
          type="button"
          onClick={onOpenUnassigned}
          className="mt-1 flex w-full items-center border-t border-charcoal/10 px-5 pb-3.5 pt-4 text-left transition active:bg-soft-aqua/[0.12]"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[11px] bg-charcoal/[0.06] text-base font-semibold text-muted">
            ?
          </span>
          <span className="ml-3.5 flex-1 truncate text-[17px] text-muted">Unassigned</span>
          <span className="mr-2.5 min-w-7 text-right font-heading text-[22px] font-bold text-terracotta">
            {unassignedCount}
          </span>
          <RowChevron />
        </button>
      </div>
    </div>
  );
}
