/**
 * The page's single starfield layer (Phase 6.13).
 *
 * The manager exists to guarantee one thing the module cannot: that a page never
 * holds two star canvases. These tests pin that, plus the profile switch and the
 * teardown, because a leaked canvas would keep a frame loop alive forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentStarfield, startStarfield, stopStarfield } from './starfieldLayer.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  // jsdom has no canvas backend; a recorder keeps the loop meaningful.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    setTransform: () => undefined,
    set globalAlpha(_value: number) {},
    set fillStyle(_value: string) {},
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  stopStarfield();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('starfield layer', () => {
  it('starts one canvas per page', () => {
    startStarfield('player');
    expect(document.querySelectorAll('canvas.starfield-canvas')).toHaveLength(1);
    expect(currentStarfield()).not.toBeNull();
  });

  it('is idempotent for the same profile', () => {
    const first = startStarfield('host');
    const second = startStarfield('host');
    expect(second).toBe(first);
    expect(document.querySelectorAll('canvas.starfield-canvas')).toHaveLength(1);
  });

  it('replaces the field when the profile changes', () => {
    const host = startStarfield('host');
    const player = startStarfield('player');
    expect(player).not.toBe(host);
    // The old canvas must be gone: exactly one field may survive the swap.
    expect(document.querySelectorAll('canvas.starfield-canvas')).toHaveLength(1);
    // The per-profile star budget is asserted in `starfieldCanvas.test.ts`,
    // which can set a 1920×1080 frame; jsdom's default viewport is too small for
    // either cap to apply.
    expect(player.starCount).toBeGreaterThan(0);
  });

  it('tears the field down without leaving a canvas behind', () => {
    startStarfield('host');
    stopStarfield();
    expect(currentStarfield()).toBeNull();
    expect(document.querySelectorAll('canvas.starfield-canvas')).toHaveLength(0);
  });

  it('is safe to stop twice', () => {
    startStarfield('player');
    stopStarfield();
    expect(() => stopStarfield()).not.toThrow();
  });

  it('calms the field when the user switch is on', () => {
    localStorage.setItem('zeropeek.calm', '1');
    const field = startStarfield('player');
    // The calm variant still runs and still has stars: it is slower, not hidden.
    expect(field.isRunning).toBe(true);
    expect(field.starCount).toBeGreaterThan(0);
  });

  it('replaces the field when the calm switch changes', () => {
    // The auth page's switch calls `startStarfield` again with the same profile,
    // so the calm state has to be part of the identity or the toggle would be a
    // no-op until a reload.
    const normal = startStarfield('player');
    localStorage.setItem('zeropeek.calm', '1');
    const calm = startStarfield('player');
    expect(calm).not.toBe(normal);
    expect(document.querySelectorAll('canvas.starfield-canvas')).toHaveLength(1);
  });

  it('leaves an unchanged field alone on a re-render', () => {
    const first = startStarfield('player');
    expect(startStarfield('player')).toBe(first);
  });
});
