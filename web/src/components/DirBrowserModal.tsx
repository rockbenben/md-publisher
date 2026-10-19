import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal } from 'antd';
import { ArrowUpOutlined, DesktopOutlined, FolderFilled, RightOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import type { DirEntry } from '../api/types';

export default function DirBrowserModal({
  open,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  initialPath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [current, setCurrent] = useState('');
  const [parent, setParent] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [picked, setPicked] = useState('');
  const [error, setError] = useState('');
  // Rapid clicks (a folder then 上一级) can land responses out of order; without
  // this the stale reply wins and the breadcrumb points at the wrong directory.
  const seq = useRef(0);

  const load = useCallback(async (path: string) => {
    const mine = ++seq.current;
    try {
      const data = await api.browseDir(path);
      if (mine !== seq.current) return;
      // A bad path comes back as HTTP 400 with a populated `error`. Must be
      // checked here: otherwise a nonexistent directory is indistinguishable
      // from a genuinely empty one, and `current` would still name the bad
      // path, letting the user confirm it as the article directory.
      if (data.error) {
        setError(data.error);
        setEntries([]);
        setPicked('');
        return;
      }
      setError('');
      setCurrent(data.current || '');
      setParent(data.parent || '');
      setEntries(data.entries || []);
      setPicked(data.current || '');
    } catch (err) {
      if (mine !== seq.current) return;
      setError((err as Error).message || '读取目录失败');
      setEntries([]);
      setPicked('');
    }
  }, []);

  useEffect(() => {
    if (open) load(initialPath || '');
  }, [open, initialPath, load]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={null}
      footer={null}
      width={560}
      styles={{ body: { padding: 0 } }}
      className="dir-modal"
    >
      <div className="dir-modal__head">
        <button className="dir-modal__nav" onClick={() => load(parent || '')} title="上一级">
          <ArrowUpOutlined />
        </button>
        <span className="dir-modal__path">{current || '选择驱动器'}</span>
        <button className="dir-modal__nav" onClick={() => load('')} title="根目录">
          <DesktopOutlined />
        </button>
      </div>

      <div className="dir-modal__list" role="listbox" aria-label="目录">
        {error ? (
          <div className="dir-modal__empty">{error}</div>
        ) : entries.length === 0 ? (
          <div className="dir-modal__empty">空目录</div>
        ) : (
          entries.map((e) => (
            <div
              key={e.path}
              className={`dir-item${picked === e.path ? ' dir-item--active' : ''}`}
              role="option"
              aria-selected={picked === e.path}
              tabIndex={0}
              onClick={() => setPicked(e.path)}
              onDoubleClick={() => load(e.path)}
              // File-manager keys: Enter/Space pick the folder (what a single
              // click does), Right descends, Left goes back up. The list was
              // previously mouse-only — no tabIndex, no keys, and the only way
              // in was a double-click or an arrow that only appeared on hover.
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  setPicked(e.path);
                } else if (ev.key === 'ArrowRight') {
                  ev.preventDefault();
                  load(e.path);
                } else if (ev.key === 'ArrowLeft') {
                  ev.preventDefault();
                  load(parent || '');
                }
              }}
            >
              <FolderFilled className="dir-item__icon" />
              <span>{e.name}</span>
              {/* Clickable for the mouse, hidden from assistive tech: the row
                  above exposes the same action as ArrowRight, and a second tab
                  stop per folder would make a long listing unusable by
                  keyboard. */}
              <RightOutlined
                className="dir-item__enter"
                aria-hidden
                onClick={(ev) => { ev.stopPropagation(); load(e.path); }}
              />
            </div>
          ))
        )}
      </div>

      <div className="dir-modal__foot">
        <Button onClick={onClose}>取消</Button>
        <Button
          type="primary"
          disabled={!picked && !current}
          onClick={() => {
            onSelect(picked || current);
            onClose();
          }}
        >
          选择此目录
        </Button>
      </div>
    </Modal>
  );
}
