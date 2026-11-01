from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

from . import constants as C
from .request import ValidationError


@dataclass(frozen=True)
class EncodedImage:
    data: bytes
    mime_type: str
    original_width: int
    original_height: int
    encoded_width: int
    encoded_height: int


MIME_MAP = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
PILLOW_FORMAT = {"webp": "WEBP", "png": "PNG", "jpeg": "JPEG"}


def _sniff_type(img: Image.Image) -> str | None:
    fmt = (img.format or "").upper()
    if fmt in C.ALLOWED_REFERENCE_TYPES:
        return fmt
    return None


def prepare_reference(path: Path) -> EncodedImage:
    file_bytes = path.stat().st_size
    if file_bytes > C.MAX_SOURCE_BYTES_EACH:
        raise ValidationError(
            f"reference {path.name} is {file_bytes} bytes, "
            f"exceeds {C.MAX_SOURCE_BYTES_EACH} byte limit"
        )

    with Image.open(path) as img:
        sniffed = _sniff_type(img)
        if sniffed is None:
            raise ValidationError(
                f"reference {path.name}: unsupported type {img.format!r} "
                f"(allowed: {sorted(C.ALLOWED_REFERENCE_TYPES)})"
            )

        img.load()
        pixels = img.width * img.height
        if pixels > C.MAX_DECODED_PIXELS:
            raise ValidationError(
                f"reference {path.name}: {pixels} pixels exceeds "
                f"{C.MAX_DECODED_PIXELS} pixel limit"
            )

        original_w, original_h = img.width, img.height

        img = ImageOps.exif_transpose(img) or img

        if max(img.width, img.height) > C.MAX_LONGEST_SIDE:
            ratio = C.MAX_LONGEST_SIDE / max(img.width, img.height)
            new_w = max(1, int(img.width * ratio))
            new_h = max(1, int(img.height * ratio))
            img = img.resize((new_w, new_h), Image.LANCZOS)

        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")

        buf = io.BytesIO()
        save_fmt = sniffed if sniffed != "WEBP" else "PNG"
        img.save(buf, save_fmt)
        encoded = buf.getvalue()

        if len(encoded) > C.MAX_ENCODED_BYTES_EACH:
            raise ValidationError(
                f"reference {path.name}: encoded size {len(encoded)} bytes "
                f"exceeds {C.MAX_ENCODED_BYTES_EACH} byte limit"
            )

        mime = MIME_MAP[save_fmt]
        return EncodedImage(
            data=encoded,
            mime_type=mime,
            original_width=original_w,
            original_height=original_h,
            encoded_width=img.width,
            encoded_height=img.height,
        )


def prepare_references(paths: tuple[Path, ...]) -> tuple[EncodedImage, ...]:
    total_source = sum(p.stat().st_size for p in paths)
    if total_source > C.MAX_SOURCE_BYTES_TOTAL:
        raise ValidationError(
            f"total reference source size {total_source} bytes "
            f"exceeds {C.MAX_SOURCE_BYTES_TOTAL} byte limit"
        )

    encoded = [prepare_reference(p) for p in paths]

    total_encoded = sum(e.data.__len__() for e in encoded)
    if total_encoded > C.MAX_ENCODED_BYTES_TOTAL:
        raise ValidationError(
            f"total encoded reference size {total_encoded} bytes "
            f"exceeds {C.MAX_ENCODED_BYTES_TOTAL} byte limit"
        )

    return tuple(encoded)


@dataclass(frozen=True)
class NormalizedOutput:
    data: bytes
    width: int
    height: int
    mode: str
    format: str
    byte_count: int


def validate_and_normalize_output(
    raw: bytes,
    expected_width: int,
    expected_height: int,
    expected_ratio: float,
    fmt: str,
    quality: int,
) -> NormalizedOutput:
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        raise ValidationError(f"output image failed to decode: {e}")

    actual_ratio = img.width / img.height
    if abs(actual_ratio - expected_ratio) / expected_ratio > C.RATIO_TOLERANCE:
        raise ValidationError(
            f"output ratio {img.width}x{img.height} ({actual_ratio:.4f}) "
            f"deviates >1% from expected {expected_ratio:.4f}"
        )

    if img.width != expected_width or img.height != expected_height:
        img = img.resize((expected_width, expected_height), Image.LANCZOS)

    if img.mode != "RGB":
        img = img.convert("RGB")

    for key in list(img.info.keys()):
        del img.info[key]

    pil_fmt = PILLOW_FORMAT[fmt]
    buf = io.BytesIO()
    save_kwargs = {"format": pil_fmt}
    if fmt in C.LOSSY_FORMATS:
        save_kwargs["quality"] = quality
    img.save(buf, **save_kwargs)
    data = buf.getvalue()

    return NormalizedOutput(
        data=data,
        width=expected_width,
        height=expected_height,
        mode="RGB",
        format=pil_fmt,
        byte_count=len(data),
    )
