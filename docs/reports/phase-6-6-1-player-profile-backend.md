# Phase 6.6.1 – Spielerprofile: Datenmodell und Backend-API (Bericht)

- **Branch:** `feat/player-profiles-6-6-1`
- **Basis:** `main` nach PR #34 (`f7b35ae`)
- **Umfang:** der Backend-Grundstein für dauerhafte Spielerprofile — Datenmodell, Migration,
  `GET`/`PUT /api/profile`, Berechtigungen, Tests
- **Status:** vorgelegt, wartet auf Prüfung

## 0. Zentrales Ergebnis: der Backend-Grundstein existiert bereits

**Der in Phase 6.6.1 beschriebene Backend-Umfang ist bereits vollständig auf `main`
vorhanden.** Er wurde mit PR #33 (Branch `feat/phase-6-6-player-profiles`, Commit `6aebe1f`,
Titel „Add player profiles with server-computed statistics (Phase 6.6)") geliefert und ist
Teil der 243 Backend-Tests, die seitdem grün sind.

Konkret bereits vorhanden und geprüft:

| Anforderung aus 6.6.1                                  | Vorhanden? | Ort                                                             |
| ------------------------------------------------------ | ---------- | --------------------------------------------------------------- |
| `PlayerProfile`-Modell                                 | ja         | `packages/backend/prisma/schema.prisma` (`model PlayerProfile`) |
| Eindeutige Zuordnung zu `User`                         | ja         | `userId String @unique` + FK `onDelete: Cascade`                |
| Erstellungs-/Aktualisierungszeitpunkt                  | ja         | `createdAt`, `updatedAt`                                        |
| Charakterauswahl als nullable Identifier               | ja         | `selectedCharacterId String?`                                   |
| Additive, datenerhaltende Migration                    | ja         | `prisma/migrations/20261109120000_phase_6_6_player_profiles/`   |
| `GET /api/profile` (idempotente Anlage)                | ja         | `routes/profileRoutes.ts`, `services/profileService.ts`         |
| `PUT /api/profile` (nur Charakterwahl)                 | ja         | dito, validiert in `shared/profile.ts`                          |
| Ablehnung unbekannter Felder                           | ja         | `validateProfileUpdate` in `packages/shared/src/profile.ts`     |
| Nur das eigene Profil lesbar/änderbar                  | ja         | `userId` stammt ausschließlich aus der Session                  |
| Keine IP-Speicherung                                   | ja         | keine IP-Spalte; dokumentiert in Schema und Migration           |
| Vorbereitung der Statistik (Siege/Podiums/Genauigkeit) | ja         | `profileStats` in `profileService.ts`                           |

### 0.1 Warum nicht neu implementiert wurde

Die Vorgabe lautet: „Wenn ein bereits vorhandenes Modell diese Anforderungen erfüllt,
erweitere es nicht unnötig." Ein Neu- oder Nachbau des vorhandenen Modells, der Migration
oder der Endpunkte würde gegen die Bestandsschutzregeln verstoßen (doppelte Systeme,
Änderung an bereits abgenommenem Code) und den stabilisierten Stand gefährden. Deshalb wurde
**kein Produktionscode geändert**. Die tatsächlich fehlende Arbeit ist die **Testabdeckung**
(siehe §5) und diese Dokumentation.

Falls eine andere Aufteilung gewünscht ist (z. B. `PlayerProfile` bewusst neu strukturieren),
ist das eine Produktentscheidung und wird **nicht eigenmächtig** vorgenommen.

## 1. Ausgangszustand

- `main` = `f7b35ae` (Merge von PR #34). Backend 243, Frontend 333, Shared 102 Tests, alle grün.
- Die Gameplay-Stabilisierung (PR #34) ist unangetastet.
- Phase 6.6 lieferte bereits `PlayerProfile`, die Migration und die Profil-API.

## 2. Datenmodell

`packages/backend/prisma/schema.prisma`:

```prisma
model PlayerProfile {
  id                  String   @id @default(uuid())
  userId              String   @unique @map("user_id")
  selectedCharacterId String?  @map("selected_character_id")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("player_profiles")
}
```

- **Ein Profil pro Konto:** `userId` ist `@unique`; ein zweites Profil ist auf Datenbankebene
  unmöglich.
- **Keine Gäste:** `PlayerProfile` hängt an `User`. Ein Gast hat keinen `User` und damit kein
  Profil. Der Gastbezug am Spielsitz ist `GamePlayer.userId String?` — nullable, `onDelete: SetNull`.
- **Keine unnötigen Pflichtfelder:** nur `userId` ist gesetzt, `selectedCharacterId` ist optional.
- **Keine erfundenen Werte:** es gibt keine XP-, Level-, Avatar- oder Inventarspalten. Diese
  gehören laut Roadmap §9 zu Phase 6.8 und wurden bewusst nicht angelegt.
- **Keine IP:** keine IP-Spalte, kein Hash davon. Produktentscheidung Q5.

Das Modell ist für 6.7 (`selectedCharacterId` wird gegen den Charakterkatalog validiert, ein
`avatarConfig`-Feld kommt hinzu) und 6.8 (XP/Inventar in eigenen Tabellen) erweiterbar.

## 3. API-Endpunkte und Berechtigungen

`packages/backend/src/routes/profileRoutes.ts`, registriert in `app.ts`:

| Route              | Guard                          | Verhalten                                                                                            |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `GET /api/profile` | `requireAuth`                  | Profil des angemeldeten Kontos; legt es bei Bedarf idempotent an; liefert `{ user, profile, stats }` |
| `PUT /api/profile` | `requireAuth` (+ CSRF-Pflicht) | ändert **nur** `selectedCharacterId`; alles andere → 422                                             |

Berechtigungsregeln:

- Die `userId` kommt **ausschließlich aus der Session** (`currentUser(request)`), nie aus der
  Anfrage. Eine Query-/Body-`userId` ändert nichts — getestet.
- Nicht angemeldet → 401. `PUT` ohne CSRF-Token → 403.
- Ein Konto kann ein fremdes Profil weder lesen noch ändern — getestet (§5).
- Es gibt **bewusst keinen** spielersichtlichen Historien-Endpunkt. `/api/profile/history`,
  `/api/profile/games`, `/api/profile/results` liefern 404 — getestet. Die Quizhistorie bleibt
  ausschließlich administrativ.

### 3.1 Idempotente Anlage

`ensureProfile(userId)` liest zuerst und legt nur bei Fehlen an. Der erste Aufruf eines Kontos
materialisiert das Profil; kein Backfill, keine Registrierungs-Hook-Änderung. Dadurch bleibt
jedes vor Phase 6.6 bestehende Konto kompatibel.

## 4. Migration

`prisma/migrations/20261109120000_phase_6_6_player_profiles/migration.sql` — rein additiv:

1. `CREATE TABLE player_profiles` (+ Unique-Index auf `user_id`, FK auf `users` `ON DELETE CASCADE`).
2. `ALTER TABLE game_players ADD COLUMN user_id TEXT` (nullable) + Index + FK `ON DELETE SET NULL`.

Keine Spalte wird gelöscht, umbenannt oder in Typ/Nullability geändert; keine Zeile wird
angefasst. Bestehende `game_players`-Zeilen behalten `user_id = NULL` (Gast) und bleiben gültig.

**Prüfung auf isolierter Testdatenbank:** `zeropeek_stabtest` auf Port 55432 (nicht produktiv).
`prisma migrate status` meldet „Database schema is up to date!". `prisma migrate diff` zwischen
`prisma/migrations` und dem Datenmodell meldet **„No difference detected"** — das Schema ist
also exakt durch die vorhandenen Migrationen gedeckt; **es war keine neue Migration nötig**.

## 5. Testabdeckung

Die vorhandene Suite `packages/backend/src/profile.integration.test.ts` deckte bereits die
Punkte 1, 3, 4, 6, 9 ab. In Phase 6.6.1 ergänzt wurden die zuvor **fehlenden** Fälle:

| Anforderung (Aufgabenstellung §9)                   | Test                                                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1. Profil abrufen                                   | vorhanden: `returns only the authenticated account's own profile`                                                                  |
| 2. Fehlendes Profil **idempotent**                  | **neu:** `creates exactly one profile, idempotently, on repeated reads` (0 Zeilen → 2 Reads → genau 1 Zeile)                       |
| 3. Nur eigenes Profil bearbeiten                    | vorhanden: `stores a chosen character and reads it back`                                                                           |
| 4. Nicht authentifiziert abgelehnt                  | vorhanden: `refuses an unauthenticated profile read/write`                                                                         |
| 5. Gäste ohne Profil                                | **neu:** `gives a guest participant no durable profile` (Gastspiel → 0 `PlayerProfile`, 0 `User`)                                  |
| 6. Unzulässige Felder abgelehnt                     | vorhanden: `rejects a body that tries to set a statistic, XP or a userId`                                                          |
| 7. Zwei Nutzer können sich nicht gegenseitig ändern | **neu:** `never lets one account change another account's profile` (prüft beide DB-Zeilen und verschiedene Profil-IDs)             |
| 8. Bestehende Nutzer nach Migration funktionsfähig  | **neu:** `creates the profile lazily for an account that predates it` (Konto ohne Profil liest → Profil entsteht → kann schreiben) |
| 9. Keine IP dauerhaft gespeichert                   | vorhanden (Antwort) **+ neu:** `stores no IP-like column on the profile table` (Schema-Ebene via `information_schema`)             |

`profile.integration.test.ts`: **18 → 23 Tests.**

## 6. Ergebnisse aller Test- und Build-Schritte

| Schritt                           | Ergebnis                               |
| --------------------------------- | -------------------------------------- |
| Backend-Tests                     | **248 / 248** (15 Dateien; vorher 243) |
| Frontend-Tests                    | **333 / 333** (13 Dateien)             |
| Shared-Tests                      | **102 / 102** (5 Dateien)              |
| `npm run typecheck`               | grün                                   |
| `npm run lint`                    | grün                                   |
| `npm run format:check` (Prettier) | grün                                   |
| `npm run build`                   | grün                                   |
| `prisma migrate status` (Test-DB) | up to date                             |
| `prisma migrate diff`             | No difference detected                 |

## 7. Bewusst noch nicht implementiert

- **Keine Charaktergrafiken, Avatare, Inventar** — die Charakterauswahl ist nur ein
  vorbereiteter String-Identifier (`selectedCharacterId`).
- **Kein Avatar-Editor, kein `avatarConfig`** — Phase 6.7.
- **Kein XP, kein Level, kein Inventar, keine Erfolge** — Phase 6.8. `PlayerProfile` enthält
  bewusst keine dieser Spalten.
- **Keine spielersichtliche Quizhistorie** — bleibt administrativ.
- **Keine UI-/Design-Änderungen** in dieser Phase.
- **Keine Gastkonto-Übernahme** — Phase 6.8 (`Game.guestClaim`).

## 8. Bestandsschutz

Unverändert geblieben sind insbesondere: `services/engine.ts`, alle Socket.IO-Events und
Payloads, Host- und Beamer-Funktionen, die Spieler-Gameplay-Oberfläche, Fragetypen,
Bewertung und Punkteberechnung, Spielphasen und Timer, Lobby/PIN/Join, Reconnect- und
Restart-Recovery, die Admin-Funktionen sowie alle bestehenden Tabellen und Zeilen.

Die einzige Code-Änderung dieser Phase ist eine **Testdatei** (`profile.integration.test.ts`).
