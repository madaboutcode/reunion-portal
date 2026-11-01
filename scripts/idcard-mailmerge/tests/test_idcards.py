import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageChops
from pypdf import PdfReader
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import idcards


class _CanvasSpy:
    """Wraps a real ReportLab canvas, recording calls to the specific
    methods the opacity/rotation feature can invoke, while delegating every
    call (including the watched ones) to the real canvas so drawing still
    works normally. Used to prove the "fields absent" code path makes none
    of these calls at all -- not merely that they cancel out."""

    WATCHED = ("saveState", "restoreState", "setFillAlpha", "setStrokeAlpha", "rotate", "translate")

    def __init__(self, real: canvas.Canvas) -> None:
        self._real = real
        self.calls: list[str] = []

    def __getattr__(self, item: str):
        attr = getattr(self._real, item)
        if item in self.WATCHED and callable(attr):
            def recording(*args, **kwargs):
                self.calls.append(item)
                return attr(*args, **kwargs)

            return recording
        return attr


class MailMergeTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.assets = idcards.default_assets(self.root / "assets")
        idcards.prepare_assets(self.assets)
        self.fonts = idcards.register_fonts()

    def test_fixture_renders_one_page_per_record(self):
        manifest = self.root / "fixtures" / "attendees.json"
        records = idcards.validate_manifest(manifest, self.fonts)
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "cards.pdf"
            report = idcards.render_pdf(records, output, self.assets)
            self.assertEqual(report["pages"], 3)
            reader = PdfReader(str(output))
            self.assertEqual(len(reader.pages), 3)
            self.assertTrue(any("BarlowCondensed" in name for name in report["font_names"]))
            for page in reader.pages:
                self.assertAlmostEqual(float(page.mediabox.width), idcards.PAGE_W, places=2)
                self.assertAlmostEqual(float(page.mediabox.height), idcards.PAGE_H, places=2)

    def test_name_text_override_replaces_manifest_name_uppercased(self):
        manifest = self.root / "fixtures" / "attendees.json"
        records = idcards.validate_manifest(manifest, self.fonts)
        target = records[0]  # attendee_id "0001", manifest name "SAMPLE PERSON"
        with tempfile.TemporaryDirectory() as temp:
            overrides_dir = Path(temp) / "overrides"
            overrides_dir.mkdir()
            # lower-case input proves the renderer upper-cases it like the manifest name
            (overrides_dir / f"{target.attendee_id}.json").write_text(
                json.dumps({"name": {"text": "shorty nair"}}), encoding="utf-8"
            )

            plain = Path(temp) / "plain.pdf"
            overridden = Path(temp) / "overridden.pdf"
            idcards.render_pdf([target], plain, self.assets)
            idcards.render_pdf([target], overridden, self.assets, overrides_dir=overrides_dir)

            def flat_text(path: Path) -> str:
                page = PdfReader(str(path)).pages[0]
                return "".join(page.extract_text().split()).upper()

            self.assertIn("SAMPLEPERSON", flat_text(plain))
            self.assertIn("SHORTYNAIR", flat_text(overridden))
            self.assertNotIn("SAMPLEPERSON", flat_text(overridden))

    def test_numeric_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            manifest = Path(temp) / "bad.json"
            manifest.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "cards": [
                            {
                                "name": "TEST",
                                "branch": "CIVIL ENGINEERING",
                                "photo_path": "../assets/sample-photo.webp",
                                "attendee_id": 42,
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(idcards.CardError):
                idcards.validate_manifest(manifest, self.fonts)

    def test_duplicate_id_is_rejected(self):
        manifest = self.root / "fixtures" / "attendees.json"
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["cards"][1]["attendee_id"] = data["cards"][0]["attendee_id"]
        with tempfile.TemporaryDirectory() as temp:
            bad = Path(temp) / "duplicate.json"
            bad.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(idcards.CardError):
                idcards.validate_manifest(bad, self.fonts)

    def test_slot_is_not_part_of_renderer(self):
        source = (self.root / "idcards.py").read_text(encoding="utf-8")
        self.assertNotIn("SLOT_", source)
        self.assertNotIn("slot_x", source)

    def test_kerala_doodle_sheet_has_exact_card_background(self):
        """Opaque direct-background doodles must not rely on chroma keying."""
        with Image.open(self.assets.nostalgia_sprite_sheet) as image:
            rgba = image.convert("RGBA")
        expected = tuple(int(channel * 255) for channel in idcards.COLORS["background"].rgb())
        corners = (
            rgba.getpixel((0, 0)),
            rgba.getpixel((rgba.width - 1, 0)),
            rgba.getpixel((0, rgba.height - 1)),
            rgba.getpixel((rgba.width - 1, rgba.height - 1)),
        )
        for color in corners:
            self.assertEqual(color[:3], expected)
            self.assertEqual(color[3], 255)

    def test_colored_doodle_sheet_contains_visible_terracotta(self):
        with Image.open(self.assets.nostalgia_sprite_sheet) as image:
            rgb = image.convert("RGB")
            terracotta_pixels = sum(1 for red, green, blue in rgb.getdata() if red > 150 and red - green > 35 and red - blue > 25)
        self.assertGreater(terracotta_pixels, 500)

    def test_gridded_sources_and_crops_are_native_rgb(self):
        expected_background = (23, 27, 27)
        for sheet in (self.assets.hero_a_sheet, self.assets.hero_b_sheet, self.assets.micro_sheet):
            with Image.open(sheet) as image:
                self.assertEqual(image.size, (1536, 1024))
                self.assertEqual(image.mode, "RGB")
                self.assertEqual(image.getpixel((0, 0)), expected_background)
        crop_names = (
            "friends", "tea_glass", "autograph_book", "cassette", "compass", "set_square",
            "compass_faded", "set_square_faded",
            "paper_plane_mint", "paper_plane_terracotta", "heart_mint", "heart_terracotta",
            "star_mint", "star_terracotta", "sparkle_mint", "sparkle_terracotta",
            "plus_mint", "plus_terracotta", "dot_mint", "dot_terracotta",
            "burst_mint", "burst_terracotta",
        )
        for name in crop_names:
            with Image.open(self.assets.gridded_crops_dir / f"{name}.png") as image:
                self.assertEqual(image.mode, "RGB")
                self.assertEqual(image.getpixel((0, 0)), expected_background)
                self.assertEqual(image.getpixel((image.width - 1, image.height - 1)), expected_background)

    def test_renderer_does_not_place_an_ipod(self):
        source = (self.root / "idcards.py").read_text(encoding="utf-8")
        self.assertNotIn('_nostalgia_asset_path(assets, "music_player")', source)
        self.assertNotIn('_nostalgia_asset_path(assets, "bus_ticket")', source)
        for removed in ("tea_snack", "pazham_pori", "feature_phone", "kerala_bus"):
            self.assertNotIn(f'_nostalgia_asset_path(assets, "{removed}")', source)

    # -- R22/R23 opacity + rotation -----------------------------------------
    #
    # These helpers render a single static layout element (bypassing the
    # per-record photo/name pipeline entirely) against a hand-built probe
    # asset whose ink occupies only the top-left quadrant of its own bbox.
    # That asymmetry is what lets a test tell a clockwise rotation apart
    # from a counter-clockwise one: a symmetric shape (a plain rectangle, a
    # line through its own midpoint) looks identical under +90 and -90, an
    # asymmetric one does not.

    def _make_probe_asset(self, crops_dir: Path) -> None:
        probe = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
        red_quadrant = Image.new("RGBA", (100, 100), (220, 40, 40, 255))
        probe.paste(red_quadrant, (0, 0))  # PIL row 0 = visual top -> top-left quadrant
        probe.save(crops_dir / "rotation_probe.png")

    def _render_probe(self, elem_or_elems: dict | list[dict], dpi: int = 150) -> Image.Image:
        """Render one or more elements, in order, onto a blank card.

        A list draws every element on the same canvas in sequence -- used
        by the restore-leak test to check that one element's transform
        doesn't bleed into the next one drawn.
        """
        elems = elem_or_elems if isinstance(elem_or_elems, list) else [elem_or_elems]
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            crops_dir = temp_path / "crops"
            crops_dir.mkdir()
            self._make_probe_asset(crops_dir)
            unused = temp_path / "unused.png"
            assets = idcards.AssetSet(
                root=temp_path,
                logo=unused,
                sprite_sheet=unused,
                crops_dir=crops_dir,
                nostalgia_sprite_sheet=unused,
                nostalgia_crops_dir=temp_path,
                hero_a_sheet=unused,
                hero_b_sheet=unused,
                micro_sheet=unused,
                gridded_crops_dir=temp_path,
            )
            pdf_path = temp_path / "probe.pdf"
            c = canvas.Canvas(str(pdf_path), pagesize=(idcards.PAGE_W, idcards.PAGE_H))
            c.setFillColor(idcards.COLORS["background"])
            c.rect(0, 0, idcards.PAGE_W, idcards.PAGE_H, fill=1, stroke=0)
            for index, elem in enumerate(elems):
                idcards._draw_layout_element(c, assets, self.fonts, f"probe{index}", elem)
            c.showPage()
            c.save()
            pages = idcards.render_proof_images(pdf_path, temp_path / "pages", dpi=dpi)
            with Image.open(pages[0]) as img:
                return img.convert("RGB").copy()

    @staticmethod
    def _mm_to_px(x_mm: float, y_mm: float, dpi: int, img_h_px: int) -> tuple[float, float]:
        """Convert a (x, y-from-bottom) mm point to (px-from-left, px-from-top)."""
        px_x = x_mm * idcards.mm / 72.0 * dpi
        px_y_from_bottom = y_mm * idcards.mm / 72.0 * dpi
        return px_x, img_h_px - px_y_from_bottom

    def _crop_bbox(self, img: Image.Image, elem: dict, dpi: int) -> Image.Image:
        img_h = img.size[1]
        left, top = self._mm_to_px(elem["x"], elem["y"] + elem["h"], dpi, img_h)
        right, bottom = self._mm_to_px(elem["x"] + elem["w"], elem["y"], dpi, img_h)
        return img.crop((round(left), round(top), round(right), round(bottom)))

    @staticmethod
    def _average_pixel(img: Image.Image) -> tuple[float, float, float]:
        data = list(img.convert("RGB").getdata())
        n = len(data)
        return (sum(p[0] for p in data) / n, sum(p[1] for p in data) / n, sum(p[2] for p in data) / n)

    @staticmethod
    def _quadrant_has_red(crop: Image.Image, quadrant: str) -> bool:
        w, h = crop.size
        # Inset a few px from the quadrant-dividing lines: pdftoppm's
        # resampling leaves a 1px anti-aliased sliver right at that
        # boundary, which would otherwise register as "red" in both
        # quadrants it straddles regardless of which side holds the ink.
        margin = max(3, w // 12)
        mid_x, mid_y = w // 2, h // 2
        boxes = {
            "top_left": (0, 0, mid_x - margin, mid_y - margin),
            "top_right": (mid_x + margin, 0, w, mid_y - margin),
            "bottom_left": (0, mid_y + margin, mid_x - margin, h),
            "bottom_right": (mid_x + margin, mid_y + margin, w, h),
        }
        region = crop.crop(boxes[quadrant])
        return any(r > 150 and (r - g) > 60 and (r - b) > 60 for r, g, b in region.getdata())

    def test_opacity_rotation_apply_within_expected_region(self):
        elem_base = {"z": 1, "kind": "sprite_alpha", "asset": "rotation_probe", "x": 10.0, "y": 40.0, "w": 20.0, "h": 20.0}
        elem_transformed = dict(elem_base, opacity=0.5, rotation=15)
        dpi = 150

        img_base = self._render_probe(elem_base, dpi=dpi)
        img_transformed = self._render_probe(elem_transformed, dpi=dpi)
        diff = ImageChops.difference(img_base, img_transformed)
        diff_mask = diff.convert("L").point(lambda v: 255 if v > 10 else 0)
        bbox = diff_mask.getbbox()
        self.assertIsNotNone(bbox, "opacity/rotation had no visible effect on the render")

        # The change must stay near the transformed element (padded for the
        # 15-degree tilt), not leak across the whole card -- that would mean
        # a saveState()/restoreState() imbalance bled canvas state into
        # neighboring draws.
        left, top = self._mm_to_px(elem_base["x"] - 6, elem_base["y"] + elem_base["h"] + 6, dpi, img_base.size[1])
        right, bottom = self._mm_to_px(elem_base["x"] + elem_base["w"] + 6, elem_base["y"] - 6, dpi, img_base.size[1])
        self.assertGreaterEqual(bbox[0], left)
        self.assertGreaterEqual(bbox[1], top)
        self.assertLessEqual(bbox[2], right)
        self.assertLessEqual(bbox[3], bottom)

        # Opacity specifically (isolated from rotation): a pixel inside the
        # unrotated probe's red quadrant should blend toward the card
        # background at opacity 0.5, rather than staying pure ink.
        img_half_opacity = self._render_probe(dict(elem_base, opacity=0.5), dpi=dpi)
        sample_x, sample_y = self._mm_to_px(elem_base["x"] + elem_base["w"] * 0.25, elem_base["y"] + elem_base["h"] * 0.75, dpi, img_base.size[1])
        sample = (round(sample_x), round(sample_y))
        full_pixel = img_base.getpixel(sample)
        half_pixel = img_half_opacity.getpixel(sample)
        background_pixel = tuple(round(channel * 255) for channel in idcards.COLORS["background"].rgb())
        self.assertNotEqual(half_pixel, full_pixel)
        self.assertLess(abs(half_pixel[0] - background_pixel[0]), abs(full_pixel[0] - background_pixel[0]))

    def test_absent_opacity_rotation_renders_deterministically(self):
        """R12.2/R23: with no opacity/rotation fields, output is unaffected — proved here as reproducible, since no pre-feature snapshot exists to byte-compare against."""
        manifest = self.root / "fixtures" / "attendees.json"
        records = idcards.validate_manifest(manifest, self.fonts)[:1]
        layout = copy.deepcopy(idcards.DEFAULT_LAYOUT)
        self.assertTrue(all("opacity" not in elem and "rotation" not in elem for elem in layout["elements"].values()))
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            out_a = temp_path / "a.pdf"
            out_b = temp_path / "b.pdf"
            idcards.render_pdf(records, out_a, self.assets, layout=layout)
            idcards.render_pdf(records, out_b, self.assets, layout=layout)
            pages_a = idcards.render_proof_images(out_a, temp_path / "pages_a", dpi=150)
            pages_b = idcards.render_proof_images(out_b, temp_path / "pages_b", dpi=150)
            with Image.open(pages_a[0]) as img_a, Image.open(pages_b[0]) as img_b:
                self.assertEqual(list(img_a.convert("RGB").getdata()), list(img_b.convert("RGB").getdata()))

    def test_rotation_applies_clockwise(self):
        """R12.3: positive rotation is clockwise about the element's own center."""
        elem = {"z": 1, "kind": "sprite_alpha", "asset": "rotation_probe", "x": 10.0, "y": 40.0, "w": 20.0, "h": 20.0}
        dpi = 150

        img_base = self._render_probe(elem, dpi=dpi)
        img_rotated = self._render_probe(dict(elem, rotation=90), dpi=dpi)
        crop_base = self._crop_bbox(img_base, elem, dpi)
        crop_rotated = self._crop_bbox(img_rotated, elem, dpi)

        # Sanity-check the probe's own construction: unrotated, its red ink
        # sits in the top-left quadrant of its bbox.
        self.assertTrue(self._quadrant_has_red(crop_base, "top_left"))
        self.assertFalse(self._quadrant_has_red(crop_base, "top_right"))

        # A 90-degree clockwise turn moves top-left content to top-right
        # (like a clock hand sweeping from 12 to 3). Counter-clockwise would
        # move it to bottom-left instead — that's the direction this test
        # catches.
        self.assertTrue(self._quadrant_has_red(crop_rotated, "top_right"))
        self.assertFalse(self._quadrant_has_red(crop_rotated, "bottom_left"))

    def test_opacity_out_of_range_raises_card_error(self):
        elem = {"z": 1, "kind": "line", "x1": 4.5, "y1": 34.7, "x2": 25.2, "y2": 34.7, "color": "mint", "width": 0.55, "opacity": 2.0}
        with tempfile.TemporaryDirectory() as temp:
            pdf_path = Path(temp) / "invalid.pdf"
            c = canvas.Canvas(str(pdf_path), pagesize=(idcards.PAGE_W, idcards.PAGE_H))
            with self.assertRaises(idcards.CardError) as ctx:
                idcards._draw_layout_element(c, self.assets, self.fonts, "divider_line", elem)
        self.assertIn("divider_line", str(ctx.exception))
        self.assertIn("opacity", str(ctx.exception))

    def test_non_numeric_rotation_raises_card_error(self):
        elem = {"z": 1, "kind": "line", "x1": 4.5, "y1": 34.7, "x2": 25.2, "y2": 34.7, "color": "mint", "width": 0.55, "rotation": "x"}
        with tempfile.TemporaryDirectory() as temp:
            pdf_path = Path(temp) / "invalid.pdf"
            c = canvas.Canvas(str(pdf_path), pagesize=(idcards.PAGE_W, idcards.PAGE_H))
            with self.assertRaises(idcards.CardError) as ctx:
                idcards._draw_layout_element(c, self.assets, self.fonts, "divider_line", elem)
        self.assertIn("divider_line", str(ctx.exception))
        self.assertIn("rotation", str(ctx.exception))

    def test_absent_opacity_rotation_makes_no_canvas_transform_calls(self):
        """R12.2/R23 (spy proof): with no opacity/rotation fields, the new
        code makes ZERO calls to saveState/restoreState/setFillAlpha/
        setStrokeAlpha/rotate/translate -- not just calls that cancel out.
        Exercises all 5 static element kinds via unmodified DEFAULT_LAYOUT
        entries (confirmed below to carry no opacity/rotation keys)."""
        elements = {
            "college": idcards.DEFAULT_LAYOUT["elements"]["college"],  # sprite_alpha
            "autograph_book": idcards.DEFAULT_LAYOUT["elements"]["autograph_book"],  # nostalgia_opaque
            "logo": idcards.DEFAULT_LAYOUT["elements"]["logo"],  # logo_alpha
            "event_line_title": idcards.DEFAULT_LAYOUT["elements"]["event_line_title"],  # text_static
            "divider_line": idcards.DEFAULT_LAYOUT["elements"]["divider_line"],  # line
        }
        covered_kinds = {elem["kind"] for elem in elements.values()}
        self.assertEqual(covered_kinds, {"sprite_alpha", "nostalgia_opaque", "logo_alpha", "text_static", "line"})
        for elem in elements.values():
            self.assertNotIn("opacity", elem)
            self.assertNotIn("rotation", elem)

        with tempfile.TemporaryDirectory() as temp:
            pdf_path = Path(temp) / "spy.pdf"
            real = canvas.Canvas(str(pdf_path), pagesize=(idcards.PAGE_W, idcards.PAGE_H))
            spy = _CanvasSpy(real)
            for name, elem in elements.items():
                idcards._draw_layout_element(spy, self.assets, self.fonts, name, elem)
            real.showPage()
            real.save()
        self.assertEqual(spy.calls, [])

    def test_transformed_element_does_not_leak_into_next_draw(self):
        """A missing restoreState() after a transformed element would bleed
        its alpha/rotation into whatever draws next. Draw a transformed
        LINE (a second kind besides sprite_alpha) immediately before a
        plain probe sprite on the same canvas, and confirm the plain
        sprite renders identically to a baseline render where it's alone."""
        plain_elem = {"z": 2, "kind": "sprite_alpha", "asset": "rotation_probe", "x": 10.0, "y": 10.0, "w": 20.0, "h": 20.0}
        leaking_line = {"z": 1, "kind": "line", "x1": 30.0, "y1": 60.0, "x2": 44.0, "y2": 74.0, "color": "coral", "width": 2.0, "opacity": 0.3, "rotation": 40}
        dpi = 150

        baseline_alone = self._render_probe(plain_elem, dpi=dpi)
        combined = self._render_probe([leaking_line, plain_elem], dpi=dpi)

        baseline_crop = self._crop_bbox(baseline_alone, plain_elem, dpi)
        combined_crop = self._crop_bbox(combined, plain_elem, dpi)
        self.assertEqual(list(baseline_crop.getdata()), list(combined_crop.getdata()))

    def test_stroke_alpha_lightens_a_line(self):
        """Fill alpha is proven separately via the sprite-image assertion in
        test_opacity_rotation_apply_within_expected_region, but a line uses
        setStrokeAlpha, a different call -- nothing else exercises it. Use a
        thick, saturated, unrotated line so the crop reliably lands on
        stroked (not anti-aliased edge) pixels."""
        elem = {"z": 1, "kind": "line", "x1": 10.0, "y1": 40.0, "x2": 30.0, "y2": 40.0, "color": "coral", "width": 6.0}
        dpi = 150

        img_full = self._render_probe(elem, dpi=dpi)
        img_half = self._render_probe(dict(elem, opacity=0.4), dpi=dpi)

        sample_x, sample_y = self._mm_to_px((elem["x1"] + elem["x2"]) / 2, elem["y1"], dpi, img_full.size[1])
        sample = (round(sample_x), round(sample_y))
        full_pixel = img_full.getpixel(sample)
        half_pixel = img_half.getpixel(sample)
        background_pixel = tuple(round(channel * 255) for channel in idcards.COLORS["background"].rgb())

        self.assertNotEqual(half_pixel, full_pixel)
        # At half opacity the stroked pixel must sit measurably closer to
        # the card background than the fully opaque stroke does.
        self.assertLess(abs(half_pixel[0] - background_pixel[0]), abs(full_pixel[0] - background_pixel[0]))

    def test_text_opacity_lightens_glyph_fill(self):
        """text_static's fill alpha goes through PDFTextObject.setFillColor,
        a third call site distinct from the sprite (drawImage) and line
        (canvas setStrokeColor) paths -- prove it separately too. Averaged
        over the glyphs' bbox (not a single sampled pixel, since exact ink
        position is fiddly to predict for text) it must move measurably
        closer to the card background, matching the strength of the
        stroke-alpha assertion rather than only "differs somehow"."""
        elem = {"z": 1, "kind": "text_static", "text": "AB", "font": "display", "max_size": 20.0, "min_size": 10.0, "center_x": 15.0, "baseline": 40.0, "max_width": 20.0, "color": "ivory"}
        dpi = 150

        img_full = self._render_probe(elem, dpi=dpi)
        img_half = self._render_probe(dict(elem, opacity=0.2), dpi=dpi)
        # A generous box around the glyphs: center_x +/- max_width/2, from
        # just below the baseline to comfortably above cap height.
        text_bbox = {"x": elem["center_x"] - elem["max_width"] / 2, "y": elem["baseline"] - 2.0, "w": elem["max_width"], "h": 12.0}
        crop_full = self._crop_bbox(img_full, text_bbox, dpi)
        crop_half = self._crop_bbox(img_half, text_bbox, dpi)
        avg_full = self._average_pixel(crop_full)
        avg_half = self._average_pixel(crop_half)
        background_pixel = tuple(round(channel * 255) for channel in idcards.COLORS["background"].rgb())
        self.assertLess(abs(avg_half[0] - background_pixel[0]), abs(avg_full[0] - background_pixel[0]))

    # -- render_pdf production-path regression (Form XObject + opacity) ----

    def test_opacity_through_render_pdf_produces_valid_lighter_render(self):
        """Regression for a real bug: ReportLab 4.5.1 registers the
        transparency ExtGState that setFillAlpha/setStrokeAlpha emit onto
        the PAGE's resources, not the Form XObject's -- even when the alpha
        call happens while building the form's content stream. render_pdf
        used to draw all static content inside a beginForm()/endForm() Form
        XObject unconditionally, so opacity on any static element produced
        a PDF that ReportLab wrote without complaint but poppler rejected
        at rasterization with "ExtGState '...' is unknown". Render through
        the real production path (render_pdf, what the CLI calls) and
        confirm both that rasterization succeeds and that opacity visibly
        took effect."""
        manifest = self.root / "fixtures" / "attendees.json"
        records = idcards.validate_manifest(manifest, self.fonts)[:1]
        layout_opaque = copy.deepcopy(idcards.DEFAULT_LAYOUT)
        layout_transparent = copy.deepcopy(idcards.DEFAULT_LAYOUT)
        layout_transparent["elements"]["college"]["opacity"] = 0.4
        dpi = 150

        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            out_opaque = temp_path / "opaque.pdf"
            out_transparent = temp_path / "transparent.pdf"
            idcards.render_pdf(records, out_opaque, self.assets, layout=layout_opaque)
            idcards.render_pdf(records, out_transparent, self.assets, layout=layout_transparent)

            # Before the fix, this next call raised:
            #   CardError: pdftoppm reported a rendering diagnostic:
            #   Syntax Error: ExtGState 'gRLs1' is unknown
            pages_opaque = idcards.render_proof_images(out_opaque, temp_path / "pages_opaque", dpi=dpi)
            pages_transparent = idcards.render_proof_images(out_transparent, temp_path / "pages_transparent", dpi=dpi)

            with Image.open(pages_opaque[0]) as img_opaque, Image.open(pages_transparent[0]) as img_transparent:
                img_opaque = img_opaque.convert("RGB")
                img_transparent = img_transparent.convert("RGB")

            college = idcards.DEFAULT_LAYOUT["elements"]["college"]
            crop_opaque = self._crop_bbox(img_opaque, college, dpi)
            crop_transparent = self._crop_bbox(img_transparent, college, dpi)
            avg_opaque = self._average_pixel(crop_opaque)
            avg_transparent = self._average_pixel(crop_transparent)
            background_pixel = tuple(round(channel * 255) for channel in idcards.COLORS["background"].rgb())
            self.assertLess(abs(avg_transparent[0] - background_pixel[0]), abs(avg_opaque[0] - background_pixel[0]))

    @staticmethod
    def _page_invokes_static_card_form(pdf_path: Path) -> bool:
        """True iff the PDF's first page's own /Resources/XObject contains a
        Form-subtype entry for the static_card form.

        A raw byte-grep for "/Subtype /Form" only proves a Form object
        exists SOMEWHERE in the file -- it would still pass if a future
        refactor left an orphan form, or kept beginForm()/endForm() but
        dropped doForm() so the page never actually draws it. ReportLab
        only lists a form in a page's own XObject resources when that page
        invokes it (doForm), so checking there is the reliable signal that
        the fast path was actually taken, not merely built. Matching by
        substring on the key name (rather than the exact "/FormXob."
        prefix) avoids hard-coding a ReportLab internal naming detail that
        could shift between versions.
        """
        reader = PdfReader(str(pdf_path))
        resources = reader.pages[0].get("/Resources", {})
        xobjects = resources.get("/XObject", {}) if resources else {}
        for name, ref in xobjects.items():
            obj = ref.get_object()
            if obj.get("/Subtype") == "/Form" and "static_card" in str(name):
                return True
        return False

    def test_render_pdf_uses_form_xobject_when_no_static_opacity(self):
        """Pin the Form XObject fast path for the common case (no static
        opacity), so a future change can't silently drop it back to the
        slow per-page-redraw path used only for the opacity workaround."""
        manifest = self.root / "fixtures" / "attendees.json"
        records = idcards.validate_manifest(manifest, self.fonts)[:1]
        layout = copy.deepcopy(idcards.DEFAULT_LAYOUT)
        self.assertFalse(idcards._layout_uses_static_opacity(layout))
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "cards.pdf"
            idcards.render_pdf(records, out, self.assets, layout=layout)
            self.assertTrue(self._page_invokes_static_card_form(out))

    def test_opacity_layout_does_not_invoke_static_card_form(self):
        """The flip side of the above: once a static element sets opacity,
        the page must NOT reference the static_card form at all -- that's
        precisely the malformed-PDF condition the fix avoids."""
        manifest = self.root / "fixtures" / "attendees.json"
        records = idcards.validate_manifest(manifest, self.fonts)[:1]
        layout = copy.deepcopy(idcards.DEFAULT_LAYOUT)
        layout["elements"]["college"]["opacity"] = 0.4
        self.assertTrue(idcards._layout_uses_static_opacity(layout))
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "cards.pdf"
            idcards.render_pdf(records, out, self.assets, layout=layout)
            self.assertFalse(self._page_invokes_static_card_form(out))

    def test_rotation_only_through_render_pdf_still_uses_form_and_renders(self):
        """Rotation-only elements are unaffected by the ExtGState bug --
        rotation emits inline `cm` operators, not a resource reference --
        so a rotation-only layout should keep the Form XObject fast path
        and rasterize successfully. Locks this in against a future change
        that might route rotation through the same fallback as opacity."""
        manifest = self.root / "fixtures" / "attendees.json"
        records = idcards.validate_manifest(manifest, self.fonts)[:1]
        layout = copy.deepcopy(idcards.DEFAULT_LAYOUT)
        layout["elements"]["college"]["rotation"] = 10
        self.assertFalse(idcards._layout_uses_static_opacity(layout))
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            out = temp_path / "cards.pdf"
            idcards.render_pdf(records, out, self.assets, layout=layout)
            self.assertTrue(self._page_invokes_static_card_form(out))
            pages = idcards.render_proof_images(out, temp_path / "pages", dpi=150)
            self.assertEqual(len(pages), 1)


if __name__ == "__main__":
    unittest.main()
