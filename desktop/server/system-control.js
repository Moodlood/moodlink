/**
 * MoodLink System Control Module
 * Controls mouse, keyboard, volume, media, and system power on Windows
 * Uses a dynamically compiled C# binary connected via standard input
 */
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class SystemControl {
  constructor() {
    this.mouseProcess = null;
    this.mousePos = { x: 0, y: 0 };
    this.screenWidth = 1920;
    this.screenHeight = 1080;
    this._initWinAPI();
  }

  _initWinAPI() {
    const os = require('os');
    const binDir = path.join(os.tmpdir(), 'moodlink_bin');
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    // Copy .cs files and SoundVolumeView.exe from snapshot to tmpdir
    const snapshotBinDir = path.join(__dirname, 'bin');
    const filesToCopy = ['mouse.cs', 'bt-serial.cs', 'SoundVolumeView.exe'];
    for (const f of filesToCopy) {
      if (fs.existsSync(path.join(snapshotBinDir, f))) {
        fs.copyFileSync(path.join(snapshotBinDir, f), path.join(binDir, f));
      }
    }

    const csFile = path.join(binDir, 'mouse.cs');
    const exeFile = path.join(binDir, 'mouse.exe');
    
    const btCsFile = path.join(binDir, 'bt-serial.cs');
    const btExeFile = path.join(binDir, 'bt-serial.exe');

    const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

    const startMouseProcess = () => {
      this.mouseProcess = spawn(exeFile, [], { windowsHide: true });
      this.mouseProcess.on('error', (err) => console.error('[MoodLink] Failed to start native mouse process:', err));
      console.log('[MoodLink] Native C# mouse controller active.');
    };

    if (!fs.existsSync(exeFile) && fs.existsSync(csFile)) {
      console.log('[MoodLink] Compiling C# native controller (mouse.exe)...');
      exec(`powershell -Command "& '${cscPath}' /target:winexe /out:'${exeFile}' '${csFile}'"`, { windowsHide: true }, (err) => {
        if (err) console.error('[MoodLink] Compile error:', err);
        else startMouseProcess();
      });
    } else {
      startMouseProcess();
    }

    if (!fs.existsSync(btExeFile) && fs.existsSync(btCsFile)) {
      console.log('[MoodLink] Compiling C# bluetooth bridge (bt-serial.exe)...');
      exec(`powershell -Command "& '${cscPath}' /target:winexe /out:'${btExeFile}' '${btCsFile}'"`, { windowsHide: true }, (err) => {
        if (err) console.error('[MoodLink] BT compile error:', err);
      });
    }
  }

  // ─── Native Binary Commands ───────────────────────────────────────
  _sendBin(cmd) {
    if (this.mouseProcess && this.mouseProcess.stdin) {
      this.mouseProcess.stdin.write(cmd + '\n');
    }
  }

  // ─── Mouse Control ──────────────────────────────────────────────
  async moveMouse(dx, dy) {
    this._sendBin(`move_rel ${Math.round(dx)} ${Math.round(dy)}`);
  }

  async click(button = 'left') {
    this._sendBin(`click ${button}`);
  }

  async doubleClick() {
    this._sendBin(`click left`);
    await new Promise(r => setTimeout(r, 50));
    this._sendBin(`click left`);
  }

  async scroll(dx, dy) {
    this._sendBin(`scroll ${dx} ${dy}`);
  }

  // ─── Keyboard Control ───────────────────────────────────────────
  async keyPress(key, modifiers = []) {
    const vk = this._keyToVK(key);
    if (vk === null) return;

    for (const mod of modifiers) {
      const mvk = this._keyToVK(mod);
      if (mvk !== null) this._sendBin(`key ${mvk} down`);
    }

    this._sendBin(`key ${vk} press`);

    for (const mod of modifiers.reverse()) {
      const mvk = this._keyToVK(mod);
      if (mvk !== null) this._sendBin(`key ${mvk} up`);
    }
  }

  async typeText(text) {
    if (!text) return;
    const escaped = text.replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, '{$&}');
    this._psExec(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`);
  }

  async keyCombo(keys) {
    if (!keys || keys.length === 0) return;
    for (const key of keys) {
      const vk = this._keyToVK(key);
      if (vk !== null) this._sendBin(`key ${vk} down`);
    }
    for (const key of keys.reverse()) {
      const vk = this._keyToVK(key);
      if (vk !== null) this._sendBin(`key ${vk} up`);
    }
  }

  _keyToVK(key) {
    const map = {
      'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45, 'f': 0x46,
      'g': 0x47, 'h': 0x48, 'i': 0x49, 'j': 0x4A, 'k': 0x4B, 'l': 0x4C,
      'm': 0x4D, 'n': 0x4E, 'o': 0x4F, 'p': 0x50, 'q': 0x51, 'r': 0x52,
      's': 0x53, 't': 0x54, 'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58,
      'y': 0x59, 'z': 0x5A,
      '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
      '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
      'enter': 0x0D, 'return': 0x0D, 'tab': 0x09, 'space': 0x20,
      'backspace': 0x08, 'delete': 0x2E, 'escape': 0x1B, 'esc': 0x1B,
      'shift': 0x10, 'ctrl': 0x11, 'control': 0x11, 'alt': 0x12, 'menu': 0x12,
      'win': 0x5B, 'windows': 0x5B, 'super': 0x5B,
      'left': 0x25, 'up': 0x26, 'right': 0x27, 'down': 0x28,
      'home': 0x24, 'end': 0x23, 'pageup': 0x21, 'pagedown': 0x22,
      'insert': 0x2D, 'printscreen': 0x2C,
      'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74,
      'f6': 0x75, 'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79,
      'f11': 0x7A, 'f12': 0x7B,
      'volumeup': 0xAF, 'volumedown': 0xAE, 'volumemute': 0xAD,
      'medianexttrack': 0xB0, 'mediaprevtrack': 0xB1,
      'mediastop': 0xB2, 'mediaplaypause': 0xB3,
    };
    return map[key.toLowerCase()] ?? null;
  }

  // ─── Volume Control ─────────────────────────────────────────────
  async getVolume() {
    return new Promise((resolve) => {
      exec('powershell -Command "(Get-AudioDevice -PlaybackVolume).Replace(\'%\',\'\')"', { timeout: 2000 }, (err, stdout) => {
        if (!err) {
          const vol = parseInt(stdout.trim());
          if (!isNaN(vol)) return resolve(vol);
        }
        resolve(50);
      });
    });
  }

  async setVolume(level) {
    level = Math.max(0, Math.min(100, Math.round(level)));
    return new Promise((resolve) => {
      exec(`powershell -Command "Set-AudioDevice -PlaybackVolume ${level}"`, { timeout: 2000 }, (err) => {
        resolve();
      });
    });
  }

  async toggleMute() {
    this._sendBin(`key 173 press`); // 0xAD = 173
  }

  // ─── Media Controls ─────────────────────────────────────────────
  mediaPlay() { this._sendBin(`key 179 press`); }
  mediaNext() { this._sendBin(`key 176 press`); }
  mediaPrev() { this._sendBin(`key 177 press`); }

  // ─── System Commands ────────────────────────────────────────────
  shutdown() { exec('shutdown /s /t 5 /f'); }
  restart() { exec('shutdown /r /t 5 /f'); }
  lock() { exec('rundll32.exe user32.dll,LockWorkStation'); }
  sleep() { exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0'); }

  async launchApp(target) {
    if (!target) return;
    const apps = {
      chrome: 'start chrome',
      vscode: 'start code',
      code: 'start code',
      explorer: 'start explorer',
      taskmgr: 'start taskmgr',
      calc: 'start calc',
      notepad: 'start notepad',
      terminal: 'start wt || start powershell',
      powershell: 'start powershell',
      cmd: 'start cmd',
      spotify: 'start spotify'
    };
    const key = typeof target === 'string' ? target.toLowerCase().trim() : '';
    if (apps[key]) {
      exec(apps[key], { windowsHide: true }, (err) => {
        if (err) console.error(`Failed to launch app ${target}:`, err.message);
      });
    } else {
      try {
        const open = require('open');
        await open(target);
      } catch (err) {
        exec(`start "" "${target}"`, { windowsHide: true }, () => {});
      }
    }
  }

  // ─── System Info ────────────────────────────────────────────────
  async getSystemInfo() {
    try {
      const si = require('systeminformation');
      const [cpu, mem, battery] = await Promise.all([
        si.currentLoad(), si.mem(), si.battery()
      ]);
      return {
        cpu: { usage: Math.round(cpu.currentLoad) },
        memory: {
          total: Math.round(mem.total / 1073741824 * 10) / 10,
          used: Math.round(mem.used / 1073741824 * 10) / 10,
          percent: Math.round(mem.used / mem.total * 100)
        },
        battery: {
          percent: battery.percent,
          charging: battery.isCharging,
          hasBattery: battery.hasBattery
        },
        screen: { width: this.screenWidth, height: this.screenHeight }
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ─── App Control ────────────────────────────────────────────────
  async getRunningApps() {
    return new Promise((resolve) => {
      exec('powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne \'\'} | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json"',
        { timeout: 5000 }, (err, stdout) => {
          if (err) return resolve([]);
          try {
            let apps = JSON.parse(stdout);
            if (!Array.isArray(apps)) apps = [apps];
            resolve(apps.map(a => ({
              pid: a.Id, name: a.ProcessName, title: a.MainWindowTitle
            })));
          } catch (e) { resolve([]); }
        });
    });
  }

  async killApp(pid) {
    exec(`taskkill /PID ${pid} /F`);
  }

  // ─── Helper ─────────────────────────────────────────────────────
  _psExec(cmd) {
    try { exec(`powershell -Command "${cmd.replace(/"/g, '\\"')}"`, { timeout: 5000 }); }
    catch (e) { console.error('PS exec error:', e.message); }
  }

  setScreenResolution(width, height) {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  // Bluetooth COM Bridge Methods
  async getBluetoothComPorts() {
    return new Promise((resolve) => {
      exec('powershell -Command "Get-WmiObject Win32_SerialPort | Select-Object DeviceID, Description | ConvertTo-Json"', (err, stdout) => {
        if (err || !stdout.trim()) return resolve([]);
        try {
          const parsed = JSON.parse(stdout);
          const ports = Array.isArray(parsed) ? parsed : [parsed];
          resolve(ports.filter(p => p.Description.toLowerCase().includes('bluetooth')).map(p => p.DeviceID));
        } catch (e) { resolve([]); }
      });
    });
  }

  connectBluetoothBridge(port, onDataCallback) {
    if (this.btProcess) {
      this.btProcess.kill();
      this.btProcess = null;
    }
    const os = require('os');
    const exeFile = path.join(os.tmpdir(), 'moodlink_bin', 'bt-serial.exe');
    if (fs.existsSync(exeFile)) {
      this.btProcess = spawn(exeFile, [port]);
      this.btProcess.stdout.on('data', (d) => {
        const text = d.toString().trim();
        if (text && text !== 'READY') onDataCallback(text);
      });
      return true;
    }
    return false;
  }

  sendBluetoothData(event, payload) {
    if (this.btProcess && !this.btProcess.killed) {
      const line = JSON.stringify({ event, payload }) + '\n';
      this.btProcess.stdin.write(line);
    }
  }
}

module.exports = SystemControl;
