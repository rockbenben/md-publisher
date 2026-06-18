import { Button, Switch, Tooltip } from 'antd';
import { SendOutlined } from '@ant-design/icons';

export default function ActionsBar({
  canPublish,
  isPublishing,
  articleCount,
  platformCount,
  autoCover,
  removeCoverImg,
  onPublish,
  onCloseBrowser,
  onAutoCover,
  onRemoveCoverImg,
}: {
  canPublish: boolean;
  isPublishing: boolean;
  articleCount: number;
  platformCount: number;
  autoCover: boolean;
  removeCoverImg: boolean;
  onPublish: () => void;
  onCloseBrowser: () => void;
  onAutoCover: (v: boolean) => void;
  onRemoveCoverImg: (v: boolean) => void;
}) {
  const ready = articleCount > 0 && platformCount > 0;

  return (
    <div className="actions">
      <button
        className="dispatch-btn"
        onClick={onPublish}
        disabled={!canPublish}
        aria-busy={isPublishing}
      >
        <SendOutlined />
        <span className="dispatch-btn__label">{isPublishing ? '发布中…' : '发 布'}</span>
      </button>

      <div className="dispatch-meta">
        {ready ? (
          <>
            <b>{articleCount}</b> 篇稿件 <span className="arrow">→</span> <b>{platformCount}</b> 个平台
          </>
        ) : (
          <span className="dispatch-meta--hint">选择稿件与平台后发布</span>
        )}
      </div>

      <div className="actions__spacer" />

      <div className="options">
        <Tooltip title="少数派 / 知乎 / X 自动确认封面">
          <label className="option">
            <Switch size="small" checked={autoCover} onChange={onAutoCover} /> 封面自动确认
          </label>
        </Tooltip>
        <Tooltip title="封面取自正文首图时，从正文中移除以避免重复（frontmatter 有 cover 字段时自动跳过）">
          <label className="option">
            <Switch size="small" checked={removeCoverImg} onChange={onRemoveCoverImg} /> 正文去除首图
          </label>
        </Tooltip>
      </div>

      <Tooltip title="关闭自动化 Chrome 释放资源（不影响本页）">
        <Button onClick={onCloseBrowser} disabled={isPublishing}>关闭浏览器</Button>
      </Tooltip>
    </div>
  );
}
