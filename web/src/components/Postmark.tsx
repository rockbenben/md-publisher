import { useId } from 'react';
import { motion } from 'motion/react';

type Variant = 'logomark' | 'published' | 'failed';

interface PostmarkProps {
  variant: Variant;
  /** Ring text — e.g. platform name. Logomark ignores this. */
  label?: string;
  /** Center line — e.g. the publish timestamp. */
  sub?: string;
  size?: number;
  /** Fixed tilt so repeated stamps look hand-applied, not pristine. */
  rotate?: number;
  animate?: boolean;
}

/**
 * 朱砂印章 — the cinnabar publish stamp.
 * Doubles as the brand logomark (static, center 邮) and the per-platform
 * "published / failed" confirmation that stamps onto a platform card.
 */
export default function Postmark({
  variant,
  label = '',
  sub = '',
  size = 92,
  rotate = -7,
  animate = false,
}: PostmarkProps) {
  const uid = useId().replace(/:/g, '');
  const ringId = `pm-ring-${uid}`;
  const inkId = `pm-ink-${uid}`;

  const color = variant === 'failed' ? '#6b6358' : '#c23b2e';
  const r = 50;
  const ringR = 39; // radius the ring-text rides on
  // Full-circle path for the ring text to follow (clockwise from top).
  const ringPath = `M50,50 m 0,-${ringR} a ${ringR},${ringR} 0 1,1 0,${2 * ringR} a ${ringR},${ringR} 0 1,1 0,-${2 * ringR}`;

  const ringText =
    variant === 'logomark'
      ? 'MD·PUBLISHER ★ 多平台发布 ★ '
      : variant === 'published'
        ? `${label} ★ 已发布 PUBLISHED ★ `
        : `${label} ★ 失败 FAILED ★ `;

  const svg = (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={
        variant === 'logomark'
          ? 'md-publisher 印章'
          : `${label} ${variant === 'published' ? '已发布' : '失败'}`
      }
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <path id={ringId} d={ringPath} fill="none" />
        {/* Uneven ink edge — rough the strokes so the stamp reads hand-pressed */}
        <filter id={inkId} x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.1" />
        </filter>
      </defs>

      <g filter={`url(#${inkId})`} stroke={color} fill={color} opacity="0.92">
        {/* Double ring */}
        <circle cx="50" cy="50" r={r - 2} fill="none" strokeWidth="2.4" />
        <circle cx="50" cy="50" r={ringR - 6} fill="none" strokeWidth="1.1" />

        {/* Ring text */}
        <text
          fontSize="6.2"
          fontFamily="var(--font-mono)"
          fontWeight="600"
          letterSpacing="0.6"
          stroke="none"
        >
          <textPath href={`#${ringId}`} startOffset="0">
            {ringText}
          </textPath>
        </text>

        {variant === 'logomark' ? (
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="var(--font-display)"
            fontSize="26"
            fontWeight="700"
            stroke="none"
          >
            邮
          </text>
        ) : (
          <>
            {/* Cancellation waves — the bars a postmark drags across a stamp */}
            {[40, 47, 54, 61].map((y) => (
              <path
                key={y}
                d={`M28,${y} q5.5,-3.5 11,0 t11,0 t11,0`}
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            ))}
            {sub && (
              <text
                x="50"
                y="72"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize="6"
                fontWeight="600"
                stroke="none"
              >
                {sub}
              </text>
            )}
          </>
        )}
      </g>
    </svg>
  );

  if (!animate) {
    return <div style={{ transform: `rotate(${rotate}deg)` }}>{svg}</div>;
  }

  return (
    <motion.div
      initial={{ scale: 1.55, opacity: 0, rotate: rotate - 14 }}
      animate={{ scale: 1, opacity: 1, rotate }}
      transition={{ type: 'spring', stiffness: 520, damping: 16, mass: 0.7 }}
    >
      {svg}
    </motion.div>
  );
}
