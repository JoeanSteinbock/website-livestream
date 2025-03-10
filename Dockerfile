FROM node:18-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create entrypoint script
RUN echo '#!/bin/sh\nxvfb-run --server-args="-screen 0 1280x720x24" node src/index.js "$@"' > /entrypoint.sh \
    && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]