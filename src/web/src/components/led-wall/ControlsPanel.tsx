import { useEffect, useState } from "react";
import type { LedWallParams } from "./types";
import { LED_WALL_CONTROL_SECTIONS } from "./defaults";

interface ControlsPanelProps {
  params: LedWallParams;
  onChange: (params: LedWallParams) => void;
  onReset: () => void;
}

export function ControlsPanel({ params, onChange, onReset }: ControlsPanelProps) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [sections, setSections] = useState<Record<string, boolean>>({ wall: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "/") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function copyValues() {
    const text = JSON.stringify(params, null, 2);
    // Only claim success once the write actually resolves — clipboard access can be
    // unavailable (no navigator.clipboard, e.g. an insecure context) or rejected (denied
    // permission); either way, that's a failure to report, not a silent "copied".
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  }

  function update(key: keyof LedWallParams, value: number | boolean) {
    onChange({ ...params, [key]: value });
  }

  return (
    <aside className={`led-wall-controls ${open ? "led-wall-controls--open" : ""}`}>
      <div className="led-wall-controls__toolbar">
        <button type="button" onClick={() => setOpen((value) => !value)}>{open ? "hide  /" : "controls  /"}</button>
        {open && (
          <button type="button" onClick={() => void copyValues()}>
            {copyState === "copied" ? "copied" : copyState === "failed" ? "copy failed" : "copy values"}
          </button>
        )}
        {open && <button type="button" onClick={onReset}>reset</button>}
      </div>
      {open && (
        <div className="led-wall-controls__body">
          {LED_WALL_CONTROL_SECTIONS.map((section) => {
            const sectionOpen = sections[section.key] ?? false;
            return (
              <section key={section.key} className="led-wall-controls__section">
                <button type="button" className="led-wall-controls__heading" onClick={() => setSections((value) => ({ ...value, [section.key]: !sectionOpen }))}>
                  <span>{section.label}</span><span>{sectionOpen ? "−" : "+"}</span>
                </button>
                {sectionOpen && (
                  <div className="led-wall-controls__fields">
                    {section.fields.map((field) => {
                      const value = params[field.key];
                      if (field.kind === "boolean") {
                        return (
                          <label key={field.key} className="led-wall-controls__check">
                            <input type="checkbox" checked={value as boolean} onChange={(event) => update(field.key, event.target.checked)} />
                            {field.label}
                          </label>
                        );
                      }
                      return (
                        <label key={field.key} className="led-wall-controls__field">
                          <span>{field.label}</span>
                          <input
                            type="number"
                            value={value as number}
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            onChange={(event) => update(field.key, Number(event.target.value))}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}
