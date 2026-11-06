/**
 * Application shell and role-oriented navigation (Phase 6.2.1).
 *
 * The shell is a thin, additive frame: it wraps a page's existing content with a
 * brand bar and a navigation region and never replaces the screens themselves.
 * All four existing surfaces (player, host, editor, admin) keep their own entry
 * point and their own URL; the shell is injected per page, so no new route and
 * no new HTML entry point is introduced.
 *
 * Navigation is *display only*. It decides what a role sees; every server route
 * and socket event still authorises on its own (concept §8.1, briefing §5).
 *
 * Layout by viewport (concept §9.1):
 *   desktop ≥1024px  – fixed left sidebar with labels
 *   tablet 768–1023  – icon rail, labels as accessible names only
 *   phone   ≤767px   – bottom bar, at most five entries plus "More"
 *
 * The whole thing is built through `el`, so it stays compatible with the strict
 * Content-Security-Policy (no inline markup, no inline styles beyond a plain
 * `style` attribute that `el` sets through `setProperty`).
 */

import { el } from './dom.js';
import { brand } from './ui.js';

/** The surface a user is on. A capability, not a database role (briefing §5). */
export type ShellRole = 'player' | 'host';

/** One navigation entry. */
export interface NavItem {
  /** Stable identifier, used to mark the current page. */
  id: string;
  /** Visible label. */
  label: string;
  /** Target URL. Absent for an entry that is not built yet. */
  href?: string;
  /**
   * A short, code-defined glyph. Not an image and not a font: it is a single
   * trusted string so the entry still reads when labels are hidden in the rail.
   */
  icon: string;
}

/** How many entries the phone bottom bar shows before "More". */
export const MOBILE_PRIMARY_LIMIT = 5;

/**
 * The player navigation. A player has no account yet, so sign-out has no meaning
 * here; the entries that arrive in later phases are shown as "soon" so the
 * structure is visible without pretending the page exists.
 */
export const PLAYER_NAV: readonly NavItem[] = [
  { id: 'lobby', label: 'Lobby', href: './', icon: '⌂' },
  { id: 'questions', label: 'Questions', icon: '?' },
  { id: 'inventory', label: 'Inventory', icon: '▦' },
  { id: 'profile', label: 'Profile', icon: '☺' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

/** The host navigation. Later phases fill in control, backgrounds, avatars and reports. */
export const HOST_NAV: readonly NavItem[] = [
  { id: 'overview', label: 'Overview', href: './host.html', icon: '⌂' },
  { id: 'control', label: 'Game control', icon: '▶' },
  { id: 'quizzes', label: 'Quizzes', href: './editor.html', icon: '✎' },
  { id: 'backgrounds', label: 'Backgrounds', icon: '▤' },
  { id: 'players', label: 'Players', icon: '☰' },
  { id: 'avatars', label: 'Inventory & avatars', icon: '▦' },
  { id: 'reports', label: 'Reports', icon: '▥' },
];

/** The administrator entry, appended only for an admin. */
export const ADMIN_ITEM: NavItem = { id: 'admin', label: 'Admin', href: './admin.html', icon: '★' };

/** Options that widen the host navigation without changing the player one. */
export interface NavOptions {
  /** Append the admin entry. The server still enforces admin-only access. */
  isAdmin?: boolean;
}

/** The navigation set for a role. */
export function navItems(role: ShellRole, options: NavOptions = {}): NavItem[] {
  const items = [...(role === 'player' ? PLAYER_NAV : HOST_NAV)];
  if (role === 'host' && options.isAdmin) items.push(ADMIN_ITEM);
  return items;
}

/**
 * The entries the phone bottom bar shows directly. Everything past the limit is
 * reached through "More", so the bar never crowds the screen.
 */
export function mobileNavItems(
  role: ShellRole,
  options: NavOptions = {},
  limit = MOBILE_PRIMARY_LIMIT,
): NavItem[] {
  return navItems(role, options).slice(0, limit);
}

/** Whether an entry points at a page that exists. */
export function isAvailable(item: NavItem): boolean {
  return typeof item.href === 'string' && item.href.length > 0;
}

/** One navigation entry, as an anchor or a disabled placeholder. */
function navItem(item: NavItem, active: string, compact: boolean): HTMLElement {
  const current = item.id === active;
  const icon = el('span', { class: 'nav__icon', 'aria-hidden': 'true' }, item.icon);
  const label = el('span', { class: 'nav__label' }, item.label);

  if (!isAvailable(item)) {
    return el(
      'span',
      {
        class: 'nav__item nav__item--soon',
        'aria-disabled': 'true',
        title: `${item.label} – coming soon`,
      },
      icon,
      compact ? null : label,
      compact ? null : el('span', { class: 'nav__soon' }, 'Soon'),
    );
  }

  return el(
    'a',
    {
      class: `nav__item${current ? ' nav__item--active' : ''}`,
      href: item.href,
      // A compact rail hides the label visually; the name stays for assistive tech.
      ...(current ? { 'aria-current': 'page' } : {}),
      ...(compact ? { 'aria-label': item.label } : {}),
    },
    icon,
    compact ? null : label,
  );
}

export interface AppShellOptions {
  /** The surface: chooses the navigation set and the shell class. */
  role: ShellRole;
  /** The `id` of the current entry, marked as active. */
  active: string;
  /** The page heading, rendered as the single `<h1>` in the main region. */
  title?: string;
  /** A short caption shown next to the brand, e.g. "Host". */
  badge?: string;
  /** When set, the brand logo links there (the admin dashboard does this). */
  brandHref?: string;
  /** Append the admin entry (host role only). */
  isAdmin?: boolean;
  /** Right-hand actions in the top bar, e.g. Sign out. */
  actions?: Node[];
  /** The page content, placed in the shell's main region. */
  children: Node[];
}

/**
 * Wrap page content in the application shell.
 *
 * Returns a single node that a page renders into `<main>`. The brand lives once,
 * in the shell's top bar; the page's own heading goes through `title`, so a page
 * that used to call `pageHeader` hands its title and actions here instead and the
 * brand is never rendered twice.
 */
export function appShell(options: AppShellOptions): HTMLElement {
  const { role, active, title, badge, brandHref, isAdmin, actions = [], children } = options;
  const nav: NavOptions = { isAdmin };

  const topBar = el(
    'header',
    { class: 'shell__top' },
    el(
      'div',
      { class: 'shell__brand' },
      brand(brandHref ? { href: brandHref } : {}),
      badge ? el('span', { class: 'shell__badge' }, badge) : null,
    ),
    actions.length ? el('div', { class: 'shell__actions' }, ...actions) : null,
  );

  const sideNav = el(
    'nav',
    { class: 'nav nav--side', 'aria-label': 'Main navigation' },
    ...navItems(role, nav).map((item) => navItem(item, active, false)),
  );

  const bottomNav = el(
    'nav',
    { class: 'nav nav--bottom', 'aria-label': 'Main navigation' },
    ...mobileNavItems(role, nav).map((item) => navItem(item, active, true)),
    moreItem(role, nav, active),
  );

  return el(
    'div',
    { class: `shell shell--${role}` },
    el('aside', { class: 'shell__side' }, sideNav),
    el(
      'div',
      { class: 'shell__body' },
      topBar,
      el(
        'div',
        { class: 'shell__main' },
        title ? el('h1', { class: 'page-title' }, title) : null,
        ...children,
      ),
    ),
    bottomNav,
  );
}

/**
 * The "More" entry. It lists the entries the bottom bar did not show, so no
 * destination is lost on a phone. When nothing is left over it is not rendered.
 * If the current page is one of those overflow entries (the admin dashboard on a
 * phone), the summary carries the active mark so the bar still shows where you are.
 */
function moreItem(role: ShellRole, nav: NavOptions, active: string): Node | null {
  const rest = navItems(role, nav).slice(MOBILE_PRIMARY_LIMIT);
  if (rest.length === 0) return null;
  const current = rest.some((item) => item.id === active);

  return el(
    'details',
    { class: 'nav__more' },
    el(
      'summary',
      {
        class: `nav__item nav__item--more${current ? ' nav__item--active' : ''}`,
        ...(current ? { 'aria-current': 'page' } : {}),
      },
      el('span', { class: 'nav__icon', 'aria-hidden': 'true' }, '⋯'),
      el('span', { class: 'nav__label' }, 'More'),
    ),
    el(
      'div',
      { class: 'nav__more-list' },
      ...rest.map((item) => {
        const available = isAvailable(item);
        const current = item.id === active;
        return el(
          available ? 'a' : 'span',
          {
            class: `nav__more-item${available ? '' : ' nav__item--soon'}${current ? ' nav__more-item--active' : ''}`,
            ...(available ? { href: item.href } : { 'aria-disabled': 'true' }),
            ...(current ? { 'aria-current': 'page' } : {}),
          },
          item.label,
        );
      }),
    ),
  );
}
