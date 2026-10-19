import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import { TIMEOUTS } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Chrome profile dir — must be writable: userData in the packaged app
// (via MDPUB_DATA_DIR), repo root in dev/CLI.
const USER_DATA_DIR = process.env.MDPUB_DATA_DIR
  ? resolve(process.env.MDPUB_DATA_DIR, 'user-data')
  : resolve(__dirname, '../user-data');
// Same writable base as gui.js — used to read the GUI's "browser path" setting.
const SETTINGS_FILE = resolve(process.env.MDPUB_DATA_DIR || resolve(__dirname, '..'), 'settings.json');

/** Browser path configured in the GUI (settings.json), or '' if unset/unreadable. */
function configuredChromePath() {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    return typeof s?.chromePath === 'string' ? s.chromePath.trim() : '';
  } catch { return ''; }
}

// CDP endpoint for the long-lived Chrome. The browser runs as an INDEPENDENT
// (detached) process — not a child of this Node process — so closing the
// terminal / restarting the server reconnects to the same Chrome (and its
// logged-in tabs) instead of killing it. Override the port with CDP_PORT.
// Default avoids 9222 (the conventional port — frequently taken by other dev
// tools) and the GUI's HTTP port to keep collisions unlikely.
const CDP_PORT = Number(process.env.CDP_PORT) || 9322;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

/** Platform-aware modifier key: Meta (Cmd) on macOS, Control on Windows/Linux */
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

let browser = null;   // Playwright Browser from connectOverCDP
let context = null;   // The persistent default context (carries the profile)
let chromeProc = null; // The detached Chrome we spawned (null if we reconnected)
let connecting = null; // mutex: prevents concurrent connect/launch races
let guiMode = false;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Locate a Chromium-based browser to launch with a debugging port. The app
 * drives the browser purely by path over CDP, so any Chromium-family browser
 * works (Chrome, Edge, Brave, Vivaldi, Chromium, …). On Windows, Edge is
 * preinstalled, so a machine without Chrome still resolves here.
 * Order: GUI "browser path" setting (settings.json) → CHROME_PATH env →
 * common install paths (Chrome → Edge → mainstream → 国内主流) → Playwright's
 * bundled Chromium (last resort, only if browsers were installed).
 */
function detectChromePath() {
  // Explicit overrides first: the in-app setting, then the env var.
  const configured = configuredChromePath();
  if (configured && existsSync(configured)) return configured;
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [];
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'];
    candidates.push(
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pfx86}\\Google\\Chrome\\Application\\chrome.exe`,
      local && `${local}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pfx86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      local && `${local}\\Chromium\\Application\\chrome.exe`,
      `${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      local && `${local}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      local && `${local}\\Vivaldi\\Application\\vivaldi.exe`,
      // 国内主流 Chromium 浏览器（CDP 支持因版本而异；不行时用 GUI「浏览器路径」指定）
      local && `${local}\\360ChromeX\\Chrome\\Application\\360ChromeX.exe`,
      local && `${local}\\360Chrome\\Chrome\\Application\\360chrome.exe`,
      `${pfx86}\\Tencent\\QQBrowser\\QQBrowser.exe`,
      `${pfx86}\\SogouExplorer\\SogouExplorer.exe`,
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable',
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
      '/usr/bin/brave-browser', '/usr/bin/vivaldi-stable',
    );
  }
  for (const c of candidates) { if (c && existsSync(c)) return c; }
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch { /* bundled chromium not installed */ }
  return null;
}

/**
 * Spawn Chrome as a DETACHED process listening on the CDP port, using our
 * dedicated profile dir (NOT the user's everyday Chrome profile). `detached`
 * + `unref()` means it outlives this Node process — the whole point of the
 * decoupling: a closed terminal or crashed server no longer kills the browser.
 */
function launchChrome(chromePath) {
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,900',
    '--lang=zh-CN',
  ];
  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

/** Retry connectOverCDP until Chrome is up or the deadline passes. */
async function connectCDP(deadline) {
  let lastErr;
  for (;;) {
    try {
      return await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
    } catch (err) {
      lastErr = err;
      if (Date.now() >= deadline) throw lastErr;
      await delay(TIMEOUTS.browserConnectInterval);
    }
  }
}

/** Enable GUI mode — skips terminal-based waitForEnter calls */
export function setGuiMode(enabled) { guiMode = enabled; }

/**
 * Get the persistent browser context, connecting over CDP to a long-lived
 * Chrome (login state persisted in user-data/).
 * - First tries to connect to an ALREADY-RUNNING Chrome (so a restarted server
 *   reattaches instead of relaunching).
 * - If none is running, spawns a detached Chrome and connects to it.
 * - Mutex prevents concurrent connect/launch from racing.
 */
export async function getContext() {
  // Fast path: connected and healthy
  if (context && browser?.isConnected()) return context;

  // Mutex: if another call is already connecting, wait for it
  if (connecting) return connecting;

  connecting = (async () => {
    // 1. Try an already-running Chrome (survives terminal close / server restart)
    try {
      browser = await chromium.connectOverCDP(CDP_URL, { timeout: 2000 });
    } catch {
      // 2. Not running — launch our own detached Chrome, then connect
      const chromePath = detectChromePath();
      if (!chromePath) {
        throw new Error('未找到 Chrome / Edge 等 Chromium 内核浏览器。请安装 Chrome 或 Edge，或用环境变量 CHROME_PATH 指定任意 Chromium 内核浏览器的可执行文件路径');
      }
      console.log(chalk.gray('   正在启动浏览器...'));
      chromeProc = launchChrome(chromePath);
      try {
        browser = await connectCDP(Date.now() + TIMEOUTS.browserConnect);
      } catch (err) {
        // Two common causes: (1) another Chrome already has the user-data
        // profile open, so our launch just delegated to it and never opened a
        // debug port; (2) the port is occupied by an unrelated program.
        throw new Error(
          `无法连接到浏览器调试端口 ${CDP_PORT}（${err.message}）。` +
          `可能是已有 Chrome 占用了本应用的配置目录（请关闭后重试），` +
          `或端口被其他程序占用（可用环境变量 CDP_PORT 指定其他端口）。`,
          { cause: err },
        );
      }
    }

    // Reset state when this browser disconnects, so the next call reconnects
    // (or relaunches). Guard against a stale handler nulling a newer browser.
    const b = browser;
    b.on('disconnected', () => {
      if (browser === b) { browser = null; context = null; }
    });

    // The persistent default context carries the user-data profile + logins.
    context = browser.contexts()[0];
    if (!context) throw new Error('浏览器上下文不可用');

    // launchPersistentContext used to grant these via the `permissions` option;
    // over CDP we grant them explicitly (needed for clipboard-based pasting).
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    } catch { /* some channels reject unknown permissions — paste still works */ }

    return context;
  })();

  try {
    return await connecting;
  } catch (err) {
    browser = null;
    context = null;
    throw err;
  } finally {
    connecting = null;
  }
}

/**
 * Open a new page and navigate to the given URL.
 */
export async function openPage(url) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.navigation });
  } catch (err) {
    // Navigation failed (timeout / net error): close the orphan tab so a slow or
    // unreachable site doesn't leak a page on every failed open/publish.
    await page.close().catch(() => {});
    throw err;
  }
  return page;
}

/**
 * Open a page, run `fn(page)`, and guarantee the page is closed on error.
 * On success the page is kept open (user reviews in browser).
 * @param {string} url - URL to navigate to
 * @param {(page: import('playwright').Page) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withPage(url, fn) {
  const page = await openPage(url);
  try {
    return await fn(page);
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
}

/**
 * Fully QUIT the Chrome process (for the "关闭浏览器" button and CLI cleanup).
 * Over CDP, browser.close() only disconnects; to actually terminate Chrome we
 * issue the CDP `Browser.close` command (works even if WE didn't spawn it, e.g.
 * after a server restart reconnected to a pre-existing Chrome).
 */
export async function closeContext() {
  // A connect in flight hasn't assigned `browser` yet. Without waiting we'd
  // no-op and leave the just-launched browser open while reporting success.
  if (connecting) {
    try { await connecting; } catch { /* connect failed: nothing to close */ }
  }
  const b = browser;
  browser = null;
  context = null; // Clear immediately so getContext() can reconnect if needed
  if (b) {
    try {
      let timer;
      await Promise.race([
        b.newBrowserCDPSession().then((s) => s.send('Browser.close')),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('close timeout')), 5000); }),
      ]).finally(() => clearTimeout(timer));
    } catch {
      // CDP close failed — fall back to just disconnecting
      try { await b.close(); } catch { /* already gone */ }
    }
  }
  // Backstop: if we spawned it and it's still alive, kill the process
  if (chromeProc && !chromeProc.killed) { try { chromeProc.kill(); } catch {} }
  chromeProc = null;
}

/**
 * DISCONNECT from Chrome without quitting it (for server process exit:
 * SIGINT / crash). This is what makes the browser survive a closed terminal —
 * Node drops the CDP socket on exit, but the detached Chrome keeps running with
 * all its logged-in tabs, ready for the next launch to reconnect.
 */
export async function disconnectContext() {
  if (connecting) {
    try { await connecting; } catch { /* nothing to disconnect */ }
  }
  const b = browser;
  browser = null;
  context = null;
  // Do NOT call Browser.close — just drop our handle. b.close() on a
  // connectOverCDP browser merely disconnects (Chrome is not Playwright-owned).
  if (b) { try { await b.close(); } catch {} }
}

/**
 * Write plain text to the page clipboard.
 */
async function writeClipboardText(page, text) {
  const ok = await page.evaluate(async (t) => {
    try { await navigator.clipboard.writeText(t); return true; }
    catch { return false; }
  }, text);
  if (!ok) throw new Error('剪贴板写入失败，请检查浏览器权限');
}

/**
 * Simulate Ctrl/Cmd+A → Ctrl/Cmd+V key sequence with timing delays.
 * If selector is provided, clicks it first to focus.
 */
async function selectAllAndPaste(page, selector) {
  if (selector) {
    await page.click(selector, { timeout: TIMEOUTS.selector });
    await page.waitForTimeout(TIMEOUTS.pasteBeforeKeys);
  }
  await page.keyboard.press(`${MOD}+A`);
  await page.waitForTimeout(TIMEOUTS.pasteBetweenKeys);
  await page.keyboard.press(`${MOD}+V`);
  await page.waitForTimeout(TIMEOUTS.pasteAfterKeys);
}

/**
 * Paste plain text into an element via clipboard.
 *
 * Uses fixed delays between keystrokes — clipboard paste has no reliable
 * DOM event to await. See TIMEOUTS.paste* in config.js to tune.
 */
export async function pasteText(page, selector, text) {
  await writeClipboardText(page, text);
  await selectAllAndPaste(page, selector);
}

/**
 * Paste rich HTML into an element via clipboard (for rich-text editors like ProseMirror).
 */
export async function pasteHtml(page, selector, html) {
  const ok = await page.evaluate(async (htmlContent) => {
    try {
      const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
      const textBlob = new Blob([htmlContent.replace(/<[^>]+>/g, '')], { type: 'text/plain' });
      const item = new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob });
      await navigator.clipboard.write([item]);
      return true;
    } catch { return false; }
  }, html);
  if (!ok) throw new Error('剪贴板写入失败，请检查浏览器权限');
  await selectAllAndPaste(page, selector);
}

/**
 * Paste text by simulating Ctrl+V on the currently focused element.
 */
export async function pasteToFocused(page, text) {
  await writeClipboardText(page, text);
  await selectAllAndPaste(page);
}

/**
 * Forceful alert — BEL sound + colored output + terminal title flash + Windows notification.
 * Used when manual intervention is required (e.g. login).
 */
export function alertUser(message) {
  // BEL character for system beep
  process.stdout.write('\x07');
  // Change terminal title (causes taskbar to flash on Windows)
  process.stdout.write(`\x1b]0;\u26A0 md-publisher: ${message}\x07`);
  // Bright colored terminal output
  console.log(chalk.bgRed.white.bold(`\n  \u26A0  ${message}  \u26A0  `));
  // System notification (non-blocking, fire-and-forget)
  if (process.platform === 'win32') {
    // PowerShell: escape single quotes AND neutralize $ and backticks to prevent variable expansion
    const escaped = message.replace(/[`$'"]/g, (c) => c === "'" ? "''" : `\`${c}`);
    execFile('powershell', ['-WindowStyle', 'Hidden', '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; ` +
      `$n = New-Object System.Windows.Forms.NotifyIcon; ` +
      `$n.Icon = [System.Drawing.SystemIcons]::Warning; ` +
      `$n.BalloonTipIcon = 'Warning'; ` +
      `$n.BalloonTipTitle = 'md-publisher'; ` +
      `$n.BalloonTipText = '${escaped}'; ` +
      `$n.Visible = $true; ` +
      `$n.ShowBalloonTip(5000); ` +
      `Start-Sleep 4; $n.Dispose()`],
      { stdio: 'ignore' }, () => {});
  } else if (process.platform === 'darwin') {
    // macOS: escape backslashes and double quotes for AppleScript string
    const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execFile('osascript', ['-e',
      `display notification "${escaped}" with title "md-publisher" sound name "Ping"`],
      { stdio: 'ignore' }, () => {});
  } else {
    // Linux: execFile with args array avoids shell injection
    execFile('notify-send', ['-u', 'critical', 'md-publisher', message],
      { stdio: 'ignore' }, () => {});
  }
}

/**
 * Check if user is logged in. If not, alert and wait for manual login.
 *
 * Strategy: always try loggedInSelector FIRST (generous timeout so slow
 * pages don't trigger false alerts), then fall back to URL pattern check.
 * Fast path: if already logged in, returns as soon as the selector appears.
 */
export async function ensureLoggedIn(page, platformConfig) {
  const { name, loggedInSelector, loginUrlPattern } = platformConfig;

  // Step 1: Try to find logged-in indicator first (give the page time to load)
  if (loggedInSelector) {
    try {
      await page.waitForSelector(loggedInSelector, { timeout: 15000 });
      return; // Already logged in
    } catch {
      // Selector not found — might need login, check URL pattern next
    }
  }

  // Step 2: Check URL pattern as secondary signal
  if (loginUrlPattern && loginUrlPattern.test(page.url())) {
    alertUser(`${name} 需要登录`);
    await waitForLogin(page, platformConfig);
    return;
  }

  // Step 3: Selector not found AND no URL pattern match — probably still needs login
  if (loggedInSelector) {
    alertUser(`${name} 需要登录`);
    await waitForLogin(page, platformConfig);
  }
}

/**
 * Wait for the user to complete login by detecting the logged-in selector.
 * Uses Promise.race between selector detection and manual Enter key.
 * Both branches are wrapped to never reject — timeout just resolves false.
 */
async function waitForLogin(page, platformConfig) {
  const { loggedInSelector } = platformConfig;

  console.log(chalk.gray('   登录完成后按 Enter 继续，或等待自动检测...'));

  // If no selector, resolve null so waitForEnter is the only way to proceed
  const selectorPromise = loggedInSelector
    ? page.waitForSelector(loggedInSelector, { timeout: TIMEOUTS.login }).catch(() => null)
    : Promise.resolve(null);

  // Use AbortController to clean up readline when selector wins the race
  const ac = new AbortController();
  await Promise.race([
    selectorPromise.then(v => { ac.abort(); return v; }),
    waitForEnter(null, ac.signal),
  ]);

  // Restore terminal title
  process.stdout.write('\x1b]0;md-publisher\x07');
  console.log(chalk.green('   \u2713 登录成功'));
}

/**
 * Wait for the user to press Enter in the terminal.
 * In GUI mode, resolves immediately (user interacts via browser, not terminal).
 * @param {string|null} message - Optional message to print
 * @param {AbortSignal} [signal] - Optional AbortSignal to cancel the wait (closes readline)
 */
export function waitForEnter(message, signal) {
  if (message) console.log(chalk.cyan(message));
  if (guiMode) return Promise.resolve();
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (signal) {
      signal.addEventListener('abort', () => { rl.close(); resolve(); }, { once: true });
    }
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Try multiple selectors in PARALLEL, return the first one found.
 * Uses Promise.any() so all selectors race — no more sequential 3s×N waits.
 */
export async function findElement(page, selectors, timeout = TIMEOUTS.selector) {
  const sels = Array.isArray(selectors) ? selectors : [selectors];
  try {
    return await Promise.any(
      sels.map(sel =>
        page.waitForSelector(sel, { timeout }).then(el => {
          if (!el) throw new Error('null');
          return { element: el, selector: sel };
        })
      )
    );
  } catch {
    return null;
  }
}

/**
 * Find a title input by selectors, clear it, and type the given title.
 * @returns {Promise<boolean>} true if title was filled
 */
export async function fillTitle(page, selectors, title, timeout) {
  const el = await findElement(page, selectors, timeout);
  if (el) {
    await page.click(el.selector);
    await page.waitForTimeout(200);
    await page.keyboard.press(`${MOD}+A`);
    await page.keyboard.type(title);
    console.log(chalk.green('   ✓ 已填写标题'));
    return true;
  }
  console.log(chalk.yellow('   ⚠ 未找到标题输入框，请手动填写'));
  return false;
}
