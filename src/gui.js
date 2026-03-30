// Node.js version check — must run before any imports that might fail
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`\n❌ md-publisher 需要 Node.js 18 或更高版本（当前: ${process.version}）`);
  console.error('   请升级 Node.js: https://nodejs.org/\n');
  process.exit(1);
}

import express from 'express';
import { resolve, dirname, basename, extname, sep } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { readdir, mkdir, writeFile, unlink, stat as fsStat, access as fsAccess } from 'fs/promises';
import { execFile } from 'node:child_process';
import { PLATFORMS } from './config.js';
import { parseArticleString, scanArticleDirAsync, parseArticleAsync, ARTICLE_EXTS, loadProjectConfigAsync } from './parser.js';
import { closeContext, setGuiMode, getContext, openPage } from './browser.js';

// GUI mode — skip terminal waitForEnter, let user interact via browser
setGuiMode(true);

// Platform registry — single import, no manual object construction
import * as platformPublishers from './platforms/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Settings persistence ---
const SETTINGS_FILE = resolve(__dirname, '../settings.json');
const UPLOAD_DIR = resolve(__dirname, '../.uploads');
const PROJECT_ROOT = resolve(__dirname, '..');

const DEFAULT_SETTINGS = { articleDir: '', defaultPlatforms: ['sspai', 'zhihu', 'wechat'] };

/**
 * Validate that a resolved path does not escape a given root.
 * Used to prevent path-traversal attacks on API endpoints that accept user paths.
 * @param {string} absPath - Resolved absolute path
 * @param {string} root - Allowed root directory
 * @returns {boolean}
 */
function isPathWithin(absPath, root) {
  const normalised = resolve(absPath);
  const normalRoot = resolve(root);
  return normalised === normalRoot || normalised.startsWith(normalRoot + sep);
}

// Memory cache — avoids readFileSync on every request
let _settingsCache = null;

function loadSettings() {
  if (!_settingsCache) {
    try {
      if (existsSync(SETTINGS_FILE)) {
        const raw = readFileSync(SETTINGS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        // Validate structure — must be a plain object
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          origError('⚠ settings.json 格式异常，已重置为默认设置');
          _settingsCache = { ...DEFAULT_SETTINGS };
        } else {
          _settingsCache = { ...DEFAULT_SETTINGS, ...parsed };
        }
      }
    } catch (err) {
      origError(`⚠ settings.json 读取失败: ${err.message}，使用默认设置`);
    }
    if (!_settingsCache) _settingsCache = { ...DEFAULT_SETTINGS };
  }
  // Return a shallow copy so callers don't accidentally mutate the cache
  return { ..._settingsCache };
}

async function saveSettings(settings) {
  try {
    await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    _settingsCache = { ...settings }; // Update cache on successful write
  } catch (err) {
    _settingsCache = null; // Invalidate cache on write failure
    origError(`⚠ settings.json 保存失败: ${err.message}`);
    throw err;
  }
}

// --- SSE clients ---
const sseClients = new Set();

function broadcast(event, data) {
  if (sseClients.size === 0) return; // Skip serialization when no clients
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    if (res.writableEnded || res.destroyed) {
      sseClients.delete(res);
      continue;
    }
    try {
      res.write(msg);
    } catch {
      sseClients.delete(res);
    }
  }
}

// Clean up stale uploaded files on startup (older than 24h)
(async () => {
  try {
    const entries = await readdir(UPLOAD_DIR).catch(() => []);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const name of entries) {
      const fp = resolve(UPLOAD_DIR, name);
      try {
        const s = await fsStat(fp);
        if (s.isFile() && s.mtimeMs < cutoff) await unlink(fp);
      } catch {}
    }
  } catch {}
})();

// Redirect console.log to also broadcast to SSE clients
const origLog = console.log;
const origError = console.error;

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return String(str)
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')  // SGR + cursor sequences: \e[...m, \e[...A, etc.
    .replace(/\u001b\][^\x07]*\x07/g, '')       // OSC sequences: \e]0;title\x07
    .replace(/[\x07]/g, '');                     // Stray BEL characters
}

function safeStringify(a) {
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

console.log = (...args) => {
  origLog(...args);
  const text = stripAnsi(args.map(safeStringify).join(' '));
  if (text.trim()) broadcast('log', { text });
};

console.error = (...args) => {
  origError(...args);
  const text = stripAnsi(args.map(safeStringify).join(' '));
  if (text.trim()) broadcast('log', { text, level: 'error' });
};

// --- Publishing state (promise-based lock prevents race conditions) ---
let publishTask = null;
let isPublishing = false;
let publishAbort = null; // AbortController for current publish task

async function publishArticles(articles, platformIds, options = {}, signal = null) {
  // isPublishing is already set by the caller (route handler) to prevent race conditions
  const allResults = [];
  let cancelled = false;

  try {
    for (let i = 0; i < articles.length; i++) {
      if (signal?.aborted) { cancelled = true; broadcast('cancelled', {}); break; }

      const article = articles[i];

      broadcast('progress', {
        articleIndex: i,
        articleCount: articles.length,
        title: article.meta.title || basename(article.filePath, extname(article.filePath)),
      });

      for (const platformId of platformIds) {
        if (signal?.aborted) { cancelled = true; broadcast('cancelled', {}); break; }

        const publishFn = platformPublishers[platformId];
        if (!publishFn) continue;

        broadcast('platform', {
          articleIndex: i,
          platform: platformId,
          name: PLATFORMS[platformId].name,
          status: 'running',
        });

        try {
          const result = await publishFn(article, options);
          allResults.push(result);
          broadcast('platform', {
            articleIndex: i,
            platform: platformId,
            name: PLATFORMS[platformId].name,
            status: result.success ? 'done' : 'error',
            result,
          });
        } catch (error) {
          const result = {
            success: false,
            platform: PLATFORMS[platformId].name,
            message: error?.message || String(error),
          };
          allResults.push(result);
          broadcast('platform', {
            articleIndex: i,
            platform: platformId,
            name: PLATFORMS[platformId].name,
            status: 'error',
            result,
          });
        }
      }

      if (cancelled) break;
    }

    if (!cancelled) broadcast('done', { results: allResults });
  } finally {
    isPublishing = false;
    broadcast('status', { publishing: false });
  }

  return allResults;
}

// --- Express app ---
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(resolve(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate'); },
}));

// Express 4 doesn't catch async rejections — wrap async handlers
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// GET /api/platforms — list all platforms
app.get('/api/platforms', (req, res) => {
  const platforms = Object.entries(PLATFORMS).filter(([, p]) => !p.hidden).map(([key, p]) => ({
    id: key,
    name: p.name,
    icon: p.icon || '',
    url: p.url || '',
  }));
  res.json(platforms);
});

// GET /api/settings — get settings
app.get('/api/settings', (req, res) => {
  res.json(loadSettings());
});

// POST /api/settings — save settings (whitelist keys to prevent arbitrary data)
const ALLOWED_SETTINGS_KEYS = new Set(['articleDir', 'defaultPlatforms', 'loginStatus']);

app.post('/api/settings', asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: '无效的请求体' });
  }
  try {
    const current = loadSettings();
    for (const key of Object.keys(req.body)) {
      if (!ALLOWED_SETTINGS_KEYS.has(key)) continue;
      const val = req.body[key];
      // Type-check each setting to prevent corrupt data
      if (key === 'articleDir' && typeof val !== 'string') continue;
      if (key === 'defaultPlatforms' && !Array.isArray(val)) continue;
      if (key === 'loginStatus' && (typeof val !== 'object' || val === null || Array.isArray(val))) continue;
      current[key] = val;
    }
    await saveSettings(current);
    res.json(current);
  } catch (err) {
    res.status(500).json({ error: `保存设置失败: ${err.message}` });
  }
}));

// GET /api/articles — scan directory for articles (async to avoid blocking event loop)
app.get('/api/articles', asyncHandler(async (req, res) => {
  const settings = loadSettings();
  const dir = req.query.dir || settings.articleDir;

  if (!dir) {
    return res.json({ articles: [], dir: '' });
  }

  const absDir = resolve(dir);

  try {
    await fsAccess(absDir);
  } catch {
    return res.json({ articles: [], error: `目录不存在: ${absDir}` });
  }

  try {
    const [articles, projectConfig] = await Promise.all([
      scanArticleDirAsync(absDir, { recursive: true }),
      loadProjectConfigAsync(absDir),
    ]);
    res.json({
      articles: articles.map((a) => {
        const ext = extname(a.filePath);
        return {
          title: a.meta.title || basename(a.filePath, ext),
          description: a.meta.description || '',
          date: a.meta.date || '',
          filePath: a.filePath,
          fileName: basename(a.filePath),
        };
      }),
      dir: absDir,
      projectConfig: projectConfig || undefined,
    });
  } catch (err) {
    res.status(500).json({ articles: [], error: `扫描目录失败: ${err.message}` });
  }
}));

// POST /api/articles/parse — parse a single file path (for manual add)
app.post('/api/articles/parse', asyncHandler(async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) {
    return res.status(400).json({ error: '请提供文件路径' });
  }

  const absPath = resolve(filePath);

  let s;
  try {
    s = await fsStat(absPath);
  } catch {
    return res.status(400).json({ error: `文件不存在: ${absPath}` });
  }

  // If it's a directory, scan it
  if (s.isDirectory()) {
    const articles = await scanArticleDirAsync(absPath, { recursive: true });
    if (articles.length === 0) {
      return res.status(400).json({ error: `目录下没有文章文件: ${absPath}` });
    }
    return res.json({
      articles: articles.map((a) => {
        const ext = extname(a.filePath);
        return {
          title: a.meta.title || basename(a.filePath, ext),
          description: a.meta.description || '',
          date: a.meta.date || '',
          filePath: a.filePath,
          fileName: basename(a.filePath),
          manual: true,
        };
      }),
    });
  }

  // Single file
  try {
    const article = await parseArticleAsync(absPath);
    const ext = extname(absPath);
    res.json({
      articles: [{
        title: article.meta.title || basename(absPath, ext),
        description: article.meta.description || '',
        date: article.meta.date || '',
        filePath: absPath,
        fileName: basename(absPath),
        manual: true,
      }],
    });
  } catch (err) {
    res.status(400).json({ error: `解析失败: ${err.message}` });
  }
}));

// POST /api/articles/upload — accept file content from browser <input type="file">
// Writes file to .uploads/ (needed by publish step), but parses in-memory
// to avoid the redundant readFileSync round-trip during upload.
app.post('/api/articles/upload', asyncHandler(async (req, res) => {
  const { files } = req.body; // [{ name, content }]
  if (!files?.length) return res.status(400).json({ error: '没有文件' });
  if (files.length > 100) return res.status(400).json({ error: `文件数量超出限制 (${files.length}/100)` });
  await mkdir(UPLOAD_DIR, { recursive: true });
  const articles = [];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file (matches frontend limit)
  for (const f of files) {
    try {
      // Server-side size check (frontend also checks, but direct POST could bypass)
      if (typeof f.content !== 'string' || f.content.length > MAX_FILE_SIZE) {
        origLog(`⚠ 跳过过大或无效的文件: ${f.name}`);
        continue;
      }
      const safeName = f.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      // Skip files with unsupported extensions
      if (!ARTICLE_EXTS.has(extname(safeName).toLowerCase())) {
        origLog(`⚠ 跳过不支持的文件类型: ${f.name}`);
        continue;
      }
      const tmpPath = resolve(UPLOAD_DIR, safeName);
      if (!isPathWithin(tmpPath, UPLOAD_DIR)) {
        origLog(`⚠ 跳过非法文件名: ${f.name}`);
        continue;
      }
      await writeFile(tmpPath, f.content, 'utf-8');
      // Parse in memory — skip the redundant readFileSync in parseArticle()
      const article = parseArticleString(f.content, tmpPath);
      const ext = extname(tmpPath);
      articles.push({
        title: article.meta.title || basename(tmpPath, ext),
        description: article.meta.description || '',
        date: article.meta.date || '',
        filePath: tmpPath,
        fileName: f.name,
        manual: true,
      });
    } catch (err) {
      origLog(`⚠ 跳过无法解析的文件: ${f.name} — ${err?.message || err}`);
    }
  }
  res.json({ articles });
}));

// GET /api/browse-dir — list subdirectories (for web-based directory browser)
app.get('/api/browse-dir', asyncHandler(async (req, res) => {
  const dir = req.query.path || '';
  if (!dir) {
    // List drives on Windows, root on others
    if (process.platform === 'win32') {
      const drives = [];
      for (let i = 65; i <= 90; i++) {
        const d = String.fromCharCode(i) + ':\\';
        try { await fsAccess(d); drives.push({ name: d, path: d }); } catch {}
      }
      return res.json({ entries: drives, current: '' });
    }
    return res.json({ entries: [{ name: '/', path: '/' }], current: '' });
  }
  try {
    const absDir = resolve(dir);
    const dirents = await readdir(absDir, { withFileTypes: true });
    const entries = dirents
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('$'))
      .map(d => ({ name: d.name, path: resolve(absDir, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = resolve(absDir, '..');
    res.json({ entries, current: absDir, parent: parent !== absDir ? parent : '' });
  } catch (err) {
    res.status(400).json({ error: err.message, entries: [], current: dir });
  }
}));

// POST /api/resolve-dir — find absolute path of a directory by name + sample files
app.post('/api/resolve-dir', asyncHandler(async (req, res) => {
  const { folderName, sampleFiles = [] } = req.body;
  if (!folderName) return res.json({ path: '' });

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const skip = new Set(['Windows', 'Program Files', 'Program Files (x86)', 'ProgramData',
    'node_modules', '.git', '$Recycle.Bin', 'System Volume Information', 'Recovery']);

  const verify = async (p) => {
    try {
      await fsAccess(p);
      const s = await fsStat(p);
      if (!s.isDirectory()) return false;
      if (sampleFiles.length === 0) return true;
      for (const f of sampleFiles) {
        try { await fsAccess(resolve(p, f)); return true; } catch {}
      }
      return false;
    } catch { return false; }
  };

  // 1) Check common locations first (instant)
  const quick = [];
  if (home) {
    quick.push(resolve(home, folderName));
    for (const sub of ['Documents', 'Desktop', 'Downloads', 'Projects']) {
      quick.push(resolve(home, sub, folderName));
    }
  }
  if (process.platform === 'win32') {
    for (let i = 65; i <= 90; i++) {
      const d = String.fromCharCode(i) + ':\\';
      try { await fsAccess(d); quick.push(resolve(d, folderName)); } catch {}
    }
  }
  for (const p of quick) { if (await verify(p)) return res.json({ path: p }); }

  // 2) Shallow BFS (depth 3) from drive roots, skip system dirs — with 5s timeout
  let checked = 0;
  let timedOut = false;
  const deadline = Date.now() + 5000;
  async function search(dir, depth) {
    if (depth <= 0 || checked > 3000 || timedOut) return null;
    if (Date.now() > deadline) { timedOut = true; return null; }
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || skip.has(e.name) || e.name.startsWith('.') || e.name.startsWith('$')) continue;
        checked++;
        const p = resolve(dir, e.name);
        if (e.name === folderName && await verify(p)) return p;
        const found = await search(p, depth - 1);
        if (found) return found;
      }
    } catch {}
    return null;
  }

  const roots = [];
  if (home) roots.push(home);
  if (process.platform === 'win32') {
    for (let i = 65; i <= 90; i++) {
      const d = String.fromCharCode(i) + ':\\';
      try { await fsAccess(d); roots.push(d); } catch {}
    }
  } else { roots.push('/'); }

  for (const root of roots) {
    const found = await search(root, 3);
    if (found) return res.json({ path: found });
  }

  res.json({ path: '' });
}));

// POST /api/publish — start publishing
app.post('/api/publish', asyncHandler(async (req, res) => {
  const { filePaths, platforms, category, tag, autoCover, removeCoverImg } = req.body;

  if (isPublishing) {
    return res.status(409).json({ error: '已有发布任务正在进行' });
  }

  if (!filePaths?.length || !platforms?.length) {
    return res.status(400).json({ error: '请选择文章和平台' });
  }

  // Validate and sort platform IDs to match config order
  const platformOrder = Object.keys(PLATFORMS);
  const validPlatformIds = platforms
    .filter(id => id in PLATFORMS && id in platformPublishers)
    .sort((a, b) => platformOrder.indexOf(a) - platformOrder.indexOf(b));
  if (validPlatformIds.length === 0) {
    return res.status(400).json({ error: '没有有效的平台' });
  }

  // Lock BEFORE async parsing to prevent concurrent requests slipping through
  isPublishing = true;
  broadcast('status', { publishing: true });

  // Parse articles (async to avoid blocking event loop) — collect ALL errors before aborting
  const articles = [];
  const parseErrors = [];
  for (const fp of filePaths) {
    try {
      articles.push(await parseArticleAsync(fp));
    } catch (err) {
      parseErrors.push(`${basename(fp)}: ${err.message}`);
    }
  }
  if (parseErrors.length > 0) {
    isPublishing = false;
    const errMsg = `解析文件失败:\n${parseErrors.join('\n')}`;
    broadcast('status', { publishing: false });
    broadcast('app-error', { message: errMsg });
    return res.status(400).json({ error: errMsg });
  }

  // Respond immediately — actual publishing happens async
  res.json({ status: 'started', articleCount: articles.length, platformCount: validPlatformIds.length });

  // Run publishing in background — store promise as lock
  // publishArticles uses try/finally to guarantee isPublishing reset
  publishAbort = new AbortController();
  publishTask = publishArticles(articles, validPlatformIds, { category, tag, autoCover: autoCover !== false, removeCoverImg: !!removeCoverImg }, publishAbort.signal).catch((err) => {
    broadcast('app-error', { message: err?.message || String(err) });
  }).finally(() => { publishTask = null; publishAbort = null; });
}));

// POST /api/cancel-publish — cancel the current publish task
app.post('/api/cancel-publish', (req, res) => {
  if (!isPublishing || !publishAbort) {
    return res.status(400).json({ error: '没有正在进行的发布任务' });
  }
  publishAbort.abort();
  res.json({ ok: true });
});

// --- Login status check (streamed via SSE, parallel in separate window) ---
let isCheckingLogin = false;
let keptOpenPages = []; // Pages kept open for unlogged platforms (cleaned up on re-check)

// POST /api/close-browser — close Playwright browser
app.post('/api/close-browser', asyncHandler(async (req, res) => {
  try {
    keptOpenPages = [];
    await closeContext();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// POST /api/open-platform — open a platform in the Playwright browser
app.post('/api/open-platform', asyncHandler(async (req, res) => {
  const { platform } = req.body || {};
  const cfg = PLATFORMS[platform];
  if (!cfg) return res.status(400).json({ error: '未知平台' });
  const url = cfg.checkUrl || cfg.url;
  try {
    await openPage(url);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

async function checkOnePlatform(page, config) {
  const checkUrl = config.checkUrl || config.url;
  const checkSel = config.checkSelector || config.loggedInSelector;
  try {
    // Skip goto if already navigating to the right URL (pre-navigated by CDP/window.open)
    if (!page.url().startsWith(checkUrl)) {
      await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } else {
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    }

    // Quick check — use a short timeout; logged-in elements render fast
    const el = checkSel
      ? await page.waitForSelector(checkSel, { timeout: 3000 }).catch(() => null)
      : null;

    if (!el) return { loggedIn: false };

    // Try to get username
    let username = '';
    // Method 1: usernameJs — evaluate JS expression (for img alt, etc.)
    if (config.usernameJs) {
      username = await page.evaluate(config.usernameJs).catch(() => '') || '';
      username = username.trim();
    }
    // Method 2: usernameSelector — get textContent
    if (!username && config.usernameSelector) {
      const nameEl = await page.$(config.usernameSelector);
      if (nameEl) username = ((await nameEl.textContent()) || '').trim();
    }
    // Fallback: try text from the matched element itself
    if (!username && el) {
      const text = ((await el.textContent()) || '').trim();
      if (text && text.length < 30) username = text;
    }

    return { loggedIn: true, username };
  } catch {
    return { loggedIn: false };
  }
}

async function checkAllLoginStatus() {
  if (isCheckingLogin) return;
  isCheckingLogin = true;
  broadcast('login-check', { status: 'start' });

  try {
    let ctx;
    try {
      ctx = await getContext();
    } catch (err) {
      broadcast('app-error', { message: `浏览器加载失败，无法检查登录状态: ${err.message}` });
      return;
    }

    // Close pages kept open from previous check to prevent tab accumulation
    await Promise.all(keptOpenPages.map(p => p.close().catch(() => {})));
    keptOpenPages = [];

    const entries = Object.entries(PLATFORMS).filter(([, p]) => !p.hidden);
    const checkPages = [];

    // Open check pages as new tabs in the same window
    for (let i = 0; i < entries.length; i++) {
      try { checkPages.push(await ctx.newPage()); } catch { break; }
    }

    // Navigate and check all platforms in parallel — fast
    await Promise.allSettled(
      entries.map(async ([id, config], i) => {
        let result;
        if (i >= checkPages.length) {
          result = { loggedIn: false };
        } else {
          result = await checkOnePlatform(checkPages[i], config);
        }
        lastLoginResults[id] = result;
        broadcast('login-status', { id, ...result });
      })
    );

    // Close only logged-in pages — keep unlocked ones open for manual login
    const newKeptOpen = [];
    await Promise.all(
      entries.map(async ([id], i) => {
        if (i >= checkPages.length) return;
        if (lastLoginResults[id]?.loggedIn) {
          await checkPages[i].close().catch(() => {});
        } else {
          newKeptOpen.push(checkPages[i]);
        }
      })
    );
    keptOpenPages = newKeptOpen;

    // Persist login status to settings so it survives restarts
    try {
      const s = loadSettings();
      s.loginStatus = {};
      for (const [id] of entries) {
        const evt = lastLoginResults[id];
        if (evt) s.loginStatus[id] = evt;
      }
      await saveSettings(s);
    } catch { /* ignore save errors */ }
  } finally {
    isCheckingLogin = false;
    broadcast('login-check', { status: 'done' });
  }
}

// Cache of latest login results (populated by broadcast calls above)
const lastLoginResults = {};

// POST /api/check-login — trigger login status check (results streamed via SSE)
app.post('/api/check-login', (req, res) => {
  if (isCheckingLogin) {
    return res.status(409).json({ error: '正在检查中' });
  }
  checkAllLoginStatus().catch(err => origError(`⚠ 登录检查失败: ${err?.message || err}`)); // fire-and-forget
  res.json({ ok: true });
});

// POST /api/shutdown — gracefully exit the application
app.post('/api/shutdown', (req, res) => {
  res.json({ success: true });
  origLog('\n📮 md-publisher 正在关闭...');
  // Force-exit after 2s no matter what (closeContext can hang)
  setTimeout(() => process.exit(0), 2000);
  closeContext().catch(() => {}).finally(() => process.exit(0));
});

// GET /api/events — SSE stream
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
  // Send current state so reconnecting clients can sync
  res.write(`event: status\ndata: ${JSON.stringify({ publishing: isPublishing })}\n\n`);
  // Send cached login status (from memory or settings) so reconnecting clients see it immediately
  const cachedLogin = Object.keys(lastLoginResults).length > 0
    ? lastLoginResults
    : (loadSettings().loginStatus || {});
  for (const [id, result] of Object.entries(cachedLogin)) {
    res.write(`event: login-status\ndata: ${JSON.stringify({ id, ...result })}\n\n`);
  }
  sseClients.add(res);

  // Keepalive — prevent proxies/load balancers from killing idle connections
  const keepalive = setInterval(() => {
    try { res.write(':keepalive\n\n'); }
    catch { clearInterval(keepalive); sseClients.delete(res); }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
});

// --- Global error handler (catches async handler rejections) ---
app.use((err, req, res, _next) => {
  const msg = err?.message || String(err);
  origError(`⚠ 未处理的路由错误: ${msg}`);
  if (!res.headersSent) {
    res.status(500).json({ error: `服务器内部错误: ${msg}` });
  }
});

// --- Auto-open browser (execFile avoids shell injection surface) ---
function openBrowser(url) {
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], { stdio: 'ignore' }, () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', [url], { stdio: 'ignore' }, () => {});
  } else {
    execFile('xdg-open', [url], { stdio: 'ignore' }, () => {});
  }
}

// --- Start server ---
const PORT = process.env.PORT || 9870;
const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  origLog(`\n📮 md-publisher GUI`);
  origLog(`   地址: ${url}`);
  origLog(`   按 Ctrl+C 退出\n`);

  // Auto-open browser (skip if NO_OPEN env is set)
  if (!process.env.NO_OPEN) {
    openBrowser(url);
  }
});

// --- Graceful shutdown on SIGINT/SIGTERM ---
let _shuttingDown = false;
function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  origLog(`\n📮 收到 ${signal}，正在关闭...`);
  // End all SSE connections so server.close() can finish quickly
  for (const res of sseClients) { res.end(); }
  sseClients.clear();
  server.close();
  const forceExit = setTimeout(() => process.exit(0), 3000);
  closeContext().catch(() => {}).finally(() => { clearTimeout(forceExit); process.exit(0); });
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  origError(`\n未处理的异步错误: ${reason}`);
  gracefulShutdown('unhandledRejection');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    origError(`\n❌ 端口 ${PORT} 已被占用`);
    origError(`   可能已有一个 md-publisher 实例正在运行`);
    origError(`   请关闭后重试，或使用 PORT=其他端口 node src/gui.js\n`);
  } else {
    origError(`\n❌ 服务器启动失败: ${err.message}\n`);
  }
  process.exit(1);
});
