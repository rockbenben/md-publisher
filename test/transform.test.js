import { test } from 'node:test';
import assert from 'node:assert/strict';

import { transformContent as zhihuTransform } from '../src/platforms/zhihu.js';
import { transformContent as sspaiTransform } from '../src/platforms/sspai.js';
import { normalizeHeadings, parseSegments } from '../src/platforms/x.js';
import { coverFileMeta } from '../src/parser.js';

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

// ─── zhihu transformContent: strip blank lines around images ─────────────────

test('zhihu: removes blank lines before and after an image line', () => {
  const out = zhihuTransform('text\n\n![a](b.png)\n\ntext2');
  assert.equal(out, 'text\n![a](b.png)\ntext2');
});

test('zhihu: leaves prose blank lines intact', () => {
  const input = 'para1\n\npara2';
  assert.equal(zhihuTransform(input), input);
});

test('zhihu: handles consecutive images', () => {
  const out = zhihuTransform('![a](1.png)\n\n![b](2.png)');
  assert.equal(out, '![a](1.png)\n![b](2.png)');
});

// ─── sspai transformContent: callouts + strip webp mogr params ────────────────

test('sspai: removes imageMogr2 webp query params', () => {
  const out = sspaiTransform('![a](https://cdn/x.png?imageMogr2/format/webp) tail');
  assert.equal(out, '![a](https://cdn/x.png) tail');
});

test('sspai: also applies callout preprocessing', () => {
  const out = sspaiTransform('> [!TIP]');
  assert.equal(out, '> 💡 **Tip**  ');
});

// ─── x normalizeHeadings ─────────────────────────────────────────────────────

test('normalizeHeadings: remaps lowest level to h1, deeper to h2', () => {
  assert.equal(normalizeHeadings('## A\n### B\n#### C'), '# A\n## B\n## C');
});

test('normalizeHeadings: no-op when already h1-based', () => {
  const input = '# A\n## B';
  assert.equal(normalizeHeadings(input), input);
});

test('normalizeHeadings: no-op when there are no headings', () => {
  const input = 'just text\nmore text';
  assert.equal(normalizeHeadings(input), input);
});

test('normalizeHeadings: ignores # inside fenced code blocks', () => {
  const input = '## Title\n```\n# not a heading\n```\n### Sub';
  const out = normalizeHeadings(input);
  assert.equal(out, '# Title\n```\n# not a heading\n```\n## Sub');
});

// ─── x parseSegments ─────────────────────────────────────────────────────────

test('parseSegments: splits text / image / code segments', () => {
  const md = 'intro\n\n![img](pic.png)\n\n```js\ncode\n```\nmore';
  const { segments, images, codeBlocks } = parseSegments(md, null);

  assert.equal(images.length, 1);
  assert.equal(codeBlocks.length, 1);
  assert.equal(segments.filter(s => s.type === 'text').length, 2);

  assert.equal(images[0].src, 'pic.png');
  assert.equal(images[0].alt, 'img');
  assert.ok(images[0].localPath, 'local image gets a resolved localPath');

  assert.equal(codeBlocks[0].lang, 'js');
  assert.equal(codeBlocks[0].content, 'code');
});

test('parseSegments: remote images have null localPath', () => {
  const { images } = parseSegments('![a](https://cdn/x.png)', null);
  assert.equal(images.length, 1);
  assert.equal(images[0].localPath, null);
  assert.equal(images[0].src, 'https://cdn/x.png');
});

test('parseSegments: unterminated code block is still captured', () => {
  const { codeBlocks } = parseSegments('```py\nx = 1\nstill code', null);
  assert.equal(codeBlocks.length, 1);
  assert.equal(codeBlocks[0].lang, 'py');
  assert.ok(codeBlocks[0].content.includes('x = 1'));
});
