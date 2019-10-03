const {app, BrowserWindow} = require('electron')

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {}
  })

  mainWindow.removeMenu()
  mainWindow.loadURL('https://pixelart-web.netlify.com')

  mainWindow.webContents.on('dom-ready', () => {
    // we can't just set BrowserWindow.setFullscreen(true) because HTML5 fullscreen API will stop working
    mainWindow.webContents.executeJavaScript('document.documentElement.requestFullscreen()', true)
  });

  // mainWindow.webContents.openDevTools()

  mainWindow.on('closed', function () {
    mainWindow = null
  })
}

app.on('ready', createWindow)

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function () {
  if (mainWindow === null) createWindow()
})