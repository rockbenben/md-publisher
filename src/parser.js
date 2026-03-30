import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { readdir, stat, readFile, access } from 'fs/promises';
import { join, extname, basename, resolve, dirname } from 'path';
import matter from 'gray-matter';
import { PLATFORMS } from './config.js';

/** Supported article file extensions */
export const ARTICLE_EXTS = new Set([
  '.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn', '.mdx', '.txt',
]);

/** Files to skip during directory scan (common non-article files) */
const SKIP_FILES = new Set(['readme.md', 'changelog.md', 'license.md', 'license.txt',
  '.md-publisher.yml', '.md-publisher.yaml']);

/** Directories to skip during scan */
const SKIP_DIRS = new Set(['node_modules', 'user-data']);

/**
 * Parse a markdown file, extracting frontmatter metadata and body content.
 * @param {string} filePath - Absolute or relative path to the .md file
 * @returns {{ meta: object, content: string, filePath: string }}
 */
export function parseArticle(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return parseArticleString(raw, filePath);
}

/**
 * Parse a markdown string directly (no disk I/O).
 * Used by the upload endpoint to avoid writing temp files.
 * @param {string} raw - Raw markdown content (with optional frontmatter)
 * @param {string} filePath - Virtual file path (for display purposes)
 * @returns {{ meta: object, content: string, filePath: string }}
 */
export function parseArticleString(raw, filePath) {
  const { data, content } = matter(raw);

  // Ensure scalar values — YAML can produce objects/arrays for fields we expect as strings
  const str = (v) => (typeof v === 'string' || typeof v === 'number') ? String(v) : '';

  // If no frontmatter title, extract from first H1 heading
  let title = str(data.title);
  if (!title) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1].trim();
  }

  return {
    meta: {
      title,
      shortTitle: str(data.shortTitle),
      description: str(data.description),
      date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : str(data.date),
      category: Array.isArray(data.category) ? data.category : data.category ? [data.category] : [],
      tag: Array.isArray(data.tag) ? data.tag : data.tag ? [data.tag] : [],
    },
    content: content.trim(),
    filePath,
  };
}

/**
 * Scan a directory for markdown files and parse them all.
 * @param {string} dirPath - Absolute path to the directory
 * @param {object} options
 * @param {boolean} options.recursive - Scan subdirectories (default: false)
 * @returns {{ meta: object, content: string, filePath: string }[]}
 */
export function scanArticleDir(dirPath, { recursive = false } = {}) {
  if (!existsSync(dirPath)) return [];

  const files = []; // { path, mtimeMs }

  function scan(dir) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && ARTICLE_EXTS.has(extname(entry).toLowerCase())) {
        if (SKIP_FILES.has(basename(entry).toLowerCase())) continue;
        files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
      } else if (stat.isDirectory() && recursive) {
        scan(fullPath);
      }
    }
  }

  scan(dirPath);

  // Sort by modification time (newest first) — mtime already cached during scan
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Parse all found files
  const articles = [];
  for (const { path: f } of files) {
    try {
      articles.push(parseArticle(f));
    } catch (err) {
      console.warn(`⚠ 跳过无法解析的文件: ${basename(f)} — ${err.message}`);
    }
  }

  return articles;
}

// --- Project config: .md-publisher.yml ---

const CONFIG_NAMES = ['.md-publisher.yml', '.md-publisher.yaml'];
const validPlatformIds = new Set(Object.keys(PLATFORMS));

/**
 * Parse and validate a raw project config object.
 * Returns null if no valid config fields found.
 */
function parseProjectConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const config = {};
  let hasField = false;

  // platforms — array of valid platform IDs
  if (Array.isArray(raw.platforms)) {
    const valid = raw.platforms.filter(p => typeof p === 'string' && validPlatformIds.has(p));
    if (valid.length) { config.platforms = valid; hasField = true; }
  }

  // category — string or array of strings
  if (raw.category) {
    config.category = Array.isArray(raw.category) ? raw.category : [String(raw.category)];
    hasField = true;
  }

  // tag — string or array of strings
  if (raw.tag) {
    config.tag = Array.isArray(raw.tag) ? raw.tag : [String(raw.tag)];
    hasField = true;
  }

  // customText — string for X platform
  if (typeof raw.customText === 'string') {
    config.customText = raw.customText;
    hasField = true;
  }

  return hasField ? config : null;
}

/**
 * Load project config from a directory (sync).
 * Looks for .md-publisher.yml or .md-publisher.yaml.
 * @param {string} dirPath
 * @returns {object|null} Parsed config or null if not found
 */
export function loadProjectConfig(dirPath) {
  for (const name of CONFIG_NAMES) {
    const fp = join(dirPath, name);
    if (existsSync(fp)) {
      try {
        const { data } = matter(readFileSync(fp, 'utf-8'));
        return parseProjectConfig(data);
      } catch { return null; }
    }
  }
  return null;
}

/**
 * Load project config from a directory (async).
 * @param {string} dirPath
 * @returns {Promise<object|null>}
 */
export async function loadProjectConfigAsync(dirPath) {
  for (const name of CONFIG_NAMES) {
    const fp = join(dirPath, name);
    try {
      await access(fp);
      const raw = await readFile(fp, 'utf-8');
      const { data } = matter(raw);
      return parseProjectConfig(data);
    } catch { continue; }
  }
  return null;
}

/**
 * Async version of parseArticle — non-blocking for GUI server routes.
 */
export async function parseArticleAsync(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  return parseArticleString(raw, filePath);
}

/**
 * Async version of scanArticleDir — non-blocking for GUI server routes.
 * Prevents blocking the Express event loop (SSE heartbeat, etc.).
 */
export async function scanArticleDirAsync(dirPath, { recursive = false } = {}) {
  try { await access(dirPath); } catch { return []; }

  const files = []; // { path, mtimeMs }

  async function scan(dir) {
    let entries;
    try { entries = await readdir(dir); } catch { return; }
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;

      const fullPath = join(dir, entry);
      let s;
      try { s = await stat(fullPath); } catch { continue; } // EBUSY, EPERM, etc.

      if (s.isFile() && ARTICLE_EXTS.has(extname(entry).toLowerCase())) {
        if (SKIP_FILES.has(basename(entry).toLowerCase())) continue;
        files.push({ path: fullPath, mtimeMs: s.mtimeMs });
      } else if (s.isDirectory() && recursive) {
        await scan(fullPath);
      }
    }
  }

  await scan(dirPath);

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Parse files with bounded concurrency to avoid exhausting file handles
  const CONCURRENCY = 16;
  const results = [];
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(({ path: f }) => parseArticleAsync(f)));
    results.push(...batchResults);
  }
  const articles = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled') {
      articles.push(results[i].value);
    } else {
      console.warn(`⚠ 跳过无法解析的文件: ${basename(files[i].path)} — ${results[i].reason?.message}`);
    }
  }

  return articles;
}

// ─── Markdown preprocessing (shared across platforms) ────────────────────────

const CALLOUT_EMOJI = {
  NOTE: '\u2139\uFE0F',       // ℹ️ 
  TIP: '\uD83D\uDCA1',        // 💡 
  IMPORTANT: '\uD83D\uDCE2',  // 📢 
  WARNING: '\u26A0\uFE0F',    // ⚠️ 
  CAUTION: '\uD83D\uDED1',    // 🛑 
};

/** Convert GitHub callout syntax `> [!TYPE]` to emoji label. */
export function preprocessCallouts(markdown) {
  return markdown.replace(
    /^(>\s*)\[!(WARNING|IMPORTANT|CAUTION|NOTE|TIP)\]\s*$/gm,
    (_m, prefix, type) => `${prefix}${CALLOUT_EMOJI[type]} **${type.charAt(0) + type.slice(1).toLowerCase()}**  `
  );
}

// ─── Cover image helpers (shared across platforms) ───────────────────────────

/** Remove the first markdown image line from content (for platforms that use it as cover). */
export function stripFirstImage(content) {
  return content.replace(/^\s*!\[[^\]]*\]\([^)]+\)\s*$/m, '').replace(/^\n{2,}/, '\n');
}

const MAX_COVER_SIZE = 5242880; // 5MB

/**
 * Prepare cover image base64 for upload. Downloads once, converts once, caches on article.
 * - Downloads the first image from article markdown (cached in article._coverRaw)
 * - If format unsupported or oversized, converts to JPEG via Canvas (cached in article._coverJpegB64)
 * @param {Page} page - Playwright page (for Canvas compression)
 * @param {object} article - Article object (result cached on it)
 * @param {object} [opts]
 * @param {boolean} [opts.acceptWebp=false] - Whether the platform accepts webp
 * @param {number} [opts.maxSize=5242880] - Max file size in bytes
 * @returns {Promise<string|null>} base64 string or null
 */
export async function prepareCoverImage(page, article, { acceptWebp = false, maxSize = MAX_COVER_SIZE } = {}) {
  // 1. Download raw image (cached per article across platforms)
  if (article._coverRaw === undefined) {
    article._coverRaw = null;
    const imgSrc = (article.content.match(/!\[[^\]]*\]\(([^)]+)\)/) || [])[1];
    if (imgSrc) {
      try {
        const src = imgSrc.trim().replace(/\?imageMogr2\/format\/webp$/, '');
        if (/^https?:\/\//.test(src)) {
          const res = await fetch(src);
          if (res.ok) article._coverRaw = Buffer.from(await res.arrayBuffer());
        } else {
          article._coverRaw = await readFile(resolve(dirname(article.filePath), src));
        }
      } catch (err) {
        console.warn(`⚠ 封面图下载失败: ${imgSrc} — ${err.message}`);
      }
    }
  }
  if (!article._coverRaw) return null;

  // 2. Check if raw image is already usable
  const buf = article._coverRaw;
  const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isWebp = buf.length > 12 && buf.slice(8, 12).toString() === 'WEBP';
  const formatOk = isJpeg || isPng || (isWebp && acceptWebp);

  if (formatOk && buf.length <= maxSize) return buf.toString('base64');

  // 3. Convert to JPEG via Canvas (cached per article)
  if (!article._coverJpegB64) {
    const mime = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/webp';
    article._coverJpegB64 = await page.evaluate(({ data, mime, maxSize }) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          for (let q = 0.85; q >= 0.1; q -= 0.15) {
            const url = canvas.toDataURL('image/jpeg', q);
            if (url.length * 0.75 <= maxSize) return resolve(url.split(',')[1]);
          }
          resolve(canvas.toDataURL('image/jpeg', 0.1).split(',')[1]);
        };
        img.onerror = () => reject(new Error('image decode failed'));
        img.src = `data:${mime};base64,` + data;
      });
    }, { data: buf.toString('base64'), mime, maxSize });
  }
  return article._coverJpegB64;
}

/**
 * Inject a base64 image into a file input via DataTransfer (works with Vue/React).
 * @param {Page} page - Playwright page
 * @param {string} selector - CSS selector for the file input
 * @param {string} base64Data - base64 encoded image data
 */
export async function injectCoverToInput(page, selector, base64Data) {
  await page.evaluate(({ data, selector }) => {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'cover.jpg', { type: 'image/jpeg' });
    const input = document.querySelector(selector);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { data: base64Data, selector });
}
