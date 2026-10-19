// Which files count as articles, and which to leave alone.
//
// These mirror the backend's own lists in `src/parser.js` (ARTICLE_EXTS,
// SKIP_FILES, SKIP_DIRS) and the size cap in `src/gui.js` (MAX_FILE_SIZE).
// The browser and the server run in different processes, so the lists cannot
// share an import — they must be kept in step BY HAND. They were living in
// `api/client.ts`, which this file imported them from; that put file-picking
// rules in the HTTP layer, where nothing used them.
//
// The two lists are not identical, and do not need to be:
//   · SKIP_FILES — the backend also skips `.md-publisher.yml` / `.yaml`, but
//     those are not article extensions here, so the extension check rejects
//     them anyway.
//   · SKIP_DIRS — this side additionally lists `.git` / `.vscode`; the backend
//     skips every dot-directory outright.
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
export const SKIP_FILES = new Set(['readme.md', 'changelog.md', 'license.md', 'license.txt']);
export const SKIP_DIRS = new Set(['node_modules', 'user-data', '.git', '.vscode']);
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file

export interface PickedFile {
  name: string;
  content: string;
}
export interface PickResult {
  files: PickedFile[];
  skipped: string[];
  /** A directory was opened but held no article files. */
  emptyDir?: boolean;
}

const hasExt = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && ARTICLE_EXTS.includes(name.slice(dot).toLowerCase());
};

async function readAll(fileList: File[]): Promise<PickResult> {
  const files: PickedFile[] = [];
  const skipped: string[] = [];
  for (const f of fileList) {
    if (f.size > MAX_FILE_SIZE) {
      skipped.push(`${f.name}（${(f.size / 1024 / 1024).toFixed(1)}MB）`);
      continue;
    }
    files.push({ name: f.name, content: await f.text() });
  }
  return { files, skipped };
}

// Minimal shapes for the File System Access API (not in all TS DOM libs).
interface FsHandle {
  kind: 'file' | 'directory';
  name: string;
  getFile(): Promise<File>;
  values(): AsyncIterable<FsHandle>;
}
type WinFs = {
  showOpenFilePicker?: (opts?: unknown) => Promise<FsHandle[]>;
  showDirectoryPicker?: () => Promise<FsHandle>;
};

async function collect(dir: FsHandle): Promise<File[]> {
  const out: File[] = [];
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.')) continue;
    if (entry.kind === 'file') {
      if (SKIP_FILES.has(entry.name.toLowerCase())) continue;
      if (hasExt(entry.name)) out.push(await entry.getFile());
    } else if (entry.kind === 'directory' && !SKIP_DIRS.has(entry.name)) {
      out.push(...(await collect(entry)));
    }
  }
  return out;
}

function fallbackInput(directory: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (directory) input.setAttribute('webkitdirectory', '');
    else {
      input.multiple = true;
      input.accept = ARTICLE_EXTS.join(',');
    }
    input.style.display = 'none';
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.onchange = () => finish(Array.from(input.files ?? []));
    document.body.appendChild(input);
    input.click();
    // Cancel detection: focus returns when the dialog closes. In some browsers
    // (e.g. Firefox) that `focus` fires BEFORE the input's `change`, so resolve
    // the empty (cancel) result on a short delay — a real selection's change
    // event settles first and the deferred cancel becomes a no-op.
    window.addEventListener('focus', () => {
      setTimeout(() => finish([]), 400);
    }, { once: true });
  });
}

export async function pickFiles(): Promise<PickResult | null> {
  const w = window as unknown as WinFs;
  if (w.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'Markdown / Text', accept: { 'text/plain': ARTICLE_EXTS } }],
      });
      return readAll(await Promise.all(handles.map((h) => h.getFile())));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
    }
  }
  const list = await fallbackInput(false);
  if (!list.length) return null;
  return readAll(list);
}

export async function pickFolder(): Promise<PickResult | null> {
  const w = window as unknown as WinFs;
  if (w.showDirectoryPicker) {
    try {
      const files = await collect(await w.showDirectoryPicker());
      if (!files.length) return { files: [], skipped: [], emptyDir: true };
      return readAll(files);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
    }
  }
  const all = await fallbackInput(true);
  const filtered = all.filter((f) => {
    if (f.name.startsWith('.')) return false;
    const parts = (f.webkitRelativePath || '').split('/');
    if (parts.slice(0, -1).some((p) => p.startsWith('.') || SKIP_DIRS.has(p))) return false;
    if (SKIP_FILES.has(f.name.toLowerCase())) return false;
    return hasExt(f.name);
  });
  if (!filtered.length) return all.length ? { files: [], skipped: [], emptyDir: true } : null;
  return readAll(filtered);
}
