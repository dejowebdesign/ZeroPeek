# ZeroPeek – Agent Development Contract

These repository-level instructions apply to Agent Zero, Codex, and other coding agents. Use the current repository state and applicable documentation; do not treat prior chat history as repository evidence. The project owner's development policy and the supplied dashboard reference images are binding. If authoritative inputs conflict, document the conflict and ask the project owner instead of choosing unilaterally.

## 1. Project and architecture

ZeroPeek is an independent real-time quiz platform: a host operates a quiz on a large screen/projector while participants join by PIN from their own devices. It is an npm-workspace monorepo:

- `packages/shared`: runtime-neutral TypeScript domain types, validation, question contracts, scoring, and Socket.IO event contracts; single source of truth shared by client and server.
- `packages/frontend`: Vanilla TypeScript + Vite multi-page client, CSS custom properties, DOM helpers, and separate player, host, editor, and other page entry points. No UI framework.
- `packages/backend`: Node.js, Fastify 5, Socket.IO 4, PostgreSQL 16, and Prisma; owns APIs, authenticated realtime flows, and authoritative game state.
- Docker/Compose and Caddy are the documented deployment architecture. Environment configuration belongs in environment variables, not image-baked secrets.

Follow the existing ADRs in `docs/architecture/`, the product/design concepts in `docs/concept/`, the implementation design-system contract in `docs/design/design-system.md`, and `docs/contributing.md`. Do not introduce foundational architecture changes, duplicate existing functionality, or add dependencies without a concrete need.

## 2. Technical and code-quality requirements

- Keep changes focused, maintainable, and compatible with existing module boundaries and interfaces. Inspect the affected implementation and tests before editing.
- TypeScript is strict. Use accurate types; avoid unjustified `any`, unsafe casts, duplicated code, unnecessary dependencies, and short-term workarounds that hide defects.
- Preserve backward compatibility unless the task explicitly changes it. Consider security, errors, and performance as part of implementation quality.
- Shared code remains runtime-agnostic: no `node:` imports or DOM APIs in `packages/shared`.
- Frontend user content is rendered with existing DOM helpers and `textContent`; never interpolate user-supplied content through `innerHTML`. Follow the strict CSP: no inline scripts, and dynamic styles use the established CSSOM approach rather than inline style attributes.
- Validate external/API/socket input using existing schemas and validators. Authorization remains server-side; a UI visibility decision is never an authorization check.
- Do not make broad refactors or change existing behavior without a demonstrated reason and focused regression coverage.

## 3. Player and Host/Beamer dashboards – separate authoritative references

The original, unmodified reference images are stored at:

- `docs/design/references/player-dashboard.png` — **Player dashboard**: the personal in-game view each participant sees on their own device.
- `docs/design/references/host-beamer-dashboard.png` — **Host/Beamer dashboard**: the host's combined game-control and audience presentation view on the host screen/projector.

The accompanying specification is `docs/design/dashboard-reference.md`. Both images are binding visual targets, not optional inspiration. Preserve each image's visual hierarchy, character, and role-specific structure. Do not replace either with a generic dashboard, independently simplify it, or merge the two role experiences into one. Assess and implement each separately, referring to the originals for layout, relative sizing/placement, typography, color/background, cards/information regions, spacing/alignment, question and answers, timer/status, score/rank/player information, game phases, finale/podium, and responsive adaptation. Preserve the visual hierarchy when adapting to viewport sizes.

The repository design direction and existing tokens remain authoritative alongside the images: dark retro-futuristic wireframe and glassmorphism, dark base, cyan/violet/magenta brand accents, legible layered glass, token-based styles, restrained meaningful motion, and accessible responsive behavior. Read `docs/design/design-system.md` and `docs/concept/design-concept.md` before dashboard/design work. Do not silently change existing token values or invent a competing visual system; follow the documented system and its tests.

## 4. Functional and architectural invariants

Visual work must adapt to the existing game architecture, never the reverse. Preserve, unless a task explicitly and safely requires otherwise:

- server-authoritative game state and server validation;
- question delivery, answer submission, answer/result behavior, and host/player synchronization;
- server timer/deadline and clock synchronization (client clock correction is display-only);
- scoring and ranking calculations and their existing source data;
- host and player identity separation, authentication, authorization, and session boundaries;
- Socket.IO namespaces, event names/contracts, acknowledgements, permissions, and reconnect behavior;
- music and sound controls, finale and podium behavior;
- existing backend APIs, database schema, and Prisma migrations.

Do not invent player, score, phase, or connection data when the server does not supply it. Reuse existing contracts, selectors, components, and helpers. Keep host controls and public presentation visually distinguishable within the combined Host/Beamer surface documented by the product concept; the Player dashboard is a distinct participant-facing surface.

## 5. Security and error handling

Follow `docs/architecture/0006-security-model.md` and the security requirements in the owning package. Preserve HTTPS/CSP-compatible behavior, HttpOnly context-specific sessions, CSRF protections, server-side role enforcement, schema validation, and rate limiting. Do not log or commit credentials, tokens, `.env` files, production data, or private user data. Handle failures through existing typed/error patterns; do not suppress errors or bypass validation to make a test pass.

## 6. Git and GitHub workflow

Every code or documentation change is delivered through a dedicated feature branch and a pull request targeting `main`:

1. Inspect `git status`, current branch, relevant open PRs, and applicable local instructions.
2. Create/use a dedicated branch; never work directly on or commit to `main`.
3. Preserve pre-existing staged, unstaged, and untracked work. Do not overwrite or delete it. Stage only intended paths; never use blanket staging when unrelated files exist.
4. Commit and push only the task branch, then create a PR against `main` documenting scope and actual checks.
5. Never merge or close PRs, overwrite another PR/branch, or publish unrelated local files.

## 7. Token-efficient verification

Run only checks relevant to the change, but do not omit a necessary quality gate. Prefer focused tests for focused changes; run the applicable TypeScript typecheck for TypeScript changes and relevant design-system tests for visual/token/CSS changes. For gameplay changes, cover directly affected game-flow contracts. Do not repeat identical checks without a code change. Diagnose failures before retrying; never weaken or delete tests to obtain a green result. State exactly which checks ran, their real result, and checks not run. For documentation/reference-only changes, verify the created files, image integrity, and Git diff; do not run the full application test suite without a reason.

## 8. Pull-request report

Each PR description and final report must state:

1. What changed and which files changed.
2. Existing functionality and modules affected.
3. Relevant technical/design decisions.
4. Tests/checks actually executed and their results.
5. Checks deliberately not run.
6. Known risks, limitations, or manual acceptance still outstanding.
7. The direct GitHub PR URL.

A PR is not proof of correctness; report only verified outcomes.

## 9. Production and deployment restrictions

The production site `https://zeropeek.xubi.org/` and production data are reserved for the project owner. Do not open or test the production site, alter production data, deploy, use Portainer, or merge. The project owner performs review/merge decisions, deployment, and manual post-deployment acceptance. Use a local development environment for any permitted local browser testing; if unavailable, clearly state that manual browser acceptance remains pending.
