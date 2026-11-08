# ZeroPeek – Charakter- und Gegenstandskatalog (Phase 6.7)

**Stand:** Phase 6.7 (Blockwelt-Helden-Avatar-System)
**Grundlage:** geliefertes Asset-Paket des Projektverantwortlichen
(`ZeroPeek_Ethan_Maya_Charakterbibliothek.zip`), verifiziert gegen die Metadaten im Paket.

> **Keine Bildanalyse.** Geprüft wurden ausschließlich technische Eigenschaften (Format,
> Abmessung, Alphakanal, Dateigröße) und die byte-identische Übernahme. Kein OCR, keine
> Vision-Modelle, keine automatische Bildinterpretation. Es wurde **kein** Bild erzeugt oder ersetzt.

---

## 1. Gelieferte Figuren

Das Paket enthält **zwei** vollständige Figuren. Weitere kanonische Figuren
(`pixel`, `bee`, `dr-obscura`, `o-bot`) bleiben im Auswahlkatalog, haben aber **keine** Assets und
werden als `awaiting_assets` gemeldet. Für sie wird **kein** Avatar und **kein** Ersatzbild erzeugt.

| Figur | Katalog-Id | Status        | Grafikdateien |
| ----- | ---------- | ------------- | ------------- |
| Ethan | `ethan`    | **verfügbar** | 7 WebP        |
| Maya  | `maya`     | **verfügbar** | 7 WebP        |

---

## 2. Dateien je Figur

Alle Dateien wurden **unverändert** (byte-identisch, SHA-256 geprüft) aus dem Paket übernommen.
Jede Datei ist **WebP mit Alphakanal** (`VP8X`, Alpha-Flag gesetzt).

### Ethan – `packages/frontend/public/characters/ethan/`

| Datei                     | Rolle          | Abmessung  | Größe     | Alpha |
| ------------------------- | -------------- | ---------- | --------- | :---: |
| `ethan_full_preview.webp` | Vollbild       | 512 × 923  | 131 588 B |  ja   |
| `ethan_base_current.webp` | Grundfigur     | 512 × 1157 | 128 018 B |  ja   |
| `visor_cyber.webp`        | Visier         | 512 × 321  | 50 544 B  |  ja   |
| `outfit_standard.webp`    | Kleidung       | 512 × 611  | 100 712 B |  ja   |
| `backpack_tech.webp`      | Rucksack       | 512 × 519  | 73 248 B  |  ja   |
| `compass_pendant.webp`    | Halsaccessoire | 512 × 581  | 94 666 B  |  ja   |
| `wristband_tech.webp`     | Handgelenk     | 512 × 481  | 82 742 B  |  ja   |

### Maya – `packages/frontend/public/characters/maya/`

| Datei                      | Rolle          | Abmessung | Größe     | Alpha |
| -------------------------- | -------------- | --------- | --------- | :---: |
| `maya_full_preview.webp`   | Vollbild       | 512 × 992 | 146 350 B |  ja   |
| `maya_base.webp`           | Grundfigur     | 512 × 866 | 107 994 B |  ja   |
| `visor_headset_cyber.webp` | Visier         | 512 × 455 | 58 890 B  |  ja   |
| `outfit_standard.webp`     | Kleidung       | 512 × 748 | 86 822 B  |  ja   |
| `backpack_tech.webp`       | Rucksack       | 512 × 534 | 67 002 B  |  ja   |
| `compass_pendant.webp`     | Halsaccessoire | 512 × 743 | 102 076 B |  ja   |
| `wristband_tech.webp`      | Handgelenk     | 512 × 549 | 78 468 B  |  ja   |

**Gesamt:** 14 Dateien, ca. 1,3 MB.

---

## 3. Ausrüstungsslots (Phase 6.7)

Die fünf Slots der beiden gelieferten Figuren:

| Slot             | Bezeichnung (UI) | Ethan           | Maya                  |
| ---------------- | ---------------- | --------------- | --------------------- |
| `backpack`       | Backpack         | Tech Backpack   | Tech Backpack         |
| `outfit`         | Outfit           | Standard Outfit | Standard Outfit       |
| `neckAccessory`  | Neck accessory   | Compass Pendant | Compass Pendant       |
| `visor`          | Visor            | Cyber Visor     | Cyber Visor & Headset |
| `wristAccessory` | Wrist accessory  | Tech Wristband  | Tech Wristband        |

Jeder Slot hat **genau einen** Gegenstand je Figur. Jeder Gegenstand ist **charakterexklusiv**
(Phase 5c §3.2): ein Ethan-Visier ist eine **andere Datei** als ein Maya-Visier und wird auf Maya
**gar nicht** angeboten. Das Default-Kit wird aus den eigenen Gegenständen der Figur abgeleitet.

---

## 4. Layer-Geometrie – **nicht** definiert (offen)

Die gelieferten Einzel-Grafiken sind **nicht** auf eine gemeinsame Zeichenfläche ausgerichtet. Die
Metadaten des Verantwortlichen melden für jedes Layer `not_defined` / `not_validated`, und die
Abmessungen sind je Datei **unterschiedlich** (z. B. 512 × 321 bis 512 × 1157). Es gibt daher
**keinen** gemeinsamen Ankerpunkt, **keine** Skalierung und **keine** Ebenenreihenfolge, die
technisch belegt wären.

**Konsequenz (verbindlich):** Es wird **keine** Position/Skalierung/Reihenfolge erfunden. Der Katalog
markiert jeden Gegenstand `alignment: 'not_aligned'`, und die Vorschau zeigt die gelieferte Figur
plus die ausgerüsteten Gegenstände als eigene Thumbnails.

**Benötigt für die gestapelte Darstellung** (gesondert beim Projektverantwortlichen angefordert):

- eine **gemeinsame Zeichenfläche** je Figur (gleiche Abmessung für Grundfigur und alle Layer),
- ein **gemeinsamer Ankerpunkt** (z. B. Füße auf gleicher Linie),
- die **Ebenenreihenfolge** (`zIndex`) je Slot,
- optional eine **Skalierungsangabe** je Layer.

Sobald diese Angaben vorliegen, wird **nur** `packages/frontend/src/avatar.ts` erweitert und der
Katalog erhält `layerGeometry` und `alignment: 'aligned'`.

---

## 5. Katalog als Code (nicht in der Datenbank)

Der Katalog ist **Quellcode** in `@zeropeek/shared` (`characters.ts`, `cosmetics.ts`) – versioniert
mit der Anwendung, damit ein Client keinen Gegenstand erfinden kann. Die **Datenbank** speichert nur
**Zustand**: `PlayerProfile.avatarConfig` (JSONB) mit `characterId` und dem ausgerüsteten Gegenstand
je Slot. Die serverseitige Validierung (`validateAvatarConfig`) lehnt unbekannte Figuren,
unbekannte Gegenstände, falsche Slots und **fremde** Gegenstände ab.
