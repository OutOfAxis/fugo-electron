const { app, BrowserWindow, Tray } = require('electron')
const path = require('path')

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

  const iconPath = path.join(__dirname, 'icon.ico')
  tr = new Tray(iconPath)
  tr.addListener('click', () => {
    show()
  })

  const webPlayerURL = 'https://pixelart-web.netlify.com'
  mainWindow.loadURL(webPlayerURL)

  mainWindow.webContents.on('dom-ready', () => {
    // we can't just set BrowserWindow.setFullscreen(true) because HTML5 fullscreen API will stop working
    mainWindow.webContents.executeJavaScript(
      'document.documentElement.requestFullscreen()',
      true
    )
  })

  mainWindow.webContents.on('crashed', e => {
    console.error(e)
    reloadWebPlayer()
  })

  mainWindow.webContents.on('unresponsive', e => {
    console.error(e)
    reloadWebPlayer()
  })

  function reloadWebPlayer() {
    app.relaunch()
    app.exit(0)
  }

  // mainWindow.webContents.openDevTools()

  mainWindow.on('closed', function() {
    mainWindow = null
  })

  mainWindow.on('close', e => {
    e.preventDefault()
    mainWindow.hide();
  });
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
