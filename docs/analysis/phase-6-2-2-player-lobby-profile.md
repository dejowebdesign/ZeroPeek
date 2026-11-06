# Phase 6.2.2 – Spieler-Lobby und Profilbereich (Analyse)

**Projekt:** ZeroPeek
**Phase:** 6.2.2 – Spieler-Lobby und Profilbereich
**Datum:** 2026-11-06
**Grundlage:** `main` @ `030c771` (Merge PR #21, Phase 6.2.1), kein flacher Clone
(`git rev-parse --is-shallow-repository` → `false`), Arbeitsbaum sauber
**Status:** Analyse abgeschlossen – **keine Umsetzung freigegeben**, wartet auf Entscheidung von chrisB

> **Abstract (EN):** This is a verified, text-only analysis of the player surface as it exists on
> `main` after Phase 6.2.1, written to scope Phase 6.2.2 ("player lobby and profile area"). Every
> statement was checked against the actual source. No application code, database schema, dependency
> or deployment configuration was changed. The headline finding: the **lobby exists but is minimal**,
> and a **profile area does not exist at all** — there is no profile model, no profile API and no
> profile page, and the concept places that work in Phase 6.6.

**Sprachregelung:** Deutsch (Zielgruppe: Projektverantwortlicher). Technische Bezeichner, Dateipfade,
API- und Event-Namen bleiben in der Originalsprache Englisch.

---

## 0. Verifikationsbasis

Alle Angaben wurden in dieser Umgebung am tatsächlichen Quellcode geprüft, nicht übernommen.

| Prüfung                   | Kommando / Ort                                       | Ergebnis                            |
| ------------------------- | ---------------------------------------------------- | ----------------------------------- |
| Branch / HEAD             | `git rev-parse HEAD`                                 | `030c771` (`main`, = `origin/main`) |
| Arbeitsbaum               | `git status`                                         | sauber, keine untracked Änderungen  |
| Historientiefe            | `git rev-parse --is-shallow-repository`              | `false`                             |
| Spieleroberfläche         | `packages/frontend/src/pages/player.ts` (353 Zeilen) | gelesen                             |
| Shell / Navigation        | `packages/frontend/src/navigation.ts` (254 Zeilen)   | gelesen                             |
| Realtime-Vertrag          | `packages/shared/src/events.ts` (109 Zeilen)         | gelesen                             |
| Server-Realtime           | `packages/backend/src/socket.ts`                     | gelesen                             |
| Motor                     | `packages/backend/src/services/engine.ts`            | gelesen                             |
| Datenmodell               | `packages/backend/prisma/schema.prisma`              | gelesen                             |
| Design-Tokens             | `packages/frontend/src/styles/tokens.css`            | geprüft                             |
| Frontend-Tests (Baseline) | `npm test --workspace @zeropeek/frontend`            | **210 grün** (7 Dateien)            |

**Wichtiger Hinweis zur Auftragsgrundlage:** Ein eigenständiges Briefing-Dokument für **Phase 6.2.2**
ist im Repository **nicht vorhanden** (`grep -rn "6.2.2" docs/` → nur ein beiläufiger Verweis in
`.openhands/memory/2026-11-06.md`). Der inhaltliche Umfang dieser Analyse stützt sich daher auf:

- den Projektauftrag (Master-Spezifikation, §35/§36–39 Navigation und Responsive Design),
- die bereits beschlossenen Konzeptdokumente (`docs/concept/design-concept.md` §8.7/§8.8,
  `docs/concept/game-design-concept.md` §4),
- die technische Roadmap (`docs/roadmap/technical-roadmap.md` §3/§4/§7),
- den Bestandscode.

Sollte chrisB für 6.2.2 ein konkretes Briefing haben, ist dieses Dokument damit abzugleichen.

> **Nachtrag (2026-11-06) – verbindlicher Umfang:** Der Umfang von Phase 6.2.2 wurde nach dieser
> Analyse festgelegt und ist jetzt in `docs/roadmap/technical-roadmap.md` **§3.1** verbindlich
> dokumentiert (zusätzlich zusammengefasst in `docs/design/design-system.md` §8.2). Er entspricht
> **Option A** (§8): Lobby-Feinschliff **plus** ein klar gekennzeichneter Profil-Platzhalter, ohne
> Modell/API/Migration. Die drei erlaubten verhaltensneutralen Korrekturen sind **B-2, B-3, B-4**;
> **B-5, B-6 und B-7/R-5 bleiben ausdrücklich unberührt**. Diese Datei ist damit die Analyse
> **zur** verbindlich abgegrenzten Phase und wird in Teil A als Dokument eingecheckt.

---

## 1. Auftragsabgrenzung

Der Arbeitstitel lautet **„Spieler-Lobby und Profilbereich"**. Beide Begriffe sind im Bestand sehr
unterschiedlich weit gediehen:

| Teilbegriff       | Bestand heute                                    | Einordnung nach Roadmap                     |
| ----------------- | ------------------------------------------------ | ------------------------------------------- |
| **Spieler-Lobby** | vorhanden, aber minimal (Beitritt + Wartezimmer) | Teil von Phase 6.2 (Layout/Feinschliff)     |
| **Profilbereich** | **nicht vorhanden**                              | Phase **6.6** (Spielerprofile), braucht 6.3 |

Daraus folgt der zentrale Befund dieser Analyse: **Ein „Profilbereich" kann in 6.2.2 nicht als
echter, datengetriebener Bereich umgesetzt werden**, weil sämtliche Voraussetzungen fehlen (siehe
§2.4 und §7). Möglich ist in 6.2.2 entweder

- **(A)** der Feinschliff der bestehenden Lobby **plus** eine Profil-**Platzhalterfläche** (klar als
  „kommt später" markiert, ohne erfundene Daten), oder
- **(B)** nur der Lobby-Feinschliff, während Profil vollständig in 6.6 bleibt, oder
- **(C)** ein Vorziehen von Teilen des Profil-Datenmodells/der API (widerspricht der
  Roadmap-Reihenfolge und den Abhängigkeiten 6.3/6.6 – nur mit ausdrücklicher Freigabe).

Diese drei Optionen sind in §8 gegenübergestellt; die Entscheidung liegt bei chrisB.

---

## 2. Bestand: Spieleroberfläche heute

### 2.1 Entry point und Shell

- Eigener HTML-Einstieg: `packages/frontend/src/index.html` → `<main id="app">` →
  `pages/player.ts`. Vite-Multi-Page-Build (`packages/frontend/vite.config.ts`), Einträge
  `index`/`host`/`editor`/`admin`. Die URL `/` bleibt gültig.
- `index.html` ist die **einzige** Seite mit `aria-live="polite"` auf `<main>` – die Spieleransicht
  ist damit die einzige, die Screenreader über Zustandswechsel informiert. Bei einem Profilbereich
  ist dieselbe Eigenschaft mitzudenken.
- Seit Phase 6.2.1 ist die Spieleroberfläche in die Shell eingebettet. `player.ts` hat einen lokalen
  Wrapper `shell(active, content)` (Zeile 21–23), der `appShell({ role: 'player', active, children })`
  aufruft. **Alle** Renderpfade laufen darüber (`grep -c "shell("` → 8 Aufrufe, inkl.
  Reconnect-Screen).
- Die Shell liefert Brand-Bar, Navigationsregion und **genau eine** `<h1>`. Die Spielerseite nutzt
  `appShell` **ohne** `title`-Option, d. h. die `<h1>` kommt jeweils aus dem Screen selbst
  (`join__title`).

### 2.2 Die sechs Screens (`player.ts`)

| #   | Funktion       | Zeile | Aktives Nav-Element | Zweck                                  |
| --- | -------------- | ----- | ------------------- | -------------------------------------- |
| 1   | `showJoin`     | 57    | `lobby`             | PIN + Nickname, Beitritt               |
| 2   | `showWaiting`  | 124   | `lobby`             | Wartezimmer bis Host startet           |
| 3   | `showQuestion` | 152   | `questions`         | offene Frage, Antwortabgabe            |
| 4   | `showResult`   | 193   | `questions`         | eigenes Ergebnis nach Auflösung        |
| 5   | `showBoard`    | 242   | `questions`         | Rangliste                              |
| 6   | `showEnd`      | 280   | `lobby`             | Endplatzierung + Podium + „Play again" |

Behandelte Server-Events (Zeile 326–332): `game:state` (nur Phase `lobby` → `showWaiting`),
`game:question`, `game:reveal`, `game:board`, `game:ended`.

Wichtige Eigenschaften des Bestands:

- **Serverseitig autoritativ.** Der Spieler erhält nur die eigene private Auflösung (`OwnResult`),
  nie die Lösung oder fremde Antworten. Das bleibt unangetastet.
- **Reconnect vorhanden.** Die Sitzung (gameId, playerId, token, nickname) liegt in
  `sessionStorage` (`zeropeek.player`); beim Laden wird `player:rejoin` versucht. Der `token` wird
  für das Rejoin gebraucht.
- **Ein Antwortvorgang.** `showQuestion` setzt lokal `submitted`, um Doppelklick zu verhindern; der
  Server erzwingt die Einmaligkeit zusätzlich.
- **Keine Avatar-Darstellung.** `grep -rn "avatar" packages/frontend/src --include=*.ts` (ohne Tests,
  ohne `navigation.ts`) liefert **nichts**. Der Server führt zwar ein `avatar`-Feld
  (`PublicPlayer.avatar`), die Spieleroberfläche sendet und rendert es aber nicht.

### 2.3 Lobby im Detail

**`showJoin` (Zeile 57–121):**

- Zwei Eingabefelder: `input` mit `inputmode="numeric"`, `maxlength=6`, Platzhalter `000000`
  (PIN) und `maxlength=16` (Nickname). Der Nickname wird **nicht** clientseitig validiert; die
  Länge (1–16) prüft der Server (`NICKNAME_MAX = 16`).
- Karte `.card.join` → Breite `min(440px, 100%)` (`.join` in `tokens.css` Zeile 665). Innerhalb der
  Shell wird sie zusätzlich auf `--player-measure` begrenzt.
- Ein Feedback-Container `div.join__feedback` (Zeile 71) – **diese Klasse hat keine CSS-Regel**
  (`grep -n "join__feedback" tokens.css` → nichts). Funktional, aber ungestylt (siehe §6, B-3).
- **Kein Avatar-Vorschau-Element**, obwohl `design-concept.md` §8.7 „Avatar-Vorschau" im Beitritt
  nennt. Das ist eine bewusste Lücke bis 6.7 (Charakter-Assets fehlen).

**`showWaiting` (Zeile 124–149):**

- Zeigt Begrüßung mit Nickname, Hinweis „Look at the big screen", und **nur** einen Chip mit der
  Spielerzahl (`chip(\`${players.length} player(s) joined\`, 'cyan')`) bzw. einen Spinner.
- **Nicht** vorhanden: Liste der Mitspieler mit Namen, Avatar-Wand, Anzeige der eigenen PIN,
  Fortschritts-/Warte-Feedback, Kapazitätsanzeige. Das Konzept (§8.7, §10.2 Szene 2/3) sieht
  Avatar-Wand und Teilnehmerübersicht vor – das ist aber Beamer/Show (6.9) bzw. Avatar (6.7).
- Der Screen wird bei jedem `game:state` mit `phase === 'lobby'` neu gerendert – d. h. bei jedem
  Beitritt wird der Screen komplett ersetzt (kein sanftes Update). Für eine „wachsende" Liste wäre
  ein inkrementelles Update nötig.

**Nicht in der Spieler-Lobby vorhanden (heute):**

- PIN wird dem Spieler **nicht** erneut angezeigt (er kennt ihn aus der Eingabe).
- Kein QR-Code (Konzept §10.5 verbindlich „Spielcode und QR-Code in der Lobby" – laut Roadmap 6.9).
- Keine Kapazitätsgrenze/Zielanzeige (Lasttestziel 25+Host, `tools/loadtest.mjs`).
- Keine Teilnehmermoderation (nur der Host kann `host:kick`).

### 2.4 Profilbereich: **existiert nicht**

Das ist der wichtigste Befund. Geprüft und bestätigt:

| Erwarteter Baustein                | Prüfung                                                               | Ergebnis                       |
| ---------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| Profil-Datenmodell `PlayerProfile` | `grep -c "PlayerProfile" schema.prisma`                               | **0**                          |
| Profil-API `/api/profile`          | `grep -rn "api/profile" packages/backend/src`                         | **nichts**                     |
| Profil-Seite `pages/profile.ts`    | `ls packages/frontend/src/pages`                                      | nur `host/editor/admin/player` |
| Rolle `PLAYER`                     | `enum UserRole` in `schema.prisma`                                    | nur `ADMIN`, `TRAINER`         |
| XP / Level / Statistik im Client   | `grep -rni "xp\|level\|achievement" packages/frontend/src` (ohne Nav) | **nichts**                     |
| Verknüpfung `GamePlayer.userId`    | `model GamePlayer`                                                    | **nicht vorhanden**            |
| Avatarkonfiguration                | `GamePlayer.avatar` = freier `String @default("")`                    | kein Modell/keine Validierung  |

Der Nav-Eintrag `profile` (`PLAYER_NAV`, `navigation.ts` Zeile 56) ist ein **„soon"-Platzhalter**
(`span.nav__item--soon`, `aria-disabled`), kein Link. Ebenso `inventory` und `settings`.

Der `avatar`-Wert ist heute ein **ungeprüfter freier String**: Der Server nimmt ihn in
`player:join` entgegen (`socket.ts` Zeile 222: `typeof payload?.avatar === 'string' ? … : ''`),
speichert ihn (`gamePlayer.avatar`) und gibt ihn als `PublicPlayer.avatar` zurück – die
Spieleroberfläche sendet ihn aber nie und zeigt ihn nie. Das ist konsistent mit dem Konzept, das den
Avatar erst mit den Original-Assets (6.7) vorsieht.

---

## 3. Rollen und Berechtigungen

- Rollen heute: **`ADMIN`, `TRAINER`** (`enum UserRole`). **Keine `PLAYER`-Rolle.**
- „HOST"/„SPIELER"/„BEAMER" sind **Fähigkeiten**, keine Datenbankrollen:
  - **Host** = authentifiziert (`TRAINER`/`ADMIN`) auf `/host` (Socket-Namespace `/host`).
  - **Spieler** = **anonym**, Beitritt per PIN über Socket-Namespace `/`.
  - **Beamer** = die `.show`-Oberfläche innerhalb von `host.html` (kombinierte Ansicht,
    verbindlich, `game-design-concept.md` §10.1).
- Der Spieler hat **kein Konto** und **keine** Session; Identität = `GamePlayer`-Zeile + `token`.
- **Konsequenz für 6.2.2:** Ein „Profilbereich" setzt ein Konto voraus. Ohne die Rolle `PLAYER`
  (Phase 6.3) und das Profilmodell (Phase 6.6) gibt es keinen Nutzer, dem ein Profil gehören könnte.
- Anzeige ≠ Prüfung: Die Navigation ist reine Anzeige; jede Route/jedes Event autorisiert weiterhin
  serverseitig (Konzept §8.1, Briefing §5).

---

## 4. Realtime-Vertrag

### 4.1 Vorhanden (Spieler, Namespace `/`)

| Client → Server | Ack-Nutzlast (Server)         | Genutzt im Client |
| --------------- | ----------------------------- | ----------------- |
| `player:join`   | `{ playerId, gameId, token }` | ja                |
| `player:rejoin` | `{ ok: true }`                | ja                |
| `player:answer` | `{ accepted: boolean }`       | ja                |

| Server → Client | Nutzlast                                 | Genutzt im Client |
| --------------- | ---------------------------------------- | ----------------- |
| `game:state`    | `{ phase, players }` (nur Phase `lobby`) | ja                |
| `game:question` | `PublicQuestion`                         | ja                |
| `game:reveal`   | `{ questionId, result: OwnResult }`      | ja                |
| `game:board`    | `{ players }`                            | ja                |
| `game:ended`    | `{ rank, score, podium }`                | ja                |

### 4.2 Lücken im Vertrag (verifiziert)

- **`player:join`-Ack-Typ ist unvollständig.** Der Server antwortet mit
  `{ playerId, gameId, token }` (`socket.ts` Zeile 235), der geteilte Typ deklariert aber nur
  `Ack<{ playerId: string; gameId: string }>` (`events.ts` Zeile 66). Der Client umgeht das mit
  einem lokalen Typ `request<{ playerId; gameId; token }>` (`player.ts` Zeile 78). Kein Laufzeitfehler,
  aber **Contract-Drift**: Der geteilte Typ ist die einzige Quelle der Wahrheit und sollte korrigiert
  werden (klein, additiv, ohne Verhaltensänderung).
- **Deklarierte, aber nie gesendete Events:** `game:joined`, `game:error`, `host:error` existieren in
  `events.ts`, werden aber **vom Server nie emittiert** (`grep` über `socket.ts`/`engine.ts` → nichts)
  und im Client **nie behandelt**. Toter Vertragsraum.
- **Keine Lobby-spezifischen Ereignisse** für „Spieler beigetreten/verlassen" – die Lobby wird nur
  über das komplette `game:state` neu gezeichnet.
- **Kein Pause/Fortsetzen/Überspringen** (`host:*` kennt nur create/join/start/next/reveal/board/end/kick).

### 4.3 Bekannte, dokumentierte Lücke

- **R-5 (Reconnect mitten in der Frage):** `player:rejoin` liefert **keine** aktuelle Frage zurück.
  Nach einem Reload während der Frage sieht der Spieler die Frage nicht wieder
  (`game-design-concept.md` §8.4). Betrifft die Spieler-Lobby nur am Rand, ist aber für den
  Spielerfluss relevant.

---

## 5. Verfügbare Designsystem-Bausteine (für eine Lobby/Profil-Gestaltung)

Bereits vorhanden und wiederverwendbar (`ui.ts`):

`brand`, `pageHeader` (**ungenutzt** seit 6.2.1), `field`, `button` (+ `setBusy`), `chip`,
`progress`, `statTile`, `dialog`/`confirmDialog`, `skeleton`, `countdown`, `emptyState`, `notice`,
`errorText`, `toast`, `spinner`, `screen`, `escapeCsv`.

Relevante Tokens (`tokens.css`):

- Glas-Tiers: `--glass-card`, `--glass-raised`, `--glass-dialog`, `--glass-nav`, `--glass-input`,
  `--glass-overlay` (+ passende `--blur-*`).
- Marken-/Seltenheitsfarben: `--brand-cyan`, `--brand-violet`, `--brand-magenta`, `--brand-indigo`,
  `--rarity-rare/-epic/-legendary/-exclusive`.
- Typo-Rollen: `--type-page/-section/-card/-body/-label/-help/-number/-score/-countdown`.
- Layout: `--player-measure` (100 %/90 %/78 %/1000 px), `--player-gutter`, `--content-max`.
- **Kein** Avatar-/Inventar-/Erfolgs-Widget vorhanden (kommt mit 6.7/6.8).

Die Shell begrenzt bereits jeden Spieler-Screen über `.shell--player .centered > *` auf
`--player-measure`; die Karte `.card.join` liegt zusätzlich bei `min(440px, 100%)`. Eine
Profil-Platzhalterfläche würde automatisch dieselbe Breite/zentrale Linie erben.

---

## 6. Befunde (Abweichungen, Risiken) mit Schweregrad

| ID   | Befund                                                                                                    | Schwere | Beleg                                      |
| ---- | --------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------ |
| B-1  | **Profilbereich fehlt vollständig** (kein Modell, keine API, keine Seite).                                | hoch    | §2.4                                       |
| B-2  | `player:join`-Ack-Typ im geteilten Vertrag unvollständig (`token` fehlt).                                 | niedrig | `events.ts:66` vs. `socket.ts:235`         |
| B-3  | `.join__feedback` wird genutzt, hat aber keine CSS-Regel.                                                 | niedrig | `player.ts:71`, `grep tokens.css` → nichts |
| B-4  | `.card.question` (nackte Klasse `.question`) hat keine eigene Regel; Breite kommt allein von der Shell.   | niedrig | `grep "^\.question {" tokens.css` → nichts |
| B-5  | `pageHeader` ist exportiert, aber von **keiner** Seite mehr genutzt (Shell übernahm `<h1>`).              | niedrig | `grep -rn pageHeader pages/` → nur `ui.ts` |
| B-6  | Deklarierte Events `game:joined`, `game:error`, `host:error` werden nie gesendet/behandelt.               | niedrig | §4.2                                       |
| B-7  | Wartezimmer ersetzt bei jedem Beitritt den ganzen Screen (kein inkrementelles Update, keine Namensliste). | mittel  | `player.ts:124–149`, `game:state`-Handler  |
| B-8  | Reconnect mitten in der Frage verliert die Frage (R-5).                                                   | mittel  | `game-design-concept.md` §8.4              |
| B-9  | `avatar` ist ein ungeprüfter freier String, wird vom Client nie gesendet/gerendert.                       | niedrig | `schema.prisma:130`, `socket.ts:222`       |
| B-10 | Keine Kapazitäts-/Zielanzeige und keine Lobby-Moderation in der Spieleransicht.                           | niedrig | §2.3                                       |

Alle Befunde sind **beobachtet**, nicht vermutet. B-2/B-3/B-4/B-5/B-6 sind kleine, risikoarme
Aufräumarbeiten, die man in 6.2.2 mitnehmen **könnte** – sie ändern kein Verhalten.

---

## 7. Abhängigkeiten und Reihenfolge-Konflikt

```
6.2.1 (fertig) ──► 6.2.2 Lobby (+ evtl. Profil-Platzhalter)
                        │
                        ├─ Rolle PLAYER + Registrierung ── 6.3  (nötig für ein echtes Profil)
                        │
                        └─ PlayerProfile-Modell + /api/profile ── 6.6  (Profilbereich)
                                                                    │
                                            Charakter-Assets ── 6.7 (Avatar im Profil)
                                            XP/Level/Inventar ── 6.8 (Profilwerte)
```

**Konflikt:** Der Arbeitstitel stellt „Profilbereich" neben die Lobby in 6.2.2, die Roadmap legt
Profile aber in **6.6** und macht sie von **6.3** (Konto/Rolle `PLAYER`) abhängig. Ein datengetriebener
Profilbereich in 6.2.2 würde die Reihenfolge umkehren und die verbindlichen Entscheidungen aus Phase 5c
(Registrierung freiwillig, XP serverseitig, Trennung Statistik/Historie) vorwegnehmen. **Das darf
nicht eigenmächtig geschehen.**

Ein **echtes** Profil ist zudem **blockiert** durch fehlende Charakter-Assets (Block B der
`ASSET-BRIEFING.md`, „diese Dateien fehlen vollständig") – die zentrale Profildarstellung ist das
große Charakterbild (`design-concept.md` §8.8).

---

## 8. Scope-Optionen für 6.2.2 – **entschieden: Option A**

> **Entscheidung (2026-11-06):** Umgesetzt wird **Option A** (verbindlich in
> `docs/roadmap/technical-roadmap.md` §3.1). Die Optionen B und C sind hier als Begründung erhalten.

### Option A – Lobby-Feinschliff **+ Profil-Platzhalterfläche** (empfohlen)

- Lobby: Wartezimmer inkrementell aktualisieren, Namensliste statt nur Zahl, PIN-/URL-Anzeige
  (ohne QR – der ist 6.9), Zustände „verbunden/getrennt/warten/Fehler" sichtbar, `join__feedback`
  stylen.
- Profil: eine **klar als „kommt mit 6.6" markierte Platzhalterfläche** (via `emptyState`), die den
  Nav-Eintrag `profile` erstmals mit einer echten Seite verbindet – **ohne** erfundene XP/Level-Daten.
- Kein Datenmodell, keine API, keine Migration.
- **Nutzen:** sichtbarer Fortschritt, keine Vorwegnahme von Produktentscheiden, keine Blockade.

### Option B – Nur Lobby-Feinschliff

- Wie Option A ohne die Profilfläche; `profile` bleibt „soon".
- Kleinstes Risiko, aber der „Profilbereich" im Titel bleibt unberührt.

### Option C – Teile des Profils vorziehen (nur mit Freigabe)

- Rolle `PLAYER` (6.3) und `PlayerProfile`/`/api/profile` (6.6) vorziehen.
- **Widerspricht** der Roadmap-Reihenfolge; berührt Enum-Migration, Auth-Erweiterung und
  serverseitige XP-Regeln. Nur auf ausdrückliche Anweisung, mit eigenem Migrations- und
  Sicherheitskonzept.

**Empfehlung:** Option A. Sie liefert den im Titel genannten „Profilbereich" als ehrliche,
gestaltete Platzhalterfläche und hält die verbindliche Reihenfolge ein.

---

## 9. Risiken

| Risiko                                              | Bewertung | Gegenmaßnahme                                                    |
| --------------------------------------------------- | --------- | ---------------------------------------------------------------- |
| Vorwegnahme von 6.3/6.6-Entscheidungen              | mittel    | Option A/B: keine Modell-/API-/Migrationsänderung                |
| Erfundene Profildaten (XP/Level) im Client          | mittel    | Platzhalter ohne Zahlen; echte Werte erst serverseitig (6.6/6.8) |
| Bestandsschutz Lobby/Spielerfluss                   | niedrig   | nur Darstellung ändern; `player:join/rejoin/answer` unangetastet |
| Vertrags-Drift (`player:join`-Ack)                  | niedrig   | Typ in `events.ts` ergänzen (additiv, verhaltensneutral)         |
| Avatar-Versprechen ohne Assets                      | mittel    | Avatar-Anzeige erst 6.7; kein Ersatzbild (Briefing §31)          |
| Doppelte/inkonsistente Navigation (Anzeige ≠ Recht) | niedrig   | Navigation bleibt reine Anzeige; Server prüft weiter             |

---

## 10. Teststrategie und Abnahmekriterien (Vorschlag, nur falls umgesetzt)

- **Unit:** neue reine Builder für Lobby-/Profil-Platzhalter (analog `showView.ts`) testbar halten;
  `player.ts` bootet einen Socket beim Import, daher Logik in testbare Helfer auslagern.
- **Design-System:** neue Klassen in `design-system.test.ts` aufnehmen; Tokens/Breakpoints prüfen.
- **Navigation:** `navigation.test.ts` erweitern, falls `profile` verfügbar wird (aktiver Zustand,
  „soon" entfällt).
- **Regression:** bestehende Spielerstrecke (Join → Frage → Reveal → Board → Ende) unverändert;
  `player:rejoin` unverändert.
- **Responsive (textbasiert):** Geometrie-Prüfung wie in 6.2.1 (headless Chromium gegen die echte
  `tokens.css`) bei 390/768/1024/1280/1920 – kein horizontaler Scroll, zentrale Linie gehalten.
- **Gates:** `typecheck`, `format:check`, `build`, Tests (Baseline frontend **210**, gesamt **374**
  mit DB).

Abnahmekriterien (Option A): Bestehende Spielerstrecke und Bestandsschutz unverändert; Lobby zeigt
Mitspieler und Zustände verständlich; Profilfläche ist als „später" erkennbar und zeigt **keine**
erfundenen Werte; keine Modell-/API-/Migrationsänderung; alle Gates grün.

---

## 11. Offene Fragen an chrisB – **entschieden (2026-11-06)**

Die Fragen wurden durch die Auftragsvorgabe für Phase 6.2.2 entschieden und in
`docs/roadmap/technical-roadmap.md` §3.1 verbindlich festgehalten:

1. **Scope:** **Option A** – Lobby-Feinschliff **plus** klar gekennzeichneter Profil-Platzhalter.
2. **Profil-Platzhalter:** **ja** – sichtbarer Hinweis **„Dein Spielerprofil kommt mit Phase 6.6."**,
   mit der bestehenden `emptyState`-Komponente, sofern passend. Keine erfundenen Werte.
3. **Lobby-Inhalt:** Mitspielernamen und vorhandene Verbindungszustände anzeigen; nur Daten, die der
   Server bereits liefert. **Keine** eigenmächtige Socket.IO-Erweiterung.
4. **Kleine Aufräumarbeiten:** **nur B-2, B-3, B-4** (verhaltensneutral). **B-5, B-6 bleiben außen
   vor**; **B-7/R-5** wird für eine spätere Bearbeitung vorgemerkt, das Reconnect-Verhalten bleibt
   unverändert.
5. **Reconnect-Lücke R-5:** **nicht** in 6.2.2 (vorgemerkt).
6. **Registrierungsangebot in der Lobby:** gehört zu 6.3; in 6.2.2 **nicht** vorwegnehmen.

---

## 12. Bestandsschutz (verbindlich, unabhängig von der Entscheidung)

- Keine Änderung an Quizfragen, Antworten, Konten, Rollen oder Berechtigungen.
- Keine Änderung an `player:join` / `player:rejoin` / `player:answer` im Verhalten; keine
  Änderung an `PublicQuestion`/`OwnResult`-Nutzlasten.
- Keine Datenbankmigration, keine neue Abhängigkeit, keine Portainer-/Deployment-Änderung.
- Keine eigenständigen Bilder/Ersatzgrafiken (Briefing §31) und keine erfundenen Profilwerte.
- Navigation bleibt reine Anzeige; serverseitige Autorisierung bleibt unangetastet.
- Arbeit ausschließlich auf einem eigenen Branch, PR erst nach Freigabe; Merge durch chrisB.

---

## 13. Nächster Schritt

**Scope verbindlich abgegrenzt.** Diese Analyse enthält selbst **keine** Umsetzung. Der Umfang von
Phase 6.2.2 ist in `docs/roadmap/technical-roadmap.md` §3.1 festgehalten und in
`docs/design/design-system.md` §8.2 zusammengefasst; die Analyse ist in Teil A eingecheckt.

Die Umsetzung erfolgt – nach ausdrücklicher Freigabe – auf einem eigenen Branch
(`feat/phase-6-2-2-player-lobby-profile`) streng innerhalb der in §3.1 dokumentierten Grenzen. Bis
dahin wird **kein** Anwendungscode, **kein** Datenmodell und **keine** Konfiguration geändert.

---

## 14. Umsetzungsstand (Teil B, Option A)

Branch `feat/phase-6-2-2-player-lobby-profile`. Umgesetzt wurde **Option A** aus §8: das Wartezimmer
aufgewertet und der Profilbereich als **klar gekennzeichneter Platzhalter**. Alle drei Punkte halten
sich an §3.1 und §12; es gibt **keine** Server-, Datenmodell- oder Vertragsänderung.

**Wartezimmer (`pages/player.ts`, `playerView.ts`):** Die Liste der Mitspieler wird jetzt aus den
`PublicPlayer`-Daten gerendert, die der Server bereits über `game:state` sendet (Name + Verbindungs-
zustand als beschrifteter Chip, eigener Eintrag markiert). Der Zustand wird als Chip/Spinner
angezeigt; der Screen ersetzt sich weiterhin pro `game:state` (kein inkrementelles Update, B-7
bleibt außen vor).

**Profil-Platzhalter:** Über `./#profile` (Navigationseintrag **Profile**) erreichbar. Der Inhalt ist
der in §3.1/`design-system.md` §8.2 festgelegte Hinweis **„Dein Spielerprofil kommt mit Phase 6.6."**
als `emptyState` – bewusst kein funktionierendes Profil, keine erfundenen Werte. Die Auswahl läuft
rein clientseitig über `location.hash`; eine Seite „Profil" im Sinne einer Route gibt es nicht.

**Erlaubte Aufräumarbeiten:** **B-2** (`token` im `player:join`-Ack-Typ ergänzt), **B-3**
(`.join__feedback` erhält eine Regel, `:empty` bleibt aus dem Layout), **B-4** (Spielerkarte
`.shell--player .card.question` bekommt eine eigene Lesebreite, der Beamer bleibt unberührt).
**B-5, B-6, B-7/R-5** bleiben unverändert.

**Prüfungen:** Typecheck, Prettier, Frontend-Tests (228) und Backend-Tests (98, inkl. der
DB-gestützten Integrationssuiten) grün. Die Spielerflächen wurden in einem headless Chromium bei
390×844, 768×1024, 1024×768, 1280×800 und 1920×1080 geprüft: kein horizontaler Überlauf, das
Fragekarten-Maß greift (680 px auf Desktop), der Beamer-Board bleibt unverändert.
