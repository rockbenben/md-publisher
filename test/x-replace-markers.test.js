import { test } from 'node:test';
import assert from 'node:assert/strict';

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
