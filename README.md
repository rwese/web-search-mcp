# @rwese/web-search-mcp

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
Replace the example URL with your instance:

```sh
npm install -g @rwese/web-search-mcp
export SEARXNG_URL=https://search.example.com

web-search --doctor
web-search "what is kubernetes"
```

Or try it without a global install:

```sh
SEARXNG_URL=https://search.example.com npx -y -p @rwese/web-search-mcp web-search "what is kubernetes"
```

An LLM is optional. With only SearXNG configured, searches return a list of results.

## CLI

```sh
# Filter a search
web-search "fusion breakthrough" --categories news --time-range day --language en

# Get raw results as JSON
web-search "kubernetes ingress" --no-ai --json

# Revisit a saved search using the session ID printed in the output
web-search --session <id>
web-search --session <id> --page 2

# See all options
web-search --help
```

The full result set is saved even when the displayed output is limited. Sessions
are shared by the CLI, MCP, and pi and stored in
`$XDG_DATA_HOME/web-search/sessions/` (default: `~/.local/share/web-search/sessions/`).

## Use with AI agents

### MCP

For clients that use an `mcpServers` configuration, add:

```json
{
  "mcpServers": {
    "web-search": {
      "command": "npx",
      "args": ["-y", "-p", "@rwese/web-search-mcp", "web-search-mcp"],
      "env": {
        "SEARXNG_URL": "https://search.example.com"
      }
    }
  }
}
```

This exposes a `search` tool with query and filter options. For a shared
Streamable HTTP server, run `web-search-mcp --http 3000` after installing the
package and setting `SEARXNG_URL`. The endpoint is `http://localhost:3000/mcp`.

### pi

```sh
pi install npm:@rwese/web-search-mcp
```

Set `SEARXNG_URL` in pi's environment, then use the `search` tool.

## AI answers

Configure an OpenAI-compatible endpoint to get synthesized answers with source
citations from the CLI:

```sh
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=your-model-name
export OPENAI_API_KEY=your-api-key

web-search "what changed in the latest Kubernetes release?" --use-ai
```

Once a model and API key are configured, new CLI searches use AI by default.
Pass `--no-ai` for raw results. Saved sessions stay raw unless you pass
`--use-ai`, for example `web-search --session <id> --use-ai`.

## Configuration and troubleshooting

`SEARXNG_URL` is the only required setting. The CLI and MCP server also load
`.env` from the current directory; see [.env.example](.env.example) for optional
settings. You can use `~/.config/web-search/config.json` (or
`$XDG_CONFIG_HOME/web-search/config.json`) for persistent configuration.
Precedence is **CLI flags > environment > config file > defaults**.

Generate a starter config (fill in `searxngUrl` before searching):

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/web-search"
web-search --default-config > "${XDG_CONFIG_HOME:-$HOME/.config}/web-search/config.json"
```

The command prints default JSON to stdout and the expected config file path to
stderr. Optional AI fields start empty.

Run `web-search --doctor` to check your setup, or add `--debug` to a search for
diagnostics on stderr.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build commands, architecture, and
contributor guidance.
