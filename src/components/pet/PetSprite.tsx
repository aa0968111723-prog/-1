/**
 * 小財 V2 — the in-app pet sprite.
 *
 * One inline SVG, layered like the native drawables (wings / body / face /
 * props) so the web and Android pets read as the same character: round warm
 * yellow body, green head-sprout, pink blush, tiny wings, little wallet.
 *
 * Animation is pure CSS (see index.css `.pet-*` keyframes): breathe, blink,
 * sprout sway — all slow, all cheap, all disabled when `animated` is false
 * or the user prefers reduced motion. No JS timers.
 */

import React from 'react';

export type PetSpriteMood =
  | 'idle'
  | 'happy'
  | 'thinking'
  | 'sleep'
  | 'celebrate'
  | 'wave'
  | 'surprised';

interface PetSpriteProps {
  mood?: PetSpriteMood;
  /** Rendered square size in px. */
  size?: number;
  /** Idle life (breathe/blink/sway). Feedback poses show regardless. */
  animated?: boolean;
  className?: string;
}

const FACE: Record<PetSpriteMood, React.ReactNode> = {
  idle: (
    <g>
      <circle cx="41" cy="50" r="4.6" fill="#3A3128" />
      <circle cx="67" cy="50" r="4.6" fill="#3A3128" />
      <circle cx="42.6" cy="48.4" r="1.5" fill="#FFF" />
      <circle cx="68.6" cy="48.4" r="1.5" fill="#FFF" />
      <path d="M51 59 L54 62.4 L57 59" fill="#F49B45" stroke="#E0861F" strokeWidth="0.8" strokeLinejoin="round" />
    </g>
  ),
  happy: (
    <g>
      <path d="M36.5 50 Q41 45 45.5 50" stroke="#3A3128" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M62.5 50 Q67 45 71.5 50" stroke="#3A3128" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M49 58 Q54 63.5 59 58" stroke="#E0861F" strokeWidth="2.2" fill="#F49B45" strokeLinecap="round" />
    </g>
  ),
  thinking: (
    <g>
      <circle cx="41" cy="50" r="4.2" fill="#3A3128" />
      <circle cx="67" cy="49" r="4.2" fill="#3A3128" />
      <circle cx="42.4" cy="48.6" r="1.4" fill="#FFF" />
      <circle cx="68.4" cy="47.6" r="1.4" fill="#FFF" />
      <path d="M50 60.5 L58 60.5" stroke="#B98A3F" strokeWidth="2" strokeLinecap="round" />
      <circle cx="78" cy="34" r="2.2" fill="#C9BCA8" opacity="0.85" />
      <circle cx="84" cy="27" r="3" fill="#C9BCA8" opacity="0.65" />
    </g>
  ),
  sleep: (
    <g>
      <path d="M36.5 51 Q41 54 45.5 51" stroke="#3A3128" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M62.5 51 Q67 54 71.5 51" stroke="#3A3128" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <ellipse cx="54" cy="61" rx="3" ry="2.2" fill="#F5B87F" opacity="0.9" />
      <g className="pet-zzz" fill="#9DB4C9" fontFamily="ui-rounded, system-ui" fontWeight="700">
        <text x="76" y="30" fontSize="10">z</text>
        <text x="83" y="22" fontSize="8">z</text>
        <text x="89" y="16" fontSize="6">z</text>
      </g>
    </g>
  ),
  celebrate: (
    <g>
      <path d="M36.5 49 Q41 44 45.5 49" stroke="#3A3128" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M62.5 49 Q67 44 71.5 49" stroke="#3A3128" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M48 57.5 Q54 65 60 57.5" stroke="#E0861F" strokeWidth="2.2" fill="#F7A94F" strokeLinecap="round" />
      <g fill="#F6C244">
        <path d="M22 26 l1.6 3.4 3.6.4-2.7 2.5.7 3.6-3.2-1.8-3.2 1.8.7-3.6-2.7-2.5 3.6-.4z" />
        <circle cx="86" cy="30" r="2.4" fill="#F2A6A0" />
        <circle cx="80" cy="20" r="1.8" fill="#9CC79A" />
      </g>
    </g>
  ),
  wave: (
    <g>
      <path d="M36.5 50 Q41 45 45.5 50" stroke="#3A3128" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <circle cx="67" cy="50" r="4.6" fill="#3A3128" />
      <circle cx="68.6" cy="48.4" r="1.5" fill="#FFF" />
      <path d="M49 58 Q54 63 59 58" stroke="#E0861F" strokeWidth="2.2" fill="#F49B45" strokeLinecap="round" />
    </g>
  ),
  surprised: (
    <g>
      <circle cx="41" cy="49" r="5.4" fill="#3A3128" />
      <circle cx="67" cy="49" r="5.4" fill="#3A3128" />
      <circle cx="43" cy="47" r="1.8" fill="#FFF" />
      <circle cx="69" cy="47" r="1.8" fill="#FFF" />
      <ellipse cx="54" cy="61" rx="4.2" ry="5" fill="#3A3128" />
      <ellipse cx="54" cy="59.6" rx="2.4" ry="2.4" fill="#8A4A2E" />
    </g>
  ),
};

export function PetSprite({ mood = 'idle', size = 96, animated = true, className }: PetSpriteProps) {
  const lively = animated && mood !== 'sleep';
  return (
    <svg
      viewBox="0 0 108 108"
      width={size}
      height={size}
      role="img"
      aria-label="小財"
      className={[
        'pet-sprite',
        lively ? 'pet-sprite--animated' : '',
        animated && mood === 'sleep' ? 'pet-sprite--dreaming' : '',
        mood === 'wave' ? 'pet-sprite--wave' : '',
        mood === 'celebrate' ? 'pet-sprite--celebrate' : '',
        mood === 'surprised' ? 'pet-sprite--surprised' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      {/* contact shadow */}
      <ellipse cx="54" cy="98" rx="26" ry="5" fill="#3A3128" opacity="0.10" className="pet-shadow" />

      {/* wings (behind the body; the left one waves in wave mood) */}
      <g className="pet-wing pet-wing--left">
        <ellipse cx="20" cy="63" rx="9.5" ry="13" fill="#F6C244" stroke="#E0AE45" strokeWidth="1.4" transform="rotate(14 20 63)" />
      </g>
      <g className="pet-wing pet-wing--right">
        <ellipse cx="88" cy="63" rx="9.5" ry="13" fill="#F6C244" stroke="#E0AE45" strokeWidth="1.4" transform="rotate(-14 88 63)" />
      </g>

      {/* body */}
      <g className="pet-body">
        <ellipse cx="54" cy="62" rx="37" ry="35" fill="#FFD66B" stroke="#E0AE45" strokeWidth="2.2" />
        <ellipse cx="54" cy="70" rx="26" ry="20" fill="#FFE9A8" opacity="0.85" />
        <ellipse cx="40" cy="42" rx="12" ry="8" fill="#FFF3CF" opacity="0.65" />
        {/* feet */}
        <ellipse cx="42" cy="95.5" rx="6.4" ry="3.4" fill="#F2B03C" />
        <ellipse cx="66" cy="95.5" rx="6.4" ry="3.4" fill="#F2B03C" />
        {/* blush */}
        <ellipse cx="31" cy="58" rx="5.6" ry="3.6" fill="#F2A6A0" opacity="0.8" />
        <ellipse cx="77" cy="58" rx="5.6" ry="3.6" fill="#F2A6A0" opacity="0.8" />
      </g>

      {/* head sprout */}
      <g className="pet-sprout">
        <path d="M54 27 C54 20 52 16 48 13" stroke="#6FA26B" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <ellipse cx="45.5" cy="11.5" rx="5.4" ry="3.6" fill="#8CC084" transform="rotate(-24 45.5 11.5)" />
        <ellipse cx="52.5" cy="9.5" rx="4.4" ry="3" fill="#A8D49E" transform="rotate(18 52.5 9.5)" />
      </g>

      {/* face */}
      <g className="pet-face">{FACE[mood]}</g>
      {/* eyelids for the idle blink (cover the eyes briefly via CSS) */}
      {mood === 'idle' && lively && (
        <g className="pet-eyelids" fill="#FFD66B">
          <rect x="35" y="43" width="12.5" height="13" rx="6" />
          <rect x="61" y="43" width="12.5" height="13" rx="6" />
        </g>
      )}

      {/* tiny wallet */}
      <g className="pet-wallet">
        <rect x="45" y="76" width="18" height="12.5" rx="3.4" fill="#B98A5A" stroke="#96683D" strokeWidth="1.2" />
        <rect x="45" y="80" width="18" height="2.4" fill="#96683D" opacity="0.7" />
        <circle cx="59" cy="82.5" r="1.8" fill="#F6C244" stroke="#C9992F" strokeWidth="0.7" />
      </g>
    </svg>
  );
}

export default PetSprite;
