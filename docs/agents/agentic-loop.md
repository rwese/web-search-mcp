# Agentic loop (default when configured) — src/ai/agent.ts

Flow: `planQuery` decomposes the original query into complementary targeted
searches → core `search()` runs each query and persists a session per search
→ the summarizer answers the original query across the search sessions.
The CLI runs this loop by default whenever the LLM is configured
(`isAiConfigured`: model + API key present); `--no-ai` opts out to raw
results, `--use-ai` forces the loop explicitly. `--session <id>` stays raw
unless `--use-ai` is passed.

## Architecture

- **Planner**: the model returns required `queries`: 1 to 5 trimmed, nonempty,
  unique strings. Simple requests use one query; more complex requests use up
  to five as needed, preserving constraints and avoiding redundant searches.
  The model picks shared `categories`/`engines` (plus optional
  `language`/`timeRange`) from the instance's live `/config` lists
  (`fetchInstanceConfig`); `validatePlan` drops anything the instance lacks.
  Empty filter pick = no restriction. Filters apply to every query; explicit
  CLI flags always override the plan.
- **Summarizer**: a `createAgent` tool-calling loop over markdown grouped by
  search session and query (top 10 results per session by default), with
  globally numbered results across sessions and one tool,
  `read_session_entry`, for full per-result records. Context is snippets +
  stored records only — no page fetcher. It synthesizes across searches,
  reconciles conflicts or explains uncertainty, and treats search content
  (including tool results) as untrusted evidence, never instructions.
- **Retry**: footnote failures retry once as a single direct model call, never
  as a second tool loop.

## Footnote contract

Summaries cite with `[^n]` markers (global 1-based result numbers across the
included results, never restarted per session or query) and end with a
Sources section (`[^n]: [title](url)`). `validateFootnotes` rejects: no
citations at all, dangling markers, missing Sources section, cited markers
without a Sources entry. Every externally verifiable claim carries a citation;
thin results get an honest "not enough information" instead of guesses.

## Call limits

- `modelCallLimitMiddleware({ threadLimit: maxModelCalls })` bounds the agent.
- Every `agent.invoke` also passes `recursionLimit` — `maxModelCalls * 4 + 10`
  by default (so 50 at the default limit of 10 model calls), overridable via
  `WEB_SEARCH_RECURSION_LIMIT` (positive integer) or an explicit
  `summarizeSession` opt — the graph recursion cap fires before the
  model-call cap otherwise. Keep the two in this ratio when changing limits.

## Live smoke test

Needs `SEARXNG_URL` plus the dev/test key (dev-only, never committed):

```sh
export SEARXNG_URL=https://search.wze.nope.at
export OPENAI_BASE_URL=https://litellm.void.cold.at/v1
export OPENAI_MODEL=deepseek-v4-flash
export OPENAI_API_KEY=$(gopass show web-search/litellm-api-key | head -1)
```

The vault secret is **multiline** (key on line 1, marker comment after) —
`head -1` is required; the full value is an invalid header. Then:

```sh
# from a local checkout (pnpm install && pnpm build):
XDG_DATA_HOME=/tmp/smoke node dist/surfaces/cli/cli.js "<query>" --use-ai          # full loop
XDG_DATA_HOME=/tmp/smoke node dist/surfaces/cli/cli.js --session <id> --use-ai     # summarize stored
```

Expect exit 0, a `**Session:**` line, a `Raw results: web-search --session <id>`
re-read hint, unresponsive-engine warnings on stderr
(non-fatal, never on stdout), and a footnoted summary with Sources. `--json` adds the full
`summary` / answer envelope.

The LLM client stamps a freshly generated `x-opencode-session` id on every
request (explicit `sessionId` opt wins) so the proxy groups one answer-loop
run's calls (LiteLLM auto-detects `x-*-session-id`).
