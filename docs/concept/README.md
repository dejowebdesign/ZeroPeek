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

## Grundsätze dieser Dokumente

- **Bestandsschutz:** Keine Änderung an bestehenden Fragen, Antworten, Konten, Rollen,
  Authentifizierungslogik, Berechtigungen, API-Verträgen oder Daten.
- **Keine Erfindungen:** Jede Aussage über Bestand ist in Phase 1 belegt. Nicht vorhandene Funktionen
  werden als fehlend benannt, nicht als vorhanden dargestellt.
- **Keine Assets:** Es wurden keine Bilder oder Töne erzeugt oder ersetzt. Fehlende Dateien werden in
  `ASSET-BRIEFING.md` angefordert.
- **Freigabe durch chrisB:** Wesentliche Produktentscheidungen bleiben bei chrisB. Vorschläge sind
  als Vorschläge gekennzeichnet.

## Nächster Schritt

Die begrenzten ersten Arbeiten der Phase 5b sind umgesetzt (Logo/Favicon optimiert, tote Ressourcen
entfernt, Testlage mit PostgreSQL verifiziert, Lasttest-Werkzeug). Siehe
`../reports/phase-5b-revision-and-first-works.md`.

Entscheidungen und Assets gemäß `../reports/phase-5b-revision-and-first-works.md` §7 und
`../reports/phase-5-concept-report.md` §9/§11 einholen, dann Freigabe für Phase 6.1 (Designsystem)
erteilen. Phase 6.1 ist der einzige Schritt, der sofort und ohne Assets startbar ist.
