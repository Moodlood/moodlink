const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('moodlink', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Server info
  getPort: () => ipcRenderer.invoke('server:getPort'),
  getIP: () => ipcRenderer.invoke('server:getIP'),

  // Screen capture
  getDesktopSources: () => ipcRenderer.invoke('desktop:getSources'),

  // Tray
  updateTrayStatus: (status) => ipcRenderer.send('tray:updateStatus', status),

  // Event listeners
  on: (channel, callback) => {
    const validChannels = ['device:connected', 'device:disconnected', 'file:received', 'clipboard:received'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  // Platform info
  platform: process.platform
});
