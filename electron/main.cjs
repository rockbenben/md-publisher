const { app, BrowserWindow, utilityProcess, dialog, Menu, shell, session, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { createRestartPolicy } = require('./supervisor.cjs');
const { buildTray } = require('./tray.cjs');
const { checkForUpdate } = require('./update-check.cjs');

const SERVER = path.join(__dirname, '..', 'src', 'gui.js');
const PORT = Number(process.env.PORT) || 9870;
// Loopback literal (not `localhost`): the server binds 127.0.0.1 only, so this
// avoids depending on how `localhost` resolves to ::1 vs 127.0.0.1.
const APP_URL = `http://127.0.0.1:${PORT}`;
const HANDSHAKE_URL = `${APP_URL}/api/handshake`;

let win = null;
let serverProc = null;
let windowCreated = false;
// Held at module scope on purpose: an unreferenced Tray can be garbage
// collected, which silently removes the icon from the system tray.
let tray = null;
let restartTimer = null;
let updateTimer = null;
// Bounded renderer-crash recovery; see the render-process-gone handler.
let rendererDeaths = 0;
const policy = createRestartPolicy();
app.isQuitting = false;

// Per-boot secret shared with the server child. It proves that whoever answered
// on PORT is really our child: a port collision with some unrelated process
// then fails the handshake instead of loading that process's page into our
// window (which would carry our preload).
const HANDSHAKE_TOKEN = crypto.randomBytes(32).toString('hex');

// The child's stdio is piped to a log file so the startup-failure dialog can
// point the user at something real — a packaged Windows app has no terminal,
// so without this a crash before the window exists is undiagnosable.
let logStream = null;
function logFilePath() {
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'md-publisher.log');
  } catch {
    return null;
  }
}
function initLog() {
  const p = logFilePath();
  if (!p) return null;
  try {
    logStream = fs.createWriteStream(p, { flags: 'a' });
    logStream.write(`\n===== md-publisher started ${new Date().toISOString()} =====\n`);
    return p;
  } catch {
    return null;
  }
}
function writeLog(chunk) {
  try { if (logStream) logStream.write(chunk); } catch { /* logging must never throw */ }
}

function postCloseBrowser() {
  const req = http.request(`${APP_URL}/api/close-browser`, { method: 'POST' }, (res) => res.resume());
  req.on('error', () => {});
  req.end();
}

function clearRestartTimer() {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
}

function clearUpdateTimer() {
  if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
}

function quitApp() {
  app.isQuitting = true;
  // Never let a pending supervised respawn fire after we decided to quit — it
  // would fork a child that outlives the app and keeps holding the port.
  clearRestartTimer();
  clearUpdateTimer();
  let called = false;
  const done = () => { if (called) return; called = true; try { app.quit(); } catch {} };
  if (serverProc) {
    const force = setTimeout(done, 4000);
    serverProc.once('exit', () => { clearTimeout(force); done(); });
    try { serverProc.postMessage({ type: 'shutdown' }); } catch { done(); }
  } else {
    done();
  }
}

function reloadWindow() {
  if (!win) return;
  win.reload();
}

function restartServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch { /* already gone */ }
    serverProc = null;
  }
  clearRestartTimer();
  policy.reset();
  startServer();
}

function openLogFile() {
  const p = logFilePath();
  if (!p || !fs.existsSync(p)) {
    dialog.showMessageBox({ type: 'info', message: '暂无日志文件', detail: `未找到日志：${p || '(日志目录不可用)'}` });
    return;
  }
  shell.openPath(p);
}

// One unauthenticated GET to the GitHub API; nothing about the user is sent.
// Announced, never applied — see update-check.cjs for why.
async function notifyUpdate() {
  const info = await checkForUpdate();
  if (!info || !info.newer) return;
  const n = new Notification({
    title: 'md-publisher 有新版本',
    body: `v${info.latest} 已发布（当前 v${info.current}）。点击前往下载页。`,
  });
  n.on('click', () => { shell.openExternal(info.url); });
  n.show();
}

// Tray menu path: always reports an outcome, including "could not reach
// GitHub", so a silent click is never mistaken for "already up to date".
async function manualUpdateCheck() {
  const info = await checkForUpdate();
  const newer = info && info.newer;
  const options = newer
    ? { type: 'info', message: `发现新版本 v${info.latest}`,
        detail: `当前 v${info.current}。是否打开下载页？`,
        buttons: ['打开下载页', '稍后'], defaultId: 0, cancelId: 1 }
    : { type: 'info', message: '已是最新版本',
        detail: info ? `当前 v${info.current}。` : '未能连接 GitHub，请稍后再试。' };
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (newer && result.response === 0) shell.openExternal(info.url);
}

function createWindow() {
  if (windowCreated) {
    if (win) { win.show(); win.reload(); }
    return;
  }
  windowCreated = true;
  // Hide the native menu bar (no File/Edit/View… chrome). On Windows/Linux this
  // removes it entirely (Alt won't reveal it); on macOS the minimal app menu
  // remains as required by the OS.
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    // Measured: the shell is ~1156w × ~1167h, and the viewport here is
    // 1186 × 883. So the window shows everything down to the publish button,
    // with the log panel below the fold — it does NOT fit without scrolling.
    // The minimums keep it usable when resized down.
    width: 1200,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'md-publisher',
    // Electron 44 window-state persistence. With a unique `name`, bounds and
    // display mode are saved on quit and restored next launch. Without it the
    // window snaps back to the sizes below on every launch, throwing away the
    // user's resize — those values then only apply on first run.
    name: 'md-publisher-main',
    windowStatePersistence: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Pin it explicitly rather than relying on the Electron major's default,
      // so the renderer stays sandboxed across upgrades.
      sandbox: true,
    },
  });
  win.loadURL(APP_URL);
  // The SPA links out with target="_blank". Without a handler each click
  // spawned a NEW native window that inherited the app's preload — an
  // unexpected chrome window with app privileges. Deny in-app navigation to
  // anything that isn't our own server, and hand real external links to the
  // system browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\/127\.0\.0\.1(:\d+)?\//.test(url) || /^https?:\/\/localhost(:\d+)?\//.test(url)) {
      return { action: 'deny' };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== APP_URL && !url.startsWith(APP_URL)) event.preventDefault();
  });
  // The server child is independent of the renderer, so a crashed renderer is
  // recoverable with a reload. Without this the tray app keeps running with a
  // permanently blank window and no hint that anything went wrong. Bounded
  // like the server supervisor — a renderer that dies on every load would
  // otherwise spin forever.
  win.webContents.on('render-process-gone', (_event, details) => {
    writeLog(`renderer gone: reason=${details.reason} exitCode=${details.exitCode}\n`);
    if (details.reason === 'clean-exit' || app.isQuitting) { rendererDeaths = 0; return; }
    if (++rendererDeaths > 3) {
      rendererDeaths = 0;
      dialog.showErrorBox('md-publisher', `界面反复崩溃（${details.reason}），已停止自动重载。可从托盘菜单重试，详情见日志。\n\n日志：${logFilePath() || '不可用'}`);
      return;
    }
    if (win && !win.isDestroyed()) { win.show(); win.reload(); }
  });
  win.webContents.on('did-finish-load', () => { rendererDeaths = 0; });
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

/**
 * Probe the server with the handshake token until it answers or the deadline
 * passes. Deliberately NOT a plain GET /: an unrelated process bound to PORT
 * would answer that, and we would then load its page with our preload attached.
 */
function waitForServer(deadline, cb) {
  const req = http.get(HANDSHAKE_URL, { headers: { 'x-mdpub-token': HANDSHAKE_TOKEN }, timeout: 3000 }, (res) => {
    res.resume();
    const ok = res.statusCode === 200;
    req.destroy();
    cb(ok);
  });
  req.on('error', () => {
    if (Date.now() >= deadline) return cb(false);
    setTimeout(() => waitForServer(deadline, cb), 300);
  });
  req.on('timeout', () => {
    req.destroy();
    if (Date.now() >= deadline) return cb(false);
    setTimeout(() => waitForServer(deadline, cb), 300);
  });
}

function startServer() {
  if (app.isQuitting) return;
  const startedAt = Date.now();
  serverProc = utilityProcess.fork(SERVER, [], {
    env: {
      ...process.env,
      NO_OPEN: '1',
      PORT: String(PORT),
      MDPUB_DATA_DIR: app.getPath('userData'),
      MDPUB_TOKEN: HANDSHAKE_TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout?.on('data', writeLog);
  serverProc.stderr?.on('data', writeLog);
  serverProc.on('message', (msg) => {
    if (!msg) return;
    // Only trust our own child: it echoes the token we generated.
    if (msg.type === 'listening') {
      if (msg.token && msg.token !== HANDSHAKE_TOKEN) return;
      createWindow();
    } else if (msg.type === 'request-quit') {
      quitApp();
    }
  });
  serverProc.on('exit', (code) => {
    serverProc = null;
    if (app.isQuitting) return;
    const { restart, delayMs } = policy.recordExit(Date.now() - startedAt);
    if (restart) {
      clearRestartTimer();
      restartTimer = setTimeout(startServer, delayMs);
    } else {
      writeLog(`server exited permanently (code ${code})\n`);
      dialog.showErrorBox('md-publisher', `服务进程反复退出（code ${code}），已停止重启。请检查端口 ${PORT} 是否被占用。\n\n日志：${logFilePath() || '不可用'}`);
    }
  });
}

function start() {
  initLog();
  // The UI is a local SPA that only talks to 127.0.0.1 over HTTP; it never asks
  // for camera, microphone, geolocation or notifications. Denying by default
  // means a compromised renderer gets nothing. The file/folder pickers use the
  // File System Access API, which is driven by a user gesture and does not go
  // through the permissions API, so they keep working.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  startServer();
  // Fallback: if no 'listening' arrives within 20s, probe over HTTP (with the
  // handshake token) before creating the window.
  waitForServer(Date.now() + 20000, (ok) => {
    // Only fall back when the 'listening' message never produced a window —
    // otherwise this would needlessly reload a perfectly good one.
    if (ok && !windowCreated) createWindow();
    else if (!ok && !windowCreated) {
      dialog.showErrorBox('md-publisher', `服务启动超时，请查看日志文件：\n${logFilePath() || '（日志目录不可用）'}`);
    }
  });
  // Check once, well after startup: the window must never wait on the
  // network, and a failure here is never worth surfacing. Skipped in dev
  // so running from source does not nag about the published release.
  if (app.isPackaged) {
    updateTimer = setTimeout(() => { updateTimer = null; notifyUpdate(); }, 15000);
  }
  tray = buildTray({
    onShow: () => { if (win) { win.show(); win.focus(); } },
    onReload: reloadWindow,
    onRestartServer: restartServer,
    onCloseBrowser: postCloseBrowser,
    onOpenLog: openLogFile,
    onCheckUpdate: manualUpdateCheck,
    onQuit: quitApp,
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  // Windows uses this id for taskbar grouping and toast identity. Left unset the
  // app is grouped as plain Electron and its notifications carry no identity.
  app.setAppUserModelId('com.seldom.mdpublisher');
  app.whenReady().then(start);
  // Stay alive in the tray when the window is closed (all platforms).
  app.on('window-all-closed', () => { /* no-op: tray keeps the app running */ });
  app.on('activate', () => { if (win) win.show(); });
  app.on('before-quit', () => {
    app.isQuitting = true;
    clearRestartTimer();
    clearUpdateTimer();
    // Drop the tray icon explicitly instead of waiting for process teardown.
    try { tray?.destroy(); } catch { /* already gone */ }
    tray = null;
  });
}
