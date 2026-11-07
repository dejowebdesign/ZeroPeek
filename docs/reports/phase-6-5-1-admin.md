# Phase 6.5.1 – Admin modernisation (report)

- **Branch:** `feat/phase-6-5-1-admin`
- **Base:** `main` after PR #26 (`fe015eb`)
- **Scope:** the admin user-management surface (roadmap §6, "Admin und Host")
- **Status:** implemented, awaiting review

This phase rebuilds the admin dashboard on the existing design system and closes one
server-side lock-out gap. It adds no dependency, no table and no column. No user account,
role, permission, question, answer or running-game behaviour is removed or rewritten.

## 1. What changed

```
POST /api/admin/users/:id/disabled
        │
        ├─ last active admin?            ──► 409  (unchanged, checked first)
        ├─ target is the caller?         ──► 403  (new)
        └─ otherwise                     ──► 200

admin.html ──► pages/admin.ts ──► appShell + card/chip/statTile/report-table
                                    │
                    ┌───────────────┼────────────────┐
                 summary         create form      account table
                                    │                 │
                        per-field validation    confirm dialogs for
                        (shared validators)     role change + disable
```

## 2. Backend – the lock-out rule

`POST /api/admin/users/:id/disabled` now refuses to disable **the caller's own** account
with `403`. The UI hid the control, but the rule has to hold on the server: with a second
administrator present, an admin could otherwise disable themselves and lose access to the
admin area until someone else re-enabled them.

The **last-admin** rule is checked **first** and is unchanged. It has to stay first
because disabling the only administrator satisfies both rules, and the existing test
`refuses to disable the last administrator` expects the more specific `409`.

| Area    | Deliverable                                                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | Self-disable guard in `routes/adminRoutes.ts`; module header documents both lock-out rules                                                                                         |
| Tests   | 4 new integration tests in `api.integration.test.ts` (self-disable refused and account untouched, disabling another admin, disable/re-enable a normal user, self-demotion refused) |

## 3. Frontend – the user-management surface

`pages/admin.ts` is rebuilt on the shared shell and primitives:

- `appShell({ role: 'host', active: 'admin', isAdmin: true, brandHref: './admin.html' })`,
  so the brand logo still returns to the admin dashboard from any admin sub-page.
- Three summary tiles (accounts, administrators, disabled).
- A create form that validates with the shared `validateUsername` / `validatePassword`
  and maps each issue onto its field (`field__error` + `aria-invalid`). A taken username
  is reported on the username field; any other failure becomes a notice.
- **Role change** and **disable** go through a confirmation dialog that names the account
  and the consequence; cancelling restores the selector. Re-enabling acts directly,
  because it is not destructive.
- The caller's own row disables both the role selector and the disable toggle, mirroring
  the server rules.
- Proper loading (skeleton), empty and error states instead of an empty table.

Everything is built with `el`, so no user data reaches `innerHTML`.

### Regression guard: the table must keep its header

A repaint re-attaches the **whole `<table>`**, not the bare `<tbody>`. Moving a `tbody`
out of its `table` orphans the header row, so the header would disappear after the first
refresh. A test asserts the `thead` is still inside the table once rows are shown.

## 4. Tests

| Layer    | File                          | Result               |
| -------- | ----------------------------- | -------------------- |
| Backend  | `src/api.integration.test.ts` | 148 total (10 files) |
| Frontend | `src/admin.test.ts` (new, 9)  | 285 total (11 files) |
| Shared   | unchanged                     | 89 total (4 files)   |

`admin.test.ts` drives the **real** page in jsdom and stubs only `fetch`. It covers the
list and summary, the empty state, the error path, the disabled self-row, the role-change
confirmation (confirm and cancel), the disable confirmation, create-user validation and
success, and reset-password validation.

## 5. Bestandsschutz evidence

- **No migration.** `prisma migrate status` reports "Database schema is up to date!".
- **No new dependency.** The page uses `@zeropeek/shared` validators and the existing UI kit.
- **Additive CSS.** A single block is appended to `tokens.css`; nothing above it changes.
  The account table reuses the shared `.report-table`, which already stacks each row into a
  card below 768 px (each `td` carries its `data-label`).
- **Behaviour preserved.** Create, role change, disable/enable and password reset all keep
  their endpoints and payloads. The only server behaviour change is the new `403`.
- **Server stays the authority.** The disabled controls are a convenience; every rule is
  enforced in the route handler.

## 6. Gate

Build, lint, typecheck and `prettier --check .` are clean; the full suite is green
(148 + 285 + 89 = 522 tests). No deployment and no Portainer change.

## 7. Open questions for the project owner

1. Should the admin surface gain **moderation** and **statistics** sections, or stay a
   user-management screen until Phase 6.12?
2. Is a **password-reset-by-email** flow wanted, or is the admin-issued reset sufficient?
