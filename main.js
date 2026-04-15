const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path    = require('path');
const license = require('./license');

let mainWindow    = null;
let licenseWindow = null;
let splashWindow  = null;

// Force hardware GPU acceleration for smooth canvas rendering
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-hardware-overlays');

// ── Splash screen ─────────────────────────────────────────────────────────────
function showSplash(callback) {
  splashWindow = new BrowserWindow({
    width: 340, height: 280,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { nodeIntegration:false, contextIsolation:true },
    backgroundColor: '#0d1117',
    show: false,
  });

  splashWindow.loadFile('splash.html');

  // Wait until splash is fully painted before proceeding
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
    // Give the renderer one full frame to paint before we do heavy work
    setTimeout(callback, 200);
  });
}

function closeSplash() {
  if (splashWindow) {
    splashWindow.destroy();
    splashWindow = null;
  }
}

// ── License gate ──────────────────────────────────────────────────────────────
function checkAndGate() {
  // Show splash FIRST, then check license inside the callback
  // so the splash is guaranteed to be visible before any blocking work
  showSplash(() => {
    const result = license.checkLicense();
    if (result.ok) {
      openMainApp(result.data);
    } else if (result.reason === 'not_activated') {
      closeSplash();
      openLicenseWindow();
    } else if (result.reason === 'machine_mismatch') {
      closeSplash();
      showLicenseError(result.error, 'Machine Mismatch', true);
    } else if (result.reason === 'expired') {
      closeSplash();
      showLicenseError(result.error, 'License Expired', false);
    } else {
      closeSplash();
      showLicenseError(result.error || 'License verification failed.', 'License Error', true);
    }
  });
}

function showLicenseError(message, title, allowRetry) {
  const buttons = allowRetry ? ['Enter New Key', 'Quit'] : ['Quit'];
  dialog.showMessageBox({ type:'error', title, message:title, detail:message, buttons })
    .then(({ response }) => {
      if (allowRetry && response === 0) openLicenseWindow();
      else app.quit();
    });
}

// ── License activation window ─────────────────────────────────────────────────
function openLicenseWindow() {
  if (licenseWindow) { licenseWindow.focus(); return; }
  licenseWindow = new BrowserWindow({
    width:560, height:520, resizable:false,
    title:'ILI Correlation Workbench — License Activation',
    icon: path.join(__dirname,'assets','icon.png'),
    webPreferences:{
      nodeIntegration:false, contextIsolation:true,
      preload: path.join(__dirname,'preload.js'),
    },
    backgroundColor:'#0d1117', show:false, autoHideMenuBar:true,
  });
  licenseWindow.loadFile('license-screen.html');
  licenseWindow.once('ready-to-show', () => licenseWindow.show());
  licenseWindow.on('closed', () => { licenseWindow=null; if(!mainWindow) app.quit(); });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('license:activate', async (_, rawKey) => {
  const result = license.activateLicense(rawKey);
  if (result.ok) {
    if (licenseWindow) { licenseWindow.destroy(); licenseWindow=null; }
    showSplash(() => openMainApp(result.data));
    return { ok:true };
  }
  return { ok:false, error:result.error };
});

ipcMain.handle('license:getMachineId', async () => license.getMachineId());
ipcMain.handle('license:get',          async () => license.getLicenseInfo());
ipcMain.handle('license:deactivate',   async () => {
  license.deactivateLicense();
  if (mainWindow) { mainWindow.destroy(); mainWindow=null; }
  openLicenseWindow();
  return { ok:true };
});

// ── Main application window ───────────────────────────────────────────────────
function openMainApp(licenseData) {
  if (mainWindow) { mainWindow.focus(); closeSplash(); return; }

  mainWindow = new BrowserWindow({
    width:1600, height:1000, minWidth:1024, minHeight:700,
    title:`ILI Correlation Workbench V0.2.7 — ${licenseData?.name||''}`,
    icon: path.join(__dirname,'assets','icon.png'),
    webPreferences:{
      nodeIntegration:false, contextIsolation:true,
      preload: path.join(__dirname,'preload.js'),
    },
    backgroundColor:'#090c10',
    show: false,
  });

  mainWindow.loadFile('index.html');

  // Keep splash visible until main window is fully ready, then crossfade
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    shell.openExternal(url);
    return { action:'deny' };
  });

  mainWindow.on('closed', () => { mainWindow=null; });
  buildMenu(licenseData);
}

// ── Menu ──────────────────────────────────────────────────────────────────────
function buildMenu(licenseData) {
  const isMac = process.platform==='darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac?[{label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'quit'}]}]:[]),
    {label:'File',submenu:[
      {label:'Reload',accelerator:'CmdOrCtrl+R',click:(_,w)=>w?.reload()},
      {type:'separator'},
      {label:'License Info...',click:()=>showLicenseInfo(licenseData)},
      {type:'separator'},
      isMac?{role:'close'}:{role:'quit'},
    ]},
    {label:'Edit',submenu:[
      {role:'undo'},{role:'redo'},{type:'separator'},
      {role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'},
    ]},
    {label:'View',submenu:[
      {role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},
      {type:'separator'},{role:'togglefullscreen'},
      {type:'separator'},{
        label:'Developer Tools',
        accelerator:isMac?'Alt+Cmd+I':'Ctrl+Shift+I',
        click:(_,w)=>w?.webContents.toggleDevTools(),
      },
    ]},
  ]));
}

function showLicenseInfo(licenseData) {
  const machineId = license.getMachineId().substring(0,16)+'...';
  dialog.showMessageBox(mainWindow,{
    type:'info', title:'License Information',
    message:'ILI Correlation Workbench V0.2.7',
    detail:[
      `Licensed to: ${licenseData?.name||'—'}`,
      `Email:       ${licenseData?.email||'—'}`,
      `Expires:     ${licenseData?.expiry||'Never'}`,
      `Machine ID:  ${machineId}`,
      '','© 2026 C-Squared — Proprietary & Confidential',
    ].join('\n'),
    buttons:['OK','Deactivate License'],
  }).then(({response})=>{
    if(response===1){
      dialog.showMessageBox(mainWindow,{
        type:'warning',title:'Deactivate License',
        message:'Deactivate this machine?',
        detail:'This removes the license from this machine. You will need your key to re-activate.',
        buttons:['Cancel','Deactivate'],defaultId:0,cancelId:0,
      }).then(({response:r})=>{
        if(r===1){
          license.deactivateLicense();
          mainWindow?.destroy(); mainWindow=null;
          openLicenseWindow();
        }
      });
    }
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(()=>{
  checkAndGate();
  app.on('activate',()=>{
    if(!mainWindow&&!licenseWindow&&!splashWindow) checkAndGate();
  });
});

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin') app.quit();
});
