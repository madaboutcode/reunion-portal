/**
 * Domain types + pure helpers for the Committee Todo screens.
 *
 * Data comes live from the committee Google Sheet via `@/lib/committee`. Rows have
 * NO machine IDs: `id` is the 1-based sheet row number (also the write address),
 * and a task's `parent` is the parent row's id (position-based — a "- " row belongs
 * to the nearest non-"-" row above it). See tasks/2026-08-08-committee-todo/.
 */

export interface CommitteePerson {
  /** Display name — the sheet's Assignee value and the join key. Unique. */
  name: string;
  /** Registration id (from the `users` tab); builds the CDN photo URL. */
  regid: string | null;
  /** Accent hex for ring + initials-fallback gradient (derived from name). */
  accent: string;
  /** CDN face photo; falls back to gradient initials on missing/error. */
  photoSrc?: string;
}

export interface CommitteeTask {
  /** Sheet row number as a string — the row's write address. */
  id: string;
  title: string;
  /** Person name, or null when unassigned. */
  assignee: string | null;
  /** Parent task id, or null for a top-level task. One level only. */
  parent: string | null;
  due: string | null;
  notes: string | null;
  /** Own completion. For a parent with children, roll-up governs (see isTaskDone). */
  done: boolean;
}

// Brand accents, assigned stably per person name.
const ACCENTS = ["#D76B51", "#2A7A80", "#5BA3A8", "#C77DA0", "#4E7CA1", "#E0A458"];

export function accentFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

// ── Pure helpers ────────────────────────────────────────────────────────────

export function childrenOf(tasks: CommitteeTask[], parentId: string): CommitteeTask[] {
  return tasks.filter((t) => t.parent === parentId);
}

/** Roll-up: a parent with children is done when all children are done. */
export function isTaskDone(task: CommitteeTask, tasks: CommitteeTask[]): boolean {
  const kids = childrenOf(tasks, task.id);
  if (kids.length > 0) return kids.every((k) => k.done);
  return task.done;
}

/** Unassigned if it has no assignee, or an assignee not in the roster
 *  (R29 — unknown folds to unassigned). */
export function isUnassigned(task: CommitteeTask, people: CommitteePerson[]): boolean {
  if (!task.assignee) return true;
  return !people.some((p) => p.name === task.assignee);
}

export function topLevelFor(name: string, tasks: CommitteeTask[]): CommitteeTask[] {
  return tasks.filter((t) => t.parent === null && t.assignee === name);
}

/** Count bubble: open top-level tasks for a person (subtasks/done excluded). */
export function openTopLevelCount(name: string, tasks: CommitteeTask[]): number {
  return topLevelFor(name, tasks).filter((t) => !isTaskDone(t, tasks)).length;
}

export function unassignedTasks(tasks: CommitteeTask[], people: CommitteePerson[]): CommitteeTask[] {
  return tasks.filter((t) => t.parent === null && isUnassigned(t, people));
}

// ── Due dates ───────────────────────────────────────────────────────────────
// The sheet's Due column is free text. When it holds an ISO date (YYYY-MM-DD)
// we can format it and flag overdue; anything else is shown verbatim.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Local today as YYYY-MM-DD (not UTC — avoids date drift near midnight). */
function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True only for an ISO date strictly before today. Non-ISO due text → false. */
export function isOverdue(due: string): boolean {
  return ISO_DATE.test(due) && due < todayISO();
}

/** Pill label: "15 Aug" for ISO dates (month + day, no year); raw text otherwise. */
export function formatDue(due: string): string {
  if (!ISO_DATE.test(due)) return due;
  const [, m, d] = due.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
