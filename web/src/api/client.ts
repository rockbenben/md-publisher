// Thin typed wrappers over the existing REST endpoints. No behavior change —
// same routes, same payloads as the original src/public/index.html client.
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
    await fetch('/api/cancel-publish', { method: 'POST' });
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
};

export const ARTICLE_EXTS = [
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.mkdn',
  '.mdwn',
  '.mdx',
  '.txt',
];
export const SKIP_FILES = new Set([
  'readme.md',
  'changelog.md',
  'license.md',
  'license.txt',
]);
export const SKIP_DIRS = new Set(['node_modules', 'user-data', '.git', '.vscode']);
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
