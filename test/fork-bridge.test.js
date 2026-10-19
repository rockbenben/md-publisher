import { test } from 'node:test';
import assert from 'node:assert';
import { attachForkBridge, tokenMatches } from '../src/fork-bridge.js';

function fakePort() {
  const handlers = {};
  return {
    sent: [],
    postMessage(m) { this.sent.push(m); },
    on(ev, fn) { handlers[ev] = fn; },
    emit(ev, payload) { handlers[ev]?.(payload); },
  };
}

test('attachForkBridge: not forked -> returns false, no throw', () => {
  assert.equal(attachForkBridge({ parentPort: null, port: 9870, onShutdown() {} }), false);
});

test('attachForkBridge: posts listening on attach', () => {
  const p = fakePort();
  const forked = attachForkBridge({ parentPort: p, port: 9870, onShutdown() {} });
  assert.equal(forked, true);
  assert.deepEqual(p.sent[0], { type: 'listening', port: 9870 });
});

test('attachForkBridge: echoes the handshake token when provided', () => {
  const p = fakePort();
  attachForkBridge({ parentPort: p, port: 9870, token: 'secret', onShutdown() {} });
  assert.deepEqual(p.sent[0], { type: 'listening', port: 9870, token: 'secret' });
});

test('tokenMatches: accepts only the exact token', () => {
  assert.equal(tokenMatches('secret', 'secret'), true);
  assert.equal(tokenMatches('secrer', 'secret'), false);
  assert.equal(tokenMatches('secret', 'secret2'), false);
  assert.equal(tokenMatches('sec', 'secret'), false);
  assert.equal(tokenMatches(undefined, 'secret'), false);
  assert.equal(tokenMatches('secret', undefined), false);
});

test('attachForkBridge: shutdown message triggers onShutdown', () => {
  const p = fakePort();
  let called = 0;
  attachForkBridge({ parentPort: p, port: 9870, onShutdown() { called += 1; } });
  // MessagePortMain delivers a MessageEvent with `.data`
  p.emit('message', { data: { type: 'shutdown' } });
  assert.equal(called, 1);
});

test('attachForkBridge: unrelated message is ignored', () => {
  const p = fakePort();
  let called = 0;
  attachForkBridge({ parentPort: p, port: 9870, onShutdown() { called += 1; } });
  p.emit('message', { data: { type: 'noop' } });
  assert.equal(called, 0);
});
