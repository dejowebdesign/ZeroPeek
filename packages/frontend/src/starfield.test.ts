/**
 * Starfield module (Phase 6.3).
 *
 * The stars themselves are CSS; these tests cover the part this module owns:
 * the container, the meteor count, and the two ways motion is calmed – the
 * operating-system preference and the user's own switch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isCalm, setCalm, starfield } from './starfield.js';

/** Install a `matchMedia` that reports the given reduced-motion preference. */
function mockReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  localStorage.clear();
  mockReducedMotion(false);
});

describe('starfield', () => {
  it('builds a non-interactive layer', () => {
    const node = starfield();
    expect(node.className).toContain('starfield');
    expect(node.getAttribute('aria-hidden')).toBe('true');
  });

  it('adds meteors when motion is allowed', () => {
    const node = starfield({ meteors: 3 });
    expect(node.querySelectorAll('.starfield__meteor')).toHaveLength(3);
  });

  it('calms the field when the operating system asks for reduced motion', () => {
    mockReducedMotion(true);
    const node = starfield();
    expect(node.className).toContain('starfield--calm');
    expect(node.querySelectorAll('.starfield__meteor')).toHaveLength(0);
  });

  it('calms the field when the user switch is on, even without a media query', () => {
    setCalm(true);
    const node = starfield();
    expect(node.className).toContain('starfield--calm');
    expect(node.querySelectorAll('.starfield__meteor')).toHaveLength(0);
  });

  it('can be forced calm regardless of the stored preference', () => {
    const node = starfield({ calm: true });
    expect(node.className).toContain('starfield--calm');
  });
});

describe('calm preference', () => {
  it('defaults to off', () => {
    expect(isCalm()).toBe(false);
  });

  it('round-trips through storage', () => {
    setCalm(true);
    expect(isCalm()).toBe(true);
    setCalm(false);
    expect(isCalm()).toBe(false);
  });
});
