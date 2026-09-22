import { useId } from 'react';
import { useReducedMotion } from 'framer-motion';

/* Hand-built botanical SVG pieces. Fronds are generated along a curved stem so
   every instance looks naturally different with a few parameters. */

function leafPath(length, width) {
  const h = width / 2;
  return `M0 0 C ${length * 0.28} ${-h * 1.05} ${length * 0.72} ${-h} ${length} 0 C ${length * 0.72} ${h} ${length * 0.28} ${h * 1.05} 0 0 Z`;
}

/** Point and tangent angle (degrees) on a quadratic curve from (0,0) to (endX,-length) via (bend,-length/2). */
function stemPoint(t, length, bend, endX) {
  const x = 2 * (1 - t) * t * bend + t * t * endX;
  const y = 2 * (1 - t) * t * (-length / 2) + t * t * -length;
  const dx = 2 * (1 - t) * bend + 2 * t * (endX - bend);
  const dy = 2 * (1 - t) * (-length / 2) + 2 * t * (-length / 2);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * A fern-like frond, base at (x, y), growing "up" before `rotate` is applied.
 * Sways gently around its base unless the user prefers reduced motion.
 */
export function Frond({
  x = 0,
  y = 0,
  rotate = 0,
  length = 300,
  bend = 40,
  leaves = 9,
  leafSize = 70,
  color = '#9dbb93',
  vein,
  opacity = 1,
  sway = 1.6,
  duration = 8,
  delay = 0,
}) {
  const reduce = useReducedMotion();
  const endX = bend * 0.35;
  const stem = `M0 0 Q ${bend} ${-length / 2} ${endX} ${-length}`;

  const items = [];
  for (let i = 0; i < leaves; i += 1) {
    const t = 0.14 + (i / Math.max(leaves - 1, 1)) * 0.8;
    const p = stemPoint(t, length, bend, endX);
    const side = i % 2 === 0 ? 1 : -1;
    const size = leafSize * (1 - t * 0.55);
    items.push({ ...p, side, size, key: i });
  }
  const tip = stemPoint(1, length, bend, endX);

  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} opacity={opacity}>
      <g>
        {!reduce && sway > 0 && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            values={`${-sway};${sway};${-sway}`}
            dur={`${duration}s`}
            begin={`${delay}s`}
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
          />
        )}
        <path d={stem} fill="none" stroke={color} strokeWidth={Math.max(1.5, length / 110)} strokeLinecap="round" />
        {items.map((leaf) => (
          <g key={leaf.key} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle + leaf.side * 52})`}>
            <path d={leafPath(leaf.size, leaf.size * 0.42)} fill={color} />
            {vein && (
              <path d={`M${leaf.size * 0.08} 0 L${leaf.size * 0.86} 0`} stroke={vein} strokeWidth="1" strokeLinecap="round" />
            )}
          </g>
        ))}
        <g transform={`translate(${tip.x} ${tip.y}) rotate(${tip.angle})`}>
          <path d={leafPath(leafSize * 0.42, leafSize * 0.2)} fill={color} />
        </g>
      </g>
    </g>
  );
}

/** Eucalyptus-style stem with round leaves. */
export function RoundLeafStem({ x = 0, y = 0, rotate = 0, length = 220, count = 7, color = '#b7cbb0', opacity = 1 }) {
  const leaves = [];
  for (let i = 0; i < count; i += 1) {
    const t = 0.15 + (i / (count - 1)) * 0.8;
    const r = 18 * (1 - t * 0.45);
    const side = i % 2 === 0 ? 1 : -1;
    leaves.push({ cy: -length * t, cx: side * (r + 2), r, key: i });
  }
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} opacity={opacity}>
      <path d={`M0 0 L0 ${-length}`} stroke={color} strokeWidth="2" strokeLinecap="round" />
      {leaves.map((l) => (
        <ellipse key={l.key} cx={l.cx} cy={l.cy} rx={l.r} ry={l.r * 0.86} fill={color} />
      ))}
    </g>
  );
}

/** The two-leaf sprout used as the brand mark. */
export function BrandMark({ light = true }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 27V15" stroke={light ? '#f7f2e8' : '#163a27'} strokeWidth="2" strokeLinecap="round" />
      <path d="M16 17.5c-5 0-8.5-3.4-8.5-8.5 5 0 8.5 3.4 8.5 8.5Z" fill="#9dbb93" />
      <path d="M16 15c0-5 3.4-8.5 8.5-8.5 0 5-3.4 8.5-8.5 8.5Z" fill="#d07c45" />
    </svg>
  );
}

/** Full-bleed artwork for the login page. */
export function LoginIllustration() {
  return (
    <svg className="login-illustration" viewBox="0 0 700 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#e8b08a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#e8b08a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="560" cy="210" r="210" fill="url(#sun)" />
      <circle cx="560" cy="210" r="64" fill="#e8b08a" opacity="0.18" />

      {/* back layer */}
      <Frond x={620} y={930} rotate={-18} length={560} bend={-70} leaves={13} leafSize={120} color="#2f6a47" opacity={0.55} duration={11} />
      <Frond x={90} y={940} rotate={14} length={500} bend={60} leaves={12} leafSize={110} color="#2f6a47" opacity={0.5} duration={12} delay={1} />
      <RoundLeafStem x={470} y={920} rotate={-8} length={380} count={9} color="#4c8061" opacity={0.45} />

      {/* middle layer */}
      <Frond x={700} y={900} rotate={-36} length={440} bend={-50} leaves={11} leafSize={100} color="#5f9270" opacity={0.7} duration={9} delay={0.5} />
      <Frond x={0} y={890} rotate={32} length={380} bend={40} leaves={10} leafSize={92} color="#5f9270" opacity={0.65} duration={10} delay={2} />
      <RoundLeafStem x={230} y={910} rotate={10} length={260} count={7} color="#7fa57f" opacity={0.6} />

      {/* front layer */}
      <Frond x={560} y={910} rotate={-6} length={300} bend={-30} leaves={9} leafSize={82} color="#9dbb93" vein="#7f9c7e" opacity={0.9} duration={7} />
      <Frond x={330} y={920} rotate={4} length={200} bend={20} leaves={7} leafSize={60} color="#b7cbb0" opacity={0.85} duration={6.5} delay={1.5} />
      <Frond x={140} y={920} rotate={22} length={250} bend={30} leaves={8} leafSize={70} color="#d07c45" opacity={0.55} duration={8} delay={0.8} />

      {/* drifting seeds */}
      {[
        [180, 300, 3],
        [260, 180, 2],
        [420, 380, 2.5],
        [120, 520, 2],
        [500, 520, 3],
        [340, 250, 1.8],
      ].map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="#f7f2e8" opacity="0.35">
          <animate attributeName="cy" values={`${cy};${cy - 14};${cy}`} dur={`${7 + i}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.15;0.45;0.15" dur={`${7 + i}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  );
}

/** Decorative frond for the sidebar and feature cards. */
export function CornerFrond({ className, color = '#f7f2e8' }) {
  return (
    <svg className={className} viewBox="0 0 240 320" aria-hidden="true">
      <Frond x={150} y={330} rotate={-14} length={300} bend={-40} leaves={10} leafSize={80} color={color} sway={1.2} duration={9} />
      <Frond x={60} y={330} rotate={18} length={200} bend={30} leaves={8} leafSize={60} color={color} opacity={0.7} sway={1.4} duration={7} />
    </svg>
  );
}

/** Seedling in a terracotta pot — for empty states. */
export function PotArt({ className = 'empty-art' }) {
  return (
    <svg className={className} viewBox="0 0 140 130" aria-hidden="true">
      <ellipse cx="70" cy="122" rx="46" ry="6" fill="#e3d8c4" />
      <path d="M36 70h68l-8 50H44z" fill="#d07c45" />
      <path d="M32 62h76a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H32a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3Z" fill="#b25c31" />
      <path d="M40 90c10 3 50 3 60 0" stroke="#e8b08a" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6" />
      <path d="M70 62V36" stroke="#3f8a5a" strokeWidth="3" strokeLinecap="round" />
      <path d="M70 44c-12 0-20-8-20-20 12 0 20 8 20 20Z" fill="#9dbb93" />
      <path d="M70 38c0-13 8-22 22-22 0 13-8 22-22 22Z" fill="#3f8a5a" />
    </svg>
  );
}

/** A small leafy sprig in currentColor — a quiet divider for section headers. */
export function Sprig({ className }) {
  return (
    <svg className={className} viewBox="0 0 34 18" aria-hidden="true">
      <path d="M2 13 Q17 11 32 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d={leafPath(9, 4)} fill="currentColor" transform="translate(9 11.6) rotate(-58)" />
      <path d={leafPath(8, 3.6)} fill="currentColor" opacity="0.75" transform="translate(14 11) rotate(34)" />
      <path d={leafPath(8, 3.6)} fill="currentColor" transform="translate(20 9.2) rotate(-64)" />
      <path d={leafPath(7, 3.2)} fill="currentColor" opacity="0.75" transform="translate(25 7.4) rotate(26)" />
      <path d={leafPath(7, 3.4)} fill="currentColor" transform="translate(31 4.4) rotate(-24)" />
    </svg>
  );
}

/** Empty-state scene for the journal: fronds growing in an arched window, a pinned snapshot. */
export function JournalArt({ className = 'journal-art' }) {
  const clip = useId();
  return (
    <svg className={className} viewBox="0 0 320 240" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d="M104 206V112a56 56 0 0 1 112 0v94Z" />
        </clipPath>
      </defs>
      <ellipse cx="160" cy="214" rx="120" ry="9" fill="#e3d8c4" opacity="0.7" />

      {/* Arched window with the morning light and fronds inside */}
      <path d="M104 206V112a56 56 0 0 1 112 0v94Z" fill="#f1f5ec" />
      <g clipPath={`url(#${clip})`}>
        <circle cx="186" cy="98" r="30" fill="#f6ebcf" />
        <circle cx="186" cy="98" r="14" fill="#d4a94f" opacity="0.55" />
        <Frond x={146} y={210} rotate={-10} length={128} bend={-22} leaves={11} leafSize={34} color="#3f8a5a" sway={1.4} duration={8} />
        <Frond x={174} y={212} rotate={16} length={92} bend={18} leaves={8} leafSize={26} color="#9dbb93" sway={1.8} duration={6.5} delay={0.6} />
      </g>
      <path d="M104 206V112a56 56 0 0 1 112 0v94" fill="none" stroke="#cfc1a8" strokeWidth="2" />
      <path d="M160 56v150M104 150h112" stroke="#cfc1a8" strokeWidth="1.2" opacity="0.6" />
      <path d="M96 206h128" stroke="#b25c31" strokeWidth="5" strokeLinecap="round" />

      {/* A snapshot, tilted and pinned */}
      <g transform="translate(34 118) rotate(-8)">
        <rect x="0" y="0" width="62" height="72" rx="4" fill="#fffdf8" stroke="#e6dccb" />
        <rect x="6" y="6" width="50" height="46" rx="2" fill="#f8e6d8" />
        <path d="M6 52l16-18 10 10 8-7 16 15Z" fill="#9dbb93" />
        <circle cx="42" cy="18" r="5" fill="#e8b08a" />
        <circle cx="31" cy="-1" r="3.2" fill="#d07c45" />
      </g>

      <RoundLeafStem x={262} y={210} rotate={10} length={128} count={8} color="#b7cbb0" />
      <RoundLeafStem x={276} y={210} rotate={24} length={82} count={6} color="#9dbb93" opacity={0.8} />
    </svg>
  );
}
