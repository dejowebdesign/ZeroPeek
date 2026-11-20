# Phase 3 – Technischer Umsetzungsplan (Roadmap)

**Projekt:** ZeroPeek
**Phase:** 3 – Technischer Umsetzungsplan
**Datum:** 2026-11-04
**Status:** Entwurf zur Prüfung durch den Projektverantwortlichen (Dejan Popovic)
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
10. **Nach dem PR anhalten**, bis der Projektverantwortliche merged oder weiter freigibt. Abhängigkeiten zwischen offenen
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

| Phase | Braucht zwingend                                                                                                   | Ohne das blockiert      |
| ----- | ------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 6.3   | Rolle `PLAYER`, Spielerkonto-Modell, E-Mail-Bestätigung                                                            | 6.6, 6.7, 6.8           |
| 6.4   | Quiz-Snapshot (verbindlich, §8.7)                                                                                  | Autospeichern, Reports  |
| 6.7   | Charakter-Assets: Ethan/Maya geliefert; Pixel, Biene, Dr. Obscura, O-Bots fehlen                                   | Avatar-Layer, 6.10      |
| 6.8   | Levelkurve + XP-Ledger; Gastkonto-Übernahme                                                                        | 6.8, 6.12               |
| 6.9   | Beamer-Grafiken (kombinierte Host-Ansicht bleibt)                                                                  | 6.10                    |
| 6.11  | **Audio-Assets des Projektverantwortlichen** – ein Stück geliefert (Fragemusik), SFX und übrige Musikstücke fehlen | nur die fehlenden Teile |
| 6.12  | Entscheidungen zu Modi/Redis                                                                                       | 6.12                    |

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

**Stand:** **6.2.1 (Navigation und Shell) ist umgesetzt und gemerged** (PR #21, `main` @ `030c771`) –
`packages/frontend/src/navigation.ts`, Shell-Tokens und Responsive-Verhalten; Arbeitsreferenz
`docs/design/design-system.md` §8.1. **6.2.2** ist in §3.1 abgegrenzt.

### 3.1 Phase 6.2.2 – Spieler-Lobby und Profil-Platzhalter

| Punkt                      | Inhalt                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Die bestehende Spieler-Lobby verständlicher und einheitlicher gestalten; den Nav-Bereich „Profil" erstmals mit einer **ehrlichen Platzhalterfläche** verbinden.                                                   |
| **Betroffene Komponenten** | `pages/player.ts`, `styles/tokens.css`, ggf. ein reiner, testbarer Builder                                                                                                                                        |
| **Betroffene Dateien**     | `packages/frontend/src/pages/player.ts`, `styles/tokens.css`, `design-system.test.ts`, neue Tests                                                                                                                 |
| **Datenmodelle**           | **keine**                                                                                                                                                                                                         |
| **API-Änderungen**         | **keine** (rein typbezogene Korrektur am geteilten `player:join`-Ack, siehe unten)                                                                                                                                |
| **Abhängigkeiten**         | 6.2.1                                                                                                                                                                                                             |
| **Risiken**                | Lobby darf den serverautoritativen Fluss (`game:state`) nicht stören; keine erfundenen Daten; Anzeige ≠ Berechtigung                                                                                              |
| **Teststrategie**          | Unit-Tests der neuen Lobby-/Platzhalterlogik; Design-System-Klassen-/Token-Guards; textbasierte Geometrieprüfung (390/768/1024/1280/1920)                                                                         |
| **Abnahmekriterien**       | Mitspieler sichtbar; vorhandene Verbindungszustände sichtbar; Status-/Feedbackmeldungen verbessert; Profil-Platzhalter eindeutig als „kommt mit 6.6" gekennzeichnet; kein Datenmodell/keine Migration; Gates grün |
| **Aufwand**                | klein bis mittel                                                                                                                                                                                                  |

**Umfang (verbindlich):**

- **Spieler-Lobby:** Anzeige der Mitspieler, soweit die vorhandenen Serverdaten dies zuverlässig
  zulassen (`game:state` liefert `PublicPlayer[]` mit `nickname`, `avatar`, `score`, `connected`);
  Anzeige bereits vorhandener Verbindungszustände; verbesserte Status- und Feedbackmeldungen;
  einheitliche Gestaltung nach dem Designsystem; responsive für Smartphone, Tablet und Desktop.
- **Profilbereich:** in 6.2.2 **kein** echtes Spielerprofil. Kein Profil-Datenmodell, keine
  Profil-API, keine Datenbankänderung. Stattdessen ein klar gekennzeichneter Platzhalter mit dem
  Hinweis **„Dein Spielerprofil kommt mit Phase 6.6."**, umgesetzt mit der bestehenden
  `emptyState`-Komponente, sofern technisch passend.

**Technische Grenzen (ausdrücklich nicht Teil von 6.2.2):** Spielerregistrierung/Login (6.3); neue
Rolle `PLAYER`; Profil-Datenmodell/-API; XP/Level/Fortschritt; Inventar/Avatarverwaltung;
Avatar-Auswahl oder neue Avatar-Grafiken; Änderungen an Datenbank/Prisma-Schema; Änderungen an
Spielablauf, Timer, Antworten oder Punkteberechnung; Änderungen an Socket.IO-Berechtigungen oder
Rollen; Änderungen an Host-/Beamer-Funktionen. Die bestehende Entscheidung, dass Gäste zunächst mit
einer Standardfigur **ohne** Avatar-Auswahl teilnehmen, bleibt unverändert; eine spätere Änderung
bräuchte einen eigenen Produktentscheid und eine vorherige Dokumentationsaktualisierung.

**Bekannte technische Punkte (Behandlung):**

| ID          | Befund                                                                                   | Behandlung in 6.2.2                                                                   |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **B-2**     | Gemeinsamer `player:join`-Ack-Typ enthält kein `token`, der Server gibt ihn aber zurück. | Korrektur **erlaubt**, sofern rein typbezogen und verhaltensneutral.                  |
| **B-3**     | `.join__feedback` hat keine passende CSS-Regel.                                          | Gestaltung darf ergänzt werden.                                                       |
| **B-4**     | Für `.question` fehlt eine passende CSS-Regel.                                           | Rein gestalterische Korrektur zulässig.                                               |
| **B-5**     | `pageHeader` ist nicht mehr in Verwendung.                                               | **Keine** Änderung in dieser Phase.                                                   |
| **B-6**     | `game:joined`, `game:error`, `host:error` deklariert, aber nicht emittiert.              | **Keine** Änderung in dieser Phase.                                                   |
| **B-7/R-5** | Wiederherstellung einer laufenden Frage nach Reconnect.                                  | **Keine** Änderung des Reconnect-Verhaltens; für eine spätere Bearbeitung vorgemerkt. |

**Bestandsschutz:** Keine Änderung an Fragen, Antworten, Konten, Rollen, Berechtigungen, Auth,
Socket.IO-Architektur, Spielphasen, Timern, Antwortverarbeitung, Punkteberechnung, XP/Level/Inventar,
Datenbank/Prisma-Schema oder Host-/Beamer-Funktionen. Keine neuen Abhängigkeiten. Die
Spielerstrecke bleibt serverautoritativ und funktioniert unverändert über `game:state`.

**Analyse:** `docs/analysis/phase-6-2-2-player-lobby-profile.md`.

---

## 4. Phase 6.3 – Login, Registrierung, Sternenhimmel

| Punkt                      | Inhalt                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ziel**                   | Animierter Sternenhimmel, Glas-Login, freiwillige Spielerregistrierung (verbindlich), Gastzugang unverändert.                                                                                                |
| **Betroffene Komponenten** | Login-Screen (`host.ts` heute), neue Registrierung, `tokens.css`, neue Sternenkomponente, Registrierungshinweise (Beitritt/Spielende)                                                                        |
| **Betroffene Dateien**     | `pages/host.ts` (Login), neue `pages/auth.ts`/`login`-Komponente, `styles/*`, neue `starfield.ts`                                                                                                            |
| **Datenmodelle**           | **`User.role` um `PLAYER` erweitern** (Enum-Migration); `User.emailVerifiedAt?`; ggf. `PlayerProfile` (siehe 6.6)                                                                                            |
| **API-Änderungen**         | **Neu:** `POST /api/auth/register` (Spieler), **E-Mail-Bestätigung** (`verify`). Bestehendes `login`/`logout`/`me` unverändert.                                                                              |
| **Abhängigkeiten**         | 6.1, 6.2; Rolle `PLAYER` (verbindlich)                                                                                                                                                                       |
| **Risiken**                | Bestehende Auth darf nicht verändert werden; Enum-Erweiterung muss additiv sein; Sternenhimmel-Performance                                                                                                   |
| **Teststrategie**          | Unit: Validierung (Passwort ≥ 10, E-Mail); Integration: Registrierung, E-Mail-Bestätigung, Login, CSRF; `prefers-reduced-motion`                                                                             |
| **Abnahmekriterien**       | Bestehende Konten funktionieren unverändert; Spieler können sich registrieren (mit Bestätigung); **Gastbeitritt sofort und ohne Konto**; Angebot beim Beitritt und nach Spielende; Sternenhimmel abschaltbar |
| **Aufwand**                | mittel                                                                                                                                                                                                       |

**Bestandsschutz:** Die vorhandene Auth-Logik (Argon2id, Sessions, CSRF, Guards) wird **nicht**
ersetzt. `register` ist **additiv**. Die Rolle `PLAYER` hat **keine** Admin-/Trainerrechte.

**Verbindlich (Phase 5c):** Registrierung ist **freiwillig** und wird beim **Beitritt** und nach
**Spielende** angeboten; sie darf den Gastbeitritt **nicht verzögern** (`game-design-concept.md`
§4.2).

### 4.1 Phase 6.3 – Vorbereitung: tatsächlich offene Punkte

Diese Zusammenstellung hält **nur** fest, was für die Umsetzung noch entschieden, konfiguriert oder
geliefert werden muss. Sie wiederholt die verbindlichen Entscheidungen aus Phase 5c **nicht**
(Registrierung freiwillig, Angebot beim Beitritt/nach Spielende, Gastzugang ohne Konto und ohne
E-Mail, bestehende Auth bleibt). Ebenso werden bestehende Architektur und Datenmodelle hier **nicht**
neu analysiert – siehe `docs/analysis/phase-1-technical-inventory.md`.

**Verbindlich bereits vorhanden (kein neuer Entscheid nötig):**

- Passwortregeln: **≥ 10 Zeichen** (`PASSWORD_MIN_LENGTH` in `packages/backend/src/auth.ts`;
  `game-design-concept.md` §4.3). Argon2id, Sessions und CSRF bleiben unverändert.
- Kontoanforderungen: E-Mail, Passwort, **E-Mail-Bestätigung**, Anzeigename.
- Rollen: `ADMIN`/`TRAINER` bleiben; `PLAYER` wird **additiv** ergänzt; `emailVerifiedAt?` ergänzt.
- Registrierungs-API: `POST /api/auth/register` + Verifizierung; `login`/`logout`/`me` unverändert.
- Bestehende E-Mail-Konfiguration: `SMTP_URL` und `MAIL_FROM` (bereits in `docs/deployment/ENVIRONMENT.md`
  und den `.env.*.example`-Dateien vorgesehen).

**Offen – Voraussetzungen, die Dejan Popovic bereitstellen oder entscheiden muss:**

| #   | Offener Punkt                                      | Status / Bedarf                                                                                                                                                                                                                                                                                                                                       | Blockiert         |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| V1  | **E-Mail-Versandweg**                              | Die vorhandene Konfiguration sieht **generisches SMTP** vor (`SMTP_URL`, `MAIL_FROM`). **Brevo ist im Repository nicht referenziert** – weder in Doku noch Code oder Konfiguration. Falls Brevo gewünscht ist: als SMTP-Relay (Brevo stellt SMTP-Zugang bereit) über die **vorhandenen** Variablen, oder als eigene HTTP-API mit **neuen** Variablen. | Versand (6.3)     |
| V2  | **Absenderadresse und Absendername**               | `MAIL_FROM` erfindet keine Adresse; eine echte, verifizierte Absenderadresse ist nötig. Brevo verlangt zusätzlich einen **verifizierten Absender**.                                                                                                                                                                                                   | Versand (6.3)     |
| V3  | **SMTP-/API-Zugangsdaten**                         | Host, Port, Benutzer, Passwort bzw. API-Key. **Ausschließlich** über Umgebungsvariablen, nie im Quellcode/Git.                                                                                                                                                                                                                                        | Versand (6.3)     |
| V4  | **Verifizierungslink-Gültigkeit**                  | Vorschlag zur Freigabe: **24 Stunden**, einmalige Verwendung. Ohne Festlegung wird dieser Wert angenommen.                                                                                                                                                                                                                                            | keine (Vorschlag) |
| V5  | **Verhalten bei bereits vergebener E-Mail**        | Vorschlag: generische Antwort (kein Konto-Enumeration-Leak) + Hinweis, sich anzumelden. Ohne Festlegung wird dieser Wert angenommen.                                                                                                                                                                                                                  | keine (Vorschlag) |
| V6  | **Verhalten nach erfolgreicher Registrierung**     | Vorschlag: Konto bleibt bis zur Bestätigung **unbestätigt**; Login erst nach Bestätigung (Ablehnung `email_unverified`). Ohne Festlegung wird dieser Wert angenommen.                                                                                                                                                                                 | keine (Vorschlag) |
| V7  | **Oberfläche für Registrierung und Verifizierung** | Wird in 6.3 als **eigene Auth-Seite** angelegt (Login, Registrierung, Bestätigungshinweis), damit der heutige Host-Login als Einstieg für Host/Admin unangetastet bleibt. Der verbindliche **Hinweis beim Spielbeitritt** und **nach Spielende** ist eine **kleine Ergänzung** der bestehenden Spieleroberfläche.                                     | keine (Vorschlag) |
| V8  | **Abschaltbarkeit des Sternenhimmels**             | Vorschlag: Standard **an**; `prefers-reduced-motion` reduziert Bewegung; zusätzlich eine **Nutzer-Einstellung** zum Abschalten.                                                                                                                                                                                                                       | keine (Vorschlag) |

> **Sternenhimmel (bereits entschieden):** CSS/SVG-basiert, **keine** WebGL-/3D-Engine,
> performance-bewusst, `prefers-reduced-motion` berücksichtigt, abschaltbar. Kein neuer Entscheid nötig.

**Umgesetzt in 6.3 (Teil B, additive Auth-Oberfläche):**

- **V4** – 24 h Gültigkeit, einmalige Verwendung (Token wird nach Nutzung gelöscht).
- **V5** – **generische Antwort**: eine bereits vergebene E-Mail wird **byte-identisch** wie eine
  frische Registrierung beantwortet (kein Konto-Enumeration-Leak). Der Antwortsatz hängt nur von der
  Serverkonfiguration ab, nicht vom Ergebnis des Versuchs; die Antwortzeit wird angeglichen
  (Argon2id-Hash auch im „bereits registriert"-Pfad).
- **V6** – unbestätigtes Konto bleibt gesperrt (`email_unverified` beim Login).
- **Sicherheit** – der Verifizierungslink wird **in keiner Umgebung** geloggt (ein Token im Log ist
  ein Zugangsdatum im Log); die Auth-Endpunkte haben zusätzlich strengere, pro Route gesetzte
  Ratenbegrenzungen (`AUTH_RATE_LIMITS`, Standard **an**).

**Nicht in 6.3 (bewusst später):** Konto-Übernahme nach Spielende und Übernahme einer laufenden
Runde gehören laut Roadmap §9.2 zu **6.8** (dort mit `Game.guestClaim`), nicht zu 6.3. Das
**Profilmodell** (`PlayerProfile`) gehört zu **6.6**.

**Ohne V1–V3 (Zugangsdaten) nicht abschließbar:** der tatsächliche E-Mail-Versand. Registrierung,
Validierung, Token-Erzeugung/-Prüfung und Rollenlogik sind davon unabhängig und können vorbereitet
werden; der Versand bleibt bis zur Bereitstellung der Zugangsdaten unvollständig.

---

## 5. Phase 6.4 – Quizverwaltung und Editor

| Punkt                      | Inhalt                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Modernisierte Verwaltung und Editor mit Drag-and-drop, Kategorien, Schwierigkeit, Vorschau; **Quiz-Snapshot je Spiel**.                                           |
| **Betroffene Komponenten** | `pages/editor.ts`, `questionForm.ts`, `questionView.ts`, `quizRoutes.ts`, `quizService.ts`, neue Snapshot-Logik                                                   |
| **Betroffene Dateien**     | `pages/editor.ts`, `questionForm.ts`, `styles/tokens.css`, `schema.prisma`, `mappers.ts`, `services/engine.ts`                                                    |
| **Datenmodelle**           | **Additiv:** `Quiz.category?`, `Quiz.difficulty?`, `Question.category?`/`difficulty?`; **Neu:** `GameSnapshot`                                                    |
| **API-Änderungen**         | Additive Felder in bestehenden Quiz-Endpunkten; Import/Export bleiben kompatibel                                                                                  |
| **Abhängigkeiten**         | 6.1, 6.2; **Quiz-Snapshot (verbindlich)**                                                                                                                         |
| **Risiken**                | **R-3 (Historieverlust)**; Drag-and-drop ohne Tastatur-Alternative (Barrierefreiheit); Import alter Dateien                                                       |
| **Teststrategie**          | Unit: Reihenfolge, Validierung; Integration: CRUD unverändert, 13 Typen lesbar; Import/Export-Rundlauf; Snapshot bleibt nach Quiz-Änderung/-Löschung unverändert  |
| **Abnahmekriterien**       | Bestehende Quizze unverändert lesbar/speicherbar; Import/Export funktioniert; Fragen/Antworten bleiben unverändert; **abgeschlossene Runden sind unveränderlich** |
| **Aufwand**                | mittel                                                                                                                                                            |

**Bestandsschutz (kritisch):** Fragen und Antworten bestehender Quizze werden **nicht** verändert.
Import/Export bleiben erhalten.

**Verbindlich (Phase 5c):** Beim Spielstart wird eine **unveränderliche Momentaufnahme** des Quiz
erstellt (`GameSnapshot`). Spätere Quizänderungen oder das Löschen eines Quiz dürfen **keine**
historischen Spielergebnisse verändern oder zerstören (`game-design-concept.md` §8.7). Damit ist
**R-3 technisch entschärft**. Autospeichern wird dadurch möglich, ohne die Historie zu gefährden.

**Status (umgesetzt):** `GameSnapshot` und die additiven Label-Felder sind implementiert, samt
Migration, Editor-UI und Tests. Report: `docs/reports/phase-6-4-quiz-editor-snapshot.md`.
`category`/`difficulty` sind **freier Text** (keine feste Taxonomie freigegeben); Drag-and-drop hat
mit den ↑/↓-Buttons eine Tastatur-Alternative. Offen für eine spätere Freigabe: feste Kategorien
und Schwierigkeitsstufen (Selects/Filter).

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

### 6.1 Phase 6.5.2 – Host-Steuerung und Phasenanzeige

**Stand:** umgesetzt (Branch `feat/phase-6-5-2-host-state-sync`, Report
`docs/reports/phase-6-5-2-host-state-sync.md`).

| Punkt                      | Inhalt                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Die Host-Konsole wird **servergeführt**: verbindlicher Phasenzustand, aus der Phase abgeleitete Steuerung, Verbindungsanzeige, Reconnect-Synchronisierung |
| **Betroffene Komponenten** | `packages/shared/src/events.ts`, `services/engine.ts`, `socket.ts`, `pages/host.ts`, neue `hostView.ts`, `styles/tokens.css`                              |
| **Datenmodelle**           | keine                                                                                                                                                     |
| **API-Änderungen**         | keine Route; `host:create`/`host:join` ACKen jetzt mit `HostState` (erweitert, nicht ersetzt)                                                             |
| **Abhängigkeiten**         | 6.1, 6.2, 6.5.1                                                                                                                                           |
| **Risiken**                | Phasen-Lock (PR #29) muss erhalten bleiben; Steuerung darf keine unerlaubte Aktion anbieten                                                               |
| **Teststrategie**          | Integration über echtes Socket.IO (A–E, H, I); Unit für die reinen Regeln (`hostView.test.ts`)                                                            |
| **Abnahmekriterien**       | Reload mitten im Spiel setzt die laufende Szene fort; keine doppelten Listener; Phase immer sichtbar; Punkte-Lock bleibt                                  |
| **Aufwand**                | klein–mittel                                                                                                                                              |

**Nicht Teil von 6.5.2:** Pause/Fortsetzen und Frage überspringen (6.5.3, eigene Freigabe).

### 6.2 Phase 6.5.3 – Erweiterte Host-Steuerung

**Stand:** umgesetzt (Branch `feat/phase-6-5-3-extended-host-controls`).

| Punkt                      | Inhalt                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ziel**                   | Laufende Frage **pausieren/fortsetzen** und **überspringen**; Spieler aus der Lobby entfernen; Spieler sehen, ob der Host erreichbar ist                                                                                                                                                                                                                                             |
| **Betroffene Komponenten** | `packages/shared/src/events.ts`, `services/engine.ts`, `socket.ts`, `hostView.ts`, `pages/host.ts`, `pages/player.ts`, `playerView.ts`, `styles/tokens.css`                                                                                                                                                                                                                          |
| **Datenmodelle**           | **keine** – `paused`/`resumed`/`skipped` werden als Zeilen im vorhandenen `GameEvent`-Log abgelegt (keine Migration)                                                                                                                                                                                                                                                                 |
| **API-Änderungen**         | neue Host-Events `host:pause`/`host:resume`/`host:skip` (ACK je Phase); neue Server-Events `host:paused`/`host:resumed`, `game:paused`/`game:resumed`, `game:kicked`; `PublicQuestion` + `paused`/`remainingMs`; `HostState`/`PlayerSync` + `paused`/`skipped`; `OwnResult.outcome` + `'skipped'`. `host:kick` bleibt unverändert (nur die Lobby-Prüfung und `game:kicked` sind neu) |
| **Abhängigkeiten**         | 6.5.2                                                                                                                                                                                                                                                                                                                                                                                |
| **Risiken**                | Phasen-Lock muss erhalten bleiben; Pause darf keinen Auto-Reveal mehr auslösen; Kick nur in der Lobby (kein Umbau einer laufenden Rangliste)                                                                                                                                                                                                                                         |
| **Teststrategie**          | Integration über echtes Socket.IO: `engine.integration.test.ts` (Block „pause / resume / skip“ + Slides) und `host-sync.integration.test.ts` (J–L, inkl. K2/K3); `snapshot.integration.test.ts` (Skip in Report/CSV/Statistik); Unit für `hostActions`/`revealBody` (`hostView.test.ts`) und die Host-Erreichbarkeit (`playerView.test.ts`)                                          |
| **Abnahmekriterien**       | Pause friert die Uhr serverseitig und überlebt einen Neustart; Fortsetzen läuft mit der Restzeit weiter; Skip **neutralisiert** die Frage (keine Lösung auf dem Draht, Punkte zurückgenommen, frühere Punkte unberührt); kein weiterer Punktgewinn nach dem Skip; Kick entfernt nur in der Lobby; Slide nicht pausierbar; Steuerung ist phasengerecht eingeschränkt                  |
| **Aufwand**                | mittel                                                                                                                                                                                                                                                                                                                                                                               |

**Entschieden (chrisB, 2026-11-07):** Ein **Skip neutralisiert** die Frage. Bereits vergebene
Punkte werden **zurückgenommen**, die Antworten bleiben gespeichert (auf null gesetzt) und die
korrekte Antwort wird entwertet; frühere Fragen bleiben unberührt. Der **Host erhält bei einem
Skip keine Lösung** auf dem Draht (`HostReveal`-Variante ohne Lösungsfeld), und ein **Slide
kann nicht pausiert** werden (keine Uhr). Alle drei Punkte sind damit geschlossen.

---

## 7. Phase 6.6 – Spielerprofile

| Punkt                      | Inhalt                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Dauerhaftes Spielerprofil mit Fortschritt und **persönlicher Statistik**.                                                                                                  |
| **Betroffene Komponenten** | neue `pages/profile.ts`, `PlayerProfile`-Modell, neue Service-/Route-Module                                                                                                |
| **Betroffene Dateien**     | `schema.prisma`, neue `services/profileService.ts`, neue `routes/profileRoutes.ts`, neue Seite                                                                             |
| **Datenmodelle**           | **Neu:** `PlayerProfile`; **Erweiterung:** `GamePlayer.userId?`                                                                                                            |
| **API-Änderungen**         | **Neu:** `GET /api/profile`, `PUT /api/profile` (Charakterwahl). **Kein** Spieler-Zugriff auf die Quizhistorie.                                                            |
| **Abhängigkeiten**         | 6.3 (Spielerkonto)                                                                                                                                                         |
| **Risiken**                | Profile dürfen keine XP vom Client annehmen; Fremdzugriff auf fremdes Profil verhindern                                                                                    |
| **Teststrategie**          | Integration: Profil nur für eigenen Nutzer; XP nur serverseitig; Unit: Statistikberechnung                                                                                 |
| **Abnahmekriterien**       | Profil zeigt korrekte, serverseitig berechnete Werte (inkl. gewonnene Spiele, Podiumsplätze, Trefferquote); keine Manipulation möglich; **keine Quizhistorie für Spieler** |
| **Aufwand**                | mittel                                                                                                                                                                     |

**Migration:** Additiv (`PlayerProfile` neu, `GamePlayer.userId` nullable). Keine bestehende Spalte
wird geändert. Bestehende `GamePlayer`-Zeilen bleiben ohne `userId` (Gast).

**Verbindlich (Phase 5c):** Die **persönliche Statistik** ist von der **Quizhistorie** getrennt. Die
Historie (alte Fragen/Antworten, Ergebnisse anderer) bleibt **ausschließlich Administratoren**
vorbehalten (`game-design-concept.md` §4.7). Ein früherer `GET /api/profile/history` entfällt.

### 7.1 Phase 6.6.3 – Trennung von Host- und Spieleridentität

| Punkt                      | Inhalt                                                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Host- und Spieleridentität sind **getrennte Kontexte**; ein im Browser angemeldeter Host wird nie zur Spieleridentität (und umgekehrt).                                                                                                                           |
| **Betroffene Komponenten** | `sessions.ts` (zwei Kontexte), neue `routes/playerAuthRoutes.ts`, `routes/profileRoutes.ts`, `socket.ts`, `pages/profile.ts`, Prisma `Session.kind`                                                                                                               |
| **Datenmodelle**           | **Erweiterung:** `Session.kind` (`host`/`player`, Default `host`). Rein additiv.                                                                                                                                                                                  |
| **API-Änderungen**         | **Neu:** `POST /api/player-auth/login`, `POST /api/player-auth/logout`, `GET /api/player-auth/me`. `GET/PUT /api/profile` nutzen jetzt den **Spieler**-Kontext. `POST /api/auth/login` vergibt den Kontext anhand der geprüften Rolle (Spieler ⇒ Spielerkontext). |
| **Cookies**                | Host: `zp_session` (unverändert). Spieler: `zp_player_session` (neu, `PLAYER_COOKIE_NAME`). Beide HttpOnly, SameSite=Lax, Path `/`.                                                                                                                               |
| **Abhängigkeiten**         | 6.6.1, 6.6.2 (Spielerprofil)                                                                                                                                                                                                                                      |
| **Risiken**                | Session-Verwechslung, CSRF über Kontexte hinweg, Bruch des Host-Logins oder der Gastteilnahme                                                                                                                                                                     |
| **Teststrategie**          | Neue Akzeptanzsuite `identity-separation.integration.test.ts` (T01–T20); Regression über alle Auth-/Profil-/Socket-Suiten                                                                                                                                         |
| **Abnahmekriterien**       | Host und Spieler funktionieren im selben Browser unabhängig; Gast ohne Konto; kein Host-Cookie verknüpft einen Sitz; Logout wirkt nur im eigenen Kontext; CSRF kontextgebunden                                                                                    |
| **Aufwand**                | mittel                                                                                                                                                                                                                                                            |

**Migration:** Additiv (`Session.kind` mit Default `host` + Index). Bestehende Sessions bleiben
gültig und werden als Host-Sessions gelesen.

**Nicht Teil von 6.6.3:** Gastkonto-Übernahme (6.8), Beamer, Game-Engine, Punkteberechnung,
GameSnapshot, IP-Erkennung.

---

## 8. Phase 6.7 – Blockwelt-Helden-Avatar-System

| Punkt                      | Inhalt                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Charakterauswahl und modularer Avatar-Editor mit **charakterexklusiven** Gegenständen und sichtbarer Ausrüstung.                                                                               |
| **Betroffene Komponenten** | `shared`-Katalog, `services/profileService.ts`, `routes/profileRoutes.ts`, `pages/profile.ts`, neue `avatar.ts`, `styles/tokens.css`                                                           |
| **Betroffene Dateien**     | `packages/shared/src/characters.ts` (neu), `packages/shared/src/cosmetics.ts` (neu), `packages/frontend/src/avatar.ts` (neu), `pages/profile.ts`, Migration                                    |
| **Datenmodelle**           | `PlayerProfile.selectedCharacterId` (Bestand), **neu** `PlayerProfile.avatarConfig` (JSONB, nullable)                                                                                          |
| **API-Änderungen**         | `PUT /api/profile/avatar` (serverseitig validiert gegen den **charakterexklusiven** Katalog); `GET/PUT /api/profile` liefern `avatarConfig` mit                                                |
| **Abhängigkeiten**         | **Charakter-Assets des Projektverantwortlichen** (für Ethan/Maya geliefert), 6.6                                                                                                               |
| **Risiken**                | Fehlende Assets blockieren; falsche Kombinationen; Schärfe auf Mobil; fehlende Layer pro Gegenstand                                                                                            |
| **Teststrategie**          | Unit: Katalog je Charakter, Ablehnung fremder Gegenstände, Default-Kit; Integration: Avatar-Speicherung serverseitig validiert; Frontend: Editor, nur eigene Gegenstände; Designsystem-Vertrag |
| **Abnahmekriterien**       | Gegenstände sind **nur dem vorgesehenen Charakter** zugeordnet; serverseitig validiert; Avatarwechsel löscht nichts; keine erfundenen Koordinaten                                              |
| **Aufwand**                | hoch                                                                                                                                                                                           |

**Status: umgesetzt und gemergt (PR #38 `887efc1`, PR #39 `befe52d`).** Die Grafikdateien für **Ethan** und **Maya** wurden vom
Projektverantwortlichen geliefert (ZIP, sieben WebP je Figur) und **unverändert** nach
`packages/frontend/public/characters/<id>/` kopiert (byte-identisch geprüft, Alpha erhalten). Der
Avatar-Katalog ist **Code** (`shared`), nicht Datenbank: die Datenbank speichert nur **Besitz/Zustand**
(`PlayerProfile.avatarConfig`). Die Migration ist **rein additiv** (eine nullable JSONB-Spalte).

**Offen – Layerdarstellung:** Die gelieferten Einzel-Grafiken sind **nicht** auf eine gemeinsame
Zeichenfläche ausgerichtet (die Metadaten des Verantwortlichen melden `not_defined`/`not_validated`).
Deshalb wird **keine** Position/Skalierung/Ebenenreihenfolge erfunden: der Katalog markiert jeden
Gegenstand als `alignment: 'not_aligned'`, und die Vorschau zeigt die **gelieferte** Figur plus die
ausgerüsteten Gegenstände als eigene Thumbnails. Sobald die ausgerichteten Layer vorliegen, wird nur
`packages/frontend/src/avatar.ts` erweitert (`layerGeometry` → echte Stapelung).

**Verbindlich (Phase 5c):** **Jeder Avatar besitzt seine eigenen Gegenstände** (kein allgemeiner
Katalog). Ein Gegenstand ist **charakterexklusiv** und wird auf einem anderen Avatar **gar nicht
angeboten**. Keine Neugestaltung der Figuren.

**Weitere Figuren:** `pixel`, `bee`, `dr-obscura`, `o-bot` bleiben im Katalog der Charakterauswahl,
haben aber **noch keine Assets** und werden als `awaiting_assets` gemeldet; für sie wird **kein**
Avatar gezeichnet und **kein** Ersatzbild erzeugt.

---

## 9. Phase 6.8 – Inventar, XP, Level, Belohnungen und Gastkonto-Übernahme

| Punkt                      | Inhalt                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Inventar, XP/Level, Erfolge, Freischaltungen und **Gastkonto-Übernahme** – alles serverseitig und manipulationssicher.                                                                                                           |
| **Betroffene Komponenten** | neue `pages/inventory.ts` (Inventar + Erfolge), `services/progressionService.ts`, `services/claimService.ts`, Socket-Haken am `ended`, Claim-Endpunkte (siehe Bericht Phase 6.8)                                                 |
| **Betroffene Dateien**     | `schema.prisma`, neue Services/Routen, `socket.ts` (nur Haken am `ended`), `shared`-Levelkurve/Erfolge, `pages/profile.ts` (XP/Level/Erfolge + Übernahmeangebot)                                                                 |
| **Datenmodelle**           | **Neu:** `PlayerInventory`, `PlayerAchievement`, `XpLedger`, `Game.guestClaim`; **Erweiterung:** `GamePlayer.userId?`                                                                                                            |
| **API-Änderungen**         | **Neu:** `GET /api/progress`, `GET /api/inventory`, `POST /api/inventory/equip`, `GET /api/achievements`, `POST /api/guest-claim/status`, `POST /api/guest-claim` (alle nur mit Spielersitzung)                                  |
| **Abhängigkeiten**         | 6.6, 6.7; Levelkurve + XP-Ledger; Anti-Manipulations-Entscheidungen                                                                                                                                                              |
| **Risiken**                | Doppelte XP-Vergabe, doppeltes Einlösen, manipulierte Bedingungen, **doppelte/fremde Gastübernahme**, Gleichstand                                                                                                                |
| **Teststrategie**          | Integration: XP genau einmal je Spiel; Erfolg genau einmal; `@@unique` verhindert Doppelbesitz; **Übernahme nur einmal und nur für den Berechtigten**; mehrere Levelaufstiege aus einer Gutschrift; Gleichstand → gleicher Bonus |
| **Abnahmekriterien**       | XP/Inventar nur serverseitig; idempotent; keine Client-Schreibpfade; Gastübernahme einmalig und sicher; Levelkurve korrekt                                                                                                       |
| **Aufwand**                | mittel bis hoch (Übernahme ist der riskanteste Teil)                                                                                                                                                                             |

**Bestandsschutz:** Die Punktevergabe im Spiel bleibt unverändert. XP ist ein **zusätzlicher**
Vorgang beim Spielende, in einer Transaktion.

**Umsetzungsstand (Bericht `docs/reports/phase-6-8-player-progression.md`):**

- **6.8.1** – Registrierung/parallele Sitzungen (Frontend-Fix, Commit `8ad5d8e`).
- **6.8.3** – Levelkurve (`shared`), `XpLedger`, `PlayerInventory`, `PlayerAchievement`, `Game.guestClaim`,
  Migration `20261111130000_phase_6_8_player_progression` (rein additiv), `progressionService`,
  `GET /api/progress|inventory|achievements`, `POST /api/inventory/equip`, Haken am `ended`.
- **6.8.2** – Gastkonto-Übernahme: `claimService`, `POST /api/guest-claim/status|guest-claim`,
  `game:claimable`-Socket-Ereignis (nur an den Gast selbst).
- **6.8.4** – Fortschritt, Inventar und Spielpräsentation: neue **Levelkurve** §9.1, **slot-basierte
  Belohnungsmatrix** (`shared/levelRewards.ts`), **Abgleich** der Levelbelohnungen
  (`reconcileLevelRewards`), `POST /api/inventory/unequip`, Ausrüstungsverwaltung vom Profil ins
  Inventar verschoben, Charakterkopf-Ausschnitt in der Spiel-/Beamer-Darstellung, Ganzfigur auf dem
  Siegerpodium.
- **Frontend** – `pages/profile.ts` (XP/Level/Erfolge + Übernahmeangebot, ohne Ausrüstungseditor),
  neue `pages/inventory.ts` (+ `inventory.html`, Navigationseintrag „Inventory" verlinkt, Ausrüsten
  **und** Ablegen), `claim.ts` (lokaler Nachweis), `avatar.ts` (`playerBadge`, Kopf-/Ganzfigur),
  `showView.ts` (Kopf-Ausschnitt in Ranglisten).
- **Offen (Produktentscheidung):** Belohnungsmatrix ab **Level 7**, weitere Charaktere (Pixel, Biene,
  Dr. Obscura, O-Bot) und die **Erfolgsnamen/-bedingungen**. Level 7+ vergibt derzeit **nichts** und
  blockiert weder XP noch Levelberechnung; ein gesperrter Gegenstand meldet seinen Freischaltlevel
  oder ehrlich „Bedingung noch nicht definiert" (kein erfundenes Asset, kein erfundener Text).

### 9.1 Verbindliche XP-Regeln (Phase 6.8.4)

- **XP = erreichte Spielpunkte.** Keine zweite XP-Formel; das bestehende Punktesystem bleibt
  maßgeblich (`game-design-concept.md` §5.2).
- **Platzierungsbonus** zusätzlich: 1. Platz **1.500**, 2. Platz **1.000**, 3. Platz **500** XP.
  Wird **nach** Feststellung der endgültigen Platzierung gutgeschrieben und **nicht** in die
  Spielwertung eingerechnet (`game-design-concept.md` §5.3).
- **Gleichstand:** Alle gleichplatzierten Spieler erhalten **denselben** Bonus. Die bestehende
  Ranglistenlogik ist darauf zu **prüfen und zu dokumentieren** (kein willkürlicher Tiebreak).
- **Levelkurve (zentral in `shared`, Phase 6.8.4):** `requiredXp(level) = 100.000 + (level − 1) × 10.000`;
  Level 1 = 0 XP, Aufstieg 1 → 2 = 100.000, 2 → 3 = 110.000, 3 → 4 = 120.000 usw.
  Eine Gutschrift kann **mehrere** Level überspringen; **alle** erreichten Level und Belohnungen
  müssen berücksichtigt werden (`game-design-concept.md` §5.4).
- **XP bleiben bei einer Kurvenänderung erhalten:** `PlayerProfile.xp` ist die Wahrheit, das Level
  wird bei jedem Lesen daraus abgeleitet und die `level`-Spalte korrigiert. Eine teurere Kurve kann
  das angezeigte Level senken – **kein** XP-Verlust, **keine** Verdopplung.
- **Ledger-Idempotenz:** `XpLedger` mit `@@unique([userId, gameId, reason])`; eine erneute
  Verarbeitung desselben Spielabschlusses erzeugt **keine** weiteren XP.
- **Belohnungsmatrix (Phase 6.8.4):** slot-basiert, `LEVEL_REWARDS` in `shared/levelRewards.ts`
  (`game-design-concept.md` §6.2b/§6.6). Level 1 ohne Ausrüstung; Level 2–6 = Outfit, Rucksack,
  Halskette, Visier, Armband; Level 7+ noch offen. Abgleich (`reconcileLevelRewards`) hält bestehende
  Konten und Charakterwechsel idempotent korrekt.

### 9.2 Gastkonto-Übernahme (verbindlich, Phase 5c)

- **Nach Spielende:** Ein Gast, der ein Konto erstellt, kann die **gerade abgeschlossene** Runde
  übernehmen (Punkte, Platzierungsbonus, XP, Platzierung, richtige/beantwortete Fragen, Statistik).
  Nur nach **ausdrücklicher Zustimmung**.
- **Während einer Runde:** Registrierung verknüpft die bestehende Teilnahme direkt; Spielplatz,
  Antworten, Punktestand und Rundenbindung bleiben erhalten; **keine** doppelte Spieleridentität.
- **Sicherheit:** kurzlebiger, einmaliger **Übernahmenachweis** (`Game.guestClaim` mit `expiresAt`
  und `usedAt`), serverseitig geprüft, an Session **und** Runde gebunden; keine Übernahme fremder
  Sessions; keine doppelte Gutschrift.
- **Abgrenzung:** Nur die **gerade abgeschlossene** Runde; **keine** unbegrenzte nachträgliche
  Übertragung früherer Gastspiele (`game-design-concept.md` §4.4).

### 9.3 Uhrensynchronisation und Socket-Rate-Limiting (Phase 6.8.5)

Zwei unabhängige Härtungspunkte, umgesetzt ohne Schemaänderung und ohne neue
Laufzeitabhängigkeit.

- **Uhrzeit-Abgleich:** Der Countdown wird aus dem **Server**-`openedAt` gezeichnet, der Client
  vergleicht das aber mit seiner eigenen Uhr. Ein kurzer Ping/Pong-Umlauf (`clock:ping` /
  `clock:pong`, beide Namespaces) misst den Offset; die reine Mathematik liegt in
  `shared/clock.ts` (NTP-Modell, bestes von `CLOCK_SAMPLE_COUNT = 5` Proben, verwertbar bis
  `CLOCK_MAX_ROUND_TRIP_MS = 2000`). Der Client (`frontend/clockSync.ts`) misst mit
  `performance.now()` und zeichnet den Countdown über `serverNow()`.
- **Der Server bleibt maßgeblich:** Der Offset ändert nur die **Anzeige**, nie die
  Antwortfrist; ein zu spät gesendeter zweiter Versuch wird weiterhin serverseitig abgelehnt.
- **Rate-Limiting:** In-Memory-Token-Bucket (`backend/socketRateLimit.ts`) für die drei
  Spielereignisse, die den HTTP-Limiter umgehen (`player:join`, `player:rejoin`,
  `player:answer`). Schlüssel ist ausschließlich eine **serverseitige** Identität (Socket-Id vor
  dem Sitzplatz, danach die vergebene `playerId`) – niemals ein Client-Feld. Eine Ablehnung
  berührt keinen Zustand.
- **Schalter:** `SOCKET_RATE_LIMITS` (Standard an; im Test aus, sofern nicht gesetzt), analog zu
  `AUTH_RATE_LIMITS`.
- **Nicht Teil dieser Phase:** kein getrennter Beamer-Zugang, keine Änderung an Wertung,
  Levelkurve oder Datenmodell, kein Redis.

Report: `docs/reports/phase-6-8-5-clock-sync-and-socket-rate-limit.md`.

### 9.4 Serverzustände und Event-Verträge der Show (Phase 6.9.1)

Das Fundament des Game-Show-Modus: die echte `lead`-Phase, die optionalen Frage-Labels und die
Punkte-/Rangdeltas. **Additiv, ohne Schemaänderung, ohne neue Abhängigkeit.**

- **`lead`-Phase (echt, serverseitig):** `start` wechselt in `lead` und öffnet erst nach dem
  Countdown die erste Frage. Fenster fest (`LEAD_SECONDS = 5`); der Server besitzt Übergang und
  Timing, der Client zeichnet nur. Eigener Timer über das bestehende `game.timer`.
- **Wiederverwendung der Uhrsynchronisation (6.8.5):** Der Countdown wird aus den
  Server-`startedAt`/`endsAt` gegen `clock.serverNow()` gezeichnet — **keine** zweite
  Uhrensynchronisation.
- **Recovery (R11):** Eine beim Neustart offene `lead`-Phase armt ihren Timer über das persistierte
  `endsAt` **für die Restzeit** neu (kein Neustart bei voller Fensterlänge); ein bereits abgelaufenes
  Fenster schaltet sofort weiter.
- **Countdown überspringen:** Host-Befehl `host:skipLead`, **nur** in `lead`; ein doppelter Aufruf
  ist ein No-op. `advanceFromLead` und `skipLead` laufen unter der Phasensperre, sodass genau
  **eine** Frage geöffnet wird.
- **Frage-Labels:** `PublicQuestion` trägt optional `category`/`difficulty` — Anzeigemetadaten,
  **kein** Lösungsfeld; sie werden erst mit der Frage gesendet, nie die Lösung vor dem Reveal.
- **Punkte-/Rangdeltas:** `host:reveal` trägt `points`, `host:board` trägt `ranks`. Beide werden
  aus den persistierten `playerAnswer`-Zeilen gelesen (idempotent, nur lesend), sind reine
  **Darstellung** und nie eine Punktequelle; die absoluten Werte bleiben maßgeblich.
- **Rate-Limit (R9):** `host:skipLead` ist ein **Host**-Befehl (sitzungsgeschützt wie `host:skip`);
  das neue Spieler-Ereignis `game:lead` ist ausschließlich Server→Client, also wurde **kein** neuer
  client-erreichbarer Spielereignispfad eingeführt.
- **Nicht Teil dieser Phase:** keine Show-Szene, kein Hintergrundbild, keine neue CSS, keine
  Schemaänderung, keine Migration.

Report: `docs/reports/phase-6-9-1-server-show-state.md`.

**Status: umgesetzt und gemergt (PR #47, Merge `31a7783`).**

### 9.5 Szenen-Grundgerüst und Szenensteuerung der Show (Phase 6.9.2)

Das Grundgerüst der 13 Show-Szenen und ihre Steuerung — **rein clientseitig**, additiv, ohne
Server-, Vertrags- oder Schemaänderung. Baut unmittelbar auf 6.9.1 auf.

- **Kombinierte Ansicht bleibt:** Der Beamer ist weiterhin die Host-Seite (`pages/host.ts`); es
  entsteht **keine** zweite Oberfläche, kein Show-Token, keine zweite Engine.
- **Szenenmodell (`showScenes.ts`, rein/testbar):** 13 Szenen mit `order`, `phase`, `mode`,
  `requires`, `transitions`; `ENTRY_SCENE` (Phase → Einstiegsszene); Zugriffsfunktionen.
- **Server bleibt maßgeblich:** Die Szene wird über den bestehenden `hostScreen`-Selektor aus der
  autoritativen Phase abgeleitet — inklusive dessen sicherer Fallbacks. Der Client erfindet keine
  Phase.
- **`ShowController`:** faltet den Zustand in die aktuelle Szene (`sync`) und ignoriert einen
  **veralteten** Zustand (älteres `at`), damit ein spätes Ereignis die Show nie zurückspringen
  lässt. Die Szene ist **rein darstellend**: sie wird bei jedem `sync` neu aus der autoritativen
  Phase abgeleitet (Einstiegsszene der Phase), also **keine** manuelle Szenen-Navigation. **Keine**
  Methode, die wertet, antwortet oder eine Phase ändert.
- **Szenenleiste + Präsentationsmodus:** Anzeige der Szene und Präsentations-Umschalter (keine
  Darstellungs-Schritte); der Präsentationsmodus **blendet** die Host-Steuerung aus (entfernt sie
  nicht), sodass der Beamer eine ruhige Bühne zeigt.
  **Überholt durch 6.9.3:** Szenenleiste und Präsentationsmodus wurden wieder **entfernt**; es gibt
  nur noch **eine** Host-/Beamer-Ansicht ohne Umschalter (siehe §9.6).
- **Korrektur (2026-11-17):** Die manuelle Szenen-Navigation der Szenenleiste wurde entfernt
  (die Szene folgt ausschließlich der Serverphase), und ein idempotenter Phasenbefehl (`reveal`/
  `board`) löscht nicht mehr den Auto-Advance-Timer — sonst konnte das Spiel auf Rangliste/
  Auflösung hängen bleiben.
- **Lobby als drei Szenen:** `welcome`, `join` (PIN + Kick-Liste, unveränderte Markup) und
  `participants` (Charakter-Raster). Frage-/Auflösungs-/Rang-/Podium-Szenen betonen jeweils einen
  anderen Teil derselben Serverdaten.
- **Kein Bild, kein Ton, keine Migration:** Der vorhandene CSS-Wireframe-Hintergrund trägt die
  Szenen; Hintergrundbilder bleiben Block D (6.10), Sound bleibt 6.11.

Report: `docs/reports/phase-6-9-2-game-show-skeleton.md`.

**Status: umgesetzt und gemergt (PR #48, Merge `9d9cde2`; Flow-Fixes PR #49, Merge `e3bf47d`).**

### 9.6 Korrektur der Host-Steuerung und optionaler AUTO-Betrieb (Phase 6.9.3)

Vereinfachung des Show-Betriebs auf **eine** Host-/Beamer-Ansicht ohne separaten
Präsentationsmodus und ohne manuelle Szenen-Navigation. Rein additiv auf der bestehenden
Host-Seite; der Server bleibt für alles Spielrelevante maßgeblich.

- **Kein Präsentationsmodus, keine Szenenleiste:** Der `Presentation mode`-Umschalter, die
  Szenenleiste (`Scene n of 13`) und die CSS-Klassen `.show-presentation`, `.show__present`,
  `.show__scene-bar`, `.show__scene-label` werden entfernt. Die Szene bleibt **rein intern** und
  wird weiterhin aus der autoritativen Phase abgeleitet; es gibt **keine** Szenen-Navigation. Der
  Host steuert das Spiel aus einer einzigen Ansicht.
- **AUTO-Umschalter (Standard: Aus):** Ein neuer Umschalter `AUTO` steuert, ob der Server die
  **zwei** AUTO-Übergänge selbst ausführt — die **Antwortauflösung** (Frage → Auflösung) und den
  **Ranglisten-Übergang** (Rangliste → nächste Frage). **Standard ist immer AUS** (manuell): der
  Host löst die Antworten selbst auf (`host:reveal`) und startet die nächste Frage selbst
  (`host:next`). Das **Auflösungsfenster** (Auflösung → Rangliste, `REVEAL_MS`) läuft in **beiden**
  Modi automatisch.
- **Server-autoritativ und persistent:** Neuer Host-Befehl `host:auto` (`{ gameId, auto }` →
  `{ auto }`), autorisiert über `assertHost`, mit `auto`-Validierung (echter Boolean). Der Wert
  wird über das **bestehende** Event-Log (`auto`-Event) persistiert — **keine** Schemaänderung,
  **keine** Migration. Ein Neustart setzt den Modus exakt fort. Der Wert ist Teil von `HostState`
  (`auto`), sodass ein Reload/Reconnect den Modus wiederherstellt. Neues Host-Event `host:auto`
  (nur an Host-Sockets) hält zweite Host-Tabs synchron.
- **Kein Nachladen, kein Überspringen:** Das Umschalten löst **keine** laufende Runde neu auf und
  überspringt **keine** Frage. Ausschalten verwirft nur einen anstehenden AUTO-Übergang; jede
  Transition bleibt durch den Phasen-Wächter des Ziels abgesichert.
- **Antwortuhr läuft unabhängig von AUTO:** Die **Antwortuhr** ist die serverseitige Frist der
  laufenden Frage, abgeleitet aus `openedAt` und `limitMs(question)` (`timeLimit · 1000 +
ANSWER_GRACE_MS`; seit Phase 6.9.5 ohne die Kulanzfrist, also `timeLimit · 1000`); sie ist die
  einzige Quelle der Wahrheit und läuft **immer**, in beiden Modi.
  AUTO steuert nur den **Timer** (den geplanten automatischen Übergang), **nie** die Uhr. `setAuto`
  stoppt, setzt oder verschiebt die Uhr **nicht**; die Endzeit bleibt unverändert. Mit AUTO AUS
  bleiben die Timer einfach unbestellt, die Uhr läuft weiter und die Frage wartet nach Ablauf auf
  den Host (`host:reveal`).
- **Umschalten mitten in der Runde:** Ein → Aus stoppt den anstehenden AUTO-Übergang (Antwort-Timer
  bzw. Ranglisten-Übergang), **nicht** aber das feste Auflösungsfenster. Aus → Ein holt den
  aktuellen Zustand nach: ist die Antwortzeit schon abgelaufen oder haben alle Spieler geantwortet,
  wird sofort aufgelöst; sonst wird der Antwort-Timer für die **Restzeit bis zur ursprünglichen
  Endzeit** gestellt. `REVEAL_MS` 6000 → **4000**, `BOARD_MS` 6000 → **5000**.
- **Ein Timer-Slot (Korrektur):** Der Runtime-Speicher hat genau einen `game.timer`. Jeder
  Arm-Helfer leert ihn zuerst und armiert nur in seiner Phase — `armBoardAdvance` ausschließlich in
  der **Ranglisten**-Phase. Ohne diesen Phasen-Wächter hätte `setAuto(true)` während einer laufenden
  Frage einen Ranglisten-Timer über den Antwort-Timer gelegt, den Antwort-Timer verwaist und ihn
  nach dem Ausschalten trotzdem ausgelöst (verletzt „AUTO AUS ⇒ keine automatische Auflösung“).
  Behoben; siehe Report §3.2 und §9.
- **Fragezeit und Start-Countdown bleiben unberührt:** Der Antwort-Timer und der Start-Countdown
  sind **keine** AUTO-Übergänge und laufen immer; AUTO steuert nur die zwei genannten Übergänge.
- **Wiederverwendung:** Der Umschalter nutzt die vorhandenen Button-Varianten und ein neues
  `.show__auto`-Layout aus bestehenden Tokens — **keine** neue Farbe, **keine** neue Komponente.

Report: `docs/reports/phase-6-9-3-host-auto-control.md`.

**Status: umgesetzt und gemergt (PR #50, Merge `30e286e`).**

### 9.7 Korrektur: Bestätigungsdialog und Next-Schaltfläche der Host-Steuerung

Zwei Fehler aus dem Praxistest der Phase 6.9.3, beide rein in der Host-Steuerung. Rein additiv
auf dem bestehenden Event; **keine** Schemaänderung, **keine** Migration, **keine** Spielregel
geändert.

- **Bestätigung wurde umgangen (Skip/Ende):** `hostButton()` band den Befehl bereits über den
  `onClick` (`el()` nutzt `addEventListener`). `controlsFor()` legte danach einen **zweiten**
  Handler per `node.onclick` darüber, der nur den Dialog öffnete. Beide liefen: der Befehl wurde
  **sofort** gesendet **und** der Dialog öffnete sich — „Abbrechen“ konnte das Senden nicht mehr
  zurücknehmen. Behoben: `hostButton()` erhält ein optionales `confirm`; ist es gesetzt, ist das
  Öffnen des Dialogs die **einzige** Klick-Aktion, und der Befehl wird erst aus `onConfirm`
  gesendet. Der Befehl und der Dialog können sich damit nicht mehr doppelt auslösen.
- **Next-Schaltfläche unzuverlässig:** Die Rangliste zeigte **immer** „Next question“, auch auf der
  **letzten** Rangliste, wo der nächste Klick das Spiel beendet. Der Client hatte keine Information,
  um „weitere Frage vorhanden“ von „letzte Frage“ zu unterscheiden. Behoben: neues, serverseitig
  abgeleitetes `hasNext` in `HostState` und im `host:board`-Ereignis; `hostActions()` lässt `next`
  nur bei `hasNext` zu. Ein Reload/Reconnect auf der Rangliste stellt damit exakt die richtigen
  Schaltflächen wieder her.
- **Anzeige ist keine Sicherheitsgrenze:** Das Ausblenden von `next` schützt nichts; `engine.next`
  weist jede nicht-`board`-Phase weiterhin zurück.

Report: `docs/reports/host-next-and-confirmation-fix.md`.

**Status: umgesetzt und gemergt (Phase 6.9.4, PR #51, Merge `0d9b8f9`).**

### 9.8 Korrektur: Antwortfrist deckungsgleich mit der sichtbaren Uhr (Phase 6.9.5)

Ein Fehler aus dem Praxistest: der Server nahm Antworten noch **1,5 s nach** dem sichtbaren
Nullpunkt an. Rein additiv auf dem bestehenden Vertrag; **keine** Schemaänderung, **keine**
Migration, **kein** Punktwert geändert.

- **Versteckte Kulanzfrist:** `limitMs()` in `engine.ts` addierte `ANSWER_GRACE_MS = 1500` zur
  sichtbaren Grenze, und der Spät-Guard verglich mit `>`. Die Uhr im Client zählt dagegen exakt
  `timeLimit` Sekunden ab `openedAt`; bei `0s` war die Frage serverseitig noch offen. Behoben:
  `limitMs()` = sichtbare Grenze, Konstante entfernt, Vergleich `>=`. Ein Wert versorgt Uhr, Guard,
  Pause/Resume und Neustart, daher sind alle vier nun deckungsgleich.
- **Spielersteuerung:** Die Spieleransicht zeigt keine Uhr, also blieben die Antwortknöpfe gegen
  eine geschlossene Frage klickbar. Neu: `answerDeadlineRemainingMs()` (rein, getestet) und ein
  Schließ-Timer in `showQuestion()`, der am selben Instant deaktiviert und „Time is up.“ zeigt.
  Bei `game:resumed` wird `openedAt` auf den Rest neu verankert.
- **Kein Punkte-Einfluss:** Der Geschwindigkeitsbonus rechnet mit `elapsedMs` gegen
  `question.timeLimit` (`shared/scoring.ts`), nie mit `limitMs()`.
- **Next-Schaltfläche (Phase 6.9.4):** nicht reproduziert. Der Fix (PR #51, `hasNext`) ist in
  `main` und im laufenden Bundle nachweislich enthalten; vermutete Ursache ist ein Browser-Cache
  (kein `Cache-Control` im Frontend-Caddyfile). Kein Code geändert.

Report: `docs/reports/phase-6-9-5-answer-deadline-and-host-next.md`.

**Status: umgesetzt und gemergt (PR #52, Merge `18e271f`).**

---

## 10. Phase 6.9 – Game-Show-Modus (in der bestehenden Host-Ansicht)

**Status: umgesetzt und vollständig gemergt (6.9.1–6.9.5).** 6.9.1 PR #47 (`31a7783`), 6.9.2
PR #48 (`9d9cde2`) + Flow-Fixes PR #49 (`e3bf47d`), 6.9.3 PR #50 (`30e286e`), 6.9.4 PR #51
(`0d9b8f9`), 6.9.5 PR #52 (`18e271f`). Stand `main`: `18e271f`.

**Verbindlich:** Die bestehende **kombinierte Host-/Beamer-Ansicht bleibt erhalten.** Es wird
**keine** separate Beamer-Surface und **keine** eigene Route eingeführt. Ein Show-Token ist **nicht
geplant** und wird nur bei nachgewiesener technischer Notwendigkeit weiterverfolgt.

| Punkt                      | Inhalt                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | 13 Show-Szenen innerhalb der bestehenden Host-Seite (`/host.html`).                                         |
| **Betroffene Komponenten** | `pages/host.ts`, Show-Szenen, Animationen, Trennung von Steuerung und Anzeige                               |
| **Betroffene Dateien**     | `packages/frontend/src/pages/host.ts`, `styles/*`; **kein** neuer Vite-Eintrag nötig                        |
| **Datenmodelle**           | keine                                                                                                       |
| **API-Änderungen**         | keine (dieselben Socket-Ereignisse; **kein** Show-Token)                                                    |
| **Abhängigkeiten**         | 6.7 (Charaktere), Beamer-Grafiken (6.10)                                                                    |
| **Risiken**                | Performance der Animationen; Lesbarkeit aus Distanz; Steuerung darf die Anzeige nicht stören                |
| **Teststrategie**          | Manuelle Show-Prüfung bei 1280×720/1920×1080/2560×1440; keine Doppel-Effekte; Steuerleiste ein-/ausblendbar |
| **Abnahmekriterien**       | Alle 13 Szenen korrekt; Frage/Antworten immer im Vordergrund; Host kann weiter steuern                      |
| **Aufwand**                | hoch                                                                                                        |

**Bestandsschutz:** Die Host-Steuerung bleibt; die Show-Szenen sind **zusätzlich**. Es wird **keine**
zweite Oberfläche eingeführt. Sicherheitsfragen eines separaten Beamer-Zugangs entfallen damit.

---

## 11. Phase 6.10 – Hintergrundbilder

**Status: umgesetzt und gemergt (PR #54, Merge `ad935fa`).** Deployment liegt beim
Projektverantwortlichen. Die zehn gelieferten WebP-Dateien sind byte-identisch eingebunden;
Auswahl und Zufall liegen beim Server. Report: `docs/reports/phase-6-10-background-library.md`.

| Punkt                      | Inhalt                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Hintergrundbilder einbinden **und** die **Zufallsauswahl** je Runde umsetzen.                                                         |
| **Betroffene Komponenten** | Beamer, Login, ausgewählte Bereiche; Host-Auswahl vor Spielbeginn                                                                     |
| **Betroffene Dateien**     | `packages/frontend/public/backgrounds/*`, CSS-Referenzen, Host-Steuerung                                                              |
| **Datenmodelle**           | evtl. `Game.backgroundId?` (welcher Hintergrund die Runde nutzt)                                                                      |
| **API-Änderungen**         | evtl. additives Feld `backgroundId` beim Spielstart                                                                                   |
| **Abhängigkeiten**         | **Bilder des Projektverantwortlichen** (fehlen), 6.9                                                                                  |
| **Risiken**                | Falsche Formate/Größen; Lesbarkeit; Ladezeit; Hintergrund darf nicht pro Beitritt/Frage wechseln                                      |
| **Teststrategie**          | Prüfung Format/Auflösung/Transparenz/Größe; visuelle Prüfung; Lazy Loading; **Zufall genau einmal je Runde, für alle Clients gleich** |
| **Abnahmekriterien**       | Bilder korrekt eingebunden, lesbar, performant; **Standard Zufall einmalig je Runde**; Host kann vorab wählen; **keine** Ersatzbilder |
| **Aufwand**                | niedrig bis mittel                                                                                                                    |

**Regel (Briefing §29–31):** Es werden **keine** KI-Ersatzbilder, **keine** Stockbilder und **keine**
Platzhalter als endgültige Lösung verwendet. Fehlende Bilder werden angefordert und abgewartet.

**Verbindlich (Phase 5c):** Standard **Zufall**; genau **einmal** je Runde bestimmt, für alle
gleich, bleibt die ganze Runde. Stil: dunkel, Wireframe, dezente Architektur – keine grellen
Neonflächen, keine gerenderten 3D-Räume (`game-design-concept.md` §10.5).

**Umsetzung (Stand `main`, PR #54):**

- `packages/shared/src/backgrounds.ts` – Katalog der zehn gelieferten Dateien, abgeleitet **nur**
  aus den Dateinamen (kein Bildinhalt, keine Bildanalyse); `resolveBackgroundChoice` liefert eine
  konkrete ID oder `undefined`.
- `packages/frontend/public/backgrounds/*` – die zehn Dateien, unverändert; Vite kopiert sie nach
  `dist/backgrounds/`.
- `RuntimeGame.background` – beim Anlegen einmalig zufällig bestimmt und als `background`-Event
  protokolliert; `engine.setBackground` (unter `withPhaseLock`, ungültige Werte abgelehnt,
  unveränderter Wert = No-op); Wiederherstellung aus dem Event-Log.
- `HostState.background` / `PlayerSync.background`; Broadcast `host:background` und
  `game:background`.
- `background.ts` – eine inerte Layer-Div, nur `--round-background` wird umgeschrieben;
  `backdrop.css` ergänzt ausschließlich die Layer-Regeln inkl. dunklem Scrim für Lesbarkeit.

**Keine** Schemaänderung, **keine** Migration, **keine** neue Abhängigkeit.

---

## 12. Phase 6.11 – Sound und Musik

**Status: Teil 1 umgesetzt, Freigabe offen** (Branches `feat/phase-6-11-host-music`, PR #57, und
`feat/phase-6-11-continuous-music`). Der Projektverantwortliche hat **ein** Musikstück geliefert
(`mastered_vorbis_96.ogg`); es läuft als durchgehende Spielmusik auf der Host-/Beamer-Ansicht — vom
Beginn der ersten Frage über Auflösung, Rangliste und Fragenwechsel bis zum tatsächlichen Spielende —
mit Stummschaltung und Lautstärke. Report: `docs/reports/phase-6-11-host-music.md`.

**Offen:** die restlichen Musikstücke (`music-lobby`, `music-final`, `music-victory`) und die
Soundeffekte aus Block F des Asset-Briefings. Sie werden nicht ersetzt, sondern angefordert.

| Punkt                      | Inhalt                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| **Ziel**                   | Eigenständiges Sounddesign mit getrennten Bussen für Musik und Effekte.                   |
| **Betroffene Komponenten** | neuer `audio.ts`-Manager, Anbindung an UI/Spiel/Show                                      |
| **Betroffene Dateien**     | neue `packages/frontend/src/audio.ts`, `public/audio/*`, Anbindung in `pages/*`           |
| **Datenmodelle**           | keine                                                                                     |
| **API-Änderungen**         | keine (Host steuert Show-Musik über ein Socket-Ereignis, falls nötig)                     |
| **Abhängigkeiten**         | **Audio-Assets des Projektverantwortlichen** (fehlen), 6.9                                |
| **Risiken**                | Autoplay-Sperre; doppelte Effekte; CPU-Last; Urheberrecht                                 |
| **Teststrategie**          | Manuell: Autoplay-Verhalten, Lautstärketrennung, Stummschaltung, keine Überlappung        |
| **Abnahmekriterien**       | Musik/Effekte getrennt regelbar; stumm schaltbar; kein Autoplay-Fehler; keine Überlappung |
| **Aufwand**                | mittel                                                                                    |

**Regel:** Keine ungeklärten urheberrechtlich geschützten Musikstücke. Assets werden angefordert.

**Verbindlich (Phase 5c):** Show-Audio läuft **ausschließlich** über die Host-/Beamer-Ansicht.
Spieler-Telefone spielen **keine** Show-Musik; höchstens lokale UI-Effekte. Ob die Audioübertragung
im Zoom-Betrieb hörbar ankommt, wird später **praktisch geprüft** (`game-design-concept.md` §11.2).

**Umsetzung Teil 1 (Stand Branch `feat/phase-6-11-host-music`):**

- `packages/frontend/public/audio/music/question-background.ogg` – das gelieferte Stück,
  byte-identisch übernommen (SHA-256 `228fd35d…f585`), kein Re-Encoding.
- `hostMusic.ts` – **kein** allgemeiner `audio.ts`-Manager, sondern ein auf die eine Aufgabe
  begrenztes Modul: Phasenregel, Lautstärke-Mathematik, Persistenz. Ein generischer Bus wäre für ein
  einziges Stück Spekulation auf künftige Assets; er kommt mit den fehlenden Dateien.
- Phasenregel: **nur** `question` spielt; `lead`, `reveal`, `board`, `end`, `lobby` pausieren; kein
  Spiel auf dem Bildschirm stoppt. Pausieren statt Stoppen hält den Stream gepuffert, damit der
  Wechsel zwischen Fragen die Datei nicht erneut lädt.
- Host-Steuerung `.music` (Stumm + Lautstärke + Prozentanzeige), **im Fluss** statt als Overlay,
  damit sie nie eine Frage oder einen Countdown verdeckt; Einstellung in `localStorage`
  (`zeropeek.host.music`), best-effort mit sicheren Rückfallwerten.
- Trennung ist **strukturell**, nicht zur Laufzeit: nur `pages/host.ts` importiert das Modul; im
  Build enthält ausschließlich `dist/assets/host-*.js` den Track-Pfad, der Player-Einstieg **null**
  Referenzen. Drei Tests in `design-system.test.ts` sichern das ab.
- `.ogg` wird von Caddy 2.8.4 mit `Content-Type: audio/ogg` ausgeliefert (eingebaute Tabelle,
  unabhängig von `/etc/mime.types`). Ein `mime`-Block ist in 2.8.4 **kein** gültiges Direktiv
  (`caddy validate`: `unrecognized directive`), die Caddyfile bleibt daher unverändert.
- **Keine** Schemaänderung, **keine** Migration, **keine** neue Abhängigkeit, **keine** Änderung an
  Punktevergabe, Fragen, Antworten, Konten oder Rechten.

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

| Thema                               | Phasen               | Vorschlag                                                                         |
| ----------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| Tests erweitern (E2E, visuell)      | ab 6.2               | Playwright einführen (heute nur im README genannt, nicht vorhanden)               |
| Socket-Rate-Limit (R-6)             | **6.8.5** (erledigt) | Token-Bucket für `player:join`/`player:rejoin`/`player:answer`; siehe §9.3        |
| Clock-Sync (R-7)                    | **6.8.5** (erledigt) | Ping/Pong-Versatz (`clock:ping`/`clock:pong`), siehe §9.3                         |
| Zustandswiederherstellung (R-4/5)   | 6.5/6.9              | Reconnect liefert aktuellen Zustand; Neustart rekonstruiert                       |
| R-3 (Historieverlust)               | 6.4                  | **entschärft** durch Quiz-Snapshot (verbindlich, §6.4 / game-design-concept §8.7) |
| Gastkonto-Übernahme                 | 6.8                  | Einmaliger, kurzlebiger Übernahmenachweis; kein Fremdzugriff                      |
| Barrierefreiheit                    | alle                 | Kontrast, Fokus, `prefers-reduced-motion`, Tastatur                               |
| Dokumentation                       | alle                 | ADRs für neue Entscheidungen; Konzept aktuell halten                              |
| **Performance-Budgets**             | alle                 | §16 – als Abnahmekriterium prüfen                                                 |
| **Lasttest** (`tools/loadtest.mjs`) | ab 6.5/6.9           | Nach Realtime-Änderungen erneut fahren (Regressionsschutz)                        |

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
| 6.9   | **hoch**    | 13 Szenen, Animationen, Lesbarkeit aus Distanz        |
| 6.10  | niedrig     | Einbinden bereitgestellter Bilder                     |
| 6.11  | mittel      | Audio-Manager, Busse, Assets                          |
| 6.12  | mittel–hoch | je Umfang                                             |

**Gesamt:** Die Phasen 6.1–6.11 sind ein umfangreiches Vorhaben. Empfehlung: strikt sequenziell, mit
Freigabe-Gate nach jeder Phase, um Risiko klein zu halten (Briefing §53, Fehlerquelle 1).

---

## 19. Offene Entscheidungen, die Phasen blockieren

**Bereits entschieden in Phase 5c** (nicht mehr blockierend): Rolle `PLAYER` (verbindlich), Sprache
(Deutsch Standard), XP-/Levelregeln (verbindlich), Quiz-Snapshot (verbindlich), Gastkonto-Übernahme
(verbindlich), charakterexklusive Gegenstände (verbindlich), Hintergrund Standard Zufall (verbindlich),
Host/Beamer kombiniert (verbindlich), Audio nur Host (verbindlich).

| #   | Entscheidung                                                                                    | Blockiert      |
| --- | ----------------------------------------------------------------------------------------------- | -------------- |
| 1   | Charakter-Assets (Referenzdateien)                                                              | 6.7, 6.9, 6.10 |
| 2   | Beamer-Grafiken (kombinierte Ansicht bleibt)                                                    | 6.10           |
| 3   | Audio-Assets                                                                                    | 6.11           |
| 4   | ~~Clock-Sync~~ **umgesetzt in 6.8.5** (R-7; siehe §9.3)                                         | –              |
| 5   | Redis-Adapter oder bewusst eine Instanz                                                         | 6.12, Betrieb  |
| 6   | ~~Pause/Überspringen~~ **umgesetzt in 6.5.3**; Skip **neutralisiert** die Frage (Punkte zurück) | 6.5            |
| 7   | Katalog in `shared` oder DB                                                                     | 6.7, 6.8       |
| 8   | Endgültige Belohnungsmatrix                                                                     | 6.8            |
| 9   | Erfolgsnamen/-bedingungen                                                                       | 6.8            |
| 10  | IP-Speicherung (Q5) – **6.6: keine IP gespeichert**; offen, falls Missbrauchsschutz nötig       | 6.6, später    |

---

## 20. Phase 5c – Produktentscheidungen dokumentiert (bereits erledigt)

Phase 5c hat die **verbindlichen Produktentscheidungen** in die Konzeptunterlagen übernommen
(Details: `docs/reports/phase-5c-product-decisions.md`). Es wurde **kein** Anwendungscode, **keine**
Migration und **kein** Phase-6-Branch erstellt.

| Entscheidung                                | Wirkung auf die Roadmap                             |
| ------------------------------------------- | --------------------------------------------------- |
| XP = Spielpunkte                            | 6.8: kein zweites XP-System; Levelkurve in `shared` |
| Platzierungsbonus 1500/1000/500             | 6.8: Bonus nach Spielende, Gleichstand fair         |
| Levelkurve `100.000 + (n−1)·10.000` (6.8.4) | 6.8: zentrale Funktion, Mehrfach-Aufstieg           |
| Freiwillige Registrierung                   | 6.3: Angebot beim Beitritt und nach Spielende       |
| Gastkonto-Übernahme                         | 6.8: neuer Schritt mit `Game.guestClaim`            |
| Charakterexklusive Items                    | 6.7: Katalog pro Charakter, sichtbare Ausrüstung    |
| Persönliche Statistik                       | 6.6: kein Spieler-Zugriff auf die Quizhistorie      |
| Quiz-Snapshot                               | 6.4: `GameSnapshot`, R-3 entschärft                 |
| Hintergrund Standard Zufall                 | 6.10: einmal je Runde, Host kann vorab wählen       |
| Audio nur Host                              | 6.11: keine Show-Musik auf Spieler-Telefonen        |

---

## 21. Zusammenfassung

Der Plan folgt der vom Briefing vorgegebenen Reihenfolge (6.1–6.12) und stellt grundlegende Systeme
vor abhängige. Er hält den Bestandsschutz ein (keine Änderung an Fragen, Konten, Rollen,
Auth-Logik, API-Verträgen, Daten). Die drei größten Phasen (6.7 Avatar, 6.9 Beamer, 6.12
Erweiterungen) sind asset- bzw. entscheidungsabhängig und werden erst nach Freigabe und
Asset-Bereitstellung begonnen.

**Bereits erledigt (Phase 5b):** Logo/Favicon optimiert, verwaiste/tote Ressourcen entfernt,
Lasttest-Werkzeug, Testlage mit PostgreSQL verifiziert (181/181). Siehe §15.

**Bereits erledigt (Phase 5c):** Verbindliche Produktentscheidungen dokumentiert (XP, Level,
Registrierung, Gastübernahme, Gegenstände, Statistik, Snapshot, Hintergrund, Audio). Siehe §20.

**Kein Code im Sinne einer Phase-6-Funktion, keine Migration, kein Phase-6-Branch wurde erstellt.**
Die begrenzten ersten Arbeiten der Phase 5b und die Konzeptarbeit der Phase 5c sind bestandserhaltend
und nehmen keinen Implementierungsentscheid vorweg.
