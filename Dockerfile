FROM node:22-alpine

LABEL org.opencontainers.image.description="A tool to livestream any website to YouTube. Perfect for creating 24/7 live streams of web dashboards, charts, or any web content."

# Install dependencies
RUN apk add --no-cache \
    chromium \
    ffmpeg \
    xvfb \
    pulseaudio \
    pulseaudio-utils \
    xwd \
    imagemagick \
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
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    DISPLAY=:99 \
    PULSE_SERVER=unix:/tmp/pulse/native \
    PULSE_COOKIE=/tmp/pulse/cookie

# Create necessary directories and set permissions
RUN mkdir -p /tmp/.X11-unix && \
    chmod 1777 /tmp/.X11-unix && \
    mkdir -p /tmp/pulse && \
    chmod 777 /tmp/pulse && \
    mkdir -p ~/.config/pulse && \
    chown -R node:node ~/.config/pulse

# Configure PulseAudio
COPY <<EOF /etc/pulse/client.conf
default-server = unix:/tmp/pulse/native
autospawn = no
daemon-binary = /bin/true
enable-shm = false
EOF

COPY <<EOF /etc/pulse/daemon.conf
exit-idle-time = -1
flat-volumes = yes
EOF

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD pgrep node || exit 1    

# Create entrypoint script before switching user
RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true' >> /entrypoint.sh && \
    echo 'pulseaudio --start --log-target=syslog --system --disallow-exit' >> /entrypoint.sh && \
    echo 'sleep 2' >> /entrypoint.sh && \
    echo 'pacmd load-module module-null-sink sink_name=DummyOutput' >> /entrypoint.sh && \
    echo 'pacmd set-default-sink DummyOutput' >> /entrypoint.sh && \
    echo 'node src/index.js "$@"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

# Switch to non-root user
USER node

ENTRYPOINT ["/entrypoint.sh"]