import { Fragment, useEffect, useRef } from 'react';
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

  // Stay pinned to the bottom unless the user has scrolled up to read.
  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    const el = bodyRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

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
        <div className="wire-panel__body" ref={bodyRef} onScroll={onScroll} role="log" aria-label="发布日志" aria-live="polite">
          {logs.length === 0 ? (
            <div className="wire-panel__idle">— 暂无日志 · 发布过程将实时显示于此 —</div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className={`wire-line${l.level === 'error' ? ' wire-line--err' : ''}`}>
                <span className="wire-line__time">{l.time}</span>
                <span className="wire-line__text">{renderLine(l.text)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
