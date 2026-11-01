/**
 * Per-ID editor (R18–R21): picks one attendee record and edits the three
 * fields that legitimately vary per record (photo pan/zoom, name/branch
 * vertical nudge + optional size). Reuses the template shell's pure layout
 * math (PerIdCanvas mirrors Canvas/ElementNode's geometry, drag, and
 * keyboard-nudge patterns) and the already-landed diffOverride/mergeOverride
 * sparse-save logic — see core/overrideDiff.ts.
 *
 * Unlike the template editor, "selection" doesn't gate a separate inspector
 * panel here: every control (photo zoom, name/branch baseline + size) is
 * always visible once a record is picked (see spec States table). The
 * layer toggle still exists, but only to disambiguate which of photo_box /
 * name / branch a canvas drag targets — not to gate which controls show.
 *
 * Also tracks this record's own dirty state (edits vs. last-saved/loaded
 * snapshot) and reports it up via onPreviewStateChange, so App.tsx can gate
 * the shared TopBar Preview button on it — independent of the template
 * editor's dirty flag.
 */

import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { Layout, Manifest, ManifestCard, OverrideFields } from "../core/types";
import { OVERRIDE_DEFAULTS } from "../core/constants";
import { diffOverride, mergeOverride } from "../core/overrideDiff";
import { nextRecordIndex } from "../core/recordNav";
import { deleteOverride, getLayout, getManifest, getOverride, putOverride } from "../api";
import { portraitUrl } from "../layout/assets";
import { isTypingTarget } from "../layout/dom";
import type { Layer } from "../layout/layers";
import { PerIdCanvas } from "./PerIdCanvas";

const SCALE_PX_PER_MM = 7; // matches the template canvas (App.tsx)
const ZOOM_MIN = 1.0;
const ZOOM_MAX = 2.5;

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

/** What App.tsx needs to gate and drive the shared TopBar Preview button
 * while in per-id mode — independent of the template editor's own dirty
 * flag (you can have unsaved template edits with a clean override, or vice
 * versa). */
export interface PerIdPreviewState {
  selectedId: string;
  /** True only once a record is selected, its override has finished
   * loading, and the current edits match the last-saved (or last-loaded/
   * cleared) snapshot — i.e. there is nothing unsaved to lose by previewing
   * stale state. */
  canPreview: boolean;
}

export interface PerIdEditorProps {
  onPreviewStateChange?: (state: PerIdPreviewState) => void;
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Field-by-field comparison rather than JSON.stringify — explicit about
 * exactly which values make a record's override "unsaved", independent of
 * object key order. */
function overrideFieldsEqual(a: OverrideFields, b: OverrideFields): boolean {
  return (
    a.photo.pan_x === b.photo.pan_x &&
    a.photo.pan_y === b.photo.pan_y &&
    a.photo.zoom === b.photo.zoom &&
    a.name.baseline_dy === b.name.baseline_dy &&
    a.name.size_override === b.name.size_override &&
    a.name.text === b.name.text &&
    a.branch.baseline_dy === b.branch.baseline_dy &&
    a.branch.size_override === b.branch.size_override
  );
}

export function PerIdEditor({ onPreviewStateChange }: PerIdEditorProps) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestState, setManifestState] = useState<LoadState>({ status: "loading" });
  const [layout, setLayout] = useState<Layout | null>(null);
  const [layoutState, setLayoutState] = useState<LoadState>({ status: "loading" });

  const [selectedId, setSelectedId] = useState<string>("");
  const [edits, setEdits] = useState<OverrideFields | null>(null);
  // The last-saved (or last-loaded/cleared) override snapshot — edits
  // diverging from this is what "unsaved" means for this record, tracked
  // independently of the template editor's own dirty flag.
  const [savedSnapshot, setSavedSnapshot] = useState<OverrideFields | null>(null);
  const [recordState, setRecordState] = useState<LoadState>({ status: "ready" });
  const [activeLayer, setActiveLayer] = useState<Layer>("photo_logo");
  const [focused, setFocused] = useState<"name" | "branch" | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    void getManifest()
      .then((m) => {
        setManifest(m);
        setManifestState({ status: "ready" });
      })
      .catch((err) => setManifestState({ status: "error", message: err instanceof Error ? err.message : String(err) }));

    void getLayout()
      .then((l) => {
        setLayout(l);
        setLayoutState({ status: "ready" });
      })
      .catch((err) => setLayoutState({ status: "error", message: err instanceof Error ? err.message : String(err) }));
  }, []);

  const loadRecordOverride = useCallback(async (id: string) => {
    if (!id) return;
    setRecordState({ status: "loading" });
    try {
      const sparse = await getOverride(id);
      const merged = mergeOverride(sparse, OVERRIDE_DEFAULTS);
      setEdits(merged);
      setSavedSnapshot(merged);
      setFocused(null);
      setRecordState({ status: "ready" });
    } catch (err) {
      setRecordState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  function handleSelectRecord(e: ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setSelectedId(id);
    void loadRecordOverride(id);
  }

  // Left/Right arrows step to the prev/next record. Up/Down stay reserved for
  // the canvas baseline nudge (R13), and we defer to normal caret movement
  // while typing in an input (e.g. the display-name field). Like the picker,
  // this loads the target record's override — unsaved edits are not preserved.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isTypingTarget(e.target)) return;
      const cards = manifest?.cards ?? [];
      const current = cards.findIndex((c) => c.attendee_id === selectedId);
      const target = nextRecordIndex(cards.length, current, e.key === "ArrowRight" ? 1 : -1);
      const record = target === null ? undefined : cards[target];
      if (!record) return;
      e.preventDefault();
      setSelectedId(record.attendee_id);
      void loadRecordOverride(record.attendee_id);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [manifest, selectedId, loadRecordOverride]);

  async function handleSave() {
    if (!selectedId || !edits) return;
    setSaving(true);
    try {
      await putOverride(selectedId, diffOverride(edits, OVERRIDE_DEFAULTS));
      setSavedSnapshot(edits);
    } catch (err) {
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!selectedId) return;
    if (!window.confirm(`Clear the override for record "${selectedId}"? This deletes its override file and reverts to template defaults.`)) return;
    setClearing(true);
    try {
      await deleteOverride(selectedId);
      const cleared = mergeOverride({}, OVERRIDE_DEFAULTS);
      setEdits(cleared);
      setSavedSnapshot(cleared);
    } catch (err) {
      window.alert(`Clear failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClearing(false);
    }
  }

  const dirty = edits !== null && savedSnapshot !== null && !overrideFieldsEqual(edits, savedSnapshot);
  const canPreview = selectedId !== "" && recordState.status === "ready" && !dirty;

  // Only re-notify the parent when what it actually needs (selectedId,
  // canPreview) changes — not on every render, since onPreviewStateChange
  // is a fresh closure each time App.tsx re-renders.
  useEffect(() => {
    onPreviewStateChange?.({ selectedId, canPreview });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, canPreview]);

  const record: ManifestCard | undefined = manifest?.cards.find((c) => c.attendee_id === selectedId);

  if (manifestState.status === "loading" || layoutState.status === "loading") {
    return <div className="load-state">Loading manifest and template layout…</div>;
  }
  if (manifestState.status === "error") {
    return <div className="load-state error">Failed to load the attendee manifest:{"\n"}{manifestState.message}</div>;
  }
  if (layoutState.status === "error") {
    return <div className="load-state error">Failed to load the template layout:{"\n"}{layoutState.message}</div>;
  }
  if (!manifest || !layout) return null;

  return (
    <>
    <div className="body">
      <aside className="panel">
        <h2>Record</h2>
        <select className="record-picker" value={selectedId} onChange={handleSelectRecord}>
          <option value="" disabled>
            Select an attendee…
          </option>
          {manifest.cards.map((c) => (
            <option key={c.attendee_id} value={c.attendee_id}>
              {c.attendee_id} — {c.name}
            </option>
          ))}
        </select>
        <p className="panel-note">
          Manifest source: {manifest.source === "local-dump" ? "local attendee dump" : "bundled sample"} ({manifest.cards.length} record{manifest.cards.length === 1 ? "" : "s"})
        </p>
        <p className="panel-note">Press ← / → to move to the previous / next record.</p>

        <h2 className="elem-list-head">Layer</h2>
        <p className="elem-list-sub">which field canvas drags target:</p>
        <ul className="layers">
          <li>
            <label>
              <input type="radio" name="per-id-layer" checked={activeLayer === "photo_logo"} onChange={() => setActiveLayer("photo_logo")} />
              photo/logo
            </label>
          </li>
          <li>
            <label>
              <input type="radio" name="per-id-layer" checked={activeLayer === "text"} onChange={() => setActiveLayer("text")} />
              text
            </label>
          </li>
        </ul>

        <button onClick={handleClear} disabled={!selectedId || clearing || saving}>
          {clearing ? "Clearing…" : "Clear override for this record"}
        </button>
        <p className="panel-note">Doodles and the logo are context-only in this mode (R19) — not editable here.</p>
      </aside>

      {!selectedId ? (
        <div className="load-state">Pick a record from the left to start editing its override.</div>
      ) : recordState.status === "loading" ? (
        <div className="load-state">Loading record…</div>
      ) : recordState.status === "error" ? (
        <div className="load-state error">Failed to load the override for "{selectedId}":{"\n"}{recordState.message}</div>
      ) : edits && record ? (
        <>
          <PerIdCanvas
            layout={layout}
            scale={SCALE_PX_PER_MM}
            photoUrl={portraitUrl(selectedId)}
            photoAlt={`${record.name} portrait`}
            record={{ name: edits.name.text?.trim() ? edits.name.text.trim() : record.name, branch: record.branch }}
            edits={edits}
            activeLayer={activeLayer}
            focused={focused}
            onFocus={setFocused}
            onPhotoPanChange={(pan) => setEdits((prev) => (prev ? { ...prev, photo: { ...prev.photo, ...pan } } : prev))}
            onBaselineChange={(which, baselineDy) => setEdits((prev) => (prev ? { ...prev, [which]: { ...prev[which], baseline_dy: baselineDy } } : prev))}
          />

          <aside className="inspector">
            <h2>Override fields</h2>

            <div className="ctrl-group">
              <h3>Photo</h3>
              <div className="ctrl">
                <label htmlFor="photo-zoom">
                  Zoom <span className="value">{edits.photo.zoom.toFixed(2)}×</span>
                </label>
                <input
                  id="photo-zoom"
                  type="range"
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={0.05}
                  value={edits.photo.zoom}
                  onChange={(e) => {
                    const zoom = clampZoom(Number(e.target.value));
                    setEdits((prev) => (prev ? { ...prev, photo: { ...prev.photo, zoom } } : prev));
                  }}
                />
              </div>
              <p className="inspector-note">
                Pan: {edits.photo.pan_x.toFixed(2)}, {edits.photo.pan_y.toFixed(2)} — drag the photo on canvas to pan (active layer: photo/logo).
              </p>
            </div>

            <div className="ctrl-group">
              <h3>Name</h3>
              <div className="ctrl">
                <label htmlFor="name-text">
                  Display name <span className="value">{edits.name.text?.trim() ? "custom" : "manifest"}</span>
                </label>
                <input
                  id="name-text"
                  type="text"
                  value={edits.name.text ?? record.name}
                  onChange={(e) => {
                    const raw = e.target.value;
                    // Prefilled with the manifest name; only persist an override
                    // when it actually differs. Empty, or matching the manifest
                    // name case-insensitively (the renderer upper-cases both, so
                    // a case-only edit renders identically), collapses to null so
                    // the sparse save writes no `text`.
                    const text =
                      raw.trim() === "" || raw.trim().toUpperCase() === record.name.trim().toUpperCase() ? null : raw;
                    setEdits((prev) => (prev ? { ...prev, name: { ...prev.name, text } } : prev));
                  }}
                />
              </div>
              <TextOverrideControls which="name" edits={edits} setEdits={setEdits} />
            </div>

            <div className="ctrl-group">
              <h3>Branch</h3>
              <TextOverrideControls which="branch" edits={edits} setEdits={setEdits} />
            </div>

            <p className="inspector-note">Arrows nudge the last-touched text field 0.5&nbsp;mm, Shift+arrow 2&nbsp;mm (R13).</p>
            <p className="inspector-note">Only these three fields are saved (R19/R20) — nothing else on canvas is editable in this mode.</p>
          </aside>
        </>
      ) : null}
    </div>
    <footer className="bottombar">
      <span className="per-id-savebar-note">{selectedId ? `Editing override for "${selectedId}"` : "No record selected"}</span>
      <button className="primary" onClick={handleSave} disabled={!selectedId || saving || clearing}>
        {saving ? "Saving…" : "Save"}
      </button>
    </footer>
    </>
  );
}

function TextOverrideControls({
  which,
  edits,
  setEdits,
}: {
  which: "name" | "branch";
  edits: OverrideFields;
  setEdits: (updater: (prev: OverrideFields | null) => OverrideFields | null) => void;
}) {
  const field = edits[which];
  return (
    <>
      <div className="ctrl">
        <label htmlFor={`${which}-baseline`}>
          Vertical offset <span className="value">{field.baseline_dy >= 0 ? "+" : ""}{field.baseline_dy.toFixed(1)}&nbsp;mm</span>
        </label>
        <input
          id={`${which}-baseline`}
          type="number"
          step={0.5}
          value={field.baseline_dy}
          onChange={(e) => {
            const dy = Number(e.target.value);
            if (!Number.isFinite(dy)) return;
            setEdits((prev) => (prev ? { ...prev, [which]: { ...prev[which], baseline_dy: dy } } : prev));
          }}
        />
      </div>
      <div className="ctrl">
        <label htmlFor={`${which}-size`}>
          Size override (pt) <span className="value">{field.size_override === null ? "template" : field.size_override}</span>
        </label>
        <input
          id={`${which}-size`}
          type="number"
          step={0.1}
          placeholder="blank = template size"
          value={field.size_override ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            const size = raw.trim() === "" ? null : Number(raw);
            if (size !== null && !Number.isFinite(size)) return;
            setEdits((prev) => (prev ? { ...prev, [which]: { ...prev[which], size_override: size } } : prev));
          }}
        />
      </div>
    </>
  );
}
