import { test } from 'node:test';
import assert from 'node:assert/strict';

import { transformContent as zhihuTransform } from '../src/platforms/zhihu.js';
import { transformContent as sspaiTransform } from '../src/platforms/sspai.js';

// The content transforms two platform editors need before pasting: Zhihu's
// markdown parser chokes on blank lines around images, and SSPAI's image URLs
// carry a webp-conversion query that its editor cannot fetch.
//
// The X platform's own content helpers live in x-platform.test.js, and
// parser.js's coverFileMeta test lives in parser.test.js — each test file
// covers one source module.

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
