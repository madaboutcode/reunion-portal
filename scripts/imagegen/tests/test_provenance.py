from __future__ import annotations

import dataclasses
import json
from decimal import Decimal
from pathlib import Path

from imagegen.normalize import NormalizedOutput
from imagegen.provenance import (
    SCHEMA_VERSION,
    atomic_write,
    build_sidecar,
    candidate_status,
    write_candidate,
)
from imagegen.request import JobRequest, bytes_sha256, compute_request_hash


def _make_request(output_dir: Path, unit_cost_estimate: str = "0.05") -> JobRequest:
    cost = Decimal(unit_cost_estimate)
    req_hash = compute_request_hash(
        prompt_sha="deadbeef" * 8,
        reference_shas=[],
        provider="gemini",
        model="gemini-test-model",
        job_id="prov-test-job",
        unit_cost_estimate=cost,
        aspect_ratio="16:9",
        resolution="1K",
        width=1600,
        height=900,
        fmt="webp",
        quality=90,
    )
    return JobRequest(
        job_id="prov-test-job",
        prompt_file=Path("/fake/prompt.txt"),
        prompt_sha="deadbeef" * 8,
        provider="gemini",
        model="gemini-test-model",
        unit_cost_estimate=cost,
        aspect_ratio="16:9",
        resolution="1K",
        count=1,
        fmt="webp",
        quality=90,
        width=1600,
        height=900,
        output_dir=output_dir,
        request_hash=req_hash,
    )


def _make_output(data: bytes = b"fake-image-bytes") -> NormalizedOutput:
    return NormalizedOutput(
        data=data,
        width=1600,
        height=900,
        mode="RGB",
        format="WEBP",
        byte_count=len(data),
    )


def test_candidate_status_absent_when_neither_file_exists(tmp_path):
    req = _make_request(tmp_path)
    st = candidate_status(req, 1)
    assert st.status == "absent"
    assert not st.image_exists
    assert not st.sidecar_exists


def test_candidate_status_complete_when_matching(tmp_path):
    req = _make_request(tmp_path)
    output = _make_output()
    write_candidate(req, 1, output, elapsed=1.23, request_id="req-abc", usage={"tokens": 10})

    st = candidate_status(req, 1)
    assert st.status == "complete"
    assert st.image_exists
    assert st.sidecar_exists


def test_candidate_status_incomplete_missing_sidecar(tmp_path):
    req = _make_request(tmp_path)
    img_path = tmp_path / req.candidate_filename(1)
    tmp_path.mkdir(parents=True, exist_ok=True)
    img_path.write_bytes(b"only image")

    st = candidate_status(req, 1)
    assert st.status == "incomplete"
    assert st.image_exists
    assert not st.sidecar_exists
    assert "sidecar" in st.detail


def test_candidate_status_incomplete_missing_image(tmp_path):
    req = _make_request(tmp_path)
    sc_path = tmp_path / req.sidecar_filename(1)
    tmp_path.mkdir(parents=True, exist_ok=True)
    sc_path.write_text("{}")

    st = candidate_status(req, 1)
    assert st.status == "incomplete"
    assert not st.image_exists
    assert st.sidecar_exists
    assert "image" in st.detail


def test_candidate_status_mismatched_candidate_id(tmp_path):
    req = _make_request(tmp_path)
    output = _make_output()
    write_candidate(req, 1, output, elapsed=1.0, request_id=None, usage=None)

    sc_path = tmp_path / req.sidecar_filename(1)
    sc = json.loads(sc_path.read_text())
    sc["candidateId"] = "wrong-candidate-id"
    sc_path.write_text(json.dumps(sc))

    st = candidate_status(req, 1)
    assert st.status == "mismatched"
    assert "candidateId" in st.detail


def test_candidate_status_mismatched_output_hash(tmp_path):
    req = _make_request(tmp_path)
    output = _make_output()
    write_candidate(req, 1, output, elapsed=1.0, request_id=None, usage=None)

    img_path = tmp_path / req.candidate_filename(1)
    img_path.write_bytes(b"tampered-image-bytes")

    st = candidate_status(req, 1)
    assert st.status == "mismatched"
    assert "output hash" in st.detail


def test_candidate_status_mismatched_request_hash_on_cost_change(tmp_path):
    req1 = _make_request(tmp_path, unit_cost_estimate="0.05")
    output = _make_output()
    write_candidate(req1, 1, output, elapsed=1.0, request_id=None, usage=None)

    req2 = _make_request(tmp_path, unit_cost_estimate="0.10")
    assert req2.request_hash != req1.request_hash

    st = candidate_status(req2, 1)
    assert st.status == "mismatched"
    assert "request hash" in st.detail


def test_build_sidecar_shape(tmp_path):
    req = _make_request(tmp_path)
    output = _make_output()
    sidecar = build_sidecar(req, 1, output, elapsed=2.5, request_id="req-123", usage={"in": 1})

    assert sidecar["schemaVersion"] == 1
    assert SCHEMA_VERSION == 1
    assert sidecar["candidateId"] == req.candidate_id(1)
    assert sidecar["jobId"] == req.job_id
    assert sidecar["requestHash"] == req.request_hash
    assert sidecar["cost"]["kind"] == "operator_estimate"
    assert sidecar["cost"]["usd"] == str(req.unit_cost_estimate)


def test_build_sidecar_never_contains_api_keys_or_raw_payloads(tmp_path):
    req = _make_request(tmp_path)
    output = _make_output()
    fake_key = "AIzaSyFAKE-SECRET-KEY-1234567890"
    sidecar = build_sidecar(
        req, 1, output, elapsed=2.5, request_id="req-123",
        usage={"promptTokens": 5},
    )

    serialized = json.dumps(sidecar)
    assert fake_key not in serialized
    assert "apiKey" not in sidecar
    assert "rawResponse" not in sidecar
    assert "payload" not in sidecar
    expected_keys = {
        "schemaVersion", "candidateId", "jobId", "requestHash", "prompt",
        "references", "provider", "request", "output", "cost", "attempts",
        "elapsedSeconds", "generatedAt", "requestId", "usage",
    }
    assert set(sidecar.keys()) == expected_keys


def test_atomic_write_creates_file(tmp_path):
    target = tmp_path / "nested" / "file.bin"
    atomic_write(target, b"hello world")
    assert target.is_file()
    assert target.read_bytes() == b"hello world"


def test_write_candidate_writes_image_and_sidecar_and_status_complete(tmp_path):
    req = _make_request(tmp_path)
    output = _make_output(b"candidate-image-data")

    img_path = write_candidate(
        req, 1, output, elapsed=3.1, request_id="req-xyz", usage={"out": 2}
    )

    assert img_path == tmp_path / req.candidate_filename(1)
    assert img_path.is_file()
    assert img_path.read_bytes() == b"candidate-image-data"

    sc_path = tmp_path / req.sidecar_filename(1)
    assert sc_path.is_file()
    sc = json.loads(sc_path.read_text())
    assert sc["output"]["sha256"] == bytes_sha256(b"candidate-image-data")

    st = candidate_status(req, 1)
    assert st.status == "complete"
