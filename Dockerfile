FROM node:22-alpine

LABEL org.opencontainers.image.description "A tool to livestream any website to YouTube. Perfect for creating 24/7 live streams of web dashboards, charts, or any web content."

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

# Create necessary directories and set permissions
RUN mkdir -p /tmp/.X11-unix && \
    chmod 1777 /tmp/.X11-unix

# Create entrypoint script before switching user
RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true' >> /entrypoint.sh && \
    echo 'node src/index.js "$@"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

# Switch to non-root user
USER node

ENTRYPOINT ["/entrypoint.sh"]