import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import net from 'node:net';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('article API reports relative paths and skipped files for scan and upload', { timeout: 30000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mdpub-api-data-'));
  const articleDir = mkdtempSync(join(tmpdir(), 'mdpub-api-articles-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child;

  try {
    writeFileSync(join(articleDir, 'good.md'), '---\ntitle: Good\n---\nbody');
    mkdirSync(join(articleDir, 'sub'));
    writeFileSync(join(articleDir, 'sub', 'deep.md'), '---\ntitle: Deep\n---\nbody');
    writeFileSync(join(articleDir, 'sub', 'bad.md'), '---\ntitle: [bad\n---\nbody');
    mkdirSync(join(articleDir, 'sub-a'));
    mkdirSync(join(articleDir, 'sub-b'));
    writeFileSync(join(articleDir, 'sub-a', 'same.md'), '---\ntitle: Same A\n---\nbody');
    writeFileSync(join(articleDir, 'sub-b', 'same.md'), '---\ntitle: Same B\n---\nbody');

    child = spawn(process.execPath, ['src/gui.js'], {
      cwd: root,
      env: { ...process.env, MDPUB_DATA_DIR: dataDir, PORT: String(port), NO_OPEN: '1' },
      stdio: 'ignore',
      windowsHide: true,
    });

    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) break;
      try {
        const res = await fetch(`${base}/api/settings`);
        if (res.ok) { ready = true; break; }
      } catch { /* starting */ }
      await delay(100);
    }
    assert.ok(ready, 'GUI server should start');

    const scanRes = await fetch(`${base}/api/articles?dir=${encodeURIComponent(articleDir)}`);
    assert.equal(scanRes.status, 200);
    const scan = await scanRes.json();
    assert.equal(scan.error, undefined);
    assert.deepEqual(
      scan.articles.map((a) => a.relativePath).sort(),
      ['good.md', 'sub-a/same.md', 'sub-b/same.md', 'sub/deep.md'],
    );
    assert.equal(scan.skipped.length, 1);
    assert.equal(scan.skipped[0].fileName, 'bad.md');
    assert.equal(scan.skipped[0].relativePath, 'sub/bad.md');
    assert.ok(scan.skipped[0].reason);
    assert.ok(!scan.skipped[0].reason.includes('\n'), 'scan reason is one line');

    const uploadRes = await fetch(`${base}/api/articles/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          { name: 'upload-good.md', content: '---\ntitle: Uploaded\n---\nbody' },
          { name: 'upload-bad.md', content: '---\ntitle: [bad\n---\nbody' },
        ],
      }),
    });
    assert.equal(uploadRes.status, 200);
    const upload = await uploadRes.json();
    assert.equal(upload.articles.length, 1);
    assert.equal(upload.articles[0].title, 'Uploaded');
    assert.equal(upload.skipped.length, 1);
    assert.equal(upload.skipped[0].fileName, 'upload-bad.md');
    assert.ok(!upload.skipped[0].reason.includes('\n'), 'upload reason is one line');
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), delay(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(articleDir, { recursive: true, force: true });
  }
});
