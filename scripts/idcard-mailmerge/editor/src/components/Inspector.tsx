import type { ChangeEvent } from "react";
import type { DynamicElements, Layout, LogoAlphaElement, NostalgiaOpaqueElement, SpriteAlphaElement, TextStaticElement, LineElement } from "../core/types";
import { applySize, editableFields } from "../core/fieldMap";
import { getElement, type ElementRef } from "../layout/elements";
import { applyScalePercent, scalePercentOf, type SizeMm } from "../layout/scale";

export interface InspectorProps {
  layout: Layout;
  selectedRef: ElementRef | null;
  baselineSizes: Record<string, SizeMm>;
  refKey: (ref: ElementRef) => string;
  onUpdate: (ref: ElementRef, updater: (el: unknown) => unknown) => void;
}

type ScalableElement = SpriteAlphaElement | NostalgiaOpaqueElement | LogoAlphaElement | DynamicElements["photo_box"];
type OpacityCapable = SpriteAlphaElement | NostalgiaOpaqueElement | LogoAlphaElement | TextStaticElement | LineElement;
type RotatableElement = SpriteAlphaElement | NostalgiaOpaqueElement | LogoAlphaElement;

function num(e: ChangeEvent<HTMLInputElement>): number {
  return Number(e.target.value);
}

export function Inspector({ layout, selectedRef, baselineSizes, refKey, onUpdate }: InspectorProps) {
  if (selectedRef === null) {
    return (
      <aside className="inspector">
        <h2>Inspector</h2>
        <p className="empty">Select an element on the canvas or from the layer list to edit it.</p>
      </aside>
    );
  }

  const fields = editableFields(selectedRef.kind);
  const el = getElement(layout, selectedRef);

  return (
    <aside className="inspector">
      <h2>Inspector</h2>
      <div className="selected-name">Selected: {selectedRef.name}</div>

      {fields.opacity && (
        <div className="ctrl">
          <label htmlFor="opacity">
            Opacity <span className="value">{Math.round(((el as OpacityCapable).opacity ?? 1) * 100)}%</span>
          </label>
          <input
            id="opacity"
            type="range"
            min={0}
            max={100}
            value={Math.round(((el as OpacityCapable).opacity ?? 1) * 100)}
            onChange={(e) => {
              const pct = num(e);
              onUpdate(selectedRef, (cur) => ({ ...(cur as OpacityCapable), opacity: pct / 100 }));
            }}
          />
        </div>
      )}

      {fields.scale && (
        <ScaleControl
          selectedRef={selectedRef}
          el={el as ScalableElement}
          baseline={baselineSizes[refKey(selectedRef)]}
          onUpdate={onUpdate}
        />
      )}

      {fields.size && (
        <div className="ctrl">
          <label htmlFor="size">
            Size (pt) <span className="value">{(el as TextStaticElement).max_size}</span>
          </label>
          <input
            id="size"
            type="number"
            step={0.1}
            value={(el as TextStaticElement).max_size}
            onChange={(e) => {
              const size = num(e);
              if (!Number.isFinite(size)) return;
              onUpdate(selectedRef, (cur) => applySize(cur as TextStaticElement, size));
            }}
          />
        </div>
      )}

      {fields.rotation && (
        <div className="ctrl">
          <label htmlFor="rotation">
            Rotation <span className="value">{(el as RotatableElement).rotation ?? 0}°</span>
          </label>
          <input
            id="rotation"
            type="range"
            min={-180}
            max={180}
            value={(el as RotatableElement).rotation ?? 0}
            onChange={(e) => {
              const deg = num(e);
              onUpdate(selectedRef, (cur) => ({ ...(cur as RotatableElement), rotation: deg }));
            }}
          />
        </div>
      )}

      {!fields.opacity && !fields.scale && !fields.size && !fields.rotation && (
        <p className="empty">This element kind has no inspector controls (R12).</p>
      )}

      <p className="inspector-note">Controls are scoped to the selected element's kind (R12 table).</p>
      <p className="inspector-note">Arrows nudge 0.5&nbsp;mm, Shift+arrow 2&nbsp;mm.</p>
    </aside>
  );
}

function ScaleControl({
  selectedRef,
  el,
  baseline,
  onUpdate,
}: {
  selectedRef: ElementRef;
  el: ScalableElement;
  baseline: SizeMm | undefined;
  onUpdate: (ref: ElementRef, updater: (el: unknown) => unknown) => void;
}) {
  const base = baseline ?? { w: el.w, h: el.h };
  const percent = scalePercentOf({ w: el.w, h: el.h }, base);
  return (
    <div className="ctrl">
      <label htmlFor="scale">
        Scale <span className="value">{percent}%</span>
      </label>
      <input
        id="scale"
        type="range"
        min={10}
        max={300}
        value={percent}
        onChange={(e) => {
          const pct = num(e);
          onUpdate(selectedRef, (cur) => applyScalePercent(cur as ScalableElement, base, pct));
        }}
      />
    </div>
  );
}
