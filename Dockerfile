# Use the official Alpine base image
FROM alpine:3.21

# Add labels
LABEL maintainer="Zbejas <info@zbejas.io>"
LABEL description="A Discord IPTV streaming bot."
LABEL org.opencontainers.image.source="https://github.com/zbejas/orbiscast"
LABEL org.opencontainers.image.documentation="https://github.com/zbejas/orbiscast/blob/main/README.md"
LABEL org.opencontainers.image.authors="Zbejas"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.title="Orbiscast"

# Install dependencies
RUN apk update && \
    apk add --no-cache curl git unzip ffmpeg bash \
    # Add build tools for native dependencies
    build-base python3 make g++ linux-headers libc-dev \
    # Add ZeroMQ libraries if needed
    zeromq-dev libsodium-dev

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Add Bun to PATH
ENV PATH="/root/.bun/bin:$PATH"

# Set the working directory
WORKDIR /app

# Copy the project files into the container
COPY . .

# Install project dependencies
RUN bun install

# Command to run the application
CMD ["bun", "run", "start"]
