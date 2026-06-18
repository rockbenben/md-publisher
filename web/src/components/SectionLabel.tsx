import type { ReactNode } from 'react';

/** Editorial kicker: 中文大标题 + EN mono label + trailing rule + optional action. */
export default function SectionLabel({
  cn,
  en,
  action,
}: {
  cn: string;
  en: string;
  action?: ReactNode;
}) {
  return (
    <div className="kicker" style={{ marginBottom: 14 }}>
      <span className="cn">{cn}</span>
      <span className="en">{en}</span>
      <span className="kicker__rule" />
      {action}
    </div>
  );
}
