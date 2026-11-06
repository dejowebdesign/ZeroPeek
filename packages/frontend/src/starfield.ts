/**
 * The animated starfield for the login, registration and join surfaces
 * (Phase 6.3, briefing §10).
 *
 * The stars themselves are pure CSS (see `styles/backdrop.css`), so nothing is
 * downloaded and the particle count is bounded by the tile size, not the screen.
 * This module only builds the container element, adds a couple of meteors and
 * decides whether to calm the motion.
 *
 * Motion rules:
 *  - `prefers-reduced-motion: reduce` stops the drift and hides the meteors;
 *  - the user's own "calm the effects" preference does the same, independently
 *    of the operating-system setting;
 *  - the preference is stored in `localStorage` so it survives a reload.
 */

import { el } from './dom.js';

const PREF_KEY = 'zeropeek.calm';

/** Whether the user asked for calmer effects (their own switch). */
export function isCalm(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember the user's "calm the effects" choice. */
export function setCalm(calm: boolean): void {
  try {
    if (calm) localStorage.setItem(PREF_KEY, '1');
    else localStorage.removeItem(PREF_KEY);
  } catch {
    // A blocked storage API must never break the page.
  }
}

/** Whether the operating system asks for reduced motion. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface StarfieldOptions {
  /** Force the calm variant regardless of the stored preference (tests). */
  calm?: boolean;
  /** How many meteors to spawn. Kept small: each is a short-lived streak. */
  meteors?: number;
}

/**
 * Build the starfield layer. It is absolutely positioned and non-interactive, so
 * it can be dropped into any `position: relative` container.
 */
export function starfield(options: StarfieldOptions = {}): HTMLElement {
  const calm = options.calm ?? (isCalm() || prefersReducedMotion());
  const count = options.meteors ?? (calm ? 0 : 3);

  const node = el('div', {
    class: `starfield${calm ? ' starfield--calm' : ''}`,
    'aria-hidden': 'true',
  });

  for (let index = 0; index < count; index += 1) {
    // A fixed, staggered layout: the positions are deterministic so the field
    // looks the same on every load and no randomness leaks into the render.
    const positions = [
      { x: '8%', y: '14%', delay: '2s', dur: '9s' },
      { x: '52%', y: '8%', delay: '6s', dur: '12s' },
      { x: '30%', y: '30%', delay: '10s', dur: '14s' },
    ];
    const spot = positions[index % positions.length]!;
    node.append(
      el('span', {
        class: 'starfield__meteor',
        style: {
          '--meteor-x': spot.x,
          '--meteor-y': spot.y,
          '--meteor-delay': spot.delay,
          '--meteor-dur': spot.dur,
        },
      }),
    );
  }

  return node;
}
