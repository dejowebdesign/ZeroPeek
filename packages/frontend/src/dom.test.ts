import { describe, expect, it } from 'vitest';

import { el, render } from './dom.js';

describe('el', () => {
  it('creates an element with text content (never innerHTML for user data)', () => {
    const node = el('p', { class: 'muted' }, 'hello <b>world</b>');
    expect(node.tagName).toBe('P');
    expect(node.className).toBe('muted');
    expect(node.textContent).toBe('hello <b>world</b>');
    expect(node.children).toHaveLength(0);
  });

  it('sets CSS custom properties and kebab-cases style keys', () => {
    const node = el('div', { style: { '--accent': '#fff', maxWidth: '10px' } });
    expect(node.style.getPropertyValue('--accent')).toBe('#fff');
    expect(node.style.maxWidth).toBe('10px');
  });

  it('wires event listeners passed as on* functions', () => {
    let clicked = false;
    const node = el('button', { onclick: () => (clicked = true) });
    node.dispatchEvent(new Event('click'));
    expect(clicked).toBe(true);
  });

  it('skips null, undefined and false children', () => {
    const node = el('div', null, null, undefined, false, 'x');
    expect(node.textContent).toBe('x');
  });
});

describe('render', () => {
  it('replaces the root contents', () => {
    const root = document.createElement('main');
    root.append(document.createElement('span'));
    render(root, el('section'));
    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild?.tagName).toBe('SECTION');
  });
});
