# Ops settings (database names, Worker names, URLs) are not repeated here. They live in
# src/server/wrangler.toml, site.config.json and .env.ops, and are read through
# scripts/site-config (see scripts/site_config.py). `make doctor` checks them.
SC := scripts/site-config
D1_QUERY := .claude/skills/devops/scripts/d1-query

.PHONY: help doctor doctor-strict stg-db-snapshot install dev dev-server dev-all build fonts typecheck lint check test test-server test-web test-shared clean stg-deploy stg-deploy-web stg-deploy-server stg-db-migrate stg-db-exec stg-db-query db-migrate-local

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (fnm use + npm install)
	fnm use && npm install

# The local D1 database is addressed by its binding name (DB), so it follows
# src/server/wrangler.toml and no database name is repeated here.
db-migrate-local: ## Apply D1 migrations to local database
	@npm run --silent db:migrate:local

# scripts/dev-all.mjs downloads fonts if missing, migrates, starts both servers,
# and stops one if the other fails. API_PORT=<port> moves the API off 8787.
dev: ## Start web + API dev servers (downloads fonts on first run; API_PORT overrides 8787)
	@node scripts/dev-all.mjs

dev-server: db-migrate-local ## Start API dev server only (Hono/wrangler, http://localhost:8787; API_PORT overrides)
	npm -w @smriti/server run dev -- --port $${API_PORT:-8787}

dev-web: src/web/src/fonts.generated.css ## Start web dev server only (Vite, http://localhost:5173)
	npm run dev:web

src/web/src/fonts.generated.css:
	node scripts/download-fonts.mjs

dev-all: dev ## Alias for make dev (web + API)

fonts: ## Download and self-host Google Fonts (WOFF2)
	node scripts/download-fonts.mjs

build: fonts ## Production build (web)
	npm run build

typecheck: ## TypeScript type checking
	npm run typecheck

lint: ## Lint (ESLint + Prettier)
	npm run lint

check: typecheck lint ## typecheck (web + server) + lint
	@echo "All checks passed"

test-server: ## Run server tests
	npm run test:server

test-web: ## Run web tests
	npm -w @smriti/portal run test

test-shared: ## Run shared tests
	npm -w @smriti/shared run test

test: test-server test-web test-shared ## Run all test suites

clean: ## Remove dist + node_modules
	rm -rf node_modules src/web/dist src/server/dist src/shared/dist

stg-deploy: check ## [stg] Build + deploy web (Pages) + server (Workers)
	./scripts/deploy.sh stg all

stg-deploy-web: check ## [stg] Deploy web only (Cloudflare Pages)
	./scripts/deploy.sh stg web

stg-deploy-server: ## [stg] Deploy API only (Cloudflare Workers)
	./scripts/deploy.sh stg server

# ── Config check ─────────────────────────────────────────────────────────────

doctor: ## List config values still equal to the original Smriti example; check config agrees (exit 0 here)
	@uv run --quiet --no-project scripts/doctor.py $(if $(STRICT),--strict,)

doctor-strict: ## Same as doctor, but exit non-zero if any example value is left (run before launch; or: make doctor STRICT=1)
	@uv run --quiet --no-project scripts/doctor.py --strict

# ── Staging remote operations ────────────────────────────────────────────────
# Settings come from wrangler.toml / site.config.json / .env.ops (see above).
# CLOUDFLARE_API_TOKEN: the AGENT token (D1 read) from your shell or .env.ops is
# enough for stg-db-query and stg-db-snapshot. The ADMIN targets change data and
# need the DEPLOY token in your shell (process environment only), see
# .claude/skills/devops/SKILL.md "Tokens".
# There are no prod targets on purpose. For prod, read with
# .claude/skills/devops/scripts/d1-query prod "SELECT ..." and deploy through CI
# (or scripts/deploy.sh, which prints its target and asks for confirmation).

stg-db-query: ## [stg] Read-only SQL against remote D1 (SQL="SELECT ..."); writes are refused
	@$(D1_QUERY) stg "$(SQL)"

stg-db-snapshot: ## [stg] Export full D1 snapshot to tmp/<date>-stg-snapshot/ (personal data; ignored by git; delete when done)
	$(eval SNAP_DIR := $(CURDIR)/tmp/$(shell date +%Y-%m-%d)-stg-snapshot)
	@mkdir -p $(SNAP_DIR)
	@cfg="$$($(SC) env stg --keys d1Name --secret CLOUDFLARE_API_TOKEN)" || exit 1; eval "$$cfg"; \
	  npx -w @smriti/server wrangler d1 export "$$D1_DATABASE_NAME" --remote --output $(SNAP_DIR)/dump.sql --skip-confirmation
	@echo "✓ Snapshot saved to $(SNAP_DIR)/dump.sql"

stg-db-migrate: ## [stg] ADMIN — run migrations on remote D1 (deploy token in your shell)
	@test -n "$$CLOUDFLARE_API_TOKEN" || { echo "Set the deploy CLOUDFLARE_API_TOKEN in your shell first (not read from .env.ops)" >&2; exit 1; }
	@cfg="$$($(SC) env stg --keys d1Name)" || exit 1; eval "$$cfg"; \
	  echo "⚠  ADMIN — this modifies the staging database '$$D1_DATABASE_NAME'."; \
	  echo "   Press Ctrl+C to abort, Enter to continue..."; read _confirm; \
	  cd src/server && npx wrangler d1 migrations apply "$$D1_DATABASE_NAME" --remote

stg-db-exec: ## [stg] ADMIN — execute arbitrary SQL on remote D1 (SQL="...", deploy token in your shell)
	@test -n "$$CLOUDFLARE_API_TOKEN" || { echo "Set the deploy CLOUDFLARE_API_TOKEN in your shell first (not read from .env.ops)" >&2; exit 1; }
	@echo "⚠  ADMIN — executing SQL on staging D1: $(SQL)"
	@echo "   Press Ctrl+C to abort, Enter to continue..."
	@read _confirm
	@$(D1_QUERY) stg --write "$(SQL)"
