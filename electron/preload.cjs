// The only bridge between the web app and the desktop shell: print and save-as-PDF. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('starsysDesktop', {
  print: (opts) => ipcRenderer.invoke('print:run', opts),
  savePdf: (opts) => ipcRenderer.invoke('print:pdf', opts)
});
