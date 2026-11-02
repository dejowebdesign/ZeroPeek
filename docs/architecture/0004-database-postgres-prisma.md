# ADR 0004 – Database: PostgreSQL + Prisma ORM

- **Status:** Accepted
- **Date:** 2026-11-02
- **Phase:** 0

## Context

ZeroPeek stores relational data: users, roles, sessions, quizzes with 13 question types, games,
players, per-question answers, results and events. Reports must be derived from real stored game
data, and the schema must support filtering (by participant id, date range, quiz) and retention.

The 13 question types need to be stored **uniformly** yet keep their type-specific fields
(options, correct answers, slider bounds, order, scale steps, …).

## Decision

- **PostgreSQL 16** as the relational store. Strong typing, JSONB for type-specific question
  payloads, mature indexing and transactional integrity.
- **Prisma ORM** for schema, migrations and a typed client shared by the backend.
- **Hybrid modelling:** stable, queried columns for everything that is filtered or joined on
  (ids, timestamps, scores, foreign keys), plus a **JSONB `payload` column** on `Question` for the
  type-specific fields. The shape of `payload` is defined and validated by `@zeropeek/shared`.

## Alternatives considered

- **Fully normalised (one table per question type).** Rejected: 13 tables with near-identical
  columns, painful joins, and awkward editor queries.
- **Everything in JSONB.** Rejected: no referential integrity, poor report performance, no clean
  indexes.
- **Prisma alternatives (Drizzle, TypeORM, Kysely).** Drizzle is a fine lightweight option; Prisma
  was chosen for its mature migration workflow, generated types and readability for a small team.
- **SQLite for development.** Rejected to keep dev and production identical; Docker Compose runs a
  real PostgreSQL for local development.

## Consequences

- Migrations are versioned under `packages/backend/prisma/migrations`.
- The `payload` JSONB shape is a **shared contract**; changing it requires a `shared` change plus a
  migration and validation update.
- Reports can query indexed columns directly and expand `payload` only when needed.
