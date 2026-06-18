import { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(async (path: string) => {
    try {
      const data = await api.browseDir(path);
      setCurrent(data.current || '');
      setParent(data.parent || '');
      setEntries(data.entries || []);
      setPicked(data.current || '');
    } catch {
      setEntries([]);
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

      <div className="dir-modal__list">
        {entries.length === 0 ? (
          <div className="dir-modal__empty">空目录</div>
        ) : (
          entries.map((e) => (
            <div
              key={e.path}
              className={`dir-item${picked === e.path ? ' dir-item--active' : ''}`}
              onClick={() => setPicked(e.path)}
              onDoubleClick={() => load(e.path)}
            >
              <FolderFilled className="dir-item__icon" />
              <span>{e.name}</span>
              <RightOutlined className="dir-item__enter" onClick={(ev) => { ev.stopPropagation(); load(e.path); }} />
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
