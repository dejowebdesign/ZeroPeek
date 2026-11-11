/**
 * Player profile page tests (Phase 6.6, character picker Phase 6.6.2).
 *
 * These drive the real `pages/profile.ts` module in jsdom: the page boots, calls
 * `/api/player-auth/me` and `/api/profile`, and renders the profile. Only `fetch` is
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
  /** The request payload, when one was sent (Phase 6.7 assertions). */
  payload?: unknown;
}

/** Install a fetch stub that records calls and answers from a route table. */
function stubFetch(
  routes: Array<{
    match: RegExp;
    method?: string;
    status?: number;
    body: unknown | ((payload?: unknown) => unknown);
  }>,
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const payload = init.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, method, headers: (init.headers as Record<string, string>) ?? {}, payload });
    const route =
      routes.find(
        (candidate) =>
          candidate.match.test(url) &&
          (candidate.method === undefined || candidate.method === method),
      ) ?? DEFAULT_ROUTES.find((candidate) => candidate.match.test(url));
    if (!route) return jsonResponse(404, { error: { code: 'not_found', message: 'nope' } });
    const body =
      typeof route.body === 'function'
        ? (route.body as (payload?: unknown) => unknown)(payload)
        : route.body;
    return jsonResponse(route.status ?? 200, body);
  });
  return calls;
}

/**
 * Routes the profile page reads on every boot besides the profile itself
 * (Phase 6.8). A test overrides one by adding its own matching route; otherwise
 * these neutral, empty defaults apply, so a test that only cares about the
 * profile or the picker need not restate them.
 */
const DEFAULT_ROUTES: Array<{ match: RegExp; status?: number; body: unknown }> = [
  {
    match: /\/api\/progress$/,
    body: {
      xp: 0,
      level: 1,
      progress: {
        level: 1,
        xpIntoLevel: 0,
        xpForThisLevel: 10_000,
        xpToNextLevel: 10_000,
        nextLevel: 2,
        ratio: 0,
      },
      nextRewardLevel: null,
      achievementsUnlocked: 0,
      itemsOwned: 0,
    },
  },
  { match: /\/api\/achievements$/, body: { achievements: [] } },
];

const ME = { user: { id: 'p1', username: 'alice', role: 'PLAYER' }, csrfToken: 'csrf-token' };

const EMPTY_PROFILE = {
  user: { id: 'p1', username: 'alice', role: 'PLAYER' },
  profile: { selectedCharacterId: null, avatarConfig: null },
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
  profile: {
    selectedCharacterId: 'ethan',
    avatarConfig: {
      characterId: 'ethan',
      equipment: {
        visor: 'ethan_visor',
        outfit: 'ethan_outfit',
        backpack: 'ethan_backpack',
        neckAccessory: 'ethan_compass',
        wristAccessory: 'ethan_wristband',
      },
    },
  },
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
      { match: /\/api\/player-auth\/me$/, body: ME },
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
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).toContain('No finished games yet');
    // Accuracy is unknown, so it is an em dash, not "0%".
    expect(text).not.toContain('0%');
  });

  it('invites a signed-out player to sign in and does not call the profile API', async () => {
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, status: 401, body: { user: null } },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).toContain('Player sign-in');
    expect(text).toContain('Sign in');
    // The player context only: a host session is never consulted here.
    expect(calls.some((call) => /\/api\/auth\/me$/.test(call.url))).toBe(false);
    expect(calls.some((call) => /\/api\/profile$/.test(call.url))).toBe(false);
  });

  it('treats a host-only browser (no player session) as a signed-out player', async () => {
    // Phase 6.6.3: a host session must not surface as a player profile. The page
    // asks the player endpoint, which answers 401 for a host-only browser.
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, status: 401, body: { user: null } },
    ]);
    await bootProfile();

    expect(APP().textContent).toContain('Player sign-in');
    expect(calls.some((call) => /\/api\/profile$/.test(call.url))).toBe(false);
  });

  it('signs a player in through the player endpoint, then loads the profile', async () => {
    let signedIn = false;
    const calls = stubFetch([
      {
        match: /\/api\/player-auth\/me$/,
        body: () => (signedIn ? ME : ({ user: null } as unknown)),
      },
      {
        match: /\/api\/player-auth\/login$/,
        method: 'POST',
        body: () => {
          signedIn = true;
          return { user: { id: 'p1' }, csrfToken: 'csrf-token' };
        },
      },
      { match: /\/api\/profile$/, body: FILLED_PROFILE },
    ]);
    await bootProfile();

    const username = APP().querySelector<HTMLInputElement>('input[autocomplete="username"]')!;
    const password = APP().querySelector<HTMLInputElement>('input[type="password"]')!;
    username.value = 'alice';
    password.value = 'correct-horse-battery';
    APP()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(APP().textContent).toContain('Games won');
    });
    const login = calls.find((call) => /\/api\/player-auth\/login$/.test(call.url));
    expect(login?.method).toBe('POST');
  });

  it('signs the player out through the player endpoint only', async () => {
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: FILLED_PROFILE },
      { match: /\/api\/player-auth\/logout$/, method: 'POST', body: { ok: true } },
    ]);
    await bootProfile();

    const signOut = Array.from(APP().querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Sign out'),
    );
    signOut!.click();

    await vi.waitFor(() => {
      expect(APP().textContent).toContain('Player sign-in');
    });
    const logout = calls.find((call) => /\/api\/player-auth\/logout$/.test(call.url));
    expect(logout?.method).toBe('POST');
    // The host context is never touched.
    expect(calls.some((call) => /\/api\/auth\/logout$/.test(call.url))).toBe(false);
  });

  it('shows an error notice when the profile request fails', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
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
      { match: /\/api\/player-auth\/me$/, body: ME },
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
      { match: /\/api\/player-auth\/me$/, body: ME },
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
      { match: /\/api\/player-auth\/me$/, body: ME },
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
      { match: /\/api\/player-auth\/me$/, body: ME },
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
      { match: /\/api\/player-auth\/me$/, body: ME },
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
      { match: /\/api\/player-auth\/me$/, body: ME },
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
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    expect(APP().textContent).toContain('No character chosen');
    expect(pickerInputs().some((input) => input.checked)).toBe(false);
  });

  it('shows no error for the valid “nothing chosen yet” state (Finding 2)', async () => {
    // A brand-new profile has `selectedCharacterId: null`. That is a valid initial
    // state, not an unknown id — the page must not render `null is not one of the
    // characters on offer.` The picker is simply offered unselected.
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).not.toContain('is not one of the characters on offer');
    expect(text).not.toContain('“null”');
    // The picker is still offered and nothing is preselected.
    expect(pickerInputs()).toHaveLength(CHARACTER_CATALOGUE.length);
    expect(pickerInputs().some((input) => input.checked)).toBe(false);
    // Save stays disabled until the player actually picks something.
    expect(saveButton().disabled).toBe(true);
  });
});

describe('guests and mobile layout', () => {
  it('keeps the guest player surface free of any required profile or staff-auth dependency', () => {
    // A guest joins by PIN and never signs in. The player surface must therefore
    // not touch the profile API or the staff auth API, and must not *require* a
    // session. Since Phase 6.8.3 it reads `/api/player-auth/me` once, but only
    // best-effort: a guest (or a host-only browser) is simply treated as a guest
    // and still joins with a PIN and a nickname — this guards that promise.
    const here = dirname(fileURLToPath(import.meta.url));
    const player = readFileSync(join(here, 'pages/player.ts'), 'utf8');
    expect(player).not.toContain('/api/profile');
    expect(player).not.toContain('/api/auth/');
    // The only auth read is the optional player-context lookup, and it is guarded
    // so a failure falls back to the guest path.
    expect(player).toContain('/api/player-auth/me');
    expect(player).toMatch(/catch \{\s*account = null;/);
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

describe('avatar editor (Phase 6.7)', () => {
  /** The avatar section's slot radios for a given slot name. */
  const slotInputs = (slot: string): HTMLInputElement[] =>
    Array.from(
      APP().querySelectorAll<HTMLInputElement>(`.avatar__slot input[name="slot-${slot}"]`),
    );

  const avatarSave = (): HTMLButtonElement =>
    APP().querySelector<HTMLButtonElement>('.avatar__form .profile__save button')!;

  const chooseSlot = (slot: string, value: string): void => {
    const input = slotInputs(slot).find((candidate) => candidate.value === value);
    if (!input) throw new Error(`no ${slot} option ${value}`);
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const submitAvatar = (): void => {
    const form = APP().querySelector('form.avatar__form');
    if (!form) throw new Error('no avatar form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  it('renders the character figure and the equipped loadout for a character with artwork', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: FILLED_PROFILE },
    ]);
    await bootProfile();

    const figure = APP().querySelector<HTMLImageElement>('.avatar__figure');
    expect(figure?.getAttribute('src')).toBe('/characters/ethan/ethan_full_preview.webp');
    // The portrait in the headline uses the same supplied asset.
    expect(APP().querySelector('.profile__portrait')?.getAttribute('src')).toBe(
      '/characters/ethan/ethan_full_preview.webp',
    );
    // Every slot shows its equipped item by name.
    const text = APP().textContent ?? '';
    for (const label of [
      'Cyber Visor',
      'Standard Outfit',
      'Tech Backpack',
      'Compass Pendant',
      'Tech Wristband',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('offers only the chosen character’s own items, never another character’s', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: FILLED_PROFILE },
    ]);
    await bootProfile();

    // Ethan's editor must not contain a single Maya item value.
    const values = Array.from(APP().querySelectorAll<HTMLInputElement>('.avatar__slot input'))
      .map((input) => input.value)
      .filter((value) => value !== 'none');
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value.startsWith('ethan_')).toBe(true);
      expect(value.startsWith('maya_')).toBe(false);
    }
  });

  it('shows the default kit and a live preview when nothing is stored yet', async () => {
    // A profile with a chosen character but no stored avatar configuration.
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      {
        match: /\/api\/profile$/,
        body: {
          ...FILLED_PROFILE,
          profile: { selectedCharacterId: 'ethan', avatarConfig: null },
        },
      },
    ]);
    await bootProfile();

    // The defaults are what the picker shows, so Save starts disabled.
    expect(avatarSave().disabled).toBe(true);
    const text = APP().textContent ?? '';
    expect(text).toContain('Cyber Visor');
  });

  it('saves a changed loadout to the avatar endpoint with the CSRF token, then reloads', async () => {
    let storedVisor: string | null = 'ethan_visor';
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      {
        match: /\/api\/profile$/,
        method: 'GET',
        body: () => ({
          ...FILLED_PROFILE,
          profile: {
            selectedCharacterId: 'ethan',
            avatarConfig: {
              characterId: 'ethan',
              equipment: {
                visor: storedVisor,
                outfit: 'ethan_outfit',
                backpack: 'ethan_backpack',
                neckAccessory: 'ethan_compass',
                wristAccessory: 'ethan_wristband',
              },
            },
          },
        }),
      },
      {
        match: /\/api\/profile\/avatar$/,
        method: 'PUT',
        body: (payload: unknown) => {
          storedVisor = (payload as { equipment: { visor: string | null } }).equipment.visor;
          return { characterId: 'ethan', equipment: {} };
        },
      },
    ]);
    await bootProfile();

    chooseSlot('visor', 'none');
    expect(avatarSave().disabled).toBe(false);
    submitAvatar();

    // The page re-reads the profile after a successful save, so the stored value
    // is what is shown.
    await vi.waitFor(() => {
      const gets = calls.filter(
        (call) => call.method === 'GET' && /\/api\/profile$/.test(call.url),
      );
      expect(gets.length).toBeGreaterThanOrEqual(2);
    });
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toMatch(/\/api\/profile\/avatar$/);
    expect(put?.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(storedVisor).toBeNull();
  });

  it('shows a save failure in place and keeps the stored value', async () => {
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, method: 'GET', body: FILLED_PROFILE },
      {
        match: /\/api\/profile\/avatar$/,
        method: 'PUT',
        status: 422,
        body: { error: { code: 'invalid', message: 'avatar rejected' } },
      },
    ]);
    await bootProfile();

    chooseSlot('visor', 'none');
    submitAvatar();

    await vi.waitFor(() => {
      expect(
        APP().querySelector('.avatar__form .profile__save-status--error')?.textContent,
      ).toContain('avatar rejected');
    });
    // No reload happened: the page keeps showing what is really stored.
    const gets = calls.filter((call) => call.method === 'GET' && /\/api\/profile$/.test(call.url));
    expect(gets).toHaveLength(1);
    expect(avatarSave().disabled).toBe(false);
  });

  it('offers no editor, and an honest empty state, for a character without artwork', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      {
        match: /\/api\/profile$/,
        body: {
          ...FILLED_PROFILE,
          profile: { selectedCharacterId: 'pixel', avatarConfig: null },
        },
      },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).toContain('No avatar yet');
    expect(APP().querySelector('form.avatar__form')).toBeNull();
    expect(APP().querySelector('.avatar__figure')).toBeNull();
  });

  it('offers no editor when no character has been chosen yet', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    expect(APP().textContent).toContain('No avatar yet');
    expect(APP().querySelector('form.avatar__form')).toBeNull();
  });
});

/**
 * Phase 6.8 — the progression card and the achievements list.
 *
 * The page reads `/api/progress` and `/api/achievements`; both are stubbed. The
 * card must show the server's numbers (never a client-computed level) and an
 * honest message while the reward matrix is unapproved.
 */
describe('profile progression (Phase 6.8)', () => {
  it('shows the level, XP and progress toward the next level', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
      {
        match: /\/api\/progress$/,
        body: {
          xp: 12_500,
          level: 2,
          progress: {
            level: 2,
            xpIntoLevel: 2_500,
            xpForThisLevel: 10_000,
            xpToNextLevel: 7_500,
            nextLevel: 3,
            ratio: 0.25,
          },
          nextRewardLevel: null,
          achievementsUnlocked: 1,
          itemsOwned: 5,
        },
      },
      { match: /\/api\/achievements$/, body: { achievements: [] } },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).toContain('Progress');
    expect(text).toContain('12500');
    // While the reward matrix is unapproved, the card says so plainly.
    expect(text).toContain('no item is granted yet');
  });

  it('does not duplicate the inventory’s item figures (Phase 6.8.3)', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
      {
        match: /\/api\/progress$/,
        body: {
          xp: 12_500,
          level: 2,
          progress: {
            level: 2,
            xpIntoLevel: 2_500,
            xpForThisLevel: 10_000,
            xpToNextLevel: 7_500,
            nextLevel: 3,
            ratio: 0.25,
          },
          nextRewardLevel: null,
          achievementsUnlocked: 1,
          itemsOwned: 5,
        },
      },
      { match: /\/api\/achievements$/, body: { achievements: [] } },
    ]);
    await bootProfile();

    // The profile owns level/XP/achievements; the item count lives on the
    // inventory page, so the two surfaces no longer show the same tiles.
    expect(APP().textContent).not.toContain('Items');
  });

  it('lists achievements with progress and an unlocked state', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
      {
        match: /\/api\/achievements$/,
        body: {
          achievements: [
            {
              achievement: {
                id: 'first-game',
                name: 'First round',
                description: 'Finish your first game.',
                condition: { kind: 'games-played', threshold: 1 },
                rewardItemId: null,
              },
              earned: true,
              unlockedAt: '2026-01-01T00:00:00.000Z',
              current: 1,
              threshold: 1,
              ratio: 1,
            },
            {
              achievement: {
                id: 'games-10',
                name: 'Regular',
                description: 'Finish 10 games.',
                condition: { kind: 'games-played', threshold: 10 },
                rewardItemId: null,
              },
              earned: false,
              unlockedAt: null,
              current: 4,
              threshold: 10,
              ratio: 0.4,
            },
          ],
        },
      },
    ]);
    await bootProfile();

    const text = APP().textContent ?? '';
    expect(text).toContain('First round');
    expect(text).toContain('Unlocked');
    expect(text).toContain('Regular');
    expect(text).toContain('4 / 10');
  });
});

/**
 * Phase 6.8.2 — the guest-round claim card.
 *
 * The card appears only when a claim proof is stored locally. It must ask the
 * server before offering the button, redeem once and then clear the stored proof.
 */
describe('profile guest-round claim (Phase 6.8.2)', () => {
  const CLAIM = { gameId: 'g1', playerId: 'seat1', token: 'tok', receivedAt: 0 };

  afterEach(() => {
    window.localStorage.clear();
  });

  it('offers the claim when the server says it is still redeemable', async () => {
    window.localStorage.setItem('zeropeek.guestClaim', JSON.stringify(CLAIM));
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
      { match: /\/api\/guest-claim\/status$/, method: 'POST', body: { claimable: true } },
    ]);
    await bootProfile();

    expect(APP().textContent).toContain('A finished round is waiting');
    // The button appears once the server's status answer arrives.
    await vi.waitFor(() => {
      if (!(APP().textContent ?? '').includes('Claim this round')) throw new Error('no button');
    });
  });

  it('does not offer the claim when the server says it is not redeemable', async () => {
    window.localStorage.setItem('zeropeek.guestClaim', JSON.stringify(CLAIM));
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
      { match: /\/api\/guest-claim\/status$/, method: 'POST', body: { claimable: false } },
    ]);
    await bootProfile();

    await vi.waitFor(() => {
      if ((APP().textContent ?? '').includes('A finished round is waiting')) {
        throw new Error('still shown');
      }
    });
    // A non-redeemable claim is forgotten so it is never offered again.
    expect(window.localStorage.getItem('zeropeek.guestClaim')).toBeNull();
  });

  it('redeems the claim with the CSRF token and then clears it', async () => {
    window.localStorage.setItem('zeropeek.guestClaim', JSON.stringify(CLAIM));
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
      { match: /\/api\/guest-claim\/status$/, method: 'POST', body: { claimable: true } },
      { match: /\/api\/guest-claim$/, method: 'POST', body: { claimed: true, grantedXp: 4_200 } },
    ]);
    await bootProfile();

    let claimButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      claimButton = Array.from(APP().querySelectorAll('button')).find(
        (node) => node.textContent === 'Claim this round',
      );
      if (!claimButton) throw new Error('no button');
    });
    claimButton!.click();

    await vi.waitFor(() => {
      if (window.localStorage.getItem('zeropeek.guestClaim') !== null)
        throw new Error('not cleared');
    });
    const redeem = calls.find((call) => /\/api\/guest-claim$/.test(call.url));
    expect(redeem?.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(redeem?.payload).toMatchObject({ gameId: 'g1', playerId: 'seat1', token: 'tok' });
  });

  it('shows no claim card when nothing is stored', async () => {
    window.localStorage.clear();
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/profile$/, body: EMPTY_PROFILE },
    ]);
    await bootProfile();

    expect(APP().textContent).not.toContain('A finished round is waiting');
  });
});
