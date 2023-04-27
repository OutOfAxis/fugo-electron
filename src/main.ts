import { NativeImage } from 'electron'

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

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: Electron.BrowserWindow | null = null
let tr

function createWindow() {
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
    kiosk: app.isPackaged,
    alwaysOnTop: true,
    show: false,
  })

  const iconPath = path.join(__dirname, 'assets/icon.png')
  tr = new Tray(iconPath)
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

  const webPlayerURL = 'https://player.fugo.ai'
  mainWindow.loadURL(webPlayerURL)
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.show()

  mainWindow.webContents.on('dom-ready', () => {
    // we can't just set BrowserWindow.setFullscreen(true) because HTML5 fullscreen API will stop working
    mainWindow.webContents.executeJavaScript(
      'document.documentElement.requestFullscreen()',
      true
    )
  })

  // set safe guards after a while to avoid infinite reload
  setTimeout(() => setSafeGuards(mainWindow, app), 1000 * 60 * 10)

  // mainWindow.webContents.openDevTools()

  mainWindow.on('closed', function () {
    mainWindow = null
  })

  mainWindow.on('close', (e: Electron.Event) => {
    if (!shouldQuitForUpdate) {
      e.preventDefault()
    }
  })

  ipcMain.on('doScreenshot', handleDoScreenshot)
  ipcMain.handle('getVersion', handleGetVersion)

  ipcMain.handle('prepareWebsite', handlePrepareWebsite)
  ipcMain.handle('displayWebsite', handleDisplayWebsite)
  ipcMain.handle('destroyWebsite', handleDestroyWebsite)
  ipcMain.handle('prepareWebsiteFullscreen', handlePrepareWebsiteFullscreen)
  ipcMain.handle('displayWebsiteFullscreen', handleDisplayWebsiteFullscreen)
  ipcMain.handle('destroyWebsiteFullscreen', handleDestroyWebsiteFullscreen)

  autoUpdater.checkForUpdatesAndNotify()
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

function handleDestroyWebsiteFullscreen(_event: any, id: string = '') {
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
    mainWindow.show()
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
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

function handleDoScreenshot(event: any, url: string) {
  const window = displayingFullscreenWebsiteId && displayWebsites[displayingFullscreenWebsiteId] ? displayWebsites[displayingFullscreenWebsiteId] : mainWindow
  window.webContents.capturePage().then((image: NativeImage) => {
    fetch(url, {
      method: 'PUT',
      body: image.toJPEG(75),
    })
  })
}

function handleGetVersion() {
  return app.getVersion()
}
