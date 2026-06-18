import { Button, Input } from 'antd';
import { ClearOutlined, FolderOpenOutlined, SaveOutlined } from '@ant-design/icons';
import { motion } from 'motion/react';
import SectionLabel from './SectionLabel';

export default function Settings({
  articleDir,
  onChange,
  onBrowse,
  onClear,
  onSave,
}: {
  articleDir: string;
  onChange: (v: string) => void;
  onBrowse: () => void;
  onClear: () => void;
  onSave: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{ marginTop: 26 }}
    >
      <SectionLabel cn="默认文章目录" en="ARTICLE FOLDER" />
      <div className="settings-card sheet">
        <p className="settings-card__hint">
          启动时自动扫描该目录下的稿件（.md .markdown .txt 等），并读取目录内的{' '}
          <code>.md-publisher.yml</code> 预设平台、分类与标签。
        </p>
        <div className="addbar" style={{ marginBottom: 0 }}>
          <Input
            value={articleDir}
            onChange={(e) => onChange(e.target.value)}
            onPressEnter={onSave}
            placeholder="例如：D:\blog\articles"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <Button icon={<FolderOpenOutlined />} onClick={onBrowse}>
            浏览
          </Button>
          <Button icon={<ClearOutlined />} onClick={onClear}>
            清除
          </Button>
        </div>
        <div style={{ marginTop: 16 }}>
          <Button type="primary" icon={<SaveOutlined />} onClick={onSave}>
            保存
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
