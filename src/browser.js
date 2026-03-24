import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { execFile } from 'node:child_process';
import chalk from 'chalk';
import { TIMEOUTS } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USER_DATA_DIR = resolve(__dirname, '../user-data');

/** Platform-aware modifier key: Meta (Cmd) on macOS, Control on Windows/Linux */
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

let context = null;
let launching = null; // mutex: prevents concurrent launches
let guiMode = false;

/** Enable GUI mode — skips terminal-based waitForEnter calls */
export function setGuiMode(enabled) { guiMode = enabled; }

/**
 * Get or create the persistent browser context.
 * Uses system Chrome in headed mode, with login state persisted in user-data/.
 * - Detects broken/disconnected context and re-launches.
 * - Mutex prevents concurrent launches from racing.
 */
export async function getContext() {
  // Fast path: context exists and is healthy
  if (context) {
    try {
      // Quick health check — if browser is disconnected this will throw
      context.pages();
      return context;
    } catch {
      console.log(chalk.yellow('   ⚠ 浏览器连接已断开，正在重新启动...'));
      context = null;
    }
  }

  // Mutex: if another call is already launching, wait for it
  if (launching) return launching;

  launching = chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
    args: ['--disable-blink-features=AutomationControlled'],
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  try {
    context = await launching;
    return context;
  } catch (err) {
    context = null;
    throw err;
  } finally {
    launching = null;
  }
}

/**
 * Open a new page and navigate to the given URL.
 */
export async function openPage(url) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.navigation });
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
 * Close the browser context (with timeout to prevent hanging).
 */
export async function closeContext() {
  if (context) {
    const ctx = context;
    context = null; // Clear immediately so getContext() can re-launch if needed
    try {
      let timer;
      await Promise.race([
        ctx.close(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('close timeout')), 5000); }),
      ]).finally(() => clearTimeout(timer));
    } catch {
      // Ignore close errors — browser may already be gone
    }
  }
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
 * Paste an image into the currently focused element via clipboard.
 * Reads the image as a PNG blob and writes it to the clipboard, then Ctrl+V.
 * @param {import('playwright').Page} page
 * @param {Buffer} imageBuffer - Raw image bytes (PNG or JPEG)
 * @param {string} mimeType - e.g. 'image/png' or 'image/jpeg'
 */
export async function pasteImage(page, imageBuffer, mimeType = 'image/png') {
  const b64 = imageBuffer.toString('base64');
  const ok = await page.evaluate(async ({ b64Data, mime }) => {
    try {
      const bin = atob(b64Data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
      return true;
    } catch { return false; }
  }, { b64Data: b64, mime: mimeType });
  if (!ok) throw new Error('图片剪贴板写入失败');
  await page.keyboard.press(`${MOD}+V`);
  await page.waitForTimeout(TIMEOUTS.pasteAfterKeys);
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
