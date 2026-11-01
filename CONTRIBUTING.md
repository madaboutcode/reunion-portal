# Contributing

Two kinds of change are welcome here: improvements to the portal that help every batch (bug fixes, docs, setup steps, tests), and your own adaptation of it, which usually stays in your fork. This page says how to tell them apart and what to run before you commit. Terms are in the [glossary](./docs/GLOSSARY.md).

## Upstream change or fork-only change

| The change is | Where it goes |
|---|---|
| A bug fix, a clearer doc, a better error message, a missing test, a safer default | Open a pull request against this repository |
| A new feature that other reunions would use (a payment method, a report, another bank's statement parser) | Open an issue first to agree on the shape, then a pull request |
| Your event's name, colors, prices, dates, copy, logo, domains, bank details | Keep it in your fork. Do not send it upstream |
| A removed feature (you dropped the prediction contest, the magazine) | Keep it in your fork. Upstream keeps the feature |

Never put real data in a pull request: names, emails, phone numbers, bank details, Cloudflare IDs or tokens. Use `example.com` addresses and made-up names in tests, specs and docs. See [SECURITY.md](./SECURITY.md).

To pull upstream fixes into a fork later, add this repository as a second remote and merge it. Keep your branding edits in separate commits so conflicts stay small.

## Before you commit

Run these from the repository root. They need Node (version in `.node-version`) and `uv`.

```bash
make check     # typecheck (web and server) and lint, zero warnings allowed
make test      # server, web and shared test suites
make doctor    # config files agree; lists example values still left
```

CI runs `make check` only, so run `make test` yourself. `make doctor` exits 0 in this repository because it ships the Smriti example values; read its "Agreement and required settings" section and fix anything listed there. If you edited `site.config.json` or `src/server/wrangler.toml`, run it every time.

One server test, `staff-edit-archive.test.ts`, has failed about once in ten runs with "Registration was modified by another request". Rerun before you investigate.

Look at a UI change in a browser (`make dev`) at 375, 768 and 1280 pixels wide. A passing test suite does not show that a page looks right.

## Rules for code and docs

- Follow the conventions in [AGENTS.md](./AGENTS.md): TypeScript strict mode, no `any`, one component per file, Tailwind only, prices only in `PRICING_DEFAULTS`.
- Database changes are new numbered files in `src/server/migrations/`. Never edit or delete a migration that has been applied.
- Each setting has one owner file ([AGENTS.md](./AGENTS.md#where-settings-live)). Do not copy a URL, a resource name or a secret into a second place, and do not add a fallback URL to the Worker.
- Do not add a dependency without a reason. Bundle size matters on mobile.
- Never commit `.env.ops`, `src/server/.dev.vars`, tokens, or anything in `tmp/`.

## Specs

What each feature must do is written in `docs/specs/` (index: [docs/specs/README.md](./docs/specs/README.md)). Code comments cite rule numbers such as `R4.3`. When you change behavior, change the matching spec in the same commit. When you add a feature, add or extend a spec first. How the parts fit together is in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Commit messages

Write a short, plain subject in the imperative mood that says what changed, for example `Fail closed when APP_BASE_URL is missing`. Add a body when the reason is not obvious. One logical change per commit, and stage files by name rather than with `git add -A`, so unrelated edits do not slip in. Do not add generated-by or co-author lines for tools.

## Pull requests

Say what changed and why, and which of the three commands above you ran, with the result. Keep the pull request to one topic. Link the issue if there is one.

## Reporting a security problem

Do not open a public issue for a vulnerability. See [SECURITY.md](./SECURITY.md).
