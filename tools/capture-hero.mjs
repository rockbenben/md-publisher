// One-off capture of the real md-publisher GUI for the README hero image.
// Launches the packaged main process against a throwaway userData dir that is
// pre-seeded with sample articles, so the screenshot shows the populated UI
// rather than the empty state.
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const articleDir = process.argv[2];
const outPath = process.argv[3];
// Optional 4th arg: which top-level tab to show — 'publish' (default) or 'settings'.
const tab = process.argv[4] === 'settings' ? 'settings' : 'publish';
if (!articleDir || !outPath) {
  console.error('usage: node tools/capture-hero.mjs <articleDir> <out.png> [publish|settings]');
  process.exit(2);
}

const userDataDir = mkdtempSync(join(tmpdir(), 'mdpub-hero-'));
const port = 9930 + Math.floor(Math.random() * 300);

let app;
try {
  app = await electron.launch({
    args: [root, `--user-data-dir=${userDataDir}`],
    cwd: root,
    env: { ...process.env, PORT: String(port) },
  });
  const page = await app.firstWindow({ timeout: 60000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

  // Seed settings AFTER the server is up (it owns settings.json), then reload
  // the SPA so it picks the directory up.
  await page.evaluate(async ({ dir, port }) => {
    await fetch(`http://127.0.0.1:${port}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        articleDir: dir,
        defaultPlatforms: ['sspai', 'zhihu', 'wechat', 'juejin', 'smzdm', 'x'],
      }),
    });
  }, { dir: articleDir, port: String(port) });

  await page.setViewportSize({ width: 1400, height: 860 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Wait for the manuscript list to actually populate.
  // Wait for the SPA to have painted its first view, then switch if asked.
  await page.waitForSelector('.manuscript, .manuscript-list', { timeout: 20000 });
  if (tab === 'settings') {
    await page.click('#tab-settings');
    await page.waitForSelector('#panel-settings .settings-card', { timeout: 10000 });
  }
  await page.waitForTimeout(1200);
  // Park the pointer off the content: a lingering hover pops a tooltip into the
  // shot, which then differs run to run.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(300);

  mkdirSync(dirname(outPath), { recursive: true });
  // Clip to end just after the publish bar: the app scrolls, so a
  // full-viewport shot always ends mid-element, and a half-rendered dark log
  // panel reads as a rendering fault rather than a screenshot.
  // Do NOT widen the viewport to chase a banner ratio — `.shell` caps the
  // content at 1080px (+56px padding), so anything past ~1136px only adds
  // whitespace and pushes the right edge of the UI further from the shot.
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 1400, height: 790 } });
  console.log('wrote', outPath);
} finally {
  if (app) await app.close().catch(() => {});
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
}
