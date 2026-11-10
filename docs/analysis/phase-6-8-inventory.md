# Phase 6.8 – Bestandsanalyse und technischer Umsetzungsplan (Schritt A)

- **Branch:** `feat/phase-6-8-player-progression`
- **Basis:** `origin/main` @ `cdc9bbd` (PR #37, #38, #39, #40 gemergt)
- **Status:** Analyse vorgelegt, wartet auf Freigabe der offenen Produktentscheidungen (siehe §9)
- **Keine Codeänderung in diesem Schritt.**

## 1. Was bereits vorhanden ist (verifiziert im Code)

### 1.1 Identitäts- und Sessionmodell (Phase 6.6.3) — vollständig

`packages/backend/src/sessions.ts` hält **zwei getrennte Kontexte**:

| Kontext | Cookie                                                 | Guard                                           | Verwendung                                        |
| ------- | ------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------- |
| host    | `zp_session` (`config.sessionCookieName`)              | `requireAuth` / `requireAdmin` / `requireStaff` | Host-, Editor-, Admin-Oberflächen, `/host`-Socket |
| player  | `zp_player_session` (`config.playerSessionCookieName`) | `requirePlayerAuth`                             | Spielerprofil                                     |

- Die Session-Zeile trägt `kind`; ein Guard liest **nur** sein eigenes Cookie, und `resolve()` weist eine
  Session ab, deren `kind` nicht passt. Eine Host-Sitzung wird also **niemals** als Spieleridentität
  interpretiert.
- `destroySession` ist pro Kontext gefiltert: ein Logout beendet nur die eigene Sitzung.
- CSRF ist an die Session gebunden (`X-CSRF-Token`), `safeEqual`-Vergleich.

### 1.2 Registrierung und Spieleranmeldung (Phase 6.3/6.6.3) — vollständig

- `POST /api/auth/register` → `registerPlayer()`: validiert, hasht Argon2id, legt unbestätigtes
  `PLAYER`-Konto an, versendet Bestätigungsmail. E-Mail-Enumeration ist entschärft (gleiche Antwort,
  Timing-Angleichung). Verifizierungstoken: nur SHA-256-Hash gespeichert, einmalig, zeitlich begrenzt.
- `POST /api/auth/verify`, `POST /api/auth/resend`.
- `POST /api/auth/login` vergibt die Session **nach der verifizierten Rolle**: `PLAYER` → Spielerkontext,
  `ADMIN`/`TRAINER` → Host-Kontext. Die Rolle kommt nie aus dem Request.
- `POST /api/player-auth/login|logout`, `GET /api/player-auth/me`. Der Spieler-Login lehnt ein
  Staff-Konto ausdrücklich ab (`forbidden`), damit ein Host nie still eine Spieleridentität bekommt.
- Der Spieler-Socket-Join liest **nur** `zp_player_session` (`socket.ts`, `player:join`) und verknüpft
  `GamePlayer.userId` ausschließlich aus der Session.

### 1.3 Spielerprofil und Avatar (Phase 6.6/6.7) — vollständig

- `GET /api/profile`, `PUT /api/profile`, `PUT /api/profile/avatar`.
- `PlayerProfile` speichert `selectedCharacterId` und `avatarConfig` (JSONB); **alle Statistiken** werden
  bei jeder Anfrage aus den Spielständen berechnet (`profileService.profileStats`).
- Charakterkatalog (`shared/profile.ts`), Avatar-/Gegenstandskatalog (`shared/characters.ts`,
  `shared/cosmetics.ts`) sind **Code**, charakterexklusiv, serverseitig validiert.

### 1.4 Spielende und Fortschrittshaken

- Der Motor beendet ein Spiel in `engine.endInternal()` (`packages/backend/src/services/engine.ts`,
  Zeile ~1196): setzt `phase='end'`, `endedAt`, schreibt ein `ended`-Event und emittiert `ended`.
- Der Socket-Handler `engine.on('ended', …)` verteilt `game:ended` an die Spieler
  (`socket.ts`, `sendPlayerEnd`). **Hier ist der natürliche Ort für den XP-Haken.**
- `rankPlayers` (`shared/scoring.ts`) liefert die Platzierung inklusive Gleichstand (gleiche Ränge,
  z. B. 1, 1, 3) — die Grundlage für den Platzierungsbonus.

### 1.5 Anti-Manipulation (Bestand)

- Antworten: `@@unique([playerId, questionId])` + Motor-Prüfung → keine doppelte Punktevergabe.
- Es gibt **keinen** Client-Schreibpfad für Punkte, XP oder Inventar.

## 2. Was fehlt (Ziel dieser Phase)

| Bereich                                        | Status                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| XP-Ledger (`XpLedger`), Levelkurve in `shared` | **fehlt vollständig**                                                                                                                |
| Level-/XP-Felder am `PlayerProfile`            | **fehlt** (Schema-Kommentar verweist auf 6.8)                                                                                        |
| `PlayerInventory`, `PlayerAchievement`         | **fehlen vollständig**                                                                                                               |
| `Game.guestClaim` (Übernahmenachweis)          | **fehlt**                                                                                                                            |
| Inventar-/Erfolgs-Endpunkte                    | **fehlen**                                                                                                                           |
| Gastkonto-Übernahme (6.8.2)                    | **fehlt**                                                                                                                            |
| Frontend XP/Level/Inventar/Erfolge             | **fehlt** (Navigationspunkte „Inventory", „Settings" sind „Soon"-Platzhalter)                                                        |
| Browser-E2E-Infrastruktur                      | **fehlt** — es gibt **kein Playwright**; Frontend-Tests laufen in jsdom (`vitest`), Backend-Tests als HTTP-/Socket-Integrationstests |

## 3. Der gemeldete Fehler: Registrierung blockiert bei vorhandener Host-Sitzung

### 3.1 Befund (durch Codeanalyse bestätigt)

**Ursache gefunden.** `packages/frontend/src/pages/auth.ts`, Funktion `boot()`:

```ts
const verifyMatch = /^#verify=(.+)$/.exec(hash);
if (verifyMatch) { await showVerify(...); return; }   // verify hat Vorrang — korrekt

const me = await get('/api/auth/me');                 // HOST-Kontext
if (me.user) { location.assign(homeFor(me.user.role)); return; }  // ← überschreibt #register

// danach erst: if (hash === '#register') showRegister();
```

Ist ein Host angemeldet, liefert `/api/auth/me` einen Benutzer, und die Seite leitet **sofort** auf
`./host.html` um — **bevor** der `#register`-Hash ausgewertet wird. Der Registrierungslink
`./auth.html#register` (gesetzt in `playerView.registerOffer()` und im End-Screen des Spielers) landet
deshalb auf der Host-Konsole statt im Registrierungsformular.

- Der **Backend-Pfad ist nicht betroffen**: `/api/auth/register` prüft keine Host-Sitzung. Der Fehler
  ist rein clientseitig.
- Die `#verify=`-Weiterleitung hat bereits Vorrang; das Muster ist also vorhanden, wird aber auf
  `#register` nicht angewandt.
- **Sicherheitsfolge:** keine. Der Fix ändert nur die _clientseitige Anzeige_; alle Prüfungen bleiben
  serverseitig.

### 3.2 Geplante Korrektur (6.8.1)

1. `#register` (und `#signin`) erhalten **Vorrang** vor der „bereits angemeldet"-Weiterleitung, genau
   wie `#verify`. Eine ausdrückliche Absicht des Nutzers schlägt die Bequemlichkeits-Weiterleitung.
2. Die Weiterleitung bleibt für den **normalen** Aufruf von `auth.html` (ohne Hash) erhalten, damit ein
   angemeldeter Host weiterhin direkt zur Konsole kommt.
3. Hinweis im Registrierungsformular, wenn parallel eine Host-Sitzung besteht: „Du bist in diesem
   Browser als Host angemeldet. Das ist getrennt — dein Spielerkonto entsteht unabhängig davon."
4. Regressionstests in `auth.test.ts` (jsdom, echte Produktionspfade):
   - Host angemeldet + `#register` → **Registrierungsformular**, kein Redirect.
   - Host angemeldet + `#signin` → Anmeldeformular, kein Redirect.
   - Host angemeldet + kein Hash → Redirect auf `./host.html` (Bestand).
   - Spieler angemeldet + kein Hash → Redirect auf `./profile.html` (Bestand).
   - Registrierung wird auch bei vorhandener Host-Sitzung abgeschickt (POST `/api/auth/register`).
5. Backend-Absicherung (Integrationstest, kein Produktivcode nötig): Registrierung/Spieler-Login
   gelingen mit gesetztem `zp_session`-Cookie; Host-Login und Spieler-Login koexistieren.

### 3.3 Zur Browser-E2E-Anforderung (Briefing §3.3)

Es existiert **keine** Browser-E2E-Infrastruktur, und das Briefing verbietet eine **unnötige zweite**
E2E-Infrastruktur. Vorschlag: Die geforderten Abläufe werden als **Backend-Integrationstests** (echte
HTTP-Aufrufe mit beiden Cookies, `identity-separation.integration.test.ts` als Vorbild) **und** als
**jsdom-Tests** der echten Seitenmodule abgedeckt. Das prüft dieselben Abläufe ohne neue Infrastruktur.
Ein echtes Browser-Framework (Playwright) wäre eine **eigene** Entscheidung des Projektverantwortlichen
— siehe §9, Frage 6.

## 4. Geplante Datenmodelle (additiv)

| Modell / Feld                         | Zweck                                                                                     | Art         |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ----------- |
| `PlayerProfile.xp Int @default(0)`    | materialisierter XP-Stand (Ledger bleibt Wahrheit)                                        | Erweiterung |
| `PlayerProfile.level Int @default(1)` | materialisiertes Level                                                                    | Erweiterung |
| `XpLedger`                            | append-only Gutschriftprotokoll                                                           | neu         |
| `PlayerInventory`                     | Besitz je (user, item)                                                                    | neu         |
| `PlayerAchievement`                   | Erfolg je (user, achievementId)                                                           | neu         |
| `Game.guestClaim`                     | kurzlebiger, einmaliger Übernahmenachweis (JSONB: tokenHash, expiresAt, usedAt, playerId) | Erweiterung |
| `GamePlayer.userId`                   | **bereits vorhanden** (nullable)                                                          | vorhanden   |

**Unique-Sperren (Anti-Doppelvergabe):**

- `XpLedger @@unique([userId, gameId, reason])`
- `PlayerInventory @@unique([userId, itemId])`
- `PlayerAchievement @@unique([userId, achievementId])`

Migrationen sind **rein additiv** (neue Tabellen, neue Spalten mit Default). Keine Löschung, keine
Typänderung, keine destruktive Migration.

## 5. Geplante Levelkurve (zentral in `shared`)

Verbindlich aus `game-design-concept.md` §5.4:

- Level 1 = 0 XP.
- Aufstiege L1→L10: je 10.000 XP.
- Ab L10→L11: 11.000 XP, danach je +1.000 XP mehr.
- Eine Gutschrift kann **mehrere** Level überspringen.

Umsetzung als **eine** Funktion in `shared` (z. B. `levelForXp(xp)`, `xpForLevel(n)`,
`levelProgress(xp)`), rein und vollständig getestet (Tabellenfälle + mehrere Level aus einer Gutschrift).

## 6. Geplante XP-Vergabe (verbindlich, Phase 5c)

- **XP = erreichte Spielpunkte** (`GamePlayer.score`). Keine zweite Formel.
- **Platzierungsbonus:** 1. Platz +1.500, 2. Platz +1.000, 3. Platz +500. Gleichstand → **derselbe**
  Bonus für alle Gleichplatzierten (`rankPlayers` liefert das bereits).
- Gutschrift **einmal je (Spieler, Spiel)** beim Spielabschluss, in **einer Transaktion** mit dem
  Ledger-Eintrag und der Neuberechnung von Level/Belohnungen.
- Nur für **registrierte** Spieler (`GamePlayer.userId != null`); Gäste erhalten keine dauerhaften XP.
- Idempotent: erneutes `end` oder Retry erzeugt **keine** zweite Gutschrift.

## 7. Geplante API-Endpunkte (neu)

| Endpunkt                       | Zweck                                                                 | Guard               |
| ------------------------------ | --------------------------------------------------------------------- | ------------------- |
| `GET /api/progress`            | XP, Level, Fortschritt bis zum nächsten Level, Ranglisten-Eckwerte    | `requirePlayerAuth` |
| `GET /api/inventory`           | Besitz + Ausrüstungsstatus (auch gesperrte Gegenstände mit Bedingung) | `requirePlayerAuth` |
| `POST /api/inventory/equip`    | Gegenstand ausrüsten (serverseitig gegen Charakterkatalog validiert)  | `requirePlayerAuth` |
| `GET /api/achievements`        | Erfolgsübersicht mit Fortschritt                                      | `requirePlayerAuth` |
| `POST /api/guest-claim`        | Gastrunde übernehmen (Nachweis, Zustimmung, Transaktion)              | `requirePlayerAuth` |
| `GET /api/guest-claim/pending` | Prüfen, ob eine übernehmbare Runde vorliegt                           | `requirePlayerAuth` |

`GET /api/profile` wird **additiv** um XP/Level erweitert (kein Feld entfernt).

## 8. Vorgeschlagene Implementierungsreihenfolge

1. **6.8.1** – Registrierung/parallele Sitzungen (Frontend-Fix + Tests). Unabhängig, zuerst.
2. **6.8.3** – Levelkurve in `shared` + Tests (Fundament, keine DB nötig).
3. **6.8.3** – `XpLedger` + Migration + `progressService` + Motor-Haken + Tests.
4. **6.8.2** – `Game.guestClaim` + Migration + Übernahmeservice + Endpunkte + Tests.
5. **6.8.4** – `PlayerInventory`, `PlayerAchievement` + Migration + Service + Endpunkte + Tests.
6. **6.8.5** – Frontend: Profil-XP/Level, Inventar, Erfolge, Übernahmeangebot + Tests.
7. Doku, Qualitätsprüfung, Bericht, PR.

## 9. Risiken und offene Entscheidungen

### 9.1 Technische Risiken

| Risiko                                      | Umgang                                                |
| ------------------------------------------- | ----------------------------------------------------- |
| Doppelte XP-Vergabe                         | `XpLedger`-Unique + Transaktion + Idempotenztest      |
| Doppelte Gastübernahme / Race               | Claim einmalig (`usedAt`), Transaktion, Unique-Sperre |
| XP im Client manipulierbar                  | Kein Schreibendpunkt; alles serverseitig              |
| Mehrere Levelaufstiege aus einer Gutschrift | Levelkurve rein und vollständig getestet              |
| Bestehende Spiellogik beschädigen           | Kein Eingriff in Punkteberechnung; nur `ended`-Haken  |
| Migration beschädigt Bestand                | Rein additiv; auf Test-DB ausgeführt                  |

### 9.2 Offene Produktentscheidungen (bitte bestätigen, bevor 6.8.4 beginnt)

Das Briefing verbietet, verbindliche Produktregeln eigenmächtig zu erfinden. Folgende Punkte sind in
den Konzeptdateien ausdrücklich als **offen** markiert (`game-design-concept.md` §6.2a, §16.2):

1. **Belohnungsmatrix** (welcher Gegenstand wird bei welchem Level freigeschaltet). Die
   Levelkurve ist verbindlich, die Zuordnung Level→Gegenstand ist **offen**.
2. **Erfolgsnamen und -bedingungen** (§6.3 ist ein **Vorschlag**, nicht beschlossen).
3. **Katalog in `shared` oder in der Datenbank** (§7.2) — Vorschlag: `shared` (bereits so umgesetzt).
4. **Belohnungsassets:** Für Levelbelohnungen/Erfolge existieren **keine** Assets außer den fünf
   Ethan-/Maya-Gegenständen. Ohne Freigabe entstehen **keine** erfundenen Grafiken — es wird ein
   textlicher Platzhalter verwendet (§6.2 des Briefings).
5. **Levelbezeichnungen** ab Level 7 („Legende Stufe n").
6. **Browser-E2E:** Playwright einführen oder die geforderten Abläufe wie in §3.3 über
   Backend-Integrationstests + jsdom abdecken?

**Vorschlag für 6.8.4 ohne diese Entscheidungen:** Die **Mechanik** wird vollständig und getestet
umgesetzt (Besitz, Ausrüsten, Erfolgs-Auslösung, Belohnung je Levelaufstieg), aber die **konkrete
Zuordnung** nutzt eine **explizit als vorläufig markierte** Tabelle in `shared` mit den **vorhandenen**
Gegenständen, und alles, wofür kein Asset existiert, wird als textueller Platzhalter geführt. Die
endgültige Matrix wird nach Freigabe an **einer** Stelle ersetzt.

### 9.3 Nicht im Umfang (Bestandsschutz)

Keine Änderung an Punkteberechnung, Socket-Eventnamen/Payloads, Rollenarchitektur, Cookie-Trennung,
`GameSnapshot`, Redis, Auth-Architektur. Keine IP-Identifikation. Keine automatische Gastübernahme.

## 10. Fazit

Die **Grundlagen für 6.8.1–6.8.3 sind vollständig vorhanden** (getrennte Sessions, Registrierung,
Profil, Spielende-Haken, Rangfolge). 6.8.1 ist ein **kleiner, klar belegter Frontend-Fix**. 6.8.3 baut
auf `shared` + einer additiven Migration auf. 6.8.2 ist der sicherheitskritische Teil und wird
transaktional und mit Unique-Sperren umgesetzt. 6.8.4 braucht die in §9.2 genannten Freigaben für die
**Inhalte**; die **Mechanik** kann unabhängig davon umgesetzt und getestet werden.
