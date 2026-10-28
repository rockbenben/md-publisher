import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp } from 'antd';
import { api } from './api/client';
import type {
  Article,
  DispatchInfo,
  LoginStatus,
  LogEntry,
  Platform,
  ProjectConfig,
  Settings as SettingsT,
  SkippedFile,
} from './api/types';
import { useSSE } from './hooks/useSSE';
import { pickFiles, pickFolder, type PickedFile } from './lib/filePicker';

import Masthead from './components/Masthead';
import Manuscripts from './components/Manuscripts';
import Destinations from './components/Destinations';
import ConfigBadge from './components/ConfigBadge';
import ActionsBar from './components/ActionsBar';
import ProgressBanner from './components/ProgressBanner';
import TheWire from './components/TheWire';
import DirBrowserModal from './components/DirBrowserModal';
import Settings from './components/Settings';

const MAX_LOG_LINES = 500;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The outcome of a manuscript scan.
 *
 * 'superseded' is deliberately NOT a failure: another refresh started while
 * this one was in flight, so this one steps aside. Callers that report "the
 * scan failed" must not treat that as a failure — the work they did (e.g.
 * saving the settings) succeeded regardless.
 */
type ScanOutcome = 'ok' | 'failed' | 'superseded';

const clock = (sec: boolean) => {
  const d = new Date();
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sec ? `${base}:${pad(d.getSeconds())}` : base;
};

function readCoverPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem('coverSettings') || 'null');
    if (raw) return { autoCover: raw.autoCover === true, removeCoverImg: raw.removeCoverImg !== false };
  } catch {
    /* ignore */
  }
  return { autoCover: false, removeCoverImg: true };
}

export default function App() {
  const { message, modal } = AntApp.useApp();

  const [tab, setTab] = useState<'publish' | 'settings'>('publish');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [dirArticles, setDirArticles] = useState<Article[]>([]);
  const [manualArticles, setManualArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<SettingsT>({});
  const [articleDir, setArticleDir] = useState('');
  const [chromePath, setChromePath] = useState('');
  const [checkUpdates, setCheckUpdates] = useState(false);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(null);
  const [loginStatus, setLoginStatus] = useState<Record<string, LoginStatus>>({});
  const [loginChecking, setLoginChecking] = useState(false);
  const [loginWait, setLoginWait] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [dispatch, setDispatch] = useState<Record<string, DispatchInfo>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progressText, setProgressText] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanSkipped, setScanSkipped] = useState<SkippedFile[]>([]);
  const [scanValidCount, setScanValidCount] = useState(0);
  const [listCleared, setListCleared] = useState(false);
  const [dirModalOpen, setDirModalOpen] = useState(false);
  const [cover, setCover] = useState(readCoverPrefs);

  const logId = useRef(0);
  const wasPublishing = useRef(false);
  const platformSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Guards against out-of-order /api/articles replies: two overlapping
  // refreshes (init racing a fast 刷新 click) would otherwise let the slower
  // response win and overwrite the newer list, selection and project config.
  const refreshSeq = useRef(0);
  // Latest manual rows for async scans: refreshArticles can finish after the
  // user uploaded a file, and a stale closure would otherwise write back the
  // old manual list and drop the new one.
  const manualRef = useRef<Article[]>([]);
  // Sync guard against rapid double-click before React re-renders isPublishing.
  const pendingPublish = useRef(false);

  useEffect(() => {
    manualRef.current = manualArticles;
  }, [manualArticles]);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  // Dedup manual against dir by filePath (dir wins), preserving order.
  const allArticles = useMemo(() => {
    const seen = new Set<string>();
    const out: Article[] = [];
    for (const a of [...dirArticles, ...manualArticles]) {
      if (seen.has(a.filePath)) continue;
      seen.add(a.filePath);
      out.push(a);
    }
    return out;
  }, [dirArticles, manualArticles]);

  // ---- Logging ----
  const appendLog = useCallback((text: string, level?: 'error') => {
    // Allocate the id OUTSIDE the updater: React re-invokes updaters (StrictMode
    // double-invokes in dev), so mutating the ref inside it would advance the
    // counter twice per line.
    const id = logId.current++;
    const time = clock(true);
    setLogs((prev) => {
      const next = [...prev, { id, time, text, level }];
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  const warnSkipped = useCallback(
    (items: SkippedFile[], unable = '') => {
      if (!items.length) return;
      const names = items.slice(0, 3).map((i) => i.relativePath || i.fileName).join('、');
      const more = items.length > 3 ? ` 等 ${items.length} 个文件` : '';
      message.warning(`已跳过 ${names}${more}${unable ? `（${unable}）` : ''}`);
    },
    [message],
  );

  // ---- Articles ----
  const refreshArticles = useCallback(
    async (
      dir: string,
      opts: { quiet?: boolean; preserveSelection?: boolean } = {},
    ): Promise<ScanOutcome> => {
      const seq = ++refreshSeq.current;
      setProjectConfig(null);
      let scanned: Article[] = [];
      let cfg: ProjectConfig | null = null;
      let scanFailure = '';
      let skipped: SkippedFile[] = [];
      if (dir) {
        try {
          const data = await api.getArticles(dir);
          if (seq !== refreshSeq.current) return 'superseded'; // a newer refresh superseded us
          skipped = data.skipped ?? [];
          if (data.error) {
            scanFailure = data.error;
            message.error(data.error);
          } else {
            scanned = data.articles;
            cfg = data.projectConfig ?? null;
          }
        } catch {
          if (seq !== refreshSeq.current) return 'superseded';
          scanFailure = '加载稿件失败';
          message.error(scanFailure);
        }
      }
      // Drop manual entries the directory scan now also provides. Read the
      // latest manual list through the ref, and merge functionally: a manual
      // add can land while this async scan is in flight.
      const dirPaths = new Set(scanned.map((a) => a.filePath));
      const keptManual = manualRef.current.filter((a) => !dirPaths.has(a.filePath));

      setDirArticles(scanned);
      setManualArticles((prev) => prev.filter((a) => !dirPaths.has(a.filePath)));
      setProjectConfig(cfg);
      setScanError(scanFailure);
      setScanSkipped(skipped);
      setScanValidCount(scanned.length);
      setListCleared(false);

      if (opts.preserveSelection) {
        // A manual 刷新 must not undo the user's choices — re-selecting
        // everything here would silently re-check articles the user unchecked,
        // and re-applying the project config would revert platform toggles the
        // user just made (and that togglePlatform has already persisted).
        // Keep the selection, minus anything no longer on the list.
        const visible = new Set([...scanned, ...keptManual].map((a) => a.filePath));
        setSelected((prev) => new Set([...prev].filter((fp) => visible.has(fp))));
      } else {
        // Fresh load (first run, or after switching directory): apply the
        // project config's defaults and select everything currently in view.
        if (cfg?.platforms) setSelectedPlatforms(new Set(cfg.platforms));
        setSelected(new Set([...scanned, ...keptManual].map((a) => a.filePath)));
      }

      if (!opts.quiet && dir && scanned.length > 0) {
        message.success(
          cfg
            ? `已从默认目录加载 ${scanned.length} 篇稿件（已应用项目配置）`
            : `已从默认目录加载 ${scanned.length} 篇稿件`,
        );
      }
      return scanFailure ? 'failed' : 'ok';
    },
    [message],
  );

  // ---- Init ----
  useEffect(() => {
    (async () => {
      try {
        setPlatforms(await api.getPlatforms());
        const s = await api.getSettings();
        setSettings(s);
        setArticleDir(s.articleDir || '');
        setChromePath(s.chromePath || '');
        setCheckUpdates(s.checkUpdates === true);
        if (s.defaultPlatforms) setSelectedPlatforms(new Set(s.defaultPlatforms));
        if (s.loginStatus) setLoginStatus({ ...s.loginStatus });
        await refreshArticles(s.articleDir || '', { quiet: true });
      } catch (err) {
        message.error('初始化失败: ' + (err as Error).message);
      }
    })();
    // Runs once on mount by design: refreshArticles is intentionally not a dep
    // (it changes with manualArticles and would re-run the whole init).
  }, []);

  // Drop any pending debounced settings write when the tree goes away, so it
  // can't fire into an unmounted app.
  useEffect(() => () => clearTimeout(platformSaveTimer.current), []);

  // ---- File intake ----
  const addUploaded = useCallback(
    async (files: PickedFile[], skipped: string[]) => {
      // One toast for the whole batch: a folder with five oversized files used
      // to stack five separate warnings on top of each other.
      if (skipped.length) {
        const listed = skipped.slice(0, 3).join('、');
        const rest = skipped.length > 3 ? ` 等 ${skipped.length} 个文件` : '';
        message.warning(`已跳过 ${listed}${rest}（单个超过 10MB）`);
      }
      if (!files.length) return;
      try {
        const data = await api.uploadFiles(files);
        if (data.skipped?.length) warnSkipped(data.skipped);
        if (!data.articles?.length) {
          message.error(data.error || '没有找到可解析的稿件');
          return;
        }
        const existing = new Set(allArticles.map((a) => a.filePath));
        const fresh = data.articles.filter((a) => !existing.has(a.filePath));
        if (!fresh.length) {
          message.info('所有文件已在清单中');
          return;
        }
        setManualArticles((prev) => [...prev, ...fresh]);
        setSelected((prev) => new Set([...prev, ...fresh.map((a) => a.filePath)]));
        message.success(`已添加 ${fresh.length} 篇稿件`);
      } catch (err) {
        message.error('添加失败: ' + (err as Error).message);
      }
    },
    [allArticles, message, warnSkipped],
  );

  const onPickFiles = useCallback(async () => {
    const r = await pickFiles();
    if (r) await addUploaded(r.files, r.skipped);
  }, [addUploaded]);

  const onPickFolder = useCallback(async () => {
    const r = await pickFolder();
    if (!r) return;
    if (r.emptyDir) {
      // Same wording as the empty state in the manuscript list — they describe
      // the same situation and used to say it two different ways.
      message.error('该目录下没有稿件文件');
      return;
    }
    await addUploaded(r.files, r.skipped);
  }, [addUploaded, message]);

  const onAddPath = useCallback(
    async (filePath: string): Promise<boolean> => {
      if (allArticles.some((a) => a.filePath === filePath)) return true;
      try {
        const data = await api.parsePath(filePath);
        if (data.error) {
          message.error(data.error);
          return false;
        }
        if (data.skipped?.length) warnSkipped(data.skipped, '无法解析');
        const existing = new Set(allArticles.map((a) => a.filePath));
        const fresh = (data.articles || []).filter((a) => !existing.has(a.filePath));
        if (!fresh.length) return true;
        setManualArticles((prev) => [...prev, ...fresh]);
        setSelected((prev) => new Set([...prev, ...fresh.map((a) => a.filePath)]));
        message.success(`已添加 ${fresh.length} 篇稿件`);
        return true;
      } catch (err) {
        message.error('添加失败: ' + (err as Error).message);
        return false;
      }
    },
    [allArticles, message, warnSkipped],
  );

  const removeManual = useCallback((filePath: string) => {
    setManualArticles((prev) => prev.filter((a) => a.filePath !== filePath));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  const toggleArticle = useCallback((filePath: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(filePath) ? next.delete(filePath) : next.add(filePath);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    () => setSelected(new Set(allArticles.map((a) => a.filePath))),
    [allArticles],
  );
  const deselectAll = useCallback(() => setSelected(new Set()), []);
  const clearAll = useCallback(() => {
    // Invalidate an in-flight scan; otherwise its late response repopulates
    // the list the user just cleared.
    refreshSeq.current += 1;
    setDirArticles([]);
    setManualArticles([]);
    setProjectConfig(null);
    setSelected(new Set());
    setListCleared(true);
  }, []);

  // ---- Platforms ----
  const togglePlatform = useCallback((id: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      clearTimeout(platformSaveTimer.current);
      const ids = [...next];
      platformSaveTimer.current = setTimeout(() => {
        api.saveSettings({ defaultPlatforms: ids }).catch(() =>
          message.error('平台选择保存失败，重启后可能丢失'),
        );
      }, 500);
      return next;
    });
  }, [message]);

  const onOpenPlatform = useCallback(
    async (id: string) => {
      try {
        await api.openPlatform(id);
        const name = platforms.find((p) => p.id === id)?.name ?? id;
        message.success(`已在自动化浏览器中打开「${name}」，需要登录可直接在那里操作`);
      } catch (err) {
        message.error('打开平台失败: ' + (err as Error).message);
      }
    },
    [message, platforms],
  );

  const onCheckLogin = useCallback(async () => {
    if (isPublishing) {
      message.error('请等待发布完成');
      return;
    }
    try {
      const res = await api.checkLogin();
      if (res.status === 409) message.error('正在检查中，请稍候');
    } catch (err) {
      message.error('登录检测失败: ' + (err as Error).message);
    }
  }, [isPublishing, message]);

  // ---- Publish ----
  const onPublish = useCallback(async () => {
    if (isPublishing || pendingPublish.current) return;
    pendingPublish.current = true;
    const filePaths = allArticles.filter((a) => selected.has(a.filePath)).map((a) => a.filePath);
    const platformIds = [...selectedPlatforms];
    if (!filePaths.length || !platformIds.length) {
      pendingPublish.current = false;
      message.error('请选择稿件与平台');
      return;
    }
    setIsPublishing(true);
    setDispatch({});
    setProgressText('');
    try {
      await api.publish({
        filePaths,
        platforms: platformIds,
        category: projectConfig?.category,
        tag: projectConfig?.tag,
        autoCover: cover.autoCover,
        removeCoverImg: cover.removeCoverImg,
      });
    } catch (err) {
      message.error('发布请求失败: ' + (err as Error).message);
      setIsPublishing(false);
    } finally {
      pendingPublish.current = false;
    }
  }, [allArticles, selected, selectedPlatforms, projectConfig, cover, isPublishing, message]);

  const onCancel = useCallback(async () => {
    try {
      await api.cancelPublish();
      message.info('正在取消发布…');
    } catch (err) {
      message.error('取消请求失败: ' + (err as Error).message);
    }
  }, [message]);

  const onCloseBrowser = useCallback(async () => {
    try {
      const res = await api.closeBrowser();
      if (res.status === 409) {
        message.error('发布进行中，无法关闭浏览器');
        return;
      }
      if (!res.ok) {
        message.error('关闭浏览器失败');
        return;
      }
      message.success('浏览器已关闭');
    } catch {
      message.error('关闭浏览器失败');
    }
  }, [message]);

  const onShutdown = useCallback(() => {
    if (isPublishing) {
      message.error('请等待发布完成');
      return;
    }
    modal.confirm({
      title: '确认退出 md-publisher？',
      okText: '退出',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await api.shutdown().catch(() => {});
        document.body.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:var(--font-display);color:#8a8276">md-publisher 已关闭</div>';
      },
    });
  }, [isPublishing, message, modal]);

  // ---- Cover prefs ----
  const setCoverPref = useCallback((patch: Partial<typeof cover>) => {
    setCover((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem('coverSettings', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ---- Settings tab ----
  const onSaveSettings = useCallback(async () => {
    const dir = articleDir.trim();
    try {
      // Send only the field this screen owns. The server merges onto persisted
      // settings, so resending the stale local `settings` here would clobber
      // `defaultPlatforms` (owned by the debounced togglePlatform save).
      const saved = await api.saveSettings({ articleDir: dir, chromePath: chromePath.trim() });
      setSettings(saved);
      // Scan before claiming success: an unreadable path would otherwise pair
      // a green 「设置已保存」 with the red 「目录不存在」 toast.
      // A *superseded* scan (another refresh started meanwhile) is not a
      // failure — the settings were saved either way, and the newer refresh
      // reports its own outcome — so only 'failed' withholds the confirmation.
      const outcome = await refreshArticles(dir);
      if (outcome !== 'failed') message.success('设置已保存');
      setTab('publish');
    } catch (err) {
      message.error('设置保存失败: ' + (err as Error).message);
    }
  }, [articleDir, chromePath, message, refreshArticles]);

  // The opt-in for the background update check the main process runs at
  // startup. Saved the moment it is flipped — a switch the user has to
  // remember to "save" is a switch they will forget.
  const onCheckUpdatesChange = useCallback(async (next: boolean) => {
    setCheckUpdates(next);
    try {
      const saved = await api.saveSettings({ checkUpdates: next });
      setSettings(saved);
    } catch (err) {
      setCheckUpdates(!next); // roll back: a switch that shows "on" but does
      message.error('设置保存失败: ' + (err as Error).message);
    }
  }, [message]);

  // The manual check. The main process does the work and shows the dialogs;
  // this only reports whether the call itself went through.
  const onCheckForUpdates = useCallback(async () => {
    setCheckingForUpdates(true);
    try {
      await api.checkForUpdates();
    } catch (err) {
      message.error('检查更新失败: ' + (err as Error).message);
    } finally {
      setCheckingForUpdates(false);
    }
  }, [message]);

  const onClearDir = useCallback(async () => {
    // Same as clearAll: a scan started for the old directory must not land
    // after this clear and resurrect its rows.
    refreshSeq.current += 1;
    setArticleDir('');
    try {
      const saved = await api.saveSettings({ articleDir: '' });
      setSettings(saved);
      const dirPaths = new Set(dirArticles.map((a) => a.filePath));
      setDirArticles([]);
      setProjectConfig(null);
      setScanError('');
      setScanSkipped([]);
      setScanValidCount(0);
      setListCleared(false);
      // Drop selections that belonged to the now-removed directory articles,
      // otherwise the publish count + button stay stuck on stale paths.
      setSelected((prev) => new Set([...prev].filter((fp) => !dirPaths.has(fp))));
      message.success('已清除默认文章目录');
    } catch (err) {
      message.error('清除失败: ' + (err as Error).message);
    }
  }, [dirArticles, message]);

  // ---- SSE ----
  const { connected } = useSSE({
    log: (d) => appendLog(d.text, d.level),
    status: (d) => {
      if (d.publishing && !wasPublishing.current) {
        setDispatch({}); // fresh run
        setLoginWait('');
      }
      if (!d.publishing) setLoginWait('');
      wasPublishing.current = d.publishing;
      setIsPublishing(d.publishing);
    },
    progress: (d) =>
      setProgressText(`正在发布（${d.articleIndex + 1}/${d.articleCount}）：${d.title}`),
    platform: (d) =>
      setDispatch((prev) => ({
        ...prev,
        [d.platform]: {
          status: d.status as DispatchInfo['status'],
          time: d.status === 'done' || d.status === 'error' ? clock(false) : prev[d.platform]?.time,
        },
      })),
    done: (d) => {
      setLoginWait('');
      // One result per (article, platform) pair — the old wording said just
      // 「N 成功」, which left the reader guessing what the number counted, and
      // 「成功」claimed more than the tool does: it fills editors, the publish
      // click is still the user's.
      const ok = d.results.filter((r) => r.success).length;
      const fail = d.results.length - ok;
      if (fail === 0) message.success(`发布完成：${ok} 处已填好，请到各平台确认后点「发布」`);
      else message.error(`发布完成：${ok} 处已填好，${fail} 处失败，详见下方日志`);
    },
    cancelled: () => {
      // A cancel is the user's own action, and the preceding toast already
      // announced it as info — escalating to error contradicts both.
      message.info('发布已取消');
      setLoginWait('');
      setDispatch((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) if (next[k].status === 'running') delete next[k];
        return next;
      });
    },
    'login-check': (d) => setLoginChecking(d.status === 'start'),
    'login-status': (d) =>
      setLoginStatus((prev) => ({
        ...prev,
        [d.id]: { loggedIn: d.loggedIn, username: d.username || '' },
      })),
    'login-wait': (d) =>
      setLoginWait((prev) => (d.status === 'waiting' ? d.platform : prev === d.platform ? '' : prev)),
    'app-error': (d) => d.message && message.error(d.message),
  });

  const canPublish = !isPublishing && selected.size > 0 && selectedPlatforms.size > 0;

  return (
    <div className="shell">
      <Masthead
        connected={connected}
        today={today}
        tab={tab}
        onTab={setTab}
        onShutdown={onShutdown}
      />

      {tab === 'publish' ? (
        <div role="tabpanel" id="panel-publish" aria-labelledby="tab-publish">
          <ProgressBanner
            visible={isPublishing}
            text={loginWait
              ? `正在等待「${loginWait}」登录：请到自动化浏览器完成登录，完成后会自动继续`
              : progressText}
            onCancel={onCancel}
          />

          <Manuscripts
            articles={allArticles}
            selected={selected}
            hasDir={!!settings.articleDir}
            scanError={scanError}
            skipped={scanSkipped}
            allSkipped={scanSkipped.length > 0 && scanValidCount === 0}
            listCleared={listCleared}
            articleDir={settings.articleDir || ''}
            disabled={isPublishing}
            onToggle={toggleArticle}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onClear={clearAll}
            onRefresh={() => !isPublishing && refreshArticles(settings.articleDir || '', { preserveSelection: true })}
            onPickFiles={onPickFiles}
            onPickFolder={onPickFolder}
            onAddPath={onAddPath}
            onRemoveManual={removeManual}
            onOpenSettings={() => setTab('settings')}
          />

          <Destinations
            platforms={platforms}
            selected={selectedPlatforms}
            loginStatus={loginStatus}
            dispatch={dispatch}
            loginChecking={loginChecking}
            disabled={isPublishing}
            hasArticles={allArticles.length > 0}
            onToggle={togglePlatform}
            onOpen={onOpenPlatform}
            onCheckLogin={onCheckLogin}
          />

          <ConfigBadge config={projectConfig} platforms={platforms} />

          <ActionsBar
            canPublish={canPublish}
            isPublishing={isPublishing}
            articleCount={selected.size}
            platformCount={selectedPlatforms.size}
            autoCover={cover.autoCover}
            removeCoverImg={cover.removeCoverImg}
            onPublish={onPublish}
            onCloseBrowser={onCloseBrowser}
            onAutoCover={(v) => setCoverPref({ autoCover: v })}
            onRemoveCoverImg={(v) => setCoverPref({ removeCoverImg: v })}
          />

          <TheWire logs={logs} onClear={() => setLogs([])} />
        </div>
      ) : (
        <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
          <Settings
            articleDir={articleDir}
            onChange={setArticleDir}
            onBrowse={() => setDirModalOpen(true)}
            onClear={onClearDir}
            chromePath={chromePath}
            onChromePathChange={setChromePath}
            onSave={onSaveSettings}
            checkUpdates={checkUpdates}
            onCheckUpdatesChange={(v) => void onCheckUpdatesChange(v)}
            onCheckForUpdates={() => void onCheckForUpdates()}
            checkingForUpdates={checkingForUpdates}
          />
        </div>
      )}

      <DirBrowserModal
        open={dirModalOpen}
        initialPath={articleDir}
        onClose={() => setDirModalOpen(false)}
        onSelect={setArticleDir}
      />

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <hr className="perf" />
      <div className="footer__links">
        <a href="https://github.com/rockbenben/md-publisher" target="_blank" rel="noopener">GitHub</a>
        <a href="https://www.aishort.top/" target="_blank" rel="noopener">AiShort</a>
        <a href="https://tools.newzone.top/zh" target="_blank" rel="noopener">Tools</a>
        <a href="https://prompt.newzone.top/app/zh" target="_blank" rel="noopener">IMGPrompt</a>
      </div>
    </footer>
  );
}
