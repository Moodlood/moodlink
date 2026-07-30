<h1 align="center">
  <img src="desktop/assets/icon.png" width="120" alt="MoodLink Logo"><br>
  MoodLink
</h1>

<p align="center">
  <b>A high-performance, bidirectional remote control ecosystem connecting Windows PCs and Android devices.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Android-blue?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/Stack-React%20Native%20%7C%20Electron-brightgreen?style=flat-square" alt="Stack">
  <img src="https://img.shields.io/badge/License-MIT-purple?style=flat-square" alt="License">
</p>

---

## 🌟 Overview

MoodLink goes beyond basic remote control apps by offering deep system integration, true two-way communication, and low-latency multimedia streaming over your local network.

Whether you're controlling media playback from the couch, giving a presentation using your phone as a laser pointer, or streaming your PC screen directly to your mobile device, MoodLink provides a seamless, zero-configuration experience.

## ✨ Features

- **🖱️ Remote Trackpad:** Transform your Android touchscreen into a highly responsive laptop-style trackpad with two-finger scrolling.
- **🖥️ Screen Mirroring:** Low-latency, Peer-to-Peer WebRTC desktop streaming directly to your phone.
- **🎙️ Two-Way Audio:** Force the PC's microphone on, or manage advanced audio mixing dynamically.
- **📊 System Monitoring:** Live telemetry for CPU, RAM, and Battery usage.
- **📱 Presentation Mode:** Hook into your phone's gyroscope to use it as a 3D laser pointer on your PC screen.
- **📋 Bi-directional Clipboard:** Seamlessly sync text between your PC and phone.
- **📁 File Transfer:** Wirelessly blast files from your phone directly to the PC's Downloads folder.
- **⚡ Background Persistence:** A native Android foreground service prevents aggressive battery-saving policies from killing your connection.

## 🏗️ Architecture & Technology Stack

The ecosystem is structured as a monorepo containing two independent codebases communicating via an embedded local server.

### Desktop Application (The Host)
- **Framework:** Electron (Node.js runtime)
- **Frontend:** Vanilla JavaScript, HTML, CSS (for ultra-low overhead)
- **Backend Server:** Express.js + Socket.io (Runs locally inside the Electron app)
- **System Integration:** Windows PowerShell (Asynchronous), Native OS APIs
- **Media:** WebRTC (Peer-to-Peer streaming), Electron `desktopCapturer`

### Mobile Application (The Remote)
- **Framework:** React Native + Expo
- **Networking:** `socket.io-client` v4
- **Media:** `react-native-webrtc`
- **Native Modules:** `expo-sensors`, `expo-clipboard`, `@notifee/react-native` (Foreground services)

*For a detailed technical breakdown, please refer to the [Architecture Document](MOODLINK_ARCHITECTURE.md).*

## 🚀 Getting Started

To get started, you'll need to run both the Desktop and Mobile applications locally on the same network.

### Prerequisites
- Node.js (v18+)
- Expo CLI
- A Windows PC (Host)
- An Android device (Remote) or Android Emulator

### 1. Running the Desktop App

```bash
# Clone the repository
git clone https://github.com/your-username/moodlink.git
cd moodlink

# Install dependencies
npm install

# Start the Electron development server
npm run dev
```
*The desktop app will launch and display a pairing QR code.*

### 2. Running the Mobile App

```bash
# Open a new terminal tab and navigate to the mobile directory
cd mobile

# Install dependencies
npm install

# Start the Expo development server
npm start
```
*Use the Expo Go app on your Android device (or an emulator) to scan the Expo QR code in your terminal to launch the mobile app.*

### 3. Pairing

1. Make sure both your PC and Android device are connected to the **same Wi-Fi network**.
2. Open the MoodLink Mobile App.
3. Tap **Connect** and scan the QR code displayed on the MoodLink Desktop App.
4. You are now connected!

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. By participating in this project, you agree to abide by our code of conduct.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
