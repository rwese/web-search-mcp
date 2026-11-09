# syntax=docker/dockerfile:1.7
FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --omit=optional --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production \
    XDG_DATA_HOME=/data \
    WZE_WEBSEARCH_NO_UPDATE_CHECK=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE ./
RUN mkdir -p /data/wze-websearch/sessions && chown -R node:node /data
USER 1000:1000
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "const r = await fetch('http://127.0.0.1:3000/mcp'); process.exit(r.status === 404 ? 0 : 1)"]
ENTRYPOINT ["node", "dist/surfaces/mcp/mcp.js"]
CMD ["--http", "3000"]
