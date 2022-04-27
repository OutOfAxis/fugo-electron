const { app, BrowserWindow, Tray } = require('electron')
const path = require('path')
const { autoUpdater } = require("electron-updater")
const log = require("electron-log")

log.transports.file.level = "debug"
autoUpdater.logger = log
autoUpdater.on('update-downloaded', (info) => {
  autoUpdater.quitAndInstall();
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow
let tr

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {},
    autoHideMenuBar: true,
    // show: false, // turn on for .ge
  })

  const iconPath = path.join(__dirname, 'icon.png')
  tr = new Tray(iconPath)
  tr.addListener('click', () => {
    show()
  })

  const webPlayerURL = 'https://player.fugo.ai'
  mainWindow.loadURL(webPlayerURL)

  mainWindow.webContents.on('dom-ready', () => {
    // we can't just set BrowserWindow.setFullscreen(true) because HTML5 fullscreen API will stop working
    mainWindow.webContents.executeJavaScript(
      'document.documentElement.requestFullscreen()',
      true
    )
  })

  // set safe guards after a while to avoid infinite reload
  setTimeout(() => setSafeGuards(mainWindow, app), 1000 * 60 * 10);

  // mainWindow.webContents.openDevTools()

  mainWindow.on('closed', function() {
    mainWindow = null
  })

  mainWindow.on('close', e => {
    e.preventDefault()
    mainWindow.hide();
  });

  autoUpdater.checkForUpdatesAndNotify()
}

// autorun
app.setLoginItemSettings({
  openAtLogin: true,
});

app.on('ready', createWindow)

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function() {
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
function setSafeGuards(mainWindow, app) {
  mainWindow.webContents.on('crashed', e => {
    console.error(e)
    reloadWebPlayer(app)
  })

  mainWindow.webContents.on('unresponsive', e => {
    console.error(e)
    reloadWebPlayer(app)
  })

  console.log('Safe guards are set')
}

function reloadWebPlayer(app) {
  app.relaunch()
  app.exit(0)
}