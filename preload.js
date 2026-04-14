const { contextBridge, ipcRenderer } = require('electron');

// Expose only the specific license API to the renderer — no full Node access
contextBridge.exposeInMainWorld('licenseAPI', {
  activate:    (key)  => ipcRenderer.invoke('license:activate', key),
  getMachineId: ()    => ipcRenderer.invoke('license:getMachineId'),
  get:          ()    => ipcRenderer.invoke('license:get'),
  deactivate:   ()    => ipcRenderer.invoke('license:deactivate'),
});
