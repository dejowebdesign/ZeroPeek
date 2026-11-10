/**
 * Auth surface tests (Phase 6.3).
 *
 * These drive the real `pages/auth.ts` module in jsdom: the page boots, calls
 * the API and renders one of the screens. Only `fetch` is stubbed (the network
 * boundary); everything else – the DOM builder, the starfield, the routing on
 * the URL hash – is the production code path.
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
function stubFetch(routes: Array<{ match: RegExp; status?: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const route = routes.find((candidate) => candidate.match.test(url));
    if (!route) return jsonResponse(404, { error: { code: 'not_found', message: 'nope' } });
    return jsonResponse(route.status ?? 200, route.body);
  });
  return calls;
}

/** Boot the auth page fresh, with the given URL hash. */
async function bootAuth(hash = ''): Promise<void> {
  vi.resetModules();
  window.location.hash = hash;
  document.body.innerHTML = '<div id="app"></div>';
  await import('./pages/auth.js');
  // Let the async boot() settle.
  await vi.waitFor(() => {
    if (!document.querySelector('#app')?.textContent?.trim()) throw new Error('not rendered');
  });
}

/**
 * Boot the auth page when the expected outcome is a **redirect**, not a render:
 * an already signed-in account is sent away before any screen is drawn, so there
 * is nothing in `#app` to wait for.
 */
async function bootAuthExpectingRedirect(): Promise<void> {
  vi.resetModules();
  window.location.hash = '';
  document.body.innerHTML = '<div id="app"></div>';
  await import('./pages/auth.js');
}

const APP = () => document.getElementById('app') as HTMLElement;

/** The real jsdom location, captured so a stubbed one can be restored. */
const realLocation = window.location;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  // A test may replace `window.location` to observe navigation; put the real one
  // back so the next test starts from a clean page.
  if (window.location !== realLocation) {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  }
  window.location.hash = '';
});

describe('auth page: sign in', () => {
  it('renders the sign in form and never forces registration', async () => {
    stubFetch([{ match: /\/api\/auth\/me$/, body: { user: null } }]);
    await bootAuth();

    const text = APP().textContent ?? '';
    expect(text).toContain('Sign in');
    // Two credential fields plus the calm-effects checkbox.
    expect(APP().querySelectorAll('input:not([type="checkbox"])')).toHaveLength(2);
    // A guest path is always offered and does not require an account.
    expect(text).toContain('Join a game instead');
    // The starfield is present and active (not calm) by default.
    const field = document.querySelector('.starfield');
    expect(field).not.toBeNull();
    expect(field?.className).not.toContain('starfield--calm');
  });

  it('shows the resend offer when the account is unconfirmed', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: { user: null } },
      {
        match: /\/api\/auth\/login$/,
        status: 403,
        body: { error: { code: 'email_unverified', message: 'Confirm your e-mail first.' } },
      },
    ]);
    await bootAuth();

    const username = APP().querySelectorAll('input')[0] as HTMLInputElement;
    const password = APP().querySelectorAll('input')[1] as HTMLInputElement;
    username.value = 'maya';
    password.value = 'a-long-enough-password';
    APP().querySelector('form')?.dispatchEvent(new Event('submit'));

    await vi.waitFor(() => {
      expect(APP().textContent).toContain('confirm your e-mail');
    });
  });

  it('sends a signed-in player to their profile, not the lobby (Finding 1)', async () => {
    // A player is signed in through `zp_player_session`, which `/api/auth/me`
    // does not read. The page must ask the player endpoint and route to the
    // profile so the sign-in actually lands the player on their account.
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, hash: '' },
    });
    stubFetch([
      { match: /\/api\/auth\/me$/, body: { user: null } },
      {
        match: /\/api\/player-auth\/me$/,
        body: { user: { id: 'p1', username: 'maya', role: 'PLAYER' } },
      },
    ]);
    await bootAuthExpectingRedirect();

    expect(assign).toHaveBeenCalledWith('./profile.html');
  });

  it('sends a signed-in host to the host console (staff path unchanged)', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, hash: '' },
    });
    stubFetch([
      {
        match: /\/api\/auth\/me$/,
        body: { user: { id: 'h1', username: 'coach', role: 'TRAINER' } },
      },
    ]);
    await bootAuthExpectingRedirect();

    expect(assign).toHaveBeenCalledWith('./host.html');
  });

  it('routes a player who signs in through the form to their profile (Finding 1)', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, hash: '' },
    });
    stubFetch([
      { match: /\/api\/auth\/me$/, body: { user: null } },
      { match: /\/api\/player-auth\/me$/, status: 401, body: { user: null } },
      {
        match: /\/api\/auth\/login$/,
        body: { user: { id: 'p1', username: 'maya', role: 'PLAYER' }, csrfToken: 't' },
      },
    ]);
    await bootAuth();

    const username = APP().querySelectorAll('input')[0] as HTMLInputElement;
    const password = APP().querySelectorAll('input')[1] as HTMLInputElement;
    username.value = 'maya';
    password.value = 'a-long-enough-password';
    APP().querySelector('form')?.dispatchEvent(new Event('submit'));

    await vi.waitFor(() => {
      expect(assign).toHaveBeenCalledWith('./profile.html');
    });
  });
});

describe('auth page: explicit intent beats the signed-in redirect (Phase 6.8.1)', () => {
  /**
   * Boot the auth page with a stubbed `location` and a given hash, when the
   * expected outcome is a **render** (the page must not redirect). Returns the
   * `assign` spy so a test can prove no navigation happened.
   */
  async function bootWithHash(hash: string): Promise<ReturnType<typeof vi.fn>> {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, hash },
    });
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    await import('./pages/auth.js');
    await vi.waitFor(() => {
      if (!document.querySelector('#app')?.textContent?.trim()) throw new Error('not rendered');
    });
    return assign;
  }

  it('shows the registration form on #register while a host is signed in', async () => {
    // The reported bug: a signed-in host on the same browser was redirected to
    // the host console, so the registration link never showed the form.
    stubFetch([
      {
        match: /\/api\/auth\/me$/,
        body: { user: { id: 'h1', username: 'coach', role: 'TRAINER' } },
      },
      { match: /\/api\/player-auth\/me$/, body: { user: null } },
    ]);
    const assign = await bootWithHash('#register');

    expect(APP().textContent).toContain('Create your account');
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows the sign-in form on #signin while a host is signed in', async () => {
    stubFetch([
      {
        match: /\/api\/auth\/me$/,
        body: { user: { id: 'h1', username: 'coach', role: 'TRAINER' } },
      },
      { match: /\/api\/player-auth\/me$/, body: { user: null } },
    ]);
    const assign = await bootWithHash('#signin');

    expect(APP().textContent).toContain('Sign in');
    expect(assign).not.toHaveBeenCalled();
  });

  it('still redirects a signed-in host when no explicit hash is given', async () => {
    // The convenience redirect for the plain page must be preserved.
    stubFetch([
      {
        match: /\/api\/auth\/me$/,
        body: { user: { id: 'h1', username: 'coach', role: 'TRAINER' } },
      },
    ]);
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, hash: '' },
    });
    await bootAuthExpectingRedirect();

    expect(assign).toHaveBeenCalledWith('./host.html');
  });

  it('lets a guest register while a host is signed in (POST reaches the server)', async () => {
    const calls = stubFetch([
      {
        match: /\/api\/auth\/me$/,
        body: { user: { id: 'h1', username: 'coach', role: 'TRAINER' } },
      },
      { match: /\/api\/player-auth\/me$/, body: { user: null } },
      { match: /\/api\/auth\/register$/, body: { ok: true, verificationSent: true } },
    ]);
    await bootWithHash('#register');

    const [username, email, password] = Array.from(APP().querySelectorAll('input'));
    (username as HTMLInputElement).value = 'Maya';
    (email as HTMLInputElement).value = 'maya@example.com';
    (password as HTMLInputElement).value = 'a-long-enough-password';
    APP().querySelector('form')?.dispatchEvent(new Event('submit'));

    await vi.waitFor(() => {
      expect(APP().textContent).toContain('Check your inbox');
    });
    expect(calls.some((call) => call.url.includes('/api/auth/register'))).toBe(true);
  });
});

describe('auth page: register', () => {
  it('renders the registration form on #register', async () => {
    stubFetch([{ match: /\/api\/auth\/me$/, body: { user: null } }]);
    await bootAuth('#register');

    const text = APP().textContent ?? '';
    expect(text).toContain('Create your account');
    expect(text).toContain('Optional');
    expect(APP().querySelectorAll('input:not([type="checkbox"])')).toHaveLength(3);
  });

  it('posts a registration and shows the confirmation notice', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: { user: null } },
      { match: /\/api\/auth\/register$/, body: { ok: true, verificationSent: true } },
    ]);
    await bootAuth('#register');

    const [username, email, password] = Array.from(APP().querySelectorAll('input'));
    (username as HTMLInputElement).value = 'Maya';
    (email as HTMLInputElement).value = 'maya@example.com';
    (password as HTMLInputElement).value = 'a-long-enough-password';
    APP().querySelector('form')?.dispatchEvent(new Event('submit'));

    await vi.waitFor(() => {
      expect(APP().textContent).toContain('Check your inbox');
    });
    const registerCall = calls.find((call) => call.url.includes('/api/auth/register'));
    expect(registerCall?.method).toBe('POST');
    expect(registerCall?.body).toMatchObject({ email: 'maya@example.com' });
  });

  it('shows a field error for a short password without calling the API', async () => {
    const calls = stubFetch([{ match: /\/api\/auth\/me$/, body: { user: null } }]);
    await bootAuth('#register');

    const [username, email, password] = Array.from(APP().querySelectorAll('input'));
    (username as HTMLInputElement).value = 'Maya';
    (email as HTMLInputElement).value = 'maya@example.com';
    (password as HTMLInputElement).value = 'short';
    APP().querySelector('form')?.dispatchEvent(new Event('submit'));

    await vi.waitFor(() => {
      expect(APP().textContent).toMatch(/at least 10 characters/i);
    });
    expect(calls.some((call) => call.url.includes('/api/auth/register'))).toBe(false);
  });
});

describe('auth page: verification result', () => {
  it('confirms an account from a #verify token', async () => {
    const calls = stubFetch([
      { match: /\/api\/auth\/me$/, body: { user: null } },
      { match: /\/api\/auth\/verify$/, body: { user: { id: 'u1' }, verified: true } },
    ]);
    await bootAuth('#verify=good-token');

    await vi.waitFor(() => {
      expect(APP().textContent).toContain('Account confirmed');
    });
    const verifyCall = calls.find((call) => call.url.includes('/api/auth/verify'));
    expect(verifyCall?.body).toEqual({ token: 'good-token' });
  });

  it('shows a failure view for a bad token', async () => {
    stubFetch([
      { match: /\/api\/auth\/me$/, body: { user: null } },
      {
        match: /\/api\/auth\/verify$/,
        status: 422,
        body: { error: { code: 'invalid', message: 'This confirmation link is invalid.' } },
      },
    ]);
    await bootAuth('#verify=bad-token');

    await vi.waitFor(() => {
      expect(APP().textContent).toContain('Link not valid');
    });
  });
});

describe('auth page: calm switch', () => {
  it('calms the starfield and remembers the choice', async () => {
    stubFetch([{ match: /\/api\/auth\/me$/, body: { user: null } }]);
    await bootAuth();

    const toggle = APP().querySelector<HTMLInputElement>('#calm');
    expect(toggle).not.toBeNull();
    toggle!.checked = true;
    toggle!.dispatchEvent(new Event('change'));

    expect(document.querySelector('.starfield')?.className).toContain('starfield--calm');
    expect(localStorage.getItem('zeropeek.calm')).toBe('1');
  });
});
