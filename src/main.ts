import {
  IpcMainInvokeEvent,
  NativeImage,
  nativeImage,
  powerSaveBlocker,
  screen,
} from 'electron'
import { Settings } from './settings'

const { mouse, Point } = require('@nut-tree/nut-js')
const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron')
const path = require('path')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')
const fetch = require('node-fetch')

log.transports.file.level = 'debug'
autoUpdater.logger = log
let shouldQuitForUpdate = false
autoUpdater.on('update-downloaded', () => {
  shouldQuitForUpdate = true
  autoUpdater.quitAndInstall()
})

const id = powerSaveBlocker.start('prevent-display-sleep')
console.log('Started power block: ' + powerSaveBlocker.isStarted(id))

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: Electron.BrowserWindow | null = null
let tr

async function createWindow() {
  const isKiosk = (await Settings.get()).isKiosk
  console.log(`Kiosk settings: ${isKiosk}`)
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
      allowRunningInsecureContent: true,
      autoplayPolicy: 'no-user-gesture-required',
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    kiosk: isKiosk,
    alwaysOnTop: true,
    show: false,
  })

  const iconPath = path.join(__dirname, 'assets/icon.png')
  const iconImage = nativeImage.createFromPath(iconPath)
  tr = new Tray(iconImage.resize({ width: 16, height: 16 }))

  tr.addListener('click', () => {
    show()
  })
  tr.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'About',
        role: 'about',
      },
      {
        label: 'Quit',
        click() {
          app.exit(0)
        },
      },
    ])
  )

  const webPlayerURL = `https://player.fugo.ai/`
  mainWindow.loadURL(webPlayerURL)
  mainWindow.setAlwaysOnTop(isKiosk, 'screen-saver')
  mainWindow.show()

  mainWindow.webContents.on('dom-ready', goFullscreen)

  // set safe guards after a while to avoid infinite reload
  setTimeout(() => setSafeGuards(mainWindow, app), 1000 * 60 * 10)

  // mainWindow.webContents.openDevTools()

  mainWindow.on('maximize', () => {
    goFullscreen()
  })

  mainWindow.on('closed', function () {
    mainWindow = null
  })

  mainWindow.on('close', async (e: Electron.Event) => {
    if (shouldQuitForUpdate) return

    const isKiosk = (await Settings.get()).isKiosk
    if (!isKiosk) return

    e.preventDefault()
  })

  ipcMain.on('doScreenshot', handleDoScreenshot)
  ipcMain.handle('getVersion', handleGetVersion)
  ipcMain.handle('setKiosk', handleSetKiosk)

  ipcMain.handle('prepareWebsite', handlePrepareWebsite)
  ipcMain.handle('displayWebsite', handleDisplayWebsite)
  ipcMain.handle('destroyWebsite', handleDestroyWebsite)
  ipcMain.handle('prepareWebsiteFullscreen', handlePrepareWebsiteFullscreen)
  ipcMain.handle('displayWebsiteFullscreen', handleDisplayWebsiteFullscreen)
  ipcMain.handle('destroyWebsiteFullscreen', handleDestroyWebsiteFullscreen)

  autoUpdater.checkForUpdatesAndNotify()
  setInterval(() => {
    // https://stackoverflow.com/questions/67191654/problem-with-app-update-yml-files-is-not-generated-in-electron
    // https://github.com/electron-userland/electron-builder/issues/4233
    // not ideal, but the idea is that it's going to use app-update.yml on startup
    // and then use the feed url below if it's not available
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'OutOfAxis',
      repo: 'fugo-electron',
    })
    autoUpdater.checkForUpdatesAndNotify()
  }, 1000 * 60 * 60 * 1)
  await mouse.setPosition(new Point(0, screen.getPrimaryDisplay().size.height))
}

function goFullscreen() {
  console.log('Go fullscreen')
  // we can't just set BrowserWindow.setFullscreen(true) because HTML5 fullscreen API will stop working
  mainWindow.webContents.executeJavaScript(
    'document.documentElement.requestFullscreen()',
    true
  )
}

let preparingFullscreenWebsiteId = ''
let displayingFullscreenWebsiteId = ''
let displayWebsites: { [keys: string]: Electron.BrowserWindow } = {}
function handlePrepareWebsite(
  event: any,
  url: string,
  code: string,
  orientation: number,
  x: number,
  y: number,
  width: number,
  height: number,
  id: string
) {
  handlePrepareWebsiteFullscreen(event, url, code, orientation)
}

function handleDisplayWebsite(event: any, id: string) {
  handleDisplayWebsiteFullscreen(event)
}

function handleDestroyWebsite(event: any, id: string) {
  handleDestroyWebsiteFullscreen(event)
}

function handlePrepareWebsiteFullscreen(
  _event: any,
  url: string,
  code: string,
  orientation: number
) {
  console.log('handlePrepareWebsiteFullscreen')
  if (preparingFullscreenWebsiteId) {
    handleDestroyWebsiteFullscreen(_event, preparingFullscreenWebsiteId)
  }

  const id = Math.random().toString()
  preparingFullscreenWebsiteId = id
  console.log('preparing ' + id)

  displayWebsites[id] = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
      allowRunningInsecureContent: true,
      autoplayPolicy: 'no-user-gesture-required',
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    kiosk: app.isPackaged,
    alwaysOnTop: false,
    show: false,
    fullscreen: true,
  })
  displayWebsites[id].loadURL(url)

  displayWebsites[id].webContents.on('did-finish-load', () => {
    console.log('executeJavaScript')
    displayWebsites[id].webContents.executeJavaScript(code)
  })
}

function handleDisplayWebsiteFullscreen(_event: any) {
  console.log('handleDisplayWebsiteFullscreen' + preparingFullscreenWebsiteId)
  displayingFullscreenWebsiteId = preparingFullscreenWebsiteId
  preparingFullscreenWebsiteId = ''
  mainWindow.setAlwaysOnTop(false)
  mainWindow.hide()
  const websiteWindow = displayWebsites[displayingFullscreenWebsiteId]
  websiteWindow.show()
  websiteWindow.focus()
  websiteWindow.setAlwaysOnTop(true, 'screen-saver')
}

async function handleDestroyWebsiteFullscreen(_event: any, id: string = '') {
  if (!id) {
    id = displayingFullscreenWebsiteId
    displayingFullscreenWebsiteId = ''
  }
  console.log('destroy ' + id)
  const websiteWindow = displayWebsites[id]
  websiteWindow.setAlwaysOnTop(false)
  websiteWindow.hide()
  websiteWindow.close()
  websiteWindow.destroy()
  displayWebsites[id] = null
  delete displayWebsites[id]

  if (!preparingFullscreenWebsiteId) {
    const isKiosk = (await Settings.get()).isKiosk
    mainWindow.show()
    mainWindow.setAlwaysOnTop(isKiosk, 'screen-saver')
    mainWindow.focus()
  }
}

// autorun
app.setLoginItemSettings({
  openAtLogin: true,
})

app.on('ready', createWindow)

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function () {
  if (mainWindow === null) createWindow()
})

// single app
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    show()
  })
}

function show() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    mainWindow.show()
  }
}

// setup guards that will restart the app in case of freezed web player
function setSafeGuards(
  mainWindow: Electron.BrowserWindow,
  appGuarded: typeof app
) {
  mainWindow.webContents.on('crashed', (e: any) => {
    console.error(e)
    reloadWebPlayer(appGuarded)
  })

  mainWindow.webContents.on('unresponsive', (e: any) => {
    console.error(e)
    reloadWebPlayer(appGuarded)
  })

  console.log('Safe guards are set')
}

function reloadWebPlayer(appGuarded: typeof app) {
  appGuarded.relaunch()
  appGuarded.exit(0)
}

function handleDoScreenshot(event: any, url: string, headers: string) {
  const window =
    displayingFullscreenWebsiteId &&
    displayWebsites[displayingFullscreenWebsiteId]
      ? displayWebsites[displayingFullscreenWebsiteId]
      : mainWindow
  window.webContents.capturePage().then((image: NativeImage) => {
    fetch(url, {
      method: 'PUT',
      body: image.toJPEG(75),
      headers: parseJsonSafe(headers),
    })
  })
}

function parseJsonSafe(str: string) {
  let headers = {}
  try {
    headers = JSON.parse(str)
  } catch (e) {
    console.error('JSON parsing error', e)
  }
  return headers
}

function handleGetVersion() {
  return app.getVersion()
}

async function handleSetKiosk(event: IpcMainInvokeEvent, isEnabled: boolean) {
  const currentSettingsValue = (await Settings.get()).isKiosk
  console.log(
    `Setting kiosk to ${isEnabled}. Settings state: ${currentSettingsValue}. App state: ${mainWindow.isKiosk()}`
  )
  await Settings.set({ isKiosk: isEnabled })
  // avoid setting it to the same value because it breaks fullscreen mode
  // PlayerJS sets it to false on startup if player was unpaired before
  if (currentSettingsValue !== isEnabled) {
    mainWindow.setAlwaysOnTop(isEnabled, 'screen-saver')
    mainWindow.setKiosk(isEnabled)
  }
  goFullscreen()
}
