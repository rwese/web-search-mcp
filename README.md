# @rwese/wze-websearch

Web search for your terminal and AI agents, powered by your own
[SearXNG](https://docs.searxng.org/) instance.

## Highlights

- **CLI, MCP, and pi** — use the same search backend across your tools.
- **Reusable sessions** — every search is saved locally so you can revisit results.
- **Optional AI answers** — turn searches into answers with source citations using
  an OpenAI-compatible model.
- **Flexible output** — readable Markdown or structured JSON, with filters for
  engines, categories, language, and time range.

## Quickstart

You need **Node.js 20+** and a **SearXNG instance with its JSON API enabled**.
Install a signed release (no sudo), then replace the example URL with your
instance:

```sh
curl -fsSL https://git.void.cold.at/ai-factory/wze-websearch/raw/branch/main/scripts/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
export SEARXNG_URL=https://search.example.com

wze-websearch --doctor
wze-websearch "what is kubernetes"
```

This project does **not** publish to npm. Releases and the in-binary updater
are served from Forgejo. An LLM is optional; with only SearXNG configured,
searches return a list of results.

## CLI

```sh
# Filter a search
wze-websearch "fusion breakthrough" --categories news --time-range day --language en

# Get raw results as JSON
wze-websearch "kubernetes ingress" --no-ai --json

# Revisit a saved search using the session ID printed in the output
wze-websearch --session <id>
wze-websearch --session <id> --page 2

# See all options
wze-websearch --help
```

The full result set is saved even when the displayed output is limited. Sessions
are shared by the CLI, MCP, and pi and stored in
`$XDG_DATA_HOME/wze-websearch/sessions/` (default: `~/.local/share/wze-websearch/sessions/`).

## Use with AI agents

### MCP

For clients that use an `mcpServers` configuration, add:

```json
{
  "mcpServers": {
    "wze-websearch": {
      "command": "wze-websearch-mcp",
      "env": {
        "SEARXNG_URL": "https://search.example.com"
      }
    }
  }
}
```

This exposes a `search` tool with query and filter options. For a shared
Streamable HTTP server, run `wze-websearch-mcp --http 3000` after installing the
package and setting `SEARXNG_URL`. The endpoint is `http://localhost:3000/mcp`.

### pi

The extension wrapper lives in `extensions/` and is loaded from a source
checkout of this repository; it is not published to npm. Set `SEARXNG_URL` in
pi's environment, then use the `search` tool.

## AI answers

Configure an OpenAI-compatible endpoint to get synthesized answers with source
citations from the CLI:

```sh
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=your-model-name
export OPENAI_API_KEY=your-api-key

wze-websearch "what changed in the latest Kubernetes release?" --use-ai
```

Once a model and API key are configured, new CLI searches use AI by default.
Pass `--no-ai` for raw results. Saved sessions stay raw unless you pass
`--use-ai`, for example `wze-websearch --session <id> --use-ai`.

## Updates

Install the signed release (Node.js 20+, no sudo):

```sh
curl -fsSL https://git.void.cold.at/ai-factory/wze-websearch/raw/branch/main/scripts/install.sh | sh
```

It installs versions under `${XDG_DATA_HOME:-~/.local/share}/wze-websearch/install`
and writes `wze-websearch` / `wze-websearch-mcp` wrappers to `~/.local/bin`.
Then:

```sh
wze-websearch update --check   # 0 = current, 10 = update available, 1 = error
wze-websearch update           # verify signature + checksum, probe, swap
wze-websearch update --rollback
```

Self-owned installs also check for a newer release in the background after a
CLI search or `--doctor`, and once at MCP startup — with or without a terminal,
so MCP and other headless hosts stay current. When a newer release exists the
background helper applies it (same signature, checksum, probe, and lock as
`update`); the running process keeps its old version until restart. Checks are
throttled to one per 24 h per install root, and only an applied update (or a
failed attempt) writes a line to stderr. Disable it with
`WZE_WEBSEARCH_NO_UPDATE_CHECK=1`.

Release archives and `SHA256SUMS` are published on the
[Forgejo releases page](https://git.void.cold.at/ai-factory/wze-websearch/releases).
`SHA256SUMS` is signed with the pinned release key; the updater verifies the
signature before the checksum and refuses to install an artifact from an
untrusted key. An existing npm install is never written by the updater; it is
told to reinstall from a signed release.

## Configuration and troubleshooting

`SEARXNG_URL` is the only required setting. The CLI and MCP server also load
`.env` from the current directory; see [.env.example](.env.example) for optional
settings. You can use `~/.config/wze-websearch/config.json` (or
`$XDG_CONFIG_HOME/wze-websearch/config.json`) for persistent configuration.
Precedence is **CLI flags > environment > config file > defaults**.

Generate a starter config (fill in `searxngUrl` before searching):

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/wze-websearch"
wze-websearch --default-config > "${XDG_CONFIG_HOME:-$HOME/.config}/wze-websearch/config.json"
```

The command prints default JSON to stdout and the expected config file path to
stderr. Optional AI fields start empty.

Run `wze-websearch --doctor` to check your setup, or add `--debug` to a search for
diagnostics on stderr.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build commands, architecture, and
contributor guidance.
