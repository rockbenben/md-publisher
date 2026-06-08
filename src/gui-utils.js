/**
 * Pure helpers for the GUI server, split out from gui.js so they can be unit
 * tested without importing gui.js (which starts the Express server on import).
 */
import { resolve, sep } from 'path';

/**
 * Validate that a resolved path does not escape a given root.
 * Used to prevent path-traversal attacks on API endpoints that accept user paths.
 * @param {string} absPath - Resolved absolute path
 * @param {string} root - Allowed root directory
 * @returns {boolean}
 */
export function isPathWithin(absPath, root) {
  const normalised = resolve(absPath);
  const normalRoot = resolve(root);
  return normalised === normalRoot || normalised.startsWith(normalRoot + sep);
}

// Control characters, built at runtime so no literal ESC/BEL bytes live in source.
const ESC = String.fromCharCode(0x1b); // \e
const BEL = String.fromCharCode(0x07); // \a
const RE_SGR = new RegExp(ESC + '\\[[0-9;]*[a-zA-Z]', 'g'); // \e[...m, \e[...A
const RE_OSC = new RegExp(ESC + '\\][^' + BEL + ']*' + BEL, 'g'); // \e]0;title\a
const RE_BEL = new RegExp(BEL, 'g');

/**
 * Strip ANSI escape sequences (colors, cursor moves, OSC titles, BEL) so log
 * lines forwarded to the browser over SSE render as plain text.
 * @param {*} str
 * @returns {string}
 */
export function stripAnsi(str) {
  return String(str)
    .replace(RE_SGR, '')
    .replace(RE_OSC, '')
    .replace(RE_BEL, '');
}

/**
 * Stringify a console argument for SSE forwarding without ever throwing
 * (circular structures fall back to String()).
 * @param {*} a
 * @returns {string}
 */
export function safeStringify(a) {
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

// --- Request-handling guards (extracted from route handlers for testability) ---

/**
 * Settings keys a client is allowed to write — everything else is dropped.
 * `loginStatus` is intentionally excluded: it is owned by the server's login
 * check (which persists it directly), and the client only ever holds a stale
 * page-load snapshot. Letting clients write it back would clobber a freshly
 * detected login state whenever any unrelated setting is saved.
 */
export const ALLOWED_SETTINGS_KEYS = ['articleDir', 'defaultPlatforms'];

/**
 * Merge a client-supplied settings patch onto current settings, whitelisting
 * keys and type-checking each value so malformed/unknown fields can't corrupt
 * the persisted settings file.
 * @param {object} current - Current settings (not mutated)
 * @param {*} body - Untrusted request body
 * @returns {object} New settings object
 */
export function sanitizeSettings(current, body) {
  const out = { ...current };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_SETTINGS_KEYS.includes(key)) continue;
    const val = body[key];
    if (key === 'articleDir' && typeof val !== 'string') continue;
    if (key === 'defaultPlatforms' && !Array.isArray(val)) continue;
    out[key] = val;
  }
  return out;
}

/**
 * Filter requested platform ids to those that are both known and publishable,
 * sorted into canonical config order (so publish order is deterministic).
 * @param {string[]} requested - Client-requested platform ids
 * @param {string[]} knownIds - Ordered list of valid platform ids (config order)
 * @param {string[]} available - Platform ids that have a publisher implementation
 * @returns {string[]}
 */
export function orderedValidPlatforms(requested, knownIds, available) {
  if (!Array.isArray(requested)) return [];
  const knownSet = new Set(knownIds);
  const availSet = new Set(available);
  return requested
    .filter(id => knownSet.has(id) && availSet.has(id))
    .sort((a, b) => knownIds.indexOf(a) - knownIds.indexOf(b));
}

/**
 * Replace filesystem-unsafe characters (path separators, control chars, and
 * Windows-reserved punctuation) in an uploaded file name with underscores.
 * Combined with isPathWithin(), this blocks path traversal via the file name.
 * @param {*} name
 * @returns {string}
 */
export function sanitizeUploadFileName(name) {
  const unsafe = '<>:"/\\|?*';
  let out = '';
  for (const ch of String(name)) {
    out += (ch.codePointAt(0) < 0x20 || unsafe.includes(ch)) ? '_' : ch;
  }
  return out;
}
