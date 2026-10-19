import { test } from 'node:test';
import assert from 'node:assert';
import supervisor from '../electron/supervisor.cjs';

const { createRestartPolicy } = supervisor;

test('healthy run resets the consecutive-crash counter', () => {
  const p = createRestartPolicy({ maxRestarts: 2, minUptimeMs: 5000 });
  assert.deepEqual(p.recordExit(1000), { restart: true, delayMs: 2000 }); // crash 1
  assert.deepEqual(p.recordExit(10000).restart, true);                    // healthy -> reset
  assert.equal(p.recordExit(1000).restart, true);                         // crash 1 again (counter was reset)
});

test('stops restarting after maxRestarts consecutive fast crashes', () => {
  const p = createRestartPolicy({ maxRestarts: 2, minUptimeMs: 5000 });
  assert.equal(p.recordExit(100).restart, true);  // 1
  assert.equal(p.recordExit(100).restart, true);  // 2
  assert.equal(p.recordExit(100).restart, false); // 3 > max -> stop
});

test('reset() clears the counter', () => {
  const p = createRestartPolicy({ maxRestarts: 1, minUptimeMs: 5000 });
  p.recordExit(100); // 1
  p.recordExit(100); // 2 -> would stop next
  p.reset();
  assert.equal(p.recordExit(100).restart, true);
});

test('consecutive fast crashes back off exponentially', () => {
  const p = createRestartPolicy({ maxRestarts: 10, minUptimeMs: 5000, baseDelayMs: 1000 });
  assert.equal(p.recordExit(100).delayMs, 1000); // crash 1
  assert.equal(p.recordExit(100).delayMs, 2000); // crash 2
  assert.equal(p.recordExit(100).delayMs, 4000); // crash 3
  assert.equal(p.recordExit(100).delayMs, 8000); // crash 4
});

test('backoff is capped so a wedged child cannot stall restarts forever', () => {
  const p = createRestartPolicy({ maxRestarts: 30, minUptimeMs: 5000, baseDelayMs: 1000, maxDelayMs: 10000 });
  let last;
  for (let i = 0; i < 20; i++) last = p.recordExit(100);
  assert.equal(last.delayMs, 10000);
});

test('a healthy run returns the delay to the base value', () => {
  const p = createRestartPolicy({ maxRestarts: 10, minUptimeMs: 5000, baseDelayMs: 1000 });
  p.recordExit(100); // 1 -> 1000
  p.recordExit(100); // 2 -> 2000
  p.recordExit(100); // 3 -> 4000
  assert.equal(p.recordExit(30000).delayMs, 1000); // healthy -> counter reset
});
