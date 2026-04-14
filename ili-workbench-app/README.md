# ILI Correlation Workbench — Desktop App

**V0.2.7 | © 2026 C-Squared | Proprietary & Confidential**

A native desktop application wrapping the ILI Correlation Workbench using Electron.
Runs on **Windows**, **macOS**, and **Linux** with no browser or internet connection required.

---

## Prerequisites

Install **Node.js 18+** from https://nodejs.org (LTS recommended).

---

## Quick Start (run without building)

```bash
npm install
npm start
```

---

## Building Installers

### Windows — produces a portable `.exe` (no install, no admin rights needed)

```bash
npm install
npm run build:win
```
Output: `dist/ILI_Correlation_Workbench_V0.2.7.exe`

Just double-click to run — no installation wizard, no admin rights required.

### macOS — produces a `.dmg` disk image

```bash
npm install
npm run build:mac
```
Output: `dist/ILI Correlation Workbench-0.2.7.dmg`

> **Note for macOS:** If you need a signed app for distribution outside your team,
> you'll need an Apple Developer ID certificate. For internal use, right-click →
> Open to bypass Gatekeeper on first launch.

### Linux — produces `.AppImage` and `.deb`

```bash
npm install
npm run build:linux
```
Output: `dist/ILI Correlation Workbench-0.2.7.AppImage`

### All platforms at once (from macOS only — cross-compile)

```bash
npm run build:all
```

---

## File Structure

```
ili-workbench-app/
├── main.js          ← Electron main process (window, menu)
├── index.html       ← The full workbench application
├── package.json     ← Build config and dependencies
├── assets/
│   ├── icon.png     ← Linux icon (256×256)
│   ├── icon.ico     ← Windows icon (multi-size)
│   └── icon.icns    ← macOS icon
└── dist/            ← Built installers appear here
```

---

## Updating the App

To update to a new version of the workbench:

1. Replace `index.html` with the new version
2. Update `"version"` in `package.json`
3. Run the relevant `npm run build:*` command

---

## Notes

- All data stays **local** — no network requests are made by the app itself
- Session files (`.json.gz`) saved from the app are compatible with the browser version
- The app uses Electron's default sandboxed renderer — `nodeIntegration` is disabled
