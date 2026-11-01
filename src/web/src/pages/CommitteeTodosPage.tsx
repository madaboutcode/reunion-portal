import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useToast } from "@/components/ui/Toast";
import { PeopleGrid } from "@/components/committee/PeopleGrid";
import { InstallPrompt } from "@/components/committee/InstallPrompt";
import { PersonTodoList } from "@/components/committee/PersonTodoList";
import { UnassignedList } from "@/components/committee/UnassignedList";
import type { CommitteeTask } from "@/components/committee/model";
import {
  fetchCommitteeBoard,
  mutateCommittee,
  type CommitteeBoard,
} from "@/lib/committee";
import { ApiError } from "@/lib/http";

type View =
  | { screen: "grid" }
  | { screen: "person"; name: string }
  | { screen: "unassigned" };

const VIEW_KEY = "committee_todos_view";

/** Restore the last-viewed screen (R26/R27). Person validity is checked at
 *  render against the loaded roster; unknown/missing person → grid. */
function restoreView(): View {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return { screen: "grid" };
    const parsed = JSON.parse(raw) as View;
    if (parsed.screen === "unassigned") return parsed;
    if (parsed.screen === "person" && typeof parsed.name === "string") return parsed;
    return { screen: "grid" };
  } catch {
    return { screen: "grid" };
  }
}

const PAGE_BG =
  "radial-gradient(ellipse at 10% 0%, rgba(185,223,226,0.22) 0%, transparent 55%), radial-gradient(ellipse at 90% 100%, rgba(215,107,81,0.10) 0%, transparent 55%), #f5f0e8";

export default function CommitteeTodosPage() {
  useDocumentTitle("Backstage");
  const toast = useToast();

  const [board, setBoard] = useState<CommitteeBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [view, setView] = useState<View>(restoreView);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setBoard(await fetchCommitteeBoard());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  }, [view]);

  const tasks = board?.tasks ?? [];
  const people = board?.people ?? [];
  const findTask = (id: string) => tasks.find((t) => t.id === id);

  /** Run a mutation: optional optimistic tweak for snap, then reconcile with the
   *  server's fresh board. On conflict (row changed in the sheet) or error, reload. */
  async function apply(
    m: Parameters<typeof mutateCommittee>[0],
    optimistic?: (ts: CommitteeTask[]) => CommitteeTask[],
  ) {
    if (optimistic && board) {
      setBoard({ ...board, tasks: optimistic(board.tasks) });
    }
    try {
      setBoard(await mutateCommittee(m));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error("That item changed in the sheet — reloading.");
      } else {
        toast.error("Couldn't save that. Reloading the list.");
      }
      void load();
    }
  }

  function toggle(id: string) {
    const t = findTask(id);
    if (!t) return;
    apply(
      { op: "toggle", row: Number(id), expectTask: t.title },
      (ts) => ts.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
    );
  }

  function addTask(assignee: string, title: string) {
    apply({ op: "add", assignee, title });
  }

  function addSubtask(parentId: string, title: string) {
    const p = findTask(parentId);
    if (!p) return;
    apply({ op: "addSub", parentRow: Number(parentId), expectParentTask: p.title, title });
  }

  function assign(id: string, name: string) {
    const t = findTask(id);
    if (!t) return;
    apply({ op: "assign", row: Number(id), expectTask: t.title, assignee: name });
  }

  function editTask(
    id: string,
    patch: { title: string; due: string | null; notes: string | null },
  ) {
    const t = findTask(id);
    if (!t) return;
    apply(
      { op: "edit", row: Number(id), expectTask: t.title, ...patch },
      (ts) =>
        ts.map((x) =>
          x.id === id ? { ...x, title: patch.title, due: patch.due, notes: patch.notes } : x,
        ),
    );
  }

  // A detail screen (a person's list or the unassigned list) is showing when the
  // view is unassigned, or a person that resolves against the loaded roster.
  const person =
    view.screen === "person" ? people.find((p) => p.name === view.name) ?? null : null;
  const atDetail = view.screen === "unassigned" || (view.screen === "person" && !!person);

  // Keep the last detail mounted while sliding back to the roster, so its content
  // doesn't blank mid-transition.
  const [lastDetail, setLastDetail] = useState<View | null>(null);
  useEffect(() => {
    if (atDetail) setLastDetail(view);
  }, [atDetail, view]);
  const detail = atDetail ? view : lastDetail;
  const detailPerson =
    detail?.screen === "person" ? people.find((p) => p.name === detail.name) ?? null : null;

  // Each lane scrolls internally (the track slides horizontally). Reset the
  // incoming lane to the top on navigation — no shared window scroll to reuse.
  const rosterLane = useRef<HTMLDivElement>(null);
  const detailLane = useRef<HTMLDivElement>(null);
  const detailKey = detail?.screen === "person" ? `person:${detail.name}` : detail?.screen ?? "";
  useEffect(() => {
    if (atDetail) detailLane.current?.scrollTo(0, 0);
  }, [atDetail, detailKey]);
  useEffect(() => {
    if (!atDetail) rosterLane.current?.scrollTo(0, 0);
  }, [atDetail]);

  const backToRoster = () => setView({ screen: "grid" });

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: PAGE_BG }}>
      <div className="mx-auto h-full max-w-md overflow-hidden">
        {loading && !board && (
          <p className="py-20 text-center text-sm text-muted">Loading…</p>
        )}

        {error && !board && (
          <div className="py-20 text-center">
            <p className="text-sm text-muted">Couldn't load the list.</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 font-semibold text-terracotta"
            >
              Try again
            </button>
          </div>
        )}

        {board && (
          <div
            className="flex h-full w-[200%] transition-transform duration-[280ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ transform: atDetail ? "translateX(-50%)" : "translateX(0)" }}
          >
            {/* Lane 1 — roster */}
            <div
              ref={rosterLane}
              className="h-full w-1/2 overflow-y-auto overflow-x-hidden [scrollbar-width:none]"
            >
              <PeopleGrid
                people={people}
                tasks={tasks}
                onOpenPerson={(name) => setView({ screen: "person", name })}
                onOpenUnassigned={() => setView({ screen: "unassigned" })}
              />
            </div>

            {/* Lane 2 — detail (person or unassigned) */}
            <div
              ref={detailLane}
              className="h-full w-1/2 overflow-y-auto overflow-x-hidden [scrollbar-width:none]"
            >
              {detail?.screen === "person" && detailPerson && (
                <PersonTodoList
                  person={detailPerson}
                  people={people}
                  tasks={tasks}
                  onBack={backToRoster}
                  onReload={() => void load()}
                  onToggle={toggle}
                  onAddTask={(title) => addTask(detailPerson.name, title)}
                  onAddSubtask={addSubtask}
                  onClaim={(id) => assign(id, detailPerson.name)}
                  onEdit={editTask}
                />
              )}
              {detail?.screen === "unassigned" && (
                <UnassignedList
                  people={people}
                  tasks={tasks}
                  onBack={backToRoster}
                  onReload={() => void load()}
                  onToggle={toggle}
                  onAssign={assign}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <InstallPrompt />
    </div>
  );
}
