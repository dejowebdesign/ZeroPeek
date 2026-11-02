/**
 * Host entry point (Phase 0 placeholder).
 *
 * Renders a host landing skeleton. Login, quiz selection, lobby and game
 * control arrive in Phases 2–6.
 */

import { el, render } from '../dom.js';

const app = document.getElementById('app');

if (app) {
  render(
    app,
    el(
      'section',
      { class: 'centered' },
      el(
        'div',
        { class: 'card', style: { maxWidth: '520px', width: '100%' } },
        el('span', { class: 'brand' }, 'ZeroPeek'),
        el('h1', { style: { marginTop: 'var(--space-5)', fontSize: '1.4rem' } }, 'Host area'),
        el('p', { class: 'muted' }, 'Sign in to create a game and control it from the big screen.'),
        el(
          'p',
          { class: 'muted', style: { fontSize: '0.8rem', marginTop: 'var(--space-4)' } },
          'Phase 0 scaffold – authentication and game control are implemented in later phases.',
        ),
      ),
    ),
  );
}
