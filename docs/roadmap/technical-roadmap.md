# Phase 3 – Technischer Umsetzungsplan (Roadmap)

**Projekt:** ZeroPeek
**Phase:** 3 – Technischer Umsetzungsplan
**Datum:** 2026-11-04
**Status:** Entwurf zur Freigabe durch chrisB
**Grundlage:** `docs/analysis/phase-1-technical-inventory.md`, `docs/concept/design-concept.md`,
`docs/concept/game-design-concept.md`

> **Keine Implementierung.** Dieses Dokument plant nur. Kein Branch, keine Migration, keine
> Codeänderung wurde erstellt.

---

## 0. Arbeitsregeln für jede Phase

Für **jede** unten beschriebene Entwicklungsphase gilt verbindlich (Briefing §5, §52):

1. **Eigener Branch**, niemals direkt auf `main`.
2. **Nur der vereinbarte Funktionsumfang.** Keine unbeauftragten Änderungen.
3. **Bestandsschutz** (Bestandsaufnahme §12) einhalten.
4. **Tests** schreiben und ausführen (Unit + betroffene Integration; E2E wo sinnvoll).
5. **Build und Typecheck** müssen grün sein; `format:check` ebenfalls.
6. **Datenbankmigrationen** beschreiben und zur Freigabe vorlegen; additiv, idempotent, ohne
   Datenverlust.
7. **Dokumentation** aktualisieren (passend zum tatsächlichen Stand).
8. **Risiken** im PR auflisten.
9. **Pull Request** mit verständlicher Beschreibung, betroffenen Modulen, Testnachweis.
10. **Nach dem PR anhalten**, bis chrisB merged oder weiter freigibt. Abhängigkeiten zwischen offenen
    PRs ausdrücklich dokumentieren.

**Freigabe-Gate:** Jede Phase endet mit einem PR und wartet auf Merge/Freigabe. Die Reihenfolge
6.1 → 6.12 wird nur dann durchbrochen, wenn eine Freigabe oder ein Asset fehlt (dann wird die
unabhängige Arbeit vorgezogen, nicht die abhängige).

---

## 1. Phasenübersicht und Abhängigkeiten

```
6.1 Designsystem ──► 6.2 Navigation/Responsive ──► 6.3 Login/Registrierung
   │                                                       │
   │                                                       ├─► 6.6 Spielerprofile ──► 6.7 Charaktere/Avatar ──► 6.8 Inventar/XP
   ├─► 6.5 Admin/Host                                      │
   └─► 6.4 Quizverwaltung/Editor (braucht R-3-Entscheidung)

6.7 Charaktere/Avatar ──► 6.9 Beamer/Game-Show ──► 6.10 Hintergrundbilder
                                                   └─► 6.11 Sound

6.6/6.8 ──► 6.12 Erweiterungen (Statistiken, globale Ranglisten, Modi)
```

**Kritische Abhängigkeiten:**

| Phase | Braucht zwingend                                  | Ohne das blockiert     |
| ----- | ------------------------------------------------- | ---------------------- |
| 6.3   | Entscheidung: Rolle `PLAYER`, Spielerkonto-Modell | 6.6, 6.7, 6.8          |
| 6.4   | Entscheidung R-3 (Historieverlust)                | Autospeichern, Reports |
| 6.7   | **Charakter-Assets von chrisB** (fehlen)          | 6.7, 6.9, 6.10         |
| 6.9   | Entscheidung Beamer-Surface + Show-Token          | 6.9, 6.10, 6.11        |
| 6.11  | **Audio-Assets von chrisB** (fehlen)              | 6.11                   |
| 6.12  | Entscheidungen zu Modi/Redis                      | 6.12                   |

---

## 2. Phase 6.1 – Designsystem

| Punkt                      | Inhalt                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Ein zentrales, dokumentiertes Designsystem als Grundlage aller Oberflächen.                                             |
| **Betroffene Komponenten** | `packages/frontend/src/styles/tokens.css`, `ui.ts`, ggf. neue CSS-Dateien                                               |
| **Betroffene Dateien**     | `styles/tokens.css` (erweitern), `ui.ts` (Bausteine ergänzen), ggf. `styles/components/*.css`                           |
| **Datenmodelle**           | keine                                                                                                                   |
| **API-Änderungen**         | keine                                                                                                                   |
| **Abhängigkeiten**         | keine (erste Phase)                                                                                                     |
| **Risiken**                | Bestehende Optik könnte sich verschieben → **bestehende Tokens unverändert lassen**, nur additiv erweitern              |
| **Teststrategie**          | Unit-Tests für neue UI-Bausteine (`dom`/`ui`); visuelle Prüfung aller vier Seiten vor/nach; `format:check`              |
| **Abnahmekriterien**       | Alle neuen Tokens dokumentiert; alle Seiten sehen unverändert oder besser aus; Kontrastanforderung erfüllt; CSP-konform |
| **Aufwand**                | mittel                                                                                                                  |

**Bestandsschutz:** `tokens.css` wird **additiv** erweitert. Vorhandene Klassennamen und Werte
bleiben, damit die bestehenden Seiten (Spieler, Host, Editor, Admin) unverändert funktionieren.

---

## 3. Phase 6.2 – Navigation und Responsive Layout

| Punkt                      | Inhalt                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Ziel**                   | Rollenorientierte Navigation; Desktop, Tablet, Smartphone und Beamer sauber unterstützt.                                             |
| **Betroffene Komponenten** | `ui.ts` (`pageHeader`, neu: Navigation), alle `pages/*.ts`, `tokens.css`                                                             |
| **Betroffene Dateien**     | `packages/frontend/src/ui.ts`, `pages/*.ts`, `styles/tokens.css`, ggf. neue `navigation.ts`                                          |
| **Datenmodelle**           | keine                                                                                                                                |
| **API-Änderungen**         | keine                                                                                                                                |
| **Abhängigkeiten**         | 6.1                                                                                                                                  |
| **Risiken**                | Navigation könnte bestehende Direktlinks brechen; Rollenanzeige darf keine Berechtigung ersetzen                                     |
| **Teststrategie**          | Unit-Tests der Navigationslogik; manuelle Prüfung aller Breakpoints (≤480, 768, 1024, 1440); bestehende Seiten erreichbar            |
| **Abnahmekriterien**       | Keine horizontale Scrollleiste; alle bestehenden Seiten erreichbar; Rollen sehen nur ihre Bereiche (Anzeige), Server prüft weiterhin |
| **Aufwand**                | mittel                                                                                                                               |

**Bestandsschutz:** Alle bestehenden URLs (`/`, `/host.html`, `/editor.html`, `/admin.html`)
bleiben gültig. Die Navigation ist **zusätzlich**, kein Ersatz.

---

## 4. Phase 6.3 – Login, Registrierung, Sternenhimmel

| Punkt                      | Inhalt                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Animierter Sternenhimmel, Glas-Login, Registrierung für Spieler, Gastzugang unverändert.                                              |
| **Betroffene Komponenten** | Login-Screen (`host.ts` heute), neue Registrierung, `tokens.css`, neue Sternenkomponente                                              |
| **Betroffene Dateien**     | `pages/host.ts` (Login), neue `pages/auth.ts`/`login`-Komponente, `styles/*`, neue `starfield.ts`                                     |
| **Datenmodelle**           | **`User.role` um `PLAYER` erweitern** (Enum-Migration); ggf. `PlayerProfile` (siehe 6.6)                                              |
| **API-Änderungen**         | **Neu:** `POST /api/auth/register` (Spieler). Bestehendes `login`/`logout`/`me` unverändert.                                          |
| **Abhängigkeiten**         | 6.1, 6.2; Entscheidung zur Rolle `PLAYER`                                                                                             |
| **Risiken**                | Bestehende Auth darf nicht verändert werden; Enum-Erweiterung muss additiv sein; Sternenhimmel-Performance                            |
| **Teststrategie**          | Unit: Validierung (Passwort ≥ 10, Benutzername); Integration: Registrierung, Login, CSRF; `prefers-reduced-motion`                    |
| **Abnahmekriterien**       | Bestehende Konten funktionieren unverändert; neue Spieler können sich registrieren; Gastzugang unverändert; Sternenhimmel abschaltbar |
| **Aufwand**                | mittel                                                                                                                                |

**Bestandsschutz:** Die vorhandene Auth-Logik (Argon2id, Sessions, CSRF, Guards) wird **nicht**
ersetzt. `register` ist **additiv**. Die Rolle `PLAYER` hat **keine** Admin-/Trainerrechte.

---

## 5. Phase 6.4 – Quizverwaltung und Editor

| Punkt                      | Inhalt                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Ziel**                   | Modernisierte Verwaltung und Editor mit Drag-and-drop, Kategorien, Schwierigkeit, Vorschau.                        |
| **Betroffene Komponenten** | `pages/editor.ts`, `questionForm.ts`, `questionView.ts`, `quizRoutes.ts`, `quizService.ts`                         |
| **Betroffene Dateien**     | `pages/editor.ts`, `questionForm.ts`, `styles/tokens.css`, `schema.prisma`, `mappers.ts`                           |
| **Datenmodelle**           | **Additiv:** `Quiz.category?`, `Quiz.difficulty?`, `Question.category?`/`difficulty?` (oder im Payload)            |
| **API-Änderungen**         | Additive Felder in bestehenden Quiz-Endpunkten; Import/Export bleiben kompatibel                                   |
| **Abhängigkeiten**         | 6.1, 6.2; **Entscheidung R-3**                                                                                     |
| **Risiken**                | **R-3 (Historieverlust)**; Drag-and-drop ohne Tastatur-Alternative (Barrierefreiheit); Import alter Dateien        |
| **Teststrategie**          | Unit: Reihenfolge, Validierung; Integration: CRUD unverändert, 13 Typen lesbar; Import/Export-Rundlauf             |
| **Abnahmekriterien**       | Bestehende Quizze unverändert lesbar/speicherbar; Import/Export funktioniert; Fragen/Antworten bleiben unverändert |
| **Aufwand**                | mittel                                                                                                             |

**Bestandsschutz (kritisch):** Fragen und Antworten bestehender Quizze werden **nicht** verändert.
Import/Export bleiben erhalten. Wegen **R-3** wird **Autospeichern für die Fragenliste erst nach
einer Entscheidung** eingeführt (sonst häufigere kaskadierende Löschungen).

---

## 6. Phase 6.5 – Admin und Host

| Punkt                      | Inhalt                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Modernisierter Admin-Bereich und eigenständige Host-Steuerung mit klarer Zustandsanzeige.                         |
| **Betroffene Komponenten** | `pages/admin.ts`, `pages/host.ts`, ggf. neue `pages/host-console.ts`                                              |
| **Betroffene Dateien**     | `pages/admin.ts`, `pages/host.ts`, `styles/*`, ggf. neue Host-Steuerkomponenten                                   |
| **Datenmodelle**           | keine (evtl. später Admin-Statistiken)                                                                            |
| **API-Änderungen**         | keine zwingend; neue Admin-Unterbereiche erst nach Freigabe                                                       |
| **Abhängigkeiten**         | 6.1, 6.2                                                                                                          |
| **Risiken**                | Bestehende Admin-Regeln (letzter Admin) müssen erhalten bleiben; Host darf Steuerung und Anzeige nicht vermischen |
| **Teststrategie**          | Integration: Admin-Routen unverändert; Unit: Zustandsanzeige; manuelle Prüfung der Host-Steuerung                 |
| **Abnahmekriterien**       | Alle Admin-Funktionen unverändert; kritische Host-Aktionen mit Bestätigung; Phase immer sichtbar                  |
| **Aufwand**                | mittel                                                                                                            |

**Bestandsschutz:** Alle vorhandenen Admin-Funktionen bleiben. Die Regeln bleiben **serverseitig**.

---

## 7. Phase 6.6 – Spielerprofile

| Punkt                      | Inhalt                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| **Ziel**                   | Dauerhaftes Spielerprofil mit Fortschritt, Statistik, Historie.                                |
| **Betroffene Komponenten** | neue `pages/profile.ts`, `PlayerProfile`-Modell, neue Service-/Route-Module                    |
| **Betroffene Dateien**     | `schema.prisma`, neue `services/profileService.ts`, neue `routes/profileRoutes.ts`, neue Seite |
| **Datenmodelle**           | **Neu:** `PlayerProfile`; **Erweiterung:** `GamePlayer.userId?`                                |
| **API-Änderungen**         | **Neu:** `GET /api/profile`, `GET /api/profile/history`, `PUT /api/profile` (Charakterwahl)    |
| **Abhängigkeiten**         | 6.3 (Spielerkonto)                                                                             |
| **Risiken**                | Profile dürfen keine XP vom Client annehmen; Fremdzugriff auf fremdes Profil verhindern        |
| **Teststrategie**          | Integration: Profil nur für eigenen Nutzer; XP nur serverseitig; Unit: Statistikberechnung     |
| **Abnahmekriterien**       | Profil zeigt korrekte, serverseitig berechnete Werte; keine Manipulation möglich               |
| **Aufwand**                | mittel                                                                                         |

**Migration:** Additiv (`PlayerProfile` neu, `GamePlayer.userId` nullable). Keine bestehende Spalte
wird geändert. Bestehende `GamePlayer`-Zeilen bleiben ohne `userId` (Gast).

---

## 8. Phase 6.7 – Blockwelt-Helden-Avatar-System

| Punkt                      | Inhalt                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Charakterauswahl und modularer Avatar-Editor mit Kompatibilitätsmatrix.                                          |
| **Betroffene Komponenten** | neue `pages/characters.ts`, `pages/avatar.ts`, `shared`-Katalog, Layer-Rendering                                 |
| **Betroffene Dateien**     | `packages/shared/src/characters.ts` (neu), `packages/shared/src/cosmetics.ts` (neu), neue Seiten, `styles/*`     |
| **Datenmodelle**           | `PlayerProfile.selectedCharacterId`, `PlayerProfile.avatarConfig` (JSONB)                                        |
| **API-Änderungen**         | `PUT /api/profile/avatar` (serverseitig validiert gegen Kompatibilitätsmatrix)                                   |
| **Abhängigkeiten**         | **Charakter-Assets von chrisB** (fehlen), 6.6                                                                    |
| **Risiken**                | Fehlende Assets blockieren; falsche Kombinationen; Schärfe auf Mobil                                             |
| **Teststrategie**          | Unit: Kompatibilitätsmatrix, Layer-Reihenfolge; Integration: Avatar-Speicherung validiert; visuell Desktop/Mobil |
| **Abnahmekriterien**       | Nur kompatible Teile wählbar; Avatar serverseitig validiert; scharf auf Desktop und Mobil                        |
| **Aufwand**                | hoch                                                                                                             |

**Blockiert bis Assets vorliegen.** Unabhängige Arbeit (Katalog, Matrix, Validierung) kann
vorbereitet werden, die Darstellung nicht.

**Renderingverfahren:** Entscheidung **nach** Prüfung echter Assets; Empfehlung PNG-Layer
(game-design-concept §3.3). Keine Neugestaltung der Figuren.

---

## 9. Phase 6.8 – Inventar, XP und Belohnungen

| Punkt                      | Inhalt                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| **Ziel**                   | Inventar, XP/Level, Erfolge, Freischaltungen – alles serverseitig und manipulationssicher.     |
| **Betroffene Komponenten** | neue `pages/inventory.ts`, `services/progressService.ts`, Motor-Anbindung am Spielende         |
| **Betroffene Dateien**     | `schema.prisma`, neue Services/Routen, `services/engine.ts` (nur Haken am `end`)               |
| **Datenmodelle**           | **Neu:** `PlayerInventory`, `PlayerAchievement`, `XpLedger`                                    |
| **API-Änderungen**         | **Neu:** `GET /api/inventory`, `POST /api/inventory/equip`, `GET /api/achievements`            |
| **Abhängigkeiten**         | 6.6, 6.7; Anti-Manipulations-Entscheidungen                                                    |
| **Risiken**                | Doppelte XP-Vergabe, doppeltes Einlösen, manipulierte Bedingungen                              |
| **Teststrategie**          | Integration: XP genau einmal je Spiel; Erfolg genau einmal; `@@unique` verhindert Doppelbesitz |
| **Abnahmekriterien**       | XP/Inventar nur serverseitig; idempotent; keine Client-Schreibpfade                            |
| **Aufwand**                | mittel                                                                                         |

**Bestandsschutz:** Die Punktevergabe im Spiel bleibt unverändert. XP ist ein **zusätzlicher**
Vorgang beim Spielende, in einer Transaktion.

---

## 10. Phase 6.9 – Beamer und Game-Show-Modus

| Punkt                      | Inhalt                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Eigenständige Präsentationsoberfläche mit 13 Show-Szenen.                                             |
| **Betroffene Komponenten** | neue `pages/show.ts` + `show.html`, Show-Szenen, Animationen, Show-Token                              |
| **Betroffene Dateien**     | neue Seite, `socket.ts` (Show-Abo), `styles/*`, `vite.config.ts` (neuer Eintrag)                      |
| **Datenmodelle**           | evtl. `Game.showToken` (additiv) oder Token in `Game.settings`                                        |
| **API-Änderungen**         | **Neu:** Show-Token erzeugen; Beamer-Verbindung über Token                                            |
| **Abhängigkeiten**         | Entscheidung Beamer-Surface + Show-Token, 6.7 (Charaktere), Beamer-Grafiken                           |
| **Risiken**                | Sicherheit des Show-Zugangs; Performance der Animationen; Lesbarkeit aus Distanz                      |
| **Teststrategie**          | Manuelle Show-Prüfung bei 1280×720/1920×1080/2560×1440; keine Doppel-Effekte; Token nur für das Spiel |
| **Abnahmekriterien**       | Beamer zeigt alle Szenen korrekt; Frage/Antworten immer im Vordergrund; Zugang geschützt              |
| **Aufwand**                | hoch                                                                                                  |

**Bestandsschutz:** Die Host-Steuerung bleibt; der Beamer ist **zusätzlich**. Der heutige
Host-als-Beamer bleibt als Einzelgerät-Variante erhalten, wenn chrisB das wünscht.

---

## 11. Phase 6.10 – Hintergrundbilder

| Punkt                      | Inhalt                                                                     |
| -------------------------- | -------------------------------------------------------------------------- |
| **Ziel**                   | Von chrisB bereitgestellte Grafiken einbinden.                             |
| **Betroffene Komponenten** | Beamer, Login, ausgewählte Bereiche                                        |
| **Betroffene Dateien**     | `packages/frontend/public/backgrounds/*`, CSS-Referenzen                   |
| **Datenmodelle**           | keine                                                                      |
| **API-Änderungen**         | keine                                                                      |
| **Abhängigkeiten**         | **Bilder von chrisB** (fehlen), 6.9                                        |
| **Risiken**                | Falsche Formate/Größen; Lesbarkeit; Ladezeit                               |
| **Teststrategie**          | Prüfung Format/Auflösung/Transparenz/Größe; visuelle Prüfung; Lazy Loading |
| **Abnahmekriterien**       | Bilder korrekt eingebunden, lesbar, performant; **keine** Ersatzbilder     |
| **Aufwand**                | niedrig                                                                    |

**Regel (Briefing §29–31):** Es werden **keine** KI-Ersatzbilder, **keine** Stockbilder und **keine**
Platzhalter als endgültige Lösung verwendet. Fehlende Bilder werden angefordert und abgewartet.

---

## 12. Phase 6.11 – Sound und Musik

| Punkt                      | Inhalt                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| **Ziel**                   | Eigenständiges Sounddesign mit getrennten Bussen für Musik und Effekte.                   |
| **Betroffene Komponenten** | neuer `audio.ts`-Manager, Anbindung an UI/Spiel/Show                                      |
| **Betroffene Dateien**     | neue `packages/frontend/src/audio.ts`, `public/audio/*`, Anbindung in `pages/*`           |
| **Datenmodelle**           | keine                                                                                     |
| **API-Änderungen**         | keine (Host steuert Show-Musik über ein Socket-Ereignis, falls nötig)                     |
| **Abhängigkeiten**         | **Audio-Assets von chrisB** (fehlen), 6.9                                                 |
| **Risiken**                | Autoplay-Sperre; doppelte Effekte; CPU-Last; Urheberrecht                                 |
| **Teststrategie**          | Manuell: Autoplay-Verhalten, Lautstärketrennung, Stummschaltung, keine Überlappung        |
| **Abnahmekriterien**       | Musik/Effekte getrennt regelbar; stumm schaltbar; kein Autoplay-Fehler; keine Überlappung |
| **Aufwand**                | mittel                                                                                    |

**Regel:** Keine ungeklärten urheberrechtlich geschützten Musikstücke. Assets werden angefordert.

---

## 13. Phase 6.12 – Erweiterungen

| Punkt                      | Inhalt                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------- |
| **Ziel**                   | Statistiken, globale Ranglisten, weitere freigegebene Modi.                             |
| **Betroffene Komponenten** | `reportService.ts`, neue Statistikseiten, Ranglisten-Aggregation, evtl. Team/Finalrunde |
| **Betroffene Dateien**     | Services/Routen/Seiten nach Freigabe                                                    |
| **Datenmodelle**           | evtl. Aggregationsmodelle/Indizes                                                       |
| **API-Änderungen**         | neue Statistik-/Ranglisten-Endpunkte                                                    |
| **Abhängigkeiten**         | Entscheidungen zu Modi, Redis, Aggregation                                              |
| **Risiken**                | Performance der Aggregation; Umfang                                                     |
| **Teststrategie**          | Integration: Aggregation korrekt; Performance mit vielen Spielen                        |
| **Abnahmekriterien**       | Werte korrekt und performant; bestehende Reports unverändert                            |
| **Aufwand**                | mittel bis hoch (je Umfang)                                                             |

**Regel:** Kein Funktionsumfang, der das Kernspielerlebnis verschlechtert. Priorisierung siehe
game-design-concept §15.

---

## 14. Querschnittsthemen (in mehreren Phasen)

| Thema                               | Phasen     | Vorschlag                                                           |
| ----------------------------------- | ---------- | ------------------------------------------------------------------- |
| Tests erweitern (E2E, visuell)      | ab 6.2     | Playwright einführen (heute nur im README genannt, nicht vorhanden) |
| Socket-Rate-Limit (R-6)             | ab 6.3/6.9 | Limit für `join`/`answer`/`rejoin`                                  |
| Clock-Sync (R-7)                    | 6.9        | Ping/Pong-Versatz, siehe game-design-concept §12.3                  |
| Zustandswiederherstellung (R-4/5)   | 6.5/6.9    | Reconnect liefert aktuellen Zustand; Neustart rekonstruiert         |
| R-3 (Historieverlust)               | 6.4        | Entscheidung nötig; ggf. Frage-Snapshot je Spiel                    |
| Barrierefreiheit                    | alle       | Kontrast, Fokus, `prefers-reduced-motion`, Tastatur                 |
| Dokumentation                       | alle       | ADRs für neue Entscheidungen; Konzept aktuell halten                |
| **Performance-Budgets**             | alle       | §20 – als Abnahmekriterium prüfen                                   |
| **Lasttest** (`tools/loadtest.mjs`) | ab 6.5/6.9 | Nach Realtime-Änderungen erneut fahren (Regressionsschutz)          |

---

## 15. Phase 5b – bereits ausgeführte begrenzte erste Arbeiten

Diese Änderungen sind **bereits umgesetzt** (Branch `docs/concept-revision-and-first-works`) und in
Phase 6 nicht erneut zu erledigen. Sie sind bestandserhaltend und nehmen keinen Produktentscheid
vorweg (Details: `docs/reports/phase-5b-revision-and-first-works.md` §4).

| Arbeit                            | Ergebnis                                                  | Phase-Bezug |
| --------------------------------- | --------------------------------------------------------- | ----------- |
| Logo optimiert                    | 2172×724 / 1,20 MB → **480×160 / 81 KB** (Alpha erhalten) | 6.1/6.3     |
| Favicon optimiert                 | 1254² / 1,63 MB → **256² / 110 KB**                       | 6.3         |
| Verwaiste `favicon.svg` entfernt  | 0 Referenzen im Code                                      | 6.1         |
| Tote CSS-Regel `.brand-mark` weg  | kein Element nutzte sie                                   | 6.1         |
| Lasttest-Werkzeug                 | `tools/loadtest.mjs` beigelegt                            | 6.5/6.9     |
| Kommentare an Ist-Stand angepasst | `ui.ts`, `*.html` (Favicon)                               | –           |

---

## 16. Performance-Budgets (Abnahmekriterium)

Jede UI-/Show-Phase prüft gegen diese Budgets (aus design-concept §11.2):

| Ressource                 | Budget              |
| ------------------------- | ------------------- |
| Erstes JS (gzip/Seite)    | < 60 KB             |
| Logo / Favicon            | ≤ 100 KB / ≤ 120 KB |
| Beamer-Hintergrund (WebP) | ≤ 400 KB je Bild    |
| Charakter-Basislayer      | ≤ 150 KB je Figur   |
| Audio-Effekt (Opus)       | ≤ 40 KB je Effekt   |
| Glasflächen gleichzeitig  | ≤ 3 sichtbar        |
| Sternenhimmel-Partikel    | ≤ 120 (Mobil ≤ 60)  |

**Gemessene Kapazität (Phase 5b):** 25 Spieler → Join 95 ms, Antwort p95 28 ms, 135 MB RSS;
35 Spieler → p95 35 ms. Zielgröße komfortabel; R-2 für die Zielgröße entschärft.

---

## 17. Teststrategie (übergreifend)

Jede Phase muss bestehen (Briefing §45):

1. **Build** (`npm run build`).
2. **Typecheck** (`npm run typecheck`).
3. **Unit-Tests** (`npm test`, alle Workspaces).
4. **Integrationstests** (mit PostgreSQL; **alle 181 Tests** laufen grün – Phase 5b).
5. **E2E-Tests** (neu, sobald Playwright vorhanden; mindestens Kernpfade).
6. **Bestehende Funktionalität** (Regression: Quiz-CRUD, Spielablauf, Reports, Auth).
7. **Berechtigungen** (Trainer/Admin/Spieler/Gast).
8. **Responsive** (≤480, 768, 1024, 1440, Beamer).
9. **Visuelle Prüfung** (alle vier Seiten + Beamer).
10. **`format:check`**.

**Regel:** Ein PR gilt **nicht** allein wegen grünem Build als fertig. Alle betroffenen
Bestandsfunktionen werden getestet.

**Hinweis zur Umgebung:** Die DB-gestützten Suiten brauchen eine echte PostgreSQL. Für lokale
Verifikation kann eine Test-DB bereitgestellt und `TEST_DATABASE_URL` gesetzt werden (die Suiten
überspringen sich sonst selbst). Das ist für jede Phase mit DB-Bezug erforderlich. In Phase 5b wurde
dies durchgeführt: **181/181 Tests grün**, damit ist R-1 entschärft.

---

## 18. Aufwandsschätzung (relativ, nicht in Tagen)

| Phase | Aufwand     | Begründung                                            |
| ----- | ----------- | ----------------------------------------------------- |
| 6.1   | mittel      | Tokens + Bausteine, additive CSS-Erweiterung          |
| 6.2   | mittel      | Navigation, Breakpoints, Rollenlogik                  |
| 6.3   | mittel      | Auth additiv, Sternenhimmel, Registrierung, Migration |
| 6.4   | mittel      | Editor-Features, Migration, R-3-Abhängigkeit          |
| 6.5   | mittel      | Admin/Host-UI                                         |
| 6.6   | mittel      | Profil, Statistik, Migration                          |
| 6.7   | **hoch**    | Katalog, Matrix, Rendering, Assets, Validierung       |
| 6.8   | mittel      | XP/Inventar/Erfolge, Anti-Manipulation                |
| 6.9   | **hoch**    | 13 Szenen, Animationen, Show-Token, Sicherheit        |
| 6.10  | niedrig     | Einbinden bereitgestellter Bilder                     |
| 6.11  | mittel      | Audio-Manager, Busse, Assets                          |
| 6.12  | mittel–hoch | je Umfang                                             |

**Gesamt:** Die Phasen 6.1–6.11 sind ein umfangreiches Vorhaben. Empfehlung: strikt sequenziell, mit
Freigabe-Gate nach jeder Phase, um Risiko klein zu halten (Briefing §53, Fehlerquelle 1).

---

## 19. Offene Entscheidungen, die Phasen blockieren

| #   | Entscheidung                              | Blockiert           |
| --- | ----------------------------------------- | ------------------- |
| 1   | Rolle `PLAYER` + Spielerkonto-Modell      | 6.3, 6.6, 6.7, 6.8  |
| 2   | R-3: Historieverlust beim Quiz-Bearbeiten | 6.4 (Autospeichern) |
| 3   | Charakter-Assets (Referenzdateien)        | 6.7, 6.9, 6.10      |
| 4   | Beamer-Surface + Show-Token               | 6.9, 6.10, 6.11     |
| 5   | Audio-Assets                              | 6.11                |
| 6   | Clock-Sync                                | 6.9                 |
| 7   | Redis-Adapter oder bewusst eine Instanz   | 6.12, Betrieb       |
| 8   | Pause/Überspringen                        | 6.5                 |
| 9   | XP-Werte/Levelschwellen/Erfolge           | 6.8                 |
| 10  | Katalog in `shared` oder DB               | 6.7, 6.8            |
| 11  | Sprache (Englisch/Deutsch)                | alle UI-Phasen      |
| 12  | IP-Speicherung (Q5)                       | 6.6                 |

---

## 20. Zusammenfassung

Der Plan folgt der vom Briefing vorgegebenen Reihenfolge (6.1–6.12) und stellt grundlegende Systeme
vor abhängige. Er hält den Bestandsschutz ein (keine Änderung an Fragen, Konten, Rollen,
Auth-Logik, API-Verträgen, Daten). Die drei größten Phasen (6.7 Avatar, 6.9 Beamer, 6.12
Erweiterungen) sind asset- bzw. entscheidungsabhängig und werden erst nach Freigabe und
Asset-Bereitstellung begonnen.

**Bereits erledigt (Phase 5b):** Logo/Favicon optimiert, verwaiste/tote Ressourcen entfernt,
Lasttest-Werkzeug, Testlage mit PostgreSQL verifiziert (181/181). Siehe §15.

**Kein Code im Sinne einer Phase-6-Funktion, keine Migration, kein Phase-6-Branch wurde erstellt.**
Die begrenzten ersten Arbeiten der Phase 5b sind bestandserhaltend und nehmen keinen
Produktentscheid vorweg.
