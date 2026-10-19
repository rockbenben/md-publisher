// Electron smoke test — launches the packaged main process, waits for the
// window, asserts the embedded API responds and the SPA rendered.
// Run explicitly via `npm run test:e2e` (not part of the fast unit suite).
import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = (...a) => console.log('[e2e]', ...a);

// Isolate the run: without a dedicated --user-data-dir the child inherits the
// developer's real userData, so this test would read/write the actual
// settings.json and .uploads and contend for the single-instance lock of a
// running md-publisher (which then exits without ever opening a window).
const userDataDir = mkdtempSync(join(tmpdir(), 'md-pub-e2e-'));
const port = 9870 + Math.floor(Math.random() * 500);

let app;
try {
  app = await electron.launch({
    args: [root, `--user-data-dir=${userDataDir}`],
    cwd: root,
    env: { ...process.env, PORT: String(port) },
  });
  let ok = false;
  try {
    const page = await app.firstWindow({ timeout: 60000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    // Same-origin API call from within the renderer
    const platforms = await page.evaluate(async () => {
      const r = await fetch('/api/platforms');
      return r.json();
    });
    log('platforms:', Array.isArray(platforms) ? platforms.map((p) => p.id).join(',') : platforms);
    ok = Array.isArray(platforms) && platforms.length > 0;

    // The handshake endpoint must stay closed to anyone without the token the
    // main process generated — otherwise a foreign process on the port could be
    // mistaken for our own server.
    const handshake = await page.evaluate(async () => {
      const r = await fetch('/api/handshake');
      return r.status;
    });
    log('handshake without token:', handshake, '(expect 404)');
    ok = ok && handshake === 404;
  } catch (err) {
    log('ERROR:', err.message);
  } finally {
    await app.close();
  }
  console.log(ok ? '\nE2E RESULT: PASS' : '\nE2E RESULT: FAIL');
  process.exit(ok ? 0 : 1);
} finally {
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
}
