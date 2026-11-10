/**
 * Auth surface: sign in, register and confirm an e-mail (Phase 6.3).
 *
 * A single, standalone page (auth.html) over the animated starfield. It offers
 * the *optional* player registration next to the ordinary sign in; it never
 * blocks joining a game as a guest, which lives on the player surface.
 *
 * The forms are built through `el`, so dynamic text is always `textContent` and
 * the page stays compatible with the strict CSP. Validation runs twice: the
 * shared rules give inline feedback here, and the server validates again on
 * every write (the browser is never trusted).
 */

import {
  PASSWORD_MIN_LENGTH,
  passwordStrength,
  validateRegistration,
  type ValidationIssue,
} from '@zeropeek/shared';

import { ApiError, get, post, setCsrfToken } from '../api.js';
import { el, render } from '../dom.js';
import { isCalm, setCalm, starfield } from '../starfield.js';
import { brand, button, errorText, field, notice, setBusy } from '../ui.js';

const appElement = document.getElementById('app');
if (!appElement) throw new Error('ZeroPeek: the #app element is missing.');
const app: HTMLElement = appElement;

interface SessionUser {
  id: string;
  username: string;
  role: string;
}

/** Where a signed-in account lands, by role. */
function homeFor(role: string): string {
  // Staff land on the host console; a player lands on their own profile, which
  // is the page that reads the player session (Phase 6.6.3). The lobby stays one
  // click away from the profile, so a player can still join a game.
  return role === 'ADMIN' || role === 'TRAINER' ? './host.html' : './profile.html';
}

/** The calm-effects switch, shared by every auth screen. */
function calmToggle(): HTMLElement {
  const input = el('input', { type: 'checkbox', id: 'calm' });
  input.checked = isCalm();
  input.addEventListener('change', () => {
    setCalm(input.checked);
    // Swap the field in place instead of re-rendering, so any text the user has
    // already typed into the form is preserved.
    const current = document.querySelector('.starfield');
    if (current) current.replaceWith(starfield());
  });
  return el(
    'label',
    { class: 'auth__note', for: 'calm' },
    input,
    el('span', null, 'Calm the star effects'),
  );
}

/** The outer frame: starfield + a single glass card. */
function authFrame(card: HTMLElement, opts: { wide?: boolean } = {}): HTMLElement {
  return el(
    'div',
    { class: 'auth' },
    starfield(),
    el('div', { class: `auth__card${opts.wide ? ' auth__card--wide' : ''}` }, card),
  );
}

/** Field-level error lookup from a validation issue list. */
function issueFor(issues: ValidationIssue[], path: string): string | undefined {
  return issues.find((issue) => issue.path === path)?.message;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/** Sign in with an existing account. */
function showSignIn(message?: string): void {
  const username = el('input', { class: 'input', autocomplete: 'username' });
  const password = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'current-password',
  });
  const feedback = el('div');
  const submit = button('Sign in', {
    variant: 'primary',
    type: 'submit',
  });

  const form = el(
    'form',
    {
      class: 'auth__form',
      onsubmit: async (event: Event) => {
        event.preventDefault();
        feedback.replaceChildren();
        setBusy(submit, true);
        try {
          const result = await post<{ user: SessionUser; csrfToken?: string }>('/api/auth/login', {
            username: username.value.trim(),
            password: password.value,
          });
          if (result.csrfToken) setCsrfToken(result.csrfToken);
          location.assign(homeFor(result.user.role));
        } catch (error) {
          if (error instanceof ApiError && error.code === 'email_unverified') {
            feedback.replaceChildren(unverifiedNotice(username.value.trim()));
          } else {
            feedback.replaceChildren(notice(errorText(error), 'error'));
          }
        } finally {
          setBusy(submit, false);
        }
      },
    },
    field('Username', username),
    field('Password', password),
    message ? notice(message, 'info') : null,
    feedback,
    el('div', { class: 'auth__actions' }, submit),
  );

  renderRoot(
    authFrame(
      el(
        'div',
        null,
        brand(),
        el(
          'div',
          { class: 'auth__tabs', role: 'tablist' },
          tab('Sign in', true),
          tab('Register', false),
        ),
        el('h1', { class: 'auth__title' }, 'Sign in'),
        el('p', { class: 'auth__subtitle muted' }, 'Host a game or continue your progress.'),
        form,
        el(
          'div',
          { class: 'auth__alt' },
          el('span', { class: 'muted' }, 'Just here to play?'),
          linkButton('Join a game instead', () => location.assign('./')),
        ),
        calmToggle(),
      ),
    ),
  );
  username.focus();
}

/** A one-line "confirm your e-mail" notice with a resend action. */
function unverifiedNotice(email: string): HTMLElement {
  const resend = linkButton('Resend the link', async () => {
    try {
      await post('/api/auth/resend', { email });
      resend.replaceWith(notice('If that account exists, a new link is on its way.', 'success'));
    } catch (error) {
      resend.replaceWith(notice(errorText(error), 'error'));
    }
  });
  return el(
    'div',
    null,
    notice('Please confirm your e-mail address before signing in.', 'error'),
    el('p', { class: 'auth__note' }, resend),
  );
}

/** Register a new player account. */
function showRegister(): void {
  const username = el('input', { class: 'input', autocomplete: 'username' });
  const email = el('input', { class: 'input', type: 'email', autocomplete: 'email' });
  const password = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'new-password',
  });

  const strengthBars = [0, 1, 2, 3].map(() => el('span', { class: 'auth__strength-bar' }));
  const strength = el('div', { class: 'auth__strength', 'aria-hidden': 'true' }, ...strengthBars);
  password.addEventListener('input', () => {
    const score = passwordStrength(password.value);
    strengthBars.forEach((bar, index) =>
      bar.classList.toggle('auth__strength-bar--on', index < score),
    );
  });

  const feedback = el('div');
  const submit = button('Create account', { variant: 'primary', type: 'submit' });

  const form = el(
    'form',
    {
      class: 'auth__form',
      onsubmit: async (event: Event) => {
        event.preventDefault();
        feedback.replaceChildren();

        // Client-side check for fast feedback; the server checks again.
        const issues = validateRegistration({
          username: username.value,
          email: email.value,
          password: password.value,
        });
        if (issues.length > 0) {
          feedback.replaceChildren(notice(issues[0]!.message, 'error'));
          return;
        }

        setBusy(submit, true);
        try {
          const result = await post<{ verificationSent: boolean }>('/api/auth/register', {
            username: username.value.trim(),
            email: email.value.trim(),
            password: password.value,
          });
          showRegistered(email.value.trim(), result.verificationSent);
        } catch (error) {
          if (error instanceof ApiError && error.issues?.length) {
            feedback.replaceChildren(notice(error.issues[0]!.message, 'error'));
          } else {
            feedback.replaceChildren(notice(errorText(error), 'error'));
          }
        } finally {
          setBusy(submit, false);
        }
      },
    },
    field('Display name', username, 'This is the name other players see.'),
    field('E-mail', email, 'We send one confirmation link to this address.'),
    field('Password', password, `At least ${PASSWORD_MIN_LENGTH} characters.`),
    strength,
    feedback,
    el('div', { class: 'auth__actions' }, submit),
  );

  renderRoot(
    authFrame(
      el(
        'div',
        null,
        brand(),
        el(
          'div',
          { class: 'auth__tabs', role: 'tablist' },
          tab('Sign in', false),
          tab('Register', true),
        ),
        el('h1', { class: 'auth__title' }, 'Create your account'),
        el(
          'p',
          { class: 'auth__subtitle muted' },
          'Optional. Keep your progress, avatar and history across games.',
        ),
        // Phase 6.8.1: a player account is a separate identity from a host
        // sign-in, so this always holds and reassures a host registering a
        // player account in the same browser.
        el(
          'p',
          { class: 'auth__note' },
          'This player account is separate from any host sign-in in this browser. Both can be active at the same time.',
        ),
        form,
        el(
          'div',
          { class: 'auth__alt' },
          el('span', { class: 'muted' }, 'Already have an account?'),
          linkButton('Sign in', () => showSignIn()),
        ),
        calmToggle(),
      ),
    ),
  );
  username.focus();
}

/** After a successful registration: tell the user to confirm their e-mail. */
function showRegistered(email: string, mailSent: boolean): void {
  renderRoot(
    authFrame(
      el(
        'div',
        null,
        brand(),
        el('div', { class: 'auth__icon auth__icon--ok' }, '✉'),
        el('h1', { class: 'auth__title' }, 'Check your inbox'),
        el(
          'p',
          { class: 'auth__subtitle muted' },
          mailSent
            ? `We sent a confirmation link to ${email}. Open it to activate your account.`
            : `Your account was created, but the confirmation e-mail could not be sent yet. Ask an administrator to enable mail, then request a new link.`,
        ),
        el(
          'div',
          { class: 'auth__actions' },
          button('Back to sign in', { variant: 'secondary', onClick: () => showSignIn() }),
        ),
        el(
          'div',
          { class: 'auth__alt' },
          el('span', { class: 'muted' }, 'Nothing arrived?'),
          linkButton('Send it again', async () => {
            await post('/api/auth/resend', { email }).catch(() => undefined);
            showSignIn('If that account exists, a new link is on its way.');
          }),
        ),
        calmToggle(),
      ),
    ),
  );
}

/** Confirm an address from `#verify=<token>`. */
async function showVerify(token: string): Promise<void> {
  renderRoot(
    authFrame(el('div', null, brand(), el('p', { class: 'muted' }, 'Confirming your account…'))),
  );

  try {
    await post('/api/auth/verify', { token });
    renderRoot(
      authFrame(
        el(
          'div',
          null,
          brand(),
          el('div', { class: 'auth__icon auth__icon--ok' }, '✓'),
          el('h1', { class: 'auth__title' }, 'Account confirmed'),
          el('p', { class: 'auth__subtitle muted' }, 'You can sign in now.'),
          el(
            'div',
            { class: 'auth__actions' },
            button('Sign in', { variant: 'primary', onClick: () => showSignIn() }),
          ),
          calmToggle(),
        ),
      ),
    );
  } catch (error) {
    renderRoot(
      authFrame(
        el(
          'div',
          null,
          brand(),
          el('div', { class: 'auth__icon auth__icon--warn' }, '!'),
          el('h1', { class: 'auth__title' }, 'Link not valid'),
          el('p', { class: 'auth__subtitle muted' }, errorText(error)),
          el(
            'div',
            { class: 'auth__actions' },
            button('Back to sign in', { variant: 'secondary', onClick: () => showSignIn() }),
          ),
          calmToggle(),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A tab control. Clicking one switches to that screen. */
function tab(label: string, active: boolean): HTMLElement {
  return el(
    'button',
    {
      class: 'auth__tab',
      type: 'button',
      role: 'tab',
      'aria-selected': active ? 'true' : 'false',
      onclick: () => (label === 'Register' ? showRegister() : showSignIn()),
    },
    label,
  );
}

/** A link-styled button (renders as a real button, not an anchor). */
function linkButton(label: string, onClick: () => void): HTMLButtonElement {
  return el('button', { class: 'auth__link', type: 'button', onclick: onClick }, label);
}

/** Render the frame into the page. */
function renderRoot(node: Node): void {
  render(app, node);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Boot: honour an explicit intent first, then a signed-in session, else show
 * the sign in.
 *
 * **Explicit intent beats the convenience redirect (Phase 6.8.1).** A `#verify=`
 * link, `#register` or `#signin` is a deliberate request, so it is served even
 * when a host is already signed in — otherwise the registration link on the
 * player surface would bounce a signed-in host to the host console and the form
 * could never be reached in the same browser. A plain page load (no hash) keeps
 * the old behaviour: a signed-in account is sent to its home.
 */
async function boot(): Promise<void> {
  const hash = location.hash;
  const verifyMatch = /^#verify=(.+)$/.exec(hash);
  if (verifyMatch) {
    await showVerify(decodeURIComponent(verifyMatch[1]!));
    return;
  }

  // An explicit request for a specific screen is served regardless of any
  // existing session. `#register`/`#signin` are the two the UI links to.
  const wantsRegister = hash === '#register';
  const wantsSignIn = hash === '#signin';

  if (!wantsRegister && !wantsSignIn) {
    try {
      const me = await get<{ user: SessionUser | null }>('/api/auth/me');
      if (me.user) {
        location.assign(homeFor(me.user.role));
        return;
      }
    } catch {
      // No host session: check the player context before showing the sign-in.
    }

    // A player is signed in through `zp_player_session`, which `/api/auth/me`
    // does not read (Phase 6.6.3). Ask the player endpoint too, so an already
    // signed-in player is sent to their profile instead of being shown the form
    // again.
    try {
      const player = await get<{ user: SessionUser | null }>('/api/player-auth/me');
      if (player.user) {
        location.assign(homeFor(player.user.role));
        return;
      }
    } catch {
      // No player session either: fall through to the sign-in form.
    }
  }

  if (wantsRegister) showRegister();
  else showSignIn();
}

void boot();
