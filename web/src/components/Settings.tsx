import { Button, Input, Switch } from 'antd';
import { ClearOutlined, FolderOpenOutlined, SaveOutlined } from '@ant-design/icons';
import { motion } from 'motion/react';
import SectionLabel from './SectionLabel';

export default function Settings({
  articleDir,
  onChange,
  onBrowse,
  onClear,
  chromePath,
  onChromePathChange,
  onSave,
  checkUpdates,
  onCheckUpdatesChange,
  onCheckForUpdates,
  checkingForUpdates,
}: {
  articleDir: string;
  onChange: (v: string) => void;
  onBrowse: () => void;
  onClear: () => void;
  chromePath: string;
  onChromePathChange: (v: string) => void;
  onSave: () => void;
  checkUpdates: boolean;
  onCheckUpdatesChange: (v: boolean) => void;
  onCheckForUpdates: () => void;
  checkingForUpdates: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{ marginTop: 26 }}
    >
      <SectionLabel cn="默认稿件目录" en="ARTICLE FOLDER" />
      <div className="settings-card sheet">
        <p className="settings-card__hint">
          启动时自动扫描该目录下的稿件（.md .markdown .mdown .mkd .mkdn .mdwn .mdx .txt），并读取目录内的{' '}
          <code>.md-publisher.yml</code> 预设发布平台。分类与标签只作为提示输出，不会自动填写。
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
      </div>

      <div style={{ marginTop: 22 }}>
        <SectionLabel cn="浏览器路径" en="BROWSER PATH" />
        <div className="settings-card sheet">
          <p className="settings-card__hint">
            留空则自动检测系统的 Chromium 内核浏览器（Chrome / Edge / Brave / Vivaldi / 360 / QQ 等）。
            若用其他浏览器或安装在非标准路径，填其可执行文件的绝对路径即可。
          </p>
          <Input
            value={chromePath}
            onChange={(e) => onChromePathChange(e.target.value)}
            onPressEnter={onSave}
            placeholder="留空自动检测；例如：C:\Program Files\Google\Chrome\Application\chrome.exe"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        {/* Say what the one button saves — both fields are one form, and Enter in
            either of them saves both. */}
        <Button type="primary" icon={<SaveOutlined />} onClick={onSave}>
          保存设置
        </Button>
      </div>

      <div style={{ marginTop: 26 }}>
        <SectionLabel cn="应用更新" en="UPDATES" />
        <div className="settings-card sheet">
          {/* Opt-in, off by default: the app makes no request at all until the
              user turns this on. A tool that drives other people's websites on
              the user's behalf has no business phoning home uninvited. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Switch checked={checkUpdates} onChange={onCheckUpdatesChange} />
            <div>
              <div>启动时检查一次有没有新版本（可选，默认不开）</div>
              <p className="settings-card__hint">
                打开之后每次启动会向 GitHub 发一次请求，问一句「有没有新版本」——不发送任何稿件、路径或账号信息。
                查到新版本也只是告诉你：要不要下载、要不要安装，都由你在弹出来的对话框里自己点。
              </p>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <Button loading={checkingForUpdates} onClick={onCheckForUpdates}>
              检查有没有新版本
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
