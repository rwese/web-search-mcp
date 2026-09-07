# Development

Contributor notes for `@ai-factory/web-search`. User-facing docs live in
`README.md`; this file covers build, architecture, and internals.

## Commands

```sh
pnpm install    # deps (tsgo ships via @typescript/native-preview; the ignored-build-scripts warning is harmless)
pnpm validate   # typecheck (tsgo) + lint (eslint 9) + tests (vitest); run before every commit
pnpm build      # emit dist/ (bins get chmod +x)
pnpm test       # vitest run only
```

## Layout

- `src/index.ts` — barrel only, no logic. The deep seam is `src/core/`;
  surfaces stay thin.
- `src/core/` — `search`, `session`, `types`, `errors`, `markdown`.
- `src/infra/` — `config`, `debug`, `searxng` (wire client).
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
  the fallback (keep the file mode 0600). The dev/test litellm key is in the
  cold-at vault as `web-search/litellm-api-key` — read
  `docs/agents/agentic-loop.md` for its multiline gotcha before using it.
- Precedence: CLI flag > env > XDG config file > defaults. Sessions default to
  `$XDG_DATA_HOME/web-search/sessions/`, shared by all surfaces.

## How `--use-ai` works

Plan → search → summarize (`src/ai/agent.ts`): the planner steers
categories/engines/language/timeRange from the instance's live `/config`
lists, the core searches and persists the session as usual, then a
tool-calling summarizer answers the original query from a numbered session
overview (top 10 by default) with one tool, `read_session_entry`, for full
per-result records. Summaries cite with `[^n]` footnotes backed by a Sources
section (`[^n]: [title](url)`); footnote failures retry once as a single
direct call. See `docs/agents/agentic-loop.md` for the footnote contract,
call limits, and the live smoke-test recipe.

## How `--doctor` works

Checks, in order: config loads (`SEARXNG_URL` present) → session store
writable → SearXNG `/config` reachable → instance has enabled engines → a
side-effect-free `/search` probe (raw, no session persisted) → LLM endpoint
reachable via `GET {baseUrl}/models` when OpenAI config is present (skipped
otherwise, no chat call so no token cost). The LLM check also rejects a
multiline `OPENAI_API_KEY` (the vault secret has a marker comment after the
key — only the first line is valid). Exit `0` only when every check passes.

## Pointers

- `CONTEXT.md` — domain glossary. Use its terms; extend it when a term is
  resolved.
- `docs/agents/issue-tracker.md` — Forgejo tracker ops (API recipes, claiming,
  frontier).
- `docs/agents/agentic-loop.md` — the `--use-ai` architecture, footnote
  contract, and live smoke-test recipe.
- `research/*` branches, `test/` — prior API findings (SearXNG, MCP SDK, pi
  contract) and expected behavior; read before changing a seam.
