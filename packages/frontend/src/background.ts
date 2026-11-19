/**
 * The round's background layer (Phase 6.10).
 *
 * The host and the beamer share one presentation surface, so one module paints
 * the background for both. It renders a single fixed, non-interactive element
 * behind the content and swaps only its `--round-background` image when the
 * server announces a change.
 *
 * Boundaries that matter:
 *   - **Server value only.** The id always comes from the server (`HostState`,
 *     `PlayerSync` or a `background` event). This module never picks a random
 *     background itself — a client-side roll would give two devices two
 *     different images.
 *   - **One element, updated in place.** The layer is created once per document
 *     and then only has its custom property rewritten, so a change never
 *     re-creates the DOM or restarts the CSS transitions.
 *   - **Readability first.** The image sits at a low opacity behind the existing
 *     dark surface (see `styles/backdrop.css`); no quiz styling changes.
 */

import { backgroundName, backgroundPath } from '@zeropeek/shared';

/** The attribute the CSS hooks onto. */
const LAYER_ATTRIBUTE = 'data-round-background';

/** The element that carries the background image, created on first use. */
function ensureLayer(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`[${LAYER_ATTRIBUTE}]`);
  if (existing) return existing;
  const layer = document.createElement('div');
  layer.setAttribute(LAYER_ATTRIBUTE, '');
  layer.setAttribute('aria-hidden', 'true');
  // First child of `<body>` so it paints behind everything without a z-index
  // race against the existing backdrop pseudo-elements.
  document.body.prepend(layer);
  return layer;
}

/**
 * Paint the background for a catalogue id.
 *
 * An unknown or missing id resolves to the catalogue default (the shared helper
 * guarantees that), so a stale value shows the default image instead of nothing.
 * Returns the name that was applied, which is useful for a host preview label.
 */
export function applyRoundBackground(id: string | null | undefined): string {
  const layer = ensureLayer();
  const path = backgroundPath(id);
  if (path) layer.style.setProperty('--round-background', `url("${path}")`);
  layer.setAttribute('data-round-background-id', id ?? '');
  return backgroundName(id);
}

/**
 * Remove the layer entirely.
 *
 * Used when a surface leaves the show (back to the host home, a kicked player),
 * so a background from a previous game cannot linger behind an unrelated screen.
 */
export function clearRoundBackground(): void {
  document.querySelector<HTMLElement>(`[${LAYER_ATTRIBUTE}]`)?.remove();
}
