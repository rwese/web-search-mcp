# @ai-factory/web-search

SearXNG-backed web search with a shared core consumed by three thin surfaces:
a CLI (`web-search`), an MCP server (`web-search-mcp`, stdio + streamable HTTP),
and a pi extension wrapper (`extensions/`).

Every search queries the configured SearXNG instance and persists an immutable
**search session** on disk. Any surface can later re-read a session written by
another surface.

## Quickstart — human

Prerequisites: Node.js >= 20, `pnpm`, a reachable SearXNG instance URL.

```sh
git clone ssh://git@git.void.cold.at:3022/ai-factory/web-search-mcp.git
cd web-search-mcp
pnpm install
cp .env.example .env   # then set SEARXNG_URL (required)
pnpm build
```

Search (markdown shows top 10, full data via `--json`):

```sh
node dist/cli.js "what is kubernetes"                  # search
node dist/cli.js "what is kubernetes" --json           # full structured response
node dist/cli.js --session 3f9a2c7e-what-is-kubernetes # re-read a persisted session
node dist/cli.js "best gnocchi recipe" --use-ai        # AI answer: plan -> search -> summarize
node dist/cli.js --doctor                              # validate setup (SearXNG, engines, LLM)
```

CLI flags: `--categories <csv>`, `--engines <csv>`, `--language <code>`,
`--time-range day|month|year`, `--safesearch 0|1|2`, `--page <n>`,
`--session <id>`, `--use-ai`, `--debug`, `--doctor`, `--json`, `--help`.
Exit codes: `0` ok (even empty results; for `--doctor`: all checks passed),
`1` runtime error (or `--doctor` found issues), `2` usage.
A query and `--session` are mutually exclusive; `--doctor` takes neither.

`--debug` enables verbose stderr logging — search request URLs and timing,
session persistence, and (with `--use-ai`) the planner's plan decision, the
summarizer's tool calls, and model-call counts. All debug output goes to
stderr, never stdout, so `--json` output stays machine-readable. Debug can
also be enabled for any surface via `WEB_SEARCH_DEBUG=1` (or a
`DEBUG` list containing `web-search`) or `"debug": true` in the XDG config
file; the `--debug` flag wins over both.

AI answers (`--use-ai`) need an OpenAI-compatible endpoint too:

```sh
export OPENAI_BASE_URL=https://litellm.void.cold.at/v1
export OPENAI_MODEL=deepseek-v4-flash
export OPENAI_API_KEY=<key>   # env wins; or openai.apiKey in the XDG config file (mode 0600)
node dist/cli.js "latest pi 5 news" --use-ai
```

## Quickstart — AI agent

Pick whichever surface your harness speaks. All three share the core and the
session store, so sessions are interchangeable.

**1. MCP via stdio** (Claude Code, opencode, pi):

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/abs/path/web-search-mcp/dist/mcp.js"],
      "env": { "SEARXNG_URL": "https://search.example.com" }
    }
  }
}
```

**2. MCP via streamable HTTP** (shared server for multiple agents):

```sh
node dist/mcp.js --http 3000   # or PORT=3000 node dist/mcp.js --http
# endpoint: POST/GET/DELETE http://localhost:3000/mcp
```

```json
{
  "mcpServers": {
    "web-search": { "type": "streamable-http", "url": "http://localhost:3000/mcp" }
  }
}
```

**3. pi extension** (`pi-package.json` / package with `"pi"` key already
declares `./extensions`):

```sh
pi install /abs/path/web-search-mcp   # then use the search tool
```

Tool contract (`search` — the only tool): required `query: string`;
optional `categories: string[]`, `engines: string[]` (default: all available
engines), `language: string`, `timeRange: day|month|year` (e.g. day for news
from the last 24h), `safeSearch: 0|1|2`, `pageNo: number`,
`maxResults: number` (default 10, max 50). Returns lean markdown:
`Session:` id line, then `title` / `url` / `snippet` / `engine` / `category`
per result. Agent guidance:

- `maxResults` only trims the rendered summary — the full result set stays in
  the persisted session on disk.
- Re-read full detail via the CLI (`--session <id>`) or the session store;
  there is no `search_details` MCP tool yet (deferred until the MCP server is
  in active use).
- `unresponsiveEngines` are data, not errors — some backends failed non-fatally.
- For `--use-ai` behavior from an agent, run the CLI rather than reimplementing
  the loop; explicit flags always override the AI plan.

## Setup details

### Config precedence and files

Highest precedence first:

1. Environment variables (`SEARXNG_URL`, `SEARXNG_TIMEOUT_MS`, `OPENAI_*`)
2. XDG config file `$XDG_CONFIG_HOME/web-search/config.json`
   (fallback `~/.config/web-search/config.json`) — non-secret values only
3. Built-in defaults

`$PWD/.env` (gitignored, copy from `.env.example`) is loaded by the CLI/MCP
entrypoints before startup; the core itself never loads dotenv.

| Variable            | Required | Default | Purpose                                              |
| ------------------- | -------- | ------- | ---------------------------------------------------- |
| `SEARXNG_URL`       | yes      | —       | SearXNG instance base URL; core fails fast without it |
| `SEARXNG_TIMEOUT_MS`| no       | `10000` | per-request timeout in ms                            |
| `WEB_SEARCH_DEBUG` | no       | `0`     | verbose stderr logging; `1` to enable                |
| `OPENAI_BASE_URL`   | for `--use-ai` | — | OpenAI-compatible endpoint                           |
| `OPENAI_MODEL`      | for `--use-ai` | — | model name (e.g. `deepseek-v4-flash`)                |
| `OPENAI_API_KEY`    | for `--use-ai` | — | key; env wins, `openai.apiKey` in the XDG config file is the fallback (mode 0600, must be a single line) |
| `PORT`              | no       | `3000`  | MCP `--http` port when no port arg is given          |

XDG config file example (`openai.apiKey` is the fallback when `OPENAI_API_KEY`
is unset — keep the file mode 0600 then):

```json
{
  "searxngUrl": "https://search.example.com",
  "timeoutMs": 10000,
  "storeDir": "/custom/path/to/sessions",
  "debug": false,
  "openai": { "baseUrl": "https://litellm.void.cold.at/v1", "model": "deepseek-v4-flash", "apiKey": "sk-..." }
}
```

`openai.apiKey` is a fallback for `OPENAI_API_KEY` (env wins). Keep the file
mode 0600 when it holds a key.

Sessions default to `$XDG_DATA_HOME/web-search/sessions/` (fallback
`~/.local/share/web-search/sessions/`). Each session is a directory named
`<8 hex>-<query slug>` (e.g. `3f9a2c7e-what-is-kubernetes`) containing a
`session.json` envelope plus one JSON file per result; sessions are immutable
once written.

### SearXNG requirements

Any standard SearXNG instance works; the core uses the JSON API plus
`/config` (the `--use-ai` planner constrains its category/engine picks to
what `/config` actually offers). No instance-side setup is needed.

### Dev commands

```sh
pnpm install    # deps
pnpm validate   # typecheck (tsgo) + lint (eslint 9) + tests (vitest); run before every commit
pnpm build      # emit dist/ (bins get chmod +x)
pnpm test       # vitest run
```

### `--doctor`

```sh
node dist/cli.js --doctor         # human-readable check list
node dist/cli.js --doctor --json  # structured DoctorReport
```

Checks, in order: config loads (`SEARXNG_URL` present) → session store
writable → SearXNG `/config` reachable → instance has enabled engines → a
side-effect-free `/search` probe (raw, no session persisted) → LLM endpoint
reachable via `GET {baseUrl}/models` when OpenAI config is present (skipped
otherwise, no chat call so no token cost). The LLM check also rejects a
multiline `OPENAI_API_KEY` (the vault secret has a marker comment after the
key — only the first line is valid). Exit `0` only when every check passes.

### How `--use-ai` works

Plan → search → summarize (`src/agent.ts`): the planner steers
categories/engines/language/timeRange from the instance's live `/config`
lists, the core searches and persists the session as usual, then a
tool-calling summarizer answers the original query from a numbered session
overview (top 10 by default) with one tool, `read_session_entry`, for full
per-result records. Summaries cite with `[^n]` footnotes backed by a Sources
section (`[^n]: [title](url)`); footnote failures retry once as a single
direct call. See `docs/agents/agentic-loop.md` for the footnote contract,
call limits, and the live smoke-test recipe.

### Glossary and internals

- `CONTEXT.md` — canonical domain glossary (search, session, store root,
  snippet, surface, …). Use its terms.
- `AGENTS.md` — contributor entrypoint (layout, secrets, pointers).
- `src/index.ts` — the core (`search`, `readSession`, `renderMarkdown`,
  `loadConfig`); `src/agent.ts`, `src/cli.ts`, `src/mcp.ts`, `src/searxng.ts`,
  `src/session.ts`, `src/config.ts`, `src/markdown.ts`, `src/types.ts`.
