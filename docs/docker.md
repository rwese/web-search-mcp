# Deploy the MCP server with Docker

Requires Docker Engine with BuildKit and Docker Compose v2. Build from a
checkout of a release tag for reproducibility. No prebuilt registry image is
published; Compose builds the image locally.

## Compose

Create a `.env` file beside `compose.yaml` (do not commit it):

```dotenv
SEARXNG_URL=https://search.example.com
# Optional host port; the container always listens on 3000.
MCP_PORT=3000
```

The SearXNG instance must enable JSON responses. Its URL must be reachable from
inside the container: `localhost` means the container, not the Docker host.
For a host service on Docker Desktop, use `host.docker.internal` instead.
SearXNG is managed separately; this stack does not deploy it.

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f mcp
```

Connect a Streamable HTTP MCP client to `http://localhost:3000/mcp` (adjust for
`MCP_PORT`). The health check expects HTTP 404 from a sessionless GET `/mcp`;
it checks the HTTP listener, not SearXNG availability. A browser GET is not an
MCP initialization request.

**Security:** the server has no built-in authentication and allows CORS.
Compose publishes only on IPv4 loopback. Do not expose it directly to the
internet. For remote clients, use an authenticated TLS reverse proxy and
restrict network access. Do not share a deployment between untrusted users.

Sessions persist in the named `sessions` volume under
`/data/wze-websearch/sessions`. The process runs as UID/GID 1000, with a
read-only root filesystem and no Linux capabilities. Treat saved search data
as sensitive. Back up the volume as needed.

```sh
docker compose down       # keep saved sessions
docker compose up -d --build  # rebuild after checking out a newer release
# Destructive: remove saved sessions too
# docker compose down --volumes
```

Updates use an image rebuild and container recreation, not the self-updater.
Active MCP transport sessions are lost on restart; clients must reconnect.

## Image without Compose

```sh
docker build -t wze-websearch-mcp:local .
docker run -d --name wze-websearch-mcp --init \
  -p 127.0.0.1:3000:3000 \
  -e SEARXNG_URL=https://search.example.com \
  -v wze-websearch-sessions:/data \
  wze-websearch-mcp:local
```

The multi-stage image uses a digest-pinned Node.js base and the integrity-pinned
npm lockfile. Only compiled code and production dependencies enter the runtime
image. The build context allowlist excludes `.env`, credentials, local sessions,
and development artifacts. Optional deployment settings can be passed explicitly
as environment variables; Compose's `.env` file is used for interpolation, not
loaded wholesale into the container.
