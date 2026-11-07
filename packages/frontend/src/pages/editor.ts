/**
 * Quiz management and editor (Phase 6.4).
 *
 * Two screens in one page:
 *
 *   - **Quiz management** – the list of quizzes with search, sorting and the
 *     usual actions, plus the metadata that helps pick one (question count,
 *     category, difficulty, last change).
 *   - **Editor** – one quiz at a time: metadata and a list of large question
 *     cards that can be reordered by drag or, for keyboard users, by the ↑/↓
 *     buttons.
 *
 * The server stays the authority for validation and permissions, exactly as
 * before: this page only mirrors the rules and never replaces them.
 *
 * Saving the question list replaces the quiz's questions on the server. That is
 * safe for history now, because a started game reads its questions from its own
 * immutable snapshot (Phase 6.4), so an edit here cannot change a round that has
 * already been played.
 */

import {
  LABEL_MAX,
  questionDisplay,
  QUESTION_TYPES,
  QUESTION_TYPE_IDS,
  validateQuiz,
  type Question,
  type QuestionType,
  type Quiz,
} from '@zeropeek/shared';

import { del, get, post, put, setCsrfToken, ApiError } from '../api.js';
import { el, render } from '../dom.js';
import { appShell } from '../navigation.js';
import { questionForm, newQuestion } from '../questionForm.js';
import { questionResult, solutionText } from '../questionView.js';
import {
  button,
  chip,
  confirmDialog,
  dialog,
  emptyState,
  errorText,
  field,
  skeleton,
  toast,
} from '../ui.js';

interface QuizSummary {
  id: string;
  title: string;
  description: string;
  theme: string;
  category: string | null;
  difficulty: string | null;
  questionCount: number;
  updatedAt: string;
}

type SortKey = 'updated' | 'title' | 'questions';

const appElement = document.getElementById('app');
if (!appElement) throw new Error('ZeroPeek: the #app element is missing.');
const app: HTMLElement = appElement;

{
  /** The quiz currently open, or null when on the list screen. */
  let current: Quiz | null = null;

  /** Whether the signed-in user is an administrator; widens the navigation. */
  let isAdmin = false;

  /** Redirect to the host login if the session has expired. */
  function handleAuth(error: unknown): void {
    if (error instanceof ApiError && error.status === 401) {
      location.href = './host.html';
      return;
    }
    toast(errorText(error), 'error');
  }

  /** A short, human "2 minutes ago" for the list. */
  function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  /** The quiz management screen. */
  async function showList(): Promise<void> {
    current = null;
    render(
      app,
      el('section', { class: 'wrap' }, skeleton('card'), skeleton('card'), skeleton('card')),
    );

    let quizzes: QuizSummary[];
    try {
      ({ quizzes } = await get<{ quizzes: QuizSummary[] }>('/api/quizzes'));
    } catch (error) {
      handleAuth(error);
      return;
    }

    const search = el('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Search quizzes…',
      'aria-label': 'Search quizzes',
    });
    const sort = el(
      'select',
      { class: 'input', 'aria-label': 'Sort quizzes' },
      el('option', { value: 'updated' }, 'Last changed'),
      el('option', { value: 'title' }, 'Title'),
      el('option', { value: 'questions' }, 'Question count'),
    );
    const count = el('p', { class: 'muted' });
    const list = el('ul', { class: 'quiz-list' });

    const quizRow = (quiz: QuizSummary): HTMLElement =>
      el(
        'li',
        { class: 'quiz-list__item card' },
        el(
          'div',
          { class: 'quiz-list__info' },
          el('h2', { class: 'quiz-list__title' }, quiz.title),
          el(
            'div',
            { class: 'quiz-list__meta' },
            chip(`${quiz.questionCount} question${quiz.questionCount === 1 ? '' : 's'}`, 'default'),
            quiz.category ? chip(quiz.category, 'accent') : null,
            quiz.difficulty ? chip(quiz.difficulty, 'cyan') : null,
            el('span', { class: 'muted' }, `changed ${relativeTime(quiz.updatedAt)}`),
          ),
          quiz.description ? el('p', { class: 'muted' }, quiz.description) : null,
        ),
        el(
          'div',
          { class: 'quiz-list__actions' },
          button('Edit', { variant: 'primary', onClick: () => void openQuiz(quiz.id) }),
          button('Start', {
            onClick: () => (location.href = `./host.html?quiz=${encodeURIComponent(quiz.id)}`),
          }),
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
            onClick: () => {
              confirmDialog({
                title: 'Delete this quiz?',
                body: `"${quiz.title}" and its questions will be removed. Games that were already played keep their own frozen copy, so their results and reports stay intact. This cannot be undone.`,
                confirmLabel: 'Delete quiz',
                onConfirm: () => {
                  void (async () => {
                    try {
                      await del(`/api/quizzes/${quiz.id}`);
                      toast('Quiz deleted.', 'success');
                      await showList();
                    } catch (error) {
                      handleAuth(error);
                    }
                  })();
                },
              });
            },
          }),
        ),
      );

    const paint = (): void => {
      const needle = search.value.trim().toLowerCase();
      const key = sort.value as SortKey;
      const visible = quizzes
        .filter((quiz) => {
          if (!needle) return true;
          return (
            quiz.title.toLowerCase().includes(needle) ||
            quiz.description.toLowerCase().includes(needle) ||
            (quiz.category ?? '').toLowerCase().includes(needle) ||
            (quiz.difficulty ?? '').toLowerCase().includes(needle)
          );
        })
        .sort((a, b) => {
          if (key === 'title') return a.title.localeCompare(b.title);
          if (key === 'questions') return b.questionCount - a.questionCount;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });

      count.textContent = `Showing ${visible.length} of ${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'}`;
      list.replaceChildren(
        ...(visible.length === 0
          ? [
              el(
                'li',
                { class: 'card' },
                emptyState(
                  quizzes.length === 0 ? 'No quizzes yet' : 'Nothing matches',
                  quizzes.length === 0
                    ? 'Create your first quiz or import one.'
                    : 'Try a different search term.',
                ),
              ),
            ]
          : visible.map((quiz) => quizRow(quiz))),
      );
    };

    search.addEventListener('input', paint);
    sort.addEventListener('change', paint);

    render(
      app,
      appShell({
        role: 'host',
        active: 'quizzes',
        badge: 'Editor',
        isAdmin,
        title: 'Your quizzes',
        actions: [
          button('New quiz', { variant: 'primary', onClick: () => void createQuiz() }),
          button('Import', { onClick: () => void importQuiz() }),
        ],
        children: [
          el(
            'div',
            { class: 'quiz-list__toolbar card' },
            field('Search', search),
            field('Sort by', sort),
          ),
          count,
          list,
        ],
      }),
    );
    paint();
  }

  async function createQuiz(): Promise<void> {
    try {
      // The server requires at least one question, so seed the new quiz with a
      // single choice question and open it for editing.
      const first = newQuestion('single');
      first.text = 'New question';
      const quiz = await post<Quiz>('/api/quizzes', {
        title: 'New quiz',
        questions: [first],
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
    const category = el('input', {
      class: 'input',
      value: quiz.category ?? '',
      maxlength: String(LABEL_MAX),
      placeholder: 'e.g. Geography (optional)',
    });
    const difficulty = el('input', {
      class: 'input',
      value: quiz.difficulty ?? '',
      maxlength: String(LABEL_MAX),
      placeholder: 'e.g. Mixed (optional)',
    });

    const list = el('div', { class: 'editor__questions' });
    /** The index being dragged, or null. */
    let dragFrom: number | null = null;

    const move = (from: number, to: number): void => {
      if (to < 0 || to >= quiz.questions.length || from === to) return;
      const [item] = quiz.questions.splice(from, 1);
      quiz.questions.splice(to, 0, item!);
      paintQuestions();
    };

    const paintQuestions = (): void => {
      list.replaceChildren(
        ...quiz.questions.map((question, index) => {
          const article = el(
            'article',
            { class: 'editor__question card anim-fade-in', draggable: 'true' },
            el(
              'header',
              { class: 'editor__question-head' },
              el(
                'span',
                { class: 'editor__heading' },
                el('span', { class: 'editor__position' }, `#${index + 1}`),
                el(
                  'span',
                  { class: 'editor__badge' },
                  QUESTION_TYPES[question.type as QuestionType]?.label ?? question.type,
                ),
                question.category ? chip(question.category, 'accent') : null,
                question.difficulty ? chip(question.difficulty, 'cyan') : null,
              ),
              el(
                'span',
                { class: 'editor__controls' },
                button('↑', {
                  ariaLabel: `Move question ${index + 1} up`,
                  disabled: index === 0,
                  onClick: () => move(index, index - 1),
                }),
                button('↓', {
                  ariaLabel: `Move question ${index + 1} down`,
                  disabled: index === quiz.questions.length - 1,
                  onClick: () => move(index, index + 1),
                }),
                button('Preview', {
                  ariaLabel: `Preview question ${index + 1}`,
                  onClick: () => previewQuestion(question),
                }),
                button('Remove', {
                  variant: 'danger',
                  ariaLabel: `Remove question ${index + 1}`,
                  // A quiz must keep at least one question (server rule), so the
                  // last remaining question cannot be removed.
                  disabled: quiz.questions.length === 1,
                  onClick: () => {
                    if (quiz.questions.length === 1) return;
                    quiz.questions.splice(index, 1);
                    paintQuestions();
                  },
                }),
              ),
            ),
            questionForm(question, (updated) => {
              quiz.questions[index] = updated;
            }),
          );

          // Pointer drag-and-drop. The ↑/↓ buttons above are the keyboard
          // alternative required for accessibility, so this only adds a second,
          // optional way to reorder.
          article.addEventListener('dragstart', (event) => {
            dragFrom = index;
            article.classList.add('editor__question--dragging');
            event.dataTransfer?.setData('text/plain', String(index));
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          });
          article.addEventListener('dragend', () => {
            dragFrom = null;
            article.classList.remove('editor__question--dragging');
            list
              .querySelectorAll('.editor__question--over')
              .forEach((node) => node.classList.remove('editor__question--over'));
          });
          article.addEventListener('dragover', (event) => {
            event.preventDefault();
            article.classList.add('editor__question--over');
          });
          article.addEventListener('dragleave', () =>
            article.classList.remove('editor__question--over'),
          );
          article.addEventListener('drop', (event) => {
            event.preventDefault();
            article.classList.remove('editor__question--over');
            if (dragFrom === null) return;
            move(dragFrom, index);
          });

          return article;
        }),
      );
      if (quiz.questions.length === 0) {
        list.append(emptyState('No questions yet', 'Add your first question below.'));
      }
    };

    const addSelect = el(
      'select',
      { class: 'input', 'aria-label': 'Question type' },
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
          category: category.value.trim() || undefined,
          difficulty: difficulty.value.trim() || undefined,
        };
        // Validate locally first so obvious mistakes are caught without a round
        // trip; the server validates again and is authoritative.
        const result = validateQuiz(payload);
        if (!result.ok) {
          showIssues(result.issues);
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

    /**
     * Show field-level validation messages and mark the offending cards, so the
     * author sees *where* the problem is instead of a bare list of paths.
     */
    const showIssues = (issues: Array<{ path: string; message: string }>): void => {
      list.querySelectorAll('.editor__issues').forEach((node) => node.remove());
      list
        .querySelectorAll('.editor__question--invalid')
        .forEach((node) => node.classList.remove('editor__question--invalid'));
      let firstBad: HTMLElement | null = null;
      let unplaced = 0;
      for (const issue of issues) {
        const match = /^questions[.[](\d+)[\]]?/.exec(issue.path);
        if (!match) {
          unplaced += 1;
          continue;
        }
        const index = Number(match[1]);
        const card = list.children[index] as HTMLElement | undefined;
        if (!card) continue;
        card.classList.add('editor__question--invalid');
        const box = card.querySelector('.editor__issues') ?? el('div', { class: 'editor__issues' });
        box.append(el('p', { class: 'editor__issue' }, `${issue.path}: ${issue.message}`));
        card.append(box);
        firstBad ??= card;
      }
      if (firstBad) {
        firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const total = issues.length;
      toast(
        unplaced > 0
          ? `${total} problem(s) to fix: ${issues.map((issue) => issue.path).join(', ')}`
          : `${total} problem(s) to fix in the marked questions.`,
        'error',
      );
    };

    // Metadata autosave. Only the title/description/category/difficulty are
    // autosaved – deliberately not the question list, which is replaced wholesale
    // on the server and is only written by an explicit Save.
    const saveState = el('span', { class: 'editor__save-state muted' }, 'all changes saved');
    let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleAutosave = (): void => {
      saveState.textContent = 'saving…';
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        void (async () => {
          if (!current) return;
          const next: Quiz = {
            ...current,
            title: title.value.trim() || current.title,
            description: description.value.trim(),
            category: category.value.trim() || undefined,
            difficulty: difficulty.value.trim() || undefined,
          };
          if (!validateQuiz(next).ok) {
            saveState.textContent = 'not saved – check the title';
            return;
          }
          try {
            current = await put<Quiz>(`/api/quizzes/${current.id}`, next);
            saveState.textContent = 'all changes saved';
          } catch {
            saveState.textContent = 'could not save';
          }
        })();
      }, 900);
    };
    for (const input of [title, description, category, difficulty]) {
      input.addEventListener('input', scheduleAutosave);
    }

    paintQuestions();
    render(
      app,
      appShell({
        role: 'host',
        active: 'quizzes',
        badge: 'Editor',
        isAdmin,
        title: 'Edit quiz',
        actions: [button('Back', { onClick: () => void showList() }), saveButton],
        children: [
          el(
            'div',
            { class: 'card editor__meta' },
            el(
              'div',
              { class: 'grid grid--2' },
              field('Title', title),
              field('Description', description),
            ),
            el(
              'div',
              { class: 'grid grid--2' },
              field('Category', category),
              field('Difficulty', difficulty),
            ),
            saveState,
          ),
          el(
            'div',
            { class: 'editor__section-head' },
            el('h2', { class: 'section-title' }, 'Questions'),
            el('span', { class: 'muted' }, 'Drag to reorder, or use ↑ / ↓'),
          ),
          list,
          el(
            'div',
            { class: 'card editor__add' },
            el('h3', null, 'Add a question'),
            addSelect,
            addButton,
          ),
        ],
      }),
    );
  }

  /** Show a preview of one question as the player would see it. */
  function previewQuestion(question: Question): void {
    const label = QUESTION_TYPES[question.type as QuestionType]?.label ?? question.type;
    const { close } = dialog({
      title: 'Preview',
      body: el(
        'div',
        null,
        el('p', { class: 'muted' }, label),
        questionResult(
          { text: question.text, type: question.type, display: questionDisplay(question) },
          {},
          solutionText(question),
        ),
      ),
      actions: [button('Close', { variant: 'ghost', onClick: () => close() })],
    });
  }

  // Bootstrap the CSRF token before any write. The editor is its own page, so
  // it cannot rely on the host page having logged in already.
  void (async () => {
    try {
      const session = await get<{ user: { role?: string } | null; csrfToken?: string }>(
        '/api/auth/me',
      );
      if (!session.user) {
        location.href = './host.html';
        return;
      }
      isAdmin = session.user.role === 'ADMIN';
      if (session.csrfToken) setCsrfToken(session.csrfToken);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        location.href = './host.html';
        return;
      }
      toast(errorText(error), 'error');
    }
    await showList();
  })();
}
