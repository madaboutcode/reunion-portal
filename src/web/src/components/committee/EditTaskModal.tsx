import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import type { CommitteeTask } from "./model";

export interface EditTaskModalProps {
  task: CommitteeTask;
  onClose: () => void;
  onSave: (patch: { title: string; due: string | null; notes: string | null }) => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Edit a task's text, due date, and notes. Assignee + done state are managed
 *  elsewhere (claim / tap-to-complete), so they're deliberately absent here. */
export function EditTaskModal({ task, onClose, onSave }: EditTaskModalProps) {
  const [title, setTitle] = useState(task.title);
  // A native date input can only hold ISO. A legacy non-ISO due (rare) shows as
  // a hint below and is preserved unless the user picks a new date.
  const initialDue = task.due && ISO_DATE.test(task.due) ? task.due : "";
  const [due, setDue] = useState(initialDue);
  const [notes, setNotes] = useState(task.notes ?? "");

  const legacyDue = task.due && !ISO_DATE.test(task.due) ? task.due : null;
  const canSave = title.trim() !== "";

  // Close on Escape from anywhere in the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSave() {
    if (!canSave) return;
    onSave({
      title: title.trim(),
      // Empty date field clears the due; a legacy value survives if untouched.
      due: due.trim() ? due.trim() : legacyDue,
      notes: notes.trim() || null,
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 animate-[fadeIn_0.18s_ease] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Edit task"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-xl animate-[fadeSlideIn_0.24s_cubic-bezier(0.22,1,0.36,1)] sm:rounded-2xl"
      >
        <div className="border-b border-border-warm px-5 py-4">
          <h2 className="font-heading text-lg font-bold text-charcoal">Edit task</h2>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-charcoal">Task</label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-charcoal">Due date</label>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="h-11 w-full rounded-[10px] border-[1.5px] border-border bg-white px-[14px] text-[15px] text-charcoal outline-none transition-[border-color] focus:border-soft-aqua"
            />
            {legacyDue && !due && (
              <p className="mt-1 text-xs text-muted">
                Currently “{legacyDue}” — pick a date to replace it.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-charcoal">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering…"
              rows={3}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-warm px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
