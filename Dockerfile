FROM oven/bun:1 AS runtime

# Add labels
LABEL maintainer="Zbejas <info@zbejas.io>"
LABEL description="A Discord IPTV streaming bot."
LABEL org.opencontainers.image.source="https://github.com/zbejas/orbiscast"
LABEL org.opencontainers.image.documentation="https://github.com/zbejas/orbiscast/blob/main/README.md"
LABEL org.opencontainers.image.authors="Zbejas"
LABEL org.opencontainers.image.licenses="GPL-3.0"
LABEL org.opencontainers.image.title="Orbiscast"

# Install system dependencies (ffmpeg only)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy the project files
COPY . .

# Install dependencies with Bun
RUN bun install

# Command to run the application
CMD ["bun", "run", "start"]
