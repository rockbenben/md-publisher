import { GithubOutlined, PoweroffOutlined } from '@ant-design/icons';
import { motion } from 'motion/react';
import BrandMark from './BrandMark';

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
          <BrandMark size={52} />
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

      <nav className="nav" role="tablist" aria-label="主视图切换">
        {(['publish', 'settings'] as Tab[]).map((t, i, all) => (
          <button
            key={t}
            id={`tab-${t}`}
            role="tab"
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            // A tablist is a single tab stop; arrows move between its tabs.
            // Without this both buttons land in the tab order and the pattern
            // is only half-implemented.
            tabIndex={tab === t ? 0 : -1}
            className={`nav__tab${tab === t ? ' nav__tab--active' : ''}`}
            onClick={() => onTab(t)}
            onKeyDown={(e) => {
              const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!dir) return;
              e.preventDefault();
              const next = all[(i + dir + all.length) % all.length];
              onTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
          >
            {t === 'publish' ? '发 布' : '设 置'}
          </button>
        ))}
      </nav>
    </header>
  );
}
