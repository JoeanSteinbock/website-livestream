FROM node:18-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    xvfb \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create app directory and user
RUN mkdir -p /home/node/app && chown -R node:node /home/node/app
WORKDIR /home/node/app

# Switch to non-root user
USER node

# Copy package files with correct ownership
COPY --chown=node:node package*.json ./

# Install dependencies
RUN npm install

# Copy source code with correct ownership
COPY --chown=node:node . .

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create entrypoint script
RUN echo '#!/bin/sh\nxvfb-run --server-args="-screen 0 1280x720x24" node src/index.js "$@"' > entrypoint.sh \
    && chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]