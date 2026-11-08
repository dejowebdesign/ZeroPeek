# Phase 6.6.2 – Spielerprofil-Oberfläche (Bericht)

- **Branch:** `feat/player-profile-ui-6-6-2` (von `main` = `3cc02c8`)
- **Umfang:** sichtbare Profiloberfläche für angemeldete Spieler — Statistiken und
  Charakterauswahl, aufbauend auf der vorhandenen Profil-API
- **Status:** vorgelegt, wartet auf Prüfung

## 0. Ergebnis in einem Satz

Die Profilseite existierte bereits aus Phase 6.6 (Name + Statistiken). Der **fehlende
Teil war die Charakterauswahl**: die Seite zeigte den gewählten Charakter nur als Text
und hatte kein `PUT`. Diese Phase ergänzt den Picker, speichert über das vorhandene
`PUT /api/profile` und behält Statistik-, Empty-State- und Gastverhalten unverändert bei.
**Kein Backend-Code, kein neuer Endpunkt, kein neues Feld, keine Charaktergrafiken.**

## 1. Vorhandene Frontend-Architektur (Bestandsaufnahme)

- **Build:** Vite Multi-Page-Build (`packages/frontend/vite.config.ts`). Je Oberfläche
  eine HTML-Datei + ein TS-Modul unter `src/pages/`. `profile.html` und
  `src/pages/profile.ts` existieren bereits und sind im Build registriert.
- **DOM:** eigener Builder `src/dom.ts` (`el`, `render`) — dynamischer Text läuft über
  `textContent` (CSP-konform), niemals `innerHTML` mit Nutzerdaten.
- **Designsystem:** `src/ui.ts` (`button`, `chip`, `statTile`, `emptyState`, `notice`,
  `skeleton`, `setBusy`, `toast`, `errorText`) + `src/styles/tokens.css` (Tokens und
  Komponentenklassen). Keine Fremdbibliothek.
- **Shell/Navigation:** `src/navigation.ts` (`appShell`, `PLAYER_NAV` mit Eintrag
  `profile` → `./profile.html`).
- **API-Client:** `src/api.ts` (`get`, `put`, `setCsrfToken`, `ApiError`) — sendet Cookies,
  setzt `X-CSRF-Token` bei unsicheren Methoden.
- **Tests:** Vitest + jsdom; `*.test.ts` neben dem Code. `design-system.test.ts` prüft
  u. a., dass jede von Komponenten erzeugte Klasse auch im Stylesheet existiert.

**Vorhandene Profil-API (unverändert genutzt):** `GET /api/profile`,
`PUT /api/profile` (`selectedCharacterId`), serverseitige Statistik, `requireAuth` +
CSRF.

**Charaktere:** Im Repo gibt es **keine** Charakterdaten und **keine** Charaktergrafiken
(nur `logo.png`, `favicon.png`). Die kanonischen IDs sind in Konzept §2.1/§2.3 und im
Asset-Briefing (Block B) festgelegt: `ethan`, `maya`, `pixel`, `bee`, `dr-obscura`,
`o-bot`.

## 2. Neue Profilroute bzw. Navigation

Keine neue Route nötig: `profile.html` und der Navigations-Eintrag **Profile** existierten
bereits. Es wurde nichts an `navigation.ts` geändert. Die Seite rendert weiterhin in der
`appShell` mit `role: 'player'`, `active: 'profile'`.

## 3. Verwendete API-Endpunkte

Ausschließlich die vorhandenen:

| Endpunkt           | Zweck                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| `GET /api/auth/me` | Session prüfen, CSRF-Token holen                                                     |
| `GET /api/profile` | Profil, Statistiken, gewählter Charakter laden (und nach dem Speichern erneut laden) |
| `PUT /api/profile` | `{ selectedCharacterId }` speichern                                                  |

Kein neuer Endpunkt, keine Änderung an bestehenden Endpunkten.

## 4. Profil- und Statistikdarstellung

- **Persönlicher Bereich:** Benutzername, Rollen-Chip, aktueller Charakter als Chip
  (Name aus dem Katalog, sonst der rohe gespeicherte Wert).
- **Statistiken:** ausschließlich aus `GET /api/profile` — Siege, Podiumsplätze,
  Genauigkeit, gespielte Spiele, richtige Antworten, beantwortete Fragen. Das Frontend
  rechnet nichts nach.
- **Empty State:** bei `gamesPlayed === 0` erscheint „No finished games yet" statt
  Nullwerten.
- **`accuracy === null`:** wird als „—" mit Hinweis dargestellt, **nicht** als „0 %".

## 5. Charakterauswahl

- **Katalog:** neue Konstante `CHARACTER_CATALOGUE` in `packages/shared/src/profile.ts`
  mit den kanonischen IDs, Namen, Tagline und Rarity (rein kosmetisch). Sie wird **nicht**
  vom Server verwendet — die Servervalidierung bleibt bewusst permissiv (jeder begrenzte
  String), sodass hier ein Charakter ergänzt werden kann, ohne das Backend zu ändern.
- **Bedienung:** eine Radiogruppe aus Glas-Karten (Name + Tagline, Rarity-Rahmen). Kein
  Skript nötig für Fokus/Auswahl; Tastatur und Screenreader funktionieren nativ.
- **Speichern:** „Save character" ruft `PUT /api/profile` mit `selectedCharacterId` und dem
  CSRF-Token auf. Erfolg → Toast + erneutes `GET /api/profile`, sodass Kopfzeile und Picker
  den tatsächlich gespeicherten Wert zeigen.
- **Zustände:** Button nur aktiv, wenn die Auswahl vom gespeicherten Wert abweicht;
  Busy-Zustand während des Speicherns; Fehler wird **an Ort und Stelle** angezeigt und die
  Anzeige bleibt beim echten gespeicherten Wert (kein Vortäuschen).
- **Unbekannte ID:** ein vor dem Katalog gespeicherter Wert wird ehrlich benannt („nicht im
  Angebot") statt versteckt oder überschrieben.
- **Keine Grafiken:** keine erfundenen Avatare, keine generierten Bilder.

## 6. Responsive Umsetzung

- Desktop: Picker als `auto-fit`-Raster (ab 210 px Kartenbreite).
- Smartphone (`max-width: 767px`): Picker einspaltig; Statistik bereits zweispaltig.
- Optionen erfüllen das gemeinsame Tap-Ziel (`--tap`, 44 px).
- `prefers-reduced-motion: reduce` schaltet die Übergänge ab.
- Alle Farben/Blur/Radien stammen aus vorhandenen Tokens; keine neue Designbibliothek.

## 7. Berechtigungen

- Nur angemeldete Konten sehen die Profilseite. Ohne Session (`/api/auth/me` → `user:null`)
  erscheint ein „Sign in"-Hinweis, und es wird **kein** `/api/profile` aufgerufen.
- Abgelaufene Session (401 auf `GET /api/profile`) → „Your session has expired.".
- **Gäste:** die Spieleroberfläche (`pages/player.ts`) berührt weder `/api/profile` noch
  `/api/auth/me`; ein Gast spielt weiter per PIN. Ein Test sichert diese Zusage ab.
- Keine Rollen-/Rechteänderung, keine Admin-Funktionen auf der Profilseite.

## 8. Neue Tests

**Frontend** (`packages/frontend/src/profile.test.ts`, 5 → 13 Tests):

1. Profil lädt und zeigt die eigenen Statistiken.
2. Statistiken korrekt dargestellt (Werte aus der Antwort).
3. `null`-Genauigkeit → „—", nicht „0 %".
4. Empty State bei neuen Spielern.
5. Picker zeigt genau die Katalog-IDs (keine erfundenen Charaktere); Optionen sind Radios.
6. Speichern: `PUT` mit CSRF-Token, danach Reload, Auswahl bleibt erhalten.
7. Speicherfehler wird sichtbar, Anzeige bleibt beim gespeicherten Wert, Button erholt sich.
8. Nicht angemeldet: Hinweis statt Profil, kein Profil-API-Aufruf.
9. Gäste: Spieleroberfläche ohne Profil-/Auth-Abhängigkeit.
10. Mobil: Picker einspaltig, Tap-Ziel, Reduced-Motion (CSS-Vertrag).
    Zusätzlich: unbekannte gespeicherte ID ehrlich dargestellt; „No character chosen".

**Shared** (`packages/shared/src/profile.test.ts`, 13 → 17 Tests): Katalog enthält genau
die kanonischen IDs; jeder Charakter hat Name/Tagline/Rarity; jede ID ist serverseitig
akzeptiert; `findCharacter` findet/bestätigt unbekannt.

**Designsystem** (`design-system.test.ts`): die neuen Klassen `profile__form`,
`profile__picker`, `profile__radio`, `profile__option`(+`--selected/--rare/--legendary`),
`profile__option-body/-name/-tagline`, `profile__save`, `profile__save-status`(+`--error`)
sind registriert und im Stylesheet vorhanden.

## 9. Ergebnisse aller Prüfungen

| Schritt                   | Ergebnis                    |
| ------------------------- | --------------------------- |
| Backend-Tests             | **248 / 248** (unverändert) |
| Frontend-Tests            | **354 / 354** (vorher 333)  |
| Shared-Tests              | **106 / 106** (vorher 102)  |
| `typecheck`               | grün                        |
| `lint`                    | grün                        |
| `format:check` (Prettier) | grün                        |
| `build`                   | grün                        |

Hinweis: Ein einzelner Lauf der Backend-Suite zeigte einen Fehler in
`lobby-sync.integration.test.ts` (Timing); zwei unmittelbare Wiederholungsläufe waren
**248/248** grün. Es handelt sich um einen vorbestehenden, timingabhängigen Flake im
Lobby-Sync-Test — **kein Backend-Code wurde in dieser Phase berührt**.

## 10. Bewusst nicht implementiert

- Keine Charaktergrafiken, keine Avatare, kein Avatar-Editor (Phase 6.7; Assets fehlen).
- Kein XP, Level, Inventar, Erfolge (Phase 6.8).
- Keine spielersichtliche Quizhistorie.
- Keine neuen Backend-Endpunkte, keine DB-Änderung, keine Migration.
- Kein Design-Umbau außerhalb des Profilbereichs.
