import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CommitteePerson, CommitteeTask } from "./model";
import {
  childrenOf,
  isTaskDone,
  openTopLevelCount,
  topLevelFor,
  unassignedTasks,
} from "./model";
import { SquareAvatar, CheckMark, DuePill, EditButton } from "./parts";
import { EditTaskModal } from "./EditTaskModal";

export interface PersonTodoListProps {
  person: CommitteePerson;
  people: CommitteePerson[];
  tasks: CommitteeTask[];
  onBack: () => void;
  onReload: () => void;
  onToggle: (id: string) => void;
  onAddTask: (title: string) => void;
  onAddSubtask: (parentId: string, title: string) => void;
  onClaim: (id: string) => void;
  onEdit: (id: string, patch: { title: string; due: string | null; notes: string | null }) => void;
}

export function PersonTodoList({
  person,
  people,
  tasks,
  onBack,
  onReload,
  onToggle,
  onAddTask,
  onAddSubtask,
  onClaim,
  onEdit,
}: PersonTodoListProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<CommitteeTask | null>(null);

  // Render order is a *settled snapshot*: completed tasks sink to the bottom,
  // but only after the list has been idle for a beat. Completing a task flips
  // its look in place; the reorder waits, so rows don't jump under the finger.
  const [sunk, setSunk] = useState<Set<string>>(
    () => new Set(topLevelFor(person.name, tasks).filter((t) => isTaskDone(t, tasks)).map((t) => t.id)),
  );
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const resortTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const REORDER_DELAY_MS = 2500;

  function settleOrder() {
    const doneIds = topLevelFor(person.name, tasksRef.current)
      .filter((t) => isTaskDone(t, tasksRef.current))
      .map((t) => t.id);
    setSunk(new Set(doneIds));
  }

  // Switching to a different person shows their list already settled.
  useEffect(() => {
    if (resortTimer.current) clearTimeout(resortTimer.current);
    settleOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.name]);

  // Clear any pending reorder on unmount.
  useEffect(
    () => () => {
      if (resortTimer.current) clearTimeout(resortTimer.current);
    },
    [],
  );

  // Toggle now: flip immediately, defer the reorder until the list goes quiet.
  function handleToggle(id: string) {
    onToggle(id);
    if (resortTimer.current) clearTimeout(resortTimer.current);
    resortTimer.current = setTimeout(settleOrder, REORDER_DELAY_MS);
  }

  const top = topLevelFor(person.name, tasks);
  const ordered = [...top.filter((t) => !sunk.has(t.id)), ...top.filter((t) => sunk.has(t.id))];
  const unclaimed = unassignedTasks(tasks, people);
  const openCount = openTopLevelCount(person.name, tasks);
  const doneCount = top.filter((t) => isTaskDone(t, tasks)).length;

  function submitAdd() {
    const title = draft.trim();
    if (!title) return;
    onAddTask(title);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="relative min-h-full">
      {/* Faint desaturated campus watermark behind the top (shared brand cue). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[220px] overflow-hidden">
        <img
          src="/assets/tkmce-building-hero-centered.png"
          alt=""
          className="h-full w-full object-cover object-[center_top]"
          style={{ filter: "grayscale(1)", opacity: 0.1 }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-[100px]"
          style={{ background: "linear-gradient(0deg, #F5F0E8 0%, transparent 100%)" }}
        />
      </div>

      {/* Header: back to roster + reload */}
      <div
        className="relative z-10 flex items-center justify-between px-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-2 text-[15px] font-medium text-soft-aqua-deep transition active:opacity-60"
        >
          <BackChevron />
          Committee
        </button>
        <button
          type="button"
          onClick={onReload}
          aria-label="Reload from sheet"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-soft-aqua-deep transition active:opacity-60"
        >
          ⟳
        </button>
      </div>

      {/* Identity */}
      <div className="relative z-10 flex flex-col items-center px-6 pb-5 pt-2">
        <SquareAvatar
          name={person.name}
          photoSrc={person.photoSrc}
          size={88}
          radius={22}
          className="border-[3px] border-page shadow-[0_4px_16px_rgba(31,42,51,0.10)]"
        />
        <h1 className="mt-3 font-heading text-[32px] font-black leading-tight text-charcoal">
          {person.name}
        </h1>
        <p className="mt-1.5 text-[15px] text-muted">
          <span className="font-semibold text-terracotta">{openCount}</span> open
          {doneCount > 0 ? ` · ${doneCount} done` : ""}
        </p>
      </div>

      {/* Tasks */}
      <div className="relative z-10 px-4 pb-16">
        {ordered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">Nothing here yet.</p>
        )}

        {ordered.map((task) => (
          <TopLevelTask
            key={task.id}
            task={task}
            tasks={tasks}
            onToggle={handleToggle}
            onAddSubtask={onAddSubtask}
            onEdit={setEditing}
          />
        ))}

        {adding ? (
          <div className="mt-2 flex items-center gap-2 rounded-2xl bg-surface px-3 py-2 shadow-[0_1px_4px_rgba(31,42,51,0.06)]">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
                if (e.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              placeholder="New task…"
              className="h-9 flex-1 rounded-lg border border-border bg-white px-3 text-[15px] outline-none focus:border-terracotta"
            />
            <Button size="sm" onClick={submitAdd}>
              Add
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-1.5 flex w-full items-center gap-2 border-t-2 border-dashed border-soft-aqua-deep/20 px-1 pt-3.5 text-[14px] font-semibold text-soft-aqua-deep transition active:opacity-60"
          >
            <span className="text-lg font-light leading-none">＋</span>
            Add task
          </button>
        )}

        {unclaimed.length > 0 && (
          <section className="pt-6">
            <div className="mb-2 flex items-center gap-3 px-1 text-[11px] font-semibold uppercase tracking-[1.5px] text-subtle">
              <span className="h-px flex-1 bg-charcoal/10" />
              Unassigned
              <span className="h-px flex-1 bg-charcoal/10" />
            </div>
            <div className="space-y-2">
              {unclaimed.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 rounded-2xl bg-surface px-3 py-2 shadow-[0_1px_4px_rgba(31,42,51,0.06)]"
                >
                  <span className="min-w-0 flex-1 truncate text-[17px] text-charcoal">
                    {task.title}
                  </span>
                  {task.due && <DuePill due={task.due} done={task.done} />}
                  <EditButton onClick={() => setEditing(task)} label={`Edit "${task.title}"`} />
                  <Button variant="ghost" size="sm" onClick={() => onClaim(task.id)}>
                    claim
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {editing && (
        <EditTaskModal
          task={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => onEdit(editing.id, patch)}
        />
      )}
    </div>
  );
}

// ── Private: one top-level task (flat row, or expandable parent card) ─────────

interface TopLevelTaskProps {
  task: CommitteeTask;
  tasks: CommitteeTask[];
  onToggle: (id: string) => void;
  onAddSubtask: (parentId: string, title: string) => void;
  onEdit: (task: CommitteeTask) => void;
}

function TopLevelTask({ task, tasks, onToggle, onAddSubtask, onEdit }: TopLevelTaskProps) {
  const kids = childrenOf(tasks, task.id);
  const hasKids = kids.length > 0;
  const doneCount = kids.filter((k) => k.done).length;
  const rolledUpDone = isTaskDone(task, tasks);

  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function submitSub() {
    const title = draft.trim();
    if (!title) return;
    onAddSubtask(task.id, title);
    setDraft("");
    setAdding(false);
  }

  // Childless top-level task → the SAME card as a parent, just a checkbox + title
  // instead of a disclosure + fraction. Keeps top-level tasks visually siblings.
  if (!hasKids) {
    return (
      <div className="mb-2.5 rounded-2xl bg-surface p-4 shadow-[0_1px_4px_rgba(31,42,51,0.06),0_2px_12px_rgba(31,42,51,0.04)]">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => onToggle(task.id)}
            aria-pressed={task.done}
            aria-label={`Mark "${task.title}" ${task.done ? "not done" : "done"}`}
            className="flex min-w-0 flex-1 items-start gap-2.5 text-left transition active:opacity-70"
          >
            <CheckMark checked={task.done} />
            <span
              className={`min-w-0 flex-1 text-[17px] leading-snug ${task.done ? "text-subtle line-through" : "text-charcoal"}`}
            >
              {task.title}
            </span>
          </button>
          {task.due && <DuePill due={task.due} done={task.done} />}
          <EditButton onClick={() => onEdit(task)} label={`Edit "${task.title}"`} />
        </div>
      </div>
    );
  }

  // Parent → a white card with a fraction and its subtasks.
  return (
    <div className="mb-2.5 rounded-2xl bg-surface p-4 shadow-[0_1px_4px_rgba(31,42,51,0.06),0_2px_12px_rgba(31,42,51,0.04)]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="w-3 shrink-0 text-center text-[11px] font-bold text-soft-aqua-deep">
            {expanded ? "▾" : "▸"}
          </span>
          <span
            className={`min-w-0 flex-1 truncate font-heading text-[17px] font-bold ${rolledUpDone ? "text-subtle line-through" : "text-charcoal"}`}
          >
            {task.title}
          </span>
        </button>
        {task.due && <DuePill due={task.due} done={rolledUpDone} />}
        <span className="shrink-0 text-[14px] font-medium text-muted">
          <span className={`font-bold ${rolledUpDone ? "text-success" : "text-soft-aqua-deep"}`}>
            {doneCount}
          </span>
          /{kids.length}
        </span>
        <EditButton onClick={() => onEdit(task)} label={`Edit "${task.title}"`} />
      </div>

      {expanded && (
        <div className="mt-1.5">
          {kids.map((k) => (
            <div
              key={k.id}
              className="flex items-start gap-2 border-t border-charcoal/[0.05] py-2 first:border-t-0"
            >
              <button
                type="button"
                onClick={() => onToggle(k.id)}
                aria-pressed={k.done}
                aria-label={`Mark "${k.title}" ${k.done ? "not done" : "done"}`}
                className="flex min-w-0 flex-1 items-start gap-2.5 text-left transition active:opacity-70"
              >
                <CheckMark checked={k.done} />
                <span
                  className={`min-w-0 flex-1 text-[15px] leading-snug ${k.done ? "text-subtle line-through" : "text-charcoal"}`}
                >
                  {k.title}
                </span>
              </button>
              {k.due && <DuePill due={k.due} done={k.done} />}
              <EditButton onClick={() => onEdit(k)} label={`Edit "${k.title}"`} />
            </div>
          ))}

          {adding ? (
            <div className="flex items-center gap-2 py-1.5">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSub();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setDraft("");
                  }
                }}
                placeholder="New item…"
                className="h-8 flex-1 rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-terracotta"
              />
              <Button size="sm" onClick={submitSub}>
                Add
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-1 flex min-h-[36px] items-center gap-1.5 text-sm font-semibold text-soft-aqua-deep transition active:opacity-60"
            >
              <span className="text-base font-light leading-none">＋</span> add item
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function BackChevron() {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path d="M11 4L6 9l5 5" />
    </svg>
  );
}

/** Light back-bar used by the Unassigned screen (person screen has its own
 *  identity header). Back to roster + reload, on cream with dark glyphs. */
interface ScreenHeaderProps {
  onBack: () => void;
  onReload: () => void;
  children: React.ReactNode;
}

export function ScreenHeader({ onBack, onReload, children }: ScreenHeaderProps) {
  return (
    <header
      className="sticky top-0 z-10 flex items-center gap-1 border-b border-charcoal/[0.06] bg-page/95 px-3 pb-2 backdrop-blur"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
    >
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 px-2 py-2 text-[15px] font-medium text-soft-aqua-deep transition active:opacity-60"
      >
        <BackChevron />
        Committee
      </button>
      <h1 className="flex-1 truncate text-center font-heading text-base font-bold text-charcoal">
        {children}
      </h1>
      <button
        type="button"
        onClick={onReload}
        aria-label="Reload from sheet"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-soft-aqua-deep transition active:opacity-60"
      >
        ⟳
      </button>
    </header>
  );
}
