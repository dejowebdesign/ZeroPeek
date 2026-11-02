/**
 * Player entry point (Phase 0 placeholder).
 *
 * Renders a join screen skeleton. The real PIN join, avatar picker, question
 * screens and Socket.IO wiring arrive in Phases 4–6.
 */

import { QUESTION_TYPE_IDS } from '@zeropeek/shared';

import { el, render } from '../dom.js';

const app = document.getElementById('app');

if (app) {
  render(
    app,
    el(
      'section',
      { class: 'centered' },
      el(
        'form',
        { class: 'card', style: { maxWidth: '420px', width: '100%' } },
        el('span', { class: 'brand' }, 'ZeroPeek'),
        el('h1', { style: { marginTop: 'var(--space-5)', fontSize: '1.4rem' } }, 'Join a game'),
        el('p', { class: 'muted' }, 'Enter the PIN shown on the big screen.'),
        el('input', {
          class: 'input',
          inputmode: 'numeric',
          maxlength: '6',
          placeholder: '000000',
          'aria-label': 'Game PIN',
        }),
        el('input', {
          class: 'input',
          maxlength: '16',
          placeholder: 'Your name',
          'aria-label': 'Name',
          style: { marginTop: 'var(--space-3)' },
        }),
        el(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            style: { marginTop: 'var(--space-4)', width: '100%' },
          },
          'Join',
        ),
        el(
          'p',
          { class: 'muted', style: { fontSize: '0.8rem', marginTop: 'var(--space-4)' } },
          `Phase 0 scaffold · ${QUESTION_TYPE_IDS.length} question types defined`,
        ),
      ),
    ),
  );
}
