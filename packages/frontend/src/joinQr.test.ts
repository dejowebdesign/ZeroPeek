/**
 * The lobby join QR code (Phase 6.14).
 *
 * The symbol itself is opaque, so these tests pin the two things that can
 * actually be wrong: the URL a phone will open, and the shape of the SVG the
 * strict CSP allows. Decoding a real code is done once, outside the suite, with
 * an independent decoder — a self-written decoder would only re-test the
 * encoder's own assumptions.
 */

import { describe, expect, it } from 'vitest';

import { currentJoinUrl, joinUrl, qrSvg, renderJoinQr } from './joinQr.js';

describe('join URL (Phase 6.14)', () => {
  it('carries the PIN as a query parameter, so a scan lands in the right lobby', () => {
    expect(joinUrl('https://zeropeek.xubi.org', 'ACD234')).toBe(
      'https://zeropeek.xubi.org/?pin=ACD234',
    );
  });

  it('upper-cases the PIN, matching the canonical form the server seats', () => {
    expect(joinUrl('https://zeropeek.xubi.org', ' acd234 ')).toBe(
      'https://zeropeek.xubi.org/?pin=ACD234',
    );
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(joinUrl('https://zeropeek.xubi.org/', 'ACD234')).toBe(
      'https://zeropeek.xubi.org/?pin=ACD234',
    );
  });

  it('encodes a PIN so the URL stays well formed', () => {
    // Not a legal PIN, but the composer must never emit a broken URL regardless.
    expect(joinUrl('https://example.test', 'A B')).toContain('pin=A%20B');
  });

  it('returns null for a blank PIN, so no code is drawn for a bare landing page', () => {
    expect(currentJoinUrl('')).toBeNull();
    expect(currentJoinUrl('   ')).toBeNull();
  });

  it('uses the current origin, so the code works behind the public domain', () => {
    expect(currentJoinUrl('ACD234')).toBe(joinUrl(location.origin, 'ACD234'));
  });
});

describe('QR symbol (Phase 6.14)', () => {
  const svg = (): SVGSVGElement => qrSvg('https://zeropeek.xubi.org/?pin=ACD234');

  it('is an inline SVG, not an image request or a canvas', () => {
    const node = svg();
    expect(node.tagName.toLowerCase()).toBe('svg');
    expect(node.getAttribute('data-join-qr')).toBe('');
    expect(node.querySelector('image')).toBeNull();
  });

  it('scales from a viewBox, so it stays sharp on a projector', () => {
    const node = svg();
    expect(node.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    // A fixed pixel width would blur when scaled up; the caller sizes the box.
    expect(node.getAttribute('width')).toBeNull();
    expect(node.getAttribute('height')).toBeNull();
  });

  it('paints dark modules on a light field, the only reliably scannable pairing', () => {
    const node = svg();
    const background = node.querySelector('rect');
    expect(background?.getAttribute('fill')).toBe('#ffffff');
    expect(node.querySelector('path')?.getAttribute('fill')).toBe('#000000');
  });

  it('includes a quiet zone, so the symbol survives a projector and an angled phone', () => {
    const node = svg();
    const [width, height] = (node.getAttribute('viewBox') ?? '').split(' ').slice(2).map(Number);
    // Four modules of margin on each side: the payload is smaller than the box.
    expect(width).toBe(height);
    expect(width).toBeGreaterThan(21 + 8);
  });

  it('is described for assistive technology', () => {
    expect(svg().getAttribute('aria-label')).toBe(
      'QR code for https://zeropeek.xubi.org/?pin=ACD234',
    );
  });

  it('encodes a longer URL in a denser symbol, so the payload really is the input', () => {
    const short = qrSvg('https://a.test/?pin=ACD234');
    const long = qrSvg(`https://a.test/?pin=ACD234&pad=${'x'.repeat(120)}`);
    const size = (node: SVGSVGElement): number =>
      Number((node.getAttribute('viewBox') ?? '').split(' ')[2]);
    expect(size(long)).toBeGreaterThan(size(short));
  });
});

describe('rendering the join QR (Phase 6.14)', () => {
  it('replaces the previous symbol, so a new PIN never leaves a stale code', () => {
    const host = document.createElement('div');
    expect(renderJoinQr(host, 'ACD234')).toBe(true);
    const first = host.querySelector('svg');
    expect(renderJoinQr(host, 'XYZ679')).toBe(true);
    expect(host.querySelectorAll('svg')).toHaveLength(1);
    expect(host.querySelector('svg')).not.toBe(first);
    expect(host.getAttribute('data-join-url')).toContain('XYZ679');
  });

  it('empties the container when there is no usable PIN', () => {
    const host = document.createElement('div');
    renderJoinQr(host, 'ACD234');
    expect(renderJoinQr(host, '')).toBe(false);
    expect(host.querySelector('svg')).toBeNull();
  });
});
