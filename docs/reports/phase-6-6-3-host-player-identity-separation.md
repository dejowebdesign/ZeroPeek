# Phase 6.6.3 – Trennung von Host- und Spieleridentität (Bericht)

- **Branch:** `feat/host-player-identity-separation-6-6-3` (von `main` = `9a6d5ca`)
- **Umfang:** echte serverseitige Trennung der Identitätskontexte **host** und **player**
- **Status:** vorgelegt, wartet auf Prüfung (kein Commit/Push/PR ohne Freigabe)

## 0. Ergebnis in einem Satz

Das eine, von allen Oberflächen geteilte Cookie `zp_session` ist durch **zwei
getrennte Kontexte** ersetzt: der Host behält `zp_session`, der Spieler erhält
`zp_player_session`, jede Session trägt ein `kind`, und jeder Guard liest
ausschließlich sein eigenes Cookie — dadurch ist ein im selben Browser
angemeldeter Host nie mehr die Spieleridentität (und umgekehrt), ein Gast bleibt
immer Gast, und Logout wirkt nur im eigenen Kontext.

## 1. Bestätigte Root Cause und behobene Fehler

**Root Cause (im Analysebericht belegt):** ein einziges Session-Cookie mit
`path=/` (`sessions.ts`), das jede Oberfläche derselben Origin mitsendet. Die
Spielerprofilseite löste ihre Identität über `GET /api/auth/me` aus genau diesem
Cookie auf; `player:join` verknüpfte einen Sitz über `resolveSession(...) →
session?.user.id → engine.join(...)` automatisch mit dem Konto im Cookie.

**Behoben:**

1. **Identity Confusion** – Profil und Beitritt beziehen Identität nicht mehr aus
   dem Host-Cookie. Das Spielerprofil liest nur `zp_player_session`.
2. **Session Collision** – Login/Logout in einem Kontext überschreibt/beendet den
   anderen nicht mehr (getrennte Cookies, getrennte Session-Zeilen).
3. **Cross-Account Attribution** – ein Gastbeitritt aus einem angemeldeten Browser
   wird nicht mehr dem Konto zugerechnet; eine Kontoverknüpfung erfolgt nur über
   den Spieler-Kontext.
4. **Logout Interference** – Abmelden im Spielerbereich beendet die Host-Sitzung
   nicht mehr (und umgekehrt).

**Nicht betroffen / weiterhin abgesichert:** der Spieler-Namespace konnte nie
Host-Rechte erlangen (`/host` verlangt Host-Session + Rolle); der Reconnect-Token
ist nicht Cookie-gebunden.

## 2. Änderungen

### 2.1 Backend

| Datei                                                                                      | Änderung                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/prisma/schema.prisma`                                                    | `Session.kind String @default("host")` + `@@index([kind])`                                                                                                                                                                                                                                                                                                           |
| `packages/backend/prisma/migrations/20261110120000_phase_6_6_3_session_kind/migration.sql` | **Neu**, rein additiv (`ADD COLUMN "kind" … DEFAULT 'host'`, Index)                                                                                                                                                                                                                                                                                                  |
| `packages/backend/src/config.ts`                                                           | `AppConfig.playerSessionCookieName` (`PLAYER_COOKIE_NAME`, Default `zp_player_session`)                                                                                                                                                                                                                                                                              |
| `packages/backend/src/sessions.ts`                                                         | **Umgebaut:** zwei Kontexte. `startSession`/`endSession`/`resolveSession` (host) und `startPlayerSession`/`endPlayerSession`/`resolvePlayerSession` (player); `requireAuth` (liest `request.auth`) und `requirePlayerAuth` (liest `request.playerAuth`); `currentUser`/`currentPlayer`; CSRF pro Kontext. `resolve` lehnt eine Session ab, deren `kind` nicht passt. |
| `packages/backend/src/routes/playerAuthRoutes.ts`                                          | **Neu:** `POST /api/player-auth/login` (nur Rolle `PLAYER`), `POST /api/player-auth/logout`, `GET /api/player-auth/me`                                                                                                                                                                                                                                               |
| `packages/backend/src/routes/profileRoutes.ts`                                             | Guard von `requireAuth` auf `requirePlayerAuth`, Identität via `currentPlayer`                                                                                                                                                                                                                                                                                       |
| `packages/backend/src/app.ts`                                                              | `registerPlayerAuthRoutes` registriert                                                                                                                                                                                                                                                                                                                               |
| `packages/backend/src/socket.ts`                                                           | `player:join` löst den Sitz nur noch über `resolvePlayerSession` (Spieler-Cookie) auf, nie über das Host-Cookie                                                                                                                                                                                                                                                      |
| `packages/backend/src/services/gameService.ts`                                             | Kommentar zur `userId`-Verknüpfung an den Spieler-Kontext angepasst                                                                                                                                                                                                                                                                                                  |

### 2.2 Frontend

| Datei                                    | Änderung                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/frontend/src/pages/profile.ts` | Boot über `GET /api/player-auth/me`; eigene **Player sign-in**-Maske bei fehlender Spielersession; **Sign out** über `POST /api/player-auth/logout`; Host-Session wird nie konsultiert |

### 2.3 Tests

| Datei                                                          | Änderung                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/backend/src/identity-separation.integration.test.ts` | **Neu** – Akzeptanzsuite T01–T20 (22 Tests)                                                      |
| `packages/backend/src/profile.integration.test.ts`             | `signIn` nutzt `POST /api/player-auth/login`; neuer Test: Host-Session auf dem Profil ⇒ 401      |
| `packages/backend/src/realtime.integration.test.ts`            | Seat-Linking-Test nutzt den Spieler-Login                                                        |
| `packages/frontend/src/profile.test.ts`                        | Auf Spieler-Kontext umgestellt; neue Tests: Host-only ⇒ Anmeldung, Spieler-Login, Spieler-Logout |

## 3. API-Endpunkte

**Neu:**

| Endpunkt                  | Methode | Kontext | Zweck                                                            |
| ------------------------- | ------- | ------- | ---------------------------------------------------------------- |
| `/api/player-auth/login`  | POST    | player  | Spieler-Anmeldung; nur Rolle `PLAYER`; setzt `zp_player_session` |
| `/api/player-auth/logout` | POST    | player  | Spieler-Abmeldung; löscht nur `zp_player_session`                |
| `/api/player-auth/me`     | GET     | player  | Spieler-Session + CSRF-Token                                     |

**Geändert (Kontext):**

| Endpunkt           | vorher (Kontext) | jetzt (Kontext) |
| ------------------ | ---------------- | --------------- |
| `GET /api/profile` | host             | **player**      |
| `PUT /api/profile` | host             | **player**      |

**Unverändert:** `POST /api/auth/login|logout`, `GET /api/auth/me`, Quiz-/Report-/
Admin-Routen (weiter host).

## 4. Socket-Verträge

**Keine Event- oder Payload-Änderung.** Der `/host`-Namespace ist unverändert.
Geändert hat sich nur die **Herkunft** der Konto-ID beim `player:join`: sie kommt
jetzt ausschließlich aus `zp_player_session`. Reconnect (`player:rejoin` mit
`gameId`/`playerId`/`token`) und Room-Zuordnung sind unverändert.

## 5. Datenbankmigration

`20261110120000_phase_6_6_3_session_kind` – **rein additiv**:

```sql
ALTER TABLE "sessions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'host';
CREATE INDEX "sessions_kind_idx" ON "sessions"("kind");
```

Kein `DROP`, kein `UPDATE` bestehender Zeilen. Bestehende Sessions werden als
Host-Sessions gelesen und bleiben gültig. Auf der Test-DB mit
`prisma migrate deploy` angewandt. Keine neuen **Pflicht**-ENV-Werte;
`PLAYER_COOKIE_NAME` ist optional.

## 6. Sicherheitsmaßnahmen

- Getrennte Cookie-Namen, getrennte Session-Zeilen (`Session.kind`), getrennte
  Auflösung und Guards.
- Ein Guard liest **nur** sein eigenes Cookie; eine Session mit fremdem `kind`
  wird abgelehnt.
- CSRF bleibt erzwungen und ist **kontextgebunden** (Host-Token auf Spielerroute
  und umgekehrt ⇒ 403).
- Cookie-Löschung nutzt dieselben Attribute wie das Setzen (`path=/`).
- Rollen serverseitig; `PLAYER` erreicht weder Quiz-/Report- noch Admin-Routen.
- Keine IP-Erkennung, keine Client-seitige Berechtigungsentscheidung.

## 7. Testergebnisse (konkrete Zahlen)

| Suite                                        | Ergebnis       |
| -------------------------------------------- | -------------- |
| Backend (`vitest --root packages/backend`)   | **274/274** ✅ |
| davon neu `identity-separation…`             | **24/24** ✅   |
| Frontend (`vitest --root packages/frontend`) | **361/361** ✅ |
| Shared (`vitest --root packages/shared`)     | **106/106** ✅ |
| Typecheck (alle Workspaces)                  | ✅             |
| Lint                                         | ✅             |
| Format (`prettier --check .`)                | ✅             |
| Build (shared + backend + frontend)          | ✅             |

Ausgeführt gegen eine echte PostgreSQL (Test-DB, Migration angewandt). Alle
Regression-Suiten (Login, Logout, Profil, Beitritt, Reconnect, Host-Steuerung,
Lobby-Sync, Berechtigungen) sind grün.

## 8. Ergebnis der Akzeptanztests T01–T20

| ID  | Test                                      | Ergebnis | Nachweis                                                           |
| --- | ----------------------------------------- | -------- | ------------------------------------------------------------------ |
| T01 | Host + Gast, zwei Tabs desselben Browsers | ✅       | Host-Cookie am Gast-Socket ⇒ `userId = null`, Host startet         |
| T02 | Host angemeldet, Gast tritt per PIN bei   | ✅       | Sitz bleibt Gast                                                   |
| T03 | Host angemeldet, Spieler öffnet Profil    | ✅       | `/api/player-auth/me` + `/api/profile` ⇒ 401                       |
| T04 | Host + PLAYER gleichzeitig angemeldet     | ✅       | beide Sessions aktiv, kein Identitätstausch                        |
| T05 | Gast ohne Konto                           | ✅       | Beitritt nur mit Nickname                                          |
| T06 | Gast versucht Host-Aktion                 | ✅       | `/host`-Namespace ⇒ `unauthorized`                                 |
| T07 | Spieler versucht Admin-API                | ✅       | `/api/admin/users` ⇒ 401                                           |
| T08 | Host steuert laufendes Spiel              | ✅       | `host:start`/`host:end` unverändert                                |
| T09 | Spieler verliert Verbindung               | ✅       | `player:rejoin` mit Token ⇒ `phase=lobby`                          |
| T10 | Host meldet sich ab, Spieler bleibt       | ✅       | Host-Logout ⇒ Spielersession intakt                                |
| T11 | Spieler meldet sich ab, Host bleibt       | ✅       | Spieler-Logout ⇒ Host steuert weiter                               |
| T12 | Zwei Geräte mit gleicher IP               | ✅       | Cross-Context-Cookies ⇒ 401                                        |
| T13 | Spielerprofil und Statistiken             | ✅       | `?userId=<fremd>` ⇒ eigenes Profil                                 |
| T14 | Gast + bestehendes Host-Cookie            | ✅       | keine automatische Kontoverknüpfung (`userId = null`)              |
| T15 | Gleichzeitige Sockets                     | ✅       | Spieler-Socket ohne Host-Kommandos; Sitz korrekt verknüpft         |
| T16 | Abgelaufene Session                       | ✅       | Spieler **und** Host ⇒ 401                                         |
| T17 | Host- und Spieler-Login gleichzeitig      | ✅       | beide Cookies, beide Sessions, kein Überschreiben                  |
| T18 | CSRF-Token des falschen Kontexts          | ✅       | Host-Token auf Spieler-PUT ⇒ 403; Spieler-Token auf Host-PUT ⇒ 403 |
| T19 | Spieler-Logout bei laufendem Host         | ✅       | Host voll funktionsfähig                                           |
| T20 | Host-Logout bei laufendem Spieler         | ✅       | Spielerprofil lädt weiter                                          |

Zusätzlich: ein Host-Konto kann sich **nicht** über `/api/player-auth/login`
anmelden (403, keine Spielersession).

## 8a. Nachbesserung nach unabhängigem Review (Finding 1 + Finding 2)

Nach der unabhängigen Prüfung wurden **zwei** Punkte freigegeben und umgesetzt.
Der Umfang der Nachbesserung beschränkt sich ausschließlich auf diese beiden
Punkte.

### Finding 1 — PLAYER-Login über `auth.html` erzeugte einen Host-Kontext

**Befund.** `POST /api/auth/login` (die allgemeine Anmeldeseite `auth.html`) rief
immer `startSession` auf, also den **Host**-Kontext. Ein `PLAYER`, der sich dort
anmeldete, erhielt ein `zp_session`-Cookie. Die Profilseite liest jedoch
`/api/player-auth/me` (Spieler-Kontext) und antwortete mit 401; die
Sitzverknüpfung beim Beitritt griff ebenfalls nicht mehr.

**Entscheidung (Option C, durch den Eigentümer).** `POST /api/auth/login` vergibt
den Kontext anhand der **serverseitig geprüften Rolle**: ein `PLAYER` erhält den
Spieler-Kontext (`startPlayerSession`, Cookie `zp_player_session`), `ADMIN` und
`TRAINER` behalten den Host-Kontext (`startSession`, Cookie `zp_session`). Die
Rolle stammt aus der Anmeldeauswertung, nie aus der Anfrage — ein Client kann
seinen Kontext nicht wählen. `/api/player-auth/login` bleibt als eigener,
rollengebundener Endpunkt erhalten.

**Frontend.** `auth.html` leitet nach der Anmeldung rollenabhängig weiter:
`ADMIN`/`TRAINER` → `host.html`, `PLAYER` → `profile.html`. Beim Start prüft die
Seite zusätzlich `/api/player-auth/me`, damit eine bereits angemeldete
Spielersitzung (Cookie `zp_player_session`, das `/api/auth/me` nicht liest) zur
Profilseite führt statt erneut das Formular zu zeigen. Der Gastweg („Join a game
instead") bleibt unverändert.

**Tests.** Neuer Backend-Test: ein `PLAYER` über `/api/auth/login` setzt **nur**
`zp_player_session`, `/api/player-auth/me` und `/api/profile` antworten 200,
`/api/auth/me` 401, und es existiert genau eine Spieler- und keine Host-Session.
Ein zweiter Test stellt sicher, dass `ADMIN`/`TRAINER` weiterhin nur `zp_session`
erhalten. Ein dritter Test belegt, dass die Sitzverknüpfung über den
allgemeinen Login genauso funktioniert wie über den Profil-Login (Kontoverknüpfung
vorhanden, Gast bleibt unverknüpft). Frontend-Tests prüfen die rollenabhängige
Weiterleitung (Spieler → `profile.html`, Staff → `host.html`) sowie die
Weiterleitung nach Formular-Login. Der bestehende Rollen-Grenzen-Test in
`registration.integration.test.ts` wurde auf den neuen Vertrag angepasst
(Spieler-Cookie ⇒ 401 auf den Trainer-Oberflächen) und um einen Test ergänzt, der
die 403-Rollenschranke bei einer Host-Session eines Nicht-Staff-Kontos absichert.

### Finding 2 — irreführende Meldung bei „noch kein Charakter gewählt"

**Befund.** In `packages/frontend/src/pages/profile.ts` behandelte die
Charakterauswahl den gültigen Startzustand `selectedCharacterId: null` wie eine
**unbekannte** Kennung und zeigte „“null" is not one of the characters on offer.
Choose one below to replace it." Der Fehler bestand bereits vor 6.6.3 (aus 6.6.2)
und ist keine Regression dieser Phase.

**Korrektur.** `null` gilt nun als gültiger Zustand („noch nichts gewählt") und
löst keine Warnung aus; nur eine **gespeicherte, aber unbekannte** Kennung wird
weiterhin ehrlich gemeldet. Der Auswahlbereich bleibt unverändert angeboten.

**Tests.** Neuer Frontend-Test: ein Profil mit `selectedCharacterId: null` zeigt
weder die „is not one of the characters on offer"-Meldung noch den Text „null";
die Auswahl ist vollständig vorhanden, nichts vorausgewählt, „Save" deaktiviert.
Der bestehende Test für eine echte unbekannte Kennung (`legacy-hero`) bleibt
bestehen.

### Verifikation der Nachbesserung

- Backend **274/274**, Frontend **361/361**, Shared **106/106**.
- Typecheck, Lint, Prettier (`format:check`) und Build grün.
- Live-HTTP-Smoke gegen den echten Server: Login eines `PLAYER` über
  `/api/auth/login` setzt `zp_player_session`; `/api/player-auth/me` ⇒ 200,
  `/api/auth/me` ⇒ 401, `/api/profile` ⇒ 200.

## 9. Bekannte Einschränkungen

- `auth.html` ist die **allgemeine** Anmeldung: sie vergibt den Kontext anhand
  der Rolle (Spieler → `profile.html`, Staff → `host.html`). Die
  Spieler-Anmeldemaske auf der Profilseite bleibt zusätzlich bestehen.
- Der bestehende Host-Login authentifiziert weiterhin auch `PLAYER`-Konten (die
  Rollen-Grenze liegt auf den Trainer-/Admin-Oberflächen). Das ist unverändert
  und ohne Auswirkung auf die Kontexttrennung.

## 10. Offene Punkte

- Gastkonto-Übernahme bleibt **6.8** vorbehalten (keine Vorarbeit hier).
- `PLAYER_COOKIE_NAME` ist optional; in der Portainer-Doku nur erwähnt, kein
  neuer Pflichtwert.

## 11. Aktualisierte Roadmap

- `docs/phases.md`: 6.6 als **Complete** markiert (6.6.1 + 6.6.2 + 6.6.3).
- `docs/roadmap/technical-roadmap.md`: neuer Abschnitt **§7.1 Phase 6.6.3**.
- `docs/architecture/0006-security-model.md`: zwei Identitätskontexte, kontextgebundenes CSRF.
- `docs/deployment/ENVIRONMENT.md`: `PLAYER_COOKIE_NAME` dokumentiert.

## 12. Freigabe

Änderungen liegen **lokal** auf `feat/host-player-identity-separation-6-6-3`.
**Kein Commit, kein Push, kein PR, kein Merge, kein Deployment.** Wartet auf die
ausdrückliche Freigabe durch Dejan Popovic.
