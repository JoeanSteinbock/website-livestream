const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const os = require('os');

class WebsiteStreamer {
    constructor(config) {
        this.config = {
            url: config.url || process.env.WEBSITE_URL || 'https://cryptotick.live/bitcoin?pm=true',
            streamKey: config.streamKey,
            resolution: {
                width: parseInt(config.width || process.env.RESOLUTION_WIDTH || 1280),
                height: parseInt(config.height || process.env.RESOLUTION_HEIGHT || 720)
            },
            retryDelay: parseInt(process.env.RETRY_DELAY || 5000),
            maxRetries: parseInt(process.env.MAX_RETRIES || 3),
            isMac: os.platform() === 'darwin'
        };

        this.browser = null;
        this.ffmpeg = null;
        this.xvfb = null;
        this.retryCount = 0;
    }

    async start() {
        try {
            await this.setupDisplay();
            await this.setupBrowser();
            await this.startStreaming();
            this.setupCleanup();
        } catch (error) {
            console.error('Error starting stream:', error);
            await this.handleError();
        }
    }

    async setupDisplay() {
        if (!this.config.isMac) {
            console.log('Starting Xvfb...');
            this.xvfb = spawn('Xvfb', [':99', '-screen', '0',
                `${this.config.resolution.width}x${this.config.resolution.height}x24`]);
            process.env.DISPLAY = ':99';
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    async setupBrowser() {
        console.log('Starting browser...');
        this.browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu'
            ],
            defaultViewport: {
                width: this.config.resolution.width,
                height: this.config.resolution.height,
                deviceScaleFactor: 1
            }
        });

        const page = await this.browser.newPage();
        page.on('error', this.handleError.bind(this));

        await page.setViewport({
            width: this.config.resolution.width,
            height: this.config.resolution.height,
            deviceScaleFactor: 1
        });

        console.log(`Navigating to ${this.config.url}...`);
        await page.goto(this.config.url, {
            waitUntil: ['networkidle0', 'domcontentloaded', 'load'],
            timeout: 60000
        });

        // 等待额外时间确保页面完全渲染
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('Page loaded, starting stream...');
    }

    async startStreaming() {
        console.log('Starting FFmpeg stream...');
        const ffmpegArgs = this.config.isMac ? [
            '-f', 'avfoundation',
            '-capture_cursor', '1',
            '-i', '1:none',
            '-framerate', '30',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-tune', 'zerolatency',
            '-b:v', '6000k',
            '-minrate', '3000k',
            '-maxrate', '6000k',
            '-bufsize', '12000k',
            '-pix_fmt', 'yuv420p',
            '-g', '60',
            '-keyint_min', '60',
            '-force_key_frames', 'expr:gte(t,n_forced*2)',
            '-sc_threshold', '0',
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            '-threads', '4',
            `rtmp://a.rtmp.youtube.com/live2/${this.config.streamKey}`
        ] : [
            '-f', 'x11grab',
            '-framerate', '30',
            '-video_size', `${this.config.resolution.width}x${this.config.resolution.height}`,
            '-i', ':99',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-tune', 'zerolatency',
            '-b:v', '6000k',
            '-minrate', '3000k',
            '-maxrate', '6000k',
            '-bufsize', '12000k',
            '-pix_fmt', 'yuv420p',
            '-g', '60',
            '-keyint_min', '60',
            '-force_key_frames', 'expr:gte(t,n_forced*2)',
            '-sc_threshold', '0',
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            '-threads', '4',
            `rtmp://a.rtmp.youtube.com/live2/${this.config.streamKey}`
        ];

        this.ffmpeg = spawn('ffmpeg', ffmpegArgs);
        
        this.ffmpeg.stderr.on('data', (data) => {
            const message = data.toString();
            console.log(`FFmpeg: ${message}`);
            if (message.includes('Error') || message.includes('error')) {
                console.error('FFmpeg error detected:', message);
            }
        });

        this.ffmpeg.on('error', (error) => {
            console.error('FFmpeg process error:', error);
            this.handleError();
        });

        this.ffmpeg.on('exit', (code, signal) => {
            console.log(`FFmpeg process exited with code ${code} and signal ${signal}`);
            if (code !== 0) {
                this.handleError();
            }
        });
    }

    async handleError() {
        if (this.retryCount < this.config.maxRetries) {
            this.retryCount++;
            console.log(`Retrying (${this.retryCount}/${this.config.maxRetries}) in ${this.config.retryDelay / 1000} seconds...`);
            await this.cleanup();
            setTimeout(() => this.start(), this.config.retryDelay);
        } else {
            console.error('Max retries reached, exiting...');
            await this.cleanup();
            process.exit(1);
        }
    }

    async cleanup() {
        if (this.browser) await this.browser.close();
        if (this.xvfb) this.xvfb.kill();
        if (this.ffmpeg) this.ffmpeg.kill();
    }

    setupCleanup() {
        process.on('SIGINT', async () => {
            console.log('Received SIGINT, cleaning up...');
            await this.cleanup();
            process.exit();
        });

        process.on('SIGTERM', async () => {
            console.log('Received SIGTERM, cleaning up...');
            await this.cleanup();
            process.exit();
        });
    }
}

// CLI handling
if (require.main === module) {
    if (process.argv.length < 4 && !process.env.WEBSITE_URL) {
        console.error('Usage: node index.js <website-url> <youtube-stream-key>');
        console.error('Or set environment variables: WEBSITE_URL and YOUTUBE_STREAM_KEY');
        process.exit(1);
    }

    const streamer = new WebsiteStreamer({
        url: process.argv[2] || process.env.WEBSITE_URL,
        streamKey: process.argv[3] || process.env.YOUTUBE_STREAM_KEY
    });

    streamer.start().catch(console.error);
}

module.exports = WebsiteStreamer;