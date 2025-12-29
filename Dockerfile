# Build stage
FROM node:lts-alpine3.23 AS builder

RUN apk update && \
    apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage
FROM node:lts-alpine3.23 AS runtime
# Had to switch from bun to node due to zeromq not being supported in bun yet.

LABEL maintainer="Zbejas <info@zbejas.io>"
LABEL description="A Discord IPTV streaming bot."
LABEL org.opencontainers.image.source="https://github.com/zbejas/orbiscast"
LABEL org.opencontainers.image.documentation="https://github.com/zbejas/orbiscast/blob/main/README.md"
LABEL org.opencontainers.image.authors="Zbejas"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.title="Orbiscast"

RUN apk update && \
    apk add --no-cache ffmpeg python3 make g++

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && \
    apk del python3 make g++

COPY --from=builder /app/dist ./dist

CMD ["npm", "run", "start:prod"]
