# Website Livestreamer

🎥 A Docker-based tool that captures any website and streams it directly to YouTube Live. Perfect for creating 24/7 live streams of web dashboards, charts, or any web content.

## Key Features

- 🐳 Fully Dockerized - easy to deploy and run
- 🔄 Auto-retry mechanism for stable streaming
- 🖥️ Cross-platform support (Linux & macOS)
- 🎯 Configurable resolution and stream settings
- 🛠️ Built with Puppeteer and FFmpeg

## Live Example

Check out our 24/7 cryptocurrency price tracking channel: [CryptoTick Live](https://www.youtube.com/@CryptoTickLive) - streaming real-time crypto charts and market data.

## Quick Start

```bash
# Pull and run with Docker
docker run ghcr.io/your-username/website-livestream \
  <website-url> <youtube-stream-key>
```

[View on GitHub Container Registry](https://github.com/JoeanSteinbock/website-livestream/pkgs/container/website-livestream)

## Features

- Support for any accessible website
- Automatic retry mechanism
- Cross-platform support (Linux and macOS)
- Docker support

## Usage

### Using Docker (Recommended)

1. Build the image locally:
   ```bash
   docker build -t website-livestream .
   ```

2. Run the container:
   ```bash
   docker run website-livestream <website-url> <youtube-stream-key>
   ```

   Or with custom resolution:
   ```bash
   docker run -e RESOLUTION_WIDTH=1920 -e RESOLUTION_HEIGHT=1080 website-livestream <website-url> <youtube-stream-key>
   ```

### Local Execution (Alternative)

1. Install system dependencies:
   
   For Linux (Ubuntu/Debian):
   ```bash
   sudo apt-get update
   sudo apt-get install -y ffmpeg xvfb chromium
   ```

   For macOS:
   ```bash
   brew install ffmpeg chromium
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

3. Run the program:
   ```bash
   node src/index.js <website-url> <youtube-stream-key>
   ```

## Environment Variables

You can customize the streaming behavior with these environment variables:

- `RESOLUTION_WIDTH`: Video width (default: 1280)
- `RESOLUTION_HEIGHT`: Video height (default: 720)
- `RETRY_DELAY`: Delay between retries in ms (default: 5000)
- `MAX_RETRIES`: Maximum retry attempts (default: 3)

## System Requirements

- Docker (recommended)
- Or for local execution:
  - Node.js 18+
  - FFmpeg
  - Xvfb (Linux only)
  - Chromium/Chrome

## Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Make changes
4. Commit code and create a tag to trigger GitHub Actions build

## License

MIT

## Prerequisites

### For Linux:
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y ffmpeg xvfb

# CentOS/RHEL
sudo yum install -y ffmpeg xorg-x11-server-Xvfb
```

### For macOS:
```bash
# Using Homebrew
brew install ffmpeg
```