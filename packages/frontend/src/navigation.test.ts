/**
 * Application shell and navigation guards (Phase 6.2.1).
 *
 * These protect the two promises the shell makes:
 *
 *  1. Role orientation – a player and a host get different entries, an admin
 *     gets the admin entry on top of the host set, and the phone bar never shows
 *     more than five entries plus "More".
 *  2. Bestandsschutz – the shell is additive. It renders the brand once, keeps
 *     the page's own heading, marks exactly one entry current, and shows an entry
 *     whose page does not exist yet as a non-clickable "soon" placeholder.
 *
 * Navigation is display only; the server stays the authority (briefing §5).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_ITEM,
  HOST_NAV,
  MOBILE_PRIMARY_LIMIT,
  PLAYER_NAV,
  appShell,
  isAvailable,
  mobileNavItems,
  navItems,
} from './navigation.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'navigation.ts'), 'utf8');

describe('navigation set by role', () => {
  it('gives a player the player entries only', () => {
    expect(navItems('player')).toEqual([...PLAYER_NAV]);
  });

  it('gives a host the host entries', () => {
    expect(navItems('host')).toEqual([...HOST_NAV]);
  });

  it('appends the admin entry for an admin host', () => {
    const items = navItems('host', { isAdmin: true });
    expect(items).toHaveLength(HOST_NAV.length + 1);
    expect(items.at(-1)).toEqual(ADMIN_ITEM);
  });

  it('never gives a player the admin entry, even with isAdmin set', () => {
    const items = navItems('player', { isAdmin: true });
    expect(items.some((item) => item.id === 'admin')).toBe(false);
  });

  it('does not mutate the exported sets', () => {
    const before = HOST_NAV.length;
    navItems('host', { isAdmin: true });
    expect(HOST_NAV).toHaveLength(before);
  });
});

describe('mobile entry limit', () => {
  it('shows at most five entries in the bottom bar', () => {
    expect(mobileNavItems('player')).toHaveLength(MOBILE_PRIMARY_LIMIT);
    expect(mobileNavItems('host')).toHaveLength(MOBILE_PRIMARY_LIMIT);
    expect(mobileNavItems('host', { isAdmin: true })).toHaveLength(MOBILE_PRIMARY_LIMIT);
  });

  it('keeps the admin entry out of the phone bar, where it lives under "More"', () => {
    const items = mobileNavItems('host', { isAdmin: true });
    expect(items.some((item) => item.id === 'admin')).toBe(false);
  });
});

describe('availability', () => {
  it('treats an entry with an href as available and one without as soon', () => {
    expect(isAvailable({ id: 'a', label: 'A', href: './a.html', icon: 'x' })).toBe(true);
    expect(isAvailable({ id: 'b', label: 'B', icon: 'x' })).toBe(false);
  });

  it('marks the not-yet-built entries as unavailable, not as links', () => {
    for (const item of [...PLAYER_NAV, ...HOST_NAV]) {
      if (!isAvailable(item)) expect(item.href).toBeUndefined();
    }
  });

  it('links the profile entry to its placeholder (Phase 6.2.2)', () => {
    const profile = PLAYER_NAV.find((item) => item.id === 'profile');
    expect(profile?.href).toBe('./#profile');
    expect(isAvailable(profile!)).toBe(true);
  });
});

describe('appShell', () => {
  it('carries a role class so the layout can key off it', () => {
    const shell = appShell({ role: 'player', active: 'lobby', children: [] });
    expect(shell.className).toBe('shell shell--player');

    const hostShell = appShell({ role: 'host', active: 'overview', children: [] });
    expect(hostShell.className).toBe('shell shell--host');
  });

  it('renders the brand exactly once, in the top bar', () => {
    const shell = appShell({ role: 'host', active: 'overview', children: [] });
    expect(shell.querySelectorAll('.brand__logo')).toHaveLength(1);
    expect(shell.querySelector('.shell__top .brand')).not.toBeNull();
  });

  it('renders the page title as the single h1', () => {
    const shell = appShell({ role: 'host', active: 'overview', title: 'Welcome', children: [] });
    expect(shell.querySelectorAll('h1')).toHaveLength(1);
    expect(shell.querySelector('h1')?.textContent).toBe('Welcome');
  });

  it('links the brand when a brandHref is given', () => {
    const shell = appShell({
      role: 'host',
      active: 'admin',
      brandHref: './admin.html',
      children: [],
    });
    expect(shell.querySelector('a.brand')?.getAttribute('href')).toBe('./admin.html');
  });

  it('marks exactly one entry as current and the rest as not', () => {
    const shell = appShell({ role: 'host', active: 'quizzes', children: [] });
    const active = shell.querySelectorAll('.nav--side .nav__item--active');
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain('Quizzes');
    expect(active[0]?.getAttribute('aria-current')).toBe('page');
  });

  it('renders an unavailable entry as a non-clickable placeholder', () => {
    const shell = appShell({ role: 'player', active: 'lobby', children: [] });
    const soon = shell.querySelector('.nav--side .nav__item--soon');
    expect(soon).not.toBeNull();
    expect(soon?.tagName).toBe('SPAN');
    expect(soon?.getAttribute('aria-disabled')).toBe('true');
    expect(shell.querySelectorAll('.nav--side a.nav__item--soon')).toHaveLength(0);
  });

  it('gives the phone bar labelled, icon-only entries', () => {
    const shell = appShell({ role: 'player', active: 'lobby', children: [] });
    const compact = shell.querySelectorAll('.nav--bottom a.nav__item');
    expect(compact.length).toBeGreaterThan(0);
    for (const item of compact) {
      expect(item.getAttribute('aria-label')).toBeTruthy();
      expect(item.querySelector('.nav__label')).toBeNull();
    }
  });

  it('lists the entries past the limit under "More"', () => {
    const shell = appShell({ role: 'host', active: 'overview', children: [] });
    const more = shell.querySelector('.nav__more');
    expect(more).not.toBeNull();
    const listed = shell.querySelectorAll('.nav__more-item');
    expect(listed).toHaveLength(HOST_NAV.length - MOBILE_PRIMARY_LIMIT);
  });

  it('marks the current page inside the "More" list when it overflows', () => {
    const shell = appShell({ role: 'host', active: 'admin', isAdmin: true, children: [] });
    const more = shell.querySelector('.nav__more');
    expect(more?.querySelector('summary')?.classList.contains('nav__item--active')).toBe(true);
    const current = shell.querySelector('.nav__more-item--active');
    expect(current?.textContent).toBe('Admin');
    expect(current?.getAttribute('aria-current')).toBe('page');
  });

  it('keeps the beamer surface out of the shell entirely', () => {
    // The host page's `.show` screens are rendered without appShell; nothing in
    // the shell may wrap them. Guard the contract in the source itself.
    expect(source).not.toMatch(/class:\s*'centered show'/);
  });
});

describe('the shell stays CSP-safe', () => {
  it('never builds markup from an HTML string', () => {
    expect(source).not.toMatch(
      /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write/,
    );
  });
});
