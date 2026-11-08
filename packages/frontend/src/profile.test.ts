/**
 * Player profile page tests (Phase 6.6).
 *
 * These drive the real `pages/profile.ts` module in jsdom: the page boots, calls
 * `/api/auth/me` and `/api/profile`, and renders the profile. Only `fetch` is
 * stubbed (the network boundary); the DOM builder and the UI components are the
 * production code path.
 */

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
}

/** Install a fetch stub that records calls and answers from a route table. */
function stubFetch(
  routes: Array<{ match: RegExp; method?: string; status?: number; body: unknown }>,
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method });
    const route = routes.find(
      (candidate) =>
        candidate.match.test(url) &&
        (candidate.method === undefined || candidate.method === method),
    );
    if (!route) return jsonResponse(404, { error: { code: 'not_found', message: 'nope' } });
    return jsonResponse(route.status ?? 200, route.body);
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
    expect(text).toContain('ethan');
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
