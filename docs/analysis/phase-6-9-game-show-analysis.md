# Phase 6.9 – Game-Show-Modus: Technische Bestandsaufnahme und Implementierungsplanung

- **Branch (lokal):** `maintenance/phase-6-8-6-css-contract-docs` (kein neuer Branch angelegt)
- **Basis:** `origin/main` @ `177b63c` (Merge PR #46)
- **Status:** Analyse vorgelegt, wartet auf Freigabe durch chrisB (siehe §12)
- **Keine Codeänderung in diesem Schritt.** Dies ist die **einzige** in diesem Auftrag neu angelegte Datei.

> **Methode.** Alle Aussagen sind gegen den tatsächlichen Code (`packages/**`) und die vorhandenen
> Dokumente (`docs/**`) verifiziert. Wo etwas **nicht** vorhanden ist, ist es ausdrücklich als „fehlt"
> gekennzeichnet. Es wurden keine Annahmen aus älteren Reports ungeprüft übernommen.

**Legende:** ✅ vorhanden · ⚠️ teilweise vorhanden · ❌ fehlt

---

## 1. Tatsächlicher Git- und Repository-Stand

| Prüfung                         | Ergebnis                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| Lokaler Branch                  | `maintenance/phase-6-8-6-css-contract-docs`                                               |
| Lokaler HEAD                    | `8dd784d` (Commit der Phase 6.8.6)                                                        |
| `origin/main`                   | `177b63c` – „Merge pull request #46 from …maintenance/phase-6-8-6-css-contract-docs"      |
| Abgleich lokal ↔ `origin/main`  | Lokaler Branch liegt **hinter** `origin/main` (PR #46 wurde gemergt). Kein Reset/Rebase durchgeführt. |
| Offene Pull Requests            | **keine** (`gh pr list --state open` → leer)                                              |
| Arbeitsverzeichnis              | Sauber bis auf die erwartete **ungetrackte** Eigentümerdatei                              |
| Ungetrackte Datei               | `ZeroPeek_Ethan_Maya_Charakterbibliothek.zip` (unangetastet, nicht committet)             |

**Wichtig für die Umsetzung:** Phase 6.8.6 ist gemergt; `main` enthält den Bereinigungs-Stand. Der
lokale Checkout ist noch auf dem alten Stand, was für diese reine Analyse ohne Belang ist. Ein späterer
Implementierungsbranch muss von **`origin/main` @ `177b63c`** (oder neuer) abzweigen.

**Verifikation des bekannten Stands:**

- PR #45 (Phase 6.8.5, Clock-Sync/Socket-Rate-Limit) ist gemergt.
- PR #46 (Phase 6.8.6) ist gemergt; Merge-Commit `177b63c`.

---

## 2. Aktuelle Architektur der Host- und Beamer-Ansicht

### 2.1 Kombinierte Ansicht (verbindlich, bereits so umgesetzt)

Es gibt **keine** separate Beamer-Surface und **keine** separate Route. Der Beamer ist die Host-Seite
`packages/frontend/src/host.html` → `packages/frontend/src/pages/host.ts`. Sie steuert **und** zeigt.

- **Ein HTML-Eintrag:** `host` in `packages/frontend/vite.config.ts` (kein neuer Eintrag nötig).
- **Zwei Stylesheets:** `styles/tokens.css`, `styles/backdrop.css`.
- **Socket:** Namespace `/host`, authentifiziert über das Session-Cookie (`zp_session`), Rolle
  `ADMIN`/`TRAINER` (`packages/backend/src/socket.ts`, `hosts.use(...)`).
- **Kein Show-Token, keine zweite Spiel-Engine.** Die Anzeige liest ausschließlich den serverseitigen
  Zustand.

### 2.2 Vorhandene Host-Bildschirme (`pages/host.ts`)

| Bildschirm     | Funktion                | Rendert                                                            |
| -------------- | ----------------------- | ------------------------------------------------------------------ |
| Lobby          | `showLobby(pin, …)`     | PIN, Beitritts-URL (`location.origin + '/'`), wachsende Spielerliste |
| Frage          | `showQuestion(...)`     | Frage, „Question x of y", Countdown-Ring, Antwortanzahl, Optionen  |
| Auflösung      | `showReveal(reveal)`    | `revealBody(reveal)` (Lösung + Verteilung oder „skipped")          |
| Rangliste      | `showBoard(players)`    | `leaderboard--show`                                                |
| Podium/Ende    | `showPodium(players)`   | Klassisches 3er-Podium + Rest-Rangliste                            |
| Report         | `showReport(id)`        | HTTP-Report eines beendeten Spiels                                 |

Der Einstieg ist **`renderHostState(input)`**: Es entscheidet anhand der **Server-Phase**
(`hostScreen(state)` aus `hostView.ts`) welcher Bildschirm erscheint — nie anhand lokalen Zustands.

### 2.3 Vorhandene Beamer-Bausteine

- **`showView.ts`** (rein, testbar): `questionDisplayOptions(question)` (Antworttexte aus dem
  lösungsfreien `display`), `leaderboardRow(player, index)`, `podiumPlace(player, rank)` (nutzt den
  vorhandenen Avatar; Platz 1/2/3 mit Modifier-Klassen).
- **`hostView.ts`** (rein, testbar): `hostScreen`, `hostActions(phase, paused, type)`,
  `revealBody(reveal)`, `attachHostHandlers` (idempotente Listener-Registrierung).
- **`ui.ts`**: `countdown(seconds, ratio)` (Wireframe-Ring), `chip`, `button`, `confirmDialog`, …
- **`avatar.ts` / `playerAvatar(...)`**: stellt Spieler mit Avatar dar; nutzt ausschließlich
  gelieferte Charakter-Artworks (Ethan/Maya) und fällt sonst auf ein Buchstaben-Badge zurück.

### 2.4 Vorhandenes Show-Styling

`tokens.css` enthält bereits einen Beamer-Block (`.show`, `.show__board`, `.show__options`,
`.show__option`, `.leaderboard--show`, `.podium*`) mit einer eigenen **vmin-basierten Show-Skala**:

- `--show-measure: min(94vw, 1500px)`, `--show-gap`, `--show-pad`
- `--type-show-question`, `--type-show-answer`, `--type-show-meta`, `--type-show-score`,
  `--type-show-rank`, `--type-show-name`
- Beamer-Breakpoint ≥ 1600 px; `prefers-reduced-motion` schaltet Animationen ab.

**Fazit §2:** Das **Grundgerüst** einer Show-Fläche existiert bereits (Lobby → Frage → Auflösung →
Rangliste → Podium). Phase 6.9 baut darauf auf und ergänzt **Szenen, Übergänge, Steuer-/Anzeige-
Trennung** — es entsteht keine zweite Oberfläche.

---

## 3. Bestehende Game-States und Socket-Events

### 3.1 Zustandsmaschine (server-autoritativ)

`GAME_PHASES = ['lobby', 'lead', 'question', 'reveal', 'board', 'end']`
(`packages/shared/src/constants.ts:113`).

**Verifizierter Befund:** Die Phase `lead` ist **deklariert, wird aber nie betreten**. Der Motor geht
von `lobby` direkt nach `question`:

- `engine.startInternal` setzt `phase = 'question'` und ruft `advance(...)`
  (`engine.ts:651–666`).
- `advance(...)` öffnet die Frage, setzt `phase = 'question'`, `openedAt`, armt den Timer
  (`engine.ts:603–644`).
- Es gibt **keinen** Code, der `'lead'` als Phase setzt (Volltextsuche: nur die Deklaration in
  `constants.ts`).

Automatische Übergänge (Timer): `reveal` → `board` nach `REVEAL_MS = 6000`, `board` → nächste Frage
nach `BOARD_MS = 6000` (`engine.ts:110–111`).

### 3.2 Engine-Events (intern → Socket-Fan-out)

`EngineEvents` (`engine.ts:98–107`): `lobby`, `question`, `answers`, `reveal`, `board`, `ended`,
`paused`, `resumed`.

Fan-out in `packages/backend/src/socket.ts` (`engine.on(...)`):

| Engine-Event | Host-Namespace (`/host`)     | Player-Namespace (`/`)            |
| ------------ | ---------------------------- | --------------------------------- |
| `lobby`      | `host:lobby {pin, players}`  | `game:state {phase:'lobby', …}`   |
| `question`   | `host:question (PublicQuestion)` | `game:question (PublicQuestion)` |
| `answers`    | `host:answers {questionId, answered, total}` | – (nur Host)          |
| `reveal`     | `host:reveal (HostReveal)`   | `game:reveal` (pro Spieler privat) |
| `board`      | `host:board {players}`       | `game:board {players}`            |
| `ended`      | `host:ended {players}`       | `game:ended` (pro Spieler privat) |
| `paused`     | `host:paused {questionId, remainingMs}` | `game:paused {…}`      |
| `resumed`    | `host:resumed {questionId, remainingMs}` | `game:resumed {…}`    |

Zusätzlich: `clock:pong` (Clock-Sync, Phase 6.8.5), `game:host` (Host-Präsenz an Spieler),
`game:kicked`, `game:claimable`, `host:error`.

### 3.3 Host-Befehle (Client → Server)

`HostClientEvents` (`events.ts:271–289`): `host:create`, `host:start`, `host:next`, `host:reveal`,
`host:board`, `host:end`, `host:pause`, `host:resume`, `host:skip`, `host:kick`, `host:join`,
`clock:ping`. Jeder Befehl wird über `assertHost(gameId)` autorisiert (`socket.ts:244–251`).

### 3.4 Reconnect-Zustände (bereits phase-aware)

- **Host:** `HostState` (`events.ts:113–137`): `gameId, pin, phase, question, reveal, players,
  podium, answers, paused, skipped`. Wird bei `host:create`/`host:join` geliefert.
- **Spieler:** `PlayerSync` (`events.ts:80–98`).

**Wichtig:** `HostState` und `PublicQuestion` liefern bereits **`phase`, `question.index`,
`question.total`, `paused`, `remainingMs`, `openedAt`**. Es fehlen u. a. **Kategorie** und
**Punktedeltas/Rangverschiebungen** (siehe §4/§5/§6).

### 3.5 Nutzbare vorhandene Payload-Felder für die Show

| Bedarf der Show            | Vorhandenes Feld                                   | Quelle                         |
| -------------------------- | -------------------------------------------------- | ------------------------------ |
| Fragenposition             | `PublicQuestion.index`, `.total`                   | `engine.publicQuestion`        |
| Restzeit / Ring            | `PublicQuestion.openedAt`, `.timeLimit`, `.remainingMs`, `.paused` + Clock-Sync | `engine` + `clockSync.ts` |
| Antworttexte               | `PublicQuestion.display.options` (bzw. `items`, …) | `questionDisplay`              |
| Antwortverteilung          | `HostReveal.distribution` (nur Host)               | `engine.revealInternal`        |
| Richtige Lösung            | `HostReveal.question` (nur ab Reveal)              | `engine`                       |
| Teilnehmer / Rang          | `PublicPlayer[]` (`nickname, avatar, score, connected`) | `engine.leaderboard`      |
| Podium (Top 3)             | `HostState.podium` / `host:ended`                  | `engine.hostState`             |
| Host-Präsenz               | `game:host`                                        | `socket.ts`                    |
| **Kategorie**              | ❌ fehlt in `PublicQuestion`                        | –                              |
| **Punkteänderung**         | ❌ fehlt als Delta (nur `OwnResult.points` an den Spieler selbst) | –             |
| **Rangverschiebung**       | ❌ fehlt als Delta (nur absolute Reihenfolge)       | –                              |
| **Start-Countdown**        | ❌ keine `lead`-Phase, kein Event                   | –                              |

---

## 4. Zuordnung der 13 Szenen zu den vorhandenen Zuständen

**Regel:** Es werden **keine** neuen Game-States erfunden, wenn ein bestehender Zustand genügt.
„Anzeige-Szene" = rein clientseitige Darstellung auf Basis vorhandener Daten.

| #  | Szene                  | Serverzustand / Phase | Vorhandene Daten | Fehlende Daten | Neue Server-Funktion? | Neue Socket-Events? | Neue Frontend-Komponenten | Übergang zu |
| -- | ---------------------- | --------------------- | ---------------- | -------------- | --------------------- | ------------------- | ------------------------- | ----------- |
| 1  | Begrüßung (Welcome)    | – (clientseitig)      | Logo (`public/logo.png`), Titel | Hintergrundbild | nein | nein | `showWelcome` | → 2 |
| 2  | Spielerbeitritt        | `lobby`               | `pin`, `players[]`, `location.origin` | Avatar-Wand-Anim. | nein | nein | `showJoin` (PIN groß + URL + Wand) | → 3 |
| 3  | Teilnehmerübersicht    | `lobby`               | `players[]` | Raster-Darstellung | nein | nein | `showParticipants` (Grid) | → 4 |
| 4  | Start-Countdown        | **`lead` (neu)**      | – (nur Host-Aktion `host:start`) | **alles** | **ja** (`lead`-Phase) | **ja** (`host:lead`/`game:lead`) | `showStartCountdown` | → 5 |
| 5  | Fragenanzeige          | `question`            | `text`, `index`, `total` | **`category`** | **ja** (Feld ergänzen) | nein (Feld in `PublicQuestion`) | `showQuestion` (erweitert) | → 6/7 |
| 6  | Antwortmöglichkeiten   | `question`            | `display.options` | – | nein | nein | `showOptions` (aus `questionDisplayOptions`) | → 7 |
| 7  | Countdown              | `question`            | `openedAt`, `timeLimit`, Clock-Sync | – | nein | nein | vorhandener `countdown()` | → 8 |
| 8  | Antwortauflösung       | `reveal`              | `HostReveal.distribution`, Lösung | – | nein | nein | `showReveal` (erweitert) | → 9/10 |
| 9  | Punktevergabe          | `reveal`              | `players[]` (neue Scores) | **Punktedeltas** | **ja** (Delta berechnen) | **ja** (`host:points` o. Erw.) | `showPoints` (Animation) | → 10 |
| 10 | Zwischenrangliste      | `board`               | `players[]` (absolute Reihenfolge) | **Rangdeltas** | **ja** (Vorrang merken) | **ja** (`host:board` erweitern) | `showBoard` (Rangwechsel) | → 11/5 |
| 11 | Finalrunde             | **❌ kein State**      | – | **alles** | **Entscheidung nötig** | ggf. neu | `showFinalRound` | → 12 |
| 12 | Gewinnerpodium         | `end`                 | `podium`/`players[]`, Avatare | (Feinschliff) | nein | nein | `showPodium` (erweitert) | → 13 |
| 13 | Abschluss              | `end`                 | `reportService.gameReport` (HTTP) | Show-Statistik-Subset | ⚠️ ggf. | nein | `showOutro` | → 1 |

**Kernaussagen:**

- **8 von 13 Szenen** (1,2,3,5,6,7,8,12,13 — mit 5 als „Feld ergänzen") lassen sich **ohne neue
  Server-Phase** darstellen.
- **Szene 4** erzwingt die **echte `lead`-Phase** (Auftrag §5.1 verbindlich).
- **Szene 9/10** brauchen **Punktedeltas** und **Rangverschiebungen** — derzeit existieren nur
  absolute Werte; die Deltas müssen serverseitig berechnet werden.
- **Szene 11 (Finalrunde)** hat **kein Gegenstück** im Motor und ist eine **Produktentscheidung**.

---

## 5. Fehlende Backend-Funktionen

### 5.1 `lead`-Phase (Szene 4) — **verbindlich neu**

Anforderung: Der Start-Countdown ist eine **echte serverseitige Phase**, kein reiner Client-Timer.

Erforderliche Änderungen (nur benennen, **nicht** umsetzen):

- `engine.startInternal` (`engine.ts:651`): statt direkt `advance(...)` zu rufen, in die `lead`-Phase
  wechseln (`setPhase(gameId, 'lead', …)`), `leadStartedAt`/`leadEndsAt` setzen, Timer auf
  `advance(...)` armen.
- Neues Engine-Event `lead` + Fan-out `host:lead` / `game:lead` (Payload: verbleibende Sekunden bzw.
  `startedAt`/`endsAt`, damit der Client per Clock-Sync denselben Countdown zeigt).
- **Recovery** (`recoverCurrentQuestion`, `engine.ts:348`): eine beim Neustart offene `lead`-Phase muss
  ihren Timer neu armen (analog `reveal`/`board`), sonst hängt das Spiel im Countdown.
- **`hostActions`** (`hostView.ts:109`): in `lead` ggf. „Skip countdown"/„Start now" anbieten.
- **`hostScreen`/`hostScreen`-Mapping** (`hostView.ts:75`): `lead` auf den Countdown-Bildschirm.
- **`HostState`** um `lead`-Feld ergänzen (analog `answers`), damit ein Reconnect den Countdown
  wiederherstellt.

**Risiko:** Berührt die zentrale Zustandsmaschine + Recovery + bestehende Tests
(`engine.integration.test.ts` prüft `['question','reveal','board']` als Reihenfolge — siehe §11).

### 5.2 Kategorie in der Fragenanzeige (Szene 5)

`PublicQuestion` (`events.ts:30–49`) trägt **keine** `category`. Die Daten **existieren** im
Fragenmodell (`QuestionBase.category`, `questions.ts:28`) und im Snapshot, werden aber von
`engine.publicQuestion` (`engine.ts:453–468`) **nicht** mitgesendet.

- **Fix:** `category?` (und optional `difficulty?`) in `PublicQuestion` aufnehmen; in
  `publicQuestion` durchreichen. Optionales Feld → **rückwärtskompatibel**.

### 5.3 Punktedeltas (Szene 9)

Bei `reveal` kennt der Server die pro Spieler vergebenen Punkte (aus `playerAnswer.points`), sendet
sie aber nur **privat** an den jeweiligen Spieler (`OwnResult.points`) — der Host/Beamer erhält nur
die **Verteilung**. Für „Punkte steigen" braucht die Show pro Spieler das **Delta** der gerade
beendeten Frage.

- **Fix (Vorschlag):** Beim Reveal je Spieler `pointsDelta` ermitteln und dem Host senden
  (neues Event `host:points` **oder** Erweiterung von `host:reveal`). Serverseitig, idempotent, aus
  den bereits geschriebenen `playerAnswer`-Zeilen — **keine** doppelte Punktevergabe.

### 5.4 Rangverschiebungen (Szene 10)

`board` liefert die **absolute** Reihenfolge. Für „Rangwechsel animiert" wird die **Vorrang-Position**
benötigt.

- **Fix (Vorschlag):** Die Rangfolge der vorigen Frage merken (Runtime + ggf. Event-Log) und je
  Spieler `previousRank`/`rankDelta` mitsenden. Rein additiv.

### 5.5 Finalrunde (Szene 11) — **offene Produktentscheidung**

Der Motor kennt **keinen** Finalrunden-Zustand; die letzte Frage führt direkt zu `end`
(`advance`, `engine.ts:607–609`). Optionen (Entscheidung chrisB):

- **(a) Anzeige-only:** „Finalrunde"-Einblendung vor der letzten Frage, ohne Motoränderung (erkennt
  die letzte Frage clientseitig an `index === total - 1`).
- **(b) Neuer Zustand:** eigene `final`-Phase (oder ein `isFinal`-Flag an der Frage) mit eigener
  Wertungs-/Regellogik — deutlich größerer Umfang, berührt Scoring.

**Empfehlung:** (a) für 6.9, (b) als eigene spätere Phase. **Nicht eigenmächtig umsetzen.**

### 5.6 Abschluss-Statistiken (Szene 13)

`reportService.gameReport(gameId)` (`reportService.ts:58`) liefert Spieler-/Fragenstatistik über
**HTTP** (nicht über den Socket). Für die Abschlussszene genügt ein **Subset**; ob ein neues
Socket-Event nötig ist oder der Host den HTTP-Report lädt, ist eine **Detailentscheidung**
(§12, offene Fragen).

---

## 6. Fehlende Shared-Contracts und Events

Alle in `packages/shared/src/events.ts`. Änderungen sind **additiv** (optionale Felder / neue Events),
bestehende Verträge bleiben gültig.

| Contract                       | Änderung                                                                 | Grund                     |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------- |
| `PublicQuestion`               | `category?: string`, `difficulty?: string`                               | Szene 5 (Kategorie)       |
| `HostState`                    | `lead: { endsAt: number } \| null` (o. ä.)                               | Szene 4 (Reconnect)       |
| `PlayerSync`                   | (optional) `lead`-Feld                                                   | Konsistenz Spieler/Beamer |
| `HostServerEvents`             | `host:lead` (Countdown-Start)                                            | Szene 4                   |
| `PlayerServerEvents`           | `game:lead` (Countdown-Start)                                            | Szene 4                   |
| `HostServerEvents`             | `host:points {questionId, deltas:[{playerId, points, score}]}` (Vorschlag) | Szene 9                 |
| `HostServerEvents`             | `host:board` um `previousRank`/`rankDelta` erweitern (o. neues `host:ranks`) | Szene 10             |
| `HostClientEvents`             | (optional) `host:startNow`/`host:skipLead`                               | Szene 4 (Countdown überspringen) |
| `HostEventHandlers` (`hostView.ts`) | Handler für neue Events ergänzen; `attachHostHandlers`-Liste erweitern | Anbindung            |

**Nicht ändern:** bestehende Event-Namen und Payload-Felder (Bestandsschutz); die öffentlichen
Shared-Event-Deklarationen werden **nur additiv** erweitert.

---

## 7. Erforderliche Frontend-Komponenten

**Wiederverwenden (vorhanden):** `showView.ts` (`leaderboardRow`, `podiumPlace`,
`questionDisplayOptions`), `hostView.ts` (`hostScreen`, `hostActions`, `revealBody`,
`attachHostHandlers`), `ui.ts` (`countdown`, `chip`, `button`, `confirmDialog`, `statTile`),
`avatar.ts` (`playerAvatar`), `clockSync.ts` (`ClockSync`), `dom.ts` (`el`, `render`).

**Neu zu bauen (Vorschlag):**

| Komponente                | Zweck                                                        | Szene | Abhängigkeit            |
| ------------------------- | ------------------------------------------------------------ | ----- | ----------------------- |
| Szenen-Controller         | Bildschirmwahl aus `HostState` (erweitertes `hostScreen`)     | alle  | –                       |
| `showWelcome`             | Logo/Titel                                                    | 1     | Hintergrundbild (Block D) |
| `showJoin`                | PIN groß + URL + **Avatar-Wand**                              | 2     | – (QR ausdrücklich aus) |
| `showParticipants`        | Teilnehmer-Raster                                             | 3     | –                       |
| `showStartCountdown`      | 3–2–1–Los! aus `lead`                                         | 4     | `lead`-Event (§5.1)     |
| `showQuestion` (erweitert) | + Kategorie + Position                                       | 5     | `category` (§5.2)       |
| `showOptions`             | Große, nummerierte Antwortfläche                              | 6     | –                       |
| Timer-Ring (vorhanden)    | `countdown()` + Clock-Sync                                    | 7     | –                       |
| `showReveal` (erweitert)  | Lösung + Verteilungsbalken                                    | 8     | –                       |
| `showPoints`              | Punkteanimation je Avatar                                     | 9     | Punktedeltas (§5.3)     |
| `showBoard` (erweitert)   | Rangwechsel animiert                                          | 10    | Rangdeltas (§5.4)       |
| `showFinalRound`          | Finalrunden-Ankündigung                                       | 11    | **Entscheidung** (§5.5) |
| `showPodium` (erweitert)  | Sieger-Podium (3 Plätze, bestehende Reihenfolge)              | 12    | –                       |
| `showOutro`               | Dank/Statistik/Ausblick                                       | 13    | Report-Subset (§5.6)    |
| **Steuerleiste umschaltbar** | Host-Steuerung ein-/ausblenden für den Beamer-Betrieb      | alle  | –                       |

**Wiederverwendung von `podiumPlace`:** Die bestehende Podium-Logik (Platz 1 mittig/höchste, Platz 2
links, Platz 3 rechts) ist bereits in `showView.podiumPlace` + CSS umgesetzt und wird **beibehalten**.

---

## 8. Technische Risiken und Abhängigkeiten

| # | Risiko                                            | Wirkung | Gegenmaßnahme                                                          |
| - | ------------------------------------------------- | ------- | ---------------------------------------------------------------------- |
| R1 | `lead`-Phase berührt Zustandsmaschine + Recovery   | Regression | Gezielte Engine-Tests (Reihenfolge, Reconnect, Recovery), §11          |
| R2 | Doppelte Punkte/Rangdeltas                        | Falsche Show | Deltas **einmal** pro Frage berechnen; idempotent aus DB-Zeilen        |
| R3 | Widersprüchliche Szenen Host ↔ Beamer              | Vertrauensverlust | Ein Szenen-Controller aus **einem** `HostState`; keine Client-Phase    |
| R4 | Performance der Animationen (Beamer)              | Ruckeln | Nur `transform`/`opacity`; `prefers-reduced-motion`; Show-Skala        |
| R5 | `backdrop-filter` teuer auf schwachen Geräten     | Langsam | Glasflächen begrenzen; auf Beamer reduzieren (Konzept §9)              |
| R6 | Fehlende Hintergrund-Assets (Block D)             | Optik unvollständig | Bis dahin vorhandenen Wireframe-Backdrop nutzen; **keine** Platzhalter |
| R7 | Fehlende Charaktere (pixel/bee/dr-obscura/o-bot)  | Avatar-Wand/Podium unvollständig | Vorhandene Ethan/Maya + Badge-Fallback; Rest anfordern |
| R8 | Design-System: Show-Palette vs. bestehende Tokens | Inkonsistenz | Show nutzt vorhandene Tokens; neue Show-Tokens nur mit Freigabe (§12)  |
| R9 | Neue Events umgehen Rate-Limit                    | Missbrauch | Neue Client-Events in `SOCKET_RATE_RULES` prüfen/aufnehmen            |
| R10 | Steuerleiste verdeckt Anzeige                     | Bedienfehler | Umschaltbar, im Beamer-Betrieb zurücktretend                            |
| R11 | Reconnect während `lead`                          | Hängt im Countdown | `HostState.lead` + Recovery-Timer (§5.1)                               |

**Abhängigkeiten (verbindlich):**

- Die **kombinierte Host-/Beamer-Ansicht bleibt** erhalten (kein Show-Token, keine zweite Engine).
- **Clock-Sync** (Phase 6.8.5) wird **wiederverwendet** — keine zweite Uhrensynchronisation.
- **Socket-Rate-Limit** (Phase 6.8.5) bleibt erhalten; neue Events werden geprüft.
- **Host ≠ Spieler** — die bestehende Session-Trennung bleibt.
- **Punktevergabe** bleibt zu 100 % serverseitig; Show-Animationen lösen **nie** Wertung aus.

---

## 9. Asset-Liste mit fehlenden Assets

Quelle: `docs/assets/ASSET-BRIEFING.md` (Blöcke D, F, G) und `docs/assets/CHARACTER-CATALOGUE.md`.

### 9.1 Hintergrundbilder (Block D) — **fehlen vollständig** → **Blocker für die endgültige Optik**

| Asset-ID (Briefing)          | Szene(n) | Format                    | Auflösung (Vorschlag) | Transparenz | Zielpfad                                        |
| ---------------------------- | -------- | ------------------------- | --------------------- | ----------- | ----------------------------------------------- |
| `beamer-welcome-background`  | 1        | WebP/AVIF (PNG Rückfall)  | 2560 × 1440 (16:9)    | nein        | `packages/frontend/public/backgrounds/*.webp`  |
| `beamer-lobby-background`    | 2/3      | WebP/AVIF                 | 2560 × 1440           | nein        | dito                                            |
| `beamer-reveal-background`   | 8/9      | WebP/AVIF                 | 2560 × 1440           | nein        | dito                                            |
| `beamer-board-background`    | 10       | WebP/AVIF                 | 2560 × 1440           | nein        | dito                                            |
| `beamer-final-background`    | 11       | WebP/AVIF                 | 2560 × 1440           | nein        | dito                                            |
| `beamer-podium-background`   | 12       | WebP/AVIF                 | 2560 × 1440           | nein        | dito                                            |
| `beamer-outro-background`    | 13       | WebP/AVIF                 | 2560 × 1440           | nein        | dito                                            |
| `login-background`           | Login    | WebP/AVIF                 | 2560 × 1440           | nein        | dito (nicht 6.9)                                |

Stil (verbindlich, `game-design-concept.md` §10.5): sehr dunkel, Wireframe-Linien, dezente
geometrische Architektur; **keine** gerenderten 3D-Objekte, **keine** grellen Neonflächen. Regel:
Frage/Antworten bleiben **immer** im Vordergrund; zentrale Fläche kontrastarm genug für Text.

### 9.2 Charaktere (Block B) — **teilweise vorhanden**

| Figur        | Status                                                       | Zielpfad                                          |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------- |
| `ethan`      | ✅ Artwork vorhanden (`public/characters/ethan/*.webp`)      | –                                                 |
| `maya`       | ✅ Artwork vorhanden (`public/characters/maya/*.webp`)       | –                                                 |
| `pixel`      | ❌ fehlt (`awaiting_assets`)                                  | `public/characters/pixel/pixel-base.png`          |
| `bee`        | ❌ fehlt                                                      | `public/characters/bee/bee-base.png`              |
| `dr-obscura` | ❌ fehlt (Podium-/Show-Element)                               | `public/characters/dr-obscura/dr-obscura-base.png`|
| `o-bot`      | ❌ fehlt (ggf. mehrere Typen)                                 | `public/characters/o-bot/o-bot-base.png`          |

Anforderung: 1:1, PNG (RGBA, Transparenz zwingend), Vorschlag 1024 × 1024, Blockwelt/Voxel-Stil,
einheitlicher Ankerpunkt. **Keine** erfundenen Figuren.

### 9.3 Audio (Block F/G) — **fehlen vollständig** → **gehört zu Phase 6.11, nicht 6.9**

Nur zur Kenntnis: SFX `game-start`, `countdown-tick`, `countdown-go`, `answer-correct`,
`answer-wrong`, `points-gain`, `rank-change`, `final-round`, `winner`; Musik `music-lobby`,
`music-question`, `music-final`, `music-victory`. Zielpfade `public/audio/sfx/*`,
`public/audio/music/*`. **Keine** ungeklärten geschützten Stücke.

### 9.4 Icons (Block E) — optional für 6.9

Vorhandene UI nutzt Text/Chips; Icons sind nicht zwingend für die Show-Szenen.

### 9.5 Zusammenfassung der Blocker

- **Harte Blocker für die endgültige Optik:** Block D (Beamer-Hintergründe).
- **Weiche Abhängigkeit:** Block B (fehlende Figuren für Wand/Podium).
- **Nicht 6.9:** Block F/G (Audio, → 6.11).
- **Ausdrücklich aus dem Umfang:** QR-Code (keine neue Bibliothek; Szene 2 nutzt PIN + URL).

**Keine Ersatzbilder, keine KI-Hintergründe, keine Stockgrafiken, keine Platzhalter als Endlösung.**
Bis zur Lieferung wird der **vorhandene CSS-Wireframe-Backdrop** genutzt (kostenlos, kein Bild).

---

## 10. Empfohlene Implementierungsreihenfolge

Prinzip: **grundlegende Systeme zuerst**, dann davon abhängige Funktionen; unabhängige Arbeit
(z. B. Szenen ohne neue Serverdaten) läuft **vor** der asset-abhängigen Optik.

**Phase 6.9.1 – Serverzustände & Event-Verträge** (Fundament)
`lead`-Phase (§5.1), `category` in `PublicQuestion` (§5.2), Punktedeltas (§5.3), Rangdeltas (§5.4),
Shared-Contract-Erweiterungen (§6), Recovery. **Alles additiv, mit Tests.**

**Phase 6.9.2 – Szenen-Grundgerüst & Steuerung**
Szenen-Controller, Umschalten Steuer-/Anzeigemodus, Übergänge, Show-Skala-Feinschliff.

**Phase 6.9.3 – Beitritt, Teilnehmerübersicht, Avatar-Wand** (Szenen 1–3)

**Phase 6.9.4 – Frage, Antworten, Countdown** (Szenen 5–7)

**Phase 6.9.5 – Auflösung & Punkteanimationen** (Szenen 8–9)

**Phase 6.9.6 – Rangliste, Finalrunde, Siegerpodium** (Szenen 10–12) — Finalrunde **nur nach
Entscheidung** (§5.5)

**Phase 6.9.7 – Abschluss, Übergänge, vollständige Integration** (Szene 13)

**Danach:** 6.10 Hintergrundbilder einbinden, 6.11 Sound.

**Bewertung der vorgeschlagenen Aufteilung (Auftrag §10):** **sinnvoll und übernommen.** Ergänzung:
Die `lead`-Phase und die Delta-Contracts gehören zwingend in **6.9.1**, weil 6.9.4/6.9.5 davon
abhängen. Die Finalrunde (Szene 11) ist in 6.9.6 **nur** als Anzeige-only umsetzbar, solange keine
Produktentscheidung vorliegt.

---

## 11. Teststrategie

### 11.1 Backend (Unit/Integration, Vitest, echte PostgreSQL)

- **`lead`-Phase:** `start` → `lead` → nach Ablauf `question`; Reconnect in `lead` stellt Countdown
  wieder her; Recovery nach „Neustart" armen den `lead`-Timer neu.
  *Bestandsschutz:* `engine.integration.test.ts` erwartet heute `['question','reveal','board']` als
  Reihenfolge nach `start` (`engine.integration.test.ts:116–141`) — dieser Test muss die neue
  `lead`-Stufe berücksichtigen (Testanpassung, kein Vertragsbruch).
- **Punktedeltas:** genau ein Delta je Spieler und Frage; Summe der Deltas == Score-Differenz;
  doppelte `reveal`-Aufrufe erzeugen **keine** doppelten Deltas (Idempotenz).
- **Rangdeltas:** `previousRank` korrekt bei Gleichstand (Tie-Break `correctCount/totalTime/joinedAt`).
- **`category`:** wird in `PublicQuestion` durchgereicht und fehlt nie fälschlich (Lösung bleibt
  verborgen).
- **Rate-Limit:** neue Client-Events (falls vorhanden) sind abgedeckt bzw. bewusst ausgenommen.

### 11.2 Frontend (Vitest + jsdom, rein/testbar)

- `hostScreen` bildet `lead` korrekt ab; `hostActions` erlaubt die richtigen Controls je Phase.
- `showView`-Builder (Avatar-Wand, Podium) erzeugen erwartete Knoten; Podium-Reihenfolge 1/2/3.
- Keine Client-seitige Punkte-/Rangberechnung (nur Darstellung von Serverdaten).
- `attachHostHandlers` bleibt idempotent (keine doppelten Listener) inkl. neuer Events.
- **Design-System-Contract** (`design-system.test.ts`): neue Klassen sind definiert; bestehende
  Tokens unverändert (Bestandsschutz).

### 11.3 Manuell / visuell (durch chrisB)

- Show-Prüfung bei **1280×720, 1920×1080, 2560×1440 und 4:3 (1024×768)**.
- Alle 13 Szenen in korrekter Reihenfolge; Frage/Antworten immer im Vordergrund.
- Keine Doppel-Effekte; Steuerleiste ein-/ausblendbar; Host kann durchgehend steuern.
- `prefers-reduced-motion` schaltet Animationen ab.

### 11.4 Regressionsschutz (CI-Gate)

- Build, Typecheck, Unit-, Integrations- und Frontend-Tests, `prettier --check .` (wie in CI).
- **Lasttest** `tools/loadtest.mjs` nach Realtime-Änderungen erneut fahren (Roadmap §Teststrategie).

---

## 12. Aufteilung in kleinere Implementierungsschritte

Siehe §10. **Jeder Schritt = eigener Branch, eigener PR, eigener Bestandsschutz-Nachweis.** Kein
Schritt beginnt ohne Freigabe; abhängige Schritte warten auf Merge/Entscheidung (Auftrag §52).

---

## Was kann sofort implementiert werden?

- Szenen **1, 2, 3** (Welcome, Beitritt, Teilnehmerübersicht) — reine Anzeige vorhandener Daten.
- Szenen **5, 6, 7, 8** (Frage, Antworten, Countdown, Auflösung) — vorhandene Daten; **5** braucht nur
  das additive `category`-Feld.
- Szenen **12, 13** (Podium, Abschluss) — Podium vorhanden; Abschluss aus vorhandenem Report.
- **Steuer-/Anzeige-Trennung**, Übergänge, Show-Skala-Feinschliff, `prefers-reduced-motion`.

## Was benötigt zuerst eine technische Erweiterung?

- **Szene 4 (Start-Countdown)** → echte `lead`-Phase + Events + Recovery.
- **Szene 9 (Punktevergabe)** → serverseitige Punktedeltas.
- **Szene 10 (Rangverschiebung)** → serverseitige Rangdeltas.
- **Szene 5 (Kategorie)** → additives `category`-Feld in `PublicQuestion`.

## Was benötigt externe Assets?

- **Endgültige Hintergrund-Optik** aller Szenen → Block D (`beamer-*-background`).
- **Avatar-Wand/Podium vollständig** → Block B (pixel, bee, dr-obscura, o-bot).
- (Später) Sound → Block F/G (6.11).

## Was benötigt eine Entscheidung des Eigentümers (chrisB)?

1. **Finalrunde (Szene 11):** Anzeige-only (a) oder eigener Motorzustand (b)? (§5.5)
2. **Punkte-/Rangdeltas:** neues Event (`host:points`, `host:ranks`) **oder** Erweiterung von
   `host:reveal`/`host:board`? (§6)
3. **Show-Farbpalette:** Der Auftrag §6 nennt **Cyan/Türkis als Primär** und **Violett als Sekundär**;
   die bestehenden Tokens führen **Violett primär** (`--accent #7c5cff`) und **Cyan sekundär**
   (`--accent-2 #22d3ee`). Wird die Show auf **vorhandenen Tokens** aufgebaut (empfohlen, kein
   Design-System-Bruch) oder werden **neue Show-Tokens** eingeführt? (§8 R8)
4. **Abschluss-Statistik (Szene 13):** Socket-Subset **oder** HTTP-Report laden? (§5.6)
5. **Start-Countdown-Länge** (z. B. 3 s) und ob der Host ihn **überspringen** darf.
6. **QR-Code:** bestätigt außerhalb des Umfangs (Auftrag §5.2) — nur zur Protokollierung.

---

## Anhang – Verifizierte Referenzen (Datei:Zeile)

- Phasenliste: `packages/shared/src/constants.ts:113`
- Engine-Zustände/-Events: `packages/backend/src/services/engine.ts:98–107`, `251–274`,
  `603–644`, `651–666`, `889–939`
- Socket-Fan-out/Befehle: `packages/backend/src/socket.ts:249–295`, `278–347`
- Host-Contracts: `packages/shared/src/events.ts:30–49`, `113–137`, `255–289`
- Host-Screens: `packages/frontend/src/pages/host.ts:387–411`, `689–947`
- Show-Bausteine: `packages/frontend/src/showView.ts`, `packages/frontend/src/hostView.ts:75–141`,
  `284–302`
- Show-Styling/Skala: `packages/frontend/src/styles/tokens.css:134–155`, `1693–1965`
- Assets: `docs/assets/ASSET-BRIEFING.md` (Blöcke B/D/F/G), `docs/assets/CHARACTER-CATALOGUE.md`
- Roadmap 6.9: `docs/roadmap/technical-roadmap.md:518–538`
- Konzept: `docs/concept/game-design-concept.md:688–718`, `805–880`
- Design-Konzept: `docs/concept/design-concept.md:100–133`, `493–506`, `549–561`

---

**Ende der Analyse. Es wurde kein Anwendungscode verändert. Freigabe durch chrisB abwarten.**
