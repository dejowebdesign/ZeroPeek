# Contributing

## Branching

- `main` is the stable branch. It must always build and pass tests.
- Develop every feature on a dedicated branch, e.g. `phase-1/quiz-domain`,
  `feat/editor-drag-drop`, `fix/socket-reconnect`.
- Integrate through a **pull request**; never push unreviewed changes to `main`.

## Commits

Write meaningful commit messages. A short imperative subject line, then a body explaining _why_:

```
Add shared question schema for the 13 question types

The editor and the engine must validate against the same definition, so the
schema lives in @zeropeek/shared and is imported by both sides.
```

## Before opening a pull request

1. `npm run build` succeeds.
2. `npm test` passes.
3. `npm run typecheck` is clean.
4. Documentation updated if behaviour or architecture changed.

## Pull request contents

Every pull request must include:

1. Summary of the changes.
2. Affected modules.
3. Changed files.
4. Test results.
5. Known limitations.
6. Notes on required migrations.

## Code conventions

- TypeScript strict mode; no `any` without justification.
- `@zeropeek/shared` stays runtime-agnostic (no `node:` imports, no DOM APIs).
- No `innerHTML` with user-supplied data; build DOM nodes and set `textContent`.
- Dynamic styles via the CSSOM to stay compatible with the strict CSP.
- Format with Prettier (`npm run format`).
