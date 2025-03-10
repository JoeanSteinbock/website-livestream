 # Website Live Streamer

A tool to livestream any website to YouTube.

## Features

- Support for any accessible website
- Automatic retry mechanism
- Cross-platform support (Linux and macOS)
- Docker support

## Usage

### Local Execution

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the program:
   ```bash
   node src/index.js <website-url> <youtube-stream-key>
   ```

### Using Docker

1. Pull the image:
   ```bash
   docker pull ghcr.io/JoeanSteinbock/website-livestream:latest
   ```

2. Run the container:
   ```bash
   docker run ghcr.io/JoeanSteinbock/website-livestream <website-url> <youtube-stream-key>
   ```

## System Requirements

- Node.js 18+
- FFmpeg
- Xvfb (required on Linux)

## Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Make changes
4. Commit code and create a tag to trigger GitHub Actions build

## License

MIT