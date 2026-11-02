/**
 * Quiz editor: create, edit, reorder, preview, import and export quizzes.
 *
 * The editor holds the quiz in memory and persists it with a PUT. It builds an
 * edit form per question type through `questionForm`, and every save is
 * validated by the server (the shared validator), so an invalid quiz is
 * rejected with field-level messages rather than stored.
 */

import {
  questionDisplay,
  QUESTION_TYPES,
  QUESTION_TYPE_IDS,
  validateQuiz,
  type Question,
  type QuestionType,
  type Quiz,
} from '@zeropeek/shared';

import { del, get, post, put, ApiError } from '../api.js';
import { el, render } from '../dom.js';
import { questionForm, newQuestion } from '../questionForm.js';
import { questionResult, solutionText } from '../questionView.js';
import { button, errorText, field, pageHeader, toast } from '../ui.js';

interface QuizSummary {
  id: string;
  title: string;
  description: string;
  theme: string;
  questionCount: number;
  updatedAt: string;
}

const appElement = document.getElementById('app');
if (!appElement) throw new Error('ZeroPeek: the #app element is missing.');
const app: HTMLElement = appElement;

{
  /** The quiz currently open, or null when on the list screen. */
  let current: Quiz | null = null;

  /** Redirect to the host login if the session has expired. */
  function handleAuth(error: unknown): void {
    if (error instanceof ApiError && error.status === 401) {
      location.href = './host.html';
      return;
    }
    toast(errorText(error), 'error');
  }

  /** The quiz list screen. */
  async function showList(): Promise<void> {
    current = null;
    render(app, el('p', { class: 'muted' }, 'Loading quizzes…'));
    try {
      const { quizzes } = await get<{ quizzes: QuizSummary[] }>('/api/quizzes');
      render(
        app,
        el(
          'section',
          { class: 'wrap' },
          pageHeader('Your quizzes', [
            button('New quiz', { variant: 'primary', onClick: () => void createQuiz() }),
            button('Import', { onClick: () => void importQuiz() }),
          ]),
          quizzes.length === 0
            ? el('p', { class: 'muted' }, 'No quizzes yet. Create your first one.')
            : el(
                'ul',
                { class: 'quiz-list' },
                ...quizzes.map((quiz) =>
                  el(
                    'li',
                    { class: 'quiz-list__item card' },
                    el(
                      'div',
                      null,
                      el('h2', { class: 'quiz-list__title' }, quiz.title),
                      el(
                        'p',
                        { class: 'muted' },
                        `${quiz.questionCount} question(s) · ${quiz.description || 'No description'}`,
                      ),
                    ),
                    el(
                      'div',
                      { class: 'quiz-list__actions' },
                      button('Edit', { variant: 'primary', onClick: () => void openQuiz(quiz.id) }),
                      button('Duplicate', {
                        onClick: async () => {
                          try {
                            await post(`/api/quizzes/${quiz.id}/duplicate`);
                            toast('Quiz duplicated.', 'success');
                            await showList();
                          } catch (error) {
                            handleAuth(error);
                          }
                        },
                      }),
                      button('Export', {
                        onClick: () => {
                          location.href = `/api/quizzes/${quiz.id}/export`;
                        },
                      }),
                      button('Delete', {
                        variant: 'danger',
                        onClick: async () => {
                          if (!confirm(`Delete "${quiz.title}"?`)) return;
                          try {
                            await del(`/api/quizzes/${quiz.id}`);
                            toast('Quiz deleted.', 'success');
                            await showList();
                          } catch (error) {
                            handleAuth(error);
                          }
                        },
                      }),
                    ),
                  ),
                ),
              ),
        ),
      );
    } catch (error) {
      handleAuth(error);
    }
  }

  async function createQuiz(): Promise<void> {
    try {
      const quiz = await post<Quiz>('/api/quizzes', {
        title: 'New quiz',
        questions: [],
      });
      await openQuiz(quiz.id);
    } catch (error) {
      handleAuth(error);
    }
  }

  async function openQuiz(id: string): Promise<void> {
    try {
      current = await get<Quiz>(`/api/quizzes/${id}`);
      showEditor();
    } catch (error) {
      handleAuth(error);
    }
  }

  function importQuiz(): void {
    const input = el('input', { type: 'file', accept: 'application/json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as Partial<Quiz>;
        const quiz = await post<Quiz>('/api/quizzes/import', parsed);
        toast('Quiz imported.', 'success');
        await openQuiz(quiz.id);
      } catch (error) {
        handleAuth(error);
      }
    });
    input.click();
  }

  /** The editor screen for `current`. */
  function showEditor(): void {
    const quiz = current;
    if (!quiz) return;

    const title = el('input', { class: 'input', value: quiz.title, maxlength: '120' });
    const description = el('input', {
      class: 'input',
      value: quiz.description,
      placeholder: 'Description (optional)',
    });

    const list = el('div', { class: 'editor__questions' });

    const paintQuestions = (): void => {
      list.replaceChildren(
        ...quiz.questions.map((question, index) =>
          el(
            'article',
            { class: 'editor__question card' },
            el(
              'header',
              { class: 'editor__question-head' },
              el(
                'span',
                { class: 'editor__badge' },
                QUESTION_TYPES[question.type as QuestionType]?.label ?? question.type,
              ),
              el(
                'span',
                { class: 'editor__controls' },
                button('↑', {
                  onClick: () => {
                    if (index === 0) return;
                    [quiz.questions[index - 1], quiz.questions[index]] = [
                      quiz.questions[index]!,
                      quiz.questions[index - 1]!,
                    ];
                    paintQuestions();
                  },
                }),
                button('↓', {
                  onClick: () => {
                    if (index === quiz.questions.length - 1) return;
                    [quiz.questions[index + 1], quiz.questions[index]] = [
                      quiz.questions[index]!,
                      quiz.questions[index + 1]!,
                    ];
                    paintQuestions();
                  },
                }),
                button('Preview', {
                  onClick: () => previewQuestion(question),
                }),
                button('Remove', {
                  variant: 'danger',
                  onClick: () => {
                    quiz.questions.splice(index, 1);
                    paintQuestions();
                  },
                }),
              ),
            ),
            questionForm(question, (updated) => {
              quiz.questions[index] = updated;
            }),
          ),
        ),
      );
      if (quiz.questions.length === 0) {
        list.append(el('p', { class: 'muted' }, 'No questions yet. Add one below.'));
      }
    };

    const addSelect = el(
      'select',
      { class: 'input' },
      ...QUESTION_TYPE_IDS.map((id) =>
        el(
          'option',
          { value: id },
          `${QUESTION_TYPES[id].label} – ${QUESTION_TYPES[id].description}`,
        ),
      ),
    );
    const addButton = button('Add question', {
      variant: 'primary',
      onClick: () => {
        quiz.questions.push(newQuestion(addSelect.value as QuestionType, quiz.defaultTimeLimit));
        paintQuestions();
        list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
    });

    const saveButton = button('Save', {
      variant: 'primary',
      onClick: async () => {
        const payload: Quiz = {
          ...quiz,
          title: title.value.trim(),
          description: description.value.trim(),
        };
        // Validate locally first so obvious mistakes are caught without a round
        // trip; the server validates again and is authoritative.
        const result = validateQuiz(payload);
        if (!result.ok) {
          toast(`Invalid: ${result.issues.map((issue) => issue.path).join(', ')}`, 'error');
          return;
        }
        try {
          current = await put<Quiz>(`/api/quizzes/${quiz.id}`, payload);
          toast('Saved.', 'success');
          showEditor();
        } catch (error) {
          handleAuth(error);
        }
      },
    });

    paintQuestions();
    render(
      app,
      el(
        'section',
        { class: 'wrap' },
        pageHeader('Edit quiz', [button('Back', { onClick: () => void showList() }), saveButton]),
        el(
          'div',
          { class: 'card editor__meta' },
          field('Title', title),
          field('Description', description),
        ),
        el('h2', { class: 'section-title' }, 'Questions'),
        list,
        el(
          'div',
          { class: 'card editor__add' },
          el('h3', null, 'Add a question'),
          addSelect,
          addButton,
        ),
      ),
    );
  }

  /** Show a preview of one question as the player would see it. */
  function previewQuestion(question: Question): void {
    const dialog = el(
      'div',
      { class: 'overlay' },
      el(
        'div',
        { class: 'card overlay__panel' },
        el('h2', null, 'Preview'),
        el(
          'p',
          { class: 'muted' },
          QUESTION_TYPES[question.type as QuestionType]?.label ?? question.type,
        ),
        questionResult(
          { text: question.text, type: question.type, display: questionDisplay(question) },
          {},
          solutionText(question),
        ),
        el(
          'div',
          { class: 'overlay__actions' },
          button('Close', { onClick: () => dialog.remove() }),
        ),
      ),
    );
    document.body.append(dialog);
  }

  void showList();
}
