# Phase 5 – Gesamtbericht und Freigabevorlage

**Projekt:** ZeroPeek
**Phase:** 5 – Freigabe
**Datum:** 2026-11-04
**Status:** **Vorgelegt zur Entscheidung durch den Projektverantwortlichen – es wird angehalten.**
**Grundlage:** Phasen 1–4

> **Absolute Grenze (Briefing §56):** In diesem Auftrag ist **keine** Implementierung freigegeben.
> Es wurde **kein** Anwendungscode verändert, **keine** Datenbankmigration erstellt, **kein**
> Implementierungsbranch angelegt, **kein** Pull Request mit Codeänderungen erstellt, **keine**
> Hintergrundbilder erzeugt und **keine** Charaktere verändert. Der Unterstützungsvermerk wurde
> **nicht** implementiert.

---

## 1. Kurzbeschreibung des Zielprodukts

ZeroPeek wird eine **Premium-Quiz- und Game-Show-Plattform mit eigenständigem Charakteruniversum
(Blockwelt Helden)**. Sie bietet drei verbundene Erlebnisse in einem Produkt:

- **Verwaltung** – Quizze bauen und Spiele organisieren.
- **Spiel** – motivierende Umgebung mit eigenen Helden, Fortschritt, Belohnungen, Ranglisten.
- **Show** – professionelle Präsentation für Beamer mit Animationen, Sound und Game-Show-Atmosphäre.

Designrichtung: Premium Gaming / Dark Glassmorphism, violett-cyanfarbene Lichtstimmung.

---

## 2. Bestandsaufnahme (Phase 1) – Kurzfassung

Vollständig in `docs/analysis/phase-1-technical-inventory.md`.

**Vorhanden und funktionsfähig:**

- Monorepo mit drei Paketen (`shared`, `backend`, `frontend`), strikte Trennung, gemeinsame Domäne.
- **13 Fragetypen** mit Validierung, Scoring und Darstellung.
- **Server-autoritativer Spielmotor** mit Phasenmaschine, Timern, Punkten, Ranking.
- **Zwei Socket-Namespaces** (Spieler `/`, Host `/host`) mit typisierten Verträgen.
- **Vier Oberflächen:** Spieler, Host/Beamer (eine Seite), Editor, Admin.
- **Acht Datenmodelle** (PostgreSQL/Prisma), eine defensive Migration.
- **Sicherheit:** Argon2id, Server-Sessions, CSRF, Rollen, strikte CSP.
- **Design-Token-Set** (795 Zeilen CSS) mit Aurora-Hintergrund.
- **CI/CD** bis GHCR und Portainer; mit PostgreSQL **181 grüne Tests** (94 backend + 25 frontend +
  62 shared; die DB-gestützten Suiten laufen dann mit).

**Nicht vorhanden (für die Vision nötig):**

- Spielerkonten, Registrierung, Spielerprofile.
- Charakter-/Avatar-System (Avatar ist nur ein unvalidiertes Textfeld).
- XP, Level, Inventar, Erfolge, Freischaltungen.
- Eigene Beamer-Oberfläche: **entfällt** – die kombinierte Host-/Beamer-Ansicht bleibt verbindlich.
- Sterne-Login, Sound, Show-Grafiken, globale Ranglisten.

**Verifikation in dieser Umgebung:** `npm ci`, Prisma-Generate, `npm run typecheck`, `npm test`
(60 grün ohne DB; mit PostgreSQL 181/181), `npm run build`, `npm run format:check` – alle
erfolgreich. **Kein** Produktcode geändert.

---

## 3. Designkonzept (Phase 2, Teil 1) – Kurzfassung

Vollständig in `docs/concept/design-concept.md`.

- **Farbdesign:** Bestands-Tokens bleiben; additive Akzente für Raritäten/XP (Vorschlag).
- **Glassmorphism:** sechs abgestufte Varianten (Karte, Erhöht, Dialog, Navigation, Eingabe,
  Overlay) mit definierten Werten, Kontrast- und Fallback-Regeln.
- **Typografie:** zehn Rollen (Seitentitel bis Beamer-Frage), System-Font beibehalten.
- **Komponenten:** Inventar des Bestands + Ergänzungen (Tabs, Dropdown, Fortschritt, Podium,
  Avatar-Vorschau, Skeletons, leerer Zustand, Countdown-Ring …).
- **Bewegung:** geschlossene Animationsbibliothek (12 benannte Animationen), `prefers-reduced-motion`.
- **Oberflächen:** 15 Screens beschrieben (Zweck, Layout, Komponenten, Interaktionen, Zustände,
  Responsive, Abhängigkeiten).
- **Responsive:** sechs Breakpoints; der Beamer nutzt die bestehende Host-Ansicht mit eigener Show-Skalierung.
- **Barrierefreiheit und Performance:** verbindliche Anforderungen und Fallbacks.

---

## 4. Game-Design-Konzept (Phase 2, Teil 2) – Kurzfassung

Vollständig in `docs/concept/game-design-concept.md`.

- **Charakterwelt:** Ethan und Maya als zentrale Helden; Pixel und Biene besonders; Dr. Obscura und
  O-Bots freischaltbar. **Keine** Neugestaltung, **keine** Ersatzfiguren.
- **Avatar-System:** modulare Kategorien (Kopfbedeckung, Brille, Kleidung, Werkzeug, Rucksack/Umhang,
  Seltenes, Farbe) mit **Kompatibilitätsmatrix**. Rendering-Empfehlung: **PNG-Layer** (bestandskonform,
  CSP-sicher), Entscheidung nach Prüfung echter Assets.
- **Fortschritt:** klare Trennung **Spielpunkte** (flüchtig, Bestand) und **Erfahrungspunkte**
  (dauerhaft, neu). Vorschlag für XP-Quellen, Levelschwellen (7 Stufen) und Levelnamen.
- **Belohnungen:** rein kosmetisch, deterministisch, sichtbare Sperren, kein Pay-to-win, keine
  Lootbox-Mechanik. Vorschlag für Erfolge.
- **Anti-Manipulation:** XP/Inventar nur serverseitig, idempotent über `XpLedger` mit Eindeutigkeit.
- **Spielfluss:** Abbildung der 13 Briefing-Schritte auf die vorhandene Maschine; Lücken (R-4/R-5)
  und Vorschläge (Reconnect-Zustand, Neustart-Replay, Pause, Überspringen).
- **Show:** 13 Beamer-Szenen, Charakterintegration, Skalierung.
- **Sound:** drei Ebenen, getrennte Busse, Autoplay-Regeln.
- **Realtime:** Vorschläge zu Reconnect, Clock-Sync, Beamer-Abo, Skalierung.
- **Sicherheit/Performance/Datenschutz:** konkrete Maßnahmen, IP-Speicherung ausgeschlossen (Vorschlag).

---

## 5. Technische Architektur (Vorschlag) – Kurzfassung

- **Additiv, kein Umbau.** Bestehende Modelle werden erweitert, nicht ersetzt.
- **Neue Modelle:** `PlayerProfile`, `PlayerInventory`, `PlayerAchievement`, `XpLedger`;
  **Erweiterungen:** `User.role` um `PLAYER`, `GamePlayer.userId?`, `GamePlayer.characterId?`,
  `Quiz/Question.category?/difficulty?`.
- **Katalog** (Charaktere/Gegenstände) als Konstanten in `@zeropeek/shared` (eine Wahrheit für
  Client und Server); Datenbank speichert nur Besitz/Zustand.
- **Neue Endpunkte:** Registrierung, Profil, Avatar, Inventar, Erfolge – alle additiv.
- **Bestehende API-Verträge** bleiben unverändert; Erweiterungen sind optional.
- **Jede Migration** wird dokumentiert und zur Freigabe vorgelegt (additiv, idempotent).

---

## 6. Umsetzungsroadmap (Phase 3) – Kurzfassung

Vollständig in `docs/roadmap/technical-roadmap.md`. Zwölf Phasen, jede mit Ziel, betroffenen
Komponenten/Dateien, Datenmodellen, API-Änderungen, Abhängigkeiten, Risiken, Teststrategie,
Abnahmekriterien und Aufwand. Reihenfolge: 6.1 Designsystem → 6.2 Navigation → 6.3 Login/Registrierung
→ 6.4 Editor → 6.5 Admin/Host → 6.6 Profile → 6.7 Avatar → 6.8 Inventar/XP → 6.9 Beamer → 6.10 Bilder
→ 6.11 Sound → 6.12 Erweiterungen. Jede Phase endet mit PR und Freigabe-Gate.

---

## 7. Bild- und Audioanforderungen (Phase 4) – Kurzfassung

Vollständig in `docs/assets/ASSET-BRIEFING.md`. Blöcke A–G:

| Block | Inhalt                 | Blockiert Phase    | Priorität |
| ----- | ---------------------- | ------------------ | --------- |
| A     | Logo/Favicon optimiert | 6.3 (Optik)        | niedrig   |
| B     | Charaktere             | **6.7, 6.9, 6.10** | **hoch**  |
| C     | Avatar-Gegenstände     | **6.7, 6.8**       | **hoch**  |
| D     | Hintergrund/Beamer     | **6.9, 6.10**      | **hoch**  |
| E     | Icons                  | 6.2, 6.5           | mittel    |
| F     | Soundeffekte           | 6.11               | mittel    |
| G     | Musik                  | 6.11               | mittel    |

---

## 8. Risiken (konsolidiert)

| #    | Risiko                                                   | Schwere  | Phase        |
| ---- | -------------------------------------------------------- | -------- | ------------ |
| R-3  | Quiz-Bearbeiten löscht Antworten/Historie (Kaskade)      | **hoch** | 6.4          |
| R-4  | Kein Zustands-Replay nach Serverneustart                 | **hoch** | 6.5/6.9      |
| R-5  | Reconnect mitten in der Frage stellt die Frage nicht her | hoch     | 6.9          |
| R-2  | In-Memory-Motor ohne Redis-Adapter (keine Skalierung)    | mittel   | 6.12         |
| R-6  | Kein Rate-Limit auf Socket-Events                        | mittel   | 6.3/6.9      |
| R-7  | Kein Clock-Sync (Countdown nutzt Client-Uhr)             | mittel   | 6.9          |
| R-8  | Favicon ohne Alpha, sehr große Dateien                   | niedrig  | 6.3          |
| R-10 | Keine Charakter-/Show-/Audio-Assets                      | **hoch** | 6.7/6.9/6.11 |
| R-11 | Strenge CSP begrenzt dynamische Stile                    | niedrig  | alle         |
| R-12 | Keine E2E-/visuellen Tests                               | mittel   | alle         |

---

## 9. Offene Fragen (gebündelt)

**Produkt (aus Briefing/ADR):**

1. Q1 Scoring-Formel, Q2 „zu schnell"-Regel, Q6 Tie-Break – bestätigen?
2. Q5 IP-Speicherung – endgültig ausschließen?
3. Q7 Hausaufgabenmodus – im Umfang?
4. Sprache: Englisch beibehalten oder Deutsch/i18n?

**Architektur:**

5. Rolle `PLAYER` + Spielerkonto-Modell einführen?
6. R-3: Quiz-Snapshot je Spiel einführen?
7. R-4/R-5: Zustandswiederherstellung umsetzen?
8. Clock-Sync einführen?
9. Redis-Adapter oder bewusst eine Instanz?
10. Katalog in `shared` oder Datenbank?
11. Pause/Überspringen im Host?

**Design:**

13. Schrift: System-Stack beibehalten?
14. Farbzusätze und Glasvarianten genehmigen?
15. Navigation: Seitenleiste oder Kopfzeile?
16. Startseite: konsolidierende Seite?

**Assets:**

17. Favicon: transparente Variante bereitstellen? `favicon.svg` behalten?
18. Charakter-Referenzdateien bereitstellen?
19. Audio mit geklärten Rechten bereitstellen?

---

## 10. Priorisierung (Empfehlung)

**Zuerst (Fundament):** 6.1 Designsystem, 6.2 Navigation/Responsive.
**Dann (Konto + Verwaltung):** 6.3 Login/Registrierung, 6.4 Editor (nach R-3), 6.5 Admin/Host.
**Dann (Bindung):** 6.6 Profile, 6.7 Avatar (nach Assets), 6.8 Inventar/XP.
**Dann (Show):** 6.9 Beamer, 6.10 Bilder, 6.11 Sound.
**Zuletzt:** 6.12 Erweiterungen (Statistiken, globale Ranglisten, Modi).

**Kritischer Pfad:** Charakter-Assets (Block B) und Beamer-Hintergründe (Block D) bestimmen den
Start der größten Phasen. Bitte möglichst früh bereitstellen.

---

## 11. Was jetzt vom Projektverantwortlichen gebraucht wird

1. **Entscheidungen** zu den offenen Fragen (§9).
2. **Freigabe** des Design- und Game-Design-Konzepts.
3. **Freigabe** der Roadmap und der Phasenreihenfolge.
4. **Assets** gemäß `docs/assets/ASSET-BRIEFING.md` (mindestens Block B und D).
5. **Freigabe der ersten Implementierungsphase** (Empfehlung: 6.1 Designsystem).

**Danach wird angehalten.** Es wird keine Phase begonnen, kein Branch erstellt und kein PR mit
Codeänderungen geöffnet, bis der Projektverantwortliche ausdrücklich freigibt (Briefing §50).

---

## 12. Erstellte Dokumente

| Dokument                                       | Inhalt                                |
| ---------------------------------------------- | ------------------------------------- |
| `docs/analysis/phase-1-technical-inventory.md` | Phase 1: Technische Bestandsaufnahme  |
| `docs/concept/design-concept.md`               | Phase 2 (Teil 1): Designkonzept       |
| `docs/concept/game-design-concept.md`          | Phase 2 (Teil 2): Game-Design-Konzept |
| `docs/roadmap/technical-roadmap.md`            | Phase 3: Technischer Umsetzungsplan   |
| `docs/assets/ASSET-BRIEFING.md`                | Phase 4: Bild-/Audio-Asset-Briefing   |
| `docs/concept/README.md`                       | Übersicht der Konzeptdokumente        |
| `docs/reports/phase-5-concept-report.md`       | Dieser Gesamtbericht                  |

Alle Dokumente sind **Konzept/Planung**. Es wurden **keine** Produktdateien verändert.
