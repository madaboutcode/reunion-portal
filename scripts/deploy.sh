#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/deploy.sh <stg|prod> [web|server|all] [--dry-run]
#   env: stg | prod (required: there is no default)
#   --dry-run: build the web app, bundle the Worker with `wrangler deploy --dry-run`, and print
#              the exact commands and --var values. Nothing is deployed, no token is needed,
#              no confirmation is asked. The Worker bundle goes to tmp/deploy-dry-run/<env>
#              (override with DRY_RUN_OUTDIR).
#
# WRITES to Cloudflare: builds and deploys the web app (Pages), applies remote D1
# migrations and deploys the API Worker (Workers). Normal deploys happen through
# GitHub CI (merge into release/stg or release/prod); run this by hand only when
# you mean to.
#
# prod outside CI prints its target (Pages project, D1 database, Worker, site URL)
# and asks you to type "deploy prod". In CI ($CI is set) it does not ask.
#
# Settings come from scripts/site_config.py: the D1 database and Worker from
# src/server/wrangler.toml, the Pages project, URLs and sender name from site.config.json.
# The web build reads site.config.json itself (Vite mode production|staging). The Worker gets
# APP_BASE_URL, SENDER_NAME, PUBLIC_THUMBS_URL and PUBLIC_PORTRAITS_URL as
# `wrangler deploy --var KEY:VALUE` taken from site.config.json; wrangler.toml has no URL vars.
# A plain `wrangler deploy` that skips this script has no APP_BASE_URL, and the Worker then
# answers every request with a 500 config error (it fails closed).
#
# The DEPLOY token: CLOUDFLARE_API_TOKEN must be in the process environment, with
# Pages, Workers and D1 edit permissions. It is read from the process environment
# ONLY, never from .env.ops (which holds the narrower agent token). In CI it is the
# GitHub Actions secret CLOUDFLARE_API_TOKEN; on your machine, read it
# without echo, for this one command:
#   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN && scripts/deploy.sh stg server; unset CLOUDFLARE_API_TOKEN
# A person runs this, not an AI agent.
# The Pages deploy uses --branch main; check that matches the production branch
# of your Pages project.

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '4,36p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

DRY_RUN=""
POSITIONAL=()
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then DRY_RUN=1; else POSITIONAL+=("$arg"); fi
done
ENV="${POSITIONAL[0]:-}"
TARGET="${POSITIONAL[1]:-all}"

if [[ -z "$ENV" || ! "$ENV" =~ ^(stg|prod)$ ]]; then
  echo "Usage: $0 <stg|prod> [web|server|all] [--dry-run]   (environment is required; see --help)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SC="$SCRIPT_DIR/site-config"

# Example-value check: a real deploy refuses while this environment's URLs, Pages project or
# wrangler.toml names still equal the original Smriti example (list: EXAMPLE_VALUES in
# scripts/doctor.py). --dry-run prints the same warning and continues. Runs before the token
# check and before any build.
if command -v uv >/dev/null 2>&1; then DOCTOR=(uv run --quiet --no-project "$SCRIPT_DIR/doctor.py"); else DOCTOR=(python3 "$SCRIPT_DIR/doctor.py"); fi
set +e
EXAMPLE_HITS="$("${DOCTOR[@]}" --deploy-check "$ENV")"
EXAMPLE_RC=$?
set -e
if [[ $EXAMPLE_RC -eq 3 ]]; then
  {
    echo "deploy: these [$ENV] values are still the original Smriti example:"
    echo "$EXAMPLE_HITS"
    echo "Edit site.config.json / src/server/wrangler.toml, then run make doctor."
  } >&2
  if [[ -z "$DRY_RUN" ]]; then echo "deploy: refusing to deploy." >&2; exit 1; fi
  echo "deploy: --dry-run: continuing." >&2
elif [[ $EXAMPLE_RC -ne 0 ]]; then
  echo "deploy: the example-value check failed (exit $EXAMPLE_RC)." >&2
  exit 1
fi

# Environment config. Hard error (naming the key and its owner file) if one is missing.
# stg = wrangler top-level (no --env flag needed); prod = [env.production] (--env production).
cfg="$("$SC" env "$ENV" --keys pagesProject,d1Name,workerName,siteUrl,r2Bucket,cdnUrl,senderName)" || exit 1
eval "$cfg"
# Optional: the public thumbnails host. Unset = the Worker serves thumbnails through its own route.
THUMBS_URL="$("$SC" get "$ENV" publicThumbsUrl 2>/dev/null || true)"
# Worker variables, passed on the command line so wrangler.toml does not own them.
WORKER_VARS=(--var "APP_BASE_URL:$SITE_URL" --var "SENDER_NAME:$SENDER_NAME" --var "PUBLIC_PORTRAITS_URL:${CDN_URL%/}/portraits")
if [[ -n "$THUMBS_URL" ]]; then WORKER_VARS+=(--var "PUBLIC_THUMBS_URL:$THUMBS_URL"); fi
D1_DB_NAME="$D1_DATABASE_NAME"
WRANGLER_ENV_FLAG=""
[[ "$ENV" == "prod" ]] && WRANGLER_ENV_FLAG="--env production"

# Token: process environment only.
if [[ -z "$DRY_RUN" && -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "deploy: CLOUDFLARE_API_TOKEN is not set in the process environment. Pass a Cloudflare deploy token with Pages, Workers and D1 edit permissions (it is not read from .env.ops)." >&2
  exit 1
fi
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then export CLOUDFLARE_API_TOKEN; fi

# Production: show the target, then outside CI require a typed confirmation.
if [[ "$ENV" == "prod" || -n "$DRY_RUN" ]]; then
  {
    echo "TARGET [$ENV]${DRY_RUN:+ (dry run: nothing is deployed)}"
    echo "  Pages project : $PAGES_PROJECT"
    echo "  D1 database   : $D1_DB_NAME"
    echo "  Worker        : $WORKER_NAME"
    echo "  R2 bucket     : $R2_BUCKET"
    echo "  site URL      : $SITE_URL"
    echo "  CDN URL       : $CDN_URL"
    echo "  action        : $TARGET"
  } >&2
  if [[ "$ENV" == "prod" && -z "$DRY_RUN" && -z "${CI:-}" ]]; then
    echo "This applies remote D1 migrations and publishes live to registrants." >&2
    read -r -p 'Type "deploy prod" to continue: ' CONFIRM
    if [[ "$CONFIRM" != "deploy prod" ]]; then
      echo "deploy: cancelled." >&2
      exit 1
    fi
  fi
fi

echo "==> Deploying to $ENV (project: $PAGES_PROJECT)"

deploy_web() {
  # Vite mode picks the environment in site.config.json (production = prod, staging = stg).
  local mode="production"
  [[ "$ENV" == "stg" ]] && mode="staging"
  echo "==> Building web (mode $mode)..."
  npm -w @smriti/portal run build -- --mode "$mode"

  local pages_cmd=(npx -w @smriti/portal wrangler pages deploy "$ROOT_DIR/src/web/dist"
    --project-name "$PAGES_PROJECT" --branch main --commit-dirty=true)
  if [[ -n "$DRY_RUN" ]]; then
    echo -n "==> [dry run] would run: "; printf '%q ' "${pages_cmd[@]}"; echo
    return
  fi
  echo "==> Deploying to Cloudflare Pages..."
  "${pages_cmd[@]}"
}

deploy_server() {
  local migrate_cmd=(npx wrangler d1 migrations apply "$D1_DB_NAME" --remote $WRANGLER_ENV_FLAG)
  local deploy_cmd=(npx -w @smriti/server wrangler deploy $WRANGLER_ENV_FLAG "${WORKER_VARS[@]}")
  if [[ -n "$DRY_RUN" ]]; then
    local outdir="${DRY_RUN_OUTDIR:-$ROOT_DIR/tmp/deploy-dry-run/$ENV}"
    echo -n "==> [dry run] would run (in src/server): "; printf '%q ' "${migrate_cmd[@]}"; echo
    echo -n "==> [dry run] would run: "; printf '%q ' "${deploy_cmd[@]}"; echo
    echo "==> [dry run] bundling the Worker locally with --dry-run --outdir $outdir"
    npx -w @smriti/server wrangler deploy $WRANGLER_ENV_FLAG "${WORKER_VARS[@]}" --dry-run --outdir "$outdir"
    return
  fi
  echo "==> Applying D1 migrations..."
  (cd "$ROOT_DIR/src/server" && "${migrate_cmd[@]}")

  echo "==> Deploying Workers API..."
  "${deploy_cmd[@]}"
}

case "$TARGET" in
  web)    deploy_web ;;
  server) deploy_server ;;
  all)
    deploy_web
    deploy_server
    ;;
  *)
    echo "Usage: $0 <stg|prod> [web|server|all] [--dry-run]" >&2
    exit 1
    ;;
esac

echo "==> Deploy to $ENV ${DRY_RUN:+dry run }complete"
