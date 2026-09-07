# Agentic loop (`--use-ai`) — src/agent.ts

Flow: `planQuery` steers the search → core `search()` runs and persists the
session → `summarizeSession` answers the original query from the session.

## Architecture

- **Planner**: the model picks `categories`/`engines` (plus optional
  `language`/`timeRange`) from the instance's live `/config` lists
  (`fetchInstanceConfig`); `validatePlan` drops anything the instance lacks.
  Empty pick = no restriction. Explicit CLI flags always override the plan.
- **Summarizer**: a `createAgent` tool-calling loop over a numbered session
  overview (`buildSessionOverview`, top 10 by default) with one tool,
  `read_session_entry`, for full per-result records. Context is snippets +
  stored records only — no page fetcher.
- **Retry**: footnote failures retry once as a single direct model call, never
  as a second tool loop.

## Footnote contract

Summaries cite with `[^n]` markers (1-based result numbers) and end with a
Sources section (`[^n]: [title](url)`). `validateFootnotes` rejects: no
citations at all, dangling markers, missing Sources section, cited markers
without a Sources entry. Every externally verifiable claim carries a citation;
thin results get an honest "not enough information" instead of guesses.

## Call limits

- `modelCallLimitMiddleware({ threadLimit: maxModelCalls })` bounds the agent.
- Every `agent.invoke` also passes `recursionLimit: maxModelCalls * 3 + 10` —
  the graph recursion cap fires before the model-call cap otherwise. Keep the
  two in this ratio when changing limits.

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
XDG_DATA_HOME=/tmp/smoke node dist/cli.js "<query>" --use-ai          # full loop
XDG_DATA_HOME=/tmp/smoke node dist/cli.js --session <id> --use-ai     # summarize stored
```

Expect exit 0, a `**Session:**` line, unresponsive-engine warnings on stderr
(non-fatal, never on stdout), and a footnoted summary with Sources. `--json` adds the full
`summary` / answer envelope.

The LLM client stamps a freshly generated `x-opencode-session` id on every
request (explicit `sessionId` opt wins) so the proxy groups one answer-loop
run's calls (LiteLLM auto-detects `x-*-session-id`).
