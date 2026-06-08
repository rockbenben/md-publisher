import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  isPathWithin, stripAnsi, safeStringify,
  sanitizeSettings, orderedValidPlatforms, sanitizeUploadFileName,
} from '../src/gui-utils.js';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

// ─── isPathWithin (path-traversal guard) ─────────────────────────────────────

test('isPathWithin: accepts a child path', () => {
  const root = resolve('/srv/uploads');
  assert.equal(isPathWithin(resolve('/srv/uploads/a.md'), root), true);
  assert.equal(isPathWithin(resolve('/srv/uploads/sub/b.md'), root), true);
});

test('isPathWithin: accepts the root itself', () => {
  const root = resolve('/srv/uploads');
  assert.equal(isPathWithin(root, root), true);
});

test('isPathWithin: rejects traversal escaping the root', () => {
  const root = resolve('/srv/uploads');
  assert.equal(isPathWithin(resolve('/srv/uploads/../secret.md'), root), false);
  assert.equal(isPathWithin(resolve('/srv/other/x.md'), root), false);
});

test('isPathWithin: rejects a sibling sharing a name prefix', () => {
  // /srv/uploads-evil must NOT be considered inside /srv/uploads
  const root = resolve('/srv/uploads');
  assert.equal(isPathWithin(resolve('/srv/uploads-evil/x.md'), root), false);
});

// ─── stripAnsi ───────────────────────────────────────────────────────────────

test('stripAnsi: removes SGR color codes', () => {
  const colored = `${ESC}[32m✓ done${ESC}[0m`;
  assert.equal(stripAnsi(colored), '✓ done');
});

test('stripAnsi: removes OSC title sequences and stray BEL', () => {
  const osc = `${ESC}]0;window title${BEL}hello${BEL}`;
  assert.equal(stripAnsi(osc), 'hello');
});

test('stripAnsi: leaves plain text untouched', () => {
  assert.equal(stripAnsi('plain 文本 123'), 'plain 文本 123');
});

test('stripAnsi: coerces non-strings', () => {
  assert.equal(stripAnsi(42), '42');
});

// ─── safeStringify ───────────────────────────────────────────────────────────

test('safeStringify: passes strings through unchanged', () => {
  assert.equal(safeStringify('hello'), 'hello');
});

test('safeStringify: JSON-encodes plain objects', () => {
  assert.equal(safeStringify({ a: 1 }), '{"a":1}');
});

test('safeStringify: falls back to String() on circular structures', () => {
  const obj = {};
  obj.self = obj; // circular — JSON.stringify would throw
  assert.equal(safeStringify(obj), '[object Object]');
});

// ─── sanitizeSettings (whitelist + type-checks) ──────────────────────────────

test('sanitizeSettings: keeps whitelisted, well-typed fields', () => {
  const out = sanitizeSettings({ articleDir: 'old' }, {
    articleDir: 'D:/blog',
    defaultPlatforms: ['zhihu'],
  });
  assert.equal(out.articleDir, 'D:/blog');
  assert.deepEqual(out.defaultPlatforms, ['zhihu']);
});

test('sanitizeSettings: never lets a client overwrite server-owned loginStatus', () => {
  // loginStatus is persisted by the server's login check; a client save carries
  // a stale snapshot and must not clobber it.
  const current = { loginStatus: { zhihu: { loggedIn: true } } };
  const out = sanitizeSettings(current, {
    articleDir: 'D:/blog',
    loginStatus: { zhihu: { loggedIn: false } }, // stale — must be ignored
  });
  assert.equal(out.articleDir, 'D:/blog');
  assert.deepEqual(out.loginStatus, { zhihu: { loggedIn: true } }, 'server value preserved');
});

test('sanitizeSettings: drops unknown keys', () => {
  const out = sanitizeSettings({}, { articleDir: 'x', evil: 'rm -rf', __proto__: {} });
  assert.equal(out.articleDir, 'x');
  assert.ok(!('evil' in out));
});

test('sanitizeSettings: rejects mistyped values, preserving current', () => {
  const out = sanitizeSettings({ articleDir: 'keep', defaultPlatforms: ['sspai'] }, {
    articleDir: 123,            // not a string → ignored
    defaultPlatforms: 'zhihu',  // not an array → ignored
    loginStatus: [1, 2],        // array, not plain object → ignored
  });
  assert.equal(out.articleDir, 'keep');
  assert.deepEqual(out.defaultPlatforms, ['sspai']);
  assert.ok(!('loginStatus' in out));
});

test('sanitizeSettings: tolerates a non-object body', () => {
  assert.deepEqual(sanitizeSettings({ a: 1 }, null), { a: 1 });
  assert.deepEqual(sanitizeSettings({ a: 1 }, [1, 2]), { a: 1 });
});

test('sanitizeSettings: does not mutate the input', () => {
  const current = { articleDir: 'orig' };
  sanitizeSettings(current, { articleDir: 'new' });
  assert.equal(current.articleDir, 'orig');
});

// ─── orderedValidPlatforms ───────────────────────────────────────────────────

const KNOWN = ['sspai', 'zhihu', 'wechat', 'smzdm', 'juejin', 'x'];

test('orderedValidPlatforms: filters unknown/unavailable and sorts to config order', () => {
  const out = orderedValidPlatforms(['x', 'sspai', 'bogus', 'zhihu'], KNOWN, KNOWN);
  assert.deepEqual(out, ['sspai', 'zhihu', 'x']);
});

test('orderedValidPlatforms: drops ids without a publisher implementation', () => {
  const out = orderedValidPlatforms(['sspai', 'zhihu'], KNOWN, ['sspai']);
  assert.deepEqual(out, ['sspai']);
});

test('orderedValidPlatforms: returns [] for a non-array request', () => {
  assert.deepEqual(orderedValidPlatforms(undefined, KNOWN, KNOWN), []);
});

// ─── sanitizeUploadFileName ──────────────────────────────────────────────────

test('sanitizeUploadFileName: neutralises path separators and traversal', () => {
  assert.equal(sanitizeUploadFileName('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(sanitizeUploadFileName('a\\b/c.md'), 'a_b_c.md');
});

test('sanitizeUploadFileName: strips control chars and reserved punctuation', () => {
  assert.equal(sanitizeUploadFileName('na<me>:"?*.md'), 'na_me_____.md');
  assert.equal(sanitizeUploadFileName(`tab\tnul${String.fromCharCode(0)}.md`), 'tab_nul_.md');
});

test('sanitizeUploadFileName: leaves a clean name untouched', () => {
  assert.equal(sanitizeUploadFileName('文章-2024.md'), '文章-2024.md');
});
