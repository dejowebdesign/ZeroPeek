/**
 * The lobby join QR code (Phase 6.14).
 *
 * Renders a scannable QR code for the player join URL, built from the game PIN
 * the server just issued. The module owns three concerns and nothing else:
 *
 *   1. **The URL.** `joinUrl()` is the single place the encoded address is
 *      composed, so a test can assert exactly what a phone will open.
 *   2. **The symbol.** A QR code is generated with `qrcode-generator` and painted
 *      as an inline SVG. SVG (not a canvas, not an image file) keeps the symbol
 *      crisp on a projector at any size and needs no extra request; it is built
 *      with DOM calls so the strict CSP (`img-src 'self' data:`, no inline
 *      script, no `innerHTML` for data) is satisfied without a nonce.
 *   3. **Freshness.** `renderJoinQr()` replaces the previous symbol, so a new
 *      PIN or a new lobby can never leave a stale code on screen.
 *
 * The code is deliberately error-correction level M with a quiet zone of four
 * modules: a projector compresses highlights and a phone camera is held at an
 * angle, so the symbol needs margin to survive the round trip.
 */

import qrcode from 'qrcode-generator';

/** The path a player opens to join. The PIN is the only parameter it needs. */
export const JOIN_PATH = '/';

/** Quiet zone around the symbol, in modules. Four is the QR specification's minimum. */
const QUIET_ZONE = 4;

/** Error-correction level. M tolerates ~15 % damage and still scans. */
const ERROR_CORRECTION = 'M';

/**
 * The URL a phone must open to land in the lobby for `pin`.
 *
 * `origin` is passed in rather than read from `location` so the composition is a
 * pure function a test can pin down. The caller passes `location.origin`, which
 * is exactly the address the host's browser is already using — so the code works
 * behind the deployment's public domain without any extra configuration.
 *
 * The PIN is upper-cased because the server normalises input that way; encoding
 * the canonical form means the code and the printed PIN never disagree.
 */
export function joinUrl(origin: string, pin: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}${JOIN_PATH}?pin=${encodeURIComponent(pin.trim().toUpperCase())}`;
}

/**
 * The join URL for the current document, or `null` outside a browser.
 *
 * A blank PIN yields `null`: a code for the bare landing page would look valid
 * but lead nowhere useful, so the caller hides the code instead.
 */
export function currentJoinUrl(pin: string): string | null {
  if (typeof location === 'undefined' || !pin.trim()) return null;
  return joinUrl(location.origin, pin);
}

/**
 * The QR symbol for `url` as an SVG element.
 *
 * Every module becomes one `<rect>` on a `0 0 size size` viewBox, so the element
 * scales to whatever CSS box it is given and stays sharp at any projector
 * resolution. The caller sets the size; the symbol itself has no fixed pixels.
 */
export function qrSvg(url: string): SVGSVGElement {
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(url);
  qr.make();

  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `QR code for ${url}`);
  // The dark modules on a light field are the only reliably decodable pairing,
  // so the symbol carries its own light background instead of inheriting the
  // dark glass surface. `shape-rendering: crispEdges` keeps module borders from
  // blurring when the SVG is scaled up on a projector.
  svg.setAttribute('data-join-qr', '');
  svg.style.setProperty('shape-rendering', 'crispEdges');

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('x', '0');
  background.setAttribute('y', '0');
  background.setAttribute('width', String(size));
  background.setAttribute('height', String(size));
  background.setAttribute('fill', '#ffffff');
  svg.append(background);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  let d = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000000');
  svg.append(path);

  return svg;
}

/**
 * Paint the join QR into `host`.
 *
 * Replaces whatever was there, so the element always shows the code for the
 * current PIN. Returns `false` when there is no usable URL (no PIN yet), in
 * which case the container is emptied rather than showing a stale symbol.
 */
export function renderJoinQr(host: HTMLElement, pin: string): boolean {
  const url = currentJoinUrl(pin);
  if (!url) {
    host.replaceChildren();
    return false;
  }
  host.replaceChildren(qrSvg(url));
  host.setAttribute('data-join-url', url);
  return true;
}
