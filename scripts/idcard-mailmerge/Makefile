# Smriti 2026 ID-card mail merge — dev tasks.
# Two halves: the renderer (idcards.py, Python via uv) and the layout editor
# (editor/, Node/Vite). Run from scripts/idcard-mailmerge/.

MANIFEST ?= fixtures/attendees.json    # override: make render MANIFEST=data/attendees.json
OUTDIR   ?= output
PROOFDIR ?= proof
D1_QUERY := ../../.claude/skills/devops/scripts/d1-query
OPEN := $(or $(shell command -v open 2>/dev/null),$(shell command -v xdg-open 2>/dev/null),echo Open this file:)
DUMP_SQL := SELECT id, full_name, branch, participation_type FROM registrations WHERE participation_type IS NOT 'donation_only'

.DEFAULT_GOAL := help
.PHONY: help install editor render preview cards proof validate prepare-assets dump test check clean clean-all

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install deps: uv sync (renderer) + npm install (editor)
	uv sync
	cd editor && npm install

# ENV=stg|prod picks the CDN for portraits (site.config.json environments.<env>.cdnUrl). No default.
SITE_CONFIG := ../site-config
require-env = $(if $(filter stg prod,$(ENV)),,$(error ENV=stg or ENV=prod is required: there is no default))

editor: ## Start the layout editor (Vite, http://localhost:5173). Needs ENV=stg|prod for the portrait CDN
	$(call require-env)
	cd editor && VITE_PUBLIC_CDN_URL=$$($(SITE_CONFIG) get $(ENV) cdnUrl) npm run dev

render: ## Render cards from $(MANIFEST) -> $(OUTDIR)/attendees.pdf
	uv run idcards.py render $(MANIFEST) --output $(OUTDIR)/attendees.pdf

preview: ## Render the sample and open the PDF (uses open / xdg-open if present)
	uv run idcards.py render fixtures/attendees.json --output $(OUTDIR)/preview.pdf
	$(OPEN) $(OUTDIR)/preview.pdf

cards: ## Render the REAL batch from data/attendees.json (run `make dump` first)
	uv run idcards.py render data/attendees.json --output $(OUTDIR)/cards.pdf

proof: ## Guided proof PDF + raster pages from $(MANIFEST) -> $(PROOFDIR)/
	uv run idcards.py proof $(MANIFEST) --output-dir $(PROOFDIR) --dpi 300

validate: ## Validate a manifest ($(MANIFEST))
	uv run idcards.py validate $(MANIFEST)

prepare-assets: ## (Re)build normalized doodle sheets + named crops
	uv run idcards.py prepare-assets

dump: ## Rebuild data/ from D1 (reads only). Needs ENV=stg|prod and CLOUDFLARE_API_TOKEN; writes PII (gitignored)
	$(call require-env)
	$(D1_QUERY) $(ENV) "$(DUMP_SQL)" \
	  | python3 -c 'import sys,json; s=sys.stdin.read(); print(json.dumps(json.loads(s[s.index("["):])[0]["results"]))' \
	  | uv run python dump_attendees.py --env $(ENV)

test: ## Run renderer unittests + editor vitest
	uv run python -m unittest discover -s tests -v
	cd editor && npm test

check: ## Editor typecheck (tsc --noEmit)
	cd editor && npm run typecheck

clean: ## Remove generated PDFs, proofs, and Python caches
	rm -rf $(OUTDIR) $(PROOFDIR) tests/__pycache__ __pycache__ editor/dist

clean-all: clean ## Also remove installed deps (.venv, editor/node_modules)
	rm -rf .venv editor/node_modules
