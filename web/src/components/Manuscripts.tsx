import { useState } from 'react';
import { Button, Checkbox, Empty, Input, Tooltip } from 'antd';
import {
  CloseOutlined,
  FileAddOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { AnimatePresence, motion } from 'motion/react';
import type { Article } from '../api/types';
import SectionLabel from './SectionLabel';

export default function Manuscripts({
  articles,
  selected,
  hasDir,
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
}: {
  articles: Article[];
  selected: Set<string>;
  hasDir: boolean;
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
}) {
  const [path, setPath] = useState('');
  const [adding, setAdding] = useState(false);

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
            <button onClick={onSelectAll} disabled={disabled}>全选</button>
            <button onClick={onDeselectAll} disabled={disabled}>取消</button>
            <button onClick={onClear} disabled={disabled}>清空</button>
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
        <Button type="primary" icon={<PlusOutlined />} onClick={submitPath} disabled={disabled} loading={adding}>
          添加
        </Button>
      </div>

      <div className="manuscript-list sheet">
        {articles.length === 0 ? (
          <Empty
            className="empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              hasDir
                ? '该目录下没有找到稿件（.md .markdown .txt 等）'
                : '在「设置」配置默认目录，或在上方添加文件 / 路径'
            }
          />
        ) : (
          <AnimatePresence initial={false}>
            {articles.map((a, i) => {
              const sel = selected.has(a.filePath);
              return (
                <motion.div
                  key={a.filePath}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(i * 0.018, 0.25) }}
                  className={`manuscript${sel ? ' manuscript--sel' : ''}`}
                  onClick={() => !disabled && onToggle(a.filePath)}
                >
                  <Checkbox
                    checked={sel}
                    disabled={disabled}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggle(a.filePath)}
                  />
                  {a.cover && (
                    <img
                      className="manuscript__cover"
                      src={a.cover}
                      alt=""
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="manuscript__body">
                    <Tooltip title={a.title} mouseEnterDelay={0.6} placement="topLeft">
                      <div className="manuscript__title">{a.title}</div>
                    </Tooltip>
                    <div className="manuscript__path">
                      {a.fileName}
                      {a.description ? `  —  ${a.description.slice(0, 60)}` : ''}
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
