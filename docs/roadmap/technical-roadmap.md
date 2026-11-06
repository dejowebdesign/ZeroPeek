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

| Phase | Braucht zwingend                                          | Ohne das blockiert     |
| ----- | --------------------------------------------------------- | ---------------------- |
| 6.3   | Rolle `PLAYER`, Spielerkonto-Modell, E-Mail-Bestätigung   | 6.6, 6.7, 6.8          |
| 6.4   | Quiz-Snapshot (verbindlich, §8.7)                         | Autospeichern, Reports |
| 6.7   | **Charakter-Assets des Projektverantwortlichen** (fehlen) | 6.7, 6.10              |
| 6.8   | Levelkurve + XP-Ledger; Gastkonto-Übernahme               | 6.8, 6.12              |
| 6.9   | Beamer-Grafiken (kombinierte Host-Ansicht bleibt)         | 6.10                   |
| 6.11  | **Audio-Assets des Projektverantwortlichen** (fehlen)     | 6.11                   |
| 6.12  | Entscheidungen zu Modi/Redis                              | 6.12                   |

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

**Offen – Voraussetzungen, die chrisB bereitstellen oder entscheiden muss:**

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

---

## 8. Phase 6.7 – Blockwelt-Helden-Avatar-System

| Punkt                      | Inhalt                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Charakterauswahl und modularer Avatar-Editor mit **charakterexklusiven** Gegenständen und sichtbarer Ausrüstung.                                      |
| **Betroffene Komponenten** | neue `pages/characters.ts`, `pages/avatar.ts`, `shared`-Katalog, Layer-Rendering                                                                      |
| **Betroffene Dateien**     | `packages/shared/src/characters.ts` (neu), `packages/shared/src/cosmetics.ts` (neu), neue Seiten, `styles/*`                                          |
| **Datenmodelle**           | `PlayerProfile.selectedCharacterId`, `PlayerProfile.avatarConfig` (JSONB)                                                                             |
| **API-Änderungen**         | `PUT /api/profile/avatar` (serverseitig validiert gegen den **charakterexklusiven** Katalog)                                                          |
| **Abhängigkeiten**         | **Charakter-Assets des Projektverantwortlichen** (fehlen), 6.6                                                                                        |
| **Risiken**                | Fehlende Assets blockieren; falsche Kombinationen; Schärfe auf Mobil; fehlende Layer pro Gegenstand                                                   |
| **Teststrategie**          | Unit: Katalog je Charakter, Layer-Reihenfolge, Ablehnung fremder Gegenstände; Integration: Avatar-Speicherung validiert; visuell Desktop/Mobil        |
| **Abnahmekriterien**       | Gegenstände sind **nur dem vorgesehenen Charakter** zugeordnet; sichtbar am Avatar tragbar; Avatarwechsel löscht nichts; scharf auf Desktop und Mobil |
| **Aufwand**                | hoch                                                                                                                                                  |

**Blockiert bis Assets vorliegen.** Unabhängige Arbeit (Katalogstruktur, Matrix, Validierung) kann
vorbereitet werden, die Darstellung nicht.

**Verbindlich (Phase 5c):** **Jeder Avatar besitzt seine eigenen Gegenstände** (kein allgemeiner
Katalog). Ein Gegenstand ist **charakterexklusiv** und muss **sichtbar** ausrüstbar sein
(Ausrüstungsslots, Layer, Position, Größe, Ebenenreihenfolge). Die endgültige **Layerarchitektur**
wird anhand der gelieferten Originalassets festgelegt; Empfehlung **PNG-Layer-Stapelung**
(`game-design-concept.md` §3.2/§3.3). Keine Neugestaltung der Figuren.

---

## 9. Phase 6.8 – Inventar, XP, Level, Belohnungen und Gastkonto-Übernahme

| Punkt                      | Inhalt                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ziel**                   | Inventar, XP/Level, Erfolge, Freischaltungen und **Gastkonto-Übernahme** – alles serverseitig und manipulationssicher.                                                                                                           |
| **Betroffene Komponenten** | neue `pages/inventory.ts`, `services/progressService.ts`, Motor-Anbindung am Spielende, Übernahme-Endpunkt                                                                                                                       |
| **Betroffene Dateien**     | `schema.prisma`, neue Services/Routen, `services/engine.ts` (nur Haken am `end`), `shared`-Levelfunktion                                                                                                                         |
| **Datenmodelle**           | **Neu:** `PlayerInventory`, `PlayerAchievement`, `XpLedger`, `Game.guestClaim`; **Erweiterung:** `GamePlayer.userId?`                                                                                                            |
| **API-Änderungen**         | **Neu:** `GET /api/inventory`, `POST /api/inventory/equip`, `GET /api/achievements`, `POST /api/auth/claim-guest-round`                                                                                                          |
| **Abhängigkeiten**         | 6.6, 6.7; Levelkurve + XP-Ledger; Anti-Manipulations-Entscheidungen                                                                                                                                                              |
| **Risiken**                | Doppelte XP-Vergabe, doppeltes Einlösen, manipulierte Bedingungen, **doppelte/fremde Gastübernahme**, Gleichstand                                                                                                                |
| **Teststrategie**          | Integration: XP genau einmal je Spiel; Erfolg genau einmal; `@@unique` verhindert Doppelbesitz; **Übernahme nur einmal und nur für den Berechtigten**; mehrere Levelaufstiege aus einer Gutschrift; Gleichstand → gleicher Bonus |
| **Abnahmekriterien**       | XP/Inventar nur serverseitig; idempotent; keine Client-Schreibpfade; Gastübernahme einmalig und sicher; Levelkurve korrekt                                                                                                       |
| **Aufwand**                | mittel bis hoch (Übernahme ist der riskanteste Teil)                                                                                                                                                                             |

**Bestandsschutz:** Die Punktevergabe im Spiel bleibt unverändert. XP ist ein **zusätzlicher**
Vorgang beim Spielende, in einer Transaktion.

### 9.1 Verbindliche XP-Regeln (Phase 5c)

- **XP = erreichte Spielpunkte.** Keine zweite XP-Formel; das bestehende Punktesystem bleibt
  maßgeblich (`game-design-concept.md` §5.2).
- **Platzierungsbonus** zusätzlich: 1. Platz **1.500**, 2. Platz **1.000**, 3. Platz **500** XP.
  Wird **nach** Feststellung der endgültigen Platzierung gutgeschrieben und **nicht** in die
  Spielwertung eingerechnet (`game-design-concept.md` §5.3).
- **Gleichstand:** Alle gleichplatzierten Spieler erhalten **denselben** Bonus. Die bestehende
  Ranglistenlogik ist darauf zu **prüfen und zu dokumentieren** (kein willkürlicher Tiebreak).
- **Levelkurve (zentral in `shared`):** Level 1 = 0 XP; L1→L10 je 10.000; ab L10→L11 +11.000,
  danach je +1.000. Eine Gutschrift kann **mehrere** Level überspringen; **alle** erreichten Level
  und Belohnungen müssen berücksichtigt werden (`game-design-concept.md` §5.4).
- **Ledger-Idempotenz:** `XpLedger` mit `@@unique([userId, gameId, reason])`; eine erneute
  Verarbeitung desselben Spielabschlusses erzeugt **keine** weiteren XP.

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

---

## 10. Phase 6.9 – Game-Show-Modus (in der bestehenden Host-Ansicht)

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

---

## 12. Phase 6.11 – Sound und Musik

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

| Thema                               | Phasen     | Vorschlag                                                                         |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| Tests erweitern (E2E, visuell)      | ab 6.2     | Playwright einführen (heute nur im README genannt, nicht vorhanden)               |
| Socket-Rate-Limit (R-6)             | ab 6.3/6.9 | Limit für `join`/`answer`/`rejoin`                                                |
| Clock-Sync (R-7)                    | 6.9        | Ping/Pong-Versatz, siehe game-design-concept §12.3                                |
| Zustandswiederherstellung (R-4/5)   | 6.5/6.9    | Reconnect liefert aktuellen Zustand; Neustart rekonstruiert                       |
| R-3 (Historieverlust)               | 6.4        | **entschärft** durch Quiz-Snapshot (verbindlich, §6.4 / game-design-concept §8.7) |
| Gastkonto-Übernahme                 | 6.8        | Einmaliger, kurzlebiger Übernahmenachweis; kein Fremdzugriff                      |
| Barrierefreiheit                    | alle       | Kontrast, Fokus, `prefers-reduced-motion`, Tastatur                               |
| Dokumentation                       | alle       | ADRs für neue Entscheidungen; Konzept aktuell halten                              |
| **Performance-Budgets**             | alle       | §16 – als Abnahmekriterium prüfen                                                 |
| **Lasttest** (`tools/loadtest.mjs`) | ab 6.5/6.9 | Nach Realtime-Änderungen erneut fahren (Regressionsschutz)                        |

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

| #   | Entscheidung                                 | Blockiert      |
| --- | -------------------------------------------- | -------------- |
| 1   | Charakter-Assets (Referenzdateien)           | 6.7, 6.9, 6.10 |
| 2   | Beamer-Grafiken (kombinierte Ansicht bleibt) | 6.10           |
| 3   | Audio-Assets                                 | 6.11           |
| 4   | Clock-Sync                                   | 6.9            |
| 5   | Redis-Adapter oder bewusst eine Instanz      | 6.12, Betrieb  |
| 6   | Pause/Überspringen                           | 6.5            |
| 7   | Katalog in `shared` oder DB                  | 6.7, 6.8       |
| 8   | Endgültige Belohnungsmatrix                  | 6.8            |
| 9   | Erfolgsnamen/-bedingungen                    | 6.8            |
| 10  | IP-Speicherung (Q5)                          | 6.6            |

---

## 20. Phase 5c – Produktentscheidungen dokumentiert (bereits erledigt)

Phase 5c hat die **verbindlichen Produktentscheidungen** in die Konzeptunterlagen übernommen
(Details: `docs/reports/phase-5c-product-decisions.md`). Es wurde **kein** Anwendungscode, **keine**
Migration und **kein** Phase-6-Branch erstellt.

| Entscheidung                              | Wirkung auf die Roadmap                             |
| ----------------------------------------- | --------------------------------------------------- |
| XP = Spielpunkte                          | 6.8: kein zweites XP-System; Levelkurve in `shared` |
| Platzierungsbonus 1500/1000/500           | 6.8: Bonus nach Spielende, Gleichstand fair         |
| Levelkurve L1–L10 = 10.000, ab L11 +1.000 | 6.8: zentrale Funktion, Mehrfach-Aufstieg           |
| Freiwillige Registrierung                 | 6.3: Angebot beim Beitritt und nach Spielende       |
| Gastkonto-Übernahme                       | 6.8: neuer Schritt mit `Game.guestClaim`            |
| Charakterexklusive Items                  | 6.7: Katalog pro Charakter, sichtbare Ausrüstung    |
| Persönliche Statistik                     | 6.6: kein Spieler-Zugriff auf die Quizhistorie      |
| Quiz-Snapshot                             | 6.4: `GameSnapshot`, R-3 entschärft                 |
| Hintergrund Standard Zufall               | 6.10: einmal je Runde, Host kann vorab wählen       |
| Audio nur Host                            | 6.11: keine Show-Musik auf Spieler-Telefonen        |

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
