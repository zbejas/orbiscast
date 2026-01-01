FROM node:lts-alpine3.23

LABEL org.opencontainers.image.source="https://github.com/zbejas/orbiscast"
LABEL org.opencontainers.image.authors="Zbejas"
LABEL org.opencontainers.image.licenses="GPL-3.0"

RUN apk add --no-cache ffmpeg python3 make g++

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install && \
    npm run build && \
    npm prune --omit=dev && \
    apk del python3 make g++

CMD ["npm", "run", "start:prod"]
