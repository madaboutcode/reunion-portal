# Claude Code entry point

Read [AGENTS.md](./AGENTS.md). It holds the repository layout, commands, the file that owns each setting and the rules, and it routes you by task: adapting the portal goes to [MAKE-IT-YOURS.md](./MAKE-IT-YOURS.md), running the event to [ADMIN.md](./ADMIN.md), deploying to [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). Terms are in [docs/GLOSSARY.md](./docs/GLOSSARY.md).

Run `make doctor` after you edit `site.config.json` or `src/server/wrangler.toml`.

(`scripts/imagegen` locates the repository root by finding this file next to `scripts/imagegen/`. Keep it at the root.)
