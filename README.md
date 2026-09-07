# @ai-factory/web-search

Web search powered by your own [SearXNG](https://docs.searxng.org/) instance.
Search from the terminal, from an AI agent (MCP), or from pi — every search is
saved as a reusable **session** on disk.

> **New here?** Install → search → done. The [CLI guide](#cli--usage) below
> covers everything, with example output for every command.

## Install

Prerequisites: Node.js >= 20, `pnpm`, and a reachable SearXNG instance URL.

```sh
git clone ssh://git@git.void.cold.at:3022/ai-factory/web-search-mcp.git
cd web-search-mcp
pnpm install
cp .env.example .env   # then set SEARXNG_URL (required)
pnpm build
```

Check that everything works:

```sh
node dist/surfaces/cli/cli.js --doctor
```

```
web-search doctor
✓ config: SEARXNG_URL=https://search.wze.nope.at timeout=10000ms store=/home/you/.local/share/web-search/sessions
✓ store-dir: /home/you/.local/share/web-search/sessions writable
✓ searxng: https://search.wze.nope.at reachable (32 categories, 86 enabled engines)
✓ engines: 86 enabled: wikipedia, arxiv, github, stackoverflow, youtube, ...
✓ search: probe query "test" returned 36 result(s) (3 unresponsive engine(s))
✓ llm: not configured (skipped)
6/6 checks passed
```

> The LLM check only matters for `--use-ai` (see [AI answers](#ai-answers)).
> Without LLM config it reports "skipped" and still passes.

## CLI — usage

The CLI binary is `web-search` (after `pnpm build`, run it as
`node dist/surfaces/cli/cli.js …`).

```
web-search "<query>" [flags]          search
web-search --session <id> [--json]    re-read a saved session
web-search --doctor [--json]          validate your setup
web-search --help                     show help
```

| Flag                | Meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `--categories <csv>`| restrict to categories, e.g. `--categories general,news`       |
| `--engines <csv>`   | restrict to engines, e.g. `--engines wikipedia,arxiv`          |
| `--language <code>` | e.g. `--language en`, `--language de`                          |
| `--time-range <x>`  | `day` \| `month` \| `year` (e.g. `day` for news from the last 24h) |
| `--safesearch <n>`  | `0` off, `1` moderate, `2` strict                              |
| `--page <n>`        | result page number                                             |
| `--session <id>`    | show a saved session instead of searching (no query allowed)   |
| `--use-ai`          | answer with the AI loop instead of listing results             |
| `--debug`           | verbose logging to stderr (never pollutes stdout/JSON)         |
| `--doctor`          | validate setup (takes no query, no other flags except `--json`)|
| `--json`            | full structured output (default is readable markdown)          |
| `--help`            | show help                                                      |

Exit codes: `0` success (even with zero results), `1` runtime error,
`2` usage error (e.g. query combined with `--session`).

### Search

```sh
node dist/surfaces/cli/cli.js "what is kubernetes"
```

Output is readable markdown showing the top 10 hits (the full result set is
always saved — see [sessions](#sessions)):

```markdown
**Session:** cc6a54d5-what-is-kubernetes
## Search results for "what is kubernetes" (27)
1. [Overview - Kubernetes](https://kubernetes.io/docs/concepts/overview/)
   Kubernetes is a portable, extensible, open source platform for managing containerized workloads and services ...
   *Engines: google cse, braveapi, exaapi · Category: general*
2. [What is Kubernetes? - Red Hat](https://www.redhat.com/en/topics/containers/what-is-kubernetes)
   The core concepts of Kubernetes center around clusters, nodes, and pods working together ...
   *Engines: google cse, braveapi, exaapi · Category: general*
3. [Kubernetes - Wikipedia](https://en.wikipedia.org/wiki/Kubernetes)
   Kubernetes, also known as K8s, is an open-source container orchestration system for automating software deployment, scaling, and management. ...
   *Engines: google cse, braveapi, exaapi · Category: general*
```

Refine with filters — all flags combine freely:

```sh
node dist/surfaces/cli/cli.js "fusion breakthrough" --categories news --time-range day --language en
node dist/surfaces/cli/cli.js "kubernetes ingress" --engines stackoverflow,github --page 2
```

> A query and `--session` are mutually exclusive. `--doctor` takes neither.

### JSON output

Add `--json` to any search for the full structured response — every result
with `title`, `url`, `snippet`, `publishedDate`, `score`, `engines`,
`category`, plus `suggestions`, `answers`, `corrections`, `infoboxes`, and
`unresponsiveEngines`:

```sh
node dist/surfaces/cli/cli.js "what is kubernetes" --json
```

```json
{
  "query": "what is kubernetes",
  "sessionId": "5416a500-what-is-kubernetes",
  "results": [
    {
      "title": "Overview - Kubernetes",
      "url": "https://kubernetes.io/docs/concepts/overview/",
      "snippet": "Kubernetes is a portable, extensible, open source platform for managing containerized workloads and services ...",
      "publishedDate": "2026-05-30T00:00:00+00:00",
      "score": 9,
      "engines": ["google cse", "braveapi", "exaapi"],
      "category": "general"
    },
    {
      "title": "Kubernetes",
      "url": "https://kubernetes.io/",
      "snippet": "Kubernetes, also known as K8s, is an open source system for automating deployment, scaling, and management of containerized applications. ...",
      "publishedDate": null,
      "score": 2.7,
      "engines": ["google cse", "braveapi", "exaapi"],
      "category": "general"
    }
  ],
  "suggestions": [],
  "answers": [],
  "corrections": [],
  "infoboxes": [],
  "unresponsiveEngines": [
    ["brave", "Suspended: too many requests"],
    ["duckduckgo", "CAPTCHA"]
  ]
}
```

> `unresponsiveEngines` are normal: some backends fail non-fatally on any
> given search. They print as `warning:` lines on stderr and never pollute
> stdout, so `--json` stays machine-readable.

### Sessions

Every search persists an immutable session on disk and prints its id in the
`**Session:**` line. Re-read it any time — from any surface (CLI, MCP, pi):

```sh
node dist/surfaces/cli/cli.js --session cc6a54d5-what-is-kubernetes
node dist/surfaces/cli/cli.js --session cc6a54d5-what-is-kubernetes --json
```

Sessions live under `$XDG_DATA_HOME/web-search/sessions/` (fallback
`~/.local/share/web-search/sessions/`) in folders named
`<8 hex>-<query slug>`, e.g. `cc6a54d5-what-is-kubernetes`.

### AI answers

`--use-ai` runs a plan → search → summarize loop: the planner picks
categories/engines from your instance's live config, searches and saves the
session as usual, then answers your question with footnote citations.

Setup (needs an OpenAI-compatible endpoint in addition to SearXNG):

```sh
export OPENAI_BASE_URL=https://litellm.void.cold.at/v1
export OPENAI_MODEL=deepseek-v4-flash
export OPENAI_API_KEY=<key>   # env wins; or openai.apiKey in the XDG config file (mode 0600)
node dist/surfaces/cli/cli.js "latest pi 5 news" --use-ai
```

```
**Session:** 9be21cc4-latest-pi-5-news

The Raspberry Pi 5 ... [^1] ... [^2]

Sources
[^1]: [Title one](https://example.com/one)
[^2]: [Title two](https://example.com/two)
```

Explicit flags always override the AI plan, e.g.
`--use-ai --language de --engines wikipedia` forces those choices.

### Debugging

`--debug` (or `WEB_SEARCH_DEBUG=1`) prints verbose diagnostics — request URLs
and timing, session persistence, and with `--use-ai` the plan decision, tool
calls, and model-call counts. It always goes to stderr, so piping stdout to
`jq` keeps working.

## Configuration

Highest precedence first:

1. Environment variables / CLI flags (`SEARXNG_URL`, `SEARXNG_TIMEOUT_MS`, `OPENAI_*`)
2. XDG config file `$XDG_CONFIG_HOME/web-search/config.json`
   (fallback `~/.config/web-search/config.json`)
3. Built-in defaults

`$PWD/.env` (gitignored, copy from `.env.example`) is loaded by the CLI/MCP
entrypoints before startup; the core itself never loads dotenv.

| Variable             | Required       | Default   | Purpose                                             |
| -------------------- | -------------- | --------- | --------------------------------------------------- |
| `SEARXNG_URL`        | yes            | —         | SearXNG instance base URL; fails fast without it    |
| `SEARXNG_TIMEOUT_MS` | no             | `10000`   | per-request timeout in ms                           |
| `WEB_SEARCH_DEBUG`   | no             | `0`       | verbose stderr logging; `1` to enable               |
| `OPENAI_BASE_URL`    | for `--use-ai` | —         | OpenAI-compatible endpoint                          |
| `OPENAI_MODEL`       | for `--use-ai` | —         | model name (e.g. `deepseek-v4-flash`)               |
| `OPENAI_API_KEY`     | for `--use-ai` | —         | key; env wins, `openai.apiKey` in the XDG config file is the fallback (mode 0600, single line) |
| `PORT`               | no             | `3000`    | MCP `--http` port when no port arg is given         |

XDG config file example:

```json
{
  "searxngUrl": "https://search.example.com",
  "timeoutMs": 10000,
  "storeDir": "/custom/path/to/sessions",
  "debug": false,
  "openai": {
    "baseUrl": "https://litellm.void.cold.at/v1",
    "model": "deepseek-v4-flash",
    "apiKey": "sk-..."
  }
}
```

Any standard SearXNG instance works — no instance-side setup needed. The core
uses the JSON API plus `/config` (the `--use-ai` planner constrains its
category/engine picks to what `/config` actually offers).

## Agent surfaces (MCP + pi)

All surfaces share the core and the session store, so sessions are
interchangeable. Pick whichever your harness speaks.

**1. MCP via stdio** (Claude Code, opencode, pi):

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/abs/path/web-search-mcp/dist/surfaces/mcp/mcp.js"],
      "env": {
        "SEARXNG_URL": "https://search.example.com",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

**2. MCP via streamable HTTP** (shared server for multiple agents):

```sh
node dist/surfaces/mcp/mcp.js --http 3000   # or PORT=3000 node dist/surfaces/mcp/mcp.js --http
# endpoint: POST/GET/DELETE http://localhost:3000/mcp
```

```json
{
  "mcpServers": {
    "web-search": { "type": "streamable-http", "url": "http://localhost:3000/mcp" }
  }
}
```

**3. pi extension** (`package.json` already declares `./extensions` via the
`"pi"` key):

```sh
pi install /abs/path/web-search-mcp   # then use the search tool
```

Tool contract (`search` — the only tool): required `query: string`; optional
`categories: string[]`, `engines: string[]` (default: all available engines),
`language: string`, `timeRange: day|month|year`, `safeSearch: 0|1|2`,
`pageNo: number`, `maxResults: number` (default 10, max 50). Returns lean
markdown: a `Session:` id line, then `title` / `url` / `snippet` / `engine` /
`category` per result. Agent guidance:

- `maxResults` only trims the rendered summary — the full result set stays in
  the persisted session on disk.
- Re-read full detail via the CLI (`--session <id>`) or the session store;
  there is no `search_details` MCP tool yet (deferred until the MCP server is
  in active use).
- `unresponsiveEngines` are data, not errors — some backends failed
  non-fatally.
- For `--use-ai` behavior from an agent, run the CLI rather than reimplementing
  the loop; explicit flags always override the AI plan.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build commands, architecture, the
`--use-ai` / `--doctor` internals, and contributor pointers.
