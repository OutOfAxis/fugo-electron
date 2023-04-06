alert('HIA')

// All of the Node.js APIs are available in the preload process.
import { BrowserWindow } from 'electron'

// It has the same sandbox as a Chrome extension.
const { contextBridge, ipcRenderer } = require('electron')
let version

ipcRenderer.invoke('getVersion').then((v) => (version = v))

const websites = {}
const fugoElectronBridge: FugoElectronBridge = {
  doScreenshot(url) {
    ipcRenderer.send('doScreenshot', url)
  },

  getVersion() {
    return version
  },

  prepareWebsite(
    url: string,
    code: string,
    orientation: number,
    x: number,
    y: number,
    width: number,
    height: number,
    id: string
  ) {
    this.prepareWebsiteFullscreen(url, code, orientation)
  },

  prepareWebsiteFullscreen(url: string, code: string, orientation: number) {
    const id = 'fullscreen'
    websites[id] = new BrowserWindow({
      webPreferences: { offscreen: true },
      show: false,
    })
    websites[id].loadURL(url)

    websites[id].webContents.on('did-finish-load', () => {
      websites[id].webContents.executeJavaScript(code)
    })
  },

  displayWebsiteFullscreen() {
    const id = 'fullscreen'
    websites[id].show()
  },

  displayWebsite(id: string) {
    this.displayWebsiteFullscreen()
  },

  destroyWebsiteFullscreen() {
    const id = 'fullscreen'
    websites[id].destroy()
  },

  destroyWebsite(id: string) {
    this.destroyWebsiteFullscreen()
  },
}

contextBridge.exposeInMainWorld('FugoElectronBridge', fugoElectronBridge)
debugger
console.log(
  '%c FugoElectronBridge is exposed to the window object',
  'color: green; font-size: 20px;'
)

type FugoElectronBridge = {
  getVersion: () => string
  doScreenshot(url: string): void
} & DisplayWebsite

interface DisplayWebsite {
  prepareWebsite(
    url: string,
    code: string,
    orientation: number,
    x: number,
    y: number,
    width: number,
    height: number,
    id: string
  ): void
  prepareWebsiteFullscreen(url: string, code: string, orientation: number): void
  displayWebsiteFullscreen: () => void
  displayWebsite: (id: string) => void
  destroyWebsiteFullscreen: () => void
  destroyWebsite: (id: string) => void
}
