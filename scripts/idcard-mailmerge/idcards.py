#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "Pillow>=12,<13",
#   "pypdf>=6,<7",
#   "reportlab>=4,<5",
# ]
# ///
"""Mail-merge renderer for the Smriti portrait CR80 attendee card.

The production renderer is intentionally deterministic. Image generation is
used only to supply illustration assets; typography, geometry, validation, and
PDF composition happen here.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageOps
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
from reportlab.lib.colors import HexColor
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


PAGE_W = 54.0 * mm
PAGE_H = 85.6 * mm
SAFE_INSET = 2.0 * mm
PHOTO_BOX = (29.5 * mm, 26.2 * mm, 21.5 * mm, 34.0 * mm)

COLORS = {
    "background": HexColor("#171B1B"),
    "mint": HexColor("#B8DEDA"),
    "ivory": HexColor("#F1E3C9"),
    "coral": HexColor("#C86C52"),
    "logo_panel": HexColor("#C6E2E4"),
}

CARD_BACKGROUND_RGB = (23, 27, 27)
SHEET_SIZE = (1536, 1024)
GRID_BACKGROUND_TOLERANCE = 8
GRID_BORDER = 24

ID_RE = re.compile(r"^[0-9]{4}$")


class CardError(Exception):
    """Expected input, layout, asset, or postflight failure."""


@dataclass(frozen=True)
class CardRecord:
    name: str
    branch: str
    photo_path: Path
    attendee_id: str
    index: int


@dataclass(frozen=True)
class FontSet:
    regular: str
    display: str
    heavy: str


@dataclass(frozen=True)
class CropSpec:
    name: str
    box: tuple[int, int, int, int]


@dataclass(frozen=True)
class AssetSet:
    root: Path
    logo: Path
    sprite_sheet: Path
    crops_dir: Path
    nostalgia_sprite_sheet: Path
    nostalgia_crops_dir: Path
    hero_a_sheet: Path
    hero_b_sheet: Path
    micro_sheet: Path
    gridded_crops_dir: Path


SPRITE_CROPS = (
    CropSpec("college", (425, 45, 1100, 535)),
    CropSpec("paper_plane", (115, 55, 430, 285)),
)

HERO_A_CROPS = (
    # The source generator's robust separation is the four 768x512
    # quadrants. We still slice by fixed boxes, then trim only within each
    # isolated quadrant; this avoids guessed overlapping crops.
    CropSpec("friends", (0, 0, 768, 512)),
    CropSpec("tea_glass", (768, 0, 1536, 512)),
    CropSpec("autograph_book", (0, 512, 768, 1024)),
    CropSpec("cassette", (768, 512, 1536, 1024)),
)

HERO_B_CROPS = (
    CropSpec("compass", (0, 0, 768, 512)),
    CropSpec("set_square", (768, 0, 1536, 512)),
    CropSpec("paper_plane_mint", (0, 512, 768, 1024)),
    CropSpec("paper_plane_terracotta", (768, 512, 1536, 1024)),
)

MICRO_CROPS = (
    CropSpec("heart_mint", (96, 64, 480, 448)),
    CropSpec("star_mint", (576, 64, 960, 448)),
    CropSpec("sparkle_mint", (1056, 64, 1440, 448)),
    CropSpec("plus_mint", (96, 576, 480, 960)),
    CropSpec("dot_mint", (576, 576, 960, 960)),
    CropSpec("burst_mint", (1056, 576, 1440, 960)),
)


LAYOUT_VERSION = 1

# Every static (identical on every card) and dynamic (per-record) drawn
# element, extracted from the positions that used to be inline literals in
# _draw_static()/_draw_dynamic(). This is the single source of truth the
# renderer and the layout editor both read and write. "z" controls draw
# order among static elements; the logo is always drawn dead last regardless
# of its "z" so an editor drag can never let a doodle cover it.
#
# If you change any value here, regenerate editor/defaults.json (the
# editor's Reset source-of-truth): uv run python -c "import idcards, json;
# print(json.dumps(idcards.DEFAULT_LAYOUT, indent=2))" > editor/defaults.json
DEFAULT_LAYOUT: dict[str, Any] = {
    "version": LAYOUT_VERSION,
    "elements": {
        "college": {"z": 10, "kind": "sprite_alpha", "asset": "college", "x": 30.2, "y": 60.6, "w": 21.4, "h": 16.6},
        "paper_plane_mint_top": {"z": 20, "kind": "nostalgia_opaque", "asset": "paper_plane_mint", "x": 36.7, "y": 77.1, "w": 7.6, "h": 4.4},
        "sparkle_mint_top": {"z": 21, "kind": "nostalgia_opaque", "asset": "sparkle_mint", "x": 33.0, "y": 79.0, "w": 2.3, "h": 2.4},
        "event_line_title": {"z": 30, "kind": "text_static", "text": "SMRITI 2026", "font": "display", "max_size": 15.0, "min_size": 12.0, "center_x": 15.5, "baseline": 46.0, "max_width": 22.5, "char_space": 0.15, "color": "ivory"},
        "event_line_batch": {"z": 31, "kind": "text_static", "text": "TKMCE BATCH OF 2006", "font": "regular", "max_size": 8.4, "min_size": 7.2, "center_x": 15.5, "baseline": 41.6, "max_width": 22.5, "char_space": 0.25, "color": "ivory"},
        "event_line_anniversary": {"z": 32, "kind": "text_static", "text": "20TH ANNIVERSARY REUNION", "max_size": 6.8, "min_size": 5.8, "font": "regular", "center_x": 15.5, "baseline": 37.4, "max_width": 22.5, "char_space": 0.12, "color": "ivory"},
        "divider_line": {"z": 40, "kind": "line", "x1": 4.5, "y1": 34.7, "x2": 25.2, "y2": 34.7, "color": "mint", "width": 0.55},
        "autograph_book": {"z": 50, "kind": "nostalgia_opaque", "asset": "autograph_book", "x": 3.6, "y": 26.6, "w": 13.5, "h": 7.4},
        "tea_glass": {"z": 51, "kind": "nostalgia_opaque", "asset": "tea_glass", "x": 23.4, "y": 27.0, "w": 4.8, "h": 7.5},
        "star_terracotta_mid": {"z": 52, "kind": "nostalgia_opaque", "asset": "star_terracotta", "x": 20.3, "y": 32.6, "w": 2.4, "h": 2.5},
        "burst_terracotta_mid": {"z": 53, "kind": "nostalgia_opaque", "asset": "burst_terracotta", "x": 18.0, "y": 34.8, "w": 2.0, "h": 2.0},
        "dot_mint_mid": {"z": 54, "kind": "nostalgia_opaque", "asset": "dot_mint", "x": 27.1, "y": 37.0, "w": 1.6, "h": 1.6},
        "plus_terracotta_mid": {"z": 55, "kind": "nostalgia_opaque", "asset": "plus_terracotta", "x": 27.1, "y": 47.1, "w": 2.0, "h": 2.1},
        "friends": {"z": 60, "kind": "nostalgia_opaque", "asset": "friends", "x": 3.0, "y": 5.3, "w": 15.6, "h": 8.8},
        "cassette": {"z": 61, "kind": "nostalgia_opaque", "asset": "cassette", "x": 39.5, "y": 2.5, "w": 11.5, "h": 5.9},
        "heart_mint_low": {"z": 62, "kind": "nostalgia_opaque", "asset": "heart_mint", "x": 40.2, "y": 14.0, "w": 2.5, "h": 2.7},
        "plus_mint_low": {"z": 63, "kind": "nostalgia_opaque", "asset": "plus_mint", "x": 35.3, "y": 12.0, "w": 2.1, "h": 2.1},
        "burst_terracotta_low": {"z": 64, "kind": "nostalgia_opaque", "asset": "burst_terracotta", "x": 37.1, "y": 16.3, "w": 2.0, "h": 2.0},
        "set_square_faded": {"z": 65, "kind": "nostalgia_opaque", "asset": "set_square_faded", "x": 19.3, "y": 2.7, "w": 5.1, "h": 4.2},
        "compass_faded": {"z": 66, "kind": "nostalgia_opaque", "asset": "compass_faded", "x": 25.4, "y": 2.1, "w": 5.1, "h": 6.4},
        "logo": {"z": 90, "kind": "logo_alpha", "x": 4.5, "y": 52.3, "w": 27.5, "h": 27.5},
    },
    # Vector spline accents (_draw_vector_accents) are fixed hand-tuned
    # curves, not box-shaped, and are intentionally not part of the editable
    # layout in this version. They always draw immediately before the logo.
    "dynamic": {
        "photo_box": {"x": 29.5, "y": 26.2, "w": 21.5, "h": 34.0, "corner_radius": 3.0},
        "name": {"font": "heavy", "max_size": 19.5, "min_size": 11.5, "baseline": 19.1, "max_width_margin": 6.0, "char_space": 0.25, "color": "ivory"},
        "branch": {"font": "regular", "max_size": 8.3, "min_size": 6.3, "baseline": 14.5, "max_width_margin": 9.0, "char_space": 0.30, "color": "ivory"},
        "id_badge": {"w": 15.5, "h": 3.6, "y": 8.9, "font": "regular", "max_size": 5.8, "min_size": 5.0, "width_margin": 2.0, "char_space": 0.16, "text_y_offset": 1.02},
    },
}

# Per-attendee override schema (data/overrides/<attendee_id>.json). Only the
# templated fields that legitimately vary per record are here: photo crop
# (pan/zoom) and a small vertical nudge / size override for the two text
# lines. Everything else is template-only and lives in layout.json.
OVERRIDABLE_DYNAMIC_FIELDS = {
    "photo": {"pan_x": 0.5, "pan_y": 0.22, "zoom": 1.0},
    # "text" replaces the manifest name for this record (e.g. shortening a
    # long legal name to what fits/reads on the card). None = use the
    # manifest name. It is upper-cased at draw exactly like the manifest name.
    "name": {"baseline_dy": 0.0, "size_override": None, "text": None},
    "branch": {"baseline_dy": 0.0, "size_override": None},
}


def package_root() -> Path:
    return Path(__file__).resolve().parent


def default_assets(root: Path | None = None) -> AssetSet:
    root = root or package_root() / "assets"
    sheets = root / "doodles-sheets"
    return AssetSet(
        root=root,
        logo=root / "smriti-logo.png",
        sprite_sheet=root / "doodles-sprite-sheet.png",
        crops_dir=root / "crops",
        # Kept as the compatibility name used by older callers/tests. The
        # active nostalgia source is now the normalized Hero A sheet.
        nostalgia_sprite_sheet=sheets / "hero-a.png",
        nostalgia_crops_dir=root / "doodles-production",
        hero_a_sheet=sheets / "hero-a.png",
        hero_b_sheet=sheets / "hero-b.png",
        micro_sheet=sheets / "micro.png",
        gridded_crops_dir=root / "doodles-production",
    )


def register_fonts() -> FontSet:
    """Register the exact bundled Barlow Condensed TTFs.

    Static TTFs are used instead of variable-font files so ReportLab embeds
    the same outlines on every supported platform without relying on a local
    font installation or a synthetic PDF transform.
    """

    bundled = package_root() / "assets" / "fonts"
    paths = {
        "regular": bundled / "BarlowCondensed-Regular.ttf",
        "display": bundled / "BarlowCondensed-Bold.ttf",
        "heavy": bundled / "BarlowCondensed-Black.ttf",
    }
    missing = [str(path) for path in paths.values() if not path.is_file()]
    if missing:
        raise CardError("Missing bundled font files: " + ", ".join(missing))
    names = {
        "regular": "SmritiBarlowCondensedRegular",
        "display": "SmritiBarlowCondensedBold",
        "heavy": "SmritiBarlowCondensedBlack",
    }
    for role, name in names.items():
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, str(paths[role])))
    return FontSet(names["regular"], names["display"], names["heavy"])


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CardError(f"Invalid JSON at {path}: {exc}") from exc


def _check_glyphs(text: str, font_name: str, label: str) -> None:
    font = pdfmetrics.getFont(font_name)
    widths = getattr(font.face, "charWidths", {})
    missing = sorted({char for char in text if ord(char) not in widths})
    if missing:
        rendered = ", ".join(repr(char) for char in missing)
        raise CardError(f"{label} contains characters missing from {font_name}: {rendered}")


def _decode_photo(path: Path) -> Image.Image:
    if not path.is_file():
        raise CardError(f"Photo does not exist: {path}")
    try:
        with Image.open(path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGBA")
    except Exception as exc:  # Pillow raises several format-specific errors.
        raise CardError(f"Photo cannot be decoded: {path}: {exc}") from exc
    if image.width < 256 or image.height < 256:
        raise CardError(f"Photo is too small for print placement: {path} ({image.size[0]}x{image.size[1]})")
    return image


def validate_manifest(path: Path, fonts: FontSet) -> list[CardRecord]:
    data = load_json(path)
    if not isinstance(data, dict) or not isinstance(data.get("cards"), list):
        raise CardError("Manifest must be an object with a 'cards' array")
    if data.get("schema_version") != 1:
        raise CardError("Manifest schema_version must be exactly 1")
    cards = data["cards"]
    if not cards:
        raise CardError("Manifest contains no cards")

    base = path.parent.resolve()
    errors: list[str] = []
    records: list[CardRecord] = []
    seen: set[str] = set()
    required = ("name", "branch", "photo_path", "attendee_id")

    for index, raw in enumerate(cards):
        prefix = f"cards[{index}]"
        if not isinstance(raw, dict):
            errors.append(f"{prefix} must be an object")
            continue
        missing = [key for key in required if key not in raw]
        if missing:
            errors.append(f"{prefix} missing: {', '.join(missing)}")
            continue
        name = raw.get("name")
        branch = raw.get("branch")
        photo_value = raw.get("photo_path")
        attendee_id = raw.get("attendee_id")
        if not all(isinstance(value, str) and value.strip() for value in (name, branch, photo_value, attendee_id)):
            errors.append(f"{prefix} name, branch, photo_path, and attendee_id must be non-empty strings")
            continue
        name_display = name.strip().upper()
        branch_display = branch.strip().upper()
        if not ID_RE.fullmatch(attendee_id):
            errors.append(f"{prefix}.attendee_id must be exactly four ASCII digits; got {attendee_id!r}")
        if attendee_id in seen:
            errors.append(f"{prefix}.attendee_id duplicates {attendee_id}")
        seen.add(attendee_id)
        photo_path = Path(photo_value)
        if not photo_path.is_absolute():
            photo_path = (base / photo_path).resolve()
        try:
            image = _decode_photo(photo_path)
            if image.width / (PHOTO_BOX[2] / 72.0) < 300 or image.height / (PHOTO_BOX[3] / 72.0) < 300:
                errors.append(f"{prefix}.photo_path has insufficient effective resolution: {photo_path}")
        except CardError as exc:
            errors.append(f"{prefix}: {exc}")
        for text, label, font in (
            (name_display, f"{prefix}.name", fonts.heavy),
            (branch_display, f"{prefix}.branch", fonts.regular),
            (f"ID · {attendee_id}", f"{prefix}.attendee_id", fonts.display),
        ):
            try:
                _check_glyphs(text, font, label)
            except CardError as exc:
                errors.append(str(exc))
        records.append(CardRecord(name_display, branch_display, photo_path, attendee_id, index))

    if errors:
        raise CardError("Manifest validation failed:\n- " + "\n- ".join(errors))
    return records


def _alpha_trim(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    bbox = alpha.getbbox()
    return rgba.crop(bbox) if bbox else rgba.crop((0, 0, 1, 1))


def _prepare_sprite_sheet(sheet_path: Path, crops_dir: Path, specs: tuple[CropSpec, ...], require_alpha: bool = True) -> dict[str, Any]:
    if not sheet_path.is_file():
        kind = "transparent" if require_alpha else "background-matched"
        raise CardError(f"Missing {kind} sprite sheet: {sheet_path}")
    crops_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(sheet_path) as sheet:
        sheet = sheet.convert("RGBA")
        if require_alpha and sheet.getextrema()[3][0] == 255 and sheet.getextrema()[3][1] == 255:
            raise CardError(f"Sprite sheet has no alpha transparency: {sheet_path}")
        manifest: dict[str, Any] = {
            "source": str(sheet_path),
            "size": list(sheet.size),
            "assets": {},
        }
        for spec in specs:
            crop = _alpha_trim(sheet.crop(spec.box)) if require_alpha else sheet.crop(spec.box)
            out = crops_dir / f"{spec.name}.png"
            crop.save(out, format="PNG", optimize=True)
            manifest["assets"][spec.name] = {
                "source_box": list(spec.box),
                "path": str(out),
                "pixels": list(crop.size),
            }
        manifest_path = crops_dir / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        return manifest


def _sheet_foreground(pixel: tuple[int, int, int]) -> bool:
    """Return whether a source-sheet pixel is ink rather than dark background."""

    # Imagegen can introduce a slight neutral charcoal gradient even when a
    # flat background is requested. The doodles themselves are chromatic, so
    # this deliberately small channel-spread test removes that gradient
    # without inventing alpha or leaving a chroma-key fringe.
    return max(pixel) - min(pixel) > GRID_BACKGROUND_TOLERANCE


def _normalize_background_sheet(source_path: Path, output_path: Path) -> dict[str, Any]:
    if not source_path.is_file():
        raise CardError(f"Missing gridded doodle sheet: {source_path}")
    with Image.open(source_path) as opened:
        source = opened.convert("RGB")
    if source.size != SHEET_SIZE:
        raise CardError(f"Gridded doodle sheet must be exactly {SHEET_SIZE[0]}x{SHEET_SIZE[1]}: {source_path} is {source.size[0]}x{source.size[1]}")

    normalized_pixels = [
        pixel if _sheet_foreground(pixel) else CARD_BACKGROUND_RGB
        for pixel in source.getdata()
    ]
    normalized = Image.new("RGB", source.size, CARD_BACKGROUND_RGB)
    normalized.putdata(normalized_pixels)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    normalized.save(output_path, format="PNG", optimize=True)
    return {
        "source": str(source_path),
        "normalized": str(output_path),
        "size": list(normalized.size),
        "mode": normalized.mode,
        "background_rgb": list(CARD_BACKGROUND_RGB),
    }


def _foreground_mask(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    background = Image.new("RGB", rgb.size, CARD_BACKGROUND_RGB)
    difference = ImageChops.difference(rgb, background).convert("L")
    return difference.point(lambda value: 255 if value > 2 else 0)


def _allowed_grid_mask(size: tuple[int, int], specs: tuple[CropSpec, ...]) -> Image.Image:
    allowed = Image.new("L", size, 0)
    for spec in specs:
        cell = Image.new("L", (spec.box[2] - spec.box[0], spec.box[3] - spec.box[1]), 255)
        allowed.paste(cell, (spec.box[0], spec.box[1]))
    return allowed


def _trim_background_cell(cell: Image.Image, name: str, required_padding: int) -> tuple[Image.Image, tuple[int, int, int, int]]:
    mask = _foreground_mask(cell)
    bbox = mask.getbbox()
    if bbox is None:
        raise CardError(f"Gridded doodle cell is empty: {name}")
    left, top, right, bottom = bbox
    if min(left, top, cell.width - right, cell.height - bottom) < required_padding:
        raise CardError(f"Gridded doodle {name} violates its {required_padding}px cell safety padding: {bbox}")
    trimmed = cell.crop(bbox)
    output = Image.new("RGB", (trimmed.width + 2 * GRID_BORDER, trimmed.height + 2 * GRID_BORDER), CARD_BACKGROUND_RGB)
    output.paste(trimmed, (GRID_BORDER, GRID_BORDER))
    return output, bbox


def _prepare_gridded_sheet(
    sheet_path: Path,
    specs: tuple[CropSpec, ...],
    crops_dir: Path,
    sheet_name: str,
    required_padding: int,
) -> dict[str, Any]:
    if not sheet_path.is_file():
        raise CardError(f"Missing normalized gridded doodle sheet: {sheet_path}")
    with Image.open(sheet_path) as opened:
        sheet = opened.convert("RGB")
    if sheet.size != SHEET_SIZE:
        raise CardError(f"Normalized doodle sheet must be exactly {SHEET_SIZE[0]}x{SHEET_SIZE[1]}: {sheet_path}")

    mask = _foreground_mask(sheet)
    allowed = _allowed_grid_mask(sheet.size, specs)
    outside = ImageChops.subtract(mask, allowed)
    if outside.getbbox() is not None:
        raise CardError(f"Foreground mark found outside the declared {sheet_name} grid cells")

    crops_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {"sheet": sheet_name, "source": str(sheet_path), "assets": {}}
    for spec in specs:
        cell_w = spec.box[2] - spec.box[0]
        cell_h = spec.box[3] - spec.box[1]
        expected_w, expected_h = (384, 384) if sheet_name == "micro" else (768, 512)
        if (cell_w, cell_h) != (expected_w, expected_h):
            raise CardError(f"Unexpected {sheet_name} cell size for {spec.name}: {(cell_w, cell_h)}")
        cell = sheet.crop(spec.box)
        crop, foreground_box = _trim_background_cell(cell, spec.name, required_padding)
        output_path = crops_dir / f"{spec.name}.png"
        crop.save(output_path, format="PNG", optimize=True)
        manifest["assets"][spec.name] = {
            "cell_box": list(spec.box),
            "foreground_box": list(foreground_box),
            "path": str(output_path),
            "pixels": list(crop.size),
            "mode": crop.mode,
            "background_rgb": list(CARD_BACKGROUND_RGB),
        }
    return manifest


def _make_color_variant(source_path: Path, output_path: Path, color: tuple[int, int, int]) -> None:
    with Image.open(source_path) as opened:
        source = opened.convert("RGB")
    pixels = [CARD_BACKGROUND_RGB if pixel == CARD_BACKGROUND_RGB else color for pixel in source.getdata()]
    output = Image.new("RGB", source.size, CARD_BACKGROUND_RGB)
    output.putdata(pixels)
    output.save(output_path, format="PNG", optimize=True)


def _make_faded_variant(source_path: Path, output_path: Path, strength: float = 0.28) -> None:
    """Blend opaque sprite ink toward the card background for supporting marks."""

    with Image.open(source_path) as opened:
        source = opened.convert("RGB")
    pixels = []
    for pixel in source.getdata():
        if pixel == CARD_BACKGROUND_RGB:
            pixels.append(CARD_BACKGROUND_RGB)
            continue
        pixels.append(tuple(round(background + (channel - background) * strength) for channel, background in zip(pixel, CARD_BACKGROUND_RGB)))
    output = Image.new("RGB", source.size, CARD_BACKGROUND_RGB)
    output.putdata(pixels)
    output.save(output_path, format="PNG", optimize=True)


def _prepare_gridded_assets(assets: AssetSet) -> dict[str, Any]:
    sheets_dir = assets.hero_a_sheet.parent
    source_paths = {
        "hero_a": sheets_dir / "hero-a-source.png",
        "hero_b": sheets_dir / "hero-b-source.png",
        "micro": sheets_dir / "micro-source.png",
    }
    sheet_paths = {
        "hero_a": assets.hero_a_sheet,
        "hero_b": assets.hero_b_sheet,
        "micro": assets.micro_sheet,
    }
    normalized = {}
    for name, output_path in sheet_paths.items():
        source_path = source_paths[name] if source_paths[name].is_file() else output_path
        normalized[name] = _normalize_background_sheet(source_path, output_path)

    manifests = {
        "hero_a": _prepare_gridded_sheet(assets.hero_a_sheet, HERO_A_CROPS, assets.gridded_crops_dir, "hero_a", 40),
        "hero_b": _prepare_gridded_sheet(assets.hero_b_sheet, HERO_B_CROPS, assets.gridded_crops_dir, "hero_b", 40),
        "micro": _prepare_gridded_sheet(assets.micro_sheet, MICRO_CROPS, assets.gridded_crops_dir, "micro", 40),
    }
    for name in ("heart", "star", "sparkle", "plus", "dot", "burst"):
        mint_path = assets.gridded_crops_dir / f"{name}_mint.png"
        terracotta_path = assets.gridded_crops_dir / f"{name}_terracotta.png"
        _make_color_variant(mint_path, terracotta_path, (203, 109, 82))
        with Image.open(terracotta_path) as image:
            pixels = list(image.size)
        manifests["micro"]["assets"][f"{name}_terracotta"] = {
            "derived_from": str(mint_path),
            "path": str(terracotta_path),
            "pixels": pixels,
            "mode": "RGB",
            "background_rgb": list(CARD_BACKGROUND_RGB),
        }
    for name in ("compass", "set_square"):
        source_path = assets.gridded_crops_dir / f"{name}.png"
        faded_path = assets.gridded_crops_dir / f"{name}_faded.png"
        _make_faded_variant(source_path, faded_path)
        with Image.open(faded_path) as image:
            pixels = list(image.size)
        manifests["hero_b"]["assets"][f"{name}_faded"] = {
            "derived_from": str(source_path),
            "path": str(faded_path),
            "pixels": pixels,
            "mode": "RGB",
            "background_rgb": list(CARD_BACKGROUND_RGB),
            "ink_strength": 0.28,
        }
    manifest = {"sheet_size": list(SHEET_SIZE), "background_rgb": list(CARD_BACKGROUND_RGB), "normalized": normalized, "sheets": manifests}
    write_json(assets.gridded_crops_dir / "manifest.json", manifest)
    return manifest


def prepare_assets(assets: AssetSet) -> dict[str, Any]:
    if not assets.logo.is_file():
        raise CardError(f"Missing exact logo PNG: {assets.logo}")
    return {
        "reference_doodles": _prepare_sprite_sheet(assets.sprite_sheet, assets.crops_dir, SPRITE_CROPS),
        # Imagegen supplies real fixed-grid sheets. They are normalized to the
        # exact card background and sliced by declared cell boxes.
        "kerala_nostalgia": _prepare_gridded_assets(assets),
    }


def _asset_path(assets: AssetSet, name: str) -> Path:
    path = assets.crops_dir / f"{name}.png"
    if not path.is_file():
        prepare_assets(assets)
    if not path.is_file():
        raise CardError(f"Prepared doodle asset is missing: {path}")
    return path


def _nostalgia_asset_path(assets: AssetSet, name: str) -> Path:
    path = assets.gridded_crops_dir / f"{name}.png"
    if not path.is_file():
        prepare_assets(assets)
    if not path.is_file():
        raise CardError(f"Prepared Kerala nostalgia asset is missing: {path}")
    return path


def _image_reader(path: Path) -> ImageReader:
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    return ImageReader(image)


def _cover_crop(image: Image.Image, target_w: int, target_h: int, pan_x: float = 0.5, pan_y: float = 0.22, zoom: float = 1.0) -> Image.Image:
    """Cover-fit crop with a per-record pan/zoom knob.

    pan_x/pan_y are 0..1 fractions of the crop window's travel range inside
    the resized image (0.5 = centered horizontally; 0.22 matches the
    renderer's historical fixed top-bias for pan_y). zoom >= 1.0 scales the
    image further beyond the minimum cover fit so a crop can be tightened
    without ever leaving letterboxing inside the target box.
    """
    source_w, source_h = image.size
    base_scale = max(target_w / source_w, target_h / source_h)
    scale = base_scale * max(1.0, zoom)
    resized = image.resize((max(target_w, math.ceil(source_w * scale)), max(target_h, math.ceil(source_h * scale))), Image.Resampling.LANCZOS)
    pan_x = min(1.0, max(0.0, pan_x))
    pan_y = min(1.0, max(0.0, pan_y))
    excess_w = max(0, resized.width - target_w)
    excess_h = max(0, resized.height - target_h)
    left = int(round(excess_w * pan_x))
    top = int(round(excess_h * pan_y))
    return resized.crop((left, top, left + target_w, top + target_h))


def _draw_image_contain(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float, alpha: bool = True) -> None:
    reader = _image_reader(path)
    c.drawImage(reader, x, y, width=w, height=h, preserveAspectRatio=True, anchor="c", mask="auto" if alpha else None)


def _draw_text(c: canvas.Canvas, text: str, font: str, size: float, x: float, y: float, color: Any, char_space: float = 0.0, alpha: float | None = None) -> float:
    obj = c.beginText()
    obj.setTextOrigin(x, y)
    obj.setFont(font, size)
    # A PDFTextObject.setFillColor(color) call with no explicit alpha resets
    # fill alpha to the color object's own .alpha (always 1) — it does NOT
    # inherit whatever c.setFillAlpha() the caller set beforehand. Opacity
    # on text_static must therefore be threaded through here explicitly;
    # alpha=None (every pre-existing call site) reproduces the exact prior
    # call and behavior.
    if alpha is not None:
        obj.setFillColor(color, alpha=alpha)
    else:
        obj.setFillColor(color)
    obj.setCharSpace(char_space)
    obj.textOut(text)
    c.drawText(obj)
    return pdfmetrics.stringWidth(text, font, size) + max(0, len(text) - 1) * char_space


def _fit_text(text: str, font: str, max_size: float, min_size: float, max_width: float, char_space: float = 0.0) -> float:
    size = max_size
    while size >= min_size:
        width = pdfmetrics.stringWidth(text, font, size) + max(0, len(text) - 1) * char_space
        if width <= max_width:
            return size
        size -= 0.1
    raise CardError(f"Text cannot fit inside {max_width / mm:.2f} mm: {text!r}")


def _draw_centered(c: canvas.Canvas, text: str, font: str, max_size: float, min_size: float, center_x: float, y: float, max_width: float, color: Any, char_space: float = 0.0, alpha: float | None = None) -> tuple[float, float]:
    size = _fit_text(text, font, max_size, min_size, max_width, char_space)
    width = pdfmetrics.stringWidth(text, font, size) + max(0, len(text) - 1) * char_space
    _draw_text(c, text, font, size, center_x - width / 2, y, color, char_space, alpha=alpha)
    return size, width


def _round_rect(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    radius: float,
    fill: Any,
    stroke: Any | None = None,
    line_width: float = 0.5,
    stroke_alpha: float | None = None,
) -> None:
    c.saveState()
    c.setFillColor(fill)
    if stroke is None:
        c.setStrokeColor(fill)
        stroke_flag = 0
    else:
        c.setStrokeColor(stroke)
        stroke_flag = 1
        c.setLineWidth(line_width)
        if stroke_alpha is not None:
            try:
                c.setStrokeAlpha(stroke_alpha)
            except AttributeError:
                pass
    c.roundRect(x, y, w, h, radius, fill=1, stroke=stroke_flag)
    c.restoreState()


def _draw_asset(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float) -> None:
    _draw_image_contain(c, path, x, y, w, h, alpha=True)


def _draw_background_asset(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float) -> None:
    """Draw an opaque doodle crop whose background is already the card color."""

    _draw_image_contain(c, path, x, y, w, h, alpha=False)


def _draw_spline(
    c: canvas.Canvas,
    start: tuple[float, float],
    control_a: tuple[float, float],
    control_b: tuple[float, float],
    end: tuple[float, float],
    color: Any,
    width: float = 0.45,
    dash: tuple[float, float] | None = None,
) -> None:
    """Draw a crisp PDF-native cubic spline for connective doodle rhythm."""

    c.saveState()
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.setLineCap(1)
    c.setLineJoin(1)
    if dash is not None:
        c.setDash(*dash)
    path = c.beginPath()
    path.moveTo(*start)
    path.curveTo(control_a[0], control_a[1], control_b[0], control_b[1], end[0], end[1])
    c.drawPath(path, stroke=1, fill=0)
    c.restoreState()


def _draw_vector_accents(c: canvas.Canvas) -> None:
    """Add sparse vector curves that tie the raster sprites together."""

    # A hand-drawn orbit echoes the original reference without redrawing the
    # exact supplied logo. It remains outside the logo's safe rectangle.
    _draw_spline(
        c,
        (3.5 * mm, 53.0 * mm),
        (2.2 * mm, 57.3 * mm),
        (2.2 * mm, 70.4 * mm),
        (3.9 * mm, 76.8 * mm),
        COLORS["mint"],
        0.42,
    )
    _draw_spline(
        c,
        (2.9 * mm, 51.6 * mm),
        (2.1 * mm, 57.0 * mm),
        (2.1 * mm, 69.5 * mm),
        (3.0 * mm, 75.2 * mm),
        COLORS["mint"],
        0.28,
    )

    # A quiet lower wave balances the two heavier lower sprites while staying
    # clear of the dynamic name, branch, and four-digit ID fields.
    _draw_spline(
        c,
        (18.2 * mm, 13.5 * mm),
        (20.0 * mm, 15.4 * mm),
        (21.3 * mm, 15.4 * mm),
        (23.2 * mm, 13.7 * mm),
        COLORS["mint"],
        0.35,
    )


def _resolve_color(name: str) -> Any:
    return COLORS[name]


def _apply_opacity_rotation(c: canvas.Canvas, opacity: float | None, rotation: float | None, center: tuple[float, float]) -> None:
    """Apply optional fill/stroke alpha and a clockwise rotation about center.

    Caller must already be inside a saveState()/restoreState() pair — this
    only mutates canvas state, it draws nothing. ReportLab's rotate() turns
    counter-clockwise for a positive angle, so a positive (clockwise, per
    R12.3) rotation value is negated before calling it.
    """
    if opacity is not None:
        try:
            c.setFillAlpha(opacity)
            c.setStrokeAlpha(opacity)
        except AttributeError:
            pass
    if rotation is not None:
        cx, cy = center
        c.translate(cx, cy)
        c.rotate(-rotation)
        c.translate(-cx, -cy)


def _validate_opacity_rotation(name: str, opacity: Any, rotation: Any) -> None:
    """Reject a bad layout value with a CardError instead of a raw crash.

    Without this, opacity=2.0 hits setFillAlpha and raises ValueError, and a
    non-numeric rotation hits c.rotate() and raises TypeError — both escape
    the CLI's `except CardError` handler as unhandled tracebacks. bool is a
    subclass of int in Python; it's rejected here rather than silently
    treated as opacity 0.0/1.0, since a stray `true`/`false` in hand-edited
    JSON is almost certainly a mistake, not an intended value.
    """
    if opacity is not None:
        if isinstance(opacity, bool) or not isinstance(opacity, (int, float)) or not math.isfinite(opacity) or not (0.0 <= opacity <= 1.0):
            raise CardError(f"opacity for {name!r} must be a number in [0.0, 1.0], got {opacity!r}")
    if rotation is not None:
        if isinstance(rotation, bool) or not isinstance(rotation, (int, float)) or not math.isfinite(rotation):
            raise CardError(f"rotation for {name!r} must be a finite number of degrees, got {rotation!r}")


def _draw_layout_element(c: canvas.Canvas, assets: AssetSet, fonts: FontSet, name: str, elem: dict[str, Any]) -> None:
    kind = elem["kind"]
    opacity = elem.get("opacity")
    rotation = elem.get("rotation")
    _validate_opacity_rotation(name, opacity, rotation)
    # R12.2/R23: both fields are optional. When neither is present we take
    # the exact pre-feature code path below (no saveState/transform/alpha
    # calls at all), so "no value set" renders byte-identical to before this
    # feature existed.
    transformed = opacity is not None or rotation is not None

    if kind == "sprite_alpha":
        x, y, w, h = elem["x"] * mm, elem["y"] * mm, elem["w"] * mm, elem["h"] * mm
        # Safe-area is always checked on the un-rotated, axis-aligned bbox —
        # rotation is a draw-time visual transform, not a change to the
        # element's declared geometry.
        _assert_safe(f"{name} doodle", x, y, w, h)
        if transformed:
            c.saveState()
            _apply_opacity_rotation(c, opacity, rotation, (x + w / 2, y + h / 2))
            _draw_asset(c, _asset_path(assets, elem["asset"]), x, y, w, h)
            c.restoreState()
        else:
            _draw_asset(c, _asset_path(assets, elem["asset"]), x, y, w, h)
    elif kind == "nostalgia_opaque":
        x, y, w, h = elem["x"] * mm, elem["y"] * mm, elem["w"] * mm, elem["h"] * mm
        _assert_safe(f"{name} doodle", x, y, w, h)
        if transformed:
            c.saveState()
            _apply_opacity_rotation(c, opacity, rotation, (x + w / 2, y + h / 2))
            _draw_background_asset(c, _nostalgia_asset_path(assets, elem["asset"]), x, y, w, h)
            c.restoreState()
        else:
            _draw_background_asset(c, _nostalgia_asset_path(assets, elem["asset"]), x, y, w, h)
    elif kind == "logo_alpha":
        x, y, w, h = elem["x"] * mm, elem["y"] * mm, elem["w"] * mm, elem["h"] * mm
        _assert_safe("logo", x, y, w, h)
        if transformed:
            c.saveState()
            _apply_opacity_rotation(c, opacity, rotation, (x + w / 2, y + h / 2))
            _draw_image_contain(c, assets.logo, x, y, w, h)
            c.restoreState()
        else:
            _draw_image_contain(c, assets.logo, x, y, w, h)
    elif kind == "text_static":
        color = _resolve_color(elem["color"])
        font = getattr(fonts, elem["font"])
        center_x = elem["center_x"] * mm
        baseline = elem["baseline"] * mm
        max_width = elem["max_width"] * mm
        if transformed:
            c.saveState()
            # Text pivot: (center_x, baseline) — the anchor the text is
            # already positioned on. Using the glyph-ink bbox center instead
            # would require measuring ascent/descent per font; the anchor
            # point is a reasonable, cheap judgment call for a UI-editor
            # feature and matches what an editor user sees as "the text's
            # position."
            _apply_opacity_rotation(c, opacity, rotation, (center_x, baseline))
            # opacity must ALSO be passed straight to _draw_centered: a
            # PDFTextObject.setFillColor(color) call (which _draw_text makes
            # regardless) resets fill alpha to the color's own .alpha
            # (always 1), silently discarding the c.setFillAlpha() just set
            # above. The canvas-level call still matters for rotation state.
            size, width = _draw_centered(c, elem["text"], font, elem["max_size"], elem["min_size"], center_x, baseline, max_width, color, elem.get("char_space", 0.0), alpha=opacity)
            c.restoreState()
        else:
            size, width = _draw_centered(c, elem["text"], font, elem["max_size"], elem["min_size"], center_x, baseline, max_width, color, elem.get("char_space", 0.0))
        _assert_safe(f"event text {elem['text']}", center_x - width / 2, baseline - size * 0.25, width, size * 1.1)
    elif kind == "line":
        if transformed:
            c.saveState()
            # setStrokeColor(color) resets stroke alpha to the color's own
            # .alpha (always 1) if called after _apply_opacity_rotation, so
            # it must run first — _apply_opacity_rotation's setStrokeAlpha
            # call needs to be the last word before c.line() draws.
            c.setStrokeColor(_resolve_color(elem["color"]))
            c.setLineWidth(elem["width"])
            # Line pivot: the midpoint of its two endpoints.
            midpoint = ((elem["x1"] + elem["x2"]) / 2 * mm, (elem["y1"] + elem["y2"]) / 2 * mm)
            _apply_opacity_rotation(c, opacity, rotation, midpoint)
            c.line(elem["x1"] * mm, elem["y1"] * mm, elem["x2"] * mm, elem["y2"] * mm)
            c.restoreState()
        else:
            c.setStrokeColor(_resolve_color(elem["color"]))
            c.setLineWidth(elem["width"])
            c.line(elem["x1"] * mm, elem["y1"] * mm, elem["x2"] * mm, elem["y2"] * mm)
    else:
        raise CardError(f"Unknown static layout element kind for {name!r}: {kind}")


def _draw_static(c: canvas.Canvas, assets: AssetSet, fonts: FontSet, layout: dict[str, Any]) -> None:
    c.setFillColor(COLORS["background"])
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    elements = layout["elements"]
    non_logo = sorted((item for item in elements.items() if item[1]["kind"] != "logo_alpha"), key=lambda item: item[1].get("z", 0))
    logo_items = [item for item in elements.items() if item[1]["kind"] == "logo_alpha"]

    for name, elem in non_logo:
        _draw_layout_element(c, assets, fonts, name, elem)

    # Vector spline accents and the identity logo are always the final two
    # static layers, in that order, regardless of any "z" an editor sets —
    # no opaque doodle can ever cover the supplied logo.
    _draw_vector_accents(c)
    for name, elem in logo_items:
        _draw_layout_element(c, assets, fonts, name, elem)


def _draw_photo(c: canvas.Canvas, path: Path, photo_elem: dict[str, Any], pan_x: float, pan_y: float, zoom: float) -> None:
    photo_x, photo_y = photo_elem["x"] * mm, photo_elem["y"] * mm
    photo_w, photo_h = photo_elem["w"] * mm, photo_elem["h"] * mm
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    target_w = max(1, int(photo_w / 72 * 600))
    target_h = max(1, int(photo_h / 72 * 600))
    cropped = _cover_crop(image, target_w, target_h, pan_x, pan_y, zoom)
    reader = ImageReader(cropped)
    c.saveState()
    path_obj = c.beginPath()
    path_obj.roundRect(photo_x, photo_y, photo_w, photo_h, photo_elem.get("corner_radius", 3.0) * mm)
    c.clipPath(path_obj, stroke=0, fill=0)
    c.drawImage(reader, photo_x, photo_y, width=photo_w, height=photo_h, preserveAspectRatio=False, mask="auto")
    c.restoreState()


def _assert_safe(name: str, x: float, y: float, w: float, h: float) -> None:
    if x < SAFE_INSET - 0.01 or y < SAFE_INSET - 0.01 or x + w > PAGE_W - SAFE_INSET + 0.01 or y + h > PAGE_H - SAFE_INSET + 0.01:
        raise CardError(f"Protected element leaves safe area: {name}")


def _draw_dynamic(c: canvas.Canvas, record: CardRecord, fonts: FontSet, layout: dict[str, Any], override: dict[str, Any], proof: bool = False) -> None:
    dynamic = layout["dynamic"]
    photo_elem = dynamic["photo_box"]
    photo_x, photo_y = photo_elem["x"] * mm, photo_elem["y"] * mm
    photo_w, photo_h = photo_elem["w"] * mm, photo_elem["h"] * mm
    _assert_safe("photo", photo_x, photo_y, photo_w, photo_h)
    # Keep the entire portrait panel above the static doodle layer, not only
    # the transparent face pixels.
    _round_rect(c, photo_x, photo_y, photo_w, photo_h, photo_elem.get("corner_radius", 3.0) * mm, COLORS["coral"])
    photo_override = override.get("photo", {})
    _draw_photo(
        c,
        record.photo_path,
        photo_elem,
        pan_x=photo_override.get("pan_x", OVERRIDABLE_DYNAMIC_FIELDS["photo"]["pan_x"]),
        pan_y=photo_override.get("pan_y", OVERRIDABLE_DYNAMIC_FIELDS["photo"]["pan_y"]),
        zoom=photo_override.get("zoom", OVERRIDABLE_DYNAMIC_FIELDS["photo"]["zoom"]),
    )

    name_elem = dynamic["name"]
    branch_elem = dynamic["branch"]
    name_override = override.get("name", {})
    branch_override = override.get("branch", {})

    name_baseline = (name_elem["baseline"] + name_override.get("baseline_dy", 0.0)) * mm
    branch_baseline = (branch_elem["baseline"] + branch_override.get("baseline_dy", 0.0)) * mm
    name_max_size = name_override.get("size_override") or name_elem["max_size"]
    branch_max_size = branch_override.get("size_override") or branch_elem["max_size"]

    # A per-record name override replaces the manifest name, upper-cased the
    # same way the manifest name is at load (idcards.py normalizes to upper).
    override_name = name_override.get("text")
    # Guard whitespace-only overrides (e.g. a hand-edited "text": " "): they
    # would strip to "" and blank the name. Fall back to the manifest name.
    name_text = override_name.strip().upper() if override_name and override_name.strip() else record.name

    name_size, name_width = _draw_centered(
        c, name_text, getattr(fonts, name_elem["font"]), name_max_size, name_elem["min_size"],
        PAGE_W / 2, name_baseline, PAGE_W - name_elem["max_width_margin"] * mm, _resolve_color(name_elem["color"]), name_elem.get("char_space", 0.0),
    )
    branch_size, branch_width = _draw_centered(
        c, record.branch, getattr(fonts, branch_elem["font"]), branch_max_size, branch_elem["min_size"],
        PAGE_W / 2, branch_baseline, PAGE_W - branch_elem["max_width_margin"] * mm, _resolve_color(branch_elem["color"]), branch_elem.get("char_space", 0.0),
    )
    _assert_safe("name", PAGE_W / 2 - name_width / 2, name_baseline - name_size * 0.25, name_width, name_size * 1.1)
    _assert_safe("branch", PAGE_W / 2 - branch_width / 2, branch_baseline - branch_size * 0.25, branch_width, branch_size * 1.1)

    id_elem = dynamic["id_badge"]
    id_w = id_elem["w"] * mm
    id_h = id_elem["h"] * mm
    id_x = (PAGE_W - id_w) / 2
    id_y = id_elem["y"] * mm
    _assert_safe("attendee_id", id_x, id_y, id_w, id_h)
    _round_rect(c, id_x, id_y, id_w, id_h, id_h / 2, COLORS["background"], COLORS["mint"], 0.35, stroke_alpha=0.62)
    _draw_centered(
        c, record.attendee_id, getattr(fonts, id_elem["font"]), id_elem["max_size"], id_elem["min_size"],
        PAGE_W / 2, id_y + id_elem["text_y_offset"] * mm, id_w - id_elem["width_margin"] * mm, COLORS["ivory"], id_elem.get("char_space", 0.0),
    )

    if proof:
        _draw_guides(c)


def _draw_guides(c: canvas.Canvas) -> None:
    c.saveState()
    try:
        c.setStrokeAlpha(0.75)
        c.setFillAlpha(0.85)
    except AttributeError:
        pass
    c.setStrokeColor(HexColor("#5BE6E6"))
    c.setDash(2, 2)
    c.setLineWidth(0.45)
    c.rect(SAFE_INSET, SAFE_INSET, PAGE_W - 2 * SAFE_INSET, PAGE_H - 2 * SAFE_INSET, fill=0, stroke=1)
    c.restoreState()


def default_layout_path() -> Path:
    return package_root() / "layout.json"


def load_layout(path: Path | None) -> dict[str, Any]:
    """Load the template layout, creating the default file on first use.

    An explicit path must already exist. With no path, the layout lives
    beside idcards.py and is materialized from DEFAULT_LAYOUT the first time
    anything renders, mirroring how prepare_assets() materializes images.
    """
    target = path or default_layout_path()
    if not target.is_file():
        if path is not None:
            raise CardError(f"Layout file does not exist: {target}")
        write_json(target, DEFAULT_LAYOUT)
        return json.loads(json.dumps(DEFAULT_LAYOUT))
    return load_json(target)


def load_override(overrides_dir: Path | None, attendee_id: str) -> dict[str, Any]:
    if overrides_dir is None:
        return {}
    path = overrides_dir / f"{attendee_id}.json"
    if not path.is_file():
        return {}
    return load_json(path)


def find_record(records: list[CardRecord], attendee_id: str) -> CardRecord | None:
    for record in records:
        if record.attendee_id == attendee_id:
            return record
    return None


def _layout_uses_static_opacity(layout: dict[str, Any]) -> bool:
    """True iff any static element sets opacity.

    ReportLab 4.5.1 registers the transparency ExtGState that
    setFillAlpha()/setStrokeAlpha() emit onto the PAGE's resources, not a
    Form XObject's — even when the alpha call happens while building the
    form's content stream between beginForm()/endForm(). A form that then
    references that ExtGState is malformed: poppler (pdftoppm) rejects it
    with "ExtGState '...' is unknown", though ReportLab itself writes the
    file without complaint. Rotation-only elements are unaffected — rotation
    only emits inline `cm` operators, which need no resource entry.
    """
    return any(elem.get("opacity") is not None for elem in layout["elements"].values())


def render_pdf(
    records: list[CardRecord],
    output: Path,
    assets: AssetSet,
    proof: bool = False,
    layout: dict[str, Any] | None = None,
    overrides_dir: Path | None = None,
) -> dict[str, Any]:
    fonts = register_fonts()
    prepare_assets(assets)
    layout = layout if layout is not None else load_layout(None)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{output.stem}-", suffix=".pdf", dir=output.parent)
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        c = canvas.Canvas(str(temp_path), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
        c.setTitle("Smriti 2026 Attendee IDs")
        c.setAuthor("Smriti ID Card Mail Merge")
        # The Form XObject is a real win (static content shared across every
        # page instead of repeated per page) and is correct for the common
        # case. It only breaks once a static element sets opacity — see
        # _layout_uses_static_opacity — so that's the one case we draw the
        # static layer directly per page instead of through the form.
        use_form = not _layout_uses_static_opacity(layout)
        if use_form:
            c.beginForm("static_card", 0, 0, PAGE_W, PAGE_H)
            _draw_static(c, assets, fonts, layout)
            c.endForm()
        for record in records:
            if use_form:
                c.doForm("static_card")
            else:
                _draw_static(c, assets, fonts, layout)
            override = load_override(overrides_dir, record.attendee_id)
            _draw_dynamic(c, record, fonts, layout, override, proof=proof)
            c.showPage()
        c.save()
        _set_page_boxes(temp_path)
        report = verify_pdf(temp_path, len(records))
        os.replace(temp_path, output)
        return report
    finally:
        if temp_path.exists():
            temp_path.unlink()


def _set_page_boxes(path: Path) -> None:
    """Make every physical page box exactly equal to the card trim."""

    reader = PdfReader(str(path))
    writer = PdfWriter()
    for source_page in reader.pages:
        page = source_page
        rect = RectangleObject((0, 0, PAGE_W, PAGE_H))
        page.mediabox = rect
        page.cropbox = rect
        page.trimbox = rect
        page.bleedbox = rect
        writer.add_page(page)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.stem}-boxes-", suffix=".pdf", dir=path.parent)
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        with temp_path.open("wb") as stream:
            writer.write(stream)
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def _box_tuple(box: Any) -> tuple[float, float, float, float]:
    return (float(box.left), float(box.bottom), float(box.right), float(box.top))


def verify_pdf(path: Path, expected_pages: int) -> dict[str, Any]:
    reader = PdfReader(str(path))
    if len(reader.pages) != expected_pages:
        raise CardError(f"PDF page count {len(reader.pages)} != expected {expected_pages}")
    expected = (PAGE_W, PAGE_H)
    pages_report: list[dict[str, Any]] = []
    fonts_embedded = True
    font_names: set[str] = set()
    for page_number, page in enumerate(reader.pages, start=1):
        if page.get("/Rotate", 0) not in (0, None):
            raise CardError(f"Page {page_number} has rotation; expected 0")
        expected_box_names = ("MediaBox", "CropBox", "TrimBox", "BleedBox")
        missing = [name for name in expected_box_names if page.get(f"/{name}") is None]
        if missing:
            raise CardError(f"Page {page_number} is missing required PDF boxes: {', '.join(missing)}")
        boxes = {name: _box_tuple(getattr(page, name.lower())) for name in expected_box_names}
        media = boxes["MediaBox"]
        width = media[2] - media[0]
        height = media[3] - media[1]
        if abs(width - expected[0]) > 0.01 or abs(height - expected[1]) > 0.01:
            raise CardError(f"Page {page_number} size {width:.4f}x{height:.4f}pt != {expected[0]:.4f}x{expected[1]:.4f}pt")
        for box_name, box in boxes.items():
            if any(abs(left - right) > 0.01 for left, right in zip(box, media)):
                raise CardError(f"Page {page_number} {box_name} differs from MediaBox")
        resources = page.get("/Resources", {})
        fonts = resources.get("/Font", {}) if resources else {}
        for ref in fonts.values():
            font = ref.get_object()
            subtype = font.get("/Subtype")
            base_font = str(font.get("/BaseFont", ""))
            if base_font:
                font_names.add(base_font.lstrip("/"))
            # ReportLab keeps Helvetica in the resource dictionary as a
            # harmless default even when no production text uses it. It is a
            # PDF base-14 font and has no embedded program by design.
            if subtype == "/Type1" and base_font in {"/Helvetica", "/Helvetica-Bold", "/Helvetica-Oblique", "/Helvetica-BoldOblique"}:
                continue
            descriptor_ref = font.get("/FontDescriptor")
            if not descriptor_ref:
                fonts_embedded = False
                continue
            descriptor = descriptor_ref.get_object()
            if not any(descriptor.get(key) for key in ("/FontFile", "/FontFile2", "/FontFile3")):
                fonts_embedded = False
        pages_report.append({"page": page_number, "width_pt": width, "height_pt": height, "boxes": boxes})
    if not fonts_embedded:
        raise CardError("PDF contains a font without an embedded font program")
    return {
        "pages": expected_pages,
        "page_size_mm": [54.0, 85.6],
        "page_size_pt": [PAGE_W, PAGE_H],
        "fonts_embedded": fonts_embedded,
        "font_names": sorted(font_names),
        "pages_report": pages_report,
    }


def render_proof_images(pdf_path: Path, output_dir: Path, dpi: int = 300) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = output_dir / "card"
    bundled_binary = Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/pdftoppm")
    binary = bundled_binary if bundled_binary.exists() else Path(shutil.which("pdftoppm") or "pdftoppm")
    env = os.environ.copy()
    bundled_lib = bundled_binary.parent.parent / "lib"
    if bundled_lib.is_dir():
        env["LD_LIBRARY_PATH"] = f"{bundled_lib}:{env.get('LD_LIBRARY_PATH', '')}".rstrip(":")
    command = [str(binary), "-png", "-r", str(dpi), str(pdf_path), str(prefix)]
    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True, env=env)
        diagnostics = completed.stderr.strip()
        if re.search(r"\b(error|unknown|invalid)\b", diagnostics, flags=re.IGNORECASE):
            raise CardError(f"pdftoppm reported a rendering diagnostic: {diagnostics}")
    except FileNotFoundError as exc:
        raise CardError("pdftoppm is required for proof rendering") from exc
    except subprocess.CalledProcessError as exc:
        raise CardError(f"pdftoppm failed: {exc.stderr.strip()}") from exc
    return sorted(output_dir.glob("card-*.png"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Render JSON attendee records as portrait CR80 ID-card PDF pages")
    sub = parser.add_subparsers(dest="command", required=True)

    validate = sub.add_parser("validate", help="validate a JSON manifest without writing a PDF")
    validate.add_argument("manifest", type=Path)
    validate.add_argument("--assets-dir", type=Path, default=None)

    prepare = sub.add_parser("prepare-assets", help="normalize and slice the fixed-grid doodle sources into named opaque assets")
    prepare.add_argument("--assets-dir", type=Path, default=None)

    render = sub.add_parser("render", help="render one PDF page per JSON card record")
    render.add_argument("manifest", type=Path)
    render.add_argument("--output", type=Path, required=True)
    render.add_argument("--assets-dir", type=Path, default=None)
    render.add_argument("--layout", type=Path, default=None, help="layout.json path (default: package_root/layout.json, auto-created)")
    render.add_argument("--overrides-dir", type=Path, default=None, help="per-attendee override dir (default: package_root/data/overrides if it exists)")

    proof = sub.add_parser("proof", help="render a guided proof PDF and raster proof pages")
    proof.add_argument("manifest", type=Path)
    proof.add_argument("--output-dir", type=Path, required=True)
    proof.add_argument("--assets-dir", type=Path, default=None)
    proof.add_argument("--dpi", type=int, default=300)
    proof.add_argument("--layout", type=Path, default=None, help="layout.json path (default: package_root/layout.json, auto-created)")
    proof.add_argument("--overrides-dir", type=Path, default=None, help="per-attendee override dir (default: package_root/data/overrides if it exists)")
    return parser


def _resolve_overrides_dir(explicit: Path | None) -> Path | None:
    if explicit is not None:
        return explicit
    default_dir = package_root() / "data" / "overrides"
    return default_dir if default_dir.is_dir() else None


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        assets = default_assets(args.assets_dir)
        fonts = register_fonts()
        if args.command == "prepare-assets":
            manifest = prepare_assets(assets)
            print(json.dumps(manifest, indent=2))
            return 0
        if not args.manifest.is_file():
            raise CardError(
                f"Manifest not found: {args.manifest}. Run `make dump` to build data/attendees.json "
                "from the database, or use fixtures/attendees.json for a sample."
            )
        records = validate_manifest(args.manifest, fonts)
        if args.command == "validate":
            print(json.dumps({"valid": True, "cards": len(records), "attendee_ids": [record.attendee_id for record in records]}, indent=2))
            return 0
        if args.command == "render":
            layout = load_layout(args.layout)
            overrides_dir = _resolve_overrides_dir(args.overrides_dir)
            report = render_pdf(records, args.output, assets, proof=False, layout=layout, overrides_dir=overrides_dir)
            report_path = args.output.with_suffix(".report.json")
            write_json(report_path, report)
            print(json.dumps({"output": str(args.output), "report": str(report_path), **report}, indent=2))
            return 0
        if args.command == "proof":
            layout = load_layout(args.layout)
            overrides_dir = _resolve_overrides_dir(args.overrides_dir)
            args.output_dir.mkdir(parents=True, exist_ok=True)
            proof_pdf = args.output_dir / "proof.pdf"
            report = render_pdf(records, proof_pdf, assets, proof=True, layout=layout, overrides_dir=overrides_dir)
            pages = render_proof_images(proof_pdf, args.output_dir / "pages", dpi=args.dpi)
            write_json(args.output_dir / "report.json", {**report, "proof_pages": [str(page) for page in pages], "dpi": args.dpi})
            print(json.dumps({"proof_pdf": str(proof_pdf), "pages": [str(page) for page in pages], **report}, indent=2))
            return 0
        raise CardError(f"Unknown command: {args.command}")
    except CardError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
