/**
 * The round background layer (Phase 6.10).
 *
 * The module only paints what the server sends. These tests pin the three things
 * it can get wrong: creating more than one layer, painting the wrong file, and
 * leaving a previous game's image behind.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { BACKGROUND_CATALOGUE } from '@zeropeek/shared';

import { applyRoundBackground, clearRoundBackground } from './background.js';

const LAYER = '[data-round-background]';

beforeEach(() => {
  document.body.replaceChildren();
});

describe('applyRoundBackground', () => {
  it('creates exactly one layer and reuses it on every later call', () => {
    applyRoundBackground('synthwave_skyline');
    applyRoundBackground('synthwave_wueste');
    applyRoundBackground('synthwave_skyline');
    expect(document.querySelectorAll(LAYER)).toHaveLength(1);
  });

  it('paints the supplied file for the given id', () => {
    applyRoundBackground('synthwave_weltraum');
    const layer = document.querySelector<HTMLElement>(LAYER)!;
    expect(layer.style.getPropertyValue('--round-background')).toContain(
      '/backgrounds/zeropeek_synthwave_weltraum.webp',
    );
  });

  it('paints a catalogue path for every supplied background', () => {
    for (const entry of BACKGROUND_CATALOGUE) {
      applyRoundBackground(entry.id);
      const layer = document.querySelector<HTMLElement>(LAYER)!;
      expect(layer.style.getPropertyValue('--round-background')).toContain(entry.path);
      expect(layer.getAttribute('data-round-background-id')).toBe(entry.id);
    }
    expect(document.querySelectorAll(LAYER)).toHaveLength(1);
  });

  it('falls back to the default file for an unknown id instead of painting nothing', () => {
    applyRoundBackground('not_a_background');
    const layer = document.querySelector<HTMLElement>(LAYER)!;
    expect(layer.style.getPropertyValue('--round-background')).toContain(
      BACKGROUND_CATALOGUE[0]!.path,
    );
  });

  it('is inert and hidden from assistive technology', () => {
    applyRoundBackground('synthwave_skyline');
    const layer = document.querySelector<HTMLElement>(LAYER)!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
  });

  it('returns the display name the picker shows', () => {
    expect(applyRoundBackground('synthwave_skyline')).toBe('Skyline');
  });

  it('puts the layer behind the content as the first child of body', () => {
    const content = document.createElement('main');
    document.body.append(content);
    applyRoundBackground('synthwave_skyline');
    expect(document.body.firstElementChild?.getAttribute('data-round-background')).toBe('');
  });
});

describe('clearRoundBackground', () => {
  it('removes the layer so a previous round cannot linger', () => {
    applyRoundBackground('synthwave_skyline');
    clearRoundBackground();
    expect(document.querySelector(LAYER)).toBeNull();
  });

  it('is a no-op when no layer exists', () => {
    expect(() => clearRoundBackground()).not.toThrow();
    expect(document.querySelector(LAYER)).toBeNull();
  });

  it('lets a later call create a fresh layer', () => {
    applyRoundBackground('synthwave_skyline');
    clearRoundBackground();
    applyRoundBackground('synthwave_wueste');
    expect(document.querySelectorAll(LAYER)).toHaveLength(1);
  });
});
