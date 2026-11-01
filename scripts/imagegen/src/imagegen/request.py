from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

from . import constants as C


class ValidationError(Exception):
    pass


def _resolve_contained(path: str, container: Path, label: str) -> Path:
    resolved = Path(path).resolve()
    if resolved.is_symlink() or _has_symlink_component(resolved):
        raise ValidationError(f"{label} path escapes via symlink: {path}")
    try:
        resolved.relative_to(container)
    except ValueError:
        raise ValidationError(
            f"{label} must be inside {container}, got {resolved}"
        )
    return resolved


def _has_symlink_component(p: Path) -> bool:
    for part in p.parents:
        if part.is_symlink():
            return True
    return False


def _portal_root() -> Path:
    here = Path(__file__).resolve()
    for parent in [here] + list(here.parents):
        if (parent / "CLAUDE.md").exists() and (parent / "scripts" / "imagegen").exists():
            return parent
    raise ValidationError("cannot locate portal root")


def _parse_ratio(ratio_str: str) -> float:
    parts = ratio_str.split(":")
    if len(parts) != 2:
        raise ValidationError(f"invalid aspect ratio: {ratio_str}")
    try:
        return float(parts[0]) / float(parts[1])
    except (ValueError, ZeroDivisionError):
        raise ValidationError(f"invalid aspect ratio: {ratio_str}")


def compute_request_hash(
    prompt_sha: str,
    reference_shas: list[str],
    provider: str,
    model: str,
    job_id: str,
    unit_cost_estimate: Decimal,
    aspect_ratio: str,
    resolution: str,
    width: int,
    height: int,
    fmt: str,
    quality: int,
) -> str:
    parts = [
        f"prompt:{prompt_sha}",
        f"refs:{','.join(reference_shas)}",
        f"provider:{provider}",
        f"model:{model}",
        f"job:{job_id}",
        f"cost:{unit_cost_estimate}",
        f"ratio:{aspect_ratio}",
        f"res:{resolution}",
        f"w:{width}",
        f"h:{height}",
        f"fmt:{fmt}",
        f"q:{quality}",
    ]
    return "sha256:" + hashlib.sha256("|".join(parts).encode()).hexdigest()


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def bytes_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class JobRequest:
    job_id: str
    prompt_file: Path
    prompt_sha: str
    references: tuple[Path, ...] = ()
    reference_shas: tuple[str, ...] = ()
    provider: str = "gemini"
    model: str = ""
    unit_cost_estimate: Decimal = C.ZERO_USD
    aspect_ratio: str = "16:9"
    resolution: str = "1K"
    count: int = C.DEFAULT_CANDIDATE_COUNT
    fmt: str = C.DEFAULT_FORMAT
    quality: int = C.DEFAULT_QUALITY
    width: int = 0
    height: int = 0
    output_dir: Path = field(default_factory=lambda: Path("."))
    request_hash: str = ""

    def candidate_id(self, n: int) -> str:
        return f"{self.job_id}-candidate-{n:02d}"

    def candidate_filename(self, n: int) -> str:
        return f"{self.candidate_id(n)}.{self.fmt}"

    def sidecar_filename(self, n: int) -> str:
        return f"{self.candidate_id(n)}.{self.fmt}.provenance.json"

    def candidate_ids(self) -> list[str]:
        return [self.candidate_id(n) for n in range(1, self.count + 1)]

    def worst_case_cost(self) -> Decimal:
        return self.unit_cost_estimate * self.count


def validate_and_build(
    job_id: str,
    prompt_file: str,
    references: list[str],
    provider: str,
    model: str,
    unit_cost_estimate: str,
    aspect_ratio: str,
    resolution: str,
    count: int,
    fmt: str,
    quality: int,
    width: int,
    height: int,
    output_dir: str,
) -> JobRequest:
    root = _portal_root()
    jobs_dir = root / "scripts" / "imagegen" / "jobs"
    tmp_dir = root / "tmp" / "imagegen"

    if not re.match(C.JOB_ID_PATTERN, job_id):
        raise ValidationError(
            f"--job-id must match {C.JOB_ID_PATTERN}, got: {job_id}"
        )

    if provider != "gemini":
        raise ValidationError(f"unsupported provider: {provider} (V1 supports gemini only)")

    if aspect_ratio not in C.GEMINI_SUPPORTED_RATIOS:
        raise ValidationError(
            f"unsupported aspect ratio for {provider}: {aspect_ratio} "
            f"(supported: {sorted(C.GEMINI_SUPPORTED_RATIOS)})"
        )

    if resolution not in C.GEMINI_SUPPORTED_RESOLUTIONS:
        raise ValidationError(
            f"unsupported resolution for {provider}: {resolution} "
            f"(supported: {sorted(C.GEMINI_SUPPORTED_RESOLUTIONS)})"
        )

    if not (1 <= count <= C.MAX_CANDIDATE_COUNT):
        raise ValidationError(
            f"--count must be 1..{C.MAX_CANDIDATE_COUNT}, got {count}"
        )

    if fmt not in C.ALLOWED_FORMATS:
        raise ValidationError(f"unsupported format: {fmt} (allowed: {sorted(C.ALLOWED_FORMATS)})")

    if fmt in C.LOSSY_FORMATS:
        if not (C.MIN_QUALITY <= quality <= C.MAX_QUALITY):
            raise ValidationError(
                f"--quality must be {C.MIN_QUALITY}..{C.MAX_QUALITY}, got {quality}"
            )
    elif quality != C.DEFAULT_QUALITY:
        raise ValidationError(f"--quality is only valid for lossy formats ({sorted(C.LOSSY_FORMATS)})")

    if width <= 0 or height <= 0:
        raise ValidationError(f"--width and --height must be positive, got {width}x{height}")

    expected_ratio = _parse_ratio(aspect_ratio)
    actual_ratio = width / height
    if abs(actual_ratio - expected_ratio) / expected_ratio > C.RATIO_TOLERANCE:
        raise ValidationError(
            f"dimensions {width}x{height} (ratio {actual_ratio:.4f}) "
            f"deviate >1% from --aspect-ratio {aspect_ratio} ({expected_ratio:.4f})"
        )

    try:
        cost = Decimal(unit_cost_estimate)
    except InvalidOperation:
        raise ValidationError(f"--unit-cost-estimate must be a decimal number, got: {unit_cost_estimate}")
    if cost <= C.ZERO_USD:
        raise ValidationError(f"--unit-cost-estimate must be positive, got: {unit_cost_estimate}")

    prompt_path = _resolve_contained(prompt_file, jobs_dir, "--prompt-file")
    if not prompt_path.is_file():
        raise ValidationError(f"--prompt-file not found: {prompt_path}")

    if len(references) > C.MAX_REFERENCE_COUNT:
        raise ValidationError(
            f"at most {C.MAX_REFERENCE_COUNT} references allowed, got {len(references)}"
        )

    ref_paths = []
    for ref in references:
        ref_path = _resolve_contained(ref, jobs_dir, "--reference")
        if not ref_path.is_file():
            raise ValidationError(f"--reference not found: {ref_path}")
        ref_paths.append(ref_path)

    out_path = _resolve_contained(output_dir, tmp_dir, "--output-dir")

    prompt_sha = file_sha256(prompt_path)
    ref_shas = [file_sha256(r) for r in ref_paths]

    req_hash = compute_request_hash(
        prompt_sha=prompt_sha,
        reference_shas=ref_shas,
        provider=provider,
        model=model,
        job_id=job_id,
        unit_cost_estimate=cost,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        width=width,
        height=height,
        fmt=fmt,
        quality=quality,
    )

    return JobRequest(
        job_id=job_id,
        prompt_file=prompt_path,
        prompt_sha=prompt_sha,
        references=tuple(ref_paths),
        reference_shas=tuple(ref_shas),
        provider=provider,
        model=model,
        unit_cost_estimate=cost,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        count=count,
        fmt=fmt,
        quality=quality,
        width=width,
        height=height,
        output_dir=out_path,
        request_hash=req_hash,
    )
