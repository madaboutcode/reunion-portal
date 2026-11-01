export type EditorMode = "template" | "per-id";

export interface TopBarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  dirty: boolean;
  onPreview: () => void;
  previewing: boolean;
}

export function TopBar({ mode, onModeChange, dirty, onPreview, previewing }: TopBarProps) {
  return (
    <header className="topbar">
      <h1>ID Card Layout Editor</h1>
      <div className="toggle">
        <button className={mode === "template" ? "active" : ""} onClick={() => onModeChange("template")}>
          Template
        </button>
        <button className={mode === "per-id" ? "active" : ""} onClick={() => onModeChange("per-id")}>
          Per-ID
        </button>
      </div>
      <div className="spacer" />
      {/* Template mode: renders the sample fixture against the current template layout.
          Per-id mode: renders just the selected record against its saved override.
          `dirty` here is mode-appropriate — App.tsx swaps in the per-id override's
          own dirty flag while mode === "per-id" (see App.tsx topBarDirty). */}
      <button
        className="primary preview-btn"
        onClick={onPreview}
        disabled={dirty || previewing}
        title={dirty ? "Save your changes before previewing" : undefined}
      >
        {previewing ? "Rendering…" : "Preview PDF"}
      </button>
      <div className={`unsaved ${dirty ? "" : "clean"}`}>
        <span className="dot" />
        {dirty ? "unsaved" : "saved"}
      </div>
    </header>
  );
}
