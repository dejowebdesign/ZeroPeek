# Phase 6.8 – Spielerfortschritt: XP, Level, Erfolge, Inventar und Gastkonto-Übernahme (Bericht)

- **Branch:** `feat/phase-6-8-player-progression`
- **Basis:** `origin/main` @ `cdc9bbd` (PR #37, #38, #39, #40 gemergt)
- **Umfang:** serverseitiger Spielerfortschritt (XP/Level), Erfolge, Inventar/Freischaltungen und
  die Übernahme einer abgeschlossenen Gastrunde (Roadmap §9)
- **Status:** vorgelegt, wartet auf Prüfung — **kein Push/PR ohne ausdrückliche Freigabe**

> **Hinweis:** Dieser Bericht fasst die drei Teilschritte zusammen. 6.8.1 (Registrierung/parallele
> Sitzungen) ist bereits als Commit `8ad5d8e` enthalten; 6.8.3 (XP/Level/Erfolge) als `ca04b17`;
> 6.8.2 (Gastkonto-Übernahme, Backend **und** Frontend) und die Fortschritts-Oberflächen sind der
> noch uncommittete Teil dieser Phase.

## 0. Ergebnis in einem Satz

XP, Level, Erfolge und Inventar werden **ausschließlich serverseitig** vergeben und gespeichert; die
Oberfläche zeigt nur an und rüstet aus. Eine abgeschlossene **Gastrunde** kann ein Gast nach der
Registrierung **genau einmal** übernehmen — über einen kurzlebigen, an Runde und Sitzung gebundenen
Nachweis.

## 1. Was umgesetzt wurde

```
Spielende (ended)  ──► grantProgressForGame(gameId)     ──► XP + Platzierungsbonus, Level, Belohnungen, Erfolge
                   └─► offerGuestClaims(io, gameId)     ──► game:claimable NUR an den Gast selbst

GET  /api/progress            ──► XP, Level, Fortschritt zum nächsten Level, Kennzahlen
GET  /api/inventory           ──► Gegenstände des aktiven Charakters (besessen / gesperrt)
POST /api/inventory/equip     ──► Gegenstand ausrüsten (serverseitig validiert, nur eigener Besitz)
GET  /api/achievements        ──► Erfolge mit Zustand und Fortschritt
POST /api/guest-claim/status  ──► ist die Gastrunde noch übernehmbar?
POST /api/guest-claim         ──► Gastrunde einmalig übernehmen (verknüpft Sitz + XP)
```

| Belang            | Vorher                                                | Nachher                                                                         |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| XP / Level        | nicht vorhanden                                       | `XpLedger` (Wahrheit) + materialisierte Werte am Profil; Levelkurve in `shared` |
| Erfolge           | nicht vorhanden                                       | Katalog + Auswertung in `shared`, Zustand in `PlayerAchievement`                |
| Inventar          | nicht vorhanden                                       | `PlayerInventory`; Anzeige + Ausrüsten über API                                 |
| Gastrunde         | ging beim Registrieren verloren                       | einmalige, kurzlebige Übernahme (Punkte, Bonus, XP, Statistik)                  |
| Spieleroberfläche | Profil ohne Fortschritt                               | Profil mit XP/Level/Erfolgen und Übernahmeangebot; neue Inventarseite           |
| Bestand           | Fragen, Antworten, Konten, Rollen, Punkte unverändert | unverändert; Migration **rein additiv**                                         |

## 2. Datenmodell (rein additiv)

| Modell / Feld                         | Zweck                                                                        | Art         |
| ------------------------------------- | ---------------------------------------------------------------------------- | ----------- |
| `PlayerProfile.xp Int @default(0)`    | materialisierter XP-Stand (Ledger bleibt Wahrheit)                           | Erweiterung |
| `PlayerProfile.level Int @default(1)` | materialisiertes Level                                                       | Erweiterung |
| `XpLedger`                            | append-only Gutschriftprotokoll                                              | neu         |
| `PlayerInventory`                     | Besitz je (user, item)                                                       | neu         |
| `PlayerAchievement`                   | Erfolg je (user, achievementId)                                              | neu         |
| `Game.guestClaim Json?`               | kurzlebiger, einmaliger Übernahmenachweis (Tokenhash, `expiresAt`, `usedAt`) | Erweiterung |

**Unique-Sperren (Anti-Doppelvergabe):** `XpLedger @@unique([userId, gameId, reason])`,
`PlayerInventory @@unique([userId, itemId])`, `PlayerAchievement @@unique([userId, achievementId])`.

**Migration** `20261111130000_phase_6_8_player_progression`: neue Tabellen und neue Spalten mit
Default, keine Löschung, keine Typänderung. Auf der Testdatenbank sauber angewandt
(`prisma migrate deploy`).

## 3. XP, Level und Anti-Manipulation

- **XP = erreichte Spielpunkte** (kein zweites Punktesystem) plus **Platzierungsbonus** 1.500 / 1.000
  / 500; **Gleichstand** erhält denselben Bonus (bestehende Rangfolge `rankPlayers` liefert gleiche
  Ränge).
- **Eine Transaktion je Spieler und Spiel**; der `XpLedger`-Unique ist die Idempotenzsperre. Ein
  erneutes `ended` oder ein Retry zahlt **nichts** doppelt.
- **Levelkurve** zentral in `shared` (L1 = 0 XP; L1→L10 je 10.000; ab L11 +1.000 je Stufe). Eine
  Gutschrift kann mehrere Level überspringen; **alle** übersprungenen Stufen werden berücksichtigt.
- **Kein Client-Schreibpfad.** Es gibt keinen Endpunkt, der XP, ein Level oder eine Freischaltung
  annimmt; `progressionService` ist der einzige Schreiber.
- **Erfolge** werden aus serverseitigen Daten ausgewertet, einmalig freigeschaltet, nie entzogen.

## 4. Gastkonto-Übernahme (sicherheitskritisch)

- Beim `ended` erhält **jeder Gast-Sitz** einen kurzlebigen Nachweis; das rohe Token geht **nur** an
  den Socket dieses Gastes (`game:claimable`), gespeichert wird nur sein SHA-256-Hash.
- Übernahme verlangt **Sitz-Id + Token**, ist **an Runde und Sitzung gebunden**, **einmalig**
  (`usedAt` in derselben Transaktion) und **zeitlich begrenzt** (`expiresAt`, 30 Minuten).
- **Keine fremde Übernahme:** Die Sitz muss noch ein Gast sein (`userId` null); ein bereits
  verknüpfter Sitz wird abgelehnt (bzw. als „bereits übernommen" beantwortet). Der Kontoinhaber
  kommt **aus der Sitzung**, nie aus dem Body.
- **Keine Doppelgutschrift:** die XP werden über den idempotenten `grantProgressForGame` vergeben, der
  die bereits bezahlten Spieler überspringt.
- Nur die **gerade abgeschlossene** Runde ist übernehmbar; es gibt bewusst keinen Weg, ein beliebiges
  älteres Gastspiel nachträglich zu übertragen.
- **Zustimmung:** Die Übernahme wird nie automatisch ausgelöst. Sie erscheint als Karte im Profil
  **nur**, wenn lokal ein Nachweis liegt, und **nur** nachdem der Server sie als übernehmbar gemeldet
  hat.

## 5. Oberfläche

- **`pages/profile.ts`** – neue Karten „Progress" (Level, XP, Balken zum nächsten Level) und
  „Achievements" (Zustand + Fortschritt) sowie das Übernahmeangebot. Alle Werte kommen vom Server.
- **`pages/inventory.ts`** (+ `inventory.html`, Vite-Eintrag) – Level/XP, Gegenstände des aktiven
  Charakters (besessen/gesperrt) und Erfolge. Ein gesperrter Gegenstand zeigt den **Serverhinweis**
  und hat **kein** Ausrüsten-Element.
- **`navigation.ts`** – der bisherige „Soon"-Eintrag „Inventory" verlinkt jetzt auf die Seite.
- **`claim.ts`** – hält den Übernahmenachweis lokal (`localStorage`), ersetzt ihn je Runde und
  verwirft ihn nach Erfolg oder Ablehnung.
- **Design:** nur **additive** Regeln am Ende von `tokens.css` (`.achievements`, `.achievement*`,
  `.inventory__*`); keine neue Farbe, Unschärfe oder Radius. Ein Guard-Test in
  `design-system.test.ts` prüft, dass jede neue Klasse definiert ist und dass es **sieben** Einträge
  (inkl. `inventory.html`) sind.

## 6. Tests und Prüfungen (alle grün)

| Prüfung                           | Ergebnis                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Shared (vitest)                   | **161/161** (davon `achievements.test.ts` 11, Levelkurve)                                |
| Backend (vitest, PostgreSQL)      | **324/324** (davon `progression.integration.test.ts` 11, `claim.integration.test.ts` 10) |
| Frontend (vitest, jsdom)          | **414/414** (davon `profile.test.ts` 30, `inventory.test.ts` 4)                          |
| Typecheck (alle Workspaces)       | **grün**                                                                                 |
| Build (`npm run build`)           | **grün**                                                                                 |
| Prettier `format:check .`         | **grün**                                                                                 |
| Prisma `migrate deploy` (Test-DB) | **grün**                                                                                 |

Abgedeckt: XP genau einmal je Spiel; Punktestand + Bonus; Gleichstand → gleicher Bonus; Gäste
erhalten keine dauerhaften XP; mehrere Levelaufstiege aus einer Gutschrift; Erfolg genau einmal;
Übernahme nur einmal und nur für den Berechtigten; abgelaufene/fremde/bereits verwendete Nachweise
werden abgelehnt; die Oberflächen zeigen Serverwerte und senden die CSRF-Kopfzeile.

## 7. Bestandsschutz

- Keine Frage, Antwort, kein Konto, keine Rolle, keine Berechtigung und kein bestehender API-Vertrag
  verändert oder entfernt.
- Die Punkteberechnung im Spiel ist **unberührt**; XP ist ein **zusätzlicher** Vorgang am Spielende.
- Socket-Ereignisnamen und -Payloads bleiben; `game:claimable` ist **rein additiv**.
- Die Migration ist rein additiv; kein Produktivsystem, kein Portainer, kein Deployment berührt.

## 8. Geänderte / neue Dateien

**Neu:** `packages/shared/src/achievements.ts`, `levelRewards.ts`, `achievements.test.ts`;
`packages/backend/src/services/progressionService.ts`, `services/claimService.ts`,
`routes/progressRoutes.ts`, `routes/claimRoutes.ts`, `progression.integration.test.ts`,
`claim.integration.test.ts`; `packages/frontend/src/claim.ts`, `pages/inventory.ts`,
`inventory.html`, `inventory.test.ts`;
`packages/backend/prisma/migrations/20261111130000_phase_6_8_player_progression/`.

**Geändert:** `packages/backend/prisma/schema.prisma`, `src/app.ts`, `src/socket.ts`,
`src/services/profileService.ts`, `src/testing/db.ts`; `packages/shared/src/index.ts`,
`src/progression.ts`, `src/events.ts`; `packages/frontend/src/pages/profile.ts`, `pages/player.ts`,
`navigation.ts`, `styles/tokens.css`, `vite.config.ts`, `design-system.test.ts`, `profile.test.ts`.

**Dokumentation:** `docs/analysis/phase-6-8-inventory.md`, `docs/roadmap/technical-roadmap.md` §9,
dieser Bericht.

## 9. Offene Fragen an chrisB

1. **Belohnungsmatrix:** Welcher Gegenstand wird bei welchem Level freigeschaltet? Bis zur Freigabe
   ist `LEVEL_REWARDS` **leer**, eine Stufe vergibt also **keinen** Gegenstand, und die Oberfläche
   sagt das offen („Rewards … still being finalised"). Es wird **kein** Gegenstand und **kein** Asset
   erfunden.
2. **Erfolge:** Namen, Beschreibungen und Schwellen sind ein **Vorschlag** (§6.3). Bestätigen oder
   ändern? Die Mechanik ist fertig; die Inhalte liegen an **einer** Stelle (`achievements.ts`).
3. **Belohnungs-Assets:** Für Levelbelohnungen/Erfolge existieren **keine** Assets außer den
   Standard-Kits. Ohne Freigabe entstehen keine erfundenen Grafiken (siehe Asset-Briefing).
4. **Freigabe** dieser Phase (Commit, Push, PR).
