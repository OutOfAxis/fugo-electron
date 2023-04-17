// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
const { contextBridge, ipcRenderer } = require('electron')
let version;

ipcRenderer.invoke('getVersion').then(v => version = v);

contextBridge.exposeInMainWorld('FugoElectronBridge', {
  doScreenshot(url) {
    ipcRenderer.send('doScreenshot', url);
  },

  getVersion() {
    return version;
  }
})