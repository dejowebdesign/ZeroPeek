import { describe, expect, it } from 'vitest';

import { brand, pageHeader } from './ui.js';

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
