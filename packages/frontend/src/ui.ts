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
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  /** Render at the compact size used in table rows and inline controls. */
  small?: boolean;
  /** Add the shared entry animation. */
  animate?: boolean;
  onClick?: (event: MouseEvent) => void;
}

/** A styled button. */
export function button(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const classes = [
    'btn',
    options.variant ? `btn-${options.variant}` : '',
    options.small ? 'btn-sm' : '',
    options.animate ? 'anim-pop' : '',
  ];
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

/**
 * Mark a button busy: it shows the shared spinner and cannot be pressed again
 * until `done` is called. Pair with `try/finally` so the button always recovers,
 * even when the request fails.
 */
export function setBusy(node: HTMLButtonElement, busy: boolean): void {
  node.classList.toggle('btn--loading', busy);
  node.disabled = busy;
  node.setAttribute('aria-busy', busy ? 'true' : 'false');
}

export type ChipTone = 'default' | 'accent' | 'cyan' | 'ok' | 'warn' | 'bad' | 'muted';

/**
 * A short label chip. `dot` adds a leading dot so a status is never signalled by
 * colour alone (concept §3.3).
 */
export function chip(label: string, tone: ChipTone = 'default', dot = false): HTMLElement {
  return el(
    'span',
    { class: `chip${tone === 'default' ? '' : ` chip--${tone}`}` },
    dot ? el('span', { class: 'chip__dot', 'aria-hidden': 'true' }) : null,
    label,
  );
}

/** A labelled progress bar. `value` and `max` are plain numbers. */
export function progress(
  value: number,
  max: number,
  options: { label?: string; caption?: string } = {},
): HTMLElement {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return el(
    'div',
    {
      class: 'progress',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': String(max),
      'aria-valuenow': String(value),
      ...(options.label ? { 'aria-label': options.label } : {}),
    },
    options.label || options.caption
      ? el(
          'div',
          { class: 'progress__label' },
          el('span', null, options.label ?? ''),
          el('span', null, options.caption ?? ''),
        )
      : null,
    el(
      'div',
      { class: 'progress__track' },
      el('div', { class: 'progress__fill', style: { width: `${ratio * 100}%` } }),
    ),
  );
}

/** A single figure with a caption – used for scores, counts and stats. */
export function statTile(value: string, label: string): HTMLElement {
  return el(
    'div',
    { class: 'card stat' },
    el('span', { class: 'stat__value' }, value),
    el('span', { class: 'stat__label' }, label),
  );
}

export interface DialogOptions {
  title: string;
  body?: string | Node;
  /** Buttons shown in the footer, right-aligned. */
  actions?: Node[];
  /** Called when the dialog is dismissed with Esc or the backdrop. */
  onClose?: () => void;
}

/**
 * A modal dialog. It traps focus on open, closes on `Esc` and on a backdrop
 * click, and restores focus to whatever was focused before. It is built from
 * DOM nodes (never `innerHTML`), so it stays CSP-compliant.
 */
export function dialog(options: DialogOptions): { node: HTMLElement; close: () => void } {
  const previous = document.activeElement as HTMLElement | null;
  const titleId = `d-${Math.random().toString(36).slice(2, 9)}`;

  const panel = el(
    'div',
    {
      class: 'card dialog__panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    },
    el('h2', { class: 'dialog__title', id: titleId }, options.title),
    options.body
      ? typeof options.body === 'string'
        ? el('p', { class: 'dialog__body' }, options.body)
        : el('div', { class: 'dialog__body' }, options.body)
      : null,
    options.actions?.length ? el('div', { class: 'dialog__actions' }, ...options.actions) : null,
  );

  const close = (): void => {
    node.remove();
    document.removeEventListener('keydown', onKeydown);
    options.onClose?.();
    previous?.focus?.();
  };

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep Tab inside the dialog while it is open.
    const focusables = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const node = el(
    'div',
    {
      class: 'dialog',
      onclick: (event: MouseEvent) => {
        if (event.target === node) close();
      },
    },
    panel,
  );

  document.addEventListener('keydown', onKeydown);
  document.body.append(node);
  (
    panel.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]') ??
    panel
  ).focus();

  return { node, close };
}

/** A short, non-blocking confirmation dialog for a destructive action. */
export function confirmDialog(options: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}): void {
  const { close } = dialog({
    title: options.title,
    body: options.body,
    actions: [
      button('Cancel', { variant: 'ghost', onClick: () => close() }),
      button(options.confirmLabel, {
        variant: 'danger',
        onClick: () => {
          close();
          options.onConfirm();
        },
      }),
    ],
  });
}

/** A skeleton placeholder block, for lists and cards while data loads. */
export function skeleton(variant: 'text' | 'card' = 'text'): HTMLElement {
  return el('div', { class: `skeleton skeleton--${variant}`, 'aria-hidden': 'true' });
}

/** A countdown ring with a large number. `ratio` is 1 → full, 0 → empty. */
export function countdown(seconds: number, ratio = 1): HTMLElement {
  return el(
    'div',
    {
      class: 'countdown',
      style: { '--progress': String(Math.min(1, Math.max(0, ratio))) },
      role: 'timer',
      'aria-live': 'off',
    },
    el('span', { class: 'countdown__value' }, String(seconds)),
  );
}

/** A consistent empty state with an optional action. */
export function emptyState(title: string, hint?: string, action?: Node): HTMLElement {
  return el(
    'div',
    { class: 'empty' },
    el('p', { class: 'empty__title' }, title),
    hint ? el('p', { class: 'muted' }, hint) : null,
    action ?? null,
  );
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
