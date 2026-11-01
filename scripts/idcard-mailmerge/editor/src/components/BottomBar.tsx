export interface BottomBarProps {
  onReset: () => void;
  onSave: () => void;
  saving: boolean;
  resetting: boolean;
}

export function BottomBar({ onReset, onSave, saving, resetting }: BottomBarProps) {
  return (
    <footer className="bottombar">
      <button onClick={onReset} disabled={saving || resetting}>
        {resetting ? "Resetting…" : "Reset to defaults"}
      </button>
      <button className="primary" onClick={onSave} disabled={saving || resetting}>
        {saving ? "Saving…" : "Save"}
      </button>
    </footer>
  );
}
