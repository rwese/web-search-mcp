# Issue tracker ops — git.void.cold.at/ai-factory/wze-websearch

Single source of truth: the issue body + state. Frontier = open + all blockers
closed + unassigned.

## Resolving an issue

For a bug or task issue (not a wayfinder ticket), the loop that resolves it is:

1. Read the issue body + comments; it is the spec.
2. Claim it: `assignees: ["ai-factory-bot"]` (see the recipe — the token's own
   user, **never** the `ai-factory` org).
3. Find the root cause in the code before editing; the issue's diagnosis may be
   incomplete. Fix, and cover it with tests that would have caught it.
4. `pnpm validate` (same gates as a release).
5. Commit on `main` (signed by config) with a conventional subject naming the
   area, a body explaining cause → fix, and `Closes #<n>`; then push.
6. Post the resolution comment (shape below) **before** closing, then close.
   `PATCH {"state": "closed"}`.

Resolution comment shape — reviewers read this instead of the diff:

```
Fixed in <short-sha> on `main`.

## Changes
1. **<what changed>** (`<file>`). <why, with concrete numbers/behaviour>

## Verification
- `pnpm validate` — <result>
- New/changed tests: <files, what each pins>
- Live check: <command run and the observed output, including the old bad
  output it replaces>
```

Claim, comment, and close are bookkeeping, not a lock: if the claim PATCH fails,
keep going and fix the recipe instead of dropping the issue.

## Auth

- Token: `gopass show forgejo/ai-factory-token`, header
  `Authorization: token <TOKEN>`, base `https://git.void.cold.at/api/v1`.
- The `fj` CLI returns `410 Gone` on this instance — use the curl API.

## Recipes

- Create: `POST /repos/ai-factory/wze-websearch/issues` with
  `{"title", "body", "labels": [<int ids>]}` — labels are **IDs, not names**
  (names fail with a Go unmarshal error).
- Label IDs: `wayfinder:map`=16, `wayfinder:research`=17,
  `wayfinder:prototype`=18, `wayfinder:grilling`=19, `wayfinder:task`=20.
- Blocking edge: `POST /repos/ai-factory/wze-websearch/issues/{child}/dependencies`
  with `{"index": <blocker-number>, "owner": "ai-factory", "repo": "wze-websearch"}`
  → 201. Read back via `GET .../issues/{n}/dependencies` (the issue object's
  `blocked_by` is not populated).
- Comment: `POST .../issues/{n}/comments` with `{"body": "..."}` — wrap with
  `python3 -c "import json; print(json.dumps({'body': open(...).read()}))"`,
  a bare JSON string fails to unmarshal.
- Claim/unclaim: `PATCH .../issues/{n}` with
  `{"assignees": ["ai-factory-bot"]}` / `{"assignees": []}`. Assignees are
  **users**: the org login `ai-factory` is not assignable and returns HTTP 500
  (`GET /user` with the token shows the identity, `ai-factory-bot`).
- Close: `PATCH .../issues/{n}` with `{"state": "closed"}`.
- Edit body: `PATCH .../issues/{n}` with `{"body": "..."}`.

## Conventions

- Wayfinding: map issue labelled `wayfinder:map` holds Destination, Notes,
  Decisions-so-far (one gist line per closed ticket), fog, and out-of-scope;
  child tickets carry one `wayfinder:<type>` label and resolve one decision.
- During wayfinder execution: one ticket per session; post the resolution as a
  comment, close, append the gist to the map.
