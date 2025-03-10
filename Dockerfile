FROM node:22-alpine

# Install dependencies
RUN apk add --no-cache \
    chromium \
    ffmpeg \
    xvfb \
    ca-certificates

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create entrypoint script before switching user
RUN echo '#!/bin/sh\nxvfb-run --server-args="-screen 0 1280x720x24" node src/index.js "$@"' > /entrypoint.sh && \
    chmod +x /entrypoint.sh && \
    chown node:node /entrypoint.sh

# Switch to non-root user
USER node

ENTRYPOINT ["/entrypoint.sh"]