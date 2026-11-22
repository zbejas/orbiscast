# Build stage
FROM node:22-trixie-slim AS builder

# Build tools are needed to compile the native dependencies
# (sharp, node-av, node-datachannel, zeromq, better-sqlite3).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.json drizzle.config.ts ./
COPY web/package.json ./web/package.json
RUN npm ci

COPY src ./src
COPY web ./web
COPY drizzle ./drizzle
COPY assets ./assets
RUN npm run build && npm prune --omit=dev

# Runtime stage
# A recent glibc is required: node-av ships a glibc-only native binding and
# node-datachannel needs GLIBC_2.38+. Debian trixie provides glibc 2.41.
FROM node:22-trixie-slim

# FFmpeg with libzmq (for the azmq audio filter used by discord-video-stream)
# and libx264 (for the generated media placeholder clip).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/assets ./assets

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Metadata labels
LABEL maintainer="Zbejas <info@zbejas.io>"
LABEL description="A Discord IPTV and media streaming bot with a WebUI."
LABEL org.opencontainers.image.source="https://github.com/zbejas/orbiscast"
LABEL org.opencontainers.image.documentation="https://github.com/zbejas/orbiscast/blob/master/README.md"
LABEL org.opencontainers.image.authors="Zbejas"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.title="Orbiscast"

CMD ["node", "dist/index.js"]
