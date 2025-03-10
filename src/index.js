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
            console.log('Setting up virtual display...');
            
            const displayNum = 99;
            
            // 清理可能存在的锁文件和进程
            try {
                spawn('pkill', ['-f', 'Xvfb']);
                await new Promise(resolve => setTimeout(resolve, 1000));
                spawn('rm', ['-f', `/tmp/.X${displayNum}-lock`, `/tmp/.X11-unix/X${displayNum}`]);
            } catch (error) {
                console.log('No existing Xvfb processes or lock files');
            }

            console.log('Starting Xvfb...');
            this.xvfb = spawn('Xvfb', [
                `:${displayNum}`,
                '-screen', '0',
                `${this.config.resolution.width}x${this.config.resolution.height}x24`,
                '-ac',           // 禁用访问控制
                '-nolisten', 'tcp'  // 不监听 TCP 端口
            ]);
            process.env.DISPLAY = `:${displayNum}`;

            // 添加 Xvfb 日志
            this.xvfb.stdout.on('data', (data) => {
                console.log(`Xvfb stdout: ${data}`);
            });
            this.xvfb.stderr.on('data', (data) => {
                console.log(`Xvfb stderr: ${data}`);
            });

            // 等待 Xvfb 启动并检查是否成功
            await new Promise((resolve, reject) => {
                let errorOutput = '';
                
                this.xvfb.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                this.xvfb.on('error', (error) => {
                    reject(new Error(`Failed to start Xvfb: ${error}`));
                });

                this.xvfb.on('exit', (code) => {
                    if (code !== null) {
                        reject(new Error(`Xvfb exited with code ${code}: ${errorOutput}`));
                    }
                });

                setTimeout(() => {
                    if (this.xvfb.exitCode === null) {
                        console.log('Xvfb started successfully');
                        resolve();
                    } else {
                        reject(new Error(`Xvfb failed to start: ${errorOutput}`));
                    }
                }, 2000);
            });
        }
    }

    async setupBrowser() {
        console.log('Starting browser...');
        this.browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                `--window-size=${this.config.resolution.width},${this.config.resolution.height}`
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

        // 等待页面完全渲染
        console.log('Waiting for page to render...');
        await page.evaluate(() => new Promise(resolve => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        }));

        // 等待额外时间确保页面完全渲染
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('Page loaded and rendered, starting stream...');
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
            '-draw_mouse', '0',
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
            '-probesize', '42M',
            '-analyzeduration', '5000000',
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