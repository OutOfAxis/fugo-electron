Package
```
npx electron-packager . --overwrite --icon=./src/assets/icon.ico
```

Rename \fugo-cms-windows-player-win32-ia32\fugo-cms-windows-player.exe to \fugo-cms-windows-player-win32-ia32\fugo.exe

```
electron-windows-store `
    --input-directory C:\Users\atn\Downloads\fugo-electron\fugo-cms-windows-player-win32-ia32 `
    --output-directory C:\Users\atn\Downloads\fugo-electron\output\fugo-cms-windows-player-win32-ia32 `
    --package-version 1.0.0.0 `
    --package-name fugo `
    --publisher-display-name "Outofaxis Limited" `
    --package-description "Fugo is easy digital signage software that takes the frustration and expense out of managing your screens and content." `
    --identity-name "OutofaxisLimted.FugoDigitalSignagePlayer" `
    --package-display-name "Fugo – Digital Signage Player"
```

```
    C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x86

```