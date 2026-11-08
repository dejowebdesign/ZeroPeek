/**
 * Player profile page tests (Phase 6.6, character picker Phase 6.6.2).
 *
 * These drive the real `pages/profile.ts` module in jsdom: the page boots, calls
 * `/api/auth/me` and `/api/profile`, and renders the profile. Only `fetch` is
 * stubbed (the network boundary); the DOM builder and the UI components are the
 * production code path.
 *
 * The character picker is checked against the same shared catalogue the page
 * imports, so the test fails if the page ever offers an id the catalogue does not
 * contain — the "no invented characters" rule.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CHARACTER_CATALOGUE } from '@zeropeek/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A minimal Response-like object for the stubbed fetch. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** Install a fetch stub that records calls and answers from a route table. */
function stubFetch(
  routes: Array<{
    match: RegExp;
    method?: string;
    status?: number;
    body: unknown | (() => unknown);
  }>,
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, headers: (init.headers as Record<string, string>) ?? {} });
    const route = routes.find(
      (candidate) =>
        candidate.match.test(url) &&
        (candidate.method === undefined || candidate.method === method),
    );
    if (!route) return jsonResponse(404, { error: { code: 'not_found', message: 'nope' } });
    const body = typeof route.body === 'function' ? (route.body as () => unknown)() : route.body;
    return jsonResponse(route.status ?? 200, body);
  });
  return calls;
}

const ME = { user: { id: 'p1', username: 'alice', role: 'PLAYER' }, csrfToken: 'csrf-token' };

const EMPTY_PROFILE = {
  user: { id: 'p1', username: 'alice', role: 'PLAYER' },
  profile: { selectedCharacterId: null },
  stats: {
    gamesPlayed: 0,
    wins: 0,
    podiums: 0,
    correctAnswers: 0,
    answeredCount: 0,
    accuracy: null,
  },
};

const FILLED_PROFILE = {
  user: { id: 'p1', username: 'alice', role: 'PLAYER' },
  profile: { selectedCharacterId: 'ethan' },
  stats: {
    gamesPlayed: 4,
    wins: 2,
    podiums: 3,
    correctAnswers: 12,
    answeredCount: 16,
    accuracy: 0.75,
  },
};

/** Boot the profile page fresh. */
async function bootProfile(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  await import('./pages/profile.js');
  await vi.waitFor(() => {
    if (!document.getElementById('app')?.textContent?.trim()) throw new Error('not rendered');
  });
}

const APP = () => document.getElementById('app') as HTMLElement;

/** The radio inputs of the character picker. */
const pickerInputs = (): HTMLInputElement[] =>
  Array.from(APP().querySelectorAll<HTMLInputElement>('.profile__picker input[type="radio"]'));

/** Choose a character in the picker and let the page react. */
function choose(id: string): void {
  const input = pickerInputs().find((candidate) => candidate.value === id);
  if (!input) throw new Error(`no picker option for ${id}`);
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Submit the character form. */
function submitForm(): void {
  const form = APP().querySelector('form.profile__form');
  if (!form) throw new Error('no character form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

const saveButton = (): HTMLButtonElement =>
  APP().querySelector<HTMLButtonElement>('.profile__save button')!;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('profile page', () => {
  it('loads and shows the account’s own statistics', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: FILLED_PROFILE },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).toContain('alice');
    expect(text).toContain('Games won');
    expect(text).toContain('2');
    expect(text).toContain('75%');
    expect(text).toContain('Ethan');
  });

  it('shows an honest empty state, never a fake number, for a fresh account', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).toContain('No finished games yet');
    // Accuracy is unknown, so it is an em dash, not "0%".
    expect(text).not.toContain('0%');
  });

  it('invites a signed-out visitor to sign in and does not call the profile API', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: { user: null } },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).toContain('Sign in');
    expect(calls.some((call) => /\/api\/profile$/.test(call.url))).toBe(false);
  });

  it('shows an error notice when the profile request fails', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      {
        match: /\/api\/profile$/,
        status: 500,
        body: { error: { code: 'internal', message: 'boom' } },
      },
    ]);
    await bootProfile();

    await vi.waitFor(() => {
      expect(APP().textContent).toContain('boom');
    });
  });

  it('renders inside the player shell with the profile entry active', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: FILLED_PROFILE },
    ]);
    await bootProfile();

    expect(APP().querySelector('.shell--player')).not.toBeNull();
    const active = APP().querySelector('.nav__item--active');
    expect(active?.textContent).toContain('Profile');
  });
});

describe('character picker (Phase 6.6.2)', () => {
  it('offers exactly the catalogue ids and no invented character', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    const offered = pickerInputs().map((input) => input.value);
    expect(offered).toEqual(CHARACTER_CATALOGUE.map((character) => character.id));
    // Each option is a real radio with a name, so it is keyboard reachable.
    for (const input of pickerInputs()) {
      expect(input.type).toBe('radio');
      expect(input.name).toBe('selectedCharacterId');
    }
  });

  it('checks the stored character and leaves Save disabled until it changes', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: FILLED_PROFILE },
    ]);
    await bootProfile();

    const checked = pickerInputs().filter((input) => input.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]?.value).toBe('ethan');
    expect(saveButton().disabled).toBe(true);
  });

  it('saves the chosen character with the CSRF token and reloads the profile', async () => {
    let stored = 'ethan';
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      {
        match: /\/api\/profile$/,
        method: 'GET',
        body: () => ({
          ...FILLED_PROFILE,
          profile: { selectedCharacterId: stored },
        }),
      },
      {
        match: /\/api\/profile$/,
        method: 'PUT',
        body: () => {
          stored = 'maya';
          return { ...FILLED_PROFILE, profile: { selectedCharacterId: stored } };
        },
      },
    ]);
    await bootProfile();

    choose('maya');
    expect(saveButton().disabled).toBe(false);
    submitForm();

    await vi.waitFor(() => {
      expect(APP().textContent).toContain('Character: Maya');
    });

    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toMatch(/\/api\/profile$/);
    expect(put?.headers['X-CSRF-Token']).toBe('csrf-token');

    // The page re-reads the profile so the headline reflects the stored value.
    const gets = calls.filter((call) => call.method === 'GET' && /\/api\/profile$/.test(call.url));
    expect(gets.length).toBeGreaterThanOrEqual(2);
    expect(pickerInputs().find((input) => input.checked)?.value).toBe('maya');
  });

  it('shows a save failure in place and does not pretend the choice was stored', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      { match: /\/api\/profile$/, method: 'GET', body: FILLED_PROFILE },
      {
        match: /\/api\/profile$/,
        method: 'PUT',
        status: 500,
        body: { error: { code: 'internal', message: 'save failed' } },
      },
    ]);
    await bootProfile();

    choose('maya');
    submitForm();

    await vi.waitFor(() => {
      expect(APP().querySelector('.profile__save-status--error')?.textContent).toContain(
        'save failed',
      );
    });

    // No second read: the page keeps showing what is really stored (ethan) …
    const gets = calls.filter((call) => call.method === 'GET' && /\/api\/profile$/.test(call.url));
    expect(gets).toHaveLength(1);
    expect(APP().textContent).toContain('Character: Ethan');
    // … and the button recovers so the player can retry.
    expect(saveButton().disabled).toBe(false);
  });

  it('shows an unknown stored id honestly instead of hiding or faking it', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      {
        match: /\/api\/profile$/,
        body: { ...FILLED_PROFILE, profile: { selectedCharacterId: 'legacy-hero' } },
      },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).toContain('Character: legacy-hero');
    expect(text).toContain('is not one of the characters on offer');
    expect(pickerInputs().some((input) => input.checked)).toBe(false);
  });

  it('shows “no character chosen” for an account that has picked nothing', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    expect(APP().textContent).toContain('No character chosen');
    expect(pickerInputs().some((input) => input.checked)).toBe(false);
  });
});

describe('guests and mobile layout', () => {
  it('leaves the guest player surface free of any profile or auth dependency', () => {
    // A guest joins by PIN and never signs in. The player surface must therefore
    // not touch the profile API or require a session — this guards that promise.
    const here = dirname(fileURLToPath(import.meta.url));
    const player = readFileSync(join(here, 'pages/player.ts'), 'utf8');
    expect(player).not.toContain('/api/profile');
    expect(player).not.toContain('/api/auth/me');
  });

  it('stacks the picker to one column on a phone and keeps tap-sized options', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const tokens = readFileSync(join(here, 'styles/tokens.css'), 'utf8');

    // One column on a phone, auto-fit on wider screens.
    expect(tokens).toMatch(
      /@media \(max-width: 767px\) \{\s*\.profile__picker \{\s*grid-template-columns: 1fr;/,
    );
    expect(tokens).toMatch(
      /\.profile__picker \{\s*display: grid;\s*grid-template-columns: repeat\(auto-fit, minmax\(210px, 1fr\)\);/,
    );
    // Options meet the shared tap target, and motion is dropped when asked.
    const option = tokens.slice(tokens.indexOf('.profile__option {'));
    expect(option).toContain('min-height: var(--tap)');
    expect(tokens).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.profile__option \{\s*transition: none;/,
    );
  });
});
