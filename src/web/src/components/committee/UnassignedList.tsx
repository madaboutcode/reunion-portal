import { Button } from "@/components/ui/Button";
import type { CommitteePerson, CommitteeTask } from "./model";
import { unassignedTasks } from "./model";
import { ScreenHeader } from "./PersonTodoList";

export interface UnassignedListProps {
  people: CommitteePerson[];
  tasks: CommitteeTask[];
  onBack: () => void;
  onReload: () => void;
  onToggle: (id: string) => void;
  onAssign: (id: string, name: string) => void;
}

export function UnassignedList({
  people,
  tasks,
  onBack,
  onReload,
  onToggle,
  onAssign,
}: UnassignedListProps) {
  const items = unassignedTasks(tasks, people);

  return (
    <div>
      <ScreenHeader onBack={onBack} onReload={onReload}>
        Unassigned
      </ScreenHeader>

      <div className="space-y-3 px-4 pb-16 pt-4">
        {items.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">Nothing unassigned. </p>
        )}

        {items.map((task) => (
          <div key={task.id} className="rounded-2xl bg-surface px-3 py-3 shadow-[0_1px_4px_rgba(31,42,51,0.06)]">
            <p className="text-[17px] font-medium text-charcoal">{task.title}</p>
            <div className="mt-2 flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) onAssign(task.id, e.target.value);
                  }}
                  aria-label={`Assign "${task.title}" to someone`}
                  className="h-11 w-full appearance-none rounded-xl border-[1.5px] border-border bg-white px-3 pr-8 text-sm font-semibold text-charcoal outline-none focus:border-terracotta"
                >
                  <option value="" disabled>
                    assign to…
                  </option>
                  {people.map((p) => (
                    <option key={p.regid} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
                  ▼
                </span>
              </div>
              <Button variant="secondary" onClick={() => onToggle(task.id)}>
                done
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
