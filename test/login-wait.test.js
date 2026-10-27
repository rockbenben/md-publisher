import test from 'node:test';
import assert from 'node:assert/strict';
import { setGuiMode, waitForLogin } from '../src/browser.js';

setGuiMode(true);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const platform = { name: '测试平台', loggedInSelector: '.logged-in' };

// A fake page whose selector wait behaves like Playwright's.
function pageWaiting(ms, outcome) {
  return {
    waitForSelector: async () => {
      await delay(ms);
      if (outcome === 'timeout') {
        const err = new Error('Timeout 300000ms exceeded.');
        err.name = 'TimeoutError';
        throw err;
      }
      return {};
    },
  };
}

test('GUI mode actually waits for the login selector', async () => {
  const started = Date.now();
  await assert.rejects(
    waitForLogin(pageWaiting(80, 'timeout'), platform),
    (err) => {
      assert.equal(err.code, 'LOGIN_REQUIRED');
      return /登录未完成/.test(err.message);
    },
  );
  assert.ok(Date.now() - started >= 60, 'should not resolve before the selector wait ends');
});

test('GUI mode continues once the logged-in selector appears', async () => {
  const started = Date.now();
  await waitForLogin(pageWaiting(60, 'found'), platform);
  assert.ok(Date.now() - started >= 40, 'should wait for the selector before continuing');
});

test('cancelling interrupts a login wait', async () => {
  const ac = new AbortController();
  const pending = waitForLogin(
    { waitForSelector: () => new Promise(() => {}) },
    platform,
    ac.signal,
  );
  await delay(20);
  ac.abort();
  await assert.rejects(pending, /发布已取消/);
});

test('an already-cancelled signal does not leave the selector wait unhandled', async () => {
  const ac = new AbortController();
  ac.abort();
  let unhandled = null;
  const onUnhandled = (reason) => { unhandled = reason; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const page = {
      waitForSelector: () => new Promise((_, reject) => {
        setTimeout(() => reject(new Error('late selector failure')), 30);
      }),
    };
    await assert.rejects(waitForLogin(page, platform, ac.signal), /发布已取消/);
    await delay(70);
    assert.equal(unhandled, null);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
