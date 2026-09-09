# CONTEXT

Glossary for the `@rwese/web-search-mcp` package. Canonical terms, sharpened
during the wayfinder map decisions (issues #5–#10 on the repo's issue tracker).

## Terms

- **Search** — one call to the shared core's `search(query, options)`. A search
  always queries the configured SearXNG instance and always persists a **search
  session** on disk. Never returns partial success as an error.
- **Search session** — the on-disk record of one **search**, identified by a
  `sessionId`. Stored under the configured **store root** in a directory named
  `<sessionId>` containing a `session.json` envelope plus one JSON file per
  **result**. A session is immutable once written; it is never updated in place.
- **Session id** — `<8 hex>-<query slug>`, e.g. `3f9a2c7e-what-is-kubernetes`.
  The human-readable slug makes sessions browsable without opening them.
- **Store root** — the base directory for **search sessions**, resolved from
  config (default `$XDG_DATA_HOME/web-search/sessions/`). CLI, MCP server and
  pi wrapper share it, so a session written by one surface can be read by another.
- **Result** — one normalized search hit, the core's `SearchResult`: `title`,
  `url`, `snippet` (SearXNG's `content` excerpt), `publishedDate`, `score`,
  `engines`, `category`. Everything an agent or human needs to decide whether to
  open the URL.
- **Snippet** — the result excerpt shown to humans and agents. Intentionally not
  the full page: full detail lives in the session on disk, reachable via
  `readSession` / `--session`.
- **Unresponsive engine** — a SearXNG backend that failed non-fatally during a
  search. Surfaced as data (`unresponsiveEngines`), never as an error.
- **Search options** — the core's `SearchOptions` (camelCase). The CLI passes
  everything; MCP and the pi wrapper expose an opinionated subset of the same
  options, so surfaces stay consistent with each other and with the core.
- **Core** — the shared module (`src/index.ts`) all surfaces consume: `search`,
  `renderMarkdown`, `readSession`, config resolution, typed errors. The deep
  seam of the package; surfaces are thin.
- **Surface** — one of the three consumers of the **core**: the CLI, the MCP
  server, or the pi extension wrapper. A surface formats/transports core output;
  it does not reimplement search logic.
- **Configuration** — resolved by `loadConfig()` from (highest precedence)
  environment variables, the XDG config file
  (`$XDG_CONFIG_HOME/web-search/config.json`), and defaults. `OPENAI_API_KEY`
  wins when set; `openai.apiKey` in the config file is the fallback (keep the
  file mode 0600).
- **Search plan** — the decomposition of a user's request into focused,
  complementary search queries, with shared category, engine, language, and
  time-range restrictions. An empty category or engine selection means no restriction.
- **AI answer** — the result of the agentic loop (`answerQuery`): the search
  plan, the search sessions and their queries, and a footnote-cited synthesis of the
  original query. The CLI default for a query when the LLM is configured
  (model + API key); `--no-ai` opts out to raw results, `--use-ai` forces
  the loop. AI markdown carries the session id plus a
  `web-search --session <id>` re-read hint so the raw results stay
  reviewable.
- **Session overview** — a top-result listing labeled with its search session
  and search query. Result numbers are unique across the sessions in an AI answer.
- **Footnote** — a `[^n]` citation binding a claim to a globally numbered result
  across the answer's search sessions, backed by an entry in the Sources section. Every
  externally verifiable claim carries one; see `docs/agents/agentic-loop.md`.
- **Debug logging** — verbose stderr-only diagnostics (search request URLs +
  timing, session persistence, and with `--use-ai` the planner decision,
  tool calls, and model-call counts). Enabled by `SearchOptions.debug`, a
  `DebugLogger`, `Config.debug`, `WEB_SEARCH_DEBUG`, a `DEBUG` list containing
  `web-search`, or the CLI `--debug` flag. Never touches stdout, so `--json`
  output stays machine-readable.

## Decisions

- Every **search** persists a **session** — storage is wired into the core from
  the start, not an opt-in (issue #5).
- Markdown output renders human-usable fields only (`title`, `url`, `snippet`,
  `engine`, `category`); `--json` carries the full structured result set (issue #5, #8).
- The pi wrapper surfaces the `sessionId` in its collapsed render so the user
  can open full details later (issue #10).
- MCP's first build-out ships a single `search` tool; a `search_details`
  full-record tool is deferred until the MCP server is in use (issue #9).
- `--doctor` validates the setup (config, store writability, SearXNG `/config`,
  enabled engines, probe search, LLM reachability); the probe search is
  side-effect-free (no session persisted) and the LLM check reads `/models`
  only (no chat call, no token cost).
- `--use-ai` runs a LangChain plan → search → summarize loop; explicit CLI
  flags always override the AI plan; footnote failures retry once as a direct
  call, never a second tool loop.
