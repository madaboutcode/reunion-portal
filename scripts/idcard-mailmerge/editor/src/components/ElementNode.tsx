import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type {
  DynamicElements,
  LineElement,
  LogoAlphaElement,
  NostalgiaOpaqueElement,
  SpriteAlphaElement,
  TextStaticElement,
  Layout,
} from "../core/types";
import { CARD_HEIGHT_MM } from "../core/constants";
import { bboxFor, getElement, ptToMm, type ElementRef } from "../layout/elements";
import { bboxToScreenRect, pointToScreenPx } from "../layout/screen";
import { mmToPx } from "../core/geometry";
import { doodleAssetUrl, fontFamilyFor, logoAssetUrl, resolveColor } from "../layout/assets";
import { fitFontSizePx } from "../layout/textFit";

export interface ElementNodeProps {
  layout: Layout;
  elementRef: ElementRef;
  scale: number;
  selected: boolean;
  interactive: boolean;
  oob: boolean;
  onSelect: (ref: ElementRef) => void;
  onDragStart: (ref: ElementRef, e: ReactPointerEvent) => void;
}

function classNames(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function ElementNode({ layout, elementRef, scale, selected, interactive, oob, onSelect, onDragStart }: ElementNodeProps) {
  const el = getElement(layout, elementRef);
  const bbox = bboxFor(layout, elementRef);
  const rect = bboxToScreenRect(bbox, CARD_HEIGHT_MM, scale);
  // idcards.py's _fit_text steps by 0.1pt (idcards.py ~line 648) — step the
  // fit loop by the same px-equivalent so it lands on the same size rung
  // instead of a coarser flat-px step drifting the fitted size off by
  // half a step (and the final width along with it).
  const FIT_STEP_PX = mmToPx(ptToMm(0.1), scale);

  const wrapperClass = classNames("el", interactive ? "clickable" : "not-interactive", selected && "selected", oob && "oob");

  function handlePointerDown(e: ReactPointerEvent) {
    if (!interactive) return;
    e.stopPropagation();
    onSelect(elementRef);
    onDragStart(elementRef, e);
  }

  const baseStyle: CSSProperties = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    pointerEvents: interactive ? "auto" : "none",
  };

  switch (elementRef.kind) {
    case "sprite_alpha":
    case "nostalgia_opaque": {
      const e = el as SpriteAlphaElement | NostalgiaOpaqueElement;
      const opacity = e.opacity ?? 1;
      const rotation = e.rotation ?? 0;
      return (
        <div
          className={wrapperClass}
          style={{ ...baseStyle, opacity, transform: rotation ? `rotate(${rotation}deg)` : undefined }}
          title={elementRef.name}
          onPointerDown={handlePointerDown}
        >
          <img src={doodleAssetUrl(elementRef.kind, e.asset)} alt={elementRef.name} draggable={false} />
          {selected && <span className="el-tag blue">selected</span>}
          {oob && !selected && <span className="el-tag red">out of safe area</span>}
        </div>
      );
    }
    case "logo_alpha": {
      const e = el as LogoAlphaElement;
      const opacity = e.opacity ?? 1;
      const rotation = e.rotation ?? 0;
      return (
        <div
          className={wrapperClass}
          style={{ ...baseStyle, opacity, transform: rotation ? `rotate(${rotation}deg)` : undefined }}
          title={elementRef.name}
          onPointerDown={handlePointerDown}
        >
          <img src={logoAssetUrl()} alt="logo" draggable={false} />
          {selected && <span className="el-tag blue">selected</span>}
        </div>
      );
    }
    case "text_static": {
      const e = el as TextStaticElement;
      const opacity = e.opacity ?? 1;
      const family = fontFamilyFor(e.font);
      const letterSpacingPx = e.char_space ? mmToPx(ptToMm(e.char_space), scale) : 0;
      const fontSizePx = fitFontSizePx(e.text, family, mmToPx(ptToMm(e.max_size), scale), mmToPx(ptToMm(e.min_size), scale), rect.width, letterSpacingPx, FIT_STEP_PX);
      return (
        <div className={wrapperClass} style={{ ...baseStyle, opacity, alignItems: "flex-end" }} title={elementRef.name} onPointerDown={handlePointerDown}>
          <span
            className="field-text"
            style={{
              position: "static",
              fontFamily: family,
              fontSize: fontSizePx,
              color: resolveColor(e.color),
              letterSpacing: letterSpacingPx ? `${letterSpacingPx}px` : undefined,
              fontKerning: "none",
            }}
          >
            {e.text}
          </span>
        </div>
      );
    }
    case "line": {
      const e = el as LineElement;
      const opacity = e.opacity ?? 1;
      const p1 = pointToScreenPx(e.x1, e.y1, CARD_HEIGHT_MM, scale);
      const p2 = pointToScreenPx(e.x2, e.y2, CARD_HEIGHT_MM, scale);
      const strokeWidth = Math.max(mmToPx(e.width, scale), 1);
      const hitPad = 6;
      const left = Math.min(p1.left, p2.left) - hitPad;
      const top = Math.min(p1.top, p2.top) - hitPad;
      const width = Math.abs(p2.left - p1.left) + hitPad * 2;
      const height = Math.abs(p2.top - p1.top) + hitPad * 2;
      return (
        <div
          className={classNames("el-line", (selected || oob) && "el", selected && "selected", oob && "oob")}
          style={{ left, top, width, height, opacity, pointerEvents: interactive ? "auto" : "none" }}
          title={elementRef.name}
          onPointerDown={handlePointerDown}
        >
          <svg width={width} height={height}>
            <line
              x1={p1.left - left}
              y1={p1.top - top}
              x2={p2.left - left}
              y2={p2.top - top}
              stroke={resolveColor(e.color)}
              strokeWidth={strokeWidth}
            />
          </svg>
        </div>
      );
    }
    case "photo_box": {
      return (
        <div
          className={classNames(wrapperClass, "photo-placeholder")}
          style={{ ...baseStyle, background: resolveColor("coral"), borderRadius: 4 }}
          title="photo"
          onPointerDown={handlePointerDown}
        >
          photo
          {selected && <span className="el-tag blue">selected</span>}
          {oob && !selected && <span className="el-tag red">out of safe area</span>}
        </div>
      );
    }
    case "name":
    case "branch": {
      const e = el as DynamicElements["name"] | DynamicElements["branch"];
      const label = elementRef.kind === "name" ? "NAME" : "branch / department";
      const family = fontFamilyFor(e.font);
      const letterSpacingPx = e.char_space ? mmToPx(ptToMm(e.char_space), scale) : 0;
      const fontSizePx = fitFontSizePx(label, family, mmToPx(ptToMm(e.max_size), scale), mmToPx(ptToMm(e.min_size), scale), rect.width, letterSpacingPx, FIT_STEP_PX);
      return (
        <div className={wrapperClass} style={{ ...baseStyle, alignItems: "flex-end", justifyContent: "center" }} title={elementRef.name} onPointerDown={handlePointerDown}>
          <span
            className="field-text"
            style={{ position: "static", fontFamily: family, fontSize: fontSizePx, color: resolveColor(e.color), letterSpacing: letterSpacingPx ? `${letterSpacingPx}px` : undefined, fontKerning: "none" }}
          >
            {label}
          </span>
        </div>
      );
    }
    case "id_badge": {
      const e = el as DynamicElements["id_badge"];
      const family = fontFamilyFor(e.font);
      const badgeText = "( 1001 )";
      const letterSpacingPx = e.char_space ? mmToPx(ptToMm(e.char_space), scale) : 0;
      const fontSizePx = fitFontSizePx(
        badgeText,
        family,
        mmToPx(ptToMm(e.max_size), scale),
        mmToPx(ptToMm(e.min_size), scale),
        rect.width - mmToPx(1, scale),
        letterSpacingPx,
        FIT_STEP_PX,
      );
      return (
        <div
          className={classNames(wrapperClass, "id-badge-box")}
          style={{ ...baseStyle, background: resolveColor("background"), border: `1px solid ${resolveColor("mint")}` }}
          title="id_badge"
          onPointerDown={handlePointerDown}
        >
          <span style={{ fontFamily: family, fontSize: fontSizePx, color: resolveColor("ivory"), letterSpacing: letterSpacingPx ? `${letterSpacingPx}px` : undefined, fontKerning: "none" }}>
            {badgeText}
          </span>
          {selected && <span className="el-tag blue">selected</span>}
        </div>
      );
    }
    default: {
      const exhaustive: never = elementRef.kind;
      throw new Error(`ElementNode: unhandled kind ${JSON.stringify(exhaustive)}`);
    }
  }
}
