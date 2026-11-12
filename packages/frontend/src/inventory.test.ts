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

const ITEM = {
  id: 'ethan_visor',
  name: 'Field visor',
  description: 'A sturdy visor.',
  characterId: 'ethan',
  slot: 'visor',
  assetPath: '/characters/ethan/visor.webp',
  alignment: 'not_aligned',
};

const INVENTORY = {
  characterId: 'ethan',
  items: [
    {
      item: ITEM,
      owned: true,
      source: 'level',
      equipped: true,
      unlockLevel: null,
      unlockHint: null,
    },
    {
      item: { ...ITEM, id: 'ethan_crown', name: 'Golden crown' },
      owned: false,
      source: null,
      equipped: false,
      unlockLevel: null,
      unlockHint: 'The unlock condition is not defined yet.',
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
  it('shows the active character’s items, owned and locked, with the equipped loadout', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/inventory$/, body: INVENTORY },
    ]);
    await bootInventory();

    const text = APP().textContent ?? '';
    expect(text).toContain('Field visor');
    expect(text).toContain('Golden crown');
    // The inventory owns the equipment view: the loadout card names the slots.
    expect(text).toContain('Equipped on');
    expect(text).toContain('Backpack');
    // It no longer repeats the profile's level/XP/achievements figures.
    expect(text).not.toContain('12500');
    expect(text).not.toContain('First round');
  });

  it('reads only the inventory endpoint, not progress or achievements (de-duplicated)', async () => {
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/inventory$/, body: INVENTORY },
    ]);
    await bootInventory();

    expect(calls.some((call) => /\/api\/inventory$/.test(call.url))).toBe(true);
    expect(calls.some((call) => /\/api\/progress$/.test(call.url))).toBe(false);
    expect(calls.some((call) => /\/api\/achievements$/.test(call.url))).toBe(false);
  });

  it('shows a locked item with the server hint and no equip control', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      { match: /\/api\/inventory$/, body: INVENTORY },
    ]);
    await bootInventory();

    const locked = APP().querySelector('.inventory__item--locked');
    expect(locked).not.toBeNull();
    expect(locked?.textContent).toContain('not defined yet');
    // A locked item offers no equip button at all.
    expect(locked?.querySelector('button')).toBeNull();
  });

  it('shows a locked item’s unlock level when the server defines one (Phase 6.8.4)', async () => {
    stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      {
        match: /\/api\/inventory$/,
        body: {
          characterId: 'ethan',
          items: [
            {
              item: ITEM,
              owned: false,
              source: null,
              equipped: false,
              unlockLevel: 2,
              unlockHint: 'Unlocks at level 2.',
            },
          ],
        },
      },
    ]);
    await bootInventory();

    const locked = APP().querySelector('.inventory__item--locked');
    expect(locked?.textContent).toContain('Unlocks at level 2');
    expect(locked?.querySelector('button')).toBeNull();
  });

  it('equips an owned item through the server with the CSRF token', async () => {
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      {
        match: /\/api\/inventory$/,
        body: {
          characterId: 'ethan',
          items: [
            {
              item: ITEM,
              owned: true,
              source: 'level',
              equipped: false,
              unlockLevel: null,
              unlockHint: null,
            },
          ],
        },
      },
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

  it('unequips a worn item through the server with the CSRF token (Phase 6.8.4)', async () => {
    const calls = stubFetch([
      { match: /\/api\/player-auth\/me$/, body: ME },
      {
        match: /\/api\/inventory$/,
        body: {
          characterId: 'ethan',
          items: [
            {
              item: ITEM,
              owned: true,
              source: 'level',
              equipped: true,
              unlockLevel: null,
              unlockHint: null,
            },
          ],
        },
      },
      {
        match: /\/api\/inventory\/unequip$/,
        method: 'POST',
        body: { characterId: 'ethan', equipment: {} },
      },
    ]);
    await bootInventory();

    // The loadout card offers Unequip for a filled slot.
    const unequip = Array.from(APP().querySelectorAll('button')).find(
      (node) => node.textContent === 'Unequip',
    );
    expect(unequip).toBeTruthy();
    unequip!.click();

    await vi.waitFor(() => {
      if (!calls.some((call) => /\/api\/inventory\/unequip$/.test(call.url)))
        throw new Error('no call');
    });
    const call = calls.find((candidate) => /\/api\/inventory\/unequip$/.test(candidate.url));
    expect(call?.headers['X-CSRF-Token']).toBe('csrf-token');
    expect(call?.payload).toEqual({ slot: 'visor' });
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
