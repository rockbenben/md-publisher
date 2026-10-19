const { app } = require('electron');

// Check for a newer release WITHOUT applying it.
//
// electron-builder already publishes latest*.yml / latest-mac.yml /
// latest-linux.yml next to the installers, but nothing consumes them: this app
// ships unsigned, and a macOS bundle that is neither signed nor notarised
// cannot self-update at all. Adding electron-updater would fix neither.
//
// More to the point, the whole promise of this tool is that it never acts on
// its own — the last click is always the user's. Silently replacing the binary
// would contradict that. So this only *tells* the user a newer version exists
// and hands the decision over.
//
// Cost: one unauthenticated GET to the GitHub API. Nothing about the user's
// manuscripts, files or platform logins is sent. Failure is never surfaced as
// an error — offline or rate-limited just means "no news".

function repoSlug() {
  try {
    // Single source of truth: the repository field we added to package.json.
    // Works in dev and in the packaged app (asar is disabled and package.json
    // is listed in electron-builder's `files`).
    const url = require('../package.json').repository?.url || '';
    const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch { /* fall through to "unknown" */ }
  return null;
}

function parseVersion(v) {
  const m = String(v).match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function isNewer(latest, current) {
  for (let i = 0; i < 3; i += 1) {
    if (latest[i] > current[i]) return true;
    if (latest[i] < current[i]) return false;
  }
  return false;
}

/**
 * @returns {Promise<null | {current: string, latest: string, newer: boolean, url: string}>}
 *   null when the repo is unknown, the request failed, or the shape was not
 *   what we expect. Never throws.
 */
async function checkForUpdate({ timeoutMs = 8000 } = {}) {
  const slug = repoSlug();
  if (!slug) return null;
  const current = app.getVersion();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'md-publisher' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    // A draft is not published yet — that is how the three matrix jobs race
    // when they all try to create the same release.
    if (data.draft) return null;
    const latest = String(data.tag_name || '').replace(/^v/, '');
    const l = parseVersion(latest);
    const c = parseVersion(current);
    if (!l || !c) return null;
    return {
      current,
      latest,
      newer: isNewer(l, c),
      url: data.html_url || `https://github.com/${slug}/releases/latest`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkForUpdate };
