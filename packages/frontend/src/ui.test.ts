import { describe, expect, it } from 'vitest';

import { brand } from './ui.js';

describe('brand', () => {
  it('shows the supplied logo next to the product name', () => {
    const node = brand();

    expect(node.className).toBe('brand');
    expect(node.textContent).toBe('ZeroPeek');

    const logo = node.querySelector('img');
    expect(logo).not.toBeNull();
    // Served unchanged from the public directory; no hashing or rewriting.
    expect(logo?.getAttribute('src')).toBe('/logo.png');
    expect(logo?.className).toBe('brand__logo');
  });

  it('marks the logo as decorative so the name is announced once', () => {
    const logo = brand().querySelector('img');

    expect(logo?.getAttribute('alt')).toBe('');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
  });
});
