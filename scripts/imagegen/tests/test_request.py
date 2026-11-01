from __future__ import annotations

import os
from decimal import Decimal
from pathlib import Path

import pytest

from imagegen.request import ValidationError, validate_and_build

PORTAL_ROOT = Path(__file__).resolve().parents[3]
JOBS_DIR = PORTAL_ROOT / "scripts" / "imagegen" / "jobs"
TMP_DIR = PORTAL_ROOT / "tmp" / "imagegen"

REAL_PROMPT = JOBS_DIR / "stories-hero" / "prompts" / "stories-hero.txt"


def _base_kwargs(**overrides):
    kwargs = dict(
        job_id="test-request-job",
        prompt_file=str(REAL_PROMPT),
        references=[],
        provider="gemini",
        model="gemini-test-model",
        unit_cost_estimate="0.05",
        aspect_ratio="16:9",
        resolution="1K",
        count=4,
        fmt="webp",
        quality=90,
        width=1600,
        height=900,
        output_dir=str(TMP_DIR / "test-request"),
    )
    kwargs.update(overrides)
    return kwargs


def test_valid_stories_hero_produces_four_deterministic_candidate_ids():
    req = validate_and_build(**_base_kwargs())
    assert req.candidate_ids() == [
        "test-request-job-candidate-01",
        "test-request-job-candidate-02",
        "test-request-job-candidate-03",
        "test-request-job-candidate-04",
    ]


@pytest.mark.parametrize(
    "bad_job_id",
    ["Upper-Case", "has_underscore", "has space", "has!special", "a" * 65, ""],
)
def test_job_id_rejects_invalid_patterns(bad_job_id):
    with pytest.raises(ValidationError):
        validate_and_build(**_base_kwargs(job_id=bad_job_id))


@pytest.mark.parametrize(
    "good_job_id",
    ["a", "abc-123", "job-9", "a" * 64],
)
def test_job_id_accepts_valid_patterns(good_job_id):
    req = validate_and_build(**_base_kwargs(job_id=good_job_id))
    assert req.job_id == good_job_id


def test_prompt_file_outside_jobs_dir_rejected(tmp_path):
    outside = tmp_path / "evil-prompt.txt"
    outside.write_text("hello")
    with pytest.raises(ValidationError, match="--prompt-file"):
        validate_and_build(**_base_kwargs(prompt_file=str(outside)))


def test_prompt_file_symlink_escape_rejected(tmp_path):
    outside = tmp_path / "evil-prompt.txt"
    outside.write_text("hello")
    link = JOBS_DIR / "test-request-symlink-prompt.txt"
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(outside)
    try:
        with pytest.raises(ValidationError, match="symlink"):
            validate_and_build(**_base_kwargs(prompt_file=str(link)))
    finally:
        link.unlink()


def test_reference_outside_jobs_dir_rejected(tmp_path):
    outside = tmp_path / "evil-ref.png"
    outside.write_bytes(b"not a real png but path check happens first anyway")
    with pytest.raises(ValidationError, match="--reference"):
        validate_and_build(**_base_kwargs(references=[str(outside)]))


def test_reference_symlink_escape_rejected(tmp_path):
    outside = tmp_path / "evil-ref.png"
    outside.write_bytes(b"data")
    link = JOBS_DIR / "test-request-symlink-ref.png"
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(outside)
    try:
        with pytest.raises(ValidationError, match="symlink"):
            validate_and_build(**_base_kwargs(references=[str(link)]))
    finally:
        link.unlink()


def test_output_dir_must_resolve_below_tmp_imagegen():
    req = validate_and_build(**_base_kwargs(output_dir=str(TMP_DIR / "test-request-outdir")))
    assert req.output_dir == (TMP_DIR / "test-request-outdir").resolve()


def test_output_dir_outside_tmp_imagegen_rejected(tmp_path):
    outside = tmp_path / "evil-output"
    with pytest.raises(ValidationError, match="--output-dir"):
        validate_and_build(**_base_kwargs(output_dir=str(outside)))


def test_output_dir_symlink_escape_rejected(tmp_path):
    outside = tmp_path / "evil-output"
    outside.mkdir()
    link = TMP_DIR / "test-request-symlink-outdir"
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(outside)
    try:
        with pytest.raises(ValidationError, match="symlink"):
            validate_and_build(**_base_kwargs(output_dir=str(link)))
    finally:
        link.unlink()


def test_unsupported_provider_rejected():
    with pytest.raises(ValidationError, match="provider"):
        validate_and_build(**_base_kwargs(provider="openai"))


def test_unsupported_aspect_ratio_rejected():
    with pytest.raises(ValidationError, match="aspect ratio"):
        validate_and_build(**_base_kwargs(aspect_ratio="2:1"))


def test_unsupported_resolution_rejected():
    with pytest.raises(ValidationError, match="resolution"):
        validate_and_build(**_base_kwargs(resolution="4K"))


def test_dimensions_matching_ratio_accepted():
    req = validate_and_build(**_base_kwargs(width=1600, height=900, aspect_ratio="16:9"))
    assert req.width == 1600
    assert req.height == 900


def test_dimensions_deviating_more_than_one_percent_rejected():
    with pytest.raises(ValidationError, match="deviate"):
        validate_and_build(**_base_kwargs(width=1600, height=1600, aspect_ratio="16:9"))


@pytest.mark.parametrize("bad_cost", ["0", "-1", "-0.01", "not-a-number", ""])
def test_unit_cost_estimate_rejects_invalid(bad_cost):
    with pytest.raises(ValidationError, match="unit-cost-estimate"):
        validate_and_build(**_base_kwargs(unit_cost_estimate=bad_cost))


@pytest.mark.parametrize("good_cost", ["0.01", "0.05", "1.50", "10"])
def test_unit_cost_estimate_accepts_positive_decimals(good_cost):
    req = validate_and_build(**_base_kwargs(unit_cost_estimate=good_cost))
    assert req.unit_cost_estimate == Decimal(good_cost)


@pytest.mark.parametrize("bad_count", [0, 9, -1])
def test_count_rejects_out_of_range(bad_count):
    with pytest.raises(ValidationError, match="count"):
        validate_and_build(**_base_kwargs(count=bad_count))


@pytest.mark.parametrize("good_count", [1, 8])
def test_count_accepts_boundary_values(good_count):
    req = validate_and_build(**_base_kwargs(count=good_count))
    assert req.count == good_count


def test_unsupported_format_rejected():
    with pytest.raises(ValidationError, match="format"):
        validate_and_build(**_base_kwargs(fmt="gif"))


def test_quality_rejected_for_png():
    with pytest.raises(ValidationError, match="quality"):
        validate_and_build(**_base_kwargs(fmt="png", quality=50))


def test_quality_default_ok_for_png():
    req = validate_and_build(**_base_kwargs(fmt="png", quality=90))
    assert req.fmt == "png"


def test_request_hash_changes_with_unit_cost_estimate():
    req1 = validate_and_build(**_base_kwargs(unit_cost_estimate="0.05"))
    req2 = validate_and_build(**_base_kwargs(unit_cost_estimate="0.10"))
    assert req1.request_hash != req2.request_hash


def test_request_hash_changes_with_model():
    req1 = validate_and_build(**_base_kwargs(model="model-a"))
    req2 = validate_and_build(**_base_kwargs(model="model-b"))
    assert req1.request_hash != req2.request_hash


def test_request_hash_stable_across_calls_with_same_inputs():
    req1 = validate_and_build(**_base_kwargs())
    req2 = validate_and_build(**_base_kwargs())
    assert req1.request_hash == req2.request_hash


def test_candidate_ids_format():
    req = validate_and_build(**_base_kwargs(job_id="my-job", count=4))
    assert req.candidate_id(1) == "my-job-candidate-01"
    assert req.candidate_id(2) == "my-job-candidate-02"
    assert req.candidate_id(3) == "my-job-candidate-03"
    assert req.candidate_id(4) == "my-job-candidate-04"
