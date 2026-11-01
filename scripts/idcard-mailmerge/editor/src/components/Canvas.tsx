import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Layout } from "../core/types";
import { CARD_HEIGHT_MM, CARD_WIDTH_MM, SAFE_AREA_INSET_MM } from "../core/constants";
import { mmToPx } from "../core/geometry";
import type { ElementRef } from "../layout/elements";
import { applyPositionDelta } from "../layout/position";
import { screenDeltaToLayoutDeltaMm } from "../layout/screen";
import type { Layer } from "../layout/layers";
import { isTypingTarget } from "../layout/dom";
import { ElementNode } from "./ElementNode";

export interface CanvasProps {
  layout: Layout;
  scale: number;
  activeLayer: Layer;
  selectedRef: ElementRef | null;
  refs: ElementRef[];
  refKey: (ref: ElementRef) => string;
  oobKeys: Set<string>;
  onSelect: (ref: ElementRef) => void;
  onLayoutReplace: (layout: Layout) => void;
  onDragEnd: () => void;
  onNudge: (ref: ElementRef, dxMm: number, dyMm: number) => void;
}

interface DragState {
  ref: ElementRef;
  startClientX: number;
  startClientY: number;
  baseLayout: Layout;
}

const NUDGE_STEP_MM = 0.5;
const NUDGE_STEP_SHIFT_MM = 2.0;

export function Canvas({ layout, scale, activeLayer, selectedRef, refs, refKey, oobKeys, onSelect, onLayoutReplace, onDragEnd, onNudge }: CanvasProps) {
  const dragRef = useRef<DragState | null>(null);
  const onLayoutReplaceRef = useRef(onLayoutReplace);
  onLayoutReplaceRef.current = onLayoutReplace;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  function handleDragStart(ref: ElementRef, e: ReactPointerEvent) {
    dragRef.current = { ref, startClientX: e.clientX, startClientY: e.clientY, baseLayout: layout };

    function handleMove(ev: PointerEvent) {
      const drag = dragRef.current;
      if (drag === null) return;
      const { dx, dy } = screenDeltaToLayoutDeltaMm(ev.clientX - drag.startClientX, ev.clientY - drag.startClientY, scale);
      const next = applyPositionDelta(drag.baseLayout, drag.ref, dx, dy);
      onLayoutReplaceRef.current(next);
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      dragRef.current = null;
      onDragEndRef.current();
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  // R13 — keyboard nudge, active whenever an element is selected. Skips
  // when focus is inside an inspector input so number/range controls keep
  // their own arrow-key behavior.
  useEffect(() => {
    if (selectedRef === null) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const step = e.shiftKey ? NUDGE_STEP_SHIFT_MM : NUDGE_STEP_MM;
      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case "ArrowLeft":
          dx = -step;
          break;
        case "ArrowRight":
          dx = step;
          break;
        case "ArrowUp":
          dy = step;
          break;
        case "ArrowDown":
          dy = -step;
          break;
        default:
          return;
      }
      e.preventDefault();
      if (selectedRef) onNudge(selectedRef, dx, dy);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRef && refKey(selectedRef)]);

  const cardWidthPx = mmToPx(CARD_WIDTH_MM, scale);
  const cardHeightPx = mmToPx(CARD_HEIGHT_MM, scale);
  const insetPx = mmToPx(SAFE_AREA_INSET_MM, scale);

  return (
    <section className="canvas-col">
      <h2>
        Canvas ({CARD_WIDTH_MM} × {CARD_HEIGHT_MM} mm, to scale)
      </h2>
      <div className="card" style={{ width: cardWidthPx, height: cardHeightPx, background: "#171B1B" }}>
        <div
          className="safe-guide"
          style={{ left: insetPx, top: insetPx, width: cardWidthPx - insetPx * 2, height: cardHeightPx - insetPx * 2 }}
        />
        {refs.map((ref) => {
          const key = refKey(ref);
          return (
            <ElementNode
              key={key}
              layout={layout}
              elementRef={ref}
              scale={scale}
              selected={selectedRef !== null && refKey(selectedRef) === key}
              interactive={ref.layer === activeLayer}
              oob={oobKeys.has(key)}
              onSelect={onSelect}
              onDragStart={handleDragStart}
            />
          );
        })}
      </div>
      <p className="card-caption">scale {scale} px/mm · dashed guide = 2 mm safe area · arrows nudge 0.5 mm, shift+arrow 2 mm</p>
    </section>
  );
}
