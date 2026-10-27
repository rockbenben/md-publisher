import { Button, Tooltip } from 'antd';
import { ExportOutlined, KeyOutlined, LoadingOutlined } from '@ant-design/icons';
import { AnimatePresence } from 'motion/react';
import type { DispatchInfo, LoginStatus, Platform } from '../api/types';
import SectionLabel from './SectionLabel';
import Postmark from './Postmark';

export default function Destinations({
  platforms,
  selected,
  loginStatus,
  dispatch,
  loginChecking,
  disabled,
  hasArticles,
  onToggle,
  onOpen,
  onCheckLogin,
}: {
  platforms: Platform[];
  selected: Set<string>;
  loginStatus: Record<string, LoginStatus>;
  dispatch: Record<string, DispatchInfo>;
  loginChecking: boolean;
  disabled: boolean;
  hasArticles: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onCheckLogin: () => void;
}) {
  const needsLogin = platforms.some(
    (p) => selected.has(p.id) && loginStatus[p.id]?.loggedIn !== true,
  );

  return (
    <section style={{ marginTop: 26 }}>
      <SectionLabel
        cn="平台"
        en="PLATFORMS"
        action={
          <Button
            size="small"
            icon={loginChecking ? <LoadingOutlined /> : <KeyOutlined />}
            disabled={loginChecking || disabled}
            onClick={onCheckLogin}
          >
            {loginChecking ? '检测中' : '检测登录'}
          </Button>
        }
      />

      <div className="dest-grid">
        {platforms.map((p) => {
          const ls = loginStatus[p.id];
          const info = dispatch[p.id];
          const sel = selected.has(p.id);
          const stamped = info?.status === 'done' || info?.status === 'error';
          return (
            <div
              key={p.id}
              className={`dest${sel ? ' dest--sel' : ''}${disabled ? ' dest--disabled' : ''}`}
              onClick={() => !disabled && onToggle(p.id)}
              role="checkbox"
              aria-checked={sel}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : 0}
              onKeyDown={(e) => {
                if (!disabled && (e.key === ' ' || e.key === 'Enter')) {
                  e.preventDefault();
                  onToggle(p.id);
                }
              }}
            >
              <div className="dest__row">
                <span className={`dest__tick${sel ? ' dest__tick--on' : ''}`} aria-hidden />
                {p.icon && <img className="dest__icon" src={p.icon} width={18} height={18} alt="" />}
                <span className="dest__name">{p.name}</span>
                <Tooltip title="在自动化浏览器中打开">
                  <button
                    className="dest__open"
                    aria-label={`打开 ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(p.id);
                    }}
                  >
                    <ExportOutlined />
                  </button>
                </Tooltip>
              </div>

              <div className="dest__foot">
                {info?.status === 'running' ? (
                  <span className="dest__login dest__login--run">
                    <LoadingOutlined /> 发布中
                  </span>
                ) : ls ? (
                  ls.loggedIn ? (
                    <span className="dest__login dest__login--in" title={ls.username || '已登录'}>
                      <span className="dest__pip" /> {ls.username || '已登录'}
                    </span>
                  ) : (
                    <span className="dest__login dest__login--out">未登录</span>
                  )
                ) : (
                  // 「未检测」rather than 「未检测登录」: the other two states are
                  // already about logging in, so the third reads as a third
                  // login outcome instead of "nobody has checked yet".
                  <span className="dest__login dest__login--unknown" title="尚未检测登录状态">
                    未检测
                  </span>
                )}
              </div>

              <AnimatePresence>
                {stamped && (
                  <div className="dest__stamp" key={info!.status}>
                    <Postmark
                      variant={info!.status === 'done' ? 'published' : 'failed'}
                      label={p.name}
                      sub={info!.time || ''}
                      size={86}
                      rotate={-8}
                      animate
                    />
                  </div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {hasArticles && needsLogin && !disabled && (
        <p className="dest-hint">
          有平台未登录或未检测：点卡片右侧的 ↗ 打开自动化浏览器登录，登录后点「检测登录」。
        </p>
      )}
    </section>
  );
}
