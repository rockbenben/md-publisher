import { useEffect, useState } from 'react';
import { Button, Empty, Input, Tooltip } from 'antd';
import {
  CloseOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { AnimatePresence, motion } from 'motion/react';
import type { Article, SkippedFile } from '../api/types';
import SectionLabel from './SectionLabel';

export default function Manuscripts({
  articles,
  selected,
  hasDir,
  scanError,
  skipped,
  allSkipped,
  listCleared,
  articleDir,
  disabled,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onClear,
  onRefresh,
  onPickFiles,
  onPickFolder,
  onAddPath,
  onRemoveManual,
  onOpenSettings,
}: {
  articles: Article[];
  selected: Set<string>;
  hasDir: boolean;
  scanError: string;
  skipped: SkippedFile[];
  allSkipped: boolean;
  listCleared: boolean;
  articleDir: string;
  disabled: boolean;
  onToggle: (filePath: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onPickFiles: () => void;
  onPickFolder: () => void;
  onAddPath: (path: string) => Promise<boolean>;
  onRemoveManual: (filePath: string) => void;
  onOpenSettings: () => void;
}) {
  const [path, setPath] = useState('');
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const hasManual = articles.some((a) => a.manual);
  const query = filter.trim().toLowerCase();
  const visible = query
    ? articles.filter((a) =>
        [a.title, a.fileName, a.relativePath, a.description]
          .some((v) => (v || '').toLowerCase().includes(query)),
      )
    : articles;
  const skippedNames = skipped.slice(0, 3).map((s) => s.relativePath || s.fileName).join('、');
  const skippedMore = skipped.length > 3 ? ' 等' : '';
  const skippedTitle = skipped.map((s) => `${s.relativePath || s.fileName}: ${s.reason}`).join('\n\n');

  useEffect(() => {
    setFilter('');
  }, [articleDir]);

  const clearList = () => {
    setFilter('');
    onClear();
  };

  const submitPath = async () => {
    const p = path.trim();
    if (!p || adding) return;
    setAdding(true);
    try {
      const ok = await onAddPath(p);
      if (ok) setPath('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <section style={{ marginTop: 26 }}>
      <SectionLabel
        cn="稿件"
        en="MANUSCRIPTS"
        action={
          <div className="kicker__actions">
            {articles.length > 0 && (
              <span className="manuscript-count">共 {articles.length} 篇</span>
            )}
            {/* 「取消」reads as "abort", not "deselect", and it sits right next to
                「清空」which removes the rows themselves — the pair that actually
                needs to be legible is 全选 / 全不选. */}
            <button onClick={onSelectAll} disabled={disabled || !articles.length}>全选</button>
            <button onClick={onDeselectAll} disabled={disabled || !articles.length}>全不选</button>
            <button onClick={clearList} disabled={disabled}>清空列表</button>
            <button onClick={onRefresh} disabled={disabled}>
              <ReloadOutlined /> 刷新
            </button>
          </div>
        }
      />

      <div className="addbar">
        <Button icon={<FileAddOutlined />} onClick={onPickFiles} disabled={disabled}>
          选择文件
        </Button>
        <Button icon={<FolderOpenOutlined />} onClick={onPickFolder} disabled={disabled}>
          选择目录
        </Button>
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onPressEnter={submitPath}
          placeholder="或输入文件 / 目录路径，回车添加"
          disabled={disabled || adding}
          style={{ fontFamily: 'var(--font-mono)' }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={submitPath} disabled={disabled || !path.trim()} loading={adding}>
          添加
        </Button>
      </div>

      {skipped.length > 0 && (
        <p className="scan-warning" title={skippedTitle} role="status">
          ⚠ 有 {skipped.length} 篇稿件未加载：{skippedNames}{skippedMore}（无法解析）。修正后点「刷新」。
        </p>
      )}

      {hasManual && (
        <p className="manual-hint">
          手动添加的稿件只在本次打开有效；要下次自动加载，请在「设置」里配置默认目录。
        </p>
      )}

      {(articles.length > 20 || !!query) && (
        <div className="filterbar">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            allowClear
            prefix={<SearchOutlined />}
            placeholder="筛选标题、文件名或摘要"
            aria-label="筛选稿件"
            disabled={disabled}
          />
          {query && (
            <span className="filterbar__count" role="status">
              筛选结果 {visible.length} / 总 {articles.length}
            </span>
          )}
        </div>
      )}

      {query && (
        <p className="filterbar__note">
          筛选只影响列表显示，全选/全不选仍作用于全部稿件（当前已选 {selected.size} 篇）。
        </p>
      )}

      <div className="manuscript-list sheet">
        {articles.length === 0 ? (
          <Empty
            className="empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              scanError
                ? `无法读取默认目录：${scanError}`
                : hasDir && listCleared
                  ? '列表已清空，点上方的「刷新」重新扫描'
                  : allSkipped
                    ? `目录中的 ${skipped.length} 篇稿件都无法解析`
                    : hasDir
                      ? '该目录下没有稿件文件（支持 .md .markdown .txt 等 8 种扩展名）'
                      : '在「设置」里配置默认目录，或在上方添加文件 / 路径'
            }
          >
            {(!hasDir || scanError) && (
              /* The empty state tells you to go to 设置 but offered no way to
                 get there — the only route was the tab two rows up. The same
                 dead end appeared when the configured path itself was bad. */
              <Button onClick={onOpenSettings}>
                {scanError ? '去设置里修改目录' : '去设置里配置目录'}
              </Button>
            )}
          </Empty>
        ) : visible.length === 0 ? (
          <Empty
            className="empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="没有匹配的稿件"
          >
            <Button onClick={() => setFilter('')}>清除筛选</Button>
          </Empty>
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((a, i) => {
              const sel = selected.has(a.filePath);
              return (
                <motion.div
                  key={a.filePath}
                  layout={!query}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={query ? undefined : { opacity: 0, height: 0 }}
                  transition={{
                    duration: query ? 0 : 0.22,
                    delay: query ? 0 : Math.min(i * 0.018, 0.25),
                  }}
                  className={`manuscript${sel ? ' manuscript--sel' : ''}`}
                  role="checkbox"
                  aria-checked={sel}
                  aria-disabled={disabled}
                  tabIndex={disabled ? -1 : 0}
                  onKeyDown={(e) => {
                    if (disabled) return;
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      onToggle(a.filePath);
                    }
                  }}
                  onClick={() => !disabled && onToggle(a.filePath)}
                >
                  {/* A decorative mark, not a control: the row itself carries
                      role=checkbox / aria-checked and handles Space+Enter. The
                      antd Checkbox that used to sit here was a second checkbox
                      nested inside the first — announced as "checkbox, checkbox"
                      and adding a redundant tab stop to every row. */}
                  <span className={`tick${sel ? ' tick--on' : ''}`} aria-hidden />
                  {a.cover && (
                    <img
                      className="manuscript__cover"
                      src={a.cover}
                      alt=""
                      // Covers are arbitrary remote URLs from article frontmatter.
                      // Scanning an untrusted folder would otherwise send the
                      // user's IP (and page URL) to whoever authored the file.
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="manuscript__body">
                    <Tooltip title={a.title} mouseEnterDelay={0.6} placement="topLeft">
                      <div className="manuscript__title">{a.title}</div>
                    </Tooltip>
                    <div
                      className="manuscript__path"
                      title={a.manual ? a.fileName : a.relativePath || a.fileName}
                    >
                      {a.manual ? a.fileName : a.relativePath || a.fileName}
                      {a.description && (
                        <>
                          {'  —  '}
                          {/* Ellipsis only when actually cut: a bare slice ending
                              mid-word reads as a rendering fault, not a truncation. */}
                          {a.description.length > 60
                            ? `${a.description.slice(0, 60)}…`
                            : a.description}
                        </>
                      )}
                    </div>
                  </div>
                  {a.date && <span className="manuscript__date">{a.date}</span>}
                  {a.manual && <span className="manuscript__badge">手动</span>}
                  {a.manual && (
                    <Tooltip title="移除">
                      <button
                        className="manuscript__remove"
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveManual(a.filePath);
                        }}
                      >
                        <CloseOutlined />
                      </button>
                    </Tooltip>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </section>
  );
}
