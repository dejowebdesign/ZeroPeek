/**
 * Administration surface: user management (Module E).
 *
 * The page is guarded by the session cookie, exactly like the editor: it reads
 * `/api/auth/me` first, redirects non-administrators to the host page, and
 * bootstraps the CSRF token before any write. Everything here is rendered
 * through `el`, so no user data ever reaches `innerHTML`.
 *
 * The rules that protect an installation from locking itself out (the last
 * administrator cannot be disabled or demoted, an admin cannot demote or
 * disable themselves) live on the server. The UI mirrors them by disabling the
 * corresponding control, but the server stays the authority.
 */

import {
  PASSWORD_MIN_LENGTH,
  USERNAME_MIN_LENGTH,
  validatePassword,
  validateUsername,
  type ValidationIssue,
} from '@zeropeek/shared';

import { get, post, setCsrfToken, ApiError } from '../api.js';
import { el, render } from '../dom.js';
import { appShell } from '../navigation.js';
import {
  button,
  chip,
  confirmDialog,
  dialog,
  emptyState,
  errorText,
  field,
  notice,
  setBusy,
  skeleton,
  statTile,
  toast,
} from '../ui.js';

type UserRole = 'ADMIN' | 'TRAINER' | 'PLAYER';

interface User {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  disabled: boolean;
  /** When the e-mail was confirmed; `null` means not yet confirmed. */
  emailVerifiedAt: string | null;
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

/** Where a signed-out or expired session is sent (the host login). */
const LOGIN_URL = './host.html';

let me: MeResponse['user'] = null;

/** The nodes a repaint updates. Kept together so `refresh` needs no arguments. */
interface AdminView {
  /** Holds either the account table or a state (loading, empty, error). */
  listWrap: HTMLElement;
  /** The table itself, re-attached to `listWrap` when there are rows. */
  table: HTMLTableElement;
  tbody: HTMLElement;
  summary: HTMLElement;
}

function roleLabel(role: UserRole): string {
  if (role === 'ADMIN') return 'Administrator';
  if (role === 'TRAINER') return 'Trainer';
  return 'Player';
}

/**
 * Send the user to the login page when the session is gone, so an expired
 * cookie does not leave a dead admin page behind. Returns `true` when it did.
 */
function handleAuthError(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) {
    location.href = LOGIN_URL;
    return true;
  }
  return false;
}

/** Load every user and repaint the summary and the table. */
async function refresh(view: AdminView): Promise<void> {
  try {
    const { users } = await get<{ users: User[] }>('/api/admin/users');
    paint(users, view);
  } catch (error) {
    if (handleAuthError(error)) return;
    // The list could not be loaded: replace it with a clear message rather than
    // leaving an empty box that looks like "no users".
    view.listWrap.replaceChildren(
      notice(`The user list could not be loaded. ${errorText(error)}`, 'error'),
    );
  }
}

/** Render the summary tiles and the account table (or the empty state). */
function paint(users: User[], view: AdminView): void {
  const admins = users.filter((user) => user.role === 'ADMIN').length;
  const disabled = users.filter((user) => user.disabled).length;
  view.summary.replaceChildren(
    statTile(String(users.length), users.length === 1 ? 'account' : 'accounts'),
    statTile(String(admins), admins === 1 ? 'administrator' : 'administrators'),
    statTile(String(disabled), 'disabled'),
  );

  if (users.length === 0) {
    view.listWrap.replaceChildren(
      emptyState(
        'No accounts yet',
        'Use "Add a user" above to create the first trainer or administrator account.',
      ),
    );
    return;
  }

  view.listWrap.replaceChildren(view.table);
  view.tbody.replaceChildren(...users.map((user) => row(user, view)));
}

/**
 * One user row: identity, role selector, status and the account actions.
 * `view` is repainted after each successful change so the table always shows
 * what the server actually stored.
 */
function row(user: User, view: AdminView): HTMLElement {
  const isSelf = user.id === me?.id;

  const roleSelect = el(
    'select',
    { class: 'input' },
    el(
      'option',
      { value: 'PLAYER', ...(user.role === 'PLAYER' ? { selected: true } : {}) },
      'Player',
    ),
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
    const nextRole = roleSelect.value as UserRole;
    if (nextRole === user.role) return;
    changeRole(user, nextRole, roleSelect, view);
  });

  const toggle = button(user.disabled ? 'Enable' : 'Disable', {
    small: true,
    variant: user.disabled ? 'secondary' : 'ghost',
    // An admin cannot disable their own account; the server enforces it, and the
    // control is disabled here so the rule is visible rather than surprising.
    disabled: isSelf,
    onClick: () => {
      if (user.disabled) {
        // Re-enabling is not destructive; act directly and report the outcome.
        void mutate(
          async () => {
            await post(`/api/admin/users/${user.id}/disabled`, { disabled: false });
          },
          `${user.username} enabled.`,
          view,
        );
        return;
      }
      confirmDialog({
        title: 'Disable this account?',
        body: `${user.username} will no longer be able to sign in. Existing sessions are ended immediately. This can be reversed at any time.`,
        confirmLabel: 'Disable account',
        onConfirm: () => {
          void mutate(
            async () => {
              await post(`/api/admin/users/${user.id}/disabled`, { disabled: true });
            },
            `${user.username} disabled.`,
            view,
          );
        },
      });
    },
  });

  return el(
    'tr',
    null,
    el(
      'td',
      { 'data-label': 'User' },
      el('strong', null, user.username),
      isSelf ? el('span', { class: 'muted' }, ' (you)') : null,
      user.email ? el('div', { class: 'muted' }, user.email) : null,
    ),
    el(
      'td',
      { 'data-label': 'Role' },
      el(
        'div',
        { class: 'admin__cell' },
        roleSelect,
        chip(roleLabel(user.role), user.role === 'ADMIN' ? 'accent' : 'cyan'),
      ),
    ),
    el(
      'td',
      { 'data-label': 'Status' },
      el(
        'div',
        { class: 'admin__cell' },
        chip(user.disabled ? 'Disabled' : 'Active', user.disabled ? 'bad' : 'ok', true),
        emailStatusChip(user),
      ),
    ),
    el(
      'td',
      { 'data-label': 'Actions' },
      el(
        'div',
        { class: 'admin__actions' },
        toggle,
        verifyButton(user, view),
        button('Reset password', { small: true, onClick: () => resetPassword(user) }),
      ),
    ),
  );
}

/**
 * The e-mail confirmation state of an account. An account without an address
 * cannot be confirmed, and a confirmed one has nothing left to do, so both are
 * shown as plain facts; only an unconfirmed address is a call to action.
 */
function emailStatusChip(user: User): HTMLElement {
  if (!user.email) return chip('No e-mail', 'muted');
  if (user.emailVerifiedAt) return chip('E-mail confirmed', 'ok', true);
  return chip('E-mail unconfirmed', 'warn', true);
}

/**
 * The "Confirm e-mail" action, shown only for an account that has an address
 * that is not confirmed yet. Confirming an already-confirmed account would be a
 * no-op, so the control is simply absent. The server enforces the same rule.
 */
function verifyButton(user: User, view: AdminView): HTMLElement | null {
  if (!user.email || user.emailVerifiedAt) return null;
  return button('Confirm e-mail', {
    small: true,
    variant: 'secondary',
    onClick: () => {
      confirmDialog({
        title: 'Confirm this e-mail?',
        body: `${user.username} (${user.email}) will be marked as confirmed and can sign in immediately. This is meant for accounts whose confirmation e-mail could not be delivered. The password, role, sessions and game data are not touched.`,
        confirmLabel: 'Confirm e-mail',
        onConfirm: () => {
          void mutate(
            async () => {
              await post(`/api/admin/users/${user.id}/verified`, {});
            },
            `E-mail confirmed for ${user.username}.`,
            view,
          );
        },
      });
    },
  });
}

/** Run a mutation, report the outcome, and repaint from the server on the way out. */
async function mutate(
  action: () => Promise<void>,
  success: string,
  view: AdminView,
): Promise<void> {
  try {
    await action();
    toast(success, 'success');
  } catch (error) {
    if (handleAuthError(error)) return;
    toast(errorText(error), 'error');
  } finally {
    // Repaint from the server either way, so a failed write cannot leave the
    // row showing a state the server never stored.
    await refresh(view);
  }
}

/**
 * Confirm and apply a role change. The confirmation names the account, the old
 * and the new role, and warns that permissions change; a single stray click
 * therefore cannot re-role someone.
 */
function changeRole(
  user: User,
  nextRole: UserRole,
  select: HTMLSelectElement,
  view: AdminView,
): void {
  let confirmed = false;
  const { close } = dialog({
    title: 'Change role?',
    body: el(
      'div',
      null,
      el('p', null, `${user.username}: ${roleLabel(user.role)} -> ${roleLabel(nextRole)}`),
      el(
        'p',
        { class: 'muted' },
        nextRole === 'ADMIN'
          ? 'This account gains full administrative rights, including user management.'
          : nextRole === 'TRAINER'
            ? 'This account gains the host areas (quizzes and games) but no administrative rights.'
            : 'This account loses all staff access and becomes a player. It can only join games.',
      ),
    ),
    actions: [
      button('Cancel', { variant: 'ghost', onClick: () => close() }),
      button('Change role', {
        variant: 'primary',
        onClick: () => {
          confirmed = true;
          close();
          void mutate(
            async () => {
              await post(`/api/admin/users/${user.id}/role`, { role: nextRole });
            },
            `Role updated for ${user.username}.`,
            view,
          );
        },
      }),
    ],
    // Dismissed without confirming (Esc or backdrop): put the selector back.
    onClose: () => {
      if (!confirmed) select.value = user.role;
    },
  });
}

/** Ask for a new password in a modal and send it to the server. */
function resetPassword(user: User): void {
  const password = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'new-password',
  });
  const error = el('span', { class: 'field__error' });
  const node = field('New password', password, `At least ${PASSWORD_MIN_LENGTH} characters.`);
  node.append(error);
  const form = el('form', null, node);
  const submit = button('Save', {
    variant: 'primary',
    onClick: () => form.requestSubmit(),
  });
  const { close } = dialog({
    title: `Reset password for ${user.username}`,
    body: form,
    actions: [button('Cancel', { variant: 'ghost', onClick: () => close() }), submit],
  });
  form.addEventListener('submit', (event: Event) => {
    event.preventDefault();
    error.textContent = '';
    const value = password.value;
    const issues = validatePassword(value);
    if (issues.length > 0) {
      error.textContent = issues[0]!.message;
      password.setAttribute('aria-invalid', 'true');
      password.focus();
      return;
    }
    void (async () => {
      setBusy(submit, true);
      try {
        await post(`/api/admin/users/${user.id}/password`, { password: value });
        close();
        toast(`Password reset for ${user.username}.`, 'success');
      } catch (err) {
        if (handleAuthError(err)) return;
        error.textContent = errorText(err);
        password.setAttribute('aria-invalid', 'true');
      } finally {
        setBusy(submit, false);
      }
    })();
  });
  password.focus();
}

/** The user management screen. */
async function showUsers(): Promise<void> {
  const tbody = el('tbody');
  const listWrap = el('div');
  const summary = el('div', { class: 'grid grid--3 admin__summary' });
  const table = el(
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
        el('th', null, 'Status'),
        el('th', null, 'Actions'),
      ),
    ),
    tbody,
  );
  const view: AdminView = { listWrap, table, tbody, summary };

  const username = el('input', { class: 'input', autocomplete: 'off' });
  const password = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const roleSelect = el(
    'select',
    { class: 'input' },
    el('option', { value: 'TRAINER' }, 'Trainer'),
    el('option', { value: 'ADMIN' }, 'Administrator'),
    el('option', { value: 'PLAYER' }, 'Player'),
  );
  const feedback = el('div');
  const submit = button('Create user', { type: 'submit', variant: 'primary' });

  const usernameField = field(
    'Username',
    username,
    `At least ${USERNAME_MIN_LENGTH} characters. Stored lower-cased.`,
  );
  const usernameError = el('span', { class: 'field__error' });
  usernameField.append(usernameError);

  const passwordField = field('Password', password, `At least ${PASSWORD_MIN_LENGTH} characters.`);
  const passwordError = el('span', { class: 'field__error' });
  passwordField.append(passwordError);

  /** Show a validation issue on its field, or clear every field error. */
  const showFieldIssues = (issues: ValidationIssue[]): boolean => {
    usernameError.textContent = '';
    passwordError.textContent = '';
    username.removeAttribute('aria-invalid');
    password.removeAttribute('aria-invalid');
    for (const issue of issues) {
      if (issue.path === 'username') {
        usernameError.textContent = issue.message;
        username.setAttribute('aria-invalid', 'true');
      } else if (issue.path === 'password') {
        passwordError.textContent = issue.message;
        password.setAttribute('aria-invalid', 'true');
      }
    }
    if (issues.length === 0) return false;
    (issues[0]!.path === 'password' ? password : username).focus();
    return true;
  };

  const createForm = el(
    'form',
    {
      class: 'card',
      onsubmit: (event: Event) => {
        event.preventDefault();
        feedback.replaceChildren();
        const issues = [
          ...validateUsername(username.value.trim()),
          ...validatePassword(password.value),
        ];
        if (showFieldIssues(issues)) return;
        void (async () => {
          setBusy(submit, true);
          try {
            await post('/api/admin/users', {
              username: username.value.trim(),
              password: password.value,
              role: roleSelect.value as UserRole,
            });
            username.value = '';
            password.value = '';
            showFieldIssues([]);
            feedback.replaceChildren(notice('User created.', 'success'));
            await refresh(view);
          } catch (error) {
            if (handleAuthError(error)) return;
            // A taken username belongs on the field; anything else is a notice.
            if (error instanceof ApiError && error.code === 'username_taken') {
              showFieldIssues([{ path: 'username', message: error.message }]);
            } else {
              feedback.replaceChildren(notice(errorText(error), 'error'));
            }
          } finally {
            setBusy(submit, false);
          }
        })();
      },
    },
    el('h2', { class: 'section-title' }, 'Add a user'),
    el('div', { class: 'grid grid--3' }, usernameField, passwordField, field('Role', roleSelect)),
    feedback,
    el('div', { class: 'admin__form-actions' }, submit),
  );

  render(
    app,
    appShell({
      role: 'host',
      active: 'admin',
      badge: 'Admin',
      isAdmin: true,
      brandHref: ADMIN_HOME,
      title: 'Users',
      actions: [
        button('Host', { onClick: () => (location.href = './host.html') }),
        button('Editor', { onClick: () => (location.href = './editor.html') }),
      ],
      children: [
        el(
          'section',
          { class: 'wrap' },
          summary,
          createForm,
          el('h2', { class: 'section-title' }, 'Accounts'),
          listWrap,
        ),
      ],
    }),
  );

  // Show placeholders while the first load is in flight, so the table never
  // appears as an empty box.
  listWrap.replaceChildren(
    el('div', { class: 'card' }, skeleton('text'), skeleton('text'), skeleton('text')),
  );
  await refresh(view);
}

/** Bootstrap: require a session, require the ADMIN role, then load the page. */
void (async () => {
  try {
    const session = await get<MeResponse>('/api/auth/me');
    if (!session.user) {
      location.href = LOGIN_URL;
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
    if (handleAuthError(error)) return;
    toast(errorText(error), 'error');
  }
})();
