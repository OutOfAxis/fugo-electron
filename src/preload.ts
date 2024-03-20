const { contextBridge, ipcRenderer } = require('electron')
let version: string = ''

ipcRenderer.invoke('getVersion').then((v) => (version = v))

const websites = {}
let fugoElectronBridgeInstance: FugoElectronBridge = {
  setKiosk(isEnabled: boolean) {
    console.log('Received kiosk message', isEnabled)
    ipcRenderer.invoke('setKiosk', isEnabled)
  },

  doScreenshot(url) {
    ipcRenderer.send('doScreenshot', url)
  },

  getVersion() {
    console.log('VERSION')
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
    ipcRenderer.invoke(
      'prepareWebsite',
      url,
      code,
      orientation,
      x,
      y,
      width,
      height,
      id
    )
  },

  displayWebsite(id: string) {
    ipcRenderer.invoke('displayWebsite', id)
  },

  destroyWebsite(id: string) {
    ipcRenderer.invoke('destroyWebsite', id)
  },

  prepareWebsiteFullscreen(url: string, code: string, orientation: number) {
    console.log('ipcRenderer.invoke prepareWebsiteFullscreen')
    ipcRenderer.invoke('prepareWebsiteFullscreen', url, code, orientation)
  },

  displayWebsiteFullscreen() {
    ipcRenderer.invoke('displayWebsiteFullscreen')
  },

  destroyWebsiteFullscreen() {
    ipcRenderer.invoke('destroyWebsiteFullscreen')
  },

  getSystemMemoryInfo() {
    return process.getSystemMemoryInfo()
  },

  getPlatform() {
    return process.platform
  },
}

contextBridge.exposeInMainWorld(
  'FugoElectronBridge',
  fugoElectronBridgeInstance
)

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
  setKiosk(isEnabled: boolean): void
  getSystemMemoryInfo(): { total: number; free: number }
  getPlatform(): NodeJS.Platform
}
