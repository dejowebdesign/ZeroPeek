/**
 * Small, reusable UI pieces.
 *
 * Everything builds DOM through `el`, so dynamic text is always assigned with
 * `textContent` and stays compatible with the strict CSP.
 */

import { el, render } from './dom.js';
import { ApiError } from './api.js';

/**
 * The ZeroPeek wordmark: the logo asset on its own.
 *
 * The logo is served as-is from `public/logo.png`; its transparent areas and its
 * colours and shapes are not altered. It stands alone — no product name text is
 * rendered next to it — so the image carries the brand on its own.
 * `alt` stays empty on purpose: the surface's own heading names the page, and a
 * decorative mark keeps screen-reader output clean.
 *
 * When `href` is given the logo becomes a link (used by the admin header to
 * return to the dashboard). It is a real anchor, so middle-click and
 * open-in-new-tab behave as users expect.
 */
export function brand(options: { href?: string } = {}): HTMLElement {
  const logo = el('img', {
    class: 'brand__logo',
    src: '/logo.png',
    alt: '',
    'aria-hidden': 'true',
    decoding: 'async',
  });

  if (options.href) {
    return el(
      'a',
      { class: 'brand brand--link', href: options.href, 'aria-label': 'ZeroPeek home' },
      logo,
    );
  }

  return el('span', { class: 'brand' }, logo);
}

/** A page header with a brand, a title and optional right-hand actions. */
export function pageHeader(
  title: string,
  actions: Node[] = [],
  subtitle?: string,
  brandHref?: string,
): HTMLElement {
  return el(
    'header',
    { class: 'page-header' },
    el(
      'div',
      { class: 'page-header__main' },
      brand(brandHref ? { href: brandHref } : {}),
      el('h1', { class: 'page-title' }, title),
      subtitle ? el('p', { class: 'muted' }, subtitle) : null,
    ),
    actions.length ? el('div', { class: 'page-header__actions' }, ...actions) : null,
  );
}

/** A labelled form control. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return el(
    'label',
    { class: 'field', for: id },
    el('span', { class: 'field__label' }, label),
    control,
    hint ? el('span', { class: 'field__hint muted' }, hint) : null,
  );
}

export interface ButtonOptions {
  variant?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
}

/** A styled button. */
export function button(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const classes = ['btn', options.variant === 'primary' ? 'btn-primary' : ''];
  const node = el(
    'button',
    {
      class: classes.filter(Boolean).join(' '),
      type: options.type ?? 'button',
      ...(options.disabled ? { disabled: true } : {}),
      ...(options.onClick ? { onclick: options.onClick } : {}),
    },
    label,
  );
  return node;
}

/** A modal-free inline message. `kind` chooses the colour. */
export function notice(message: string, kind: 'info' | 'error' | 'success' = 'info'): HTMLElement {
  return el('p', { class: `notice notice--${kind}`, role: 'status' }, message);
}

/** Turn any thrown value into a readable message. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.issues?.length) {
      return `${error.message} (${error.issues.map((issue) => issue.path).join(', ')})`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/** Show a short-lived toast. */
export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const node = el('div', { class: `toast toast--${kind}`, role: 'status' }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 4000);
}

/** A centred loading indicator. */
export function spinner(label = 'Loading…'): HTMLElement {
  return el(
    'div',
    { class: 'centered' },
    el('div', { class: 'spinner', 'aria-hidden': 'true' }),
    el('p', { class: 'muted' }, label),
  );
}

/** Render a screen, replacing whatever is there. */
export function screen(root: Element, node: Node): void {
  render(root, node);
}

/** Escape a value for safe use inside a CSV cell in the browser. */
export function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
