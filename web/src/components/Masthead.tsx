import { GithubOutlined, PoweroffOutlined } from '@ant-design/icons';
import { motion } from 'motion/react';
import Postmark from './Postmark';

type Tab = 'publish' | 'settings';

export default function Masthead({
  connected,
  today,
  tab,
  onTab,
  onShutdown,
}: {
  connected: boolean;
  today: string;
  tab: Tab;
  onTab: (t: Tab) => void;
  onShutdown: () => void;
}) {
  return (
    <header className="masthead">
      <div className="masthead__top">
        <div className="masthead__brand">
          <Postmark variant="logomark" size={52} rotate={-7} />
          <div>
            <div className="brand__word">md-publisher</div>
            <div className="brand__tag">一稿多发 · Markdown 多平台发布工具</div>
          </div>
        </div>

        <div className="masthead__meta">
          <span className="meta__date">{today}</span>
          <span className="meta__sep">·</span>
          <span className="wire" title="实时连接状态 (SSE)">
            <span className={`wire__dot${connected ? ' wire__dot--on' : ''}`} />
            {connected ? '已连接' : '未连接'}
          </span>
          <span className="meta__sep">·</span>
          <a
            className="meta__link"
            href="https://github.com/rockbenben/md-publisher"
            target="_blank"
            rel="noopener"
            title="GitHub"
          >
            <GithubOutlined />
          </a>
          <button className="meta__exit" onClick={onShutdown} title="退出 md-publisher">
            <PoweroffOutlined /> 退出
          </button>
        </div>
      </div>

      <motion.div
        className="double-rule"
        initial={{ scaleX: 0, transformOrigin: 'left' }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      />

      <nav className="nav" role="tablist">
        {(['publish', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`nav__tab${tab === t ? ' nav__tab--active' : ''}`}
            onClick={() => onTab(t)}
          >
            {t === 'publish' ? '发 布' : '设 置'}
          </button>
        ))}
      </nav>
    </header>
  );
}
