# Fix – administrative e-mail confirmation, role management, safe default role

- **Branch:** `fix/player-role-email-verification` (from `main` = `b76e5bc`)
- **Scope:** admin e-mail confirmation endpoint + UI, correct `PLAYER` role display and
  assignment, least-privilege default role
- **Status:** draft pull request, awaiting review (no merge, no deploy)

## 0. Result in one sentence

An administrator can now confirm a single account's e-mail address from the admin
surface, the admin user list shows and assigns the `PLAYER` role correctly instead of
mislabeling every non-admin as "Trainer", and a user created without an explicit role
is a `PLAYER` rather than silently becoming a `TRAINER`.

## 1. Root causes fixed

1. **Mislabeled players.** `packages/frontend/src/pages/admin.ts` knew only
   `ADMIN | TRAINER`: `roleLabel` mapped everything that was not `ADMIN` to "Trainer",
   and each row's role `<select>` offered only those two. A correctly stored `PLAYER`
   was therefore displayed — and re-assignable — as a trainer.
2. **No `PLAYER` target role.** `POST /api/admin/users/:id/role` rejected `PLAYER`
   with "Unknown role.", so the UI could not correct a role either.
3. **No manual confirmation path.** With SMTP unconfigured, a self-registered player
   could never be confirmed (the only paths were the token link and resend, both of
   which need mail).
4. **Unsafe default role.** `User.role` defaulted to `TRAINER` in the schema, in
   `createUser` and in the admin create route — a fail-open default that silently
   granted host access to any user created without an explicit role.

## 2. Changes

### 2.1 Backend

| File                                                                                       | Change                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/prisma/schema.prisma`                                                    | `User.role` default `TRAINER` → `PLAYER` (documented)                                                                                                                                                                               |
| `packages/backend/prisma/migrations/20261112120000_safe_default_role_player/migration.sql` | **New**, additive: `ALTER COLUMN "role" SET DEFAULT 'PLAYER'` (column default only, no row touched; reverse documented inline)                                                                                                      |
| `packages/backend/src/services/userService.ts`                                             | `createUser` fallback role `'TRAINER'` → `'PLAYER'`; new `setEmailVerified(id, verified)` (idempotent, single column of a single row)                                                                                               |
| `packages/backend/src/routes/adminRoutes.ts`                                               | create fallback role `'PLAYER'`; role route accepts `PLAYER`; last-admin guard widened to any demotion (not only `TRAINER`); new `POST /api/admin/users/:id/verified` (ADMIN + CSRF, body `{ verified?: boolean }`, default `true`) |

### 2.2 Frontend

| File                                   | Change                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/frontend/src/pages/admin.ts` | `UserRole` includes `PLAYER`; `roleLabel` maps `ADMIN→Administrator`, `TRAINER→Trainer`, `PLAYER→Player`; row `<select>` offers all three roles; `User` carries `emailVerifiedAt`; new status chip (No e-mail / E-mail unconfirmed / E-mail confirmed) and a "Confirm e-mail" action shown only for an unconfirmed account, behind a confirmation dialog; create-form role list includes Player |

### 2.3 Docs

| File                                       | Change                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `docs/architecture/0006-security-model.md` | Added the least-privilege default and the manual e-mail confirmation to the authorization section |

## 3. Migration

`20261112120000_safe_default_role_player` — one statement, additive and reversible:

```sql
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'PLAYER';
```

It changes only the **column default**, so no existing row is read or written: no
account is reclassified, `ADMIN`/`TRAINER` accounts keep their role, and staff
accounts (always created with an explicit role) are unaffected. Verified with
`prisma migrate diff` (empty diff against the schema) and by applying all migrations to
a fresh database.

## 4. Test results

| Check                                            | Result                                 |
| ------------------------------------------------ | -------------------------------------- |
| Shared tests                                     | 161/161 passed                         |
| Backend tests (incl. PostgreSQL)                 | 339/339 passed                         |
| Frontend tests                                   | 420/420 passed                         |
| TypeScript typecheck (all packages)              | clean                                  |
| Build (shared + backend + frontend)              | clean                                  |
| Prettier (`format:check .`)                      | clean                                  |
| `prisma validate`                                | valid                                  |
| Migration on a fresh database (`migrate deploy`) | applied, `migrate status` = up to date |

New coverage: admin confirmation (single account, idempotent, other accounts
untouched, role/password unchanged, confirmed player can then sign in, reversible,
non-admin 403, no session 401, CSRF required, unknown account 404); role management
(`PLAYER` accepted and returned, last-admin demotion to `PLAYER` refused, unknown role
rejected, omitted role → `PLAYER` at route and service level); frontend (each role
labelled correctly, all three roles in every selector, status chip, confirm action
shown only when relevant and only after confirmation).

## 5. Security assessment

- **Least privilege.** The default role is now `PLAYER`; a missing role can no longer
  grant host access. This is the main hardening.
- **Bounded write.** The confirmation endpoint is `requireAdmin` + CSRF, writes only
  `emailVerifiedAt` on the one named account, is idempotent (keeps the first
  timestamp) and never touches role, password, sessions, XP, inventory or history.
  There is no bulk operation and no global verification bypass.
- **Role management unchanged where it matters.** Only `ADMIN` may change roles, the
  last-admin guard now covers any demotion, and a `PLAYER` still cannot reach trainer
  or admin surfaces (server-side).
- **No production data touched.** No account is reclassified by the migration; the
  owner's own account is confirmed separately, only after explicit approval.

## 6. Regression safety

No changes were made to sessions, cookie separation, CSRF, guest join, the game
engine, scoring, XP/levels, inventory, guest-round claim or achievements. The full
existing suite passes unchanged; new tests were added, none weakened or skipped.
