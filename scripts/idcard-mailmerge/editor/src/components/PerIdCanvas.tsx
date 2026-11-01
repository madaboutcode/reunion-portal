import { useEffect, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Layout, OverrideFields } from "../core/types";
import { CARD_HEIGHT_MM, CARD_WIDTH_MM } from "../core/constants";
import { mmToPx, dragDeltaMmY } from "../core/geometry";
import { listElements, ptToMm, type ElementRef } from "../layout/elements";
import { bboxToScreenRect } from "../layout/screen";
import { applyPhotoPanDelta } from "../layout/photoPan";
import { fitFontSizePx } from "../layout/textFit";
import { fontFamilyFor, resolveColor } from "../layout/assets";
import type { Layer } from "../layout/layers";
import { isTypingTarget } from "../layout/dom";
import { ElementNode } from "./ElementNode";

/** The only three elements this mode can select/drag — everything else
 * (doodles, logo, static event text, divider, id_badge) is context-only
 * (R19: "doodles are context-only"; the other text-layer elements have no
 * override field at all, so making them draggable-but-unsaved would be a
 * dead end — they render read-only here via the plain ElementNode). */
type PerIdFocusable = "name" | "branch";
type PerIdInteractive = "photo_box" | PerIdFocusable;

export interface PerIdCanvasProps {
  layout: Layout;
  scale: number;
  photoUrl: string;
  photoAlt: string;
  record: { name: string; branch: string };
  edits: OverrideFields;
  activeLayer: Layer;
  focused: PerIdFocusable | null;
  onFocus: (which: PerIdFocusable) => void;
  onPhotoPanChange: (pan: { pan_x: number; pan_y: number }) => void;
  onBaselineChange: (which: PerIdFocusable, baselineDy: number) => void;
}

const NUDGE_STEP_MM = 0.5;
const NUDGE_STEP_SHIFT_MM = 2.0;

function isInteractive(name: PerIdInteractive, activeLayer: Layer): boolean {
  return name === "photo_box" ? activeLayer === "photo_logo" : activeLayer === "text";
}

export function PerIdCanvas({ layout, scale, photoUrl, photoAlt, record, edits, activeLayer, focused, onFocus, onPhotoPanChange, onBaselineChange }: PerIdCanvasProps) {
  const photoDrag = useRef<{ startX: number; startY: number; base: { pan_x: number; pan_y: number } } | null>(null);
  const textDrag = useRef<{ which: PerIdFocusable; startY: number; baseDy: number } | null>(null);
  const onPhotoPanChangeRef = useRef(onPhotoPanChange);
  onPhotoPanChangeRef.current = onPhotoPanChange;
  const onBaselineChangeRef = useRef(onBaselineChange);
  onBaselineChangeRef.current = onBaselineChange;

  const cardWidthPx = mmToPx(CARD_WIDTH_MM, scale);
  const cardHeightPx = mmToPx(CARD_HEIGHT_MM, scale);

  const photoBox = layout.dynamic.photo_box;
  const photoRect = bboxToScreenRect({ x: photoBox.x, y: photoBox.y, w: photoBox.w, h: photoBox.h }, CARD_HEIGHT_MM, scale);
  const boxWidthPx = mmToPx(photoBox.w, scale);
  const boxHeightPx = mmToPx(photoBox.h, scale);

  function handlePhotoPointerDown(e: ReactPointerEvent) {
    if (!isInteractive("photo_box", activeLayer)) return;
    e.stopPropagation();
    photoDrag.current = { startX: e.clientX, startY: e.clientY, base: { pan_x: edits.photo.pan_x, pan_y: edits.photo.pan_y } };

    function handleMove(ev: PointerEvent) {
      const drag = photoDrag.current;
      if (drag === null) return;
      const next = applyPhotoPanDelta(drag.base, ev.clientX - drag.startX, ev.clientY - drag.startY, boxWidthPx, boxHeightPx);
      onPhotoPanChangeRef.current(next);
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      photoDrag.current = null;
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function handleTextPointerDown(which: PerIdFocusable, e: ReactPointerEvent) {
    if (!isInteractive(which, activeLayer)) return;
    e.stopPropagation();
    onFocus(which);
    textDrag.current = { which, startY: e.clientY, baseDy: edits[which].baseline_dy };

    function handleMove(ev: PointerEvent) {
      const drag = textDrag.current;
      if (drag === null) return;
      const dyMm = dragDeltaMmY(ev.clientY - drag.startY, scale);
      onBaselineChangeRef.current(drag.which, drag.baseDy + dyMm);
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      textDrag.current = null;
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  // R13 nudge increments, R19 arrow-key support for name/branch — routes to
  // whichever of the two was last clicked/dragged (`focused`). Selection in
  // the Inspector sense is N/A for per-ID mode (every control is always
  // live), but the canvas still needs *some* target for arrow keys.
  useEffect(() => {
    if (focused === null) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (!isInteractive(focused as PerIdFocusable, activeLayer)) return;
      const step = e.shiftKey ? NUDGE_STEP_SHIFT_MM : NUDGE_STEP_MM;
      const dy = e.key === "ArrowUp" ? step : -step;
      e.preventDefault();
      onBaselineChangeRef.current(focused as PerIdFocusable, edits[focused as PerIdFocusable].baseline_dy + dy);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, activeLayer, edits.name.baseline_dy, edits.branch.baseline_dy]);

  const contextRefs: ElementRef[] = listElements(layout).filter((ref) => ref.name !== "photo_box" && ref.name !== "name" && ref.name !== "branch");

  const nameElem = layout.dynamic.name;
  const branchElem = layout.dynamic.branch;
  const FIT_STEP_PX = mmToPx(ptToMm(0.1), scale);

  function textFieldNode(which: PerIdFocusable, text: string, elem: typeof nameElem) {
    const effectiveMaxSize = edits[which].size_override ?? elem.max_size;
    const effectiveBaseline = elem.baseline + edits[which].baseline_dy;
    const margin = elem.max_width_margin;
    const rect = bboxToScreenRect({ x: margin, y: effectiveBaseline, w: CARD_WIDTH_MM - 2 * margin, h: ptToMm(effectiveMaxSize) }, CARD_HEIGHT_MM, scale);
    const family = fontFamilyFor(elem.font);
    const letterSpacingPx = elem.char_space ? mmToPx(ptToMm(elem.char_space), scale) : 0;
    const fontSizePx = fitFontSizePx(text, family, mmToPx(ptToMm(effectiveMaxSize), scale), mmToPx(ptToMm(elem.min_size), scale), rect.width, letterSpacingPx, FIT_STEP_PX);
    const interactive = isInteractive(which, activeLayer);
    const style: CSSProperties = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      alignItems: "flex-end",
      justifyContent: "center",
      pointerEvents: interactive ? "auto" : "none",
    };
    return (
      <div
        key={which}
        className={["el", interactive ? "clickable" : "not-interactive", focused === which && "selected"].filter(Boolean).join(" ")}
        style={style}
        title={which}
        onPointerDown={(e) => handleTextPointerDown(which, e)}
      >
        <span
          className="field-text"
          style={{
            position: "static",
            fontFamily: family,
            fontSize: fontSizePx,
            color: resolveColor(elem.color),
            letterSpacing: letterSpacingPx ? `${letterSpacingPx}px` : undefined,
            fontKerning: "none",
          }}
        >
          {text}
        </span>
      </div>
    );
  }

  const photoInteractive = isInteractive("photo_box", activeLayer);

  return (
    <section className="canvas-col">
      <h2>
        Canvas ({CARD_WIDTH_MM} × {CARD_HEIGHT_MM} mm, to scale) — override preview
      </h2>
      <div className="card" style={{ width: cardWidthPx, height: cardHeightPx, background: "#171B1B" }}>
        {contextRefs.map((ref) => (
          <ElementNode
            key={`${ref.source}:${ref.name}`}
            layout={layout}
            elementRef={ref}
            scale={scale}
            selected={false}
            interactive={false}
            oob={false}
            onSelect={() => {}}
            onDragStart={() => {}}
          />
        ))}

        <div
          className={["el", "photo-box", photoInteractive ? "clickable" : "not-interactive"].join(" ")}
          style={{
            left: photoRect.left,
            top: photoRect.top,
            width: photoRect.width,
            height: photoRect.height,
            background: resolveColor("coral"),
            borderRadius: mmToPx(photoBox.corner_radius ?? 3.0, scale),
            overflow: "hidden",
            pointerEvents: photoInteractive ? "auto" : "none",
          }}
          title="photo"
          onPointerDown={handlePhotoPointerDown}
        >
          <img
            src={photoUrl}
            alt={photoAlt}
            draggable={false}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: `${edits.photo.pan_x * 100}% ${edits.photo.pan_y * 100}%`,
              transform: `scale(${edits.photo.zoom})`,
              transformOrigin: `${edits.photo.pan_x * 100}% ${edits.photo.pan_y * 100}%`,
              pointerEvents: "none",
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              const parent = e.currentTarget.parentElement;
              if (parent && !parent.querySelector(".photo-broken")) {
                const span = document.createElement("span");
                span.className = "photo-broken";
                span.textContent = "photo unavailable";
                parent.appendChild(span);
              }
            }}
          />
        </div>

        {/* Mirror the renderer, which upper-cases name and branch at draw
            (idcards.py name_display/branch_display), so the canvas preview
            matches the PDF casing. */}
        {textFieldNode("name", record.name.toUpperCase(), nameElem)}
        {textFieldNode("branch", record.branch.toUpperCase(), branchElem)}
      </div>
      <p className="card-caption">
        scale {scale} px/mm · drag the photo to pan, drag name/branch to nudge · arrows nudge the last-touched text field 0.5&nbsp;mm, shift+arrow 2&nbsp;mm · no safe-area guide in this mode
      </p>
    </section>
  );
}
