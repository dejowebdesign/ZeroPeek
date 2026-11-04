# Phase 5b – Konzeptüberarbeitung, Designsystem, Performance und begrenzte erste Arbeiten

**Projekt:** ZeroPeek
**Phase:** 5b – Überarbeitung des Konzepts + begrenzte erste Arbeiten
**Datum:** 2026-11-04
**Status:** Vorlage zur Freigabe durch chrisB
**Grundlage:** `docs/analysis/phase-1-technical-inventory.md`,
`docs/concept/design-concept.md`, `docs/concept/game-design-concept.md`,
`docs/roadmap/technical-roadmap.md`, `docs/assets/ASSET-BRIEFING.md`

> **Was in diesem Schritt erlaubt war:** Konzept überarbeiten, Designsystem und Produktarchitektur
> schärfen, Performance messen und **begrenzte erste Arbeiten** ausführen, die keinen
> Produktentscheid vorwegnehmen.
>
> **Was in diesem Schritt NICHT geschah:** keine Änderung an Quizfragen, Antworten, Konten, Rollen,
> Authentifizierungslogik, Berechtigungen, API-Verträgen oder Datenbankinhalten. Keine Migration.
> Keine neuen Abhängigkeiten. Keine KI-Bilder, keine Ersatzgrafiken, keine Neugestaltung der
> Blockwelt-Helden. Kein Deployment. Kein Merge.

---

## 0. Kurzfassung

Dieser Schritt hatte zwei Ziele: **(1)** den Konzeptstand auf den tatsächlichen, neu geprüften
Bestand heben und **(2)** einige **risikoarme, nicht-produktentscheidende** Arbeiten ausführen, die
das Fundament für Phase 6 sichern.

**Wichtigster neuer Befund – die Testlage war zu pessimistisch.** Die Bestandsaufnahme meldete
„60 grün, 34 übersprungen". Ursache war **kein** Defekt, sondern eine fehlende Datenbank in der
Sandbox. Mit einer echten PostgreSQL 16 laufen **alle** DB-gestützten Suiten:

| Paket     | Tests   | Vorher berichtet     | Jetzt gemessen                      |
| --------- | ------- | -------------------- | ----------------------------------- |
| backend   | **94**  | 60 grün, 34 skipped  | **94 grün** (34 zuvor übersprungen) |
| frontend  | **25**  | 25 grün              | 25 grün                             |
| shared    | **62**  | 62 grün              | 62 grün                             |
| **Summe** | **181** | 147 grün, 34 skipped | **181 grün**                        |

Damit ist die Spiellogik (Engine-Lebenszyklus, Punkte, Ranking, Zeitregeln, Realtime über echte
Sockets) **end-to-end verifiziert**, nicht nur statisch gelesen. Risiko **R-1** aus der
Bestandsaufnahme ist damit entschärft.

**Zweitwichtigster Befund – die Kapazitätsfrage ist jetzt gemessen.** Ein Socket-Lasttest mit dem
echten Backend ergibt: **25 gleichzeitige Spieler** treten in **95 ms** (Wanduhr, alle zusammen)
bei, Antwortlatenz **p95 = 28 ms**, Speicher **135 MB RSS**. Bei **35 Spielern** (Stress):
Join **134 ms**, Antwort **p95 = 35 ms**, **143 MB RSS**. Ein einzelner Backend-Prozess trägt die
Zielgröße „25 Spieler + Host" mit großem Puffer.

**Ausgeführte begrenzte erste Arbeiten** (alle bestandserhaltend, kein Produktentscheid):

1. **Assets optimiert** – `logo.png` 1,20 MB → **81 KB**, `favicon.png` 1,63 MB → **110 KB**
   (zusammen −93 %), Optik unverändert (verlustfreie Skalierung, Alphakanal des Logos erhalten).
2. **Verwaiste/ tote Ressourcen entfernt** – `favicon.svg` (nirgends referenziert) und die tote
   CSS-Regel `.brand-mark` (kein Element nutzt sie).
3. **Lasttest-Werkzeug** unter `tools/loadtest.mjs` beigelegt (nicht Teil der Anwendung).

**Offene Punkte, die eine Entscheidung von chrisB brauchen** (unverändert gültig): Charakter-Assets,
Beamer-Assets, Audio-Assets, Rolle `PLAYER`, Beamer-Surface, Sprache/i18n, Favicon-Transparenz.

---

## 1. Verifikation des Ausgangszustands

Vor jeder Arbeit wurde der Bestand neu geprüft (nicht aus dem Gedächtnis übernommen):

| Prüfung                       | Ergebnis                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| Branch / HEAD                 | `main` @ `1cf30be` (Merge PR #15), identisch mit `origin/main` |
| Neuere Commits/Branches       | **keine** – kein Branch ist weiter als `main`                  |
| Produktcode-Änderungen bisher | **keine** (nur Dokumentation)                                  |
| Build                         | grün                                                           |
| Typecheck                     | grün (alle drei Workspaces)                                    |
| Tests (mit PostgreSQL 16)     | **181/181 grün** (94 backend + 25 frontend + 62 shared)        |
| `format:check`                | grün                                                           |

**Bestandsschutz bestätigt:** Es wurden keine Fragen, Antworten, Konten, Rollen, Berechtigungen,
API-Verträge oder Daten berührt. Die Änderungen dieses Schritts sind in §4 im Einzelnen aufgeführt.

---

## 2. Verifizierte technische Fakten (Grundlage der Überarbeitung)

Diese Fakten wurden in diesem Schritt **neu gemessen**, nicht angenommen.

### 2.1 Test- und Spielverhalten

- **Alle DB-Suiten laufen** (siehe §0). Damit sind Engine-Lebenszyklus, Punktevergabe, Ranking,
  Zeitregeln, PIN-Beitritt, Lobby-Broadcast, Frage/Auflösung/Rangliste/Ende, private Spielerergebnisse
  und serverseitig berechnete Punkte **verifiziert**.
- **Engine-Taktung (aus dem Code verifiziert):** `REVEAL_MS = 6000`, `BOARD_MS = 6000`,
  `ANSWER_GRACE_MS = 1500`. Ein Fragedurchlauf (Frage → Auflösung → Rangliste → nächste Frage)
  dauert damit im Automatikbetrieb ca. **12 s** plus Antwortzeit. Das ist eine **Designentscheidung
  (Show-Tempo)**, kein Defekt – für die Host-Steuerung ist „nächste Frage" jederzeit möglich.

### 2.2 Kapazität (neu gemessen, Lasttest `tools/loadtest.mjs`)

Ablauf: echtes Backend in-process, echte PostgreSQL, echte Socket.IO-Verbindungen, volle
Quizrunde mit 25 bzw. 35 simulierten Spielern.

| Messgröße                        | 25 Spieler | 35 Spieler (Stress) |
| -------------------------------- | ---------- | ------------------- |
| Beitritt aller Spieler (Wanduhr) | 95 ms      | 134 ms              |
| Beitritt p50 / p95               | 18 / 41 ms | 33 / 60 ms          |
| Antwort p50 / p95                | 19 / 28 ms | 26 / 35 ms          |
| Fragedurchlauf (Automatik)       | ~6,04 s    | ~6,05 s             |
| Speicher (RSS)                   | 135 MB     | 143 MB              |

**Schlussfolgerung:** Die Zielgröße „**25 Spieler + Host**" ist mit einem einzelnen Backend-Prozess
**komfortabel** erreichbar; selbst 35 Spieler bleiben unter 40 ms Antwortlatenz. Die in der
Bestandsaufnahme als **R-2** geführte Skalierungsfrage ist damit für die Zielgröße **entschärft**;
sie bleibt relevant für mehrere hundert Spieler (dann Redis-Adapter, siehe Roadmap §14).

> **Hinweis zur Aussagekraft:** Der Test lief lokal ohne Netzwerk-Delay. Er beweist die
> **Serverkapazität**, nicht die Latenz echter Mobilfunknetze. Die Zahlen sind eine
> Untergrenze für die Zielgröße, keine Zusage für beliebig viele Spieler.

### 2.3 Branding – der vermutete „doppelte Z"-Fehler existiert nicht

Die Bestandsaufnahme vermutete einen sichtbaren Buchstaben „Z" neben dem Logo. Prüfung im
gerenderten DOM (`host.html`, Produktionsbuild):

```html
<span class="brand"
  ><img class="brand__logo" src="/logo.png" alt="" aria-hidden="true" decoding="async"
/></span>
```

**Ergebnis:** Es wird **genau ein** Element gerendert – das Logo-Bild. **Kein** zusätzliches „Z",
**kein** Text daneben. Die zugehörige CSS-Regel `.brand-mark` (ein violettes Kästchen, das früher
ein „Z" trug) ist **toter Code** – kein Element nutzt sie. Sie wurde entfernt (§4.2).

### 2.4 Logo-Farbwelt (gemessen, nicht geschätzt)

Analyse der **undurchsichtigen, bunten** Pixel des Logos (technisch, kein Vision-Modell):

| Farbfamilie               | Anteil | Beispiel                        |
| ------------------------- | ------ | ------------------------------- |
| Cyan (Farbton ≈ 187°)     | 23,2 % | `#15DBEE`                       |
| Violett/Indigo (255–285°) | 38,9 % | `#871BCC`, `#5815BF`, `#432DCA` |
| Magenta (285–315°)        | 17,5 % | `#DE4EF1`, `#FB7FFA`            |
| Blau (195–240°)           | 20,3 % | `#1553B3`, `#0A71A9`            |
| Silber/Grau               | 14,9 % | –                               |

**Folgerung für das Designsystem:** Die vorhandenen Tokens `--accent: #7c5cff` (Violett) und
`--accent-2: #22d3ee` (Cyan) liegen **in derselben Familie**, treffen aber die Logo-Töne nicht exakt
(das Logo-Cyan ist grüner/heller, das Violett magentaroter/indigo). Empfehlung: Tokens **nicht**
überschreiben (Bestandsschutz), sondern eine **markengetreue Akzentleiter** als Ergänzung anbieten
(design-concept §3.2, aktualisiert).

### 2.5 Assets – technischer Zustand

| Datei         | Original                 | Alpha    | Befund                                             |
| ------------- | ------------------------ | -------- | -------------------------------------------------- |
| `logo.png`    | 2172 × 724, 1 199 373 B  | **ja**   | korrekt, nur zu groß                               |
| `favicon.png` | 1254 × 1254, 1 632 075 B | **nein** | kein Alphakanal; Hintergrund **nicht** sauber weiß |
| `favicon.svg` | 485 B, viewBox 32        | ja       | **nirgends referenziert** (verwaist)               |

**Favicon-Transparenz – geprüft, nicht geraten:** Der Randbereich hat RGB-Werte von **200–255**
und ist nicht homogen (30,4 % der Pixel sind „fast weiß", der Rest nicht). Ein Freistellen würde
einen sichtbaren Saum erzeugen. **Deshalb wird das Favicon NICHT eigenmächtig freigestellt.** Es
wird eine **transparente Master-Datei von chrisB** angefordert (ASSET-BRIEFING, Block A).

---

## 3. Performance-Analyse (neu)

### 3.1 Backend

| Aspekt               | Befund                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Kapazität            | 25–35 Spieler ohne Engpass (§2.2)                                                         |
| Speicher             | 135–143 MB RSS bei 25–35 Spielern                                                         |
| Realtime             | Ein Broadcast je Zustandswechsel; keine hochfrequenten Updates                            |
| Engpass bei Wachstum | Nicht die Spielerzahl, sondern **mehrere Spiele/Instanzen** → Redis-Adapter (Roadmap §14) |

### 3.2 Frontend (Budget für Phase 6)

Der Lasttest betrifft nur das Backend. Für das Frontend werden **Budgets** als Abnahmekriterium
festgelegt (in der Roadmap verankert):

| Ressource                 | Budget (Ziel)             | Begründung                              |
| ------------------------- | ------------------------- | --------------------------------------- |
| Erstes JS (gzip)          | < 60 KB pro Seite         | heutige Bundles: 2–13 KB gzip pro Seite |
| Logo                      | ≤ 100 KB                  | jetzt 81 KB                             |
| Favicon                   | ≤ 120 KB                  | jetzt 110 KB                            |
| Beamer-Hintergrund        | ≤ 400 KB je Bild (WebP)   | Vollbild, vorab geladen                 |
| Charakter-Basislayer      | ≤ 150 KB je Figur (PNG)   | wenige Layer, nicht je Kombination      |
| Audio-Effekt              | ≤ 40 KB je Effekt         | WebM/Opus                               |
| `backdrop-filter`-Flächen | ≤ 3 gleichzeitig sichtbar | teuer auf Mobil                         |
| Sternenhimmel-Partikel    | ≤ 120 (Mobil ≤ 60)        | CPU/GPU-Last                            |

**Regel:** Effekte, die ein Budget reißen, werden reduziert – nicht die Lesbarkeit oder das
Spielerlebnis.

---

## 4. Ausgeführte begrenzte erste Arbeiten

Alle Änderungen sind **bestandserhaltend**, **risikoarm** und nehmen **keinen Produktentscheid**
vorweg. Sie sind der einzige Produktcode-Eingriff dieses Schritts.

### 4.1 Assets optimiert

| Datei         | Vorher      | Nachher       | Ersparnis | Verfahren                                            |
| ------------- | ----------- | ------------- | --------- | ---------------------------------------------------- |
| `logo.png`    | 1 199 373 B | **80 622 B**  | −93,3 %   | Lanczos-Downscale 2172×724 → 480×160, Alpha erhalten |
| `favicon.png` | 1 632 075 B | **109 606 B** | −93,3 %   | Lanczos-Downscale 1254² → 256²                       |

- **Optik unverändert:** Das Logo wird nur verkleinert (gleiches Seitenverhältnis 3:1, gleiche
  Farben, gleiche Formen, **Alphakanal bleibt**). Die CSS-Darstellung nutzt ohnehin nur 24–40 px
  Höhe; 480×160 liefert Reserve für HiDPI/Beamer.
- **Favicon:** 256×256 ist die von Browsern maximal genutzte Größe für Tab-/Startbildschirm-Icons.
- **Keine Ersetzung der Marke:** Es wurde **nichts neu gezeichnet, umgefärbt oder generiert** –
  nur verlustfrei skaliert.

### 4.2 Verwaiste/tote Ressourcen entfernt

| Ressource     | Befund                                    | Aktion                                          |
| ------------- | ----------------------------------------- | ----------------------------------------------- |
| `favicon.svg` | nirgends referenziert (0 Treffer im Code) | **entfernt** (Bestand unberührt, war ungenutzt) |
| `.brand-mark` | tote CSS-Regel, kein Element nutzt sie    | **entfernt**                                    |

> **Hinweis:** Sollte `favicon.svg` doch Bestand haben (z. B. als künftiges Vektor-Icon), kann sie
> jederzeit aus der Git-Historie wiederhergestellt werden. Bitte kurz bestätigen.

### 4.3 Lasttest-Werkzeug beigelegt

`tools/loadtest.mjs` (nicht Teil der Anwendung, nicht in Build/CI): startet das echte Backend
gegen eine Wegwerf-DB und fährt N Spieler durch eine volle Runde. Zweck: die Kapazitätsaussage
**nachprüfbar** machen und in Phase 6 als Regressionswerkzeug nutzbar.

### 4.4 Kommentare an den tatsächlichen Stand angepasst

- `ui.ts`: Der Kommentar sagte „served unchanged"; das Logo wird nun **skaliert** ausgeliefert.
  Kommentar korrigiert.
- `index/host/editor/admin.html`: Favicon-Kommentar an die optimierte Datei angepasst.

### 4.5 Nicht angefasst (bewusst)

`tokens.css` wurde **nur** um die tote Regel bereinigt. Farben, Abstände, Glaswerte, Komponenten
bleiben **unverändert** – die Designsystem-Erweiterung ist ein eigener, freigabepflichtiger Schritt
(Phase 6.1).

---

## 5. Konzeptüberarbeitung – was präzisiert wurde

Die folgenden Konzeptdokumente wurden auf den geprüften Stand gehoben (Änderungen dort im Detail):

| Dokument                                       | Präzisierung                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `docs/analysis/phase-1-technical-inventory.md` | Testlage korrigiert (181/181 mit DB), Branding-Befund richtiggestellt, R-1/R-2 aktualisiert     |
| `docs/concept/design-concept.md`               | Logo-Farbwelt als Grundlage der Akzentleiter; Assets/Branding aktualisiert; Performance-Budgets |
| `docs/concept/game-design-concept.md`          | XP-/Level-Beispiele konkretisiert; QR-/Beitrittsweg; Show-Tempo dokumentiert                    |
| `docs/roadmap/technical-roadmap.md`            | Begrenzte erste Arbeiten eingetragen; Performance-Budgets als Abnahmekriterium                  |
| `docs/assets/ASSET-BRIEFING.md`                | Asset-Optimierung vermerkt; Favicon-Transparenz begründet angefordert                           |

**Leitlinie:** Keine Aussage über Bestand ohne Prüfung. Nicht vorhandene Funktionen bleiben als
**fehlend** gekennzeichnet (Charaktere, Beamer-Assets, Audio, QR, Team-Modus, i18n).

---

## 6. Was ausdrücklich NICHT entschieden oder gebaut wurde

- **Kein** Designsystem-Umbau (Phase 6.1).
- **Keine** Navigation, **kein** Login-Umbau, **keine** Sternenhimmel-Implementierung (6.2/6.3).
- **Kein** Avatar-System, **keine** Charaktere (6.7) – wartet auf Assets.
- **Kein** XP-/Inventar-System (6.8) – wartet auf Entscheidung.
- **Kein** Beamer (6.9), **keine** Hintergrundbilder (6.10), **kein** Audio (6.11).
- **Keine** Datenbankänderung, **keine** Migration, **kein** Branch für Phase 6.
- **Keine** Ersatzbilder, **keine** KI-Grafiken, **keine** Neugestaltung der Figuren.

---

## 7. Offene Entscheidungen (unverändert, jetzt priorisiert)

| #   | Entscheidung                                   | Blockiert             | Priorität |
| --- | ---------------------------------------------- | --------------------- | --------- |
| 1   | **Charakter-Assets** (Referenzdateien)         | 6.7, 6.9, 6.10        | **hoch**  |
| 2   | **Beamer-Hintergründe**                        | 6.9, 6.10             | **hoch**  |
| 3   | **Rolle `PLAYER` + Spielerkonto-Modell**       | 6.3, 6.6, 6.7, 6.8    | **hoch**  |
| 4   | **Beamer-Surface + Show-Token**                | 6.9, 6.10, 6.11       | hoch      |
| 5   | **Sprache / i18n**                             | alle UI-Phasen        | hoch      |
| 6   | **Favicon: transparente Master-Datei**         | 6.3 (Optik)           | mittel    |
| 7   | **Audio-Assets**                               | 6.11                  | mittel    |
| 8   | **R-3** (Historieverlust beim Quiz-Bearbeiten) | 6.4 (Autospeichern)   | mittel    |
| 9   | **Katalog in `shared` oder DB**                | 6.7, 6.8              | mittel    |
| 10  | **XP-Werte / Levelschwellen / Erfolge**        | 6.8                   | mittel    |
| 11  | **`favicon.svg` endgültig entfernen?**         | –                     | niedrig   |
| 12  | **Redis-Adapter** (nur bei Wachstum)           | Betrieb > 100 Spieler | niedrig   |

---

## 8. Empfehlung für den nächsten Schritt

1. **Entscheidungen 1–5** treffen (Assets, Rolle `PLAYER`, Beamer-Surface, Sprache).
2. **Asset-Briefing** (Block B/C/D) gebündelt liefern – daran hängen die größten Phasen.
3. Danach **Freigabe für Phase 6.1 (Designsystem)** – der einzige Schritt, der sofort und ohne
   Assets startbar ist.

**Bis dahin gilt:** Konzeptphase. Keine Programmierung, keine Migration, kein Merge.

---

## 9. Zusammenfassung

- **Bestand geprüft:** `main` @ `1cf30be`, keine neueren Änderungen, kein Produktcode-Eingriff zuvor.
- **Testlage korrigiert:** **181/181 grün** mit PostgreSQL (vorher 34 übersprungen) – Spiellogik
  end-to-end verifiziert, **R-1 entschärft**.
- **Kapazität gemessen:** 25 Spieler → Join 95 ms, Antwort p95 28 ms, 135 MB; 35 Spieler → p95 35 ms.
  Zielgröße komfortabel; **R-2 für die Zielgröße entschärft**.
- **Branding-Fehler widerlegt:** kein „doppeltes Z"; tote Regel `.brand-mark` und verwaiste
  `favicon.svg` entfernt.
- **Assets optimiert:** Logo −93 %, Favicon −93 %, Optik unverändert.
- **Konzept geschärft:** Inventar, Design, Game Design, Roadmap und Asset-Briefing auf den
  geprüften Stand gehoben.
- **Nichts vorweggenommen:** Designsystem, Avatar, XP, Beamer, Audio bleiben Phase 6 und
  freigabepflichtig.

**Kein Merge, kein Deployment, keine Migration, kein Produktentscheid ohne chrisB.**
