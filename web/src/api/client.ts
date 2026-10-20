// Thin typed wrappers over the REST endpoints in src/gui.js — that file is the
// contract, not this one. The server answers some failures with a populated
// `error` field on a 2xx/4xx body (e.g. a scan that found nothing), so those
// wrappers deliberately skip jsonOrThrow and let the caller read `.error`.
import type {
  Article,
  BrowseDirResult,
  Platform,
  ProjectConfig,
  Settings,
} from './types';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const api = {
  async getPlatforms(): Promise<Platform[]> {
    return jsonOrThrow<Platform[]>(await fetch('/api/platforms'));
  },

  async getSettings(): Promise<Settings> {
    return jsonOrThrow<Settings>(await fetch('/api/settings'));
  },

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    return jsonOrThrow<Settings>(await postJson('/api/settings', patch));
  },

  async getArticles(dir: string): Promise<{
    articles: Article[];
    dir: string;
    projectConfig?: ProjectConfig;
    error?: string;
  }> {
    const res = await fetch(`/api/articles?dir=${encodeURIComponent(dir)}`);
    return res.json();
  },

  async parsePath(filePath: string): Promise<{ articles?: Article[]; error?: string }> {
    const res = await postJson('/api/articles/parse', { filePath });
    return res.json();
  },

  async uploadFiles(
    files: { name: string; content: string }[],
  ): Promise<{ articles?: Article[]; error?: string }> {
    const res = await postJson('/api/articles/upload', { files });
    return res.json();
  },

  async browseDir(path: string): Promise<BrowseDirResult> {
    const res = await fetch(`/api/browse-dir?path=${encodeURIComponent(path)}`);
    return res.json();
  },

  async publish(payload: {
    filePaths: string[];
    platforms: string[];
    category?: string[];
    tag?: string[];
    autoCover: boolean;
    removeCoverImg: boolean;
  }): Promise<void> {
    await jsonOrThrow(await postJson('/api/publish', payload));
  },

  async cancelPublish(): Promise<void> {
    // Must check res.ok: the server answers 400 when nothing is running, and a
    // silent success here would tell the user a cancel is under way when none is.
    await jsonOrThrow(await postJson('/api/cancel-publish', {}));
  },

  async closeBrowser(): Promise<Response> {
    return fetch('/api/close-browser', { method: 'POST' });
  },

  async openPlatform(platform: string): Promise<void> {
    await jsonOrThrow(await postJson('/api/open-platform', { platform }));
  },

  async checkLogin(): Promise<Response> {
    return fetch('/api/check-login', { method: 'POST' });
  },

  async shutdown(): Promise<void> {
    await fetch('/api/shutdown', { method: 'POST' });
  },

  /**
   * Ask the main process to check for a new release.
   *
   * The check itself — and the dialogs that go with it — live in the main
   * process: a web page can neither run the updater nor show a native
   * dialog. The preload exposes exactly this one call.
   *
   * The GUI server can also be opened in a plain browser (npm run gui), and
   * there is no main process there — say so instead of failing silently.
   */
  async checkForUpdates(): Promise<string> {
    const bridge = (window as unknown as {
      mdPublisher?: { checkForUpdates?: () => Promise<string> };
    }).mdPublisher;
    if (!bridge?.checkForUpdates) {
      throw new Error('检查更新只能在桌面应用里使用');
    }
    return bridge.checkForUpdates();
  },
};

