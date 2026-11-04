/**
 * Administration surface: user management (Module E).
 *
 * The page is guarded by the session cookie, exactly like the editor: it reads
 * `/api/auth/me` first, redirects non-administrators to the host page, and
 * bootstraps the CSRF token before any write. Everything here is rendered
 * through `el`, so no user data ever reaches `innerHTML`.
 *
 * The rules that protect an installation from locking itself out (the last
 * administrator cannot be disabled or demoted, an admin cannot demote
 * themselves) live on the server. The UI mirrors them by disabling the
 * corresponding control, but the server stays the authority.
 */

import { get, post, setCsrfToken, ApiError } from '../api.js';
import { el, render } from '../dom.js';
import { button, errorText, field, notice, pageHeader, toast } from '../ui.js';

type UserRole = 'ADMIN' | 'TRAINER';

interface User {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
}

interface MeResponse {
  user: { id: string; username: string; role: UserRole } | null;
  csrfToken?: string;
}

const appElement = document.getElementById('app');
if (!appElement) throw new Error('ZeroPeek: the #app element is missing.');
const app: HTMLElement = appElement;

/**
 * The admin dashboard is this page. The header logo links here from every admin
 * sub-page, so a click always returns to the start of the admin area.
 */
const ADMIN_HOME = './admin.html';

let me: MeResponse['user'] = null;

/** Load every user and repaint the table. */
async function refresh(list: HTMLElement): Promise<void> {
  const { users } = await get<{ users: User[] }>('/api/admin/users');
  list.replaceChildren(...users.map((user) => row(user, list)));
}

/**
 * One user row: identity, role selector, disable toggle and password reset.
 * `list` is repainted after each successful change so the table always shows
 * what the server actually stored.
 */
function row(user: User, list: HTMLElement): HTMLElement {
  const isSelf = user.id === me?.id;

  const roleSelect = el(
    'select',
    { class: 'input' },
    el(
      'option',
      { value: 'TRAINER', ...(user.role === 'TRAINER' ? { selected: true } : {}) },
      'Trainer',
    ),
    el(
      'option',
      { value: 'ADMIN', ...(user.role === 'ADMIN' ? { selected: true } : {}) },
      'Administrator',
    ),
  );
  roleSelect.disabled = isSelf;
  roleSelect.addEventListener('change', () => {
    void mutate(async () => {
      await post(`/api/admin/users/${user.id}/role`, { role: roleSelect.value as UserRole });
      await refresh(list);
    }, `Role updated for ${user.username}.`);
  });

  const toggle = el('input', {
    type: 'checkbox',
    ...(user.disabled ? { checked: true } : {}),
  });
  toggle.disabled = isSelf;
  toggle.addEventListener('change', () => {
    void mutate(
      async () => {
        await post(`/api/admin/users/${user.id}/disabled`, { disabled: toggle.checked });
        await refresh(list);
      },
      toggle.checked ? `${user.username} disabled.` : `${user.username} enabled.`,
    );
  });

  return el(
    'tr',
    null,
    el(
      'td',
      null,
      el('strong', null, user.username),
      isSelf ? el('span', { class: 'muted' }, ' (you)') : null,
      user.email ? el('div', { class: 'muted' }, user.email) : null,
    ),
    el('td', null, roleSelect),
    el('td', null, toggle),
    el(
      'td',
      null,
      button('Reset password', {
        onClick: () => resetPassword(user, list),
      }),
    ),
  );
}

/** Run a mutation, report the outcome, and refresh the table on success. */
async function mutate(action: () => Promise<void>, success: string): Promise<void> {
  try {
    await action();
    toast(success, 'success');
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

/** Ask for a new password in a modal and send it to the server. */
function resetPassword(user: User, list: HTMLElement): void {
  const password = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const dialog = el(
    'div',
    { class: 'overlay' },
    el(
      'form',
      {
        class: 'card overlay__panel',
        onsubmit: (event: Event) => {
          event.preventDefault();
          const value = password.value;
          if (!value) return;
          void mutate(async () => {
            await post(`/api/admin/users/${user.id}/password`, { password: value });
            dialog.remove();
            await refresh(list);
          }, `Password reset for ${user.username}.`);
        },
      },
      el('h2', null, `Reset password for ${user.username}`),
      field('New password', password),
      el(
        'div',
        { class: 'overlay__actions' },
        button('Cancel', { onClick: () => dialog.remove() }),
        button('Save', { type: 'submit', variant: 'primary' }),
      ),
    ),
  );
  document.body.append(dialog);
  password.focus();
}

/** The user management screen. */
async function showUsers(): Promise<void> {
  const list = el('tbody');
  const username = el('input', { class: 'input', autocomplete: 'off' });
  const password = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const roleSelect = el(
    'select',
    { class: 'input' },
    el('option', { value: 'TRAINER' }, 'Trainer'),
    el('option', { value: 'ADMIN' }, 'Administrator'),
  );
  const feedback = el('div');

  const createForm = el(
    'form',
    {
      class: 'card',
      onsubmit: (event: Event) => {
        event.preventDefault();
        feedback.replaceChildren();
        void mutate(async () => {
          await post('/api/admin/users', {
            username: username.value.trim(),
            password: password.value,
            role: roleSelect.value as UserRole,
          });
          username.value = '';
          password.value = '';
          await refresh(list);
        }, 'User created.');
      },
    },
    el('h2', { class: 'section-title' }, 'Add a user'),
    el(
      'div',
      { class: 'grid grid--3' },
      field('Username', username),
      field('Password', password),
      field('Role', roleSelect),
    ),
    feedback,
    button('Create user', { type: 'submit', variant: 'primary' }),
  );

  render(
    app,
    el(
      'section',
      { class: 'wrap' },
      pageHeader(
        'Users',
        [
          button('Host', { onClick: () => (location.href = './host.html') }),
          button('Editor', { onClick: () => (location.href = './editor.html') }),
        ],
        undefined,
        ADMIN_HOME,
      ),
      createForm,
      el('h2', { class: 'section-title' }, 'Accounts'),
      el(
        'table',
        { class: 'report-table' },
        el(
          'thead',
          null,
          el(
            'tr',
            null,
            el('th', null, 'User'),
            el('th', null, 'Role'),
            el('th', null, 'Disabled'),
            el('th', null, ''),
          ),
        ),
        list,
      ),
    ),
  );

  await refresh(list);
}

/** Bootstrap: require a session, require the ADMIN role, then load the page. */
void (async () => {
  try {
    const session = await get<MeResponse>('/api/auth/me');
    if (!session.user) {
      location.href = './host.html';
      return;
    }
    if (session.csrfToken) setCsrfToken(session.csrfToken);
    me = session.user;
    if (me.role !== 'ADMIN') {
      render(app, notice('This page requires an administrator account.', 'error'));
      return;
    }
    await showUsers();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      location.href = './host.html';
      return;
    }
    toast(errorText(error), 'error');
  }
})();
