import { LAYERS, type Layer } from "../layout/layers";
import type { ElementRef } from "../layout/elements";

export interface LayerPanelProps {
  activeLayer: Layer;
  onLayerChange: (layer: Layer) => void;
  elementsInActiveLayer: ElementRef[];
  selectedRef: ElementRef | null;
  onSelect: (ref: ElementRef) => void;
  oobNames: Set<string>;
}

function refKey(ref: ElementRef): string {
  return `${ref.source}:${ref.name}`;
}

export function LayerPanel({ activeLayer, onLayerChange, elementsInActiveLayer, selectedRef, onSelect, oobNames }: LayerPanelProps) {
  return (
    <aside className="panel">
      <h2>Layers</h2>
      <ul className="layers">
        {LAYERS.map((layer) => (
          <li key={layer}>
            <label>
              <input type="radio" name="layer" value={layer} checked={activeLayer === layer} onChange={() => onLayerChange(layer)} />
              {layer === "photo_logo" ? "photo/logo" : layer}
            </label>
          </li>
        ))}
      </ul>

      <h2 className="elem-list-head">Elements</h2>
      <p className="elem-list-sub">in active layer:</p>
      <ul className="elem-list">
        {elementsInActiveLayer.map((ref) => {
          const key = refKey(ref);
          const isSelected = selectedRef !== null && refKey(selectedRef) === key;
          return (
            <li
              key={key}
              className={[isSelected ? "selected" : "", oobNames.has(key) ? "oob-marker" : ""].filter(Boolean).join(" ")}
              onClick={() => onSelect(ref)}
            >
              {ref.name}
            </li>
          );
        })}
        {elementsInActiveLayer.length === 0 && <li style={{ color: "var(--muted)", fontStyle: "italic" }}>(none)</li>}
      </ul>

      <p className="panel-note">Only the active layer's elements are clickable. The list is the click-to-select fallback for same-layer overlaps (R10).</p>
    </aside>
  );
}
