FROM node:22-alpine AS runtime

LABEL maintainer="Zbejas <info@zbejas.io>"
LABEL description="A Discord IPTV streaming bot."
LABEL org.opencontainers.image.source="https://github.com/zbejas/orbiscast"
LABEL org.opencontainers.image.documentation="https://github.com/zbejas/orbiscast/blob/main/README.md"
LABEL org.opencontainers.image.authors="Zbejas"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.title="Orbiscast"

RUN apk update && \
    apk add --no-install-recommends ffmpeg python3 make g++ && \
    rm -rf /var/cache/apk/*

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

CMD ["npm", "run", "start:prod"]
