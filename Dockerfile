# Use the official Bun image as the base (Debian-based for better compatibility)
FROM oven/bun:1.1-debian AS base

# Add labels
LABEL maintainer="Zbejas <info@zbejas.io>"
LABEL description="A Discord IPTV streaming bot."
LABEL org.opencontainers.image.source="https://github.com/zbejas/orbiscast"
LABEL org.opencontainers.image.documentation="https://github.com/zbejas/orbiscast/blob/main/README.md"
LABEL org.opencontainers.image.authors="Zbejas"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.title="Orbiscast"

# Install system dependencies
RUN apt-get update && \
    apt-get install -y curl git unzip ffmpeg bash build-essential python3 && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install dependencies
FROM base AS install
COPY . /app/
WORKDIR /app
RUN bun install

# Start the application
CMD ["bun", "run", "start"]
