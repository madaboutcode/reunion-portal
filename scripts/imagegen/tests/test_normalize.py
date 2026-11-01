from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from imagegen import constants as C
from imagegen.normalize import (
    NormalizedOutput,
    prepare_reference,
    prepare_references,
    validate_and_normalize_output,
)
from imagegen.request import ValidationError, validate_and_build

PORTAL_ROOT = Path(__file__).resolve().parents[3]
JOBS_DIR = PORTAL_ROOT / "scripts" / "imagegen" / "jobs"
REAL_PROMPT = JOBS_DIR / "stories-hero" / "prompts" / "stories-hero.txt"


def make_png(path: Path, width: int, height: int, color=(10, 20, 30)) -> None:
    Image.new("RGB", (width, height), color).save(path, format="PNG")


# --- Reference prep ---------------------------------------------------


def test_prepare_reference_valid_small_png(tmp_path):
    path = tmp_path / "ref.png"
    make_png(path, 100, 50)

    result = prepare_reference(path)

    assert result.original_width == 100
    assert result.original_height == 50
    assert result.encoded_width == 100
    assert result.encoded_height == 50
    assert result.mime_type == "image/png"
    img = Image.open(io.BytesIO(result.data))
    assert img.size == (100, 50)


def test_prepare_reference_source_over_16mib_rejected_before_decode(tmp_path):
    path = tmp_path / "big.png"
    path.write_bytes(b"\x00" * (C.MAX_SOURCE_BYTES_EACH + 1))

    with pytest.raises(ValidationError, match="exceeds"):
        prepare_reference(path)


def test_prepare_references_total_over_48mib_rejected(tmp_path):
    paths = []
    each_size = 13 * 1024 * 1024  # under the 16 MiB per-file cap, over the 48 MiB total cap x4
    for i in range(4):
        p = tmp_path / f"ref{i}.bin"
        p.write_bytes(b"\x00" * each_size)
        paths.append(p)

    with pytest.raises(ValidationError, match="total reference source size"):
        prepare_references(tuple(paths))


def test_prepare_reference_decoded_pixels_over_limit_rejected(tmp_path):
    path = tmp_path / "huge.png"
    # 4200 x 4000 = 16,800,000 pixels > MAX_DECODED_PIXELS (16,700,000);
    # solid color compresses to a tiny file so the size cap isn't hit first.
    make_png(path, 4200, 4000)

    with pytest.raises(ValidationError, match="pixel limit"):
        prepare_reference(path)


def test_prepare_reference_longest_side_over_2048_downscaled(tmp_path):
    path = tmp_path / "wide.png"
    make_png(path, 3000, 1000)

    result = prepare_reference(path)

    assert result.original_width == 3000
    assert result.original_height == 1000
    assert max(result.encoded_width, result.encoded_height) <= C.MAX_LONGEST_SIDE
    assert result.encoded_width < result.original_width
    assert result.encoded_height < result.original_height
    original_ratio = 3000 / 1000
    encoded_ratio = result.encoded_width / result.encoded_height
    assert abs(original_ratio - encoded_ratio) < 0.01


def test_prepare_reference_unsupported_type_rejected(tmp_path):
    path = tmp_path / "ref.bmp"
    Image.new("RGB", (50, 50)).save(path, format="BMP")

    with pytest.raises(ValidationError, match="unsupported type"):
        prepare_reference(path)


def test_prepare_reference_exif_orientation_encodes_upright(tmp_path):
    path = tmp_path / "rotated.jpg"
    img = Image.new("RGB", (100, 200), (200, 100, 50))
    exif = img.getexif()
    exif[0x0112] = 6  # orientation 6: rotate 90 CW to display upright
    img.save(path, format="JPEG", exif=exif, quality=95)

    result = prepare_reference(path)

    # original dims reflect the raw stored (pre-correction) pixels
    assert result.original_width == 100
    assert result.original_height == 200
    # encoded dims reflect the EXIF-corrected, upright orientation (transposed)
    assert result.encoded_width == 200
    assert result.encoded_height == 100


# --- Reference caps ---------------------------------------------------


def _base_request_kwargs(**overrides):
    kwargs = dict(
        job_id="test-normalize-job",
        prompt_file=str(REAL_PROMPT),
        references=[],
        provider="gemini",
        model="gemini-test-model",
        unit_cost_estimate="0.05",
        aspect_ratio="16:9",
        resolution="1K",
        count=1,
        fmt="webp",
        quality=90,
        width=1600,
        height=900,
        output_dir="test-normalize",
    )
    kwargs.update(overrides)
    return kwargs


def test_five_references_rejected_by_request_validation():
    with pytest.raises(ValidationError, match="at most 4"):
        validate_and_build(**_base_request_kwargs(references=["a.png", "b.png", "c.png", "d.png", "e.png"]))


def test_encoded_size_over_8mib_per_reference_rejected(tmp_path):
    # A large enough uncompressible source produces an encoded PNG over the 8 MiB cap.
    # Use per-pixel random-ish noise so PNG compression can't shrink it much.
    import random

    random.seed(0)
    width, height = 2000, 2000  # under the pixel limit and under 2048 longest side
    path = tmp_path / "noisy.png"
    img = Image.new("RGB", (width, height))
    pixels = [
        (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
        for _ in range(width * height)
    ]
    img.putdata(pixels)
    img.save(path, format="PNG")

    # Sanity: source file itself must still be under the per-file source cap.
    assert path.stat().st_size <= C.MAX_SOURCE_BYTES_EACH

    with pytest.raises(ValidationError, match="encoded size"):
        prepare_reference(path)


# --- Output validation ---------------------------------------------------


def _make_output_bytes(width: int, height: int, fmt: str = "PNG") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (50, 60, 70)).save(buf, format=fmt)
    return buf.getvalue()


def test_valid_output_matching_expected_dimensions_succeeds():
    raw = _make_output_bytes(1600, 900)

    result = validate_and_normalize_output(
        raw, expected_width=1600, expected_height=900, expected_ratio=16 / 9, fmt="png", quality=90
    )

    assert isinstance(result, NormalizedOutput)
    assert result.width == 1600
    assert result.height == 900
    assert result.format == "PNG"


def test_output_ratio_deviating_more_than_one_percent_fails():
    raw = _make_output_bytes(1600, 1600)  # square image, way off from a 16:9 expectation

    with pytest.raises(ValidationError, match="deviates"):
        validate_and_normalize_output(
            raw, expected_width=1600, expected_height=900, expected_ratio=16 / 9, fmt="png", quality=90
        )


def test_output_within_ratio_tolerance_but_wrong_exact_size_is_resized():
    # 1601x901 has the same ratio (within tolerance) as 1600x900 but isn't an exact match.
    raw = _make_output_bytes(1601, 901)

    result = validate_and_normalize_output(
        raw, expected_width=1600, expected_height=900, expected_ratio=16 / 9, fmt="png", quality=90
    )

    assert result.width == 1600
    assert result.height == 900
    img = Image.open(io.BytesIO(result.data))
    assert img.size == (1600, 900)


def test_output_metadata_is_stripped():
    from PIL.PngImagePlugin import PngInfo

    img = Image.new("RGB", (100, 100), (1, 2, 3))
    info = PngInfo()
    info.add_text("Comment", "sensitive metadata")
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=info)
    raw = buf.getvalue()

    result = validate_and_normalize_output(
        raw, expected_width=100, expected_height=100, expected_ratio=1.0, fmt="png", quality=90
    )

    out_img = Image.open(io.BytesIO(result.data))
    assert out_img.info == {}


def test_output_decode_failure_raises_validation_error():
    with pytest.raises(ValidationError, match="failed to decode"):
        validate_and_normalize_output(
            b"not an image at all", expected_width=100, expected_height=100, expected_ratio=1.0,
            fmt="png", quality=90,
        )


def test_output_webp_q90_format_is_webp():
    raw = _make_output_bytes(200, 100)

    result = validate_and_normalize_output(
        raw, expected_width=200, expected_height=100, expected_ratio=2.0, fmt="webp", quality=90
    )

    assert result.format == "WEBP"
    img = Image.open(io.BytesIO(result.data))
    assert img.format == "WEBP"


def test_output_png_format_is_png():
    raw = _make_output_bytes(200, 100)

    result = validate_and_normalize_output(
        raw, expected_width=200, expected_height=100, expected_ratio=2.0, fmt="png", quality=90
    )

    assert result.format == "PNG"
    img = Image.open(io.BytesIO(result.data))
    assert img.format == "PNG"
