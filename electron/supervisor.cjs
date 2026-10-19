// Pure restart policy for the Express server child process. No Electron deps,
// so it is unit-testable under `node --test`.
function createRestartPolicy({ maxRestarts = 10, minUptimeMs = 5000, baseDelayMs = 2000, maxDelayMs = 30000 } = {}) {
  let consecutive = 0;
  return {
    // Call when the child exits. `uptimeMs` is how long it ran before exiting.
    recordExit(uptimeMs) {
      if (uptimeMs >= minUptimeMs) consecutive = 0;
      else consecutive += 1;
      if (consecutive > maxRestarts) return { restart: false, delayMs: 0 };
      // Exponential backoff on consecutive fast crashes: without it a child that
      // dies instantly (e.g. port in use) is re-forked ~10 times in ~20s,
      // burning CPU and filling the log. A healthy run resets `consecutive`,
      // so the delay returns to baseDelayMs.
      const delayMs = Math.min(baseDelayMs * 2 ** Math.max(0, consecutive - 1), maxDelayMs);
      return { restart: true, delayMs };
    },
    reset() { consecutive = 0; },
  };
}

module.exports = { createRestartPolicy };
