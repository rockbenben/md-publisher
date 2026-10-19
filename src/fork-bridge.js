/**
 * Bridge between the Express server when run as an Electron utilityProcess
 * child and the Electron main process. No-op (returns false) when there is no
 * parent port, so the CLI / `npm run gui` path is unaffected.
 *
 * `token` is the per-boot secret the main process generated and passed in via
 * MDPUB_TOKEN. It is echoed back on the `listening` message so the main process
 * can confirm the server answering on the port is really its own child and not
 * some other process that happened to bind the port first.
 *
 * @param {{ parentPort: any, port: number, token?: string, onShutdown: () => any }} opts
 * @returns {boolean} whether running in forked mode
 */
export function attachForkBridge({ parentPort, port, token, onShutdown }) {
  if (!parentPort) return false;
  parentPort.postMessage({ type: 'listening', port, ...(token ? { token } : {}) });
  parentPort.on('message', (event) => {
    const msg = event?.data ?? event;
    if (msg?.type === 'shutdown') onShutdown?.();
  });
  return true;
}

/**
 * Constant-time-ish comparison of a presented token against the expected one.
 * Returns false when no token is configured, so the endpoint stays closed
 * unless the parent explicitly supplied one.
 * @param {*} presented
 * @param {string|undefined} expected
 * @returns {boolean}
 */
export function tokenMatches(presented, expected) {
  if (!expected) return false;
  if (typeof presented !== 'string') return false;
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
