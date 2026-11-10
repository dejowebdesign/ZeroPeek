/**
 * Inventory page tests (Phase 6.8).
 *
 * These drive the real `pages/inventory.ts` module in jsdom: the page boots,
 * calls `/api/player-auth/me` and then `/api/inventory`, `/api/progress` and
 * `/api/achievements`, and renders. Only `fetch` is stubbed (the network
 * boundary); the DOM builder and the UI components are the production path.
 *
 * The page must stay server-authoritative: it shows the level and XP the server
 * sent, disables the control for a locked item, and equips through
 * `POST /api/inventory/equip` with the CSRF token.
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
  headers: Record<string, string>;
  payload?: unknown;
}

interface Route {
  match: RegExp;
  method?: string;
  status?: number;
  body: unknown | ((payload?: unknown) => unknown);
}

/** Install a fetch stub that records calls and answers from a route table. */
function stubFetch(routes: Route[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const payload = init.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, method, headers: (init.headers as Record<string, string>) ?? {}, payload });
    const route = routes.find(
      (candidate) =>
        candidate.match.test(url) &&
        (candidate.method === undefined || candidate.method === method),
    );
    if (!route) return jsonResponse(404, { error: { code: 'not_found', message: 'nope' } });
    const body =
      typeof route.body === 'function'
        ? (route.body as (payload?: unknown) => unknown)(payload)
        : route.body;
    return jsonResponse(route.status ?? 200, body);
  });
  return calls;
}

const ME = { user: { id: 'p1', username: 'alice', role: 'PLAYER' }, csrfToken: 'csrf-token' };

const PROGRESS = {
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
};

const ITEM = {
  id: 'ethan_visor',
  name: 'Field visor',
  description: 'A sturdy visor.',
  characterId: 'ethan',
  slot: 'visor',
  assetPath: '/characters/ethan/visor.webp',
  unlockStatus: 'available',
  alignment: 'not_aligned',
};

const INVENTORY = {
  characterId: 'ethan',
  items: [
    { item: ITEM, owned: true, source: 'default', equipped: false, unlockHint: null },
    {
      item: { ...ITEM, id: 'ethan_crown', name: 'Golden crown' },
      owned: false,
      source: null,
      equipped: false,
      unlockHint: 'The unlock condition is not defined yet.',
    },
  ],
};

const ACHIEVEMENTS = {
  achievements: [
    {
      achievement: {
        id: 'first-game',
        name: 'First round',
        description: 'Finish your first game.',
        condition: { kind: 'games-played', threshold: 1 },
        rewardItemId: null,
      },
      earned: false,
      unlockedAt: null,
      current: 0,
      threshold: 1,
      ratio: 0,
    },
  ],
};

/** Boot the inventory page fresh. */
async function bootInventory(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  await import('./pages/inventory.js');
  await vi.waitFor(() => {
    if (!document.getElementById('app')?.textContent?.trim()) throw new Error('not rendered');
  });
}

const APP = () => document.getElementById('app') as HTMLElement;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('inventory page', () => {
  it('shows the server level and XP, the items and the achievements', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/inventory$/, body: INVENTORY },
      { match: /\/api\/progress$/, body: PROGRESS },
      { match: /\/api\/achievements$/, body: ACHIEVEMENTS },
    ]);
    await bootInventory();

    const text = APP().textContent ?? '';
    expect(text).toContain('12500');
    expect(text).toContain('Field visor');
    expect(text).toContain('Golden crown');
    expect(text).toContain('First round');
  });

  it('shows a locked item with the server hint and no equip control', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/inventory$/, body: INVENTORY },
      { match: /\/api\/progress$/, body: PROGRESS },
      { match: /\/api\/achievements$/, body: ACHIEVEMENTS },
    ]);
    await bootInventory();

    const locked = APP().querySelector('.inventory__item--locked');
    expect(locked).not.toBeNull();
    expect(locked?.textContent).toContain('not defined yet');
    // A locked item offers no equip button at all.
    expect(locked?.querySelector('button')).toBeNull();
  });

  it('equips an owned item through the server with the CSRF token', async () => {
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/inventory$/, body: INVENTORY },
      { match: /\/api\/progress$/, body: PROGRESS },
      { match: /\/api\/achievements$/, body: ACHIEVEMENTS },
      {
        match: /\/api\/inventory\/equip$/,
        method: 'POST',
        body: { characterId: 'ethan', equipment: {} },
      },
    ]);
    await bootInventory();

    const equip = Array.from(APP().querySelectorAll('button')).find(
      (node) => node.textContent === 'Equip',
    );
    expect(equip).toBeTruthy();
    equip!.click();

    await vi.waitFor(() => {
      if (!calls.some((call) => /\/api\/inventory\/equip$/.test(call.url)))
        throw new Error('no call');
    });
    const call = calls.find((candidate) => /\/api\/inventory\/equip$/.test(candidate.url));
    expect(call?.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(call?.payload).toEqual({ itemId: 'ethan_visor' });
  });

  it('invites a signed-out player to sign in and reads no inventory', async () => {
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, status: 401, body: { user: null } },
    ]);
    await bootInventory();

    expect(APP().textContent).toContain('Player sign-in');
    expect(calls.some((call) => /\/api\/inventory$/.test(call.url))).toBe(false);
  });
});
