import { Fragment, useEffect, useRef, useState } from 'react';
import { VerticalAlignBottomOutlined } from '@ant-design/icons';
import type { LogEntry } from '../api/types';
import SectionLabel from './SectionLabel';

const ICONS: Record<string, string> = { '✓': 'ok', '⚠': 'warn', '✗': 'err' };

/** Colorize the ✓ ⚠ ✗ glyphs the backend emits, leaving the rest as text. */
function renderLine(text: string) {
  return text.split(/([✓⚠✗])/).map((seg, i) =>
    ICONS[seg] ? (
      <span key={i} className={`wire-glyph wire-glyph--${ICONS[seg]}`}>
        {seg}
      </span>
    ) : (
      <Fragment key={i}>{seg}</Fragment>
    ),
  );
}

export default function TheWire({
  logs,
  onClear,
}: {
  logs: LogEntry[];
  onClear: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // A publish run can run for minutes. Once the reader scrolls up to read an
  // error, the auto-follow stops — and without a marker they have no idea lines
  // are piling up unseen below the fold.
  const [hasNew, setHasNew] = useState(false);

  // Stay pinned to the bottom unless the user has scrolled up to read.
  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (pinned.current) setHasNew(false);
  };

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (pinned.current) {
      el.scrollTop = el.scrollHeight;
      setHasNew(false);
    } else {
      setHasNew(true);
    }
  }, [logs]);

  const jumpToLatest = () => {
    const el = bodyRef.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTop = el.scrollHeight;
    setHasNew(false);
  };

  return (
    <section style={{ marginTop: 28 }}>
      <SectionLabel
        cn="日志"
        en="LOG"
        action={
          <button className="wire-clear" onClick={onClear}>
            清除
          </button>
        }
      />
      <div className="wire-panel">
        <div className="wire-panel__rail" aria-hidden />
        {/* aria-live="off" on purpose: a publish run pushes hundreds of lines in
            a few minutes and every one would be announced, burying whatever the
            reader was actually saying. Errors and completion already surface as
            toasts, so this stays a transcript to read on demand. */}
        <div className="wire-panel__body" ref={bodyRef} onScroll={onScroll} role="log" aria-label="发布日志" aria-live="off">
          {logs.length === 0 ? (
            <div className="wire-panel__idle">暂无日志 · 发布过程会实时显示在这里</div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className={`wire-line${l.level === 'error' ? ' wire-line--err' : ''}`}>
                <span className="wire-line__time">{l.time}</span>
                <span className="wire-line__text">{renderLine(l.text)}</span>
              </div>
            ))
          )}
        </div>
        {hasNew && (
          <button className="wire-jump" onClick={jumpToLatest}>
            <VerticalAlignBottomOutlined /> 有新日志，回到底部
          </button>
        )}
      </div>
    </section>
  );
}
