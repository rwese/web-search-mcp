# AGENTS.md — @ai-factory/web-search

SearXNG-backed web search: a shared core (`src/`) consumed by a CLI
(`web-search`), an MCP server (`web-search-mcp`, stdio + streamable HTTP), and
a pi extension wrapper (`extensions/`). Every search persists a session on
disk; `--use-ai` answers via a LangChain plan → search → summarize loop.

## Commands

- `pnpm install` — deps (tsgo ships via `@typescript/native-preview`; the
  ignored-build-scripts warning is harmless)
- `pnpm validate` — typecheck (tsgo) + lint (eslint 9) + tests (vitest); run
  before every commit
- `pnpm build` — emit `dist/` (bins get chmod +x)

## Layout

- `src/index.ts` — core: `search`, `readSession`, `renderMarkdown`,
  `loadConfig`, typed errors. The deep seam; surfaces stay thin.
- `src/agent.ts` — `--use-ai` loop: `planQuery`, `summarizeSession`,
  `answerQuery`. Prompt and footnote rules live here.
- `src/cli.ts`, `src/mcp.ts` — surfaces. `src/searxng.ts` (wire client),
  `src/session.ts`, `src/config.ts`, `src/markdown.ts`, `src/types.ts`.
- `extensions/` — pi wrapper (typebox params, pi-tui rendering).
- `test/` — vitest, mirrors `src/`.

## Config & secrets

- Copy `.env.example` → `$PWD/.env` (gitignored). `SEARXNG_URL` is required;
  the core fails fast without it.
- `OPENAI_API_KEY` wins when set; `openai.apiKey` in the XDG config file is
  the fallback (keep the file mode 0600). The dev/test litellm key
  is in the cold-at vault as `web-search/litellm-api-key` — read
  `docs/agents/agentic-loop.md` for its multiline gotcha before using it.
- Precedence: CLI flag > env > XDG config file > defaults. Sessions default to
  `$XDG_DATA_HOME/web-search/sessions/`, shared by all surfaces.

## Pointers

- `CONTEXT.md` — domain glossary. Use its terms; extend it when a term is
  resolved.
- `docs/agents/issue-tracker.md` — Forgejo tracker ops (API recipes, claiming,
  frontier). Reach when working issues.
- `docs/agents/agentic-loop.md` — the `--use-ai` architecture, footnote
  contract, and live smoke-test recipe. Reach when touching `src/agent.ts` or
  running AI tests.
- `research/*` branches, `test/` — prior API findings (SearXNG, MCP SDK, pi
  contract) and expected behavior; read before changing a seam.
