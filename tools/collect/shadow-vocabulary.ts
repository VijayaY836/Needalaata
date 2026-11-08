// Shadow vocabulary for the collector: reference illustration + description per label.
// Descriptions mirror the product shadow vocabulary (.kiro/steering/product.md).
// Illustrations are simple original inline SVGs (no external assets).
import { LABELS, type Label } from './types';

export interface ShadowEntry {
  label: Label;
  description: string;
  /** Inline SVG markup, 120x120 viewBox. */
  illustrationSvg: string;
}

const wrap = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-hidden="true">` +
  `<g fill="#ffb36b" stroke="#ffb36b" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;

const palm = '<rect x="42" y="66" width="36" height="34" rx="12" stroke="none"/>';

export const SHADOW_VOCABULARY: Record<Label, ShadowEntry> = {
  rabbit: {
    label: 'rabbit',
    description: 'One hand, index and middle fingers raised as ears.',
    illustrationSvg: wrap(
      palm +
        '<line x1="52" y1="68" x2="46" y2="16" stroke-width="10"/>' +
        '<line x1="68" y1="68" x2="74" y2="16" stroke-width="10"/>',
    ),
  },
  lion: {
    label: 'lion',
    description:
      'Dog-head shape (thumb up as ear, pinky lowered as jaw) with the other hand\u2019s spread fingers behind as a mane.',
    illustrationSvg: wrap(
      '<g stroke-width="8">' +
        [-60, -30, 0, 30, 60]
          .map((a) => `<line x1="60" y1="64" x2="${60 + 48 * Math.sin((a * Math.PI) / 180)}" y2="${64 - 48 * Math.cos((a * Math.PI) / 180)}"/>`)
          .join('') +
        '</g><ellipse cx="60" cy="70" rx="26" ry="22" stroke="none"/>',
    ),
  },
  bird: {
    label: 'bird',
    description: 'Two hands crossed and linked at the thumbs, fingers spread as wings.',
    illustrationSvg: wrap(
      '<ellipse cx="60" cy="64" rx="9" ry="14" stroke="none"/>' +
        '<g stroke-width="7"><line x1="52" y1="62" x2="10" y2="30"/><line x1="52" y1="66" x2="8" y2="50"/><line x1="52" y1="70" x2="12" y2="68"/>' +
        '<line x1="68" y1="62" x2="110" y2="30"/><line x1="68" y1="66" x2="112" y2="50"/><line x1="68" y1="70" x2="108" y2="68"/></g>',
    ),
  },
  snake: {
    label: 'snake',
    description: 'Forearm raised, hand arched forward with fingers together like a cobra\u2019s hood.',
    illustrationSvg: wrap(
      '<path d="M60 108 L60 62" stroke-width="16" fill="none"/>' +
        '<path d="M60 62 Q60 22 88 26" stroke-width="18" fill="none"/>' +
        '<circle cx="90" cy="28" r="9" stroke="none"/>',
    ),
  },
  crocodile: {
    label: 'crocodile',
    description: 'Two hands stacked palm-to-palm, opening and closing like jaws.',
    illustrationSvg: wrap(
      '<path d="M10 62 L100 54 L100 62 Z" stroke-width="6"/>' +
        '<path d="M10 70 L100 86 L100 76 Z" stroke-width="6"/>' +
        '<rect x="88" y="52" width="24" height="36" rx="8" stroke="none"/>',
    ),
  },
  demon: {
    label: 'demon',
    description: 'Both hands raised, fingers curled as claws.',
    illustrationSvg: wrap(
      '<g stroke-width="7" fill="none">' +
        '<path d="M30 100 L30 60 Q22 40 34 24"/><path d="M42 100 L42 56 Q36 36 48 20"/>' +
        '<path d="M90 100 L90 60 Q98 40 86 24"/><path d="M78 100 L78 56 Q84 36 72 20"/></g>',
    ),
  },
  none: {
    label: 'none',
    description: 'Anything else, or no hands in view. Record relaxed hands, odd shapes, or an empty frame.',
    illustrationSvg: wrap(
      '<circle cx="60" cy="60" r="38" fill="none" stroke-width="6"/><line x1="33" y1="87" x2="87" y2="33" stroke-width="6"/>',
    ),
  },
};

export function shadowEntries(): ShadowEntry[] {
  return LABELS.map((l) => SHADOW_VOCABULARY[l]);
}
