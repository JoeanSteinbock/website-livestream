const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');

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
                width: parseInt(config.width || process.env.RESOLUTION_WIDTH || 900),
                height: parseInt(config.height || process.env.RESOLUTION_HEIGHT || 506)
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
                '-ac',
                '-nolisten', 'tcp'
            ]);
            process.env.DISPLAY = `:99`;  // 使用固定的显示器编号

            // 等待 Xvfb 启动
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

                // 简单地等待一段时间，确保 Xvfb 启动
                setTimeout(() => {
                    if (this.xvfb.exitCode === null) {
                        // 检查 X11 socket 文件是否存在
                        if (fs.existsSync(`/tmp/.X11-unix/X${displayNum}`)) {
                            console.log('Xvfb started successfully');
                            resolve();
                        } else {
                            reject(new Error('Xvfb socket file not found'));
                        }
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
                '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36'
            ],
            defaultViewport: null,
            ignoreHTTPSErrors: true
        });

        const page = await this.browser.newPage();
        page.on('error', this.handleError.bind(this));

        // 设置更长的超时时间
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);
        
        // 启用 JavaScript 控制台日志
        page.on('console', msg => console.log('Browser console:', msg.text()));

        // 简化的自动化通知处理
        await page.evaluateOnNewDocument(() => {
            // 阻止 Chrome 自动化通知
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            if (window.chrome) {
                // 修改 Chrome 应用状态
                window.chrome.app = {
                    InstallState: 'hehe', 
                    RunningState: 'hehe',
                    getDetails: () => { return {}; },
                    getIsInstalled: () => { return false; },
                    installState: () => { return 'disabled'; }
                };
                
                // 尝试覆盖 csi 函数
                window.chrome.csi = () => { return {}; };
                
                // 尝试覆盖 runtime 函数
                window.chrome.runtime = {
                    ...window.chrome.runtime,
                    sendMessage: () => { return {}; }
                };
            }
            
            // 创建样式元素以隐藏自动化信息栏
            const style = document.createElement('style');
            style.textContent = `
                .devtools-notification,
                .infobar-wrapper,
                .infobar-overlay,
                .infobar,
                div[role="infobar"],
                div[style*="top: 0px; left: 0px; right: 0px; position: fixed;"],
                .devtools-notification-main-frame,
                div[class*="notification"],
                div[id*="notification"],
                div[data-notification] {
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    height: 0 !important;
                    max-height: 0 !important;
                    overflow: hidden !important;
                    position: absolute !important;
                    top: -9999px !important;
                    left: -9999px !important;
                    z-index: -9999 !important;
                }
            `;
            
            // 预先添加样式，以便在页面加载前就生效
            (document.head || document.documentElement).appendChild(style);
            
            // 创建一个 MutationObserver 以持续移除任何出现的通知
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.addedNodes) {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1) { // ELEMENT_NODE
                                // 检查是否为通知元素
                                if (
                                    node.classList && (
                                        node.classList.contains('devtools-notification') ||
                                        node.classList.contains('infobar') ||
                                        node.hasAttribute('role') && node.getAttribute('role') === 'infobar'
                                    ) ||
                                    node.id && (
                                        node.id.includes('notification') ||
                                        node.id.includes('infobar')
                                    ) ||
                                    node.style && node.style.position === 'fixed' && node.style.top === '0px'
                                ) {
                                    node.remove();
                                }
                            }
                        });
                    }
                });
            });
            
            // 开始观察整个文档的变化
            observer.observe(document, { 
                childList: true, 
                subtree: true 
            });
        });

        // 在页面加载后添加额外的样式
        await page.addStyleTag({
            content: `
                /* 强制隐藏 Chrome 自动化通知 */
                body::before {
                    content: "";
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 40px;  /* 覆盖通知条高度 */
                    background-color: white;
                    z-index: 2147483647;  /* 最高 z-index */
                    display: block;
                }
                
                /* 移整体向上移动，填补通知条留下的空间 */
                body {
                    margin-top: -40px !important;
                    padding-top: 0 !important;
                    overflow: hidden !important;
                }
            `
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
            await page.waitForSelector('.chart-container', { timeout: 3000 });
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
                /* 隐藏通知条 */
                .devtools-notification {
                    display: none !important;
                }
                /* 移除不必要的空白和边距 */
                body {
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: hidden !important;
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
        await new Promise(resolve => setTimeout(resolve, 10000));

        // 截取屏幕截图
        console.log('Taking screenshot to verify rendering...');
        await page.screenshot({
            path: '/tmp/page-screenshot.png',
            fullPage: true
        });
        console.log('Screenshot saved to /tmp/page-screenshot.png');

        console.log('Page loaded and rendered, starting stream...');
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
        
        // 下载逻辑保持不变
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
                fs.unlink(filePath, () => {}); // 删除不完整的文件
                console.error(`Error downloading background music: ${err.message}`);
                reject(err);
            });
        });
    }

    async startStreaming() {
        console.log('Starting FFmpeg stream...');
        
        // 如果启用了音频，才下载背景音乐
        let bgMusicPath = null;
        if (this.config.enableAudio) {
            try {
                bgMusicPath = await this.downloadBackgroundTrack();
                console.log(`Using background music: ${bgMusicPath}`);
            } catch (error) {
                console.error('Failed to download background music, using default audio:', error);
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
        
        const ffmpegArgs = this.config.isMac ? [
            // macOS configuration
            '-f', 'avfoundation',
            '-capture_cursor', '1',
            '-i', '1:0',  // 1:0 表示第一个屏幕和第一个音频设备
            '-framerate', '30',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
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
            // Linux 配置
            '-f', 'x11grab',
            '-framerate', '30',
            '-video_size', `${this.config.resolution.width}x${this.config.resolution.height}`,
            '-draw_mouse', '0',
            '-i', ':99.0+0,0',  // 使用固定的格式
            
            // 根据音频设置决定使用什么音频源
            ...(this.config.enableAudio ? 
                (bgMusicPath ? [
                    '-stream_loop', '-1',
                    '-i', bgMusicPath,
                    '-c:v', 'libx264',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-ar', '44100',
                    '-shortest',
                ] : [
                    '-f', 'lavfi',
                    '-i', 'anullsrc=r=44100:cl=stereo',
                    '-c:v', 'libx264',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-ar', '44100',
                ]) : [
                    '-an',
                    '-c:v', 'libx264',
                ]
            ),
            '-preset', 'ultrafast',
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
            '-fps_mode', 'cfr',  // 使用 fps_mode 代替已弃用的 vsync
            `rtmp://a.rtmp.youtube.com/live2/${this.config.streamKey}`
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

    async debugXvfbDisplay() {
        if (!this.config.isMac) {
            console.log('Taking Xvfb screenshot for debugging...');
            try {
                // 使用 xwd 工具捕获 Xvfb 屏幕
                const xwdProcess = spawn('xwd', ['-root', '-display', ':99', '-out', '/tmp/xvfb-screen.xwd']);
                await new Promise((resolve) => xwdProcess.on('close', resolve));
                
                // 转换为 PNG 格式
                const convertProcess = spawn('convert', ['/tmp/xvfb-screen.xwd', '/tmp/xvfb-screen.png']);
                await new Promise((resolve) => convertProcess.on('close', resolve));
                
                console.log('Xvfb screenshot saved to /tmp/xvfb-screen.png');
            } catch (error) {
                console.error('Failed to capture Xvfb screenshot:', error);
            }
        }
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