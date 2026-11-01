from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .normalize import NormalizedOutput
from .request import JobRequest, bytes_sha256


SCHEMA_VERSION = 1


@dataclass(frozen=True)
class CandidateStatus:
    status: str  # absent, complete, incomplete, mismatched
    image_exists: bool
    sidecar_exists: bool
    detail: str = ""


def candidate_status(req: JobRequest, n: int) -> CandidateStatus:
    img_path = req.output_dir / req.candidate_filename(n)
    sc_path = req.output_dir / req.sidecar_filename(n)
    img_exists = img_path.is_file()
    sc_exists = sc_path.is_file()

    if not img_exists and not sc_exists:
        return CandidateStatus("absent", False, False)

    if img_exists != sc_exists:
        missing = "sidecar" if img_exists else "image"
        return CandidateStatus("incomplete", img_exists, sc_exists,
                               detail=f"missing {missing}")

    try:
        with open(sc_path) as f:
            sc = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        return CandidateStatus("mismatched", True, True,
                               detail=f"sidecar unreadable: {e}")

    expected_id = req.candidate_id(n)
    if sc.get("candidateId") != expected_id:
        return CandidateStatus("mismatched", True, True,
                               detail=f"candidateId mismatch: {sc.get('candidateId')} != {expected_id}")

    img_sha = bytes_sha256(img_path.read_bytes())
    if sc.get("output", {}).get("sha256") != img_sha:
        return CandidateStatus("mismatched", True, True,
                               detail="output hash mismatch")

    if sc.get("requestHash") != req.request_hash:
        return CandidateStatus("mismatched", True, True,
                               detail="request hash mismatch")

    return CandidateStatus("complete", True, True)


def build_sidecar(
    req: JobRequest,
    n: int,
    output: NormalizedOutput,
    elapsed: float,
    request_id: str | None,
    usage: dict | None,
    ref_details: list[dict] | None = None,
) -> dict:
    output_sha = bytes_sha256(output.data)
    references = []
    if ref_details:
        references = ref_details

    return {
        "schemaVersion": SCHEMA_VERSION,
        "candidateId": req.candidate_id(n),
        "jobId": req.job_id,
        "requestHash": req.request_hash,
        "prompt": {
            "path": str(req.prompt_file),
            "sha256": req.prompt_sha,
        },
        "references": references,
        "provider": {
            "name": req.provider,
            "model": req.model,
        },
        "request": {
            "unitCostEstimate": str(req.unit_cost_estimate),
            "aspectRatio": req.aspect_ratio,
            "resolution": req.resolution,
            "width": req.width,
            "height": req.height,
            "format": req.fmt,
            "quality": req.quality,
        },
        "output": {
            "sha256": output_sha,
            "width": output.width,
            "height": output.height,
            "mode": output.mode,
            "format": output.format,
            "bytes": output.byte_count,
        },
        "cost": {
            "kind": "operator_estimate",
            "usd": str(req.unit_cost_estimate),
            "note": "Gemini does not report billed cost; invoice may differ",
        },
        "attempts": 1,
        "elapsedSeconds": elapsed,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "requestId": request_id,
        "usage": usage,
    }


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        os.write(fd, data)
        os.close(fd)
        os.replace(tmp, path)
    except Exception:
        os.close(fd) if not os.get_inheritable(fd) else None
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_candidate(
    req: JobRequest,
    n: int,
    output: NormalizedOutput,
    elapsed: float,
    request_id: str | None,
    usage: dict | None,
    ref_details: list[dict] | None = None,
) -> Path:
    img_path = req.output_dir / req.candidate_filename(n)
    sc_path = req.output_dir / req.sidecar_filename(n)

    atomic_write(img_path, output.data)

    sidecar = build_sidecar(req, n, output, elapsed, request_id, usage, ref_details)
    atomic_write(sc_path, json.dumps(sidecar, indent=2).encode())

    return img_path
