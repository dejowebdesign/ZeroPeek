# Konzept und Planung – Übersicht

Dieser Bereich enthält die Konzept-, Analyse- und Planungsdokumente für den Ausbau von ZeroPeek zur
Premium-Quiz- und Game-Show-Plattform mit dem Blockwelt-Helden-Universum.

**Status: Konzept. Es ist keine Implementierung freigegeben.** Es wurde kein Anwendungscode
verändert, keine Migration erstellt und kein Implementierungsbranch angelegt.

## Lesereihenfolge

| #   | Dokument                                                                                             | Phase | Inhalt                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| 1   | [`../analysis/phase-1-technical-inventory.md`](../analysis/phase-1-technical-inventory.md)           | 1     | Verifizierte Bestandsaufnahme: Architektur, Daten, Spiellogik, Realtime, Risiken         |
| 2   | [`design-concept.md`](design-concept.md)                                                             | 2     | Designsystem, Farben, Glas, Typografie, Komponenten, Animation, Screens, Responsive      |
| 3   | [`game-design-concept.md`](game-design-concept.md)                                                   | 2     | Charakteruniversum, Avatar-System, Profile, XP/Level, Belohnungen, Show, Sound, Realtime |
| 4   | [`../roadmap/technical-roadmap.md`](../roadmap/technical-roadmap.md)                                 | 3     | Umsetzungsplan 6.1–6.12 mit Risiken, Tests, Abnahmekriterien                             |
| 5   | [`../assets/ASSET-BRIEFING.md`](../assets/ASSET-BRIEFING.md)                                         | 4     | Bild- und Audio-Anforderungen (Blöcke A–G)                                               |
| 6   | [`../reports/phase-5-concept-report.md`](../reports/phase-5-concept-report.md)                       | 5     | Gesamtbericht und Freigabevorlage                                                        |
| 7   | [`../reports/phase-5b-revision-and-first-works.md`](../reports/phase-5b-revision-and-first-works.md) | 5b    | Konzeptüberarbeitung, Designsystem/Performance, begrenzte erste Arbeiten                 |
| 8   | [`../reports/phase-5c-product-decisions.md`](../reports/phase-5c-product-decisions.md)               | 5c    | Verbindliche Produktentscheidungen (XP, Level, Registrierung, Avatare, Snapshot)         |
| 9   | [`../analysis/phase-6-2-2-player-lobby-profile.md`](../analysis/phase-6-2-2-player-lobby-profile.md) | 6.2.2 | Analyse der Spieler-Lobby und des Profil-Platzhalters (Umfang, Grenzen, Befunde B-2…B-7) |
| 10  | [`../assets/CHARACTER-CATALOGUE.md`](../assets/CHARACTER-CATALOGUE.md)                               | 6.7   | Charakter- und Gegenstandskatalog: gelieferte Assets, Slots, Layer-Status                |
| 11  | [`../reports/phase-6-7-character-avatar-system.md`](../reports/phase-6-7-character-avatar-system.md) | 6.7   | Bericht zum Blockwelt-Helden-Avatar-System                                               |

## Grundsätze dieser Dokumente

- **Bestandsschutz:** Keine Änderung an bestehenden Fragen, Antworten, Konten, Rollen,
  Authentifizierungslogik, Berechtigungen, API-Verträgen oder Daten.
- **Keine Erfindungen:** Jede Aussage über Bestand ist in Phase 1 belegt. Nicht vorhandene Funktionen
  werden als fehlend benannt, nicht als vorhanden dargestellt.
- **Keine Assets:** Es wurden keine Bilder oder Töne erzeugt oder ersetzt. Fehlende Dateien werden in
  `ASSET-BRIEFING.md` angefordert.
- **Freigabe durch den Projektverantwortlichen:** Wesentliche Produktentscheidungen bleiben bei
  Dejan Popovic. Vorschläge sind als Vorschläge gekennzeichnet.

## Nächster Schritt

Die begrenzten ersten Arbeiten der Phase 5b sind umgesetzt (Logo/Favicon optimiert, tote Ressourcen
entfernt, Testlage mit PostgreSQL verifiziert, Lasttest-Werkzeug). Siehe
`../reports/phase-5b-revision-and-first-works.md`.

In **Phase 5c** wurden die **verbindlichen Produktentscheidungen** in die Konzeptunterlagen
übernommen (XP = Spielpunkte, Platzierungsbonus, Levelkurve, freiwillige Registrierung,
Gastkonto-Übernahme, charakterexklusive Gegenstände, persönliche Statistik, Quiz-Snapshot,
Hintergrund Standard Zufall, Audio nur Host). Siehe `../reports/phase-5c-product-decisions.md`.

**Phase 6.1 (Designsystem) ist freigegeben und umgesetzt.** Der Stil _Dark Retro-Futuristic
Wireframe & Glassmorphism_ ist als Token- und Komponentenschicht vorhanden und auf die bestehenden
Oberflächen (Spieler, Host/Beamer, Editor, Admin) angewandt. Arbeitsreferenz:
[`../design/design-system.md`](../design/design-system.md); Bericht:
[`../reports/phase-6-1-design-system.md`](../reports/phase-6-1-design-system.md). Bestehende Tokens
und Daten bleiben unverändert.

**Offen:** die noch nicht gelieferten **Assets** (Charaktere, Gegenstände, Hintergründe, Audio) und
die in `../roadmap/technical-roadmap.md` §19 gelisteten Restentscheidungen.

**Phase 6.2.1 (Navigation und Shell) ist umgesetzt und gemerged** (PR #21, `main` @ `030c771`).
Die Spieler-, Host-, Editor- und Admin-Oberflächen behalten ihre eigenen URLs; die Shell ergänzt
Brand-Bar, Navigationsregion und genau eine `<h1>`.

**Phase 6.2.2 (Spieler-Lobby und Profil-Platzhalter) ist im Umfang dokumentiert, aber noch nicht
umgesetzt.** Abgrenzung: `../roadmap/technical-roadmap.md` §3.1 und
`../design/design-system.md` §8.2; Analyse: `../analysis/phase-6-2-2-player-lobby-profile.md`. Die
nächsten Phasen (6.3 Login, 6.4 Editor, …) bauen auf dem Designsystem auf.
