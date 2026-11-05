# Phase 1 – Technische Bestandsaufnahme (ZeroPeek)

**Projekt:** ZeroPeek
**Phase:** 1 – Technische Bestandsaufnahme (Analyse only)
**Datum:** 2026-11-04
**Grundlage:** `main` @ `1cf30be` (Merge PR #15), flacher Clone (`git rev-parse --is-shallow-repository` → `true`)
**Status:** Abgeschlossen, wartet auf Prüfung durch den Projektverantwortlichen

> **Abstract (EN):** This document is a verified inventory of the ZeroPeek repository as it exists
> on `main`. Every statement below was checked against the actual source; nothing is assumed. No
> application code, database schema or deployment configuration was changed.

**Sprachregelung:** Dieses Dokument ist auf Deutsch (Zielgruppe: Projektverantwortlicher). Technische Bezeichner,
Dateipfade, API-Namen und Code bleiben in der Originalsprache Englisch.

---

## 0. Verifikationsbasis

Alle Angaben wurden in dieser Umgebung tatsächlich ausgeführt, nicht übernommen.

| Prüfung       | Kommando                                       | Ergebnis                                                             |
| ------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Installation  | `npm ci`                                       | exit 0                                                               |
| Prisma-Client | `npm run prisma:generate -w @zeropeek/backend` | exit 0 (Client v6.19.3 generiert)                                    |
| Typecheck     | `npm run typecheck`                            | exit 0, 3 Workspaces sauber                                          |
| Tests         | `npm test`                                     | **181 passed** (94 backend + 25 frontend + 62 shared)                |
| Build         | `npm run build`                                | exit 0 (shared → backend → frontend)                                 |
| Formatierung  | `npm run format:check`                         | „All matched files use Prettier code style!"                         |
| Git-Zustand   | `git status --short`                           | nur `.openhands/memory/MEMORY.md` (Agenten-Memory, kein Produktcode) |

**Wichtige Korrektur (Phase 5b, 2026-11-04):** Die ursprüngliche Messung meldete „60 passed, 34
skipped". Die 34 übersprungenen Tests sind die **DB-gestützten Integrationssuiten**
(`api.integration`, `realtime.integration`, `engine.integration`, `bootstrap.integration`), die sich
ohne erreichbare PostgreSQL selbst überspringen (`packages/backend/src/testing/db.ts`). Das war
**kein Defekt**, sondern eine fehlende Datenbank in der Sandbox. Mit einer echten PostgreSQL 16
(`TEST_DATABASE_URL`, `prisma migrate deploy`) laufen **alle 181 Tests grün** (94 backend + 25
frontend + 62 shared). Die Spiellogik (Engine-Lebenszyklus, Punkte, Ranking, Zeitregeln, PIN-Beitritt)
und der Realtime-Ablauf über echte Sockets sind damit **durch Integrationstests verifiziert** – das
ist **keine** vollständige Browser-Ende-zu-Ende-Verifikation (keine Playwright-Suite). Risiko **R-1
ist entschärft**, **R-12 (keine E2E-/visuellen Tests) besteht weiter**. Siehe
`docs/reports/phase-5b-revision-and-first-works.md` §2.1.

**Korrektur zum Clone:** Der ursprüngliche Clone war flach. In Phase 5b wurde die volle Historie
nachgeladen (`git fetch --unshallow`); `main` steht auf `1cf30be` (Merge PR #15). Damit sind
Historie und Tags wieder verfügbar.

---

## 1. Technische Architekturübersicht

**Monorepo mit npm-Workspaces** (ADR 0001). Drei Pakete, ein Wurzel-Build:

```
packages/
├─ shared/    @zeropeek/shared    – Domänen-Typen, 13 Fragetypen, Validierung, Scoring,
│                                   PIN-Erzeugung, Socket.IO-Event-Verträge
├─ backend/   @zeropeek/backend   – Fastify 5 REST + Socket.IO 4 + Prisma (PostgreSQL 16)
└─ frontend/  @zeropeek/frontend  – Multi-Page Vanilla-TS + Vite, CSS Custom Properties
```

**Regel:** `@zeropeek/shared` ist laufzeitneutral (keine `node:`-Imports, keine DOM-APIs) und die
**einzige Wahrheit** für Fragetypen, Validierung und Scoring. Backend und Frontend importieren
dieselbe Funktion (ADR 0005). Diese Regel ist im Code eingehalten.

### Schichten im Backend

| Schicht       | Datei(en)                                                  | Aufgabe                                                         |
| ------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Konfiguration | `config.ts`                                                | Env-Auswertung, strikt in Produktion, `DATABASE_URL`-Ableitung  |
| App-Fabrik    | `app.ts`                                                   | Fastify + Helmet/CSP/CORS/Cookie/Rate-Limit + Fehlerbehandlung  |
| HTTP-Routen   | `routes/{auth,quiz,report,admin}Routes.ts`                 | REST-Verträge, Guard je Route                                   |
| Auth/Session  | `auth.ts`, `sessions.ts`                                   | Argon2id, Sessionzeilen, CSRF-Double-Submit, Rollen-Guards      |
| Realtime      | `socket.ts`                                                | Namespaces `/` (Spieler) und `/host` (Moderation), Room-Fan-out |
| Spielmotor    | `services/engine.ts`                                       | Phasenmaschine, Timer, Punkte, Ranking (server-autoritativ)     |
| Persistenz    | `services/{game,quiz,report,user}Service.ts`, `mappers.ts` | DB-Zugriffe; `mappers.ts` übersetzt Row ↔ Domänenmodell         |
| Fehler        | `errors.ts`                                                | Typisierte `AppError` mit Status + Code                         |

### Schichten im Frontend

| Datei                                 | Aufgabe                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `dom.ts`                              | Typisierter DOM-Builder; dynamischer Text nur über `textContent`                                              |
| `ui.ts`                               | Wiederverwendbare Bausteine: `brand`, `pageHeader`, `field`, `button`, `notice`, `toast`, `spinner`, `screen` |
| `api.ts`                              | `fetch`-Wrapper, sendet Cookies, spiegelt CSRF-Token (nur im Speicher)                                        |
| `socket.ts`                           | `connectPlayer` / `connectHost`, `request` (ACK) und `once`                                                   |
| `questionForm.ts`                     | Editorformular je Fragetyp, `newQuestion`                                                                     |
| `questionView.ts`                     | Spieler-Eingabe (`questionInput`) und Auflösungsansicht (`questionResult`, `solutionText`)                    |
| `styles/tokens.css`                   | **Das vorhandene Designsystem** (795 Zeilen, CSS Custom Properties)                                           |
| `pages/{player,host,editor,admin}.ts` | Die vier Oberflächen                                                                                          |

**CSP-Zwang:** `script-src 'self'`, `style-src 'self'` (kein `unsafe-inline`). Deshalb keine
Inline-Styles/-Skripte; dynamische Stile laufen über die CSSOM (`dom.ts` setzt `style.setProperty`).
Jede neue UI muss diese Regel einhalten (ADR 0002 / ADR 0006).

---

## 2. Vorhandene Seiten / Oberflächen

Vite-Multi-Page-Build mit vier HTML-Einträgen (`packages/frontend/vite.config.ts`):

| Route (Produktion)    | Datei                                | Oberfläche                                                                                                   | Zugang                  |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `/` und `/index.html` | `src/index.html` + `pages/player.ts` | **Spieler** (PIN beitreten, antworten, eigenes Ergebnis)                                                     | anonym                  |
| `/host.html`          | `pages/host.ts`                      | **Host + Beamer in einer Seite** (Login, Quiz starten, Lobby, Frage, Auflösung, Rangliste, Podium, Berichte) | Session (TRAINER/ADMIN) |
| `/editor.html`        | `pages/editor.ts`                    | **Quiz-Editor** (CRUD, Fragetypen, Sortieren, Vorschau, Import/Export)                                       | Session                 |
| `/admin.html`         | `pages/admin.ts`                     | **Benutzerverwaltung** (Anlegen, Rolle, Sperren, Passwort-Reset)                                             | Session + Rolle `ADMIN` |

Caddy-Fallback im Frontend-Image: `try_files {path} {path}.html {path}/index.html`, daher
funktionieren `/admin` und `/admin.html`, aber **nicht** `/admin/`.

### Wichtige Feststellung: die Host-Seite **ist** die Beamer-Ansicht (verbindlich)

Die Host-Seite **ist** die Beamer-Ansicht: `pages/host.ts` rendert Lobby, Frage, Auflösung,
Rangliste und Podium direkt und groß. Es gibt **keine** getrennte, schreibgeschützte
Präsentationsroute und **keine** eigenständige Beamer-Seite. Der Begriff „Beamer" kommt im Code nur
in Kommentaren vor (`host.ts`, `questionView.ts`), nicht als eigene Oberfläche. **Verbindlich:** Diese
kombinierte Host-/Beamer-Ansicht bleibt erhalten; eine eigene Beamer-Surface wird nicht eingeführt.

### Weitere Abweichungen von den Zielbildern

| Erwartet (Briefing)             | Tatsächlicher Zustand                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login/Registrierung             | **Nur** Login (Host/Editor/Admin). **Keine Registrierung, keine Spielerkonten.**                                                                         |
| Spielerprofil                   | **Nicht vorhanden.** Spieler existieren nur pro Spiel (`GamePlayer`).                                                                                    |
| Avatar-System                   | Feld `avatar` existiert (`String`, Default `""`), ist aber **eine unvalidierte freie Zeichenkette**; keine Charaktere, keine Auswahl, keine Darstellung. |
| XP / Level / Inventar / Erfolge | **Nicht vorhanden** – weder Schema noch Code noch UI.                                                                                                    |
| Ranglisten                      | Nur **innerhalb** eines Spiels (`GamePlayer.score`), keine globalen/Tages-/Wochenranglisten.                                                             |
| Sterne / Animationen            | Statischer Aurora-Verlauf via CSS (`body::before`), `prefers-reduced-motion` berücksichtigt. Kein Sternenhimmel.                                         |
| Team-Modus                      | Feld `GamePlayer.team` + Konstanten `TEAM_NAMES`, sonst **nirgends verwendet** (data-only).                                                              |
| „lead"-Phase                    | In `GAME_PHASES` deklariert, wird aber **nie betreten** (nur in Kommentaren).                                                                            |
| Ideen-Sammlung (`ideas`)        | Typ existiert, `maxVotes` wird validiert, **es gibt kein Voting** (kein Event, kein Handler).                                                            |
| QR-Code                         | **Nicht vorhanden.** Lobby zeigt nur die URL als Text.                                                                                                   |

---

## 3. Datenmodelle (Prisma / PostgreSQL)

`schema.prisma` (182 Zeilen) definiert **acht Modelle**. Alles außer `User` stammt aus der Migration
`20261102231432_init_full_domain`.

| Modell         | Tabelle          | Kernfelder                                                                                           | Beziehungen                                       |
| -------------- | ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `User`         | `users`          | `id`, `username` (unique), `email?` (unique), `passwordHash`, `role`, `disabled`, Zeitstempel        | → `Session[]`, `Quiz[]`                           |
| `Session`      | `sessions`       | `id` (opak), `csrfToken`, `expiresAt`, `lastSeen`                                                    | → `User` (Cascade)                                |
| `Quiz`         | `quizzes`        | `title`, `description`, `theme`, `defaultTimeLimit`, `ownerId?`                                      | → `User?` (SetNull), `Question[]`, `Game[]`       |
| `Question`     | `questions`      | `type`, `text`, `timeLimit`, `points`, `position`, **`payload` JSONB**                               | → `Quiz` (Cascade), `PlayerAnswer[]`              |
| `Game`         | `games`          | `pin` (unique), `phase`, `currentIndex`, **`settings` JSONB**, `startedAt?`, `endedAt?`              | → `Quiz` (Cascade), `GamePlayer[]`, `GameEvent[]` |
| `GamePlayer`   | `game_players`   | `nickname`, `avatar`, `token` (unique), `score`, `correctCount`, `totalTimeMs`, `team?`, `connected` | → `Game` (Cascade), `PlayerAnswer[]`              |
| `PlayerAnswer` | `player_answers` | `answer` JSONB, `correctness` Float, `points`, `elapsedMs`, `flagged`                                | → `GamePlayer`/`Question` (Cascade)               |
| `GameEvent`    | `game_events`    | `type`, `data` JSONB (append-only Protokoll)                                                         | → `Game` (Cascade)                                |

**Rollen:** Enum `UserRole` = `ADMIN` | `TRAINER`. **Es gibt keine Spielerrolle** – Spieler sind
anonyme `GamePlayer`-Zeilen ohne Login.

**Wichtige Konsequenz für spätere Phasen (Bestandsschutz-relevant):**

- `PlayerAnswer.questionId` hat `onDelete: Cascade` auf `Question`. Ein Quiz-Update **ersetzt** alle
  Fragen (`quizService.updateQuiz` löscht `question.deleteMany` und legt neu an). Dadurch **löscht das
  Bearbeiten eines Quiz kaskadierend die Antworten und damit die Spielhistorie** der zugehörigen
  Spiele. Das ist heute so und muss bei jeder Editor-/Report-Änderung berücksichtigt werden (R-3).
- `PlayerAnswer` hat `@@unique([playerId, questionId])` – das ist der **Schutz gegen doppelte
  Antworten** in der Datenbank (zusätzlich zur Laufzeitprüfung im Motor).
- `Game.settings` ist ein **Snapshot** der Scoring-Einstellungen beim Anlegen des Spiels. Der Motor
  liest daraus. Das ist die vorhandene Grundlage für manipulationssichere Punktevergabe.
- Es gibt **keinen Fremdschlüssel `GamePlayer → User`**. Eine spätere Verknüpfung von Gastprofil und
  Konto braucht ein neues Feld (nullable), keine Änderung bestehender.

**Migrationen:** Genau eine (`init_full_domain`), defensiv geschrieben (`CREATE TABLE IF NOT EXISTS`,
`DO $$ … EXCEPTION WHEN duplicate_object`). Die vorhandene Migrationsdisziplin (idempotent,
bestehende Daten schonend) ist beizubehalten.

---

## 4. Authentifizierung, Benutzer- und Rollenmodell

| Aspekt             | Umsetzung                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Passwort-Hashing   | **Argon2id**, `@node-rs/argon2`, 19 MiB / t=2 / p=1, Mindestlänge 10 Zeichen (`auth.ts`)                                |
| Session            | **Server-seitige Session** in `sessions`-Tabelle; Cookie trägt nur die opake `id`                                       |
| Cookie             | `HttpOnly`, `SameSite=Lax`, `Secure` abhängig von `COOKIE_SECURE` / `APP_BASE_URL`-Schema, Name `zp_session`            |
| CSRF               | Double-Submit: Token pro Session, Pflicht-Header `X-CSRF-Token` bei POST/PUT/PATCH/DELETE                               |
| Rollen             | `ADMIN`, `TRAINER`; Guards `requireAuth` / `requireAdmin` **serverseitig** je Route                                     |
| Host-Socket        | Namespace `/host` authentifiziert aus dem Session-Cookie (eigener Cookie-Parser, da der Socket-Upgrade Fastify umgeht)  |
| Spieler-Socket     | Namespace `/` anonym; `player:join` gibt einen `token` für Reconnect zurück                                             |
| Admin-Schutzregeln | Letzter aktiver Admin kann **nicht** gesperrt/herabgestuft werden; ein Admin kann sich nicht selbst die Rolle entziehen |
| Bootstrap-Admin    | `BOOTSTRAP_ADMIN_USER` + `BOOTSTRAP_ADMIN_PASSWORD` legen beim ersten Start genau einen Admin an                        |

**Sicherheitslücken im Bestand (verifiziert):**

- **Kein Rate-Limit auf Socket-Events.** `socket.ts` hat keinerlei Throttling; `@fastify/rate-limit`
  wirkt nur auf HTTP. `player:answer` ist damit unbegrenzt aufrufbar (funktional durch
  `answeredQuestionId` + DB-Unique geschützt, aber nicht gegen Last/Spam).
- **Redis ist nicht an Socket.IO angeschlossen.** `config.redisUrl` wird beim Start nur per
  `probeRedis` geprüft (`server.ts`); es gibt **keinen** `@socket.io/redis-adapter`. Bei mehr als
  einer Backend-Replica divergieren die In-Memory-Spielzustände. Das ist heute ein Einzelinstanz-Design.
- **Kein Aufräumjob für abgelaufene Sessions.** Abgelaufene Zeilen werden nur lazy beim Zugriff
  gelöscht (`sessions.ts`), es gibt keinen periodischen Löschlauf.
- **Keine Spielerkonten, keine Registrierung, keine 2FA** (2FA ist in ADR 0006 als „Phase 7" geplant).

---

## 5. Quizverwaltung und Quiz-Editor

### REST-Verträge (`routes/quizRoutes.ts`, alle mit Session; Schreibzugriffe mit CSRF)

| Methode  | Pfad                         | Zweck                                   |
| -------- | ---------------------------- | --------------------------------------- |
| `GET`    | `/api/quizzes`               | Liste mit Fragenzahl (Admin sieht alle) |
| `GET`    | `/api/quizzes/:id`           | Ein Quiz mit Fragen                     |
| `POST`   | `/api/quizzes`               | Anlegen (validiert serverseitig)        |
| `PUT`    | `/api/quizzes/:id`           | Aktualisieren (ersetzt Fragenliste)     |
| `DELETE` | `/api/quizzes/:id`           | Löschen                                 |
| `POST`   | `/api/quizzes/:id/duplicate` | Duplizieren mit frischen IDs            |
| `GET`    | `/api/quizzes/:id/export`    | Export als JSON-Datei                   |
| `POST`   | `/api/quizzes/import`        | Import aus JSON                         |

### Weitere REST-Verträge

| Pfad                                         | Zweck                                         |
| -------------------------------------------- | --------------------------------------------- |
| `POST /api/auth/login`, `/logout`, `GET /me` | Anmeldung, Abmeldung, Session + CSRF-Token    |
| `GET /api/admin/users`                       | Benutzerliste (ADMIN)                         |
| `POST /api/admin/users`                      | Benutzer anlegen (ADMIN)                      |
| `POST /api/admin/users/:id/password`         | Passwort setzen (ADMIN)                       |
| `POST /api/admin/users/:id/disabled`         | Sperren/Entsperren (ADMIN)                    |
| `POST /api/admin/users/:id/role`             | Rolle ändern (ADMIN)                          |
| `GET /api/reports/games`                     | Spielliste (Filter `quizId`, Limit 50)        |
| `GET /api/reports/games/:id`                 | Vollbericht: Ranking, Fragenstatistik, Events |
| `GET /api/reports/games/:id/answers.csv`     | CSV aller Antworten                           |
| `GET /api/reports/games/:id/ranking.csv`     | CSV des Endrankings                           |
| `GET /api/reports/quizzes/:id`               | Quizstatistik über alle beendeten Spiele      |
| `GET /api/health`                            | Liveness/Readiness (nennt 13 Fragetypen)      |

**Editor-Funktionen, die es schon gibt:** Anlegen, Bearbeiten aller 13 Typen (`questionForm.ts`),
Hoch-/Runter-Sortieren (↑/↓-Buttons, **kein** Drag-and-drop), Vorschau (Overlay), Import/Export,
Löschen, Duplizieren, lokale Validierung vor dem Speichern plus serverseitige Validierung.

**Editor-Funktionen, die noch fehlen:** Drag-and-drop, Kategorien, Schwierigkeitsgrade,
Bildintegration, automatisches Speichern, Quizvorschau im Spielablauf, Undo.

### Die 13 Fragetypen (`shared/src/constants.ts`)

Bewertet: `single`, `trueFalse`, `multiple`, `text`, `slider`, `order`.
Unbewertet: `poll`, `wordCloud`, `open`, `scale`, `nps`, `slide`, `ideas`.

Zu jedem Typ existiert ein Payload-Typ, eine Validierung (`validation.ts`) und eine
Eingabe-/Auflösungsdarstellung (`questionView.ts`). `questionDisplay()` ist eine **Allow-List**: die
Lösungsfelder werden nie an den Client kopiert. Sortierfragen werden deterministisch (seed = Frage-ID)
gemischt, damit Server und Clients dieselbe Reihenfolge ableiten, ohne die Lösung zu verraten.

---

## 6. Spiellogik und Zustandsmaschine

**Server-autoritativer Motor** (`services/engine.ts`, 462 Zeilen). Clients entscheiden nichts; sie
senden eine Antwort oder einen Host-Befehl, der Motor prüft gegen den Live-Zustand.

### Phasen (`GAME_PHASES`)

`lobby → lead → question → reveal → board → end`

**Tatsächlich betreten werden nur** `lobby`, `question`, `reveal`, `board`, `end`. Die Phase `lead`
ist deklariert, wird aber **nie gesetzt** (verifiziert: nur in `constants.ts` und in Kommentaren).

### Übergänge

| Von        | Aktion                        | Nach       | Bemerkung                                               |
| ---------- | ----------------------------- | ---------- | ------------------------------------------------------- |
| `lobby`    | `host:start`                  | `question` | Verlangt ≥ 1 Spieler; setzt `startedAt`; öffnet Frage 1 |
| `question` | Timer (Limit + 1500 ms Gnade) | `reveal`   | Automatisch; `slide` hat keinen Timer                   |
| `question` | alle haben geantwortet        | `reveal`   | Vorzeitig, idempotent abgesichert                       |
| `question` | `host:reveal`                 | `reveal`   | Manuell                                                 |
| `reveal`   | Timer 6000 ms / `host:board`  | `board`    | `REVEAL_MS = 6000`                                      |
| `board`    | Timer 6000 ms / `host:next`   | `question` | `BOARD_MS = 6000`; nach letzter Frage → `end`           |
| beliebig   | `host:end`                    | `end`      | Setzt `endedAt`                                         |

### Punktevergabe

- Konfigurierbar über `ScoringSettings` im `Game.settings`-Snapshot:
  `scoring` (Basis 1000, Speed-Bonus 0,5 linear, Rundung 1, double auf „total", kein Teilpunkte,
  falsch = 0), `speed` (Q2, standardmäßig **deaktiviert**: `minimumReactionMs = 0`),
  `tieBreak` (Q6: `correctCount`, `totalTime`, `joinedAt`).
- Diese Werte sind **Vorschläge**, keine entschiedene Produktentscheidung (Q1/Q2/Q6 in
  `docs/architecture/README.md` sind offen). Eine Änderung ist Konfiguration, nicht Codeänderung.
- Ranking: absteigend nach Punkten, dann Tie-Breaker; geteilte Ränge bei vollständiger Gleichheit
  (1, 1, 3).

### Schutzmechanismen im Motor (verifiziert)

| Mechanismus               | Umsetzung                                                              |
| ------------------------- | ---------------------------------------------------------------------- |
| Doppelte Antwort          | `player.answeredQuestionId === questionId` → 409 **und** DB-`@@unique` |
| Zu späte Antwort          | `elapsedMs > timeLimit*1000 + 1500` → 409                              |
| Antwort ohne offene Frage | Phase ≠ `question` → 409; Frage-ID-Abgleich → 409                      |
| Nicht bewertbarer Typ     | `isAnswerable` → 409                                                   |
| Nicht im Spiel            | Spieler nicht im Runtime-State → 404                                   |
| Idempotentes Reveal       | erneutes Reveal in `reveal`/`board`/`end` → gibt Phase zurück          |
| Punktevergabe             | ausschließlich serverseitig im Motor; Client sendet nur die Rohantwort |
| Host-Fremdspiel           | `assertHost` prüft `hostId` (ADMIN darf alle)                          |

### Bekannte Schwachstellen der Spiellogik (verifiziert)

- **Reconnect während einer offenen Frage stellt den Zustand nicht wieder her.** `player:rejoin`
  bestätigt nur `{ok:true}`; der Client zeigt den Wartebildschirm. Die aktuelle Frage kommt erst mit
  dem **nächsten** `game:question`-Ereignis. Ein Spieler, der mitten in der Frage die Verbindung
  verliert, sieht die Frage bis zum nächsten Wechsel nicht wieder.
- **Kein Zustands-Replay nach Serverneustart.** `engine.get()` lädt aus der DB, setzt aber
  `openedAt = null` und `answeredQuestionId = null` für alle Spieler und **armt keinen Timer**. Folgen:
  (a) die laufende Frage löst nie automatisch auf; (b) eine erneute Antwort desselben Spielers
  scheitert erst am DB-Unique (Prisma P2002 → generischer 500 statt 409).
- **`ownResult()` wird nirgends aufgerufen** (toter Code); die privaten Spielerergebnisse baut
  stattdessen `sendPlayerResults()` in `socket.ts`.
- **Der Beamer ist nicht eigenständig.** Er ist die Host-Seite und damit an einen Login gebunden.
- **Kein getrennter Zustand für „Pause".** Es gibt keine Pause/Fortsetzen-Funktion.

---

## 7. Realtime-Architektur

`attachSocketIO` (`socket.ts`, 358 Zeilen) hängt Socket.IO an denselben HTTP-Server.

| Namespace | Client  | Authentifizierung                             | Rooms                                    |
| --------- | ------- | --------------------------------------------- | ---------------------------------------- |
| `/`       | Spieler | anonym, `player:join` liefert Reconnect-Token | `game:{id}:players`, `player:{playerId}` |
| `/host`   | Host    | Session-Cookie (Middleware)                   | `game:{id}:hosts`                        |

### Ereignisverträge (`shared/src/events.ts`)

**Spieler → Server:** `player:join`, `player:answer`, `player:rejoin` (jeweils mit ACK).
**Server → Spieler:** `game:joined`, `game:state`, `game:question`, `game:reveal` (privat pro
Spieler), `game:board`, `game:ended`, `game:error`.
**Host → Server:** `host:create`, `host:start`, `host:next`, `host:reveal`, `host:board`, `host:end`,
`host:kick`, `host:join`.
**Server → Host:** `host:lobby`, `host:question`, `host:answers`, `host:reveal`, `host:board`,
`host:ended`, `host:error`.

Beide Richtungen sind typisiert (`ServerToClientEvents` / `ClientToServerEvents`), sodass Backend,
Spieler und Host nicht auseinanderlaufen können.

### Eigenschaften und Grenzen

- **Kein Clock-Sync.** Die Frage trägt `openedAt` (Server-Millisekunden) und `timeLimit`; der Client
  rechnet mit seiner eigenen Uhr. Bei falsch gestellter Geräteuhr weicht der Countdown ab. (Der
  Referenz-Audit nennt Clock-Offset-Sync als bekanntes Muster; ZeroPeek hat das **nicht**.)
- **`openedAt` liegt im Payload**, also ist die Zeitbasis nicht fälschbar, aber auch nicht korrigiert.
- **Kein Wiederaufnahme-/Replay-Protokoll** über den Reconnect-Fall hinaus (siehe §6).
- **Kein Rate-Limit, kein Redis-Adapter** (siehe §4).
- **`GameEvent`** ist ein append-only Protokoll (`created`, `question`, `reveal`, `ended`) und die
  vorhandene Grundlage für spätere Audits/Statistiken.

---

## 8. Vorhandene Designkomponenten und Assets

### Designsystem (Bestand)

`styles/tokens.css` (795 Zeilen) enthält bereits ein Token-Set:

- **Flächen:** `--bg #08080f`, `--bg-2 #0e0e1a`, `--surface` / `--surface-2` (weiß, 4,5 % / 7,5 %),
  `--border` / `--border-strong`.
- **Text:** `--text #f5f5fb`, `--muted #9c9cb5`, `--faint #616180`.
- **Akzente:** `--accent #7c5cff` (violett), `--accent-2 #22d3ee` (cyan), `--grad` (135°-Verlauf).
- **Semantik:** `--ok #22c55e`, `--bad #f43f5e`, `--warn #f59e0b`.
- **Geometrie:** `--radius-sm 12px`, `--radius 18px`, `--radius-lg 28px`.
- **Bewegung:** `--ease`, `--spring`, `--dur-fast 150ms`, `--dur 240ms`.
- **Typografie:** System-Font-Stack (`ui-sans-serif`, …).
- **Layout:** `--content-max 1180px`, `--space-1 … --space-7`.

Vorhandene Komponentenklassen: `.card` (Glas: `backdrop-filter: blur(16px)` + Rahmen + Schatten),
`.btn` / `.btn-primary`, `.input`, `.field`, `.notice` (+`--error`/`--success`), `.toast`, `.spinner`,
`.overlay`/`.overlay__panel`, `.option`, `.leaderboard`, `.lobby__pin`, `.report-table`,
`.editor__question`, `.brand`/`.brand__logo`.

Es gibt einen **Aurora-Hintergrund** (`body::before`, drei Radialverläufe, 24 s Animation) und einen
`prefers-reduced-motion`-Zweig, der ihn abschaltet.

**Bewertung:** Das ist eine solide Grundlage, aber noch **kein vollständiges Designsystem** im Sinne
des Briefings: es fehlen abgestufte Glasvarianten, Tabs, Dropdowns, Fortschritts-/Statusanzeigen,
Ranglisten-Varianten (Podium), Avatar-Vorschauen, Countdown-Typografie und ein Bewegungs-Regelwerk.

### Vorhandene Assets (technisch geprüft, ohne Bildinterpretation)

| Datei                                  | Format               | Abmessungen     | Alphakanal | Größe     | Eingebunden als                                                               |
| -------------------------------------- | -------------------- | --------------- | ---------- | --------- | ----------------------------------------------------------------------------- |
| `packages/frontend/public/logo.png`    | PNG, 8 bit, **RGBA** | 480 × 160 (3:1) | **ja**     | 80 622 B  | `ui.ts` → `/logo.png`, Höhe 30 px (24 px < 520 px Breite), 40 px im Auth-Card |
| `packages/frontend/public/favicon.png` | PNG, 8 bit, **RGB**  | 256 × 256       | **nein**   | 109 606 B | `*.html` → `/favicon.png` (auch als `apple-touch-icon`)                       |
| `packages/frontend/public/favicon.svg` | –                    | –               | –          | –         | **entfernt** (war nirgends referenziert; aus der Historie wiederherstellbar)  |

**Phase 5b – Änderungen an den Assets (Optik unverändert):** Das Logo war 2172 × 724 / 1,20 MB, das
Favicon 1254² / 1,63 MB. Beide wurden **verlustfrei skaliert** (Logo → 480 × 160, Alpha erhalten;
Favicon → 256²) und **nicht** neu gezeichnet, umgefärbt oder generiert. Ersparnis zusammen **−93 %**
(2,83 MB → 190 KB). Die verwaiste `favicon.svg` (0 Referenzen im Code) wurde entfernt. Siehe
`docs/reports/phase-5b-revision-and-first-works.md` §4.1–4.2.

**Befunde, die eine Entscheidung des Projektverantwortlichen brauchen:**

1. Das **Favicon-PNG hat keinen Alphakanal** (RGB). Der Randbereich ist **nicht** homogen weiß
   (RGB 200–255; nur 30,4 % der Pixel „fast weiß"). Ein automatisches Freistellen würde einen Saum
   erzeugen und ist daher **unterlassen**. Bitte eine **transparente Master-Datei** bereitstellen
   (ASSET-BRIEFING, Block A). **Keine eigenmächtige Korrektur.**
2. Das Favicon-/Logo-Größenproblem ist durch die Skalierung in Phase 5b **entschärft** (siehe oben).
3. Die **`favicon.svg`** wurde als verwaist entfernt. Falls sie doch Bestand haben soll, bitte
   bestätigen (aus der Git-Historie wiederherstellbar).
4. **Keine Charakterdateien, keine Blockwelt-Helden-Assets, keine Hintergrundbilder, keine Sounds**
   sind im Repository. Für das Charakter-Universum und die Show-Bilder ist ein Asset-Briefing nötig
   (siehe `docs/assets/ASSET-BRIEFING.md`).

**Keine Bildanalyse:** Es wurden ausschließlich Format, Abmessungen, Farbtyp (Alpha ja/nein) und
Dateigröße geprüft – per Header-Auswertung, nicht per OCR oder Vision-Modell.

---

## 9. Tests, Build, CI/CD und Deployment

### Tests (181 grün mit PostgreSQL, siehe Korrektur oben)

| Paket    | Datei                           | Tests | Inhalt                                                      |
| -------- | ------------------------------- | ----- | ----------------------------------------------------------- |
| shared   | `domain.test.ts`                | 13    | Typen, Display-Allow-List, deterministisches Mischen        |
| shared   | `validation.test.ts`            | 20    | Validierung aller 13 Typen                                  |
| shared   | `scoring.test.ts`               | 29    | Punkteformel, Speed-Kurve, Teilpunkte, Ranking/Tie-Break    |
| backend  | `app.test.ts`                   | 7     | Health, Header/CSP, Fehlerbehandlung                        |
| backend  | `config.test.ts`                | 32    | Env-Strenge, `DATABASE_URL`-Ableitung, Secret-Platzhalter   |
| backend  | `deployment.compose.test.ts`    | 21    | Compose-Guards (`:?` vs `:-`) und Dokumentationsabgleich    |
| frontend | `dom.test.ts`                   | 5     | DOM-Builder, `textContent`-Sicherheit                       |
| frontend | `ui.test.ts`                    | 6     | Bausteine, Logo-Link, CSV-Escaping                          |
| frontend | `questionForm.test.ts`          | 2     | Formular je Typ                                             |
| frontend | `questionView.test.ts`          | 12    | Eingabe für alle 13 Typen, Auflösungsbalken                 |
| backend  | `api.integration.test.ts`       | 19    | **läuft mit DB**: Auth, CSRF, Quiz-CRUD, Admin              |
| backend  | `realtime.integration.test.ts`  | 3     | **läuft mit DB**: volles Spiel über Sockets                 |
| backend  | `engine.integration.test.ts`    | 9     | **läuft mit DB**: Lebenszyklus, Punkte, Ranking, Zeitregeln |
| backend  | `bootstrap.integration.test.ts` | 6     | **läuft mit DB**: Bootstrap-Admin                           |

**Lücke:** Es gibt **keine Frontend-End-to-End-Tests** (kein Playwright, obwohl im README genannt) und
**keine** Tests für Design/Komponenten. Visuelle Regression ist nicht abgedeckt.

### Build und Tooling

- **TypeScript strict** über `tsconfig.base.json`, `verbatimModuleSyntax` (deshalb
  `import type`-Disziplin).
- **Prettier** mit `.prettierrc.json`; `format:check` ist Teil der CI. Achtung:
  `.env.portainer.example` hat keinen Prettier-Parser und darf **nicht** an ein bloßes
  `prettier --check <file>` übergeben werden (der repo-weite Lauf `format:check .` ist unproblematisch).
- **Vite 6** Multi-Page-Build, Ergebnis u. a. `ui-*.css` 11,13 kB (gzip 3,00 kB) – sehr klein.

### CI/CD (`.github/workflows/`)

- `ci.yml` (nur `pull_request`): Postgres-16-Service → `npm ci` → Prisma-Generate → `migrate deploy`
  → Typecheck → Tests → Formatcheck → Build.
- `docker-publish.yml` (`push` auf `main`, Tags `v*.*.*`, manuell): identische Verifikation, danach
  Build/Push zweier Images nach GHCR (`zeropeek-backend`, `zeropeek-frontend`, Tag-Strategie
  sha/branch/semver/latest, `provenance: false`), danach optionaler Portainer-Webhook.

### Deployment

`docker-compose.yml` (lokal, 5 Services: `db`, `cache`, `backend`, `frontend`, `proxy`) und
`docker-compose.portainer.yml` (Produktion, GHCR-Images, Caddy mit TLS/ACME). Die Portainer-Datei hat
genau vier `:?`-Guards (`POSTGRES_DB/USER/PASSWORD`, `SESSION_SECRET`); alles andere hat Defaults.
Es existiert ein Regressionstest (`deployment.compose.test.ts`), der diese Guards und die
Dokumentationspflicht in `PORTAINER.md` / `ENVIRONMENT.md` / `.env.portainer.example` erzwingt.

---

## 10. Technische Risiken und Einschränkungen

| #    | Risiko / Einschränkung                                                                           | Auswirkung                                                                  | Betroffen von späteren Phasen |
| ---- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------- |
| R-1  | DB-gestützte Integrationssuiten brauchen eine PostgreSQL (ohne DB übersprungen).                 | **Entschärft (Phase 5b):** mit echter PostgreSQL laufen alle 181 Tests grün | alle                          |
| R-2  | **Einzelinstanz-Design:** Motor ist In-Memory, kein Redis-Adapter.                               | Horizontale Skalierung unmöglich ohne Umbau                                 | Realtime, Beamer, Last        |
| R-3  | **Quiz-Update löscht Fragen und kaskadiert Antworten/Historie.**                                 | Spielhistorie/Statistik kann verloren gehen                                 | Editor, Profile, Ranglisten   |
| R-4  | **Kein Zustands-Replay nach Neustart** (kein Timer, `answeredQuestionId` verloren, P2002 → 500). | Hängende Spiele, irreführende Fehler                                        | Realtime, Host                |
| R-5  | **Reconnect mitten in der Frage** stellt die Frage nicht wieder her.                             | Spieler sehen die Frage nicht                                               | Realtime, Spieler             |
| R-6  | **Kein Rate-Limit auf Socket-Events.**                                                           | Spam/Last auf `player:answer`                                               | Realtime, Sicherheit          |
| R-7  | **Kein Clock-Sync**; Countdown nutzt die Client-Uhr.                                             | Ungenaue Countdowns bei falscher Geräteuhr                                  | Beamer, Spieler               |
| R-8  | Favicon-PNG **ohne Alphakanal**; Rand nicht homogen weiß (Freistellen unsicher).                 | Optik (Kachel-Hintergrund)                                                  | Login, Branding               |
| R-9  | Verwaiste `favicon.svg` ohne Einbindung.                                                         | **Behoben (Phase 5b):** entfernt                                            | Branding                      |
| R-10 | **Keine Charakter-/Show-/Audio-Assets** im Repo.                                                 | Alle bild-/tonabhängigen Schritte blockiert                                 | Avatare, Beamer, Sound        |
| R-11 | **CSP `style-src 'self'`** ohne `unsafe-inline`; dynamische Stile nur über CSSOM.                | Neue Animationen/Effekte müssen CSP-konform sein                            | Designsystem, Beamer          |
| R-12 | **Keine E2E-/visuellen Tests.**                                                                  | Responsive-/Designregressionen bleiben unentdeckt                           | alle UI-Phasen                |
| R-13 | **`team` und `ideas`-Voting** sind deklariert, aber nicht implementiert.                         | Irreführende Erwartung                                                      | Spielmodi                     |
| R-14 | **`lead`-Phase** deklariert, nie betreten.                                                       | Tote Zustände in der Maschine                                               | Spielfluss                    |
| R-15 | **Flacher Clone**, keine Historie/Tags verfügbar.                                                | Keine historischen Aussagen/Blame möglich                                   | –                             |
| R-16 | **`GamePlayer → User` fehlt**; keine Spielerkonten.                                              | Gast→Konto-Verknüpfung braucht neue Felder/Modelle                          | Profile, XP                   |
| R-17 | **Globales HTTP-Rate-Limit 300/min** (10 000 im Test) gilt für alle Routen gleich.               | Grobe Granularität                                                          | Sicherheit                    |
| R-18 | **`sessionSecret`-Default `phase-0-placeholder`** außerhalb Produktion; in Produktion erzwungen. | Nur relevant bei falschem `NODE_ENV`                                        | Deployment                    |

---

## 11. Abhängigkeitsübersicht der Systemkomponenten

```
                    ┌──────────────────────────── @zeropeek/shared ───────────────────────────┐
                    │ constants (13 Typen, Phasen, Themes) · questions (Display-Allow-List)   │
                    │ validation · scoring (Q1/Q2/Q6 konfigurierbar) · pin · events (Verträge) │
                    └───────────────▲──────────────────────────────────────▲─────────────────┘
                                    │ importiert                            │ importiert
        ┌───────────────────────────┴────────────┐          ┌───────────────┴──────────────────┐
        │            @zeropeek/backend           │          │       @zeropeek/frontend          │
        │ app.ts ── routes ── services           │          │ pages/{player,host,editor,admin}  │
        │   │            │        │              │          │   │    │      │       │         │
        │   │            │        └ engine ──────┼──events──┼───┼────┼──────┼───────┘         │
        │   │            │             │         │          │   │    │      │                 │
        │ sessions ──────┼── auth      │         │          │ api  socket  dom  ui  tokens.css │
        │   │            │             │         │          └───────────────┬──────────────────┘
        │   └──── prisma ┴──── db ─────┘         │                          │
        └───────────────┬────────────────────────┘                          │
                        │                                                   │
                 PostgreSQL 16                                     Browser (CSP strict)
                        │                                                   │
                 docker-compose ── Caddy (TLS) ── HTTP + WebSocket ─────────┘
                        │
                 GHCR-Images ── Portainer-Stack (Produktion)
```

**Kritische Kopplungen, die bei Änderungen zu beachten sind:**

1. `shared/events.ts` ist der Vertrag zwischen Backend und beiden Clients. Eine Änderung dort wirkt
   auf Spieler **und** Host.
2. `shared/questions.ts` (`questionDisplay`) ist die Sicherheitsgrenze, die Lösungen zurückhält.
3. `shared/scoring.ts` (`ScoringSettings`) wird in `Game.settings` eingefroren – Änderungen wirken
   nur auf **neue** Spiele, wenn der Snapshot respektiert wird.
4. `mappers.ts` ist die **einzige** Stelle, die DB-Form und Domänenform kennt.
5. `engine.ts` schreibt über `gameService.ts` durch; beide zusammen sind die Persistenzgrenze.
6. `styles/tokens.css` ist heute die einzige Designquelle; sie ist von allen vier Seiten geladen.
7. `deployment.compose.test.ts` koppelt Compose-Variablen an drei Dokumentationsdateien – wer Compose
   ändert, muss die Dokumentation mitziehen.

---

## 12. Bestandsschutz: Was auf keinen Fall verändert werden darf

Aus dem Briefing (Teil B) und aus dem verifizierten Code:

- Fragen, Antworten und Lösungsfelder bestehender Quizzes.
- Bestehende Benutzerkonten, Rollen (`ADMIN`/`TRAINER`) und Berechtigungslogik.
- Die Authentifizierungslogik (Argon2id, Server-Sessions, CSRF-Double-Submit, Guards).
- Die bestehenden API-Verträge (REST-Pfade und Socket-Events), solange keine additive Erweiterung.
- Die bestehende Spiellogik (Phasenmaschine, Timer, Punkteformel-Defaults) – Änderungen nur nach
  Freigabe und nur konfigurationsgetrieben.
- Die bestehenden Tabellen/Spalten; Erweiterungen nur additiv und über dokumentierte Migrationen.
- Die vorhandenen Assets (Logo, Favicon) – keine Ersetzung ohne Zustimmung.
- Die Produktivkonfiguration (Portainer-Compose, Guards, Caddy).

**Explizit als Änderung markiert, aber nicht entschieden (nur zur Kenntnis):** Die unter §10
genannten Punkte R-3 und R-4 berühren Bestandsverhalten. Sie werden im Konzept als Risiko geführt
und **nicht** eigenmächtig geändert.

---

## 13. Offene Fragen (aus dem Bestand)

Diese Punkte sind im Code nicht eindeutig und brauchen eine Entscheidung, bevor sie umgesetzt werden:

1. **Q1/Q2/Q6** (Scoring-Formel, „zu schnell"-Regel, Tie-Break) sind weiterhin offen
   (`docs/architecture/README.md`). Die Defaults sind Vorschläge.
2. **Favicon:** Ist die transparente Variante gewünscht, und darf eine korrigierte Master-Datei
   bereitgestellt werden? Der Rand ist nicht homogen weiß – Freistellen wurde deshalb unterlassen.
   Die verwaiste `favicon.svg` wurde in Phase 5b entfernt; bitte kurz bestätigen.
3. **Charakter-Referenzen:** Die Blockwelt-Helden-Originaldateien sind **nicht** im Repo. Ohne sie ist
   Phase 6.7 nicht startbar.
4. **Spielfluss:** Soll die `lead`-Phase (Vorlese-/Spannungsphase vor der Frage) aktiviert werden?
5. **Ranglisten:** Nur innerhalb eines Spiels (heute) oder global/Tages-/Wochenranglisten?
6. **R-3 (Historieverlust bei Quiz-Bearbeitung):** Soll die Spielhistorie künftig unabhängig vom Quiz
   gespeichert werden (Frage-Snapshot je Spiel)? Das wäre eine Schemaerweiterung.

---

## 14. Zusammenfassung der Bestandsaufnahme

ZeroPeek ist auf `main` eine **technisch saubere, sicherheitsbewusste Quiz-Plattform** mit:
vollständigem Domänenmodell (13 Fragetypen, Validierung, Scoring), server-autoritativem Spielmotor,
zwei Socket-Namespaces, vier Oberflächen (Spieler, Host/Beamer, Editor, Admin), acht Datenmodellen,
einem vorhandenen Design-Token-Set, strikter CSP, CI/CD bis GHCR und Portainer – und **181 grünen Tests** (mit PostgreSQL).

Es fehlt für die Produktvision: **Spielerkonten, Profile, Charakter-/Avatar-System, XP/Level/Inventar/
Erfolge, Sterne-Login, Sound, Show-Grafiken und globale Ranglisten.** Eine eigene Beamer-Oberfläche
ist **nicht** erforderlich – die kombinierte Host-/Beamer-Ansicht bleibt verbindlich.
Der Avatar ist heute nur ein unvalidiertes Textfeld; das Charakter-Universum existiert im Code nicht.

Die wichtigsten technischen Schulden sind **R-3 (Historieverlust beim Quiz-Bearbeiten)** und
**R-4/R-5 (fehlende Zustandswiederherstellung nach Neustart/Reconnect)**, gefolgt von **R-2**
(Einzelinstanz-Design) und **R-6** (fehlendes Socket-Rate-Limit).

**Es wurde kein Anwendungscode, kein Schema und keine Deployment-Konfiguration verändert.**
