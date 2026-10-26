# AGENTS.md — @rwese/wze-websearch

SearXNG-backed web search: a shared core (`src/`) consumed by a CLI
(`wze-websearch`), an MCP server (`wze-websearch-mcp`, stdio + streamable HTTP), and
a pi extension wrapper (`extensions/`). Every search persists a session on
disk; `--use-ai` answers via a LangChain plan → search → summarize loop.

## Commands

- `pnpm install` — deps (tsgo ships via `@typescript/native-preview`; the
  ignored-build-scripts warning is harmless)
- `pnpm validate` — typecheck (tsgo) + lint (eslint 9) + fallow (dead code,
  duplication, complexity) + tests (vitest); run before every commit
- `pnpm fallow` — code-intelligence report (config in `.fallowrc.jsonc`);
  `pnpm fallow:audit` scopes findings to the current change
- `pnpm build` — emit `dist/` (bins get chmod +x)

Commit every verified change (signed by the configured identity) and push
`main` in the same turn; do not leave validated work uncommitted.

## Layout

- `src/index.ts` — barrel only, no logic. The deep seam is `src/core/`;
  surfaces stay thin.
- `src/core/` — `search`, `session`, `types`, `errors`, `markdown`.
- `src/infra/` — `config`, `debug`, `searxng` (wire client),
  `fetch-timeout` (shared fetch/abort plumbing).
- `src/ai/agent.ts` — `--use-ai` loop: `planQuery`, `summarizeSession`,
  `answerQuery`. Prompt and footnote rules live here.
- `src/diagnostics/doctor.ts` — `--doctor` setup checks.
- `src/surfaces/cli/` (`cli`, `args`), `src/surfaces/mcp/` (`mcp`, `server`,
  `http`, `stdio`, `constants`), `src/surfaces/pi/` (`tool`).
- `extensions/` — thin pi wrapper around `src/surfaces/pi/tool.ts`.
- `test/` — vitest, mirrors `src/` (`core/`, `infra/`, `ai/`, `diagnostics/`).

## Config & secrets

- Copy `.env.example` → `$PWD/.env` (gitignored). `SEARXNG_URL` is required;
  the core fails fast without it.
- `OPENAI_API_KEY` wins when set; `openai.apiKey` in the XDG config file is
  the fallback (keep the file mode 0600). The dev/test litellm key
  is in the cold-at vault as `wze-websearch/litellm-api-key` — read
  `docs/agents/agentic-loop.md` for its multiline gotcha before using it.
- Precedence: CLI flag > env > XDG config file > defaults. Sessions default to
  `$XDG_DATA_HOME/wze-websearch/sessions/`, shared by all surfaces.

## Pointers

- `CONTEXT.md` — domain glossary. Use its terms; extend it when a term is
  resolved.
- `docs/agents/issue-tracker.md` — Forgejo tracker ops: the claim → fix →
  validate → signed commit → resolution-comment → close loop, API recipes, and
  the wayfinder frontier. Reach when working any issue.
- `docs/agents/agentic-loop.md` — the `--use-ai` architecture, footnote
  contract, and live smoke-test recipe. Reach when touching `src/ai/agent.ts` or
  running AI tests.
- `docs/agents/releases.md` — signed release pipeline, self-owned install layout,
  and updater trust/rollback rules. Reach when touching `src/update/`,
  `scripts/release.sh`, or `.forgejo/workflows/release.yml`.
- `research/*` branches, `test/` — prior API findings (SearXNG, MCP SDK, pi
  contract) and expected behavior; read before changing a seam.
