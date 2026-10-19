import { useId } from 'react';

/**
 * The brand mark — a copy of `brand/logo.svg` restated as React geometry.
 *
 * It is duplicated rather than imported: the knocked-out rules fill with
 * `var(--paper)` here so they follow the theme, where the .svg hardcodes the
 * hex. Nothing keeps this in step with the other four copies — changing the
 * mark means updating all of them in one commit, or the header drifts away from
 * the favicon, the tray and the app icon again (it did, once: the header used
 * to show a circular 邮 seal that appeared nowhere else).
 */
export default function BrandMark({ size = 52 }: { size?: number }) {
  const inkId = `bm-ink-${useId().replace(/:/g, '')}`;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="md-publisher"
      style={{ display: 'block' }}
    >
      <defs>
        <filter id={inkId} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.15" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <g fill="var(--cinnabar)">
        <rect x="6" y="27" width="46" height="46" rx="4" transform="rotate(-3 29 50)" filter={`url(#${inkId})`} />
        <rect x="64" y="6" width="32" height="27" rx="3.5" transform="rotate(-5 80 19.5)" />
        <rect x="64" y="36" width="32" height="27" rx="3.5" transform="rotate(1.5 80 49.5)" opacity=".86" />
        <rect x="64" y="66" width="32" height="27" rx="3.5" transform="rotate(6 80 79.5)" opacity=".72" />
      </g>
      {/* Knocked out to the page colour, as 阳刻 lettering is */}
      <g fill="var(--paper)" transform="rotate(-3 29 50)">
        <rect x="15" y="38" width="28" height="5" rx="2.5" />
        <rect x="15" y="48" width="28" height="5" rx="2.5" />
        <rect x="15" y="58" width="17" height="5" rx="2.5" />
      </g>
    </svg>
  );
}
