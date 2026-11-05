import { describe, expect, it, vi } from 'vitest';

import {
  brand,
  button,
  chip,
  confirmDialog,
  countdown,
  dialog,
  emptyState,
  pageHeader,
  progress,
  setBusy,
  skeleton,
  statTile,
} from './ui.js';

describe('brand', () => {
  it('shows the supplied logo alone, with no product-name text', () => {
    const node = brand();

    expect(node.className).toBe('brand');
    expect(node.tagName).toBe('SPAN');
    expect(node.textContent).toBe('');

    const logo = node.querySelector('img');
    expect(logo).not.toBeNull();
    // Served unchanged from the public directory; no hashing or rewriting.
    expect(logo?.getAttribute('src')).toBe('/logo.png');
    expect(logo?.className).toBe('brand__logo');
  });

  it('marks the logo as decorative so the heading is announced once', () => {
    const logo = brand().querySelector('img');

    expect(logo?.getAttribute('alt')).toBe('');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
  });

  it('stays a plain element when no href is given', () => {
    expect(brand().tagName).toBe('SPAN');
    expect(brand().getAttribute('href')).toBeNull();
  });

  it('becomes a link when an href is given, keeping the logo inside', () => {
    const node = brand({ href: './admin.html' });

    expect(node.tagName).toBe('A');
    expect(node.getAttribute('href')).toBe('./admin.html');
    expect(node.className).toContain('brand--link');
    expect(node.getAttribute('aria-label')).toBe('ZeroPeek home');
    expect(node.querySelector('img')?.getAttribute('src')).toBe('/logo.png');
  });
});

describe('pageHeader', () => {
  it('renders the title and keeps the logo unlinked by default', () => {
    const header = pageHeader('Users');

    expect(header.querySelector('.page-title')?.textContent).toBe('Users');
    expect(header.querySelector('a.brand')).toBeNull();
    expect(header.querySelector('.brand__logo')).not.toBeNull();
  });

  it('links the logo when a brand href is given', () => {
    const header = pageHeader('Users', [], undefined, './admin.html');

    const link = header.querySelector('a.brand');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('./admin.html');
  });
});

describe('button', () => {
  it('defaults to a plain button and maps the variant to a class', () => {
    expect(button('Go').className).toBe('btn');
    expect(button('Go', { variant: 'primary' }).className).toContain('btn-primary');
    expect(button('Go', { variant: 'secondary' }).className).toContain('btn-secondary');
    expect(button('Go', { variant: 'danger' }).className).toContain('btn-danger');
    expect(button('Go', { variant: 'ghost' }).className).toContain('btn-ghost');
  });

  it('adds the compact and animation classes on request', () => {
    const node = button('Go', { small: true, animate: true });
    expect(node.className).toContain('btn-sm');
    expect(node.className).toContain('anim-pop');
  });

  it('disables the element when asked', () => {
    expect(button('Go', { disabled: true }).disabled).toBe(true);
  });
});

describe('setBusy', () => {
  it('locks the button, shows the spinner and reports aria-busy', () => {
    const node = button('Save');
    setBusy(node, true);
    expect(node.classList.contains('btn--loading')).toBe(true);
    expect(node.disabled).toBe(true);
    expect(node.getAttribute('aria-busy')).toBe('true');
  });

  it('releases the button again', () => {
    const node = button('Save');
    setBusy(node, true);
    setBusy(node, false);
    expect(node.classList.contains('btn--loading')).toBe(false);
    expect(node.disabled).toBe(false);
    expect(node.getAttribute('aria-busy')).toBe('false');
  });
});

describe('chip', () => {
  it('renders the label and an optional status dot', () => {
    const plain = chip('Draft');
    expect(plain.className).toBe('chip');
    expect(plain.textContent).toBe('Draft');

    const status = chip('Connected', 'ok', true);
    expect(status.className).toContain('chip--ok');
    expect(status.querySelector('.chip__dot')).not.toBeNull();
    expect(status.textContent).toBe('Connected');
  });
});

describe('progress', () => {
  it('exposes the value to assistive technology', () => {
    const node = progress(3, 4);
    expect(node.getAttribute('role')).toBe('progressbar');
    expect(node.getAttribute('aria-valuenow')).toBe('3');
    expect(node.getAttribute('aria-valuemax')).toBe('4');
    expect(node.querySelector<HTMLElement>('.progress__fill')?.style.width).toBe('75%');
  });

  it('clamps out-of-range values and never divides by zero', () => {
    expect(progress(9, 4).querySelector<HTMLElement>('.progress__fill')?.style.width).toBe('100%');
    expect(progress(1, 0).querySelector<HTMLElement>('.progress__fill')?.style.width).toBe('0%');
  });
});

describe('statTile', () => {
  it('shows a value with its caption', () => {
    const node = statTile('42', 'Points');
    expect(node.className).toContain('stat');
    expect(node.querySelector('.stat__value')?.textContent).toBe('42');
    expect(node.querySelector('.stat__label')?.textContent).toBe('Points');
  });
});

describe('skeleton', () => {
  it('is hidden from assistive technology', () => {
    const node = skeleton('card');
    expect(node.className).toContain('skeleton--card');
    expect(node.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('countdown', () => {
  it('renders the seconds and a clamped progress ratio', () => {
    const node = countdown(12, 0.5);
    expect(node.querySelector('.countdown__value')?.textContent).toBe('12');
    expect(node.style.getPropertyValue('--progress')).toBe('0.5');
    expect(countdown(5, 2).style.getPropertyValue('--progress')).toBe('1');
    expect(countdown(5, -1).style.getPropertyValue('--progress')).toBe('0');
  });
});

describe('emptyState', () => {
  it('shows a title, an optional hint and an action', () => {
    const node = emptyState('Nothing here', 'Do this first', button('Add'));
    expect(node.querySelector('.empty__title')?.textContent).toBe('Nothing here');
    expect(node.textContent).toContain('Do this first');
    expect(node.querySelector('button')?.textContent).toBe('Add');
  });
});

describe('dialog', () => {
  it('is modal, focusable and closes on Escape', () => {
    const onClose = vi.fn();
    const { node, close } = dialog({ title: 'Confirm', body: 'Are you sure?', onClose });

    expect(node.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(node.textContent).toContain('Confirm');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.dialog')).toBeNull();

    close();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes when the backdrop is clicked but not the panel', () => {
    const { node } = dialog({ title: 'T', body: 'B' });
    node
      .querySelector<HTMLElement>('.dialog__panel')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.dialog')).not.toBeNull();

    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('renders footer actions', () => {
    const { node } = dialog({ title: 'T', body: 'B', actions: [button('OK')] });
    expect(node.querySelector('.dialog__actions button')?.textContent).toBe('OK');
    node.remove();
  });
});

describe('confirmDialog', () => {
  it('runs the callback only when the destructive action is confirmed', () => {
    const onConfirm = vi.fn();
    confirmDialog({ title: 'Delete?', body: 'Gone.', confirmLabel: 'Delete', onConfirm });

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.dialog__actions button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Delete']);

    buttons[1]!.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.dialog')).toBeNull();
  });
});
