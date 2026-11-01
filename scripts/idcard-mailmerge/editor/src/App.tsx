import { useCallback, useEffect, useMemo, useState } from "react";
import type { Layout } from "./core/types";
import { editableFields } from "./core/fieldMap";
import { crossesSafeArea } from "./core/safeArea";
import { getDefaults, getLayout, putLayout, renderPreview } from "./api";
import { bboxFor, listElements, updateElement, type ElementRef } from "./layout/elements";
import { applyPositionDelta } from "./layout/position";
import type { Layer } from "./layout/layers";
import type { SizeMm } from "./layout/scale";
import { TopBar, type EditorMode } from "./components/TopBar";
import { BottomBar } from "./components/BottomBar";
import { LayerPanel } from "./components/LayerPanel";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { PerIdEditor, type PerIdPreviewState } from "./components/PerIdEditor";

const SCALE_PX_PER_MM = 7; // matches the wireframe's to-scale canvas (R6)

function refKey(ref: ElementRef): string {
  return `${ref.source}:${ref.name}`;
}

/** Captures each scale-capable element's w/h at load/reset time — the
 * inspector's Scale % control (R12) is relative to this baseline, not to
 * any fixed absolute size. */
function computeBaselineSizes(layout: Layout): Record<string, SizeMm> {
  const sizes: Record<string, SizeMm> = {};
  for (const ref of listElements(layout)) {
    if (!editableFields(ref.kind).scale) continue;
    const bbox = bboxFor(layout, ref);
    sizes[refKey(ref)] = { w: bbox.w, h: bbox.h };
  }
  return sizes;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

export function App() {
  const [mode, setMode] = useState<EditorMode>("template");
  const [layout, setLayout] = useState<Layout | null>(null);
  const [baselineSizes, setBaselineSizes] = useState<Record<string, SizeMm>>({});
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeLayer, setActiveLayer] = useState<Layer>("doodles");
  const [selectedRef, setSelectedRef] = useState<ElementRef | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Reported up by PerIdEditor — the per-id Preview button (also the shared
  // TopBar button, while mode === "per-id") is gated on THIS, not on the
  // template's `dirty` flag above; the two are independent.
  const [perIdPreview, setPerIdPreview] = useState<PerIdPreviewState>({ selectedId: "", canPreview: false });
  // Forces one re-render once the bundled @font-face fonts finish loading
  // (R6.1), so the canvas's text auto-fit (textFit.ts) measures against the
  // real card typeface instead of the browser's temporary fallback.
  //
  // document.fonts.ready alone isn't enough: a @font-face rule doesn't
  // start fetching until something actually USES the family, and .ready
  // resolves immediately if nothing has triggered a load yet — so the
  // canvas's first measureText can run against a fallback font before the
  // real one has even started downloading, and nothing ever recomputes the
  // fit once it does finish. Explicitly load() each family first so the
  // fetch is definitely in flight (and, once it resolves, definitely done)
  // before flipping fontsReady.
  const [, setFontsReady] = useState(false);

  useEffect(() => {
    const families = ["SmritiCardRegular", "SmritiCardDisplay", "SmritiCardHeavy"];
    Promise.all(families.map((f) => document.fonts.load(`16px "${f}"`)))
      .then(() => document.fonts.ready)
      .then(() => setFontsReady(true))
      .catch(() => setFontsReady(true)); // still flip so we never hang on a load error
  }, []);

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const l = await getLayout();
      setLayout(l);
      setBaselineSizes(computeBaselineSizes(l));
      setDirty(false);
      setSelectedRef(null);
      setLoadState({ status: "ready" });
    } catch (err) {
      setLoadState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refs = useMemo(() => (layout ? listElements(layout) : []), [layout]);

  const oobKeys = useMemo(() => {
    if (!layout) return new Set<string>();
    const set = new Set<string>();
    for (const ref of refs) {
      if (crossesSafeArea(bboxFor(layout, ref))) set.add(refKey(ref));
    }
    return set;
  }, [layout, refs]);

  const elementsInActiveLayer = useMemo(() => refs.filter((r) => r.layer === activeLayer), [refs, activeLayer]);

  function handleSelect(ref: ElementRef) {
    setSelectedRef(ref);
  }

  function handleLayerChange(layer: Layer) {
    setActiveLayer(layer);
  }

  function handleLayoutReplace(next: Layout) {
    setLayout(next);
    setDirty(true);
  }

  function handleDragEnd() {
    // Position already committed live during the drag (handleLayoutReplace);
    // nothing left to do but the drag session itself has ended.
  }

  function handleNudge(ref: ElementRef, dxMm: number, dyMm: number) {
    setLayout((prev) => (prev ? applyPositionDelta(prev, ref, dxMm, dyMm) : prev));
    setDirty(true);
  }

  function handleInspectorUpdate(ref: ElementRef, updater: (el: unknown) => unknown) {
    setLayout((prev) => (prev ? updateElement(prev, ref, updater as Parameters<typeof updateElement>[2]) : prev));
    setDirty(true);
  }

  async function handleSave() {
    if (!layout) return;
    setSaving(true);
    try {
      await putLayout(layout);
      setDirty(false);
      // Signals that Preview PDF (disabled while dirty) now renders this
      // saved state — see handlePreview.
      setToast("Layout saved");
      setTimeout(() => setToast(null), 2500);
    } catch (err) {
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  // Preview always renders whatever is on disk (see api.ts renderPreview),
  // never unsaved edits — the button is disabled while the relevant dirty
  // flag is set (template's `dirty` in template mode, PerIdEditor's own
  // per-record dirty in per-id mode; see perIdPreview), so Save is required
  // first either way. Opens the tab synchronously (before the await) so
  // Safari/Chrome don't treat the later navigation as a blocked popup.
  async function handlePreview() {
    if (mode === "template") {
      if (!layout || dirty) return;
    } else {
      if (!perIdPreview.canPreview) return;
    }
    const w = window.open("", "_blank");
    setPreviewing(true);
    try {
      await renderPreview(mode === "per-id" ? perIdPreview.selectedId : undefined);
      if (w) w.location.href = "/api/preview.pdf?t=" + Date.now();
    } catch (err) {
      w?.close();
      window.alert(`Preview failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleReset() {
    if (!window.confirm("Reset the template layout to its shipped defaults? This overwrites the saved file on disk.")) return;
    setResetting(true);
    try {
      const defaults = await getDefaults();
      await putLayout(defaults);
      setLayout(defaults);
      setBaselineSizes(computeBaselineSizes(defaults));
      setDirty(false);
      setSelectedRef(null);
    } catch (err) {
      window.alert(`Reset failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setResetting(false);
    }
  }

  const topBarDirty = mode === "per-id" ? !perIdPreview.canPreview : dirty;

  return (
    <div className="app">
      <TopBar mode={mode} onModeChange={setMode} dirty={topBarDirty} onPreview={handlePreview} previewing={previewing} />

      {mode === "per-id" ? (
        <PerIdEditor onPreviewStateChange={setPerIdPreview} />
      ) : loadState.status === "loading" ? (
        <div className="load-state">Loading template layout…</div>
      ) : loadState.status === "error" ? (
        <div className="load-state error">Failed to load the template layout:{"\n"}{loadState.message}</div>
      ) : layout ? (
        <div className="body">
          <LayerPanel
            activeLayer={activeLayer}
            onLayerChange={handleLayerChange}
            elementsInActiveLayer={elementsInActiveLayer}
            selectedRef={selectedRef}
            onSelect={handleSelect}
            oobNames={oobKeys}
          />
          <Canvas
            layout={layout}
            scale={SCALE_PX_PER_MM}
            activeLayer={activeLayer}
            selectedRef={selectedRef}
            refs={refs}
            refKey={refKey}
            oobKeys={oobKeys}
            onSelect={handleSelect}
            onLayoutReplace={handleLayoutReplace}
            onDragEnd={handleDragEnd}
            onNudge={handleNudge}
          />
          <Inspector layout={layout} selectedRef={selectedRef} baselineSizes={baselineSizes} refKey={refKey} onUpdate={handleInspectorUpdate} />
        </div>
      ) : null}

      {mode === "template" && loadState.status === "ready" && <BottomBar onReset={handleReset} onSave={handleSave} saving={saving} resetting={resetting} />}

      <p className="caption">
        Red outline = crosses safe area (R15), advisory only — Save stays enabled. Logo always draws topmost among static elements regardless of z.
      </p>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
