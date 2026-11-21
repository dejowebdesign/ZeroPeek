/**
 * The one starfield layer per document (Phase 6.13).
 *
 * `StarfieldCanvas` owns one canvas and one loop; this module owns the *page's*
 * instance, so a page can never end up with two fields. Every surface calls
 * `startStarfield` once at boot with the profile that suits it, and the manager
 * keeps a single instance, restarts it when the profile changes and tears it
 * down on `stopStarfield`.
 *
 * The layer sits at `z-index: -2` (see `styles/backdrop.css`): above the round
 * background image (`-3`) so the stars are drawn over the motif, and below the
 * wireframe and the content (`-1` and up) so nothing the user interacts with is
 * ever covered.
 */

import { StarfieldCanvas, type StarfieldProfile } from './starfieldCanvas.js';
import { isCalm } from './starfield.js';

let instance: StarfieldCanvas | null = null;
let activeProfile: StarfieldProfile | null = null;
let activeCalm: boolean | null = null;

/** Whether the operating system asks for reduced motion. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Start the field for a surface.
 *
 * Idempotent per profile *and* per calm state: calling it again with the same
 * settings leaves the running field alone, so a re-render or a re-sync cannot
 * stack a second canvas. A different profile replaces the field, because the two
 * have different star budgets; a changed calm state replaces it too, which is how
 * the user's switch takes effect without a reload.
 */
export function startStarfield(profile: StarfieldProfile): StarfieldCanvas {
  const calm = isCalm() || prefersReducedMotion();
  if (instance && activeProfile === profile && activeCalm === calm) return instance;
  instance?.stop();
  instance = new StarfieldCanvas({ profile, calm });
  instance.start();
  activeProfile = profile;
  activeCalm = calm;
  return instance;
}

/** Stop the field and drop its canvas. Safe to call when nothing runs. */
export function stopStarfield(): void {
  instance?.stop();
  instance = null;
  activeProfile = null;
  activeCalm = null;
}

/** The live instance, or `null`. Exposed for diagnostics and tests. */
export function currentStarfield(): StarfieldCanvas | null {
  return instance;
}
