const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// 背景音乐轨道列表
const bgTracks = [
    "https://cdn.pixabay.com/audio/2024/12/26/audio_5686c7b0c3.mp3",
    "https://cdn.pixabay.com/audio/2025/02/06/audio_97edd31405.mp3",
    "https://cdn.pixabay.com/audio/2024/12/01/audio_968fc36840.mp3",
    "https://cdn.pixabay.com/audio/2024/11/05/audio_27b3644bf7.mp3",
    "https://cdn.pixabay.com/audio/2022/03/29/audio_321d17982c.mp3",
    "https://cdn.pixabay.com/audio/2025/03/05/audio_c359e40a3e.mp3",
    "https://cdn.pixabay.com/audio/2024/11/24/audio_e1d4c85046.mp3",
    "https://cdn.pixabay.com/audio/2024/04/11/audio_52d3ab883f.mp3",
    "https://cdn.pixabay.com/audio/2021/12/05/audio_c548e46009.mp3",
    "https://cdn.pixabay.com/audio/2023/04/13/audio_39b7d5ebea.mp3",
    "https://cdn.pixabay.com/audio/2024/05/02/audio_0ec3e1300a.mp3",
    "https://cdn.pixabay.com/audio/2024/07/23/audio_9196e2a1ac.mp3",
];

let playedTracks = [];

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
            isMac: os.platform() === 'darwin',
            enableAudio: config.enableAudio !== undefined ? config.enableAudio :
                (process.env.ENABLE_AUDIO !== undefined ?
                    process.env.ENABLE_AUDIO.toLowerCase() === 'true' : true)
        };

        this.browser = null;
        this.ffmpeg = null;
        this.xvfb = null;
        this.retryCount = 0;
        this.bgMusicPath = null; // 用于存储背景音乐的路径
        this.currentTrackIndex = null; // 跟踪当前播放的曲目索引

        // 每 1 小时重启一次流
        this.restartInterval = parseInt(process.env.RESTART_INTERVAL || 1 * 60 * 60 * 1000);
        this.restartTimer = null;

        // 在 setupBrowser 方法中
        this.lastScreenshotHash = '';
        this.unchangedCount = 0;
    }

    async start() {
        try {
            await this.setupDisplay();
            await this.setupBrowser();
            await this.startStreaming();
            this.setupCleanup();

            // 设置定期重启
            if (this.restartInterval > 0) {
                console.log(`Setting up automatic restart every ${this.restartInterval / 1000 / 60 / 60} hours`);
                this.restartTimer = setTimeout(async () => {
                    console.log('Scheduled restart triggered');
                    await this.cleanup();
                    this.start();
                }, this.restartInterval);
            }
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
            headless: false,
            ignoreDefaultArgs: ["--enable-automation"],
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                `--window-size=${this.config.resolution.width},${this.config.resolution.height}`,
                '--start-maximized',
                '--kiosk',
                '--disable-infobars',
                '--disable-notifications',
                '--autoplay-policy=no-user-gesture-required',
                '--disable-web-security',
                '--allow-running-insecure-content',
                '--disable-audio-output-engagement-rules',
                '--disable-gesture-requirement-for-media',
                '--disable-features=AudioServiceOutOfProcess',
                '--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
            ],
            defaultViewport: null,
            ignoreHTTPSErrors: true
        });

        const page = await this.browser.newPage();
        page.on('error', this.handleError.bind(this));

        // 设置 iPhone 14 Pro Max 的设备模拟
        await page.emulate({
            viewport: {
                width: 932,
                height: 430,
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
                isLandscape: true
            },
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
        });

        // 设置更长的超时时间
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);

        // 启用 JavaScript 控制台日志
        page.on('console', msg => console.log('Browser console:', msg.text()));

        // 隐藏自动化控制条
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            if (window.chrome) {
                window.chrome.app = { InstallState: 'hehe', RunningState: 'hehe' };
            }
        });

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

        // 等待页面上的特定元素出现
        try {
            await page.waitForSelector('.chart-container', { timeout: 1000 });
            console.log('Chart container found');
        } catch (error) {
            console.log('Could not find chart container, continuing anyway');
        }

        // 尝试启用网站音频
        console.log('Attempting to enable website audio...');
        try {
            // 尝试查找并点击音频控制元素（根据网站具体情况调整选择器）
            await page.evaluate(() => {
                // 尝试找到所有可能的音频控制按钮
                const audioButtons = Array.from(document.querySelectorAll('button, .audio-control, [aria-label*="audio"], [aria-label*="sound"], [title*="audio"], [title*="sound"], .volume-control'));

                // 尝试点击找到的每个元素
                for (const button of audioButtons) {
                    console.log('Clicking potential audio control:', button);
                    button.click();
                }

                // 尝试自动播放页面上的所有媒体元素
                document.querySelectorAll('video, audio').forEach(media => {
                    media.muted = false;
                    media.volume = 1.0;
                    const playPromise = media.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(e => console.log('Media play failed:', e));
                    }
                });

                // 模拟用户交互，以便浏览器允许自动播放
                document.documentElement.click();
            });
            console.log('Audio enable attempt completed');
        } catch (error) {
            console.log('Failed to enable website audio, will use synthetic audio:', error);
        }

        // 添加自定义 CSS 来优化显示效果
        await page.addStyleTag({
            content: `
                /* 隐藏顶部工具栏 */
                header, 
                nav, 
                .toolbar, 
                .header, 
                .nav-bar, 
                .top-bar,
                [role="banner"],
                [class*="header"],
                [class*="toolbar"],
                [class*="nav-bar"],
                [id*="header"],
                [id*="toolbar"],
                [id*="nav-bar"] {
                    display: none !important;
                    height: 0 !important;
                    opacity: 0 !important;
                    visibility: hidden !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: hidden !important;
                }
                
                /* 确保内容区域占满整个屏幕 */
                body, 
                .main-content, 
                .content, 
                main, 
                [role="main"],
                [class*="content"],
                [id*="content"] {
                    margin-top: 0 !important;
                    padding-top: 0 !important;
                    height: 100vh !important;
                    width: 100vw !important;
                    max-height: 100vh !important;
                    overflow: hidden !important;
                }
                
                /* 隐藏底部工具栏或导航 */
                footer,
                .footer,
                .bottom-bar,
                [role="contentinfo"],
                [class*="footer"],
                [class*="bottom-bar"],
                [id*="footer"],
                [id*="bottom-bar"] {
                    display: none !important;
                    height: 0 !important;
                    opacity: 0 !important;
                    visibility: hidden !important;
                }
            `
        });

        // 注入一些 JavaScript 来触发重绘
        await page.evaluate(() => {
            return new Promise(resolve => {
                document.body.style.zoom = 1.001;
                requestAnimationFrame(() => {
                    document.body.style.zoom = 1;
                    requestAnimationFrame(() => {
                        window.scrollTo(0, 1);
                        window.scrollTo(0, 0);

                        // 移除所有的通知和信息栏元素
                        const notifications = document.querySelectorAll('.notification, .info-bar, .devtools-notification');
                        notifications.forEach(element => {
                            if (element && element.parentNode) {
                                element.parentNode.removeChild(element);
                            }
                        });

                        resolve();
                    });
                });
            });
        });

        // 等待额外时间确保页面完全渲染
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 截取屏幕截图
        console.log('Taking screenshot to verify rendering...');
        await page.screenshot({
            path: '/tmp/page-screenshot.png',
            fullPage: true
        });
        console.log('Screenshot saved to /tmp/page-screenshot.png');

        console.log('Page loaded and rendered, starting stream...');

        // 模拟暗黑模式
        await page.emulateMediaFeatures([
            { name: 'prefers-color-scheme', value: 'dark' }
        ]);

        // 在 setupBrowser 方法中添加屏幕内容变化检测
        // 添加在 setupBrowser 方法结尾，替换之前的 15 分钟刷新代码

        // 每分钟检查一次屏幕内容是否更新
        const contentChangeDetectionInterval = setInterval(async () => {
            try {
                console.log('Checking screen content for changes...');
                // 截取当前屏幕
                const screenshot = await page.screenshot({ encoding: 'base64', quality: 10, type: 'jpeg' });
                
                // 计算当前屏幕的哈希值
                const currentHash = crypto.createHash('md5').update(screenshot).digest('hex');
                
                // 如果与上次哈希值相同，说明屏幕内容没有变化
                if (this.lastScreenshotHash && this.lastScreenshotHash === currentHash) {
                    this.unchangedCount++;
                    console.log(`Screen content unchanged for ${this.unchangedCount} minute(s)`);
                    
                    // 如果连续2分钟没有变化，则刷新页面
                    if (this.unchangedCount >= 2) {
                        console.log('Screen content not changing for 2 minutes, forcing page reload');
                        await page.reload({ waitUntil: ['networkidle0', 'domcontentloaded'] });
                        this.unchangedCount = 0; // 重置计数器
                    }
                } else {
                    // 如果内容已更新，重置计数器
                    if (this.lastScreenshotHash && this.lastScreenshotHash !== currentHash) {
                        console.log('Screen content has changed, content is updating properly');
                        this.unchangedCount = 0;
                    }
                    // 更新哈希值
                    this.lastScreenshotHash = currentHash;
                }
            } catch (error) {
                console.error('Error checking screen content:', error);
            }
        }, 60 * 1000); // 每分钟检查一次

        // 确保在清理时停止这个间隔
        this.contentChangeDetectionInterval = contentChangeDetectionInterval;
    }

    async downloadBackgroundTrack() {
        // 选择一个未播放过的背景音乐
        let availableTracks = bgTracks.filter((_, index) => !playedTracks.includes(index));

        // 如果所有曲目都已播放过，则重置
        if (availableTracks.length === 0) {
            console.log('All tracks have been played, resetting play history');
            playedTracks = [];
            availableTracks = bgTracks;
        }

        // 随机选择一个未播放的曲目
        const randomIndex = Math.floor(Math.random() * availableTracks.length);
        const selectedTrack = availableTracks[randomIndex];

        // 找到所选曲目在原始数组中的索引
        const originalIndex = bgTracks.indexOf(selectedTrack);
        this.currentTrackIndex = originalIndex;

        // 将此曲目添加到已播放列表中
        playedTracks.push(originalIndex);

        console.log(`Downloading background music [${originalIndex + 1}/${bgTracks.length}]: ${selectedTrack}`);

        const tempDir = '/tmp';
        const fileName = path.basename(selectedTrack);
        const filePath = path.join(tempDir, fileName);

        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(filePath);
            https.get(selectedTrack, (response) => {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log(`Background music downloaded to ${filePath}`);
                    this.bgMusicPath = filePath;
                    resolve(filePath);
                });
            }).on('error', (err) => {
                fs.unlink(filePath, () => { }); // 删除不完整的文件
                console.error(`Error downloading background music: ${err.message}`);
                reject(err);
            });
        });
    }

    async startStreaming() {
        console.log('Starting FFmpeg stream...');

        // 不再下载单个音乐文件，而是准备一个播放列表
        let playlistPath = null;
        if (this.config.enableAudio) {
            try {
                // 创建一个包含所有音乐的播放列表
                playlistPath = await this.createMusicPlaylist();
                console.log(`Using music playlist: ${playlistPath}`);
            } catch (error) {
                console.error('Failed to create music playlist, using default audio:', error);
            }
        } else {
            console.log('Background audio is disabled');
        }

        // 首先检查音频设备
        if (!this.config.isMac) {
            try {
                const pulseCheck = spawn('pacmd', ['list-sources']);
                let pulseOutput = '';
                pulseCheck.stdout.on('data', (data) => {
                    pulseOutput += data.toString();
                });
                await new Promise((resolve) => pulseCheck.on('close', resolve));
                console.log('Available PulseAudio sources:', pulseOutput);
            } catch (error) {
                console.error('Error checking PulseAudio sources:', error);
            }
        }

        // 修改 FFmpeg 参数，使用播放列表而不是单个文件
        const ffmpegArgs = this.config.isMac ? [
            // macOS configuration
            '-f', 'avfoundation',
            '-capture_cursor', '1',
            '-i', '1:0',  // 1:0 表示第一个屏幕和第一个音频设备
            '-framerate', '30',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-tune', 'zerolatency',
            '-b:v', '4000k',
            '-minrate', '2000k',
            '-maxrate', '4000k',
            '-bufsize', '8000k',
            '-pix_fmt', 'yuv420p',
            '-g', '30',
            '-keyint_min', '30',
            '-force_key_frames', 'expr:gte(t,n_forced*2)',
            '-sc_threshold', '0',
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            '-threads', '4',
            '-max_muxing_queue_size', '9999',
            '-vsync', '1',
            '-async', '1',
            '-reconnect', '1',
            '-reconnect_at_eof', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '120',
            '-flush_packets', '1',
            '-fflags', '+nobuffer',
            `rtmp://b.rtmp.youtube.com/live2/${this.config.streamKey}`
        ] : [
            // Linux 配置
            '-f', 'x11grab',
            '-framerate', '30',
            '-video_size', `${this.config.resolution.width}x${this.config.resolution.height}`,
            '-draw_mouse', '0',
            '-i', ':99.0+0,0',

            // 使用播放列表而不是单个文件
            ...(this.config.enableAudio && playlistPath ? [
                '-f', 'concat',
                '-safe', '0',
                '-i', playlistPath,
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-ar', '44100',
            ] : [
                // 无背景音乐时使用无声音频
                '-f', 'lavfi',
                '-i', 'anullsrc=r=44100:cl=stereo',
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-ar', '44100',
            ]),
            '-preset', 'veryfast',
            '-tune', 'zerolatency',
            '-b:v', '4000k',
            '-minrate', '2000k',
            '-maxrate', '4000k',
            '-bufsize', '8000k',
            '-pix_fmt', 'yuv420p',
            '-g', '30',
            '-keyint_min', '30',
            '-force_key_frames', 'expr:gte(t,n_forced*2)',
            '-sc_threshold', '0',
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            '-threads', '4',
            '-probesize', '42M',
            '-analyzeduration', '5000000',
            '-fps_mode', 'cfr',  // 使用 fps_mode 代替已弃用的 vsync
            '-max_muxing_queue_size', '9999',
            '-vsync', '1',
            '-async', '1',
            '-reconnect', '1',
            '-reconnect_at_eof', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '120',
            '-flush_packets', '1',
            '-fflags', '+nobuffer',
            `rtmp://b.rtmp.youtube.com/live2/${this.config.streamKey}`
        ];

        // 在启动 FFmpeg 之前检查版本和功能
        try {
            const versionCheck = spawn('ffmpeg', ['-version']);
            versionCheck.stdout.on('data', (data) => {
                console.log('FFmpeg version info:', data.toString().split('\n')[0]);  // 只显示第一行
            });
            await new Promise((resolve) => versionCheck.on('close', resolve));
        } catch (error) {
            console.error('Error checking FFmpeg version:', error);
        }

        console.log('Starting FFmpeg with args:', ffmpegArgs.join(' '));
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
        // 清除重启计时器
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        
        // 清除内容变化检测间隔
        if (this.contentChangeDetectionInterval) {
            clearInterval(this.contentChangeDetectionInterval);
            this.contentChangeDetectionInterval = null;
        }
        
        // 清理临时音乐文件
        if (this.bgMusicPath && fs.existsSync(this.bgMusicPath)) {
            try {
                fs.unlinkSync(this.bgMusicPath);
                console.log(`Deleted temporary music file: ${this.bgMusicPath}`);
            } catch (error) {
                console.error(`Failed to delete temporary music file: ${error}`);
            }
        }

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

    // 新增方法：创建音乐播放列表
    async createMusicPlaylist() {
        console.log('Creating music playlist...');

        // 随机排序音乐列表
        const shuffledTracks = [...bgTracks].sort(() => Math.random() - 0.5);

        // 下载所有音乐文件
        const downloadedFiles = [];
        for (let i = 0; i < shuffledTracks.length; i++) {
            const track = shuffledTracks[i];
            try {
                const tempDir = '/tmp';
                const fileName = `track_${i}_${path.basename(track)}`;
                const filePath = path.join(tempDir, fileName);

                await new Promise((resolve, reject) => {
                    const file = fs.createWriteStream(filePath);
                    https.get(track, (response) => {
                        response.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            console.log(`Downloaded music file ${i + 1}/${shuffledTracks.length}: ${filePath}`);
                            downloadedFiles.push(filePath);
                            resolve();
                        });
                    }).on('error', (err) => {
                        fs.unlink(filePath, () => { });
                        console.error(`Error downloading music file: ${err.message}`);
                        reject(err);
                    });
                });
            } catch (error) {
                console.error(`Failed to download track ${i + 1}: ${error}`);
            }
        }

        // 创建 FFmpeg 播放列表文件
        const playlistPath = '/tmp/music_playlist.txt';
        let playlistContent = '';

        for (const file of downloadedFiles) {
            playlistContent += `file '${file}'\n`;
        }

        fs.writeFileSync(playlistPath, playlistContent);
        console.log(`Created playlist with ${downloadedFiles.length} tracks`);

        return playlistPath;
    }
}

// CLI handling
if (require.main === module) {
    if (process.argv.length < 4 && !process.env.WEBSITE_URL) {
        console.error('Usage: node index.js <website-url> <youtube-stream-key> [enable-audio]');
        console.error('Or set environment variables: WEBSITE_URL, YOUTUBE_STREAM_KEY, and ENABLE_AUDIO');
        console.error('enable-audio: true or false (default: true)');
        process.exit(1);
    }

    const streamer = new WebsiteStreamer({
        url: process.argv[2] || process.env.WEBSITE_URL,
        streamKey: process.argv[3] || process.env.YOUTUBE_STREAM_KEY,
        enableAudio: process.argv[4] !== undefined ? process.argv[4].toLowerCase() === 'true' : undefined
    });

    streamer.start().catch(console.error);
}

module.exports = WebsiteStreamer;