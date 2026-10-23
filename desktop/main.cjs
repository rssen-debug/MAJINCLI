const { app, BrowserWindow, Menu, session, dialog, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { hostOrigin, sameOrigin, restoreBounds } = require('./policy.cjs');
if (process.env.MAJIN_V4_DESKTOP_PROFILE) app.setPath('userData', path.resolve(process.env.MAJIN_V4_DESKTOP_PROFILE));

let window;
let retry;
let quitting = false;
let connecting = false;
let launchAttempted = false;
const origin = hostOrigin(process.env.MAJIN_V4_DESKTOP_URL);
const hostRoot = app.isPackaged ? path.join(process.resourcesPath, 'host') : path.resolve(__dirname, '..');
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.restore(); window?.show(); window?.focus(); });
  app.whenReady().then(boot).catch((err) => {
    dialog.showErrorBox('MAJIN V4', err.message);
    app.quit();
  });
}

async function healthy() {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
    const body = await response.json();
    return response.ok && body.ok === true && body.app === 'majin' && /^4\./.test(body.version);
  } catch { return false; }
}

function startHost() {
  if (launchAttempted || new URL(origin).protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) return;
  if (process.env.MAJIN_V4_DESKTOP_NO_HOST === '1') return;
  launchAttempted = true;
  const nodeExecutable = app.isPackaged ? path.join(hostRoot, 'runtime/node.exe') : 'node';
  const child = spawn(nodeExecutable, [path.join(hostRoot, 'scripts/v4/desktop-host.mjs'),
    '--port', new URL(origin).port || '80', '--host', new URL(origin).hostname], {
    cwd: hostRoot,
    env: process.env,
    detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  child.on('message', (message) => {
    if (message?.type === 'pairing' && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(message.code || '')) {
      dialog.showMessageBox(window, { type: 'info', title: 'Pair MAJIN V4',
        message: 'Your one-time pairing code', detail: message.code + '\nEnter it in MAJIN on your trusted devices. Keep this code private.' });
    }
  });
  child.on('error', (err) => dialog.showErrorBox('MAJIN host', err.message));
  child.unref();
}

async function connect() {
  if (quitting || connecting || window?.isDestroyed()) return;
  connecting = true;
  try {
    if (await healthy()) {
      await window.loadURL(origin);
      window.setTitle(`MAJIN V4 — ${app.getVersion()}`);
    } else {
      startHost();
      if (!window.webContents.getURL().startsWith('file:')) await window.loadFile(path.join(__dirname, 'offline.html'));
      clearTimeout(retry);
      retry = setTimeout(connect, 2000);
    }
  } finally { connecting = false; }
}

async function boot() {
  app.setAppUserModelId('com.majin.v4');
  const partition = session.fromPartition('persist:majin-v4');
  partition.setPermissionCheckHandler((_contents, _permission, _requestOrigin) => false);
  partition.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    if (!sameOrigin(contents.getURL(), origin) || !sameOrigin(details.requestingUrl || '', origin)
      || details.isMainFrame === false || permission !== 'media'
      || details.mediaTypes?.some((type) => type !== 'audio')) return callback(false);
    const result = await dialog.showMessageBox(window, {
      type: 'question', buttons: ['Allow microphone', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Allow MAJIN to use your microphone for this request?',
    });
    callback(result.response === 0);
  });
  // A server-provided filename is a suggestion. The user selects every destination.
  partition.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: 'Save MAJIN output' });
  });
  let saved;
  try { saved = JSON.parse(fs.readFileSync(boundsFile(), 'utf8')); } catch { /* first launch */ }
  window = new BrowserWindow({
    ...restoreBounds(saved, screen.getAllDisplays()),
    minWidth: 400, minHeight: 400, title: 'MAJIN V4', backgroundColor: '#100c19',
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(hostRoot, 'src/v4/ui/icons/icon-512.png'),
    webPreferences: { partition: 'persist:majin-v4', nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false },
  });
  if (saved?.maximized) window.maximize();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url, origin)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!sameOrigin(url, origin)) event.preventDefault();
  });
  window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
    if (mainFrame && code !== -3) {
      clearTimeout(retry);
      retry = setTimeout(connect, 2000);
    }
  });
  window.on('close', () => {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const temp = `${boundsFile()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized() }));
    fs.renameSync(temp, boundsFile());
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'MAJIN', submenu: [{ label: 'Reconnect', click: connect }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  await connect();
}

app.on('before-quit', () => { quitting = true; clearTimeout(retry); });
app.on('window-all-closed', () => app.quit());
