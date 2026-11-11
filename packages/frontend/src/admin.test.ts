/**
 * Admin surface tests (Phase 6.5.1).
 *
 * These drive the real `pages/admin.ts` module in jsdom: the page boots, calls
 * the API and renders the user management screen. Only `fetch` is stubbed (the
 * network boundary); everything else – the DOM builder, the dialogs, the
 * validation – is the production code path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  body: unknown;
}

/** Install a fetch stub that records calls and answers from a route table. */
function stubFetch(
  routes: Array<{ match: RegExp; method?: string; status?: number; body: unknown }>,
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
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

const ADMIN_ME = {
  user: { id: 'a1', username: 'root', role: 'ADMIN' },
  csrfToken: 'csrf-token',
};

/** Boot the admin page fresh. */
async function bootAdmin(): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = '<div id="app"></div>';
  await import('./pages/admin.js');
  await vi.waitFor(() => {
    if (!document.getElementById('app')?.textContent?.trim()) throw new Error('not rendered');
  });
}

const APP = () => document.getElementById('app') as HTMLElement;

/** Find a button whose visible label matches. Dialogs mount on `document.body`. */
function buttonByLabel(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === label,
  );
}

/** The table row for one account. */
function rowFor(username: string): HTMLTableRowElement {
  const row = [...APP().querySelectorAll<HTMLTableRowElement>('tbody tr')].find((candidate) =>
    candidate.textContent?.includes(username),
  );
  if (!row) throw new Error(`no row for ${username}`);
  return row;
}

/** A button inside a given account's row. */
function rowButton(username: string, label: string): HTMLButtonElement {
  const node = [...rowFor(username).querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!node) throw new Error(`no ${label} button in ${username}'s row`);
  return node;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('admin page: account list', () => {
  it('lists accounts with role, status and a summary', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      {
        match: /\/api\/admin\/users$/,
        body: {
          users: [
            {
              id: 'a1',
              username: 'root',
              email: null,
              role: 'ADMIN',
              disabled: false,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 't1',
              username: 'trainer',
              email: 't@example.com',
              role: 'TRAINER',
              disabled: true,
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
      },
    ]);
    await bootAdmin();

    const text = APP().textContent ?? '';
    expect(text).toContain('root');
    expect(text).toContain('trainer');
    expect(text).toContain('Administrator');
    expect(text).toContain('Active');
    expect(text).toContain('Disabled');
    // The two users, one admin, one disabled.
    const stats = [...APP().querySelectorAll('.stat__value')].map((n) => n.textContent);
    expect(stats).toEqual(['2', '1', '1']);
    // The rows live inside a real table with its header, so the header row is
    // never separated from the body.
    const table = APP().querySelector('table');
    expect(table?.querySelector('thead')).not.toBeNull();
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('shows an empty state when there are no accounts', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      { match: /\/api\/admin\/users$/, body: { users: [] } },
    ]);
    await bootAdmin();

    expect(APP().textContent).toContain('No accounts yet');
  });

  it('shows an error state when the list cannot be loaded', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      {
        match: /\/api\/admin\/users$/,
        status: 500,
        body: { error: { code: 'internal', message: 'An unexpected error occurred.' } },
      },
    ]);
    await bootAdmin();

    expect(APP().textContent).toContain('could not be loaded');
  });

  it('does not let an admin change their own role', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      {
        match: /\/api\/admin\/users$/,
        body: {
          users: [
            {
              id: 'a1',
              username: 'root',
              email: null,
              role: 'ADMIN',
              disabled: false,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      },
    ]);
    await bootAdmin();

    const select = rowFor('root').querySelector<HTMLSelectElement>('select');
    expect(select?.disabled).toBe(true);
  });
});

describe('admin page: role change confirmation', () => {
  const users = [
    {
      id: 'a1',
      username: 'root',
      email: null,
      role: 'ADMIN',
      disabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't1',
      username: 'trainer',
      email: null,
      role: 'TRAINER',
      disabled: false,
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ];

  it('asks for confirmation and only then changes the role', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      { match: /\/api\/admin\/users$/, body: { users } },
      { match: /\/api\/admin\/users\/t1\/role$/, body: { ok: true } },
    ]);
    await bootAdmin();

    // The trainer row's selector, not the create form's.
    const trainerSelect = rowFor('trainer').querySelector<HTMLSelectElement>('select')!;
    trainerSelect.value = 'ADMIN';
    trainerSelect.dispatchEvent(new Event('change'));

    // A confirmation dialog appears and names the account and the change.
    const dialogText = document.querySelector('.dialog')?.textContent ?? '';
    expect(dialogText).toContain('trainer');
    expect(dialogText).toContain('Administrator');
    expect(calls.some((call) => /\/role$/.test(call.url))).toBe(false);

    // Cancelling must not send the request.
    buttonByLabel('Cancel')!.click();
    expect(calls.some((call) => /\/role$/.test(call.url))).toBe(false);

    // Confirming sends it.
    trainerSelect.value = 'ADMIN';
    trainerSelect.dispatchEvent(new Event('change'));
    buttonByLabel('Change role')!.click();
    await vi.waitFor(() => {
      expect(calls.some((call) => /\/api\/admin\/users\/t1\/role$/.test(call.url))).toBe(true);
    });
  });
});

describe('admin page: disable confirmation', () => {
  it('asks for confirmation before disabling an account', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      {
        match: /\/api\/admin\/users$/,
        body: {
          users: [
            {
              id: 'a1',
              username: 'root',
              email: null,
              role: 'ADMIN',
              disabled: false,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 't1',
              username: 'trainer',
              email: null,
              role: 'TRAINER',
              disabled: false,
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
      },
      { match: /\/api\/admin\/users\/t1\/disabled$/, body: { ok: true } },
    ]);
    await bootAdmin();

    // Root's own toggle is disabled, so target the trainer row explicitly.
    rowButton('trainer', 'Disable').click();
    const dialogText = document.querySelector('.dialog')?.textContent ?? '';
    expect(dialogText).toContain('trainer');
    expect(calls.some((call) => /\/disabled$/.test(call.url))).toBe(false);

    buttonByLabel('Disable account')!.click();
    await vi.waitFor(() => {
      expect(calls.some((call) => /\/api\/admin\/users\/t1\/disabled$/.test(call.url))).toBe(true);
    });
  });
});

describe('admin page: create user validation', () => {
  it('reports an invalid username and password on the field, without a request', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      { match: /\/api\/admin\/users$/, body: { users: [] } },
    ]);
    await bootAdmin();

    const inputs = [...APP().querySelectorAll<HTMLInputElement>('input')];
    const username = inputs[0]!;
    const password = inputs[1]!;
    username.value = 'ab'; // below the minimum
    password.value = 'short'; // below the minimum
    APP().querySelector('form')!.dispatchEvent(new Event('submit'));

    const errors = [...APP().querySelectorAll('.field__error')].map((n) => n.textContent);
    expect(errors.some((message) => message?.includes('display name'))).toBe(true);
    expect(errors.some((message) => message?.includes('password'))).toBe(true);
    // No POST was attempted.
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('creates a user when the fields are valid', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      { match: /\/api\/admin\/users$/, method: 'POST', body: { ok: true } },
      { match: /\/api\/admin\/users$/, body: { users: [] } },
    ]);
    await bootAdmin();

    const inputs = [...APP().querySelectorAll<HTMLInputElement>('input')];
    inputs[0]!.value = 'newbie';
    inputs[1]!.value = 'a-long-enough-password';
    APP().querySelector('form')!.dispatchEvent(new Event('submit'));

    await vi.waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true);
    });
    const post = calls.find((call) => call.method === 'POST')!;
    expect(post.url).toContain('/api/admin/users');
    expect(post.body).toEqual({
      username: 'newbie',
      password: 'a-long-enough-password',
      role: 'TRAINER',
    });
  });
});

describe('admin page: reset password', () => {
  it('validates the new password before sending it', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      {
        match: /\/api\/admin\/users$/,
        body: {
          users: [
            {
              id: 'a1',
              username: 'root',
              email: null,
              role: 'ADMIN',
              disabled: false,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 't1',
              username: 'trainer',
              email: null,
              role: 'TRAINER',
              disabled: false,
              createdAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
      },
      { match: /\/api\/admin\/users\/t1\/password$/, body: { ok: true } },
    ]);
    await bootAdmin();

    rowButton('trainer', 'Reset password').click();
    const input = document.querySelector<HTMLInputElement>('.dialog input[type="password"]')!;
    input.value = 'short';
    document.querySelector<HTMLFormElement>('.dialog form')!.dispatchEvent(new Event('submit'));
    expect(document.querySelector('.dialog .field__error')?.textContent).toContain('password');
    expect(calls.some((call) => /\/password$/.test(call.url))).toBe(false);

    input.value = 'a-long-enough-password';
    document.querySelector<HTMLFormElement>('.dialog form')!.dispatchEvent(new Event('submit'));
    await vi.waitFor(() => {
      expect(calls.some((call) => /\/api\/admin\/users\/t1\/password$/.test(call.url))).toBe(true);
    });
  });
});

describe('admin page: role display', () => {
  const users = [
    {
      id: 'a1',
      username: 'root',
      email: null,
      role: 'ADMIN',
      disabled: false,
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't1',
      username: 'trainer',
      email: null,
      role: 'TRAINER',
      disabled: false,
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'p1',
      username: 'player',
      email: 'p@example.com',
      role: 'PLAYER',
      disabled: false,
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-03T00:00:00.000Z',
    },
  ];

  async function boot(): Promise<void> {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      { match: /\/api\/admin\/users$/, body: { users } },
    ]);
    await bootAdmin();
  }

  it('labels each role correctly, PLAYER included', async () => {
    await boot();
    // Check the role chip, not the whole row: the row also contains the role
    // <select>, whose options list every role name.
    const chipText = (username: string) =>
      [...rowFor(username).querySelectorAll('.chip')].map((c) => c.textContent?.trim());
    expect(chipText('root')).toContain('Administrator');
    expect(chipText('trainer')).toContain('Trainer');
    // Regression: a real PLAYER must be labelled Player, never Trainer.
    expect(chipText('player')).toContain('Player');
    expect(chipText('player')).not.toContain('Trainer');
  });

  it('offers all three roles in every row selector', async () => {
    await boot();
    for (const username of ['root', 'trainer', 'player']) {
      const options = [...rowFor(username).querySelectorAll('option')].map((o) => o.value);
      expect(options).toEqual(['PLAYER', 'TRAINER', 'ADMIN']);
    }
    // The player row selects PLAYER, not TRAINER.
    const playerSelect = rowFor('player').querySelector<HTMLSelectElement>('select')!;
    expect(playerSelect.value).toBe('PLAYER');
  });
});

describe('admin page: e-mail confirmation', () => {
  const unconfirmed = {
    id: 'p1',
    username: 'player',
    email: 'p@example.com',
    role: 'PLAYER',
    disabled: false,
    emailVerifiedAt: null,
    createdAt: '2026-01-03T00:00:00.000Z',
  };
  const confirmed = {
    id: 'a1',
    username: 'root',
    email: 'root@example.com',
    role: 'ADMIN',
    disabled: false,
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('shows the verification status for every account', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      { match: /\/api\/admin\/users$/, body: { users: [confirmed, unconfirmed] } },
    ]);
    await bootAdmin();
    expect(rowFor('root').textContent).toContain('E-mail confirmed');
    expect(rowFor('player').textContent).toContain('E-mail unconfirmed');
  });

  it('shows the confirm action only for an unconfirmed account', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      { match: /\/api\/admin\/users$/, body: { users: [confirmed, unconfirmed] } },
    ]);
    await bootAdmin();
    expect(rowButton('player', 'Confirm e-mail')).toBeTruthy();
    // The confirmed admin row has no such button.
    const adminButtons = [...rowFor('root').querySelectorAll('button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(adminButtons).not.toContain('Confirm e-mail');
  });

  it('asks for confirmation and only then confirms', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      { match: /\/api\/admin\/users$/, body: { users: [unconfirmed] } },
      { match: /\/api\/admin\/users\/p1\/verified$/, body: { ok: true } },
    ]);
    await bootAdmin();

    rowButton('player', 'Confirm e-mail').click();
    expect(document.querySelector('.dialog')?.textContent).toContain('player');
    // Nothing is sent until the dialog is confirmed.
    expect(calls.some((call) => /\/verified$/.test(call.url))).toBe(false);

    // Click the dialog's own confirm button (the row button has the same label
    // and comes first in document order).
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find(
      (b) => b.textContent?.trim() === 'Confirm e-mail',
    )!;
    confirm.click();
    await vi.waitFor(() => {
      expect(calls.some((call) => /\/api\/admin\/users\/p1\/verified$/.test(call.url))).toBe(true);
    });
  });

  it('shows no confirm action for an account without an e-mail address', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: ADMIN_ME },
      {
        match: /\/api\/admin\/users$/,
        body: {
          users: [{ ...unconfirmed, email: null, emailVerifiedAt: null }],
        },
      },
    ]);
    await bootAdmin();
    expect(rowFor('player').textContent).toContain('No e-mail');
    const labels = [...rowFor('player').querySelectorAll('button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).not.toContain('Confirm e-mail');
  });
});
