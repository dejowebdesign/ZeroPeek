/**
 * Design-system guards (Phase 6.1).
 *
 * These are contract tests, not visual tests. They protect the two promises
 * the design system makes to the rest of the project:
 *
 *  1. Bestandsschutz – the Phase 0 tokens keep their values. Phase 6.1 extends
 *     the token set; it must never silently change an existing colour, radius or
 *     spacing value, because every existing surface is built on them.
 *  2. One visual language – every surface links the same stylesheets, and every
 *     class the shared UI components emit is actually defined.
 *
 * A failure here means a change would shift the look of a surface without the
 * matching stylesheet update, which is exactly the "inconsistent designs" risk
 * the concept calls out (Fehlerquelle 4).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(here, relative), 'utf8');

const tokens = read('styles/tokens.css');
const backdrop = read('styles/backdrop.css');
const uiSource = read('ui.ts');

/** Every HTML entry point in the frontend. */
const entries = readdirSync(here)
  .filter((name) => name.endsWith('.html'))
  .sort();

/** Value of a custom property, as written in the `:root` block. */
function tokenValue(name: string): string | undefined {
  const match = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return match?.[1]?.trim();
}

describe('design tokens – bestandsschutz', () => {
  // The Phase 0 values, frozen. Changing any of these changes existing surfaces.
  const frozen: Record<string, string> = {
    bg: '#08080f',
    'bg-2': '#0e0e1a',
    text: '#f5f5fb',
    muted: '#9c9cb5',
    accent: '#7c5cff',
    'accent-2': '#22d3ee',
    surface: 'rgba(255, 255, 255, 0.045)',
    'surface-2': 'rgba(255, 255, 255, 0.075)',
    border: 'rgba(255, 255, 255, 0.09)',
    'border-strong': 'rgba(255, 255, 255, 0.16)',
  };

  for (const [name, value] of Object.entries(frozen)) {
    it(`keeps --${name} at its original value`, () => {
      expect(tokenValue(name)).toBe(value);
    });
  }
});

describe('design tokens – Phase 6.1 additions', () => {
  const required = [
    'brand-cyan',
    'brand-violet',
    'rarity-rare',
    'rarity-legendary',
    'bg-3',
    'glass-card',
    'glass-raised',
    'glass-dialog',
    'glass-nav',
    'glass-input',
    'glass-overlay',
    'blur-card',
    'blur-raised',
    'blur-dialog',
    'blur-nav',
    'blur-input',
    'blur-overlay',
    'glass-fallback',
    'inset-light',
    'shadow-raised',
    'shadow-dialog',
    'focus-width',
    'radius-pill',
    'tap',
    'type-page',
    'type-section',
    'type-countdown',
    'type-show-question',
    'dur-slow',
    'dur-show',
    'wire-cell',
    'wire-line',
    'wire-opacity',
  ];

  for (const name of required) {
    it(`defines --${name}`, () => {
      expect(tokenValue(name), `--${name} is missing`).toBeDefined();
    });
  }

  it('never pairs a glass tier with a missing blur radius', () => {
    for (const tier of ['card', 'raised', 'dialog', 'nav', 'input', 'overlay']) {
      expect(tokenValue(`glass-${tier}`)).toBeDefined();
      expect(tokenValue(`blur-${tier}`)).toBeDefined();
    }
  });
});

describe('design-system components', () => {
  // Each class the shared components emit must have a rule somewhere in the
  // stylesheet set, or the component would render unstyled.
  const classes = [
    'chip',
    'chip__dot',
    'progress',
    'progress__track',
    'progress__fill',
    'stat',
    'stat__value',
    'stat__label',
    'dialog',
    'dialog__panel',
    'dialog__title',
    'dialog__body',
    'dialog__actions',
    'skeleton',
    'skeleton--text',
    'skeleton--card',
    'countdown',
    'countdown__value',
    'empty',
    'empty__title',
    'btn-primary',
    'btn-secondary',
    'btn-ghost',
    'btn-danger',
    'btn-sm',
    'btn--loading',
    'card--interactive',
    'card--raised',
    'anim-fade-in',
    'anim-slide-up',
    'anim-pop',
    'anim-shake',
    'show',
    // Beamer surface (Phase 6.1 fine-tuning).
    'show__board',
    'show__title',
    'show__meta',
    'show__answers',
    'show__options',
    'show__option',
    'show__option-label',
    'show__controls',
    'show__winner',
    'leaderboard--show',
    'podium',
    'podium__place',
    'podium__rank',
    'podium__name',
    'podium__score',
  ];

  for (const name of classes) {
    it(`styles .${name}`, () => {
      expect(tokens).toContain(`.${name}`);
    });
  }
});

describe('beamer surface (Phase 6.1 fine-tuning)', () => {
  it('scales the prompt and answers with the show type tokens', () => {
    const block = tokens.slice(tokens.indexOf('.show .question__prompt'));
    expect(block).toContain('var(--type-show-question)');
    expect(tokens).toContain('var(--type-show-answer)');
    expect(tokens).toContain('var(--type-show-score)');
    expect(tokens).toContain('var(--type-show-name)');
    expect(tokens).toContain('var(--type-show-rank)');
  });

  it('lays the answers out as a two-column board that stacks on small screens', () => {
    const options = tokens.slice(tokens.indexOf('.show__options'));
    expect(options).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(tokens).toMatch(
      /@media \(max-width: 640px\) \{\s*\.show__options \{\s*grid-template-columns: 1fr;/,
    );
  });

  it('draws the podium accents from existing tokens', () => {
    const podium = tokens.slice(tokens.indexOf('.podium__place--1'));
    expect(podium).toContain('var(--rarity-legendary)');
    expect(podium).toContain('var(--brand-silver)');
    expect(podium).toContain('var(--podium-bronze)');
  });

  it('keeps the countdown a borderless gradient ring, not an image', () => {
    const countdown = tokens.slice(
      tokens.indexOf('.countdown {'),
      tokens.indexOf('.countdown__value'),
    );
    expect(countdown).toContain('conic-gradient');
    expect(countdown).toContain('var(--progress)');
    expect(countdown).not.toContain('url(');
  });
});

describe('fallbacks and accessibility', () => {
  it('reduces motion when the user asks for it', () => {
    expect(tokens).toContain('@media (prefers-reduced-motion: reduce)');
    expect(backdrop).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('falls back to opaque glass when blur is unavailable or unwanted', () => {
    expect(tokens).toContain('@supports not (backdrop-filter: blur(1px))');
    expect(tokens).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(tokens).toContain('--glass-fallback');
  });

  it('strengthens contrast on request', () => {
    expect(tokens).toContain('@media (prefers-contrast: more)');
  });
});

describe('every surface shares the same stylesheets', () => {
  it('finds the four entry points', () => {
    expect(entries).toEqual(['admin.html', 'editor.html', 'host.html', 'index.html']);
  });

  for (const entry of entries) {
    it(`${entry} links tokens.css and backdrop.css`, () => {
      const html = read(entry);
      expect(html).toContain('./styles/tokens.css');
      expect(html).toContain('./styles/backdrop.css');
    });
  }
});

describe('the UI layer stays CSP-safe', () => {
  it('never builds markup from an HTML string', () => {
    // The backend sends `script-src 'self'` and `style-src 'self'` with no
    // 'unsafe-inline', so assigning markup would be rejected at runtime. Match
    // only real usage (a property write or a call), not prose in comments.
    expect(uiSource).not.toMatch(
      /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write/,
    );
  });
});
