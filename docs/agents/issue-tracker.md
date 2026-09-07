# Issue tracker ops — git.void.cold.at/ai-factory/web-search-mcp

Single source of truth: the issue body + state. Frontier = open + all blockers
closed + unassigned. Claim by assigning to `ai-factory`; resolve by posting a
resolution comment, then closing.

## Auth

- Token: `gopass show forgejo/ai-factory-token`, header
  `Authorization: token <TOKEN>`, base `https://git.void.cold.at/api/v1`.
- The `fj` CLI returns `410 Gone` on this instance — use the curl API.

## Recipes

- Create: `POST /repos/ai-factory/web-search-mcp/issues` with
  `{"title", "body", "labels": [<int ids>]}` — labels are **IDs, not names**
  (names fail with a Go unmarshal error).
- Label IDs: `wayfinder:map`=16, `wayfinder:research`=17,
  `wayfinder:prototype`=18, `wayfinder:grilling`=19, `wayfinder:task`=20.
- Blocking edge: `POST /repos/ai-factory/web-search-mcp/issues/{child}/dependencies`
  with `{"index": <blocker-number>, "owner": "ai-factory", "repo": "web-search-mcp"}`
  → 201. Read back via `GET .../issues/{n}/dependencies` (the issue object's
  `blocked_by` is not populated).
- Comment: `POST .../issues/{n}/comments` with `{"body": "..."}` — wrap with
  `python3 -c "import json; print(json.dumps({'body': open(...).read()}))"`,
  a bare JSON string fails to unmarshal.
- Claim: `PATCH .../issues/{n}` with `{"assignees": ["ai-factory"]}`.
- Close: `PATCH .../issues/{n}` with `{"state": "closed"}`.
- Edit body: `PATCH .../issues/{n}` with `{"body": "..."}`.

## Conventions

- Wayfinding: map issue labelled `wayfinder:map` holds Destination, Notes,
  Decisions-so-far (one gist line per closed ticket), fog, and out-of-scope;
  child tickets carry one `wayfinder:<type>` label and resolve one decision.
- During wayfinder execution: one ticket per session; post the resolution as a
  comment, close, append the gist to the map.
