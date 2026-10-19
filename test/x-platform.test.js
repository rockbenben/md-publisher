import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHeadings, parseSegments, sniffImageExt } from '../src/platforms/x.js';

// The X platform's pure content helpers. The block-rearrangement replica below
// guards `replaceMarkers`, which runs inside the browser via page.evaluate and
// therefore cannot be imported directly.

/**
 * Pure replica of the block-rearrangement algorithm inside x.js `replaceMarkers`
 * (which runs in the browser via page.evaluate and can't be imported directly).
 * Kept byte-faithful to the real loop so it guards the algorithm's correctness:
 *  - all-success must equal the old ordinal behaviour (no regression),
 *  - a failed image in the middle must NOT shift later images,
 *  - a failed image must leave no leftover marker block.
 *
 * blocks: [{ type:'text'|'img'|'code'|'media'|'other', num?, id }]
 *   media blocks appear at the end in DraftJS order (first uploaded ends last).
 * uploadedMarkers: image marker numbers that produced a media block, in upload order.
 * Returns { ids: newBlockIds, movedImages, movedCode, droppedImages }.
 */
function rearrange(blocks, uploadedMarkers, codeAtomicCount) {
  const imgMarkers = new Set();
  const imgMarkerNum = new Map();
  const codeMarkers = new Set();
  const mediaBlocks = [];
  blocks.forEach((b, i) => {
    if (b.type === 'img') { imgMarkers.add(i); imgMarkerNum.set(i, b.num); }
    else if (b.type === 'code') codeMarkers.add(i);
    else if (b.type === 'media') mediaBlocks.push({ index: i, block: b.id });
  });
  const codeAtomics = Array.from({ length: codeAtomicCount }, (_, j) => `CODE_ATOMIC_${j}`);

  if (mediaBlocks.length > 1) mediaBlocks.unshift(mediaBlocks.pop());

  const mediaCount = Math.min(mediaBlocks.length, uploadedMarkers.length);
  const numToK = new Map();
  for (let k = 0; k < mediaCount; k++) numToK.set(uploadedMarkers[k], k);

  const mediaSet = new Set(mediaBlocks.map(mb => mb.index));
  const newBlocks = [];
  const placedK = new Set();
  let codeIdx = 0, movedImages = 0, movedCode = 0, droppedImages = 0;

  for (let i = 0; i < blocks.length; i++) {
    if (imgMarkers.has(i)) {
      const k = numToK.get(imgMarkerNum.get(i));
      if (k !== undefined) { newBlocks.push(mediaBlocks[k].block); placedK.add(k); movedImages++; }
      else droppedImages++;
    } else if (codeMarkers.has(i) && codeIdx < codeAtomics.length) {
      newBlocks.push(codeAtomics[codeIdx]); codeIdx++; movedCode++;
    } else if (!mediaSet.has(i)) {
      newBlocks.push(blocks[i].id);
    }
  }
  for (let k = 0; k < mediaBlocks.length; k++) {
    if (!placedK.has(k)) { newBlocks.push(mediaBlocks[k].block); movedImages++; }
  }
  return { ids: newBlocks, movedImages, movedCode, droppedImages };
}

test('replaceMarkers: all images succeed → each media lands at its own marker', () => {
  // Upload order img0,img1 → DraftJS appends with img0 (first) last: [m1, m0].
  const blocks = [
    { type: 'text', id: 'T0' },
    { type: 'img', num: 0, id: 'IM0' },
    { type: 'text', id: 'T1' },
    { type: 'img', num: 1, id: 'IM1' },
    { type: 'media', id: 'MEDIA1' },
    { type: 'media', id: 'MEDIA0' },
  ];
  const r = rearrange(blocks, [0, 1], 0);
  assert.deepEqual(r.ids, ['T0', 'MEDIA0', 'T1', 'MEDIA1']);
  assert.equal(r.movedImages, 2);
  assert.equal(r.droppedImages, 0);
});

test('replaceMarkers: a failed middle image does not shift later images, leaves no marker', () => {
  // img1 failed; uploaded img0,img2 → appended [m2, m0] (img0 first → last).
  const blocks = [
    { type: 'img', num: 0, id: 'IM0' },
    { type: 'text', id: 'T1' },
    { type: 'img', num: 1, id: 'IM1' }, // failed
    { type: 'text', id: 'T2' },
    { type: 'img', num: 2, id: 'IM2' },
    { type: 'media', id: 'MEDIA2' },
    { type: 'media', id: 'MEDIA0' },
  ];
  const r = rearrange(blocks, [0, 2], 0);
  // img0 at marker0, img2 at marker2 (NOT shifted into marker1), marker1 gone.
  assert.deepEqual(r.ids, ['MEDIA0', 'T1', 'T2', 'MEDIA2']);
  assert.equal(r.movedImages, 2);
  assert.equal(r.droppedImages, 1);
  assert.ok(!r.ids.includes('IM1'), 'no leftover literal marker block');
});

test('replaceMarkers: a single failed image (no code) is dropped, not left as text', () => {
  const blocks = [
    { type: 'text', id: 'T0' },
    { type: 'img', num: 0, id: 'IM0' }, // failed, no media uploaded
  ];
  const r = rearrange(blocks, [], 0);
  assert.deepEqual(r.ids, ['T0']);
  assert.equal(r.movedImages, 0);
  assert.equal(r.droppedImages, 1); // > 0 ⇒ real change ⇒ no early-return
});

test('replaceMarkers: code markers and image markers coexist', () => {
  const blocks = [
    { type: 'img', num: 0, id: 'IM0' },
    { type: 'code', id: 'CM0' },
    { type: 'media', id: 'MEDIA0' },
  ];
  const r = rearrange(blocks, [0], 1);
  assert.deepEqual(r.ids, ['MEDIA0', 'CODE_ATOMIC_0']);
  assert.equal(r.movedImages, 1);
  assert.equal(r.movedCode, 1);
});

test('replaceMarkers: an uploaded image whose marker text vanished is still appended (not lost)', () => {
  // Marker for img0 missing from the doc, but media exists → safety-net append.
  const blocks = [
    { type: 'text', id: 'T0' },
    { type: 'media', id: 'MEDIA0' },
  ];
  const r = rearrange(blocks, [0], 0);
  assert.deepEqual(r.ids, ['T0', 'MEDIA0']);
  assert.equal(r.movedImages, 1);
});

// The single `unshift(pop())` rotation in x.js is only correct because DraftJS
// leaves the FIRST uploaded image last and the rest in upload order. With just
// two media blocks that invariant is indistinguishable from several other
// orderings, so it was never actually pinned down. n=3 is the smallest case
// that distinguishes them — if this ever fails, the rotation no longer matches
// how DraftJS appends.
test('replaceMarkers: 3 images — one-step rotation still restores upload order', () => {
  const blocks = [
    { type: 'img', num: 0, id: 'IM0' },
    { type: 'text', id: 'T1' },
    { type: 'img', num: 1, id: 'IM1' },
    { type: 'text', id: 'T2' },
    { type: 'img', num: 2, id: 'IM2' },
    // DOM order: img0 (uploaded first) landed last; img1, img2 kept upload order.
    { type: 'media', id: 'MEDIA1' },
    { type: 'media', id: 'MEDIA2' },
    { type: 'media', id: 'MEDIA0' },
  ];
  const r = rearrange(blocks, [0, 1, 2], 0);
  assert.deepEqual(r.ids, ['MEDIA0', 'T1', 'MEDIA1', 'T2', 'MEDIA2']);
  assert.equal(r.movedImages, 3);
  assert.equal(r.droppedImages, 0);
});

test('replaceMarkers: 3 images with the middle one failed keeps the rest aligned', () => {
  const blocks = [
    { type: 'img', num: 0, id: 'IM0' },
    { type: 'text', id: 'T1' },
    { type: 'img', num: 1, id: 'IM1' }, // failed
    { type: 'text', id: 'T2' },
    { type: 'img', num: 2, id: 'IM2' },
    { type: 'media', id: 'MEDIA1' },
    { type: 'media', id: 'MEDIA0' },
  ];
  const r = rearrange(blocks, [0, 2], 0);
  // img0 → marker0, img2 → marker2, marker1 dropped. MEDIA1 must NOT drift
  // into marker0 just because it sits first in the DOM.
  assert.deepEqual(r.ids, ['MEDIA0', 'T1', 'T2', 'MEDIA1']);
  assert.equal(r.droppedImages, 1);
  assert.ok(!r.ids.includes('IM1'), 'no leftover literal marker block');
});

// --- sniffImageExt -----------------------------------------------------------
// A downloaded image must be saved with an extension matching its BYTES, not
// just the server's Content-Type: CDNs routinely answer
// `application/octet-stream` for a real JPEG, and saving those bytes under a
// guessed `.png` gives the upload dialog a file whose type contradicts its
// name — which it rejects with an opaque error.

function bytes(...b) { return Buffer.from(b); }

test('sniffImageExt: recognises JPEG, PNG, GIF', () => {
  assert.equal(sniffImageExt(bytes(0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0)), '.jpg');
  assert.equal(sniffImageExt(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0)), '.png');
  assert.equal(sniffImageExt(Buffer.from('GIF89a......')), '.gif');
  assert.equal(sniffImageExt(Buffer.from('GIF87a......')), '.gif');
});

test('sniffImageExt: recognises WEBP via its RIFF container', () => {
  assert.equal(sniffImageExt(Buffer.from('RIFF????WEBPVP8 ')), '.webp');
});

test('sniffImageExt: recognises AVIF/HEIC via the ISO-BMFF ftyp box', () => {
  assert.equal(sniffImageExt(Buffer.concat([bytes(0, 0, 0, 0x20), Buffer.from('ftypavif')])), '.avif');
});

test('sniffImageExt: recognises SVG even behind an XML prolog', () => {
  assert.equal(sniffImageExt(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), '.svg');
  assert.equal(sniffImageExt(Buffer.from('<?xml version="1.0"?>\n<svg/>')), '.svg');
});

test('sniffImageExt: returns null for non-image bytes so a bogus file is never uploaded', () => {
  assert.equal(sniffImageExt(Buffer.from('<!doctype html><html>404</html>')), null);
  assert.equal(sniffImageExt(Buffer.from('%PDF-1.7 ...')), null);
  assert.equal(sniffImageExt(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)), null);
});

test('sniffImageExt: rejects truncated buffers instead of guessing', () => {
  assert.equal(sniffImageExt(Buffer.alloc(0)), null);
  assert.equal(sniffImageExt(bytes(0xFF, 0xD8)), null); // too short to be sure
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

test('parseSegments: code fence with an info string (```js {1,2}) parses correctly', () => {
  const { segments, codeBlocks } = parseSegments('intro\n\n```js {1,2}\nconst a = 1;\n```\n\noutro', null);
  assert.equal(codeBlocks.length, 1, 'exactly one code block');
  assert.equal(codeBlocks[0].lang, 'js', 'language captured, info string ignored');
  assert.equal(codeBlocks[0].content, 'const a = 1;', 'code body intact');
  // The trailing paragraph must remain text — not swallowed into a bogus block.
  assert.ok(segments.some((s) => s.type === 'text' && s.content.includes('outro')));
});