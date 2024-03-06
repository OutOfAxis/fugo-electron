# Fugo Windows Player

This is Electron wrapper for [Fugo Web Player](https://player.fugo.ai) ([source](git@github.com:OutOfAxis/pixelart-cms-web-player.git))

## Development

```
npm start
```

Also uncomment `mainWindow.webContents.openDevTools()` to see the dev tools.

## Distrubition

### Windows

Creating an executable installer:

```
npm run dist
```

### Mac

```
npm run dist-w
```

Create .env file in the root with

```
APPLEID=atn@marsel.name
APPLEIDPASS=
```

Get the [App Specific password](https://support.apple.com/en-us/102654) for APPLEIDPASS variable.
