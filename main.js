const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path    = require('path');
const license = require('./license');

let mainWindow    = null;
let licenseWindow = null;

app.whenReady().then(() => {
  const result = license.checkLicense();
  if (result.ok) {
    openMain(result.data);
  } else {
    openActivation();
  }
});

function openMain(licenseData) {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'ILI Correlation Workbench V0.2.7',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openActivation() {
  licenseWindow = new BrowserWindow({
    width: 560, height: 520,
    resizable: false,
    title: 'License Activation',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  licenseWindow.loadFile('license-screen.html');
  licenseWindow.on('closed', () => {
    licenseWindow = null;
    if (!mainWindow) app.quit();
  });
}

ipcMain.handle('license:activate', async (_, rawKey) => {
  const result = license.activateLicense(rawKey);
  if (result.ok) {
    if (licenseWindow) { licenseWindow.destroy(); licenseWindow = null; }
    openMain(result.data);
    return { ok: true };
  }
  return { ok: false, error: result.error };
});

ipcMain.handle('license:getMachineId', async () => license.getMachineId());
ipcMain.handle('license:get',          async () => license.getLicenseInfo());
ipcMain.handle('license:deactivate',   async () => {
  license.deactivateLicense();
  if (mainWindow) { mainWindow.destroy(); mainWindow = null; }
  openActivation();
  return { ok: true };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
