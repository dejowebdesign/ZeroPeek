# Phase 4 – Zentrales Bild- und Audio-Asset-Briefing

**Projekt:** ZeroPeek
**Phase:** 4 – Asset-Briefing
**Datum:** 2026-11-04
**Status:** Anforderung an den Projektverantwortlichen
**Grundlage:** Briefing Teil K, L, R; `docs/analysis/phase-1-technical-inventory.md`

> **Regel (Briefing §29–32):** Die individuellen Hintergrundbilder, Charakter-Originale und Audios
> werden vom **Projektverantwortlichen** bereitgestellt. OpenHands darf **keine** KI-generierten
> Ersatzbilder, **keine** Stockbilder und **keine** Platzhalter als endgültige Lösung einsetzen.
> Fehlende Dateien werden **angefordert** und der davon abhängige Schritt **wartet**.
>
> **In diesem Auftrag wurde nichts erzeugt, geändert oder ersetzt.** Es wurden ausschließlich
> technische Eigenschaften vorhandener Dateien geprüft (Format, Abmessung, Alphakanal, Größe) –
> keine Bildanalyse, kein OCR, keine Vision.

---

## 0. Vorhandene Assets (Stand nach Phase 5b)

| Asset         | Pfad                                   | Format   | Abmessung | Alpha    | Größe     | Status                                   |
| ------------- | -------------------------------------- | -------- | --------- | -------- | --------- | ---------------------------------------- |
| Logo          | `packages/frontend/public/logo.png`    | PNG RGBA | 480 × 160 | ja       | 80 622 B  | **optimiert (Phase 5b), Alpha erhalten** |
| Favicon       | `packages/frontend/public/favicon.png` | PNG RGB  | 256 × 256 | **nein** | 109 606 B | **optimiert, ohne Transparenz**          |
| Favicon (SVG) | –                                      | –        | –         | –        | –         | **entfernt (war verwaist)**              |

**Phase 5b – bereits erledigt (kein neuer Bedarf):**

- Das **Logo** war 2172 × 724 / 1,20 MB und ist jetzt **480 × 160 / 81 KB** – verlustfrei skaliert,
  Alpha erhalten, **nicht** neu gezeichnet.
- Das **Favicon** war 1254² / 1,63 MB und ist jetzt **256² / 110 KB** – verlustfrei skaliert.
- Die **verwaiste `favicon.svg`** (0 Referenzen im Code) wurde entfernt; aus der Historie
  wiederherstellbar, falls sie doch Bestand haben soll.

**Offene Punkte:**

1. **Favicon-Transparenz:** Die vorhandene `favicon.png` hat **keinen** Alphakanal, und der Rand ist
   **nicht homogen weiß** (RGB 200–255; nur 30,4 % „fast weiß"). Ein automatisches Freistellen würde
   einen sichtbaren Saum erzeugen und wurde deshalb **unterlassen**. Bitte eine **transparente
   Master-Datei** bereitstellen (bevorzugt), oder die aktuelle bewusst als Kachel verwenden.
   **Keine eigenmächtige Korrektur.**
2. **`favicon.svg`:** Bitte bestätigen, dass die entfernte Datei nicht mehr benötigt wird.
3. **Logo-Größe:** durch Phase 5b **erledigt** (81 KB).

---

## Block A – Logo und Favicon

| Feld                 | Inhalt                                                          |
| -------------------- | --------------------------------------------------------------- |
| **Asset**            | `brand-logo-optimized` (optional, gleiche Optik)                |
| **Verwendung**       | Kopfzeile, Login-Karte                                          |
| **Bildschirm**       | Alle                                                            |
| **Komposition**      | Unverändert wie vorhandenes Logo                                |
| **Auflösung**        | wie vorhanden (2172 × 724), transparent                         |
| **Seitenverhältnis** | ≈ 3:1                                                           |
| **Format**           | PNG (RGBA) oder WebP mit Alpha                                  |
| **Transparenz**      | ja                                                              |
| **Zielpfad**         | `packages/frontend/public/logo.png` (nur bei Freigabe ersetzen) |
| **Animation**        | nein                                                            |

| Feld            | Inhalt                                 |
| --------------- | -------------------------------------- |
| **Asset**       | `favicon`                              |
| **Verwendung**  | Browser-Tab, Startbildschirm           |
| **Auflösung**   | 512 × 512 (empfohlen), quadratisch     |
| **Format**      | PNG (RGBA) oder ICO/WebP               |
| **Transparenz** | **ja** (gewünscht)                     |
| **Zielpfad**    | `packages/frontend/public/favicon.png` |
| **Animation**   | nein                                   |

---

## Block B – Charaktere (Blockwelt-Helden)

> **Diese Dateien fehlen vollständig.** Ohne sie ist Phase 6.7 nicht startbar.

Für jede Figur werden benötigt:

| Feld                 | Inhalt                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| **Asset**            | `character-<id>-base` (z. B. `character-ethan-base`)                                      |
| **Verwendung**       | Charakterauswahl, Profil, Spieler-Anzeige, Rangliste, Beamer                              |
| **Bildschirm**       | Profil, Avatar-Editor, Spieler, Beamer                                                    |
| **Komposition**      | Figur zentriert, vollständig sichtbar, einheitlicher Ankerpunkt (Füße auf gleicher Linie) |
| **Gestaltung**       | Blockwelt-Helden-Stil, Voxel/Pixel-Art, klare Silhouette (Briefing §13)                   |
| **Auflösung**        | Vorschlag: 1024 × 1024 (Reserve für große Darstellung), plus kleinere Variante optional   |
| **Seitenverhältnis** | 1:1                                                                                       |
| **Format**           | PNG (RGBA)                                                                                |
| **Transparenz**      | **ja** (zwingend)                                                                         |
| **Zielpfad**         | `packages/frontend/public/characters/<id>-base.png`                                       |
| **Animation**        | optional: Idle-Frames später; zunächst statisch                                           |

**Figuren (aus Briefing §12, Phase 5c):** Geplant sind ungefähr **15 Avatare** aus dem
Blockwelt-Helden-Universum, inklusive passender **Tiere und Insekten**. Namentlich bekannt:
`ethan`, `maya`, `pixel` (Hund), `bee` (Biene), `dr-obscura`, `o-bot` (ggf. mehrere O-Bot-Typen).
Die **endgültige Charakterliste** richtet sich nach den Originalassets des Projektverantwortlichen.

**Bitte zusätzlich:** Original-Referenzdateien des Blockwelt-Helden-Universums (Briefing §32), damit
Stil, Proportionen und Farben verbindlich sind.

---

## Block C – Avatar-Gegenstände (Layer, charakterexklusiv)

> **Diese Dateien fehlen vollständig.** Benötigt für Phase 6.7/6.8.

**Verbindlich (Phase 5c):** **Jeder Avatar besitzt seine eigenen Gegenstände.** Es gibt **keinen**
allgemeinen Gegenstandskatalog. Ein Hut für Ethan ist eine **andere Datei** als ein Hut für Pixel.
Jeder Gegenstand ist **ausschließlich für seinen Charakter** verfügbar und muss am Avatar **sichtbar**
ausrüstbar sein (nicht nur als Inventar-Icon).

Jeder Gegenstand wird als **transparentes Layer** geliefert, exakt auf der Zeichenfläche **seines
Charakters** (gleiche Auflösung, gleicher Ankerpunkt), damit er ohne Nachjustierung passt.

| Feld                 | Inhalt                                                                      |
| -------------------- | --------------------------------------------------------------------------- |
| **Asset**            | `cosmetic-<characterId>-<slot>-<name>` (z. B. `cosmetic-ethan-hat-basecap`) |
| **Verwendung**       | Avatar-Editor, Profil, Rangliste, Beamer                                    |
| **Auflösung**        | **identisch zur Figur** (Vorschlag 1024 × 1024)                             |
| **Seitenverhältnis** | 1:1                                                                         |
| **Format**           | PNG (RGBA)                                                                  |
| **Transparenz**      | **ja** (zwingend)                                                           |
| **Zielpfad**         | `packages/frontend/public/cosmetics/<characterId>/<slot>/<name>.png`        |
| **Animation**        | nein                                                                        |

### Ausrüstungsslots (verbindlich, pro Charakter definiert)

Jeder Charakter hat die für ihn sinnvollen Slots. Vorschlag: `hat`, `glasses`, `outfit`, `tool`,
`back` (Rucksack/Umhang), `neck` (nur Pixel: Halsband), `wings` (nur Biene), `sensor` (nur O-Bot),
`color` (Fell-/Flügel-/Akzentfarbe), `effect`.

### Layer-Reihenfolge (z–E, verbindlich als Spezifikation)

```
1. Hintergrund/Effekt (hinter der Figur)
2. Körper der Figur (Basismodell)
3. Fell-/Akzentfarbe (Variante des Basismodells)
4. Kleidung/Outfit
5. Umhang (hinter Armen, aber vor Körper)   ← Sonderfall, eigene Reihenfolge
6. Brille
7. Kopfbedeckung
8. Werkzeug (vor Körper)
9. Rucksack (hinter Körper)                  ← Sonderfall
10. Vordergrund-Effekt
```

Jedes Layer erhält einen `zIndex`; die Reihenfolge ist Teil der Asset-Spezifikation.

**Benötigte Kategorien und Gegenstände (Designidee, aus Briefing §14).** Die **konkreten
Einzelgegenstände pro Charakter** legt der Projektverantwortliche fest.

| Kategorie        | Gegenstände (Vorschlag)                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| Kopfbedeckung    | Basecap, Bauhelm, Krone, Zauberhut, Helm, besondere Kopfbedeckung                      |
| Brille           | Sonnenbrille, Schutzbrille, Fantasiebrille, futuristische Brille                       |
| Kleidung         | Hoodie, Abenteuerkleidung, Rüstung, Superhelden-Outfit, besonderes Kostüm              |
| Werkzeug         | Spitzhacke, Schaufel, Axt                                                              |
| Rucksack/Umhang  | Rucksack, Umhang, Gürtel                                                               |
| Selten           | goldene Spitzhacke, Diamant-Spitzhacke, seltene Rüstung, exklusives Accessoire, Effekt |
| Figur-spezifisch | Halsband (Pixel), Flügel-/Muster-Varianten (Biene), Fellfarben (Pixel), Sensor (O-Bot) |

**Wichtig:** Für **jede Figur**, die einen Gegenstand tragen kann, wird das Layer in der passenden
Form benötigt (siehe Kompatibilitätsmatrix, game-design-concept §3.2a). Die Layer müssen auf der
Zeichenfläche des jeweiligen Charakters ausgerichtet sein (Ankerpunkt, Position, Größe).

---

## Block D – Hintergrundbilder und Beamer-Grafiken

> **Diese Dateien fehlen vollständig.** Benötigt für Phase 6.9/6.10.

**Verbindlich (Phase 5c):** Standard ist **Zufall**; der Hintergrund wird **genau einmal je Runde**
bestimmt und bleibt für alle gleich. Stil: **dunkel, Wireframe-Linien, perspektivische Räume, dezente
geometrische Architektur, gedämpfte Farben**. **Keine** gerenderten 3D-Objekte, **keine** realistischen
3D-Räume, **keine** grellen Neonflächen.

| Feld                 | Inhalt                                                                      |
| -------------------- | --------------------------------------------------------------------------- |
| **Verwendung**       | Host-/Beamer-Ansicht (kombiniert), Login, ausgewählte Bereiche              |
| **Komposition**      | **Freie, gut lesbare zentrale Fläche** für Fragen/Antworten (Briefing §28)  |
| **Gestaltung**       | Dark Retro-Futuristic Wireframe, ZeroPeek-Farbschema (violett/cyan), dunkel |
| **Auflösung**        | Vorschlag: 2560 × 1440 (Reserve für große Bildschirme)                      |
| **Seitenverhältnis** | 16:9                                                                        |
| **Format**           | optimiertes Webformat (WebP oder AVIF, PNG als Rückfall)                    |
| **Transparenz**      | nein (Vollbild), außer bei Overlay-Grafiken                                 |
| **Zielpfad**         | `packages/frontend/public/backgrounds/<name>.webp`                          |
| **Animation**        | nein (Bewegung nur dezent per CSS, wo sinnvoll)                             |

**Vorgeschlagene Motive (Umgebungen aus Phase 5c):**

| Asset-Name                   | Verwendung                   | Motiv (Wireframe, dunkel)                          |
| ---------------------------- | ---------------------------- | -------------------------------------------------- |
| `bg-retro-grid`              | Zufallspool / Szene 1        | Retro Grid, ruhig                                  |
| `bg-future-classroom`        | Zufallspool                  | Future Classroom, dezente Architektur              |
| `bg-quiz-arena`              | Zufallspool / Szene 5–7      | Quiz Arena, **starke zentrale Freifläche**         |
| `bg-spaceship-bridge`        | Zufallspool                  | Spaceship Bridge, perspektivisch                   |
| `bg-simulation-room`         | Zufallspool                  | Simulation Room, geometrisch                       |
| `bg-blockworld-future-world` | Zufallspool                  | Blockwelt Future World, dezent                     |
| `beamer-welcome-background`  | Szene 1 Begrüßung            | ruhige Game-Show-Bühne                             |
| `beamer-lobby-background`    | Szene 2/3 Beitritt/Übersicht | Platz für PIN, QR-Code und Avatar-Wand             |
| `beamer-reveal-background`   | Szene 8/9 Auflösung/Punkte   | Raum für Balken                                    |
| `beamer-board-background`    | Szene 10 Rangliste           | Platz für Liste                                    |
| `beamer-final-background`    | Szene 11/12 Finale/Podium    | dramatische Finalkulisse                           |
| `beamer-podium-background`   | Szene 12 Gewinnerpodium      | Siegerpodium, Platz für 3 Figuren                  |
| `beamer-outro-background`    | Szene 13 Abschluss           | ruhiger Ausklang                                   |
| `login-background`           | Login                        | Sternenhimmel-Basis (violette/cyanfarbene Akzente) |
| `adventure-landscape`        | optional Profil/Startseite   | Blockwelt-Abenteuerlandschaft                      |

**Regel:** Fragen und Antworten bleiben **immer** im Vordergrund. Hintergründe dürfen Text nicht
schwer lesbar machen (ausreichend Kontrast in der zentralen Fläche).

---

## Block E – Icons

| Feld           | Inhalt                                              |
| -------------- | --------------------------------------------------- |
| **Verwendung** | Navigation, Kategorien, Status, Erfolge             |
| **Format**     | SVG (bevorzugt, scharf, klein) oder PNG mit Alpha   |
| **Größe**      | 24 × 24 Basis (SVG skaliert)                        |
| **Zielpfad**   | `packages/frontend/public/icons/<name>.svg`         |
| **Stil**       | einheitliche Linienstärke, passend zum Designsystem |

**Benötigt (Vorschlag):** Start, Quiz, Editor, Host, Profil, Avatar, Inventar, Rangliste, Statistik,
Admin, Einstellungen, Kopfbedeckung, Brille, Kleidung, Werkzeug, Rucksack, Erfolg, Level, XP, Sperre,
richtig, falsch, Uhr, Verbindung, Ton an/aus, Pause, Weiter, Beenden, Zufall.

---

## Block F – Soundeffekte

> **Diese Dateien fehlen vollständig.** Benötigt für Phase 6.11.

| Feld           | Inhalt                                            |
| -------------- | ------------------------------------------------- |
| **Verwendung** | UI, Spiel, Show                                   |
| **Format**     | WebM/Opus (bevorzugt) oder MP3                    |
| **Länge**      | kurz (Effekte < 1 s, außer Sieger/Countdown)      |
| **Zielpfad**   | `packages/frontend/public/audio/sfx/<name>.<ext>` |
| **Lizenz**     | **eigene/geklärte Rechte** (Briefing §34)         |

**Benötigte Effekte (aus Briefing §33):**

| Ebene | Effekt                                                                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| UI    | `ui-click`, `ui-select`, `ui-confirm`, `ui-error`, `ui-menu-open`, `ui-menu-close`                                                      |
| Spiel | `game-start`, `countdown-tick`, `countdown-go`, `answer-correct`, `answer-wrong`, `points-gain`, `rank-change`, `final-round`, `winner` |

---

## Block G – Hintergrundmusik

> **Diese Dateien fehlen vollständig.** Benötigt für Phase 6.11.

| Feld           | Inhalt                                                               |
| -------------- | -------------------------------------------------------------------- |
| **Verwendung** | Show-Hintergrundmusik, getrennt steuerbar                            |
| **Format**     | WebM/Opus oder MP3, komprimiert                                      |
| **Länge**      | Loop-fähig, 30–90 s                                                  |
| **Zielpfad**   | `packages/frontend/public/audio/music/<name>.<ext>`                  |
| **Lizenz**     | **eigene/geklärte Rechte**; **keine** ungeklärten geschützten Stücke |

**Benötigte Stücke (aus Briefing §33):**

| Name             | Einsatz                       |
| ---------------- | ----------------------------- |
| `music-lobby`    | ruhige Musik beim Beitritt    |
| `music-question` | spannungsaufbauende Quizmusik |
| `music-final`    | dynamische Finalmusik         |
| `music-victory`  | Sieger und Abschluss          |

---

## Zusammenfassung des Asset-Bedarfs

| Block | Inhalt                         | Dateien (ca.) | Blockiert Phase    | Priorität |
| ----- | ------------------------------ | ------------- | ------------------ | --------- |
| A     | Logo/Favicon optimiert         | 1–2           | 6.3 (Optik)        | niedrig   |
| B     | Charaktere (ca. 15)            | 15+           | **6.7, 6.9, 6.10** | **hoch**  |
| C     | Avatar-Gegenstände (pro Figur) | 80–150        | **6.7, 6.8**       | **hoch**  |
| D     | Hintergrundbilder/Host-Show    | 12–15         | **6.9, 6.10**      | **hoch**  |
| E     | Icons                          | 25–30         | 6.2, 6.5           | mittel    |
| F     | Soundeffekte                   | 15            | 6.11               | mittel    |
| G     | Musik                          | 4             | 6.11               | mittel    |

**Hinweis zu Block C (Phase 5c):** Weil Gegenstände **charakterexklusiv** sind, wächst die Zahl der
Dateien mit der Zahl der Charaktere (jede Figur erhält ihre eigenen Layer in ihren eigenen Slots).
Die endgültige Zahl ergibt sich aus der Charakterliste und der Belohnungsmatrix des
Projektverantwortlichen.

**Empfehlung zur Reihenfolge der Bereitstellung:** Zuerst **Block B (Charaktere)** und **Block D
(Hintergrundbilder)**, weil daran die größten Phasen hängen. Danach **Block C (Gegenstände)**,
**Block E (Icons)**, zuletzt **Block F/G (Audio)** und **Block A (Optimierungen)**.

**Bitte gebündelt liefern**, damit die abhängigen Phasen ohne Unterbrechung laufen können
(Briefing §31). Für jeden Block gilt: Motiv beschreiben, technische Anforderungen beachten,
Zielpfad einhalten, Datei beim Projektverantwortlichen anfordern, mit dem abhängigen Schritt warten.

**Keine Ersatzbilder, keine KI-Bilder, keine Stockbilder, keine Neugestaltung der Charaktere.**
