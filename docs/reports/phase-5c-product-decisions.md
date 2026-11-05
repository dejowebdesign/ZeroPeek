# Phase 5c – Verbindliche Produktentscheidungen

**Projekt:** ZeroPeek
**Projektverantwortlicher:** Dejan Popovic
**Phase:** 5c – Produktentscheidungen dokumentieren
**Datum:** 2026-11-04
**Basis:** `main` nach Merge von PR #16 (Phase 5b)
**Branch:** `docs/phase-5c-product-decisions`

> **Keine Implementierung.** Dieses Dokument und die begleitenden Konzeptänderungen sind reine
> Dokumentation. Es wurde **kein** Anwendungscode, **kein** Schema, **keine** Migration und **kein**
> Phase-6-Branch erstellt. Es wurden **keine** Assets erzeugt oder ersetzt.

---

## 1. Zweck

Phase 5c übernimmt die vom Projektverantwortlichen getroffenen **verbindlichen Produktentscheidungen**
vollständig und widerspruchsfrei in die vorhandenen Konzeptdokumente, das Game-Design, die Roadmap und
das Asset-Briefing. Alle älteren, überholten Vorschläge sind korrigiert oder als nicht beschlossen
gekennzeichnet. **Alte XP-Berechnungen, alte Levelkurven und frühere Belohnungsmodelle bestehen nicht
parallel weiter.**

---

## 2. Die verbindlichen Entscheidungen (Kurzfassung)

| #   | Thema                 | Verbindliche Entscheidung                                                                                                        |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Spielerregistrierung  | **Freiwillig.** Gastzugang bleibt ohne Konto und ohne E-Mail. Angebot **beim Beitritt** und **nach Spielende**.                  |
| 2   | Kontoanforderungen    | E-Mail + Passwort + **E-Mail-Bestätigung** + Anzeigename. Bestehende Auth wird erweitert, nicht ersetzt.                         |
| 3   | Rolle `PLAYER`        | Wird in die Planung aufgenommen. **Keine** Admin-/Trainerrechte. Umsetzung erst nach separater Freigabe.                         |
| 4   | Gastkonto-Übernahme   | **Verbindlich** für die **gerade abgeschlossene** Runde. Einmalig, serverseitig, mit kurzlebigem Nachweis. Keine Fremdübernahme. |
| 5   | XP-Berechnung         | **XP = die im Quiz erreichten Spielpunkte.** Kein zweites XP-System, kein zusätzlicher Teilnahmebonus.                           |
| 6   | Platzierungsbonus     | 1./2./3. Platz = **1.500 / 1.000 / 500 XP**. Erst nach Spielende, **nicht** in die Spielwertung eingerechnet.                    |
| 7   | Gleichstand           | Alle gleichplatzierten Spieler erhalten **denselben** Bonus (kein willkürlicher Tiebreak).                                       |
| 8   | Levelkurve            | Level 1 = 0 XP; L1→L10 je **10.000**; ab L10→L11 **+11.000**, danach je **+1.000**.                                              |
| 9   | Levelbelohnung        | **Jeder Levelaufstieg** schaltet einen Gegenstand frei. Rein kosmetisch.                                                         |
| 10  | Gegenstände           | **Charakterexklusiv** – jeder Avatar hat seine eigenen Gegenstände. Sichtbar am Avatar tragbar.                                  |
| 11  | Persönliche Statistik | Eigener Fortschritt sichtbar. **Quizhistorie nur für Administratoren.**                                                          |
| 12  | Quizhistorie          | **Unveränderlicher Quiz-Snapshot** je Spiel.                                                                                     |
| 13  | Hintergrundauswahl    | Standard **Zufall**; genau einmal je Runde, für alle gleich. Host kann vorab wählen.                                             |
| 14  | Audio                 | Show-Audio **ausschließlich** Host-/Beamer-Ansicht. Zoom-Audioübertragung später praktisch testen.                               |
| 15  | Host/Beamer           | **Bestehende kombinierte Ansicht** bleibt; keine eigene Beamer-Anwendung.                                                        |
| 16  | Sprache               | **Deutsch** standardmäßig, Englisch auswählbar; zentrale Übersetzungsarchitektur.                                                |
| 17  | Host                  | Spielleiter, **kein** Mitspieler.                                                                                                |
| 18  | QR-Code               | Spielcode **und** QR-Code in der Lobby.                                                                                          |
| 19  | Wiederverbindung      | Für Gäste **und** registrierte Spieler.                                                                                          |
| 20  | Betrieb               | Redis zum Start nicht erforderlich; schlanke Einzelinstanz; keine zusätzliche Monitoring-/Backup-Infrastruktur.                  |
| 21  | Performance           | **25 Spieler + Host** reguläres Ziel; Belastungstest ~**35 Spieler + Host**.                                                     |

---

## 3. Was konkret geändert wurde

| Dokument                                       | Änderung                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/concept/game-design-concept.md`          | Neues §4 (Registrierung, Gastkonto-Übernahme), §4.7 (persönliche Statistik), §5.2/§5.3/§5.4 (XP = Punkte, Platzierungsbonus, Levelkurve), §6.2/§6.2a/§6.5/§6.6 (Levelbelohnung, charakterexklusive Gegenstände), §3.2/§3.2a (Charakterexklusivität), §7 (Datenmodelle inkl. `Game.guestClaim`, `GameSnapshot`), §8.7 (Quiz-Snapshot), §10.5 (Hintergrundauswahl), §11.2 (Audio nur Host), §15/§16 (Priorisierung, verbindliche Entscheidungen) |
| `docs/concept/design-concept.md`               | §8.2 (Registrierungsangebote, E-Mail-Bestätigung), §8.6 (Host/Beamer kombiniert), §8.7 (Registrierungshinweise), §8.8–§8.11 (Statistik, charakterexklusive Ausrüstung, Inventar), §8.14 (Zufallshintergrund), §14 (offene Fragen)                                                                                                                                                                                                              |
| `docs/roadmap/technical-roadmap.md`            | §1/§6.3/§6.4/§6.6/§6.7/§6.8/§6.10/§6.11 aktualisiert; neue §9.1/§9.2 (XP-Regeln, Gastkonto-Übernahme); §14/§19/§20/§21 (Querschnitt, offene Entscheidungen, Phase 5c)                                                                                                                                                                                                                                                                          |
| `docs/analysis/phase-1-technical-inventory.md` | Neues §3.1 (Bestand vs. geplante Modelle); R-3 als entschärft markiert; offene Fragen aktualisiert                                                                                                                                                                                                                                                                                                                                             |
| `docs/assets/ASSET-BRIEFING.md`                | Block B (ca. 15 Charaktere), Block C (charakterexklusive Layer, Slots, Layer-Reihenfolge), Block D (Wireframe-Hintergründe, Zufallspool); Zusammenfassung angepasst                                                                                                                                                                                                                                                                            |
| `docs/concept/README.md`                       | Phase-5c-Bericht in Lesereihenfolge und Nächster-Schritt-Abschnitt                                                                                                                                                                                                                                                                                                                                                                             |
| `docs/phases.md`                               | Status der Konzeptphasen ergänzt                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docs/reports/phase-5c-product-decisions.md`   | Dieses Dokument (neu)                                                                                                                                                                                                                                                                                                                                                                                                                          |

---

## 4. Entfernte bzw. ersetzte Altregelungen

Damit keine widersprüchlichen Regeln parallel bestehen, wurden folgende frühere Vorschläge **ersetzt**
oder **als nicht beschlossen** gekennzeichnet:

- **Alte XP-Formel** (10 XP pro richtige Antwort, 4 teilweise, 25 Spielabschluss, Serienbonus,
  10 Teilnahme) → **ersetzt** durch „XP = Spielpunkte" + Platzierungsbonus.
- **Alte Levelkurve** (`100 × (n−1)^1.5`, 7 Level) → **ersetzt** durch die verbindliche Kurve
  (§2 Nr. 8).
- **Beamer als eigene Route mit Show-Token** → **entfällt**; kombinierte Host-/Beamer-Ansicht bleibt.
- **`GET /api/profile/history`** (Spieler-Zugriff auf die Quizhistorie) → **entfällt**; Historie nur
  für Administratoren.
- **Allgemeiner Gegenstandskatalog** (beliebig kombinierbar) → **ersetzt** durch
  **charakterexklusive** Gegenstände.
- **R-3 als offene Entscheidung** → **entschieden** (Quiz-Snapshot verbindlich).

---

## 5. Datenarchitektur (Konzept, keine Migration)

Die Entscheidungen erfordern folgende **additive** Erweiterungen (Details
`game-design-concept.md` §7.1). **Keine** Migration in Phase 5c:

- Enum `UserRole` + `PLAYER`; `User.emailVerifiedAt?`.
- `PlayerProfile` (XP, Level, Charakter, Avatar-Config, Statistik).
- `PlayerInventory`, `PlayerAchievement`, `XpLedger` (Idempotenz).
- `Game.guestClaim` (einmaliger Übernahmenachweis), `GameSnapshot` (Quiz-Momentaufnahme).
- `GamePlayer.userId?`, `GamePlayer.characterId?`, `Game.backgroundId?`.

**Speichern vs. berechnen:** Ereignisse (Gutschriften, Besitz, Snapshots) werden gespeichert;
abgeleitete Kennzahlen (Trefferquote, Fortschritt, Rang) werden berechnet. `PlayerProfile.xp`/`level`
sind eine Materialisierung des Ledgers; der Ledger bleibt die Wahrheit.

---

## 6. Risiken und offene Punkte

**Risiken der neuen Entscheidungen:**

| Risiko                                       | Bewertung                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Doppelte/fremde Gastkonto-Übernahme          | **hoch** – braucht einmaligen, an Session und Runde gebundenen Nachweis + Ledger-Unique    |
| Gleichstand beim Platzierungsbonus           | mittel – bestehende Ranglistenlogik prüfen und dokumentieren (kein willkürlicher Tiebreak) |
| Mehrfacher Levelaufstieg in einer Gutschrift | mittel – zentrale Levelfunktion muss alle übersprungenen Level korrekt behandeln           |
| Umfang der Gegenstands-Assets                | mittel – charakterexklusive Layer vervielfachen die Dateizahl                              |
| E-Mail-Versand (Bestätigung)                 | mittel – neue Infrastruktur (SMTP) nötig; Freigabe erforderlich                            |

**Weiterhin offen (nicht beschlossen):** Katalog in `shared` oder DB; endgültige Belohnungsmatrix;
Erfolgsnamen; R-4/R-5 (Reconnect/Zustandswiederherstellung); Pause/Überspringen; Clock-Sync;
Spielmodi-Priorisierung; IP-Speicherung; Levelbezeichnungen ab Level 7. Siehe
`technical-roadmap.md` §19.

**Weiterhin blockierend:** die noch nicht gelieferten Assets (Charaktere, Gegenstände, Hintergründe,
Audio).

---

## 7. Abgrenzung – was in Phase 5c ausdrücklich NICHT umgesetzt wurde

Implementierung des Spielerkontos, Änderung der Benutzerrollen, Datenbankmigrationen, neue
API-Endpunkte, XP-/Levelsystem, Inventar, Avatar-System, Gastübernahme, Quiz-Snapshot-System,
Spielerstatistik, Hintergrundauswahl, Änderungen an Spiellogik oder Socket.IO, neue Produktionsgrafiken,
neue externe Dienste, Änderungen an der Produktionsumgebung, Deployment über Portainer. **Phase 6.1 ist
nicht freigegeben.** Jede Implementierungsphase benötigt eine gesonderte ausdrückliche Freigabe.

---

## 8. Prüfung

| Prüfung                   | Ergebnis                                            |
| ------------------------- | --------------------------------------------------- |
| `npm run format:check`    | grün                                                |
| Betroffene Dateien        | nur Dokumentation unter `docs/` (keine App-Dateien) |
| Anwendungscode geändert   | **nein**                                            |
| Schema/Migration geändert | **nein**                                            |
| Assets erzeugt/ersetzt    | **nein**                                            |

> Hinweis: Die Dokumentation ist reine Konzeptarbeit. Ein Testlauf ist nicht erforderlich, weil kein
> Anwendungscode berührt wurde; die Konvention des Repos verlangt für reine Dokumentationsänderungen
> keinen Testlauf.

---

## 9. Nächster Schritt

Der Projektverantwortliche prüft und merged diesen PR. Danach sind die Konzeptunterlagen auf dem
verbindlichen Stand. Der nächste mögliche Schritt ist die Freigabe von **Phase 6.1 (Designsystem)** –
der einzige Schritt, der sofort und ohne Assets startbar ist. Alle weiteren Phasen warten auf die
entsprechenden Assets und Freigaben.
