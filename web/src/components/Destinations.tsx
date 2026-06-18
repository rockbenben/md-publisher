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
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onCheckLogin: () => void;
}) {
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
                  <span className="dest__login dest__login--unknown">未检测登录</span>
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
    </section>
  );
}
