// Electron main process: opens the built web app (dist/index.html) in a desktop window.
// The app talks to Supabase over the network exactly like the web version; only the UI,
// fonts and icons are bundled for offline loading.
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const { register: registerPrinting } = require('./printing.cjs');
const path = require('path');

// Windows needs this for notifications to show the app name and icon (matches appId in electron-builder.yml).
if (process.platform === 'win32') app.setAppUserModelId('com.starsys.financialreporting');

const isHttp = (u) => /^https?:\/\//i.test(u);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 600,
    title: 'Starsys',
    backgroundColor: '#141210',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Links that would leave the app open in the user's browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (isHttp(url)) shell.openExternal(url);
    }
  });
}

// One window at a time: a second launch focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    registerPrinting(ipcMain);
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
