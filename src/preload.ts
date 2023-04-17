const { contextBridge, ipcRenderer } = require('electron')
let version: string = ''

ipcRenderer.invoke('getVersion').then((v) => (version = v))

const websites = {}
let fugoElectronBridgeInstance: FugoElectronBridge = {
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
}
