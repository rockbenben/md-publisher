import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { readdir, stat, readFile, access } from 'fs/promises';
import { join, extname, basename } from 'path';
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

  return {
    meta: {
      title: str(data.title),
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

  // Parse files in parallel for better throughput
  const results = await Promise.allSettled(files.map(({ path: f }) => parseArticleAsync(f)));
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
