# Phase 6.7 – Blockwelt-Helden-Avatar-System (Bericht)

- **Branch:** `feat/phase-6-7-character-avatar-system`
- **Basis:** `feat/host-player-identity-separation-6-6-3` (Stand `8218902`)
- **Umfang:** Charakterauswahl und modularer Avatar-Editor mit **charakterexklusiven** Gegenständen
  (Roadmap §8), auf Grundlage der vom Projektverantwortlichen gelieferten Original-Grafiken
- **Status:** vorgelegt, wartet auf Prüfung — **kein Commit/Push/PR ohne ausdrückliche Freigabe**

> **Hinweis zur Basis (gestapelter PR):** Dieser Branch baut auf Phase 6.6.3 auf, deren PR **noch
> nicht gemerged** ist. `main` enthält deshalb **kein** `requirePlayerAuth` und **keine**
> `/api/player-auth/*`-Routen. Der Avatar-Endpunkt nutzt `requirePlayerAuth`. **Dieser PR ist erst
> mergebar, nachdem 6.6.3 gemerged wurde** (siehe §7).

## 0. Ergebnis in einem Satz

Die **Ethan-** und **Maya**-Grafiken des Projektverantwortlichen sind byte-identisch übernommen, es
gibt einen **charakterexklusiven** Gegenstandskatalog als geteilten Code, einen **serverseitig
validierten** Avatar-Speicher (`PUT /api/profile/avatar`) und einen Avatar-Editor im Spielerprofil —
**ohne** erfundene Layer-Koordinaten, weil die gelieferten Einzel-Grafiken **nicht** ausgerichtet
sind.

## 1. Was umgesetzt wurde

```
GET /api/profile        ──► liefert jetzt zusätzlich profile.avatarConfig
PUT /api/profile        ──► Charakterwechsel setzt das Default-Kit des neuen Charakters
PUT /api/profile/avatar ──► validateAvatarConfig(body) ──► PlayerProfile.avatarConfig (JSONB)
                              └─ lehnt unbekannte Figur, unbekannten/fremden Gegenstand, falschen Slot ab (422)
```

| Belang             | Vorher                                              | Nachher                                                               |
| ------------------ | --------------------------------------------------- | --------------------------------------------------------------------- |
| Charakterauswahl   | Id speichern, ohne Anzeige                          | Figur wird mit **Portrait** dargestellt (Ethan/Maya)                  |
| Avatar             | nicht vorhanden                                     | Editor mit fünf Slots, Live-Vorschau, serverseitig gespeichert        |
| Gegenstandskatalog | nicht vorhanden                                     | `shared/cosmetics.ts`, **charakterexklusiv**                          |
| Fremde Gegenstände | (n/a)                                               | serverseitig **abgelehnt**; im Editor **gar nicht angeboten**         |
| Layer-Stapelung    | geplant (PNG-Stapel)                                | **zurückgestellt** — gelieferte Layer sind nicht ausgerichtet (s. §4) |
| Bestand            | Charakter-Id, Statistik, Fragen, Konten unverändert | unverändert; Migration **rein additiv**                               |

## 2. Datenmodell

### 2.1 `PlayerProfile` (Erweiterung, additiv)

Neu: **eine nullable JSONB-Spalte** `avatar_config`. Keine Spalte/Tabelle/Zeile wird gelöscht,
kein bestehender Typ/Nullability geändert.

```prisma
avatarConfig Json? @map("avatar_config")
```

`NULL` bedeutet „noch kein Avatar konfiguriert" (API meldet dann `null`). Jedes Profil, das vor
6.7 existiert, funktioniert unverändert. Der Katalog ist **Code**, nicht Datenbank — die DB
speichert nur **Zustand** (`characterId` + ausgerüsteter Gegenstand je Slot).

### 2.2 Migration `20261111120000_phase_6_7_avatar_config`

```sql
ALTER TABLE "player_profiles" ADD COLUMN "avatar_config" JSONB;
```

Rein additiv. Auf der Testdatenbank geprüft: `prisma migrate deploy` wendet alle Migrationen sauber
an („All migrations have been successfully applied").

## 3. Gegenstandskatalog und Charakterexklusivität

- **`shared/cosmetics.ts`**: fünf Slots (`backpack`, `outfit`, `neckAccessory`, `visor`,
  `wristAccessory`), 10 Gegenstände (5 je Figur), `isCosmeticCompatible`, `cosmeticsForSlot`.
  Reservierte, **nicht befüllte** Felder `LayerGeometry`/`AssetAlignment` für die spätere
  Ausrichtung.
- **`shared/characters.ts`**: Charakter-Asset-Metadaten, `findCharacterAssets`,
  `defaultAvatarConfig`, `validateAvatarConfig`.
- **Regel (Phase 5c §3.2):** Ein Gegenstand ist **charakterexklusiv**. `validateAvatarConfig` lehnt
  einen Ethan-Gegenstand auf Maya (und umgekehrt) mit 422 ab; der Editor bietet fremde Gegenstände
  erst gar nicht an. Der Test prüft **beide Richtungen**.

## 4. Warum **keine** gestapelte Layerdarstellung (wichtig)

Die gelieferten Einzel-Grafiken sind **nicht** auf eine gemeinsame Zeichenfläche ausgerichtet. Die
Metadaten des Projektverantwortlichen melden `not_defined`/`not_validated`, und die Abmessungen sind
je Datei unterschiedlich (z. B. 512 × 321 bis 512 × 1157). Es gibt daher **keinen** belegten
Ankerpunkt, **keine** Skalierung und **keine** Ebenenreihenfolge.

Erfundene Koordinaten würden die Figuren falsch zusammensetzen — genau Fehlerquelle 6 aus §53 des
Briefings. Deshalb:

- Der Katalog markiert jeden Gegenstand `alignment: 'not_aligned'`.
- Die Vorschau zeigt die **gelieferte** Figur (`*_full_preview.webp`) und die ausgerüsteten
  Gegenstände als eigene, beschriftete **Thumbnails**.
- Sobald die **ausgerichteten Layer** (gemeinsame Zeichenfläche, Ankerpunkt, `zIndex`, optional
  Skalierung) vorliegen, wird **nur** `packages/frontend/src/avatar.ts` erweitert; der Katalog erhält
  dann `layerGeometry` und `alignment: 'aligned'`.

**Angefordert (Asset-Briefing Block C, gesondert):** je Figur eine gemeinsame Zeichenfläche, ein
gemeinsamer Ankerpunkt und die Ebenenreihenfolge.

## 5. Bestandsschutz

- Keine Frage, Antwort, kein Konto, keine Rolle, keine Berechtigung, kein API-Vertrag verändert oder
  entfernt.
- Die Migration ist **rein additiv** (eine nullable Spalte); kein bestehendes Feld ändert sich.
- `PUT /api/profile` (6.6) behält seinen Vertrag; es liefert zusätzlich `avatarConfig`.
- Kein Produktivsystem, kein Portainer, kein Deployment berührt.

## 6. Tests und Prüfungen (alle grün)

| Prüfung                           | Ergebnis                                                      |
| --------------------------------- | ------------------------------------------------------------- |
| Shared (vitest)                   | **135/135** (davon `characters.test.ts` **29/29**)            |
| Backend (vitest, PostgreSQL)      | **297/297** (davon `avatar.integration.test.ts` **23/23**)    |
| Frontend (vitest)                 | **382/382** (davon `avatar.test.ts` 10, `profile.test.ts` 24) |
| Typecheck (alle Workspaces)       | **grün**                                                      |
| Build (`npm run build`)           | **grün**                                                      |
| Prettier `format:check .`         | **grün**                                                      |
| Prisma `migrate deploy` (Test-DB) | **grün**                                                      |
| Asset-Prüfung                     | 14 Dateien byte-identisch, gültiges WebP mit Alpha            |

**Während der Testarbeit gefundener und behobener Fehler:** `validateAvatarConfig` akzeptierte ein
**eingeschmuggeltes Zusatzfeld**, wenn `equipment` fehlte (das Default-Kit überschrieb die Fehler).
Behoben: Das Default-Kit wird nur noch geliefert, wenn **keine** weiteren Fehler vorliegen; ein
Regressionstest in `shared` und ein Integrationstest in `backend` decken den Fall ab.

## 7. Abhängigkeiten / Risiken

- **Gestapelter PR:** baut auf 6.6.3 (PR offen). Reihenfolge: 6.6.3 mergen → dann 6.7.
- **Offen:** ausgerichtete Layer-Grafiken (Block C) für die gestapelte Darstellung.
- **Offen:** Assets für `pixel`, `bee`, `dr-obscura`, `o-bot` (Block B) — im Auswahlkatalog
  vorhanden, als `awaiting_assets` gemeldet, **kein** Ersatzbild.
- **Nicht in dieser Phase:** XP/Level/Inventar/Freischaltungen (Phase 6.8) und Beamer-Darstellung
  der Avatare (Phase 6.9).

## 8. Geänderte / neue Dateien

**Neu:** `packages/shared/src/characters.ts`, `packages/shared/src/cosmetics.ts`,
`packages/shared/src/characters.test.ts`, `packages/backend/src/avatar.integration.test.ts`,
`packages/backend/prisma/migrations/20261111120000_phase_6_7_avatar_config/migration.sql`,
`packages/frontend/src/avatar.ts`, `packages/frontend/src/avatar.test.ts`,
`packages/frontend/public/characters/**` (14 WebP).

**Geändert:** `packages/shared/src/index.ts`, `packages/shared/src/profile.ts`,
`packages/backend/prisma/schema.prisma`, `packages/backend/src/services/profileService.ts`,
`packages/backend/src/routes/profileRoutes.ts`, `packages/frontend/src/pages/profile.ts`,
`packages/frontend/src/profile.test.ts`, `packages/frontend/src/design-system.test.ts`,
`packages/frontend/src/styles/tokens.css`.

**Dokumentation:** `docs/assets/CHARACTER-CATALOGUE.md` (neu), `docs/assets/ASSET-BRIEFING.md`
(Block B/C Status), `docs/roadmap/technical-roadmap.md` §8, `docs/concept/game-design-concept.md`
§3.3/§3.4.

## 9. Offene Fragen an chrisB

1. **Ausgerichtete Layer:** Werden die fünf Gegenstände je Figur auf eine **gemeinsame
   Zeichenfläche** mit **Ankerpunkt** und **Ebenenreihenfolge** geliefert (für die gestapelte
   Darstellung)? Bis dahin bleibt die Thumbnail-Darstellung.
2. **Weitere Figuren:** Wann kommen die Assets für `pixel`, `bee`, `dr-obscura`, `o-bot`?
3. **Freigabe** dieser Phase (Merge von 6.6.3 vorausgesetzt).
