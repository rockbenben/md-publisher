import { Tag } from 'antd';
import type { Platform, ProjectConfig } from '../api/types';

/** Surfaces an active .md-publisher.yml from the article directory. */
export default function ConfigBadge({
  config,
  platforms,
}: {
  config: ProjectConfig | null;
  platforms: Platform[];
}) {
  if (!config) return null;
  const nameOf = (id: string) => platforms.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="config-badge">
      <span className="config-badge__file">.md-publisher.yml</span>
      {config.platforms?.length ? (
        <span className="config-badge__group">
          平台 {config.platforms.map(nameOf).map((n) => <Tag key={n}>{n}</Tag>)}
        </span>
      ) : null}
      {config.category?.length ? (
        <span className="config-badge__group">
          分类 {config.category.map((c) => <Tag key={c}>{c}</Tag>)}
        </span>
      ) : null}
      {config.tag?.length ? (
        <span className="config-badge__group">
          标签 {config.tag.map((t) => <Tag key={t}>{t}</Tag>)}
        </span>
      ) : null}
      {/* Platforms above are actually applied to the selection; 分类 and 标签
          are only printed as a reminder (the settings screen says so too), and
          rendering them as bare tags made them look equally actionable. */}
      {(config.category?.length || config.tag?.length) && (
        <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)' }}>分类与标签仅作提示，不会自动填写</span>
      )}
    </div>
  );
}
