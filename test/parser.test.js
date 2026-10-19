import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  parseArticleString,
  preprocessCallouts,
  stripFirstImage,
  firstContentImageSrc,
  scanArticleDir,
  loadProjectConfig,
  coverFileMeta,
} from '../src/parser.js';

// ─── parseArticleString ──────────────────────────────────────────────────────

// The frontmatter splitter replaced gray-matter (which pinned an EOL js-yaml@3
// with an unfixed advisory). These lock in the behaviour it used to provide.
test('parseArticleString: handles CRLF frontmatter', () => {
  const a = parseArticleString('---\r\ntitle: CRLF\r\n---\r\nBody line', 'a.md');
  assert.equal(a.meta.title, 'CRLF');
  assert.equal(a.content, 'Body line');
});

test('parseArticleString: tolerates a UTF-8 BOM before the fence', () => {
  const a = parseArticleString('\uFEFF---\ntitle: BOM\n---\nBody', 'a.md');
  assert.equal(a.meta.title, 'BOM');
  assert.equal(a.content, 'Body');
});

test('parseArticleString: strips a BOM when there is no frontmatter', () => {
  const a = parseArticleString('\uFEFF# Heading\n\nbody', 'a.md');
  assert.ok(!a.content.startsWith('\uFEFF'), 'BOM should not survive into content');
  assert.equal(a.meta.title, 'Heading');
});

test('parseArticleString: empty frontmatter block yields no metadata', () => {
  const a = parseArticleString('---\n---\nBody', 'a.md');
  assert.equal(a.content, 'Body');
  assert.equal(a.meta.title, '');
});

test('parseArticleString: closing fence may sit at end of file', () => {
  const a = parseArticleString('---\ntitle: T\n---', 'a.md');
  assert.equal(a.meta.title, 'T');
  assert.equal(a.content, '');
});

test('parseArticleString: --- inside the body is not a frontmatter fence', () => {
  const a = parseArticleString('# Doc\n\n---\n\nnot: frontmatter', 'a.md');
  assert.equal(a.meta.title, 'Doc');
  assert.ok(a.content.includes('not: frontmatter'), 'body must be preserved');
});

test('parseArticleString: a --- that never closes is body text', () => {
  const a = parseArticleString('# Doc\n\n---\ntitle: nope', 'a.md');
  assert.equal(a.meta.title, 'Doc');
});

test('parseArticleString: malformed YAML throws so the file is reported, not silently mistitled', () => {
  assert.throws(
    () => parseArticleString('---\ntitle: [unclosed\n---\nBody', 'a.md'),
    /.*/,
  );
});

test('parseArticleString: body survives the fence with inner spacing intact', () => {
  // parseArticleString trims the body (long-standing behaviour), so compare
  // against what trimming leaves — the point here is that nothing INSIDE the
  // body is mangled.
  const a = parseArticleString('---\ntitle: T\n---\n\n  keep  \n\n## H2\n', 'a.md');
  assert.equal(a.content, 'keep  \n\n## H2');
});

test('parseArticleString: reads title from frontmatter', () => {
  const a = parseArticleString('---\ntitle: Hello\n---\nBody', 'a.md');
  assert.equal(a.meta.title, 'Hello');
  assert.equal(a.content, 'Body');
  assert.equal(a.filePath, 'a.md');
});

test('parseArticleString: falls back to first H1 when no frontmatter title', () => {
  const a = parseArticleString('# My Heading\n\ntext', 'a.md');
  assert.equal(a.meta.title, 'My Heading');
});

test('parseArticleString: frontmatter title wins over H1', () => {
  const a = parseArticleString('---\ntitle: FM\n---\n# H1\ntext', 'a.md');
  assert.equal(a.meta.title, 'FM');
});

test('parseArticleString: no title when neither frontmatter nor H1', () => {
  const a = parseArticleString('just text\n## not an h1', 'a.md');
  assert.equal(a.meta.title, '');
});

test('parseArticleString: coerces non-scalar fields to empty string', () => {
  // YAML can produce objects/arrays where a string is expected
  const a = parseArticleString('---\ntitle:\n  nested: x\ndescription: [1, 2]\n---\nbody', 'a.md');
  assert.equal(a.meta.title, '');
  assert.equal(a.meta.description, '');
});

test('parseArticleString: numeric scalar is stringified', () => {
  const a = parseArticleString('---\ntitle: 2024\n---\nbody', 'a.md');
  assert.equal(a.meta.title, '2024');
});

test('parseArticleString: Date frontmatter is sliced to YYYY-MM-DD', () => {
  const a = parseArticleString('---\ntitle: t\ndate: 2024-03-05\n---\nb', 'a.md');
  assert.equal(a.meta.date, '2024-03-05');
});

test('parseArticleString: category/tag normalize to arrays', () => {
  const scalar = parseArticleString('---\ntitle: t\ncategory: tech\ntag: js\n---\nb', 'a.md');
  assert.deepEqual(scalar.meta.category, ['tech']);
  assert.deepEqual(scalar.meta.tag, ['js']);

  const arr = parseArticleString('---\ntitle: t\ncategory: [a, b]\ntag: [x]\n---\nb', 'a.md');
  assert.deepEqual(arr.meta.category, ['a', 'b']);
  assert.deepEqual(arr.meta.tag, ['x']);

  const none = parseArticleString('---\ntitle: t\n---\nb', 'a.md');
  assert.deepEqual(none.meta.category, []);
  assert.deepEqual(none.meta.tag, []);
});

test('parseArticleString: content is trimmed', () => {
  const a = parseArticleString('---\ntitle: t\n---\n\n\n  body  \n\n', 'a.md');
  assert.equal(a.content, 'body');
});

// ─── preprocessCallouts ──────────────────────────────────────────────────────

test('preprocessCallouts: converts all five callout types', () => {
  const cases = [
    ['> [!NOTE]', 'Note', 'ℹ️'],
    ['> [!TIP]', 'Tip', '💡'],
    ['> [!IMPORTANT]', 'Important', '📢'],
    ['> [!WARNING]', 'Warning', '⚠️'],
    ['> [!CAUTION]', 'Caution', '🛑'],
  ];
  for (const [input, label, emoji] of cases) {
    const out = preprocessCallouts(input);
    assert.equal(out, `> ${emoji} **${label}**  `, `for ${input}`);
  }
});

test('preprocessCallouts: preserves the blockquote prefix and following lines', () => {
  const out = preprocessCallouts('> [!NOTE]\n> body line');
  assert.equal(out.split('\n')[1], '> body line');
});

test('preprocessCallouts: leaves unknown callout types untouched', () => {
  const input = '> [!UNKNOWN]';
  assert.equal(preprocessCallouts(input), input);
});

test('preprocessCallouts: leaves normal text untouched', () => {
  const input = 'normal paragraph\n> a quote';
  assert.equal(preprocessCallouts(input), input);
});

test('preprocessCallouts: does not convert callout literals inside fenced code', () => {
  const md = '```markdown\n> [!NOTE]\n```\n\n> [!TIP]';
  const out = preprocessCallouts(md);
  assert.ok(out.includes('> [!NOTE]'), 'in-code literal preserved');
  assert.ok(out.includes('💡 **Tip**'), 'real callout outside code still converted');
});

// ─── stripFirstImage ─────────────────────────────────────────────────────────

test('stripFirstImage: removes only the first standalone image', () => {
  const md = '![cover](https://x/c.png)\n\nHello ![inline](y.png)\n\n![second](z.png)';
  const out = stripFirstImage(md);
  assert.ok(!out.includes('c.png'), 'first image removed');
  assert.ok(out.includes('inline'), 'inline image kept');
  assert.ok(out.includes('z.png'), 'second standalone image kept');
});

test('stripFirstImage: no-op when there is no leading image', () => {
  const md = 'just text, no images here';
  assert.equal(stripFirstImage(md), md);
});

test('stripFirstImage: does not remove an image line inside a fenced code block', () => {
  const md = '```markdown\n![demo](https://x/demo.png)\n```\n\n![real](https://x/real.png)';
  const out = stripFirstImage(md);
  assert.ok(out.includes('demo.png'), 'in-code example line preserved');
  assert.ok(!out.includes('real.png'), 'first real image (outside code) removed');
});

test('firstContentImageSrc: ignores images inside fenced code blocks', () => {
  const md = '```\n![x](in-code.png)\n```\n\n![y](real.png)';
  assert.equal(firstContentImageSrc(md), 'real.png');
  assert.equal(firstContentImageSrc('no images'), undefined);
  assert.equal(firstContentImageSrc('![a](first.png)'), 'first.png');
});

// ─── scanArticleDir (offline fs integration) ─────────────────────────────────

test('scanArticleDir: finds articles, skips README/dotfiles, sorts by mtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdpub-scan-'));
  try {
    writeFileSync(join(dir, 'old.md'), '# Old', { encoding: 'utf-8' });
    writeFileSync(join(dir, 'README.md'), '# Readme');   // skipped
    writeFileSync(join(dir, '.hidden.md'), '# Hidden');  // skipped (dotfile)
    writeFileSync(join(dir, 'note.txt'), 'plain');        // .txt is supported
    // Make new.md the most recently modified
    const newPath = join(dir, 'new.md');
    writeFileSync(newPath, '---\ntitle: Newest\n---\nbody');

    const articles = scanArticleDir(dir);
    const names = articles.map(a => a.filePath.split(/[\\/]/).pop());
    assert.ok(names.includes('new.md'));
    assert.ok(names.includes('old.md'));
    assert.ok(names.includes('note.txt'));
    assert.ok(!names.includes('README.md'), 'README skipped');
    assert.ok(!names.includes('.hidden.md'), 'dotfile skipped');
    // newest first
    assert.equal(names[0], 'new.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanArticleDir: recursive flag controls subdirectory descent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdpub-scan2-'));
  try {
    writeFileSync(join(dir, 'top.md'), '# Top');
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'nested.md'), '# Nested');

    const flat = scanArticleDir(dir).map(a => a.filePath.split(/[\\/]/).pop());
    assert.deepEqual(flat, ['top.md'], 'non-recursive ignores subdirs');

    const deep = scanArticleDir(dir, { recursive: true }).map(a => a.filePath.split(/[\\/]/).pop());
    assert.ok(deep.includes('top.md') && deep.includes('nested.md'), 'recursive descends');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanArticleDir: breaks directory-symlink cycles (no runaway / duplicates)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mdpub-cycle-'));
  try {
    writeFileSync(join(dir, 'post.md'), '# Post');
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    // A directory symlink pointing back to an ancestor forms a cycle. Without
    // realpath-based dedup the scanner re-walks the tree until the OS path limit,
    // listing post.md once per level (duplicates) and re-scanning the subtree.
    try {
      symlinkSync(dir, join(sub, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return t.skip('symlink creation not permitted in this environment');
    }
    let articles;
    assert.doesNotThrow(() => { articles = scanArticleDir(dir, { recursive: true }); });
    const posts = articles.filter((a) => a.filePath.endsWith('post.md'));
    assert.equal(posts.length, 1, 'cycle broken — post.md found exactly once, no duplicates');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scanArticleDir: skips un-stat-able entries instead of crashing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mdpub-dangling-'));
  try {
    writeFileSync(join(dir, 'good.md'), '# Good');
    // A dangling symlink: readdir lists it, but statSync (follows the link)
    // throws ENOENT. The scan must skip it, not abort the whole run.
    try {
      symlinkSync(join(dir, 'no-such-target'), join(dir, 'dangling.md'), 'file');
    } catch {
      t.skip('symlink creation not permitted on this platform/account');
      return;
    }
    let articles;
    assert.doesNotThrow(() => { articles = scanArticleDir(dir); });
    const names = articles.map(a => a.filePath.split(/[\\/]/).pop());
    assert.ok(names.includes('good.md'), 'good file still found');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── loadProjectConfig (offline fs integration) ──────────────────────────────

test('loadProjectConfig: parses valid .md-publisher.yml', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdpub-cfg-'));
  try {
    writeFileSync(join(dir, '.md-publisher.yml'),
      'platforms: [zhihu, sspai, bogus]\ncategory: tech\ntag: [a, b]\n');
    const cfg = loadProjectConfig(dir);
    assert.deepEqual(cfg.platforms, ['zhihu', 'sspai']); // bogus filtered out
    assert.deepEqual(cfg.category, ['tech']);
    assert.deepEqual(cfg.tag, ['a', 'b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProjectConfig: parses --- fenced frontmatter form too', () => {
  // Backward-compat: a config wrapped in --- delimiters must still load
  const dir = mkdtempSync(join(tmpdir(), 'mdpub-cfg3-'));
  try {
    writeFileSync(join(dir, '.md-publisher.yml'),
      '---\nplatforms:\n  - juejin\n---\n');
    const cfg = loadProjectConfig(dir);
    assert.deepEqual(cfg.platforms, ['juejin']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProjectConfig: ignores config with no recognised fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdpub-cfg4-'));
  try {
    writeFileSync(join(dir, '.md-publisher.yml'), 'unrelated: value\n');
    assert.equal(loadProjectConfig(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProjectConfig: returns null when no config file present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdpub-cfg2-'));
  try {
    assert.equal(loadProjectConfig(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
// ─── coverFileMeta (upload MIME from base64 magic prefix) ────────────────────

const b64 = (hex) => Buffer.from(hex, 'hex').toString('base64');

test('coverFileMeta: detects PNG / JPEG / WEBP / GIF and defaults to JPEG', () => {
  assert.deepEqual(coverFileMeta(b64('89504e470d0a1a0a')), { mime: 'image/png', name: 'cover.png' });
  assert.deepEqual(coverFileMeta(b64('ffd8ffe000104a46')), { mime: 'image/jpeg', name: 'cover.jpg' });
  assert.deepEqual(coverFileMeta(b64('524946460000000057454250')), { mime: 'image/webp', name: 'cover.webp' });
  assert.deepEqual(coverFileMeta(b64('474946383961')), { mime: 'image/gif', name: 'cover.gif' });
  // Unknown payload falls back to JPEG (Canvas always emits JPEG)
  assert.deepEqual(coverFileMeta('Zm9vYmFy'), { mime: 'image/jpeg', name: 'cover.jpg' });
});