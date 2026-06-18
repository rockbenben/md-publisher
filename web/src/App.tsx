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
const clock = (sec: boolean) => {
  const d = new Date();
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sec ? `${base}:${pad(d.getSeconds())}` : base;
};

function readCoverPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem('coverSettings') || 'null');
    if (raw) return { autoCover: raw.autoCover !== false, removeCoverImg: raw.removeCoverImg !== false };
  } catch {
    /* ignore */
  }
  return { autoCover: true, removeCoverImg: true };
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
  const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(null);
  const [loginStatus, setLoginStatus] = useState<Record<string, LoginStatus>>({});
  const [loginChecking, setLoginChecking] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [dispatch, setDispatch] = useState<Record<string, DispatchInfo>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progressText, setProgressText] = useState('');
  const [dirModalOpen, setDirModalOpen] = useState(false);
  const [cover, setCover] = useState(readCoverPrefs);

  const logId = useRef(0);
  const wasPublishing = useRef(false);
  const platformSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Sync guard against rapid double-click before React re-renders isPublishing.
  const pendingPublish = useRef(false);
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
    setLogs((prev) => {
      const next = [...prev, { id: logId.current++, time: clock(true), text, level }];
      return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
    });
  }, []);

  // ---- Articles ----
  const refreshArticles = useCallback(
    async (dir: string, opts: { quiet?: boolean } = {}) => {
      setProjectConfig(null);
      let scanned: Article[] = [];
      let cfg: ProjectConfig | null = null;
      if (dir) {
        try {
          const data = await api.getArticles(dir);
          if (data.error) {
            message.error(data.error);
          } else {
            scanned = data.articles;
            cfg = data.projectConfig ?? null;
          }
        } catch {
          message.error('加载稿件失败');
        }
      }
      // Drop manual entries the directory scan now also provides, then
      // re-select everything currently in view.
      const dirPaths = new Set(scanned.map((a) => a.filePath));
      const keptManual = manualArticles.filter((a) => !dirPaths.has(a.filePath));

      setDirArticles(scanned);
      setManualArticles(keptManual);
      setProjectConfig(cfg);
      if (cfg?.platforms) setSelectedPlatforms(new Set(cfg.platforms));
      setSelected(new Set([...scanned, ...keptManual].map((a) => a.filePath)));

      if (!opts.quiet && dir && scanned.length > 0) {
        message.success(
          cfg
            ? `已从默认目录加载 ${scanned.length} 篇稿件（已应用项目配置）`
            : `已从默认目录加载 ${scanned.length} 篇稿件`,
        );
      }
    },
    [manualArticles, message],
  );

  // ---- Init ----
  useEffect(() => {
    (async () => {
      try {
        setPlatforms(await api.getPlatforms());
        const s = await api.getSettings();
        setSettings(s);
        setArticleDir(s.articleDir || '');
        if (s.defaultPlatforms) setSelectedPlatforms(new Set(s.defaultPlatforms));
        if (s.loginStatus) setLoginStatus({ ...s.loginStatus });
        await refreshArticles(s.articleDir || '', { quiet: true });
      } catch (err) {
        message.error('初始化失败: ' + (err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- File intake ----
  const addUploaded = useCallback(
    async (files: PickedFile[], skipped: string[]) => {
      for (const s of skipped) message.warning(`已跳过过大文件 ${s}`);
      if (!files.length) return;
      try {
        const data = await api.uploadFiles(files);
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
    [allArticles, message],
  );

  const onPickFiles = useCallback(async () => {
    const r = await pickFiles();
    if (r) await addUploaded(r.files, r.skipped);
  }, [addUploaded]);

  const onPickFolder = useCallback(async () => {
    const r = await pickFolder();
    if (!r) return;
    if (r.emptyDir) {
      message.error('该目录下没有找到稿件文件');
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
    [allArticles, message],
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
    setDirArticles([]);
    setManualArticles([]);
    setProjectConfig(null);
    setSelected(new Set());
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
      } catch (err) {
        message.error('打开平台失败: ' + (err as Error).message);
      }
    },
    [message],
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
    } catch {
      message.error('取消请求失败');
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
      const saved = await api.saveSettings({ articleDir: dir });
      setSettings(saved);
      message.success('设置已保存');
      setTab('publish');
      await refreshArticles(dir);
    } catch (err) {
      message.error('设置保存失败: ' + (err as Error).message);
    }
  }, [articleDir, message, refreshArticles]);

  const onClearDir = useCallback(async () => {
    setArticleDir('');
    try {
      const saved = await api.saveSettings({ articleDir: '' });
      setSettings(saved);
      const dirPaths = new Set(dirArticles.map((a) => a.filePath));
      setDirArticles([]);
      setProjectConfig(null);
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
      if (d.publishing && !wasPublishing.current) setDispatch({}); // fresh run
      wasPublishing.current = d.publishing;
      setIsPublishing(d.publishing);
    },
    progress: (d) =>
      setProgressText(`正在发布 (${d.articleIndex + 1}/${d.articleCount})：${d.title}`),
    platform: (d) =>
      setDispatch((prev) => ({
        ...prev,
        [d.platform]: {
          status: d.status as DispatchInfo['status'],
          time: d.status === 'done' || d.status === 'error' ? clock(false) : prev[d.platform]?.time,
        },
      })),
    done: (d) => {
      const ok = d.results.filter((r) => r.success).length;
      const fail = d.results.length - ok;
      if (fail === 0) message.success(`发布完成：${ok} 成功`);
      else message.error(`发布完成：${ok} 成功，${fail} 失败`);
    },
    cancelled: () => {
      message.error('发布已取消');
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
        <>
          <ProgressBanner
            visible={isPublishing}
            text={progressText}
            canCancel={isPublishing}
            onCancel={onCancel}
          />

          <Manuscripts
            articles={allArticles}
            selected={selected}
            hasDir={!!settings.articleDir}
            disabled={isPublishing}
            onToggle={toggleArticle}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onClear={clearAll}
            onRefresh={() => !isPublishing && refreshArticles(settings.articleDir || '')}
            onPickFiles={onPickFiles}
            onPickFolder={onPickFolder}
            onAddPath={onAddPath}
            onRemoveManual={removeManual}
          />

          <Destinations
            platforms={platforms}
            selected={selectedPlatforms}
            loginStatus={loginStatus}
            dispatch={dispatch}
            loginChecking={loginChecking}
            disabled={isPublishing}
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
        </>
      ) : (
        <Settings
          articleDir={articleDir}
          onChange={setArticleDir}
          onBrowse={() => setDirModalOpen(true)}
          onClear={onClearDir}
          onSave={onSaveSettings}
        />
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
