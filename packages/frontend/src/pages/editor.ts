/**
 * Editor entry point (Phase 0 placeholder).
 *
 * Renders an editor landing skeleton and lists the 13 supported question types
 * from the shared domain. The full editor arrives in Phase 3.
 */

import { QUESTION_TYPES, QUESTION_TYPE_IDS } from '@zeropeek/shared';

import { el, render } from '../dom.js';

const app = document.getElementById('app');

if (app) {
  render(
    app,
    el(
      'section',
      { class: 'wrap' },
      el('span', { class: 'brand' }, 'ZeroPeek'),
      el('h1', { style: { marginTop: 'var(--space-5)' } }, 'Quiz editor'),
      el('p', { class: 'muted' }, 'Supported question types:'),
      el(
        'ul',
        { style: { lineHeight: '1.9' } },
        ...QUESTION_TYPE_IDS.map((id) =>
          el('li', null, `${QUESTION_TYPES[id].label} – ${QUESTION_TYPES[id].description}`),
        ),
      ),
      el(
        'p',
        { class: 'muted', style: { fontSize: '0.8rem', marginTop: 'var(--space-4)' } },
        'Phase 0 scaffold – the editor UI is implemented in Phase 3.',
      ),
    ),
  );
}
