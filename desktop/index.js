const path = require('path');
const { spawn } = require('child_process');
const { startServer, stopServer, serverEvents } = require('./server/index');

// Hide the Windows console window so only the single MoodLink GUI appears
if (process.platform === 'win32') {
    try {
        const koffi = require('koffi');
        const kernel32 = koffi.load('kernel32.dll');
        const user32 = koffi.load('user32.dll');
        const GetConsoleWindow = kernel32.func('GetConsoleWindow', 'void *', []);
        const ShowWindow = user32.func('ShowWindow', 'bool', ['void *', 'int']);
        const hwnd = GetConsoleWindow();
        if (hwnd) {
            ShowWindow(hwnd, 0); // 0 = SW_HIDE
        }
    } catch (e) {}
}

const SERVER_PORT = 3847;
let uiProcess = null;

async function bootstrap() {
    // Start the embedded Node.js server
    const serverInstance = await startServer(SERVER_PORT);
    const actualPort = (serverInstance && serverInstance.address()) ? serverInstance.address().port : SERVER_PORT;
    console.log(`[MoodLink] Server running on port ${actualPort}`);

    const os = require('os');
    const fs = require('fs');
    const binSrc = path.join(__dirname, 'server', 'bin');
    const binDest = path.join(os.tmpdir(), 'moodlink_bin');
    
    if (!fs.existsSync(binDest)) fs.mkdirSync(binDest, { recursive: true });
    
    // Extract UI and dependencies
    const filesToExtract = ['ui.exe', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'icon.ico'];
    for (const f of filesToExtract) {
        const srcPath = path.join(binSrc, f);
        const destPath = path.join(binDest, f);
        if (fs.existsSync(srcPath)) fs.copyFileSync(srcPath, destPath);
    }

    const uiExePath = path.join(binDest, 'ui.exe');
    uiProcess = spawn(uiExePath, [actualPort.toString()], {
        stdio: ['pipe', 'pipe', 'inherit'], // pipe stdin & stdout
        windowsHide: true
    });

    if (uiProcess.stdout) {
        uiProcess.stdout.on('data', (buf) => {
            const lines = buf.toString().split('\n');
            for (let line of lines) {
                line = line.trim();
                if (line.startsWith('clipboard_image_captured ')) {
                    const filename = line.substring(25).trim();
                    serverEvents.emit('pc:screenshot:captured', filename);
                } else if (line.startsWith('app_foreground ')) {
                    const appName = line.substring(15).trim();
                    serverEvents.emit('app:foreground:changed', appName);
                }
            }
        });
    }

    uiProcess.on('error', (err) => {
        console.error('[MoodLink] Failed to start native UI:', err);
    });
    
    uiProcess.on('exit', () => {
        console.log('[MoodLink] UI process exited. Shutting down...');
        stopServer(serverInstance);
        process.exit(0);
    });

    // Forward laser events to the UI process via stdin
    serverEvents.on('laser', (data) => {
        if (!uiProcess || !uiProcess.stdin) return;
        if (data.visible) {
            uiProcess.stdin.write(`laser_move ${data.rx} ${data.ry}\n`);
        } else {
            uiProcess.stdin.write(`laser_hide\n`);
        }
    });

    // Forward ink annotation events to UI process
    serverEvents.on('laser_ink', (data) => {
        if (!uiProcess || !uiProcess.stdin) return;
        if (data.cmd === 'point') {
            uiProcess.stdin.write(`ink_point ${data.rx} ${data.ry} ${data.isNew ? '1' : '0'} ${data.color || '1'}\n`);
        } else if (data.cmd === 'clear') {
            uiProcess.stdin.write(`ink_clear\n`);
        }
    });

    // We can also send tray status updates
    let connectedCount = 0;
    const { getConnectedDevices } = require('./server/index');
    
    setInterval(() => {
        const devs = getConnectedDevices();
        if (devs && devs.size !== connectedCount) {
            connectedCount = devs.size;
            if (uiProcess && uiProcess.stdin) {
                uiProcess.stdin.write(`tray_status ${connectedCount > 0 ? connectedCount + ' device(s) connected' : 'Ready'}\n`);
            }
        }
    }, 2000);
}

bootstrap();

// Graceful shutdown
process.on('SIGINT', () => {
    if (uiProcess) uiProcess.kill();
    process.exit(0);
});
process.on('SIGTERM', () => {
    if (uiProcess) uiProcess.kill();
    process.exit(0);
});
