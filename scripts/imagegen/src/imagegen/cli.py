from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal
from pathlib import Path

from . import constants as C
from .normalize import (
    EncodedImage,
    prepare_references,
    validate_and_normalize_output,
)
from .provider import (
    AuthError,
    GeminiAdapter,
    GenerateRequest,
    ModerationError,
    ProviderError,
    QuotaError,
)
from .provenance import CandidateStatus, candidate_status, write_candidate
from .request import JobRequest, ValidationError, validate_and_build


EXIT_OK = 0
EXIT_VALIDATION = 2
EXIT_CREDENTIAL_BUDGET = 3
EXIT_PROVIDER = 4
EXIT_IMAGE = 5


def _parse_ratio(ratio_str: str) -> float:
    a, b = ratio_str.split(":")
    return float(a) / float(b)


def _load_key() -> str:
    """GEMINI_API_KEY: process env, then <repo>/.env.ops (via scripts/site_config.py), then ./.dev.vars."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key

    scripts_dir = str(Path(__file__).resolve().parents[3])  # <repo>/scripts
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    try:
        import site_config

        found = site_config.secret_source("GEMINI_API_KEY")
        if found:
            return found[0]
    except ImportError:
        pass  # imagegen was copied out of the repo: fall through to ./.dev.vars

    dev_vars = Path.cwd() / ".dev.vars"
    if dev_vars.is_file():
        for line in dev_vars.read_text().splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() == "GEMINI_API_KEY":
                val = v.strip().strip('"').strip("'")
                if val:
                    return val

    return ""


def _print_plan(req: JobRequest, statuses: list[tuple[int, CandidateStatus]]) -> None:
    print(f"Job: {req.job_id}")
    print(f"Provider: {req.provider} / {req.model}")
    print(f"Prompt: {req.prompt_file} (sha256: {req.prompt_sha})")

    if req.references:
        for i, (path, sha) in enumerate(zip(req.references, req.reference_shas)):
            print(f"Reference {i+1}: {path} (sha256: {sha})")
    else:
        print("References: none (text-only)")

    print(f"Output: {req.width}x{req.height} {req.fmt} q{req.quality} "
          f"({req.aspect_ratio}, {req.resolution})")
    print(f"Unit cost estimate: ${req.unit_cost_estimate} (operator_estimate)")
    print(f"Candidates: {req.count}")
    print(f"Worst case: ${req.worst_case_cost()} "
          f"({req.count} x ${req.unit_cost_estimate})")
    print(f"Output dir: {req.output_dir}")
    print()

    needs_overwrite = False
    for n, st in statuses:
        flag = ""
        if st.status in ("incomplete", "mismatched"):
            flag = " [needs --overwrite]"
            needs_overwrite = True
        detail = f" ({st.detail})" if st.detail else ""
        print(f"  {req.candidate_id(n)}: {st.status}{detail}{flag}")

    print()
    if needs_overwrite:
        print("Some candidates need --overwrite to regenerate.")
    print("Note: Gemini does not report billed cost; the cap controls "
          "estimated exposure, not the final invoice.")


def _cmd_plan(req: JobRequest) -> int:
    statuses = []
    for n in range(1, req.count + 1):
        st = candidate_status(req, n)
        statuses.append((n, st))

    _print_plan(req, statuses)
    return EXIT_OK


def _cmd_run(req: JobRequest, max_spend: Decimal, overwrite: bool) -> int:
    key = _load_key()
    if not key:
        print("Error: GEMINI_API_KEY not found. It is a secret owned by .env.ops (see .env.ops.example); you can also export it in your shell or put it in ./.dev.vars.",
              file=sys.stderr)
        return EXIT_CREDENTIAL_BUDGET

    encoded_refs: tuple[EncodedImage, ...] = ()
    ref_details: list[dict] = []
    if req.references:
        try:
            encoded_refs = prepare_references(req.references)
        except ValidationError as e:
            print(f"Reference error: {e}", file=sys.stderr)
            return EXIT_VALIDATION

        for i, (path, sha, enc) in enumerate(
            zip(req.references, req.reference_shas, encoded_refs)
        ):
            ref_details.append({
                "path": str(path),
                "sha256": sha,
                "originalWidth": enc.original_width,
                "originalHeight": enc.original_height,
                "encodedWidth": enc.encoded_width,
                "encodedHeight": enc.encoded_height,
            })

    expected_ratio = _parse_ratio(req.aspect_ratio)
    adapter = GeminiAdapter(key)
    gen_request = GenerateRequest(
        model=req.model,
        prompt=req.prompt_file.read_text(),
        references=encoded_refs,
        aspect_ratio=req.aspect_ratio,
        resolution=req.resolution,
    )

    had_failure = False

    for n in range(1, req.count + 1):
        cid = req.candidate_id(n)
        st = candidate_status(req, n)

        if st.status == "complete":
            print(f"  {cid}: complete (skipped)")
            continue

        if st.status in ("incomplete", "mismatched"):
            if not overwrite:
                print(f"Error: {cid} is {st.status} ({st.detail}); "
                      f"use --overwrite to regenerate", file=sys.stderr)
                return EXIT_VALIDATION

        unfinished = sum(
            1 for m in range(n, req.count + 1)
            if candidate_status(req, m).status != "complete"
        )
        required = req.unit_cost_estimate * unfinished
        if required > max_spend:
            print(f"Error: estimated cost ${required} "
                  f"({unfinished} x ${req.unit_cost_estimate}) "
                  f"exceeds --max-spend ${max_spend}", file=sys.stderr)
            return EXIT_CREDENTIAL_BUDGET

        print(f"  {cid}: generating...", end="", flush=True)

        try:
            result = adapter.generate(gen_request)
        except (AuthError, QuotaError) as e:
            print(f" FAILED")
            print(f"  Error: {e}", file=sys.stderr)
            return EXIT_CREDENTIAL_BUDGET
        except ProviderError as e:
            print(f" FAILED")
            print(f"  Error: {e}", file=sys.stderr)
            had_failure = True
            continue

        try:
            output = validate_and_normalize_output(
                result.image,
                req.width,
                req.height,
                expected_ratio,
                req.fmt,
                req.quality,
            )
        except ValidationError as e:
            print(f" FAILED")
            print(f"  Output error: {e}", file=sys.stderr)
            had_failure = True
            continue

        try:
            write_candidate(
                req, n, output,
                result.elapsed_seconds,
                result.request_id,
                result.usage,
                ref_details=ref_details if ref_details else None,
            )
        except Exception as e:
            print(f" FAILED")
            print(f"  Write error: {e}", file=sys.stderr)
            return EXIT_IMAGE

        print(f" OK ({output.byte_count} bytes, {result.elapsed_seconds}s)")

    if had_failure:
        print("\nSome candidates failed. Rerun to resume.", file=sys.stderr)
        return EXIT_PROVIDER

    print("\nAll candidates complete.")
    return EXIT_OK


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="imagegen",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "Generate candidate images with the Gemini API (optional tool, e.g. for the memories page).\n"
            "`plan` shows what would be generated and costs nothing. `run` calls the PAID Gemini API;\n"
            "--max-spend (USD) is the spending cap. Needs GEMINI_API_KEY (environment, .env.ops, or ./.dev.vars\n"
            "in the current directory). Run from the repo root with:\n"
            "  uv run --project scripts/imagegen imagegen <plan|run> ..."
        ),
        epilog=(
            "example (from the repo root):\n"
            "  uv run --project scripts/imagegen imagegen plan --job-id stories-hero \\\n"
            "    --prompt-file scripts/imagegen/jobs/stories-hero/prompts/stories-hero.txt \\\n"
            "    --provider gemini --model <gemini-image-model-id> --unit-cost-estimate <usd-per-image> \\\n"
            "    --aspect-ratio 16:9 --resolution 1K --width 1600 --height 900 \\\n"
            "    --output-dir tmp/imagegen/stories-hero\n"
            "rules: --provider is gemini; --aspect-ratio is one of 16:9 1:1 9:16 4:3 3:4;\n"
            "--resolution is 1K; --output-dir must be inside the repo's tmp/imagegen/ (git-ignored).\n"
            "jobs/stories-hero is an example job from the original site's memories page.\n"
            "uv creates scripts/imagegen/.venv on first use (git-ignored)."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    for name in ("plan", "run"):
        p = sub.add_parser(name)
        p.add_argument("--job-id", required=True)
        p.add_argument("--prompt-file", required=True)
        p.add_argument("--reference", action="append", default=[])
        p.add_argument("--provider", required=True)
        p.add_argument("--model", required=True)
        p.add_argument("--unit-cost-estimate", required=True)
        p.add_argument("--aspect-ratio", required=True)
        p.add_argument("--resolution", required=True)
        p.add_argument("--count", type=int, default=C.DEFAULT_CANDIDATE_COUNT)
        p.add_argument("--format", dest="fmt", default=C.DEFAULT_FORMAT)
        p.add_argument("--quality", type=int, default=C.DEFAULT_QUALITY)
        p.add_argument("--width", type=int, required=True)
        p.add_argument("--height", type=int, required=True)
        p.add_argument("--output-dir", required=True)

        if name == "run":
            p.add_argument("--max-spend", required=True)
            p.add_argument("--overwrite", action="store_true")

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    try:
        req = validate_and_build(
            job_id=args.job_id,
            prompt_file=args.prompt_file,
            references=args.reference,
            provider=args.provider,
            model=args.model,
            unit_cost_estimate=args.unit_cost_estimate,
            aspect_ratio=args.aspect_ratio,
            resolution=args.resolution,
            count=args.count,
            fmt=args.fmt,
            quality=args.quality,
            width=args.width,
            height=args.height,
            output_dir=args.output_dir,
        )
    except ValidationError as e:
        print(f"Validation error: {e}", file=sys.stderr)
        sys.exit(EXIT_VALIDATION)

    if args.command == "plan":
        code = _cmd_plan(req)
    elif args.command == "run":
        try:
            max_spend = Decimal(args.max_spend)
        except Exception:
            print(f"Error: --max-spend must be a decimal number", file=sys.stderr)
            sys.exit(EXIT_VALIDATION)
        if max_spend <= 0:
            print(f"Error: --max-spend must be positive", file=sys.stderr)
            sys.exit(EXIT_VALIDATION)

        unfinished = sum(
            1 for n in range(1, req.count + 1)
            if candidate_status(req, n).status != "complete"
        )
        required = req.unit_cost_estimate * unfinished
        if required > max_spend:
            print(f"Error: estimated cost ${required} "
                  f"({unfinished} x ${req.unit_cost_estimate}) "
                  f"exceeds --max-spend ${max_spend}", file=sys.stderr)
            sys.exit(EXIT_CREDENTIAL_BUDGET)

        code = _cmd_run(req, max_spend, args.overwrite)
    else:
        code = EXIT_VALIDATION

    sys.exit(code)
