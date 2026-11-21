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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
    // Phase 6.2.1 – application shell.
    'sidebar-w',
    'sidebar-w-compact',
    'bottom-bar-h',
    'shell-top-h',
    'player-measure',
    'player-gutter',
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
    // Player answer board (regression fix).
    'question__input',
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
    // Game-show skeleton (Phase 6.9.2 / 6.9.3): AUTO toggle and participants.
    'show__auto',
    'lobby__title',
    'lobby__welcome',
    'lobby__participants',
    'lobby__join',
    'lobby--wide',
    'participants',
    'participant',
    'participant__name',
    'leaderboard--show',
    'podium',
    'podium__place',
    'podium__rank',
    'podium__name',
    'podium__score',
    // Application shell (Phase 6.2.1). `shell--player` and `shell--host` are
    // emitted by `appShell`; only the player variant carries its own rules, so
    // the host class is asserted through the shell test below instead.
    'shell',
    'shell--player',
    'shell__side',
    'shell__body',
    'shell__top',
    'shell__brand',
    'shell__badge',
    'shell__actions',
    'shell__main',
    'nav',
    'nav--side',
    'nav--bottom',
    'nav__item',
    'nav__item--active',
    'nav__item--soon',
    'nav__icon',
    'nav__label',
    'nav__soon',
    'nav__more',
    'nav__more-list',
    'nav__more-item',
    'nav__more-item--active',
    // Player lobby (Phase 6.2.2).
    'lobby__status',
    'lobby__roster',
    'lobby__roster-row',
    'lobby__roster-row--me',
    'lobby__roster-name',
    'lobby__roster-you',
    'join__feedback',
    // Auth surface (Phase 6.3).
    'auth',
    'auth__card',
    'auth__title',
    'auth__subtitle',
    'auth__form',
    'auth__actions',
    'auth__alt',
    'auth__link',
    'auth__tabs',
    'auth__tab',
    'auth__strength',
    'auth__strength-bar',
    'auth__strength-bar--on',
    'auth__icon',
    'auth__icon--ok',
    'auth__icon--warn',
    'auth__note',
    'auth-offer',
    'auth-offer__text',
    'auth-offer__title',
    'auth-offer__hint',
    // Player profile (Phase 6.6).
    'profile',
    'profile__head',
    'profile__identity',
    'profile__name',
    'profile__chips',
    'profile__section-title',
    'profile__stats',
    'profile__hint',
    'profile__signin',
    // Player profile – character picker (Phase 6.6.2).
    'profile__form',
    'profile__picker',
    'profile__radio',
    'profile__option',
    'profile__option--selected',
    'profile__option--rare',
    'profile__option--legendary',
    'profile__option-body',
    'profile__option-name',
    'profile__option-tagline',
    'profile__save',
    'profile__save-status',
    'profile__save-status--error',
    // Inventory, progression and achievements (Phase 6.8).
    'inventory__list',
    'inventory__item',
    'inventory__item--locked',
    'inventory__thumb',
    'inventory__thumb-empty',
    'inventory__meta',
    'inventory__name',
    'inventory__slot',
    'inventory__state',
    'inventory__hint',
    'inventory__action',
    'achievements',
    'achievement',
    'achievement--earned',
    'achievement__head',
    'achievement__name',
    'achievement__hint',
    // Player avatar badge and in-game identity (Phase 6.8.3).
    'player-avatar',
    'player-avatar--sm',
    'player-avatar--md',
    'player-avatar--lg',
    'player-avatar--art',
    'player-avatar--head',
    'player-avatar--full',
    'player-avatar__img',
    'player-avatar__initial',
    'player-badge',
    'player-badge__body',
    'player-badge__name',
    'player-badge__meta',
    'leaderboard__who',
    'question__who',
    'lobby__me',
    'end-saved',
    'end-saved__hint',
    'end-saved__actions',
    // Inventory loadout equip/unequip (Phase 6.8.4).
    'avatar__loadout',
    'avatar__loadout-row',
    'avatar__loadout-slot',
    'avatar__loadout-value',
    'avatar__loadout-name',
    'avatar__loadout-empty',
    'avatar__loadout-action',
    // Host background music control (Phase 6.11).
    'music',
    'music__icon',
    'music__slider',
    'music__value',
    'music--muted',
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

describe('game-show skeleton (Phase 6.9.2 / 6.9.3)', () => {
  it('draws the AUTO toggle and participants from existing tokens, never a new colour', () => {
    const auto = tokens.slice(tokens.indexOf('.show__auto'));
    expect(auto).toContain('var(--border)');
    const tile = tokens.slice(tokens.indexOf('.participant {'));
    expect(tile).toContain('var(--glass-raised)');
    expect(tile).toContain('var(--radius)');
  });

  it('fades a scene change with opacity only, and stops under reduced motion', () => {
    const fade = tokens.slice(
      tokens.indexOf('@keyframes show-scene-fade'),
      tokens.indexOf('@keyframes show-scene-fade') + 200,
    );
    expect(fade).toContain('opacity');
    expect(fade).not.toContain('transform');
    const reduce = tokens.slice(tokens.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toContain('.show__board');
    expect(reduce).toContain('animation: none');
  });

  it('lays the participants grid out responsively', () => {
    const grid = tokens.slice(tokens.indexOf('.participants {'));
    expect(grid).toContain('grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))');
  });

  it('never hides the host controls behind the AUTO toggle', () => {
    // The AUTO bar sits above the controls; the controls keep their own rules.
    const auto = tokens.slice(tokens.indexOf('.show__auto'), tokens.indexOf('.lobby__title'));
    expect(auto).not.toContain('display: none');
    expect(tokens).toContain('.show__controls');
  });

  it('has no presentation-mode chrome left (Phase 6.9.3 removed it)', () => {
    // The presentation toggle and the scene bar are gone for good; the host
    // controls are never hidden by a display mode.
    expect(tokens).not.toContain('.show__scene-bar');
    expect(tokens).not.toContain('.show__present');
    expect(tokens).not.toContain('.show-presentation');
  });
});

describe('host/player layout regression fix', () => {
  it('centres the presentation surface in the viewport', () => {
    // `justify-items` centres the section's children; `margin-inline: auto`
    // centres the section itself inside `<main>`. Without both, the `max-width`
    // on `.show` pins the whole beamer board to the left edge.
    const block = tokens.slice(tokens.indexOf('.centered.show'), tokens.indexOf('.show__board'));
    expect(block).toContain('justify-items: center');
    expect(block).toContain('margin-inline: auto');
  });

  it('lays the player answer buttons out as a two-column board', () => {
    // Scoped with `:has()` so only option-based question types get the grid;
    // text, slider, order, scale and idea inputs keep their own layout.
    const block = tokens.slice(tokens.indexOf('.question__input:has(> .option)'));
    expect(block).toContain('display: grid');
    expect(block).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(tokens).toMatch(
      /@media \(max-width: 640px\) \{\s*\.question__input:has\(> \.option\) \{\s*grid-template-columns: 1fr;/,
    );
  });
});

describe('application shell layout (Phase 6.2.1)', () => {
  it('lays the desktop shell out as a sidebar plus content', () => {
    const block = tokens.slice(tokens.indexOf('.shell {'), tokens.indexOf('.shell__side'));
    expect(block).toContain('grid-template-columns: var(--sidebar-w) minmax(0, 1fr)');
  });

  it('hides the bottom bar except on a phone', () => {
    expect(tokens).toMatch(/\.nav--bottom \{\s*display: none;/);
    const phone = tokens.slice(tokens.indexOf('@media (max-width: 767px)'));
    expect(phone).toContain('.nav--bottom {');
    expect(phone).toContain('position: fixed');
  });

  it('collapses the sidebar to an icon rail on a tablet', () => {
    expect(tokens).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1023px\) \{\s*\.shell \{\s*grid-template-columns: var\(--sidebar-w-compact\)/,
    );
  });

  it('hides the rail labels but keeps them as accessible names', () => {
    const rail = tokens.slice(tokens.indexOf('@media (min-width: 768px) and (max-width: 1023px)'));
    expect(rail).toContain('.nav--side .nav__label');
    expect(rail).toContain('display: none');
  });

  it('steps the player measure by viewport and caps it on a large screen', () => {
    expect(tokens).toMatch(/@media \(min-width: 768px\) \{\s*:root \{\s*--player-measure: 90%;/);
    expect(tokens).toMatch(/@media \(min-width: 1024px\) \{\s*:root \{\s*--player-measure: 78%;/);
    // The widest step shares the 1440px breakpoint with the content cap, so both
    // live in one block (Phase 6.8.6); the player value must stay last to win.
    const wide = tokens.slice(tokens.indexOf('@media (min-width: 1440px)'));
    expect(wide).toContain('--content-max: 1320px;');
    expect(wide).toContain('--player-measure: 1000px;');
  });

  it('applies the player measure to the centred content, not the card', () => {
    const block = tokens.slice(tokens.indexOf('.shell--player .centered > *'));
    expect(block).toContain('max-width: var(--player-measure)');
    expect(block).toContain('width: 100%');
  });

  it('keeps the beamer surface free of shell navigation', () => {
    // `.centered.show` is the presentation surface; the shell never wraps it.
    expect(tokens).toContain('.centered.show');
    expect(tokens).not.toMatch(/\.show\s+\.nav/);
  });
});

describe('player lobby layout (Phase 6.2.2)', () => {
  it('lays the waiting-room roster out as one row per player', () => {
    const roster = tokens.slice(
      tokens.indexOf('.lobby__roster {'),
      tokens.indexOf('.lobby__roster-row'),
    );
    expect(roster).toContain('display: grid');
  });

  it('puts the name and the connection state on opposite ends of a row', () => {
    const row = tokens.slice(
      tokens.indexOf('.lobby__roster-row {'),
      tokens.indexOf('.lobby__roster-row--me'),
    );
    expect(row).toContain('justify-content: space-between');
    expect(row).toContain('align-items: center');
  });

  it('gives the player question card its own width, scoped away from the beamer', () => {
    const block = tokens.slice(
      tokens.indexOf('.shell--player .card.question'),
      tokens.indexOf('.shell--player .card.question') + 160,
    );
    expect(block).toContain('width: min(680px, 100%)');
    // The beamer board must keep its own sizing.
    expect(tokens).not.toMatch(/\.show\s+\.card\.question/);
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

describe('host music stays off the player devices (Phase 6.11)', () => {
  // The soundtrack is a show feature: it plays on the host/beamer only. A player
  // device must never download or start it, so the guard is structural — the
  // player entry must not reach the music module at all.
  const playerSurfaces = ['pages/player.ts', 'playerView.ts', 'index.html'];

  for (const file of playerSurfaces) {
    it(`${file} does not reference the music module or track`, () => {
      const source = read(file);
      expect(source).not.toContain('hostMusic');
      expect(source).not.toContain('/audio/');
    });
  }

  it('the host surface does load the track', () => {
    expect(read('pages/host.ts')).toContain("from '../hostMusic.js'");
  });

  it('the supplied track lives under the documented audio folder', () => {
    // The asset briefing puts music in `public/audio/music/`, so the module's
    // path and the real file must agree.
    const music = read('hostMusic.ts');
    expect(music).toContain("'/audio/music/question-background.ogg'");
    expect(existsSync(join(here, '../public/audio/music/question-background.ogg'))).toBe(true);
  });
});

describe('finale effects stay off the player devices (Phase 6.11.2)', () => {
  // The fireworks, the applause and the confetti are a show feature. The guard is
  // structural, like the music guard above: a player entry that never imports the
  // module cannot download the two effects or run the canvas, whatever a runtime
  // flag says.
  const playerSurfaces = [
    'pages/player.ts',
    'playerView.ts',
    'index.html',
    'showView.ts',
    'showScenes.ts',
  ];

  for (const file of playerSurfaces) {
    it(`${file} does not reference the finale module or its effects`, () => {
      const source = read(file);
      expect(source).not.toContain('finaleEffects');
      expect(source).not.toContain('finale-fireworks');
      expect(source).not.toContain('finale-crowd');
    });
  }

  it('the host surface is the only place that starts the finale', () => {
    expect(read('pages/host.ts')).toContain("from '../finaleEffects.js'");
    expect(read('pages/host.ts')).toContain('finale.start(');
  });

  it('the two supplied effects live under the documented audio folder', () => {
    const module = read('finaleEffects.ts');
    expect(module).toContain("'/audio/sfx/finale-fireworks.ogg'");
    expect(module).toContain("'/audio/sfx/finale-crowd.ogg'");
    expect(existsSync(join(here, '../public/audio/sfx/finale-fireworks.ogg'))).toBe(true);
    expect(existsSync(join(here, '../public/audio/sfx/finale-crowd.ogg'))).toBe(true);
  });

  it('keeps the two effects out of the player entry bundle', () => {
    // A player must not even download the files. Vite emits one bundle per entry
    // in a production build, so the check runs against `dist` when it exists and
    // is skipped otherwise (the CI build step covers it).
    const dist = join(here, '../dist/assets');
    if (!existsSync(dist)) return;
    const playerChunks = readdirSync(dist).filter((name) => /^player-.*\.js$/.test(name));
    for (const name of playerChunks) {
      const source = readFileSync(join(dist, name), 'utf8');
      expect(source).not.toContain('finale-fireworks');
      expect(source).not.toContain('finale-crowd');
      expect(source).not.toContain('FinaleEffects');
    }
  });
});

describe('every surface shares the same stylesheets', () => {
  it('finds the seven entry points', () => {
    expect(entries).toEqual([
      'admin.html',
      'auth.html',
      'editor.html',
      'host.html',
      'index.html',
      'inventory.html',
      'profile.html',
    ]);
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

describe('auth surface and starfield (Phase 6.3)', () => {
  it('draws the starfield with gradients, never an image', () => {
    const block = backdrop.slice(backdrop.indexOf('.starfield {'));
    expect(block).toContain('radial-gradient');
    expect(block).not.toContain('url(');
  });

  it('keeps the drift slow and bounded', () => {
    // Two layers at different speeds; the duration is in the tens of seconds so
    // the motion reads as calm rather than busy.
    expect(backdrop).toMatch(/animation: star-drift-far 1[0-9]0s linear infinite/);
    expect(backdrop).toMatch(/animation: star-drift-near 1[0-9]0s linear infinite/);
  });

  it('stops the drift and hides the meteors for reduced motion', () => {
    const reduce = backdrop.slice(backdrop.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toContain('.starfield::before');
    expect(reduce).toContain('.starfield::after');
    expect(reduce).toContain('.starfield__meteor');
    expect(reduce).toContain('display: none');
  });

  it('offers a user switch to calm the effects', () => {
    expect(backdrop).toContain('.starfield--calm');
    expect(backdrop).toContain('.starfield--calm .starfield__meteor');
  });

  it('centres a single glass card over the field', () => {
    const block = tokens.slice(tokens.indexOf('.auth {'), tokens.indexOf('.auth__card'));
    expect(block).toContain('place-items: center');
    const card = tokens.slice(tokens.indexOf('.auth__card {'));
    expect(card).toContain('backdrop-filter: blur(var(--blur-dialog))');
  });

  it('gives the auth card an opaque fallback when blur is unavailable', () => {
    const fallback = tokens.slice(
      tokens.indexOf('@supports not ((backdrop-filter: blur(1px))'),
      tokens.indexOf('@supports not ((backdrop-filter: blur(1px))') + 200,
    );
    expect(fallback).toContain('.auth__card');
    expect(fallback).toContain('var(--glass-fallback)');
  });

  it('stacks the auth actions on a small screen', () => {
    const mobile = tokens.slice(tokens.lastIndexOf('@media (max-width: 480px)'));
    expect(mobile).toContain('.auth__actions');
    expect(mobile).toContain('flex-direction: column');
  });
});

describe('avatar editor surface (Phase 6.7)', () => {
  it('draws the avatar figure and thumbnails from existing tokens, never a new colour', () => {
    const frame = tokens.slice(tokens.indexOf('.avatar__figure-frame {'));
    expect(frame).toContain('var(--glass-card)');
    expect(frame).toContain('var(--radius)');
    const thumb = tokens.slice(tokens.indexOf('.avatar__thumb {'));
    expect(thumb).toContain('image-rendering: pixelated');
  });

  it('lays the preview out as a figure beside a loadout that stacks on a phone', () => {
    const preview = tokens.slice(tokens.indexOf('.avatar__preview {'));
    expect(preview).toContain('grid-template-columns: minmax(0, 220px) minmax(0, 1fr)');
    expect(tokens).toMatch(
      /@media \(max-width: 767px\) \{\s*\.avatar__preview \{\s*grid-template-columns: 1fr;/,
    );
  });

  it('keeps the removed slot editor out of the stylesheet', () => {
    // The equipment editor moved to the inventory (Phase 6.8.4), so the profile
    // no longer renders slot radios. The rules that styled them are gone too;
    // `profile.test.ts` asserts the DOM side of the same removal.
    for (const gone of [
      '.avatar__form',
      '.avatar__slots',
      '.avatar__slot-title',
      '.avatar__slot-options',
      '.avatar__slot-option',
    ]) {
      expect(tokens).not.toContain(`${gone} {`);
    }
  });

  it('does not fabricate a layer stack: the figure is a single supplied image', () => {
    // The phase ships no aligned layer geometry, so the preview must not attempt
    // absolute positioning of equipment over the figure.
    const preview = tokens.slice(
      tokens.indexOf('.avatar__preview {'),
      tokens.indexOf('.avatar__thumb {'),
    );
    expect(preview).not.toContain('position: absolute');
  });
});

describe('round background layer (Phase 6.10)', () => {
  /** The Phase 6.10 block of `backdrop.css`. */
  const round = backdrop.slice(backdrop.indexOf('[data-round-background] {'));

  it('fills the viewport without distorting the supplied file', () => {
    expect(round).toContain('background-size: cover');
    expect(round).toContain('background-position: center');
    expect(round).toContain('background-repeat: no-repeat');
  });

  it('paints behind the content and never intercepts a click', () => {
    const base = round.slice(0, round.indexOf('[data-round-background]::after'));
    expect(base).toContain('position: fixed');
    expect(base).toContain('pointer-events: none');
    expect(base).toContain('z-index: -3');
  });

  it('keeps the quiz surface readable with a dark scrim over the image', () => {
    // The brief requires a dark, readable quiz surface over the background. The
    // scrim is a gradient of the existing surface colour, so contrast never
    // depends on the motif, and the image itself is held well below full opacity.
    expect(round).toContain('[data-round-background]::after');
    expect(round).toContain('linear-gradient');
    expect(round).toMatch(/opacity: 0\.5;/);
  });

  it('dims further on a phone and without transparency support', () => {
    const small = round.slice(round.indexOf('@media (max-width: 767px)'));
    expect(small).toContain('opacity: 0.4');
    const reduce = round.slice(round.indexOf('@media (prefers-reduced-transparency: reduce)'));
    expect(reduce).toContain('opacity: 0.28');
  });

  it('does not restyle any existing quiz surface', () => {
    // The layer is additive: it must not re-declare a question, option, card or
    // glass rule, so the existing quiz surface is untouched by this phase.
    for (const surface of [
      '.question',
      '.option',
      '.card',
      '.show__board',
      '.participant',
      '.lobby__pin',
      '.centered',
    ]) {
      expect(round).not.toContain(`${surface} {`);
    }
  });
});
