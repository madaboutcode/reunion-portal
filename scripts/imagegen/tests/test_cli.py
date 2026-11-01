from __future__ import annotations

import shutil
import sys
import uuid
from pathlib import Path

import pytest

from imagegen import cli
from imagegen.cli import EXIT_CREDENTIAL_BUDGET, EXIT_VALIDATION, _load_key

PORTAL_ROOT = Path(__file__).resolve().parents[3]
JOBS_DIR = PORTAL_ROOT / "scripts" / "imagegen" / "jobs"
TMP_DIR = PORTAL_ROOT / "tmp" / "imagegen"
REAL_PROMPT = JOBS_DIR / "stories-hero" / "prompts" / "stories-hero.txt"


@pytest.fixture
def output_dir_name():
    name = f"test-cli-{uuid.uuid4().hex[:8]}"
    yield name
    shutil.rmtree(TMP_DIR / name, ignore_errors=True)


def _base_argv(command: str, output_dir: str, job_id: str = "test-cli-job", **overrides):
    argv = [
        "imagegen", command,
        "--job-id", overrides.get("job_id", job_id),
        "--prompt-file", str(REAL_PROMPT),
        "--provider", "gemini",
        "--model", "gemini-test-model",
        "--unit-cost-estimate", overrides.get("unit_cost_estimate", "0.05"),
        "--aspect-ratio", "16:9",
        "--resolution", "1K",
        "--count", str(overrides.get("count", 4)),
        "--width", "1600",
        "--height", "900",
        "--output-dir", str(TMP_DIR / output_dir),
    ]
    if command == "run":
        if "max_spend" in overrides:
            argv += ["--max-spend", overrides["max_spend"]]
        if overrides.get("overwrite"):
            argv.append("--overwrite")
    return argv


def _no_network_urlopen(*args, **kwargs):
    raise AssertionError("network call attempted during plan")


def test_plan_valid_stories_hero_exits_zero_and_lists_four_candidates(
    monkeypatch, capsys, output_dir_name
):
    monkeypatch.setattr("urllib.request.urlopen", _no_network_urlopen)
    monkeypatch.setattr(sys, "argv", _base_argv("plan", output_dir_name))

    with pytest.raises(SystemExit) as exc_info:
        cli.main()

    assert exc_info.value.code == 0
    out = capsys.readouterr().out
    assert "test-cli-job-candidate-01" in out
    assert "test-cli-job-candidate-02" in out
    assert "test-cli-job-candidate-03" in out
    assert "test-cli-job-candidate-04" in out


def test_plan_creates_no_files_or_directories(monkeypatch, output_dir_name):
    target_dir = TMP_DIR / output_dir_name
    assert not target_dir.exists()

    monkeypatch.setattr("urllib.request.urlopen", _no_network_urlopen)
    monkeypatch.setattr(sys, "argv", _base_argv("plan", output_dir_name))

    with pytest.raises(SystemExit) as exc_info:
        cli.main()

    assert exc_info.value.code == 0
    assert not target_dir.exists()


def test_run_without_max_spend_exits_with_argparse_error(monkeypatch, output_dir_name, capsys):
    argv = _base_argv("run", output_dir_name)
    monkeypatch.setattr(sys, "argv", argv)

    with pytest.raises(SystemExit) as exc_info:
        cli.main()

    assert exc_info.value.code == 2
    err = capsys.readouterr().err
    assert "--max-spend" in err


def test_run_max_spend_below_required_exits_credential_budget(monkeypatch, output_dir_name):
    monkeypatch.setattr("urllib.request.urlopen", _no_network_urlopen)
    argv = _base_argv(
        "run", output_dir_name,
        unit_cost_estimate="0.50", count=4, max_spend="0.01",
    )
    monkeypatch.setattr(sys, "argv", argv)

    with pytest.raises(SystemExit) as exc_info:
        cli.main()

    assert exc_info.value.code == EXIT_CREDENTIAL_BUDGET
    assert EXIT_CREDENTIAL_BUDGET == 3


def test_invalid_job_id_exits_validation(monkeypatch, output_dir_name, capsys):
    argv = _base_argv("plan", output_dir_name, job_id="Not_Valid_ID")
    monkeypatch.setattr(sys, "argv", argv)

    with pytest.raises(SystemExit) as exc_info:
        cli.main()

    assert exc_info.value.code == EXIT_VALIDATION
    assert EXIT_VALIDATION == 2
    err = capsys.readouterr().err
    assert "job-id" in err


def test_load_key_reads_from_env_var(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "env-secret-key")
    assert _load_key() == "env-secret-key"


def test_load_key_reads_from_dev_vars_file_when_env_empty(monkeypatch, tmp_path):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    dev_vars = tmp_path / ".dev.vars"
    dev_vars.write_text('GEMINI_API_KEY="dev-vars-secret"\n')
    monkeypatch.chdir(tmp_path)

    assert _load_key() == "dev-vars-secret"
