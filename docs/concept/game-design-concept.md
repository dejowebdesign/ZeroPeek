# Phase 2 – Game-Design-Konzept (Charaktere, Fortschritt, Show, Sound)

**Projekt:** ZeroPeek
**Phase:** 2 – Produkt- und Game-Design-Konzept (Teil 2: Spiel)
**Datum:** 2026-11-04
**Status:** Entwurf zur Prüfung durch den Projektverantwortlichen (Dejan Popovic)
**Grundlage:** `docs/analysis/phase-1-technical-inventory.md`, `docs/concept/design-concept.md`

> **Kein Anwendungscode, kein Schema, keine Migration, keine Assets wurden geändert oder erzeugt.**
> Alle Werte (XP, Schwellen, Seltenheiten) sind **Vorschläge** und ausdrücklich keine entschiedenen
> Produktentscheidungen. Zahlen sind so gewählt, dass sie leicht anpassbar sind (Konfiguration, nicht
> Code).

---

## 1. Produktvision und Leitidee

ZeroPeek wird eine **Premium-Quiz- und Game-Show-Plattform mit eigenständigem Charakteruniversum**.
Der Unterschied zu einer gewöhnlichen Quiz-App ist die **Langzeitbindung durch Figuren**: Spieler
kehren zurück, weil sie ihre Blockwelt-Figur ausbauen, Erfolge sammeln und ihren Helden auf dem
Podium sehen wollen.

Drei Erlebnisse (aus `design-concept.md` §1): **Verwaltung**, **Spiel**, **Show**. Dieses Dokument
konzentriert sich auf **Spiel** und **Show** sowie auf die technische Grundlage für beides.

**Leitentscheidung (vom Briefing vorgegeben):** Die Figuren aus _Blockwelt Helden_ werden die
offiziellen Spielfiguren. Es entstehen **keine** austauschbaren Standard-Avatare.

---

## 2. Blockwelt-Helden-Universum

### 2.1 Verbindliche Charaktere (aus dem Briefing, §12)

| Figur            | Rolle im Universum | Vorgesehene Einordnung in ZeroPeek                            |
| ---------------- | ------------------ | ------------------------------------------------------------- |
| **Ethan**        | Zentraler Held     | **Spielbar von Anfang an**; Standardfigur                     |
| **Maya**         | Zentrale Heldin    | **Spielbar von Anfang an**; Standardfigur                     |
| **Pixel** (Hund) | Begleiter          | Spielbar; besondere Anpassungen (Halsband, Brille, Fellfarbe) |
| **Die Biene**    | Besondere Figur    | Spielbar; besondere Anpassungen (Flügel, Muster, Effekte)     |
| **Dr. Obscura**  | Antagonist         | **Freischaltbar** (selten, z. B. hohes Level oder Erfolg)     |
| **O-Bot-Typen**  | Gegner/Schergen    | **Freischaltbar** (selten) oder als Podium-/Show-Figuren      |

> **Bestand:** Im Repository existieren **keine** dieser Figuren – weder Grafik noch Datenmodell.
> Die Originaldateien werden vom Projektverantwortlichen bereitgestellt (siehe `docs/assets/ASSET-BRIEFING.md`,
> Block B). Ohne sie ist Phase 6.7 nicht startbar.

### 2.2 Charakterstil (verbindlich, aus Briefing §13)

- Blockfiguren, Voxel-Optik, Pixel-Art.
- Klare Formen, prägnante Silhouetten, wiedererkennbare Farben.
- Einheitliche Proportionen, saubere Konturen.
- **Keine** realistischen Figuren, **keine** generischen 3D-Cartoon-Figuren.
- **Keine** eigenmächtigen Neugestaltungen. Originalreferenzen sind maßgeblich.

**Regel für OpenHands:** Es werden **keine** Charaktere gezeichnet, generiert oder „nachempfunden".
Fehlende Figuren werden **angefordert**, nicht ersetzt (Briefing §13, §29, §32).

### 2.3 Vorgeschlagene Charakter-Eigenschaften (Spielwerte, nicht Grafik)

Jeder Charakter bekommt **rein kosmetische** Eigenschaften. **Keine spielerischen Vorteile**
(Briefing §19). Vorschlag für die Anzeige:

| Feld             | Beispiel                                               | Zweck                          |
| ---------------- | ------------------------------------------------------ | ------------------------------ |
| `id`             | `ethan`, `maya`, `pixel`, `bee`, `dr-obscura`, `o-bot` | Stabiler Schlüssel             |
| `name`           | „Ethan"                                                | Anzeige                        |
| `tagline`        | „Der Bauheld"                                          | kurze Charakterisierung        |
| `rarity`         | `common` / `rare` / `legendary`                        | Rahmen und Farbgebung im UI    |
| `unlockRule`     | z. B. `level:5`, `achievement:first-win`, `default`    | Freischaltbedingung            |
| `accessorySlots` | z. B. `["hat","glasses","outfit","tool","back"]`       | Kompatibilitätsmatrix          |
| `defaultPalette` | Farbnamen                                              | Standardfarben für Anpassungen |

**Wichtig:** Diese Eigenschaften sind **Konzept**. Sie werden erst nach Freigabe modelliert.

---

## 3. Avatar-System und Charaktereditor

### 3.1 Anpassbare Kategorien (aus Briefing §14)

| Kategorie           | Beispiele                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Kopfbedeckung       | Basecap, Bauhelm, Krone, Zauberhut, Helme, besondere Kopfbedeckungen                                |
| Brille              | Sonnenbrille, Schutzbrille, Fantasiebrille, futuristische Brille                                    |
| Kleidung            | Hoodie, Abenteuerkleidung, Rüstung, Superhelden-Outfit, besondere Kostüme                           |
| Werkzeug/Ausrüstung | Spitzhacke, Schaufel, Axt, Rucksack, Gürtel, Umhang                                                 |
| Seltene Gegenstände | goldene Spitzhacke, Diamant-Spitzhacke, seltene Rüstungen, exklusive Accessoires, besondere Effekte |
| Farbe (wo passend)  | Fellfarbe (Pixel), Flügel-/Musterfarbe (Biene), Akzentfarbe                                         |

### 3.2 Charakterbezogene Besonderheiten (Briefing §15)

Nicht jeder Gegenstand passt zu jeder Figur. Vorschlag für die **Kompatibilitätsmatrix** (Auszug,
vollständige Matrix als Tabelle im Konzept, Umsetzung erst nach Freigabe):

| Gegenstand-Kategorie | Ethan | Maya |      Pixel      |      Biene       | Dr. Obscura |      O-Bot      |
| -------------------- | :---: | :--: | :-------------: | :--------------: | :---------: | :-------------: |
| Kopfbedeckung        |   ✔   |  ✔   |  ✔ (Hundehut)   |    ✔ (klein)     |      ✔      |        ✔        |
| Brille               |   ✔   |  ✔   |        ✔        | ✖ (Augen anders) |      ✔      |   ✔ (Sensor)    |
| Kleidung/Outfit      |   ✔   |  ✔   | ✔ (Hundemantel) |        ✖         |      ✔      |        ✖        |
| Halsband             |   ✖   |  ✖   |        ✔        |        ✖         |      ✖      |        ✖        |
| Flügel/Muster        |   ✖   |  ✖   |        ✖        |        ✔         |      ✖      |        ✖        |
| Fell-/Akzentfarbe    |   ✔   |  ✔   |    ✔ (Fell)     |    ✔ (Flügel)    |      ✔      |        ✔        |
| Werkzeug             |   ✔   |  ✔   |        ✖        |        ✖         |      ✔      | ✔ (Werkzeugarm) |
| Rucksack/Umhang      |   ✔   |  ✔   |  ✔ (Rucksack)   |        ✖         |      ✔      |        ✖        |
| Effekt               |   ✔   |  ✔   |        ✔        |        ✔         |      ✔      |        ✔        |

**Regel:** Ein nicht kompatibles Teil wird im Editor **gar nicht angeboten** (nicht nur ausgegraut),
damit keine falsche Kombination entstehen kann (Briefing §53, Fehlerquelle 6).

### 3.3 Technische Architektur des Avatar-Editors (Briefing §16)

Das Briefing verlangt ausdrücklich, **nicht** zu raten, sondern anhand der tatsächlichen
Frontend-Architektur zu entscheiden. Die tatsächliche Architektur (verifiziert, Bestandsaufnahme §1):

- **Vanilla TypeScript**, Multi-Page, keine UI-Bibliothek.
- **Strenge CSP**: `img-src 'self' data:`, `style-src 'self'` (kein Inline).
- **DOM-Builder** mit `textContent`; dynamische Stile nur über CSSOM.
- Statische Assets in `packages/frontend/public/`.

Daraus folgen die Optionen:

| Verfahren                              | Bewertung in **dieser** Architektur                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transparente PNG-Layer** (gestapelt) | **Empfohlen.** Passt zu `img-src 'self'`, kein Inline-CSS, scharf bei jeder Größe, cachefreundlich, einzeln austauschbar. Nachteil: viele kleine Dateien, HTTP-Anzahl (mit HTTP/2 unkritisch). |
| Spritesheet + `background-position`    | Möglich, aber CSS-Positionierung je Kombination ist fehleranfällig und schlecht wartbar.                                                                                                       |
| CSS-Komposition (`mask`, `clip-path`)  | Zu wenig Kontrolle über Pixel-Art-Kanten; CSP-unkritisch, aber optisch unsicher.                                                                                                               |
| Inline-SVG-Layer                       | Gut für Icons, aber die Figuren sind Rasterkunst (PNG) – SVG wäre eine Neugestaltung (verboten).                                                                                               |

**Empfehlung:** **PNG-Layer-Stapelung** mit fester Zeichenfläche und festen Ankerpunkten je Figur.
Begründung: bestandskonform (CSP, keine neuen Abhängigkeiten), scharf auf Desktop und Smartphone,
einzeln austauschbar, einzeln cachebar. Die Layer werden als `<img>` absolut übereinander positioniert
(Container mit `position: relative`), Skalierung über CSS-Variablen – **keine** Inline-Styles.

**Offene Frage:** Ob PNG-Layer oder ein späteres Canvas-Rendering gewählt wird, soll anhand von
**echten** Charakterdateien entschieden werden. Ohne Assets bleibt das eine Empfehlung, keine
Festlegung.

### 3.4 Vorgeschlagene Layer-Reihenfolge (z–E)

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

**Regel:** Die Reihenfolge ist Teil der Asset-Spezifikation (jedes Layer hat einen `zIndex`). Sie
wird im Asset-Briefing dokumentiert, damit die Layer passend exportiert werden können.

### 3.5 Darstellung und Schärfe

- Figuren werden als **Rasterkunst** in ausreichender Auflösung geliefert (Asset-Briefing).
- Für große Darstellungen (Profil, Podium) gibt es eine **große Variante** oder eine verlustfreie
  Skalierung; Pixel-Art wird mit `image-rendering: pixelated` scharf gehalten, **wenn** die Quelle
  Pixel-Art ist.
- Auf Smartphone wird dieselbe Datei kleiner skaliert (kein zweites Asset nötig, solange die
  Auflösung Reserve hat).

---

## 4. Spielerprofile

### 4.1 Gastspieler vs. registrierter Spieler (Briefing §11)

| Merkmal             | Gastspieler                                                       | Registrierter Spieler     |
| ------------------- | ----------------------------------------------------------------- | ------------------------- |
| Beitritt            | PIN + Nickname, sofort                                            | Login, dann Beitritt      |
| Profil              | temporär (nur im Spiel)                                           | dauerhaft                 |
| Avatar              | Standardfigur, keine Auswahl                                      | eigene Figur + Ausrüstung |
| Spielhistorie       | nein (nur Spielergebnis)                                          | ja                        |
| XP / Level          | **nein**                                                          | ja                        |
| Inventar / Erfolge  | **nein**                                                          | ja                        |
| Späteres Verknüpfen | **konzeptionell berücksichtigt** (Konto übernimmt das Gastprofil) | –                         |

**Bestand:** Heute gibt es **nur** Gastspieler (`GamePlayer` ohne `User`-Bezug). Registrierte
Spieler sind neu. Bestehende `ADMIN`/`TRAINER`-Konten bleiben unverändert.

### 4.2 Profilinhalt (Briefing §17)

Benutzername, gewählter Charakter, aktueller Avatar, Gesamtpunktzahl, Erfahrungspunkte,
Spielerlevel, Erfolge, Spielhistorie, richtige Antworten, Trefferquote, persönliche Bestleistungen,
freigeschaltete Gegenstände.

### 4.3 Darstellung

Großes, hochwertiges Charakterbild im Zentrum; Level und XP prominent; Statistiken als Kacheln;
Erfolge als Galerie; gesperrte Erfolge als Silhouette mit Bedingung. Details siehe
`design-concept.md` §8.8.

---

## 5. Erfahrungspunkte und Level

### 5.1 Trennung von Spielpunkten und Erfahrungspunkten (Briefing §18)

| Begriff                   | Geltungsbereich               | Entstehung                                          | Speicherung                     |
| ------------------------- | ----------------------------- | --------------------------------------------------- | ------------------------------- |
| **Spielpunkte**           | innerhalb **einer** Quizrunde | Antwort im Spiel (`GamePlayer.score`)               | **Bestand**, bleibt unverändert |
| **Erfahrungspunkte (XP)** | dauerhaft im Konto            | serverseitig nach einem **gültigen** Spielabschluss | **neu** (`PlayerProfile.xp`)    |

**Regel:** Die beiden Werte werden **nie** vermischt. XP entsteht **nur** aus abgeschlossenen,
serverseitig validierten Spielen. Ein Spielpunkt ist flüchtig, XP ist dauerhaft.

### 5.2 XP-Quellen (Vorschlag)

| Quelle                       | XP-Vorschlag             | Bedingung (serverseitig)                               |
| ---------------------------- | ------------------------ | ------------------------------------------------------ |
| Richtige Antwort             | 10                       | `PlayerAnswer.correctness >= 1`                        |
| Teilweise richtige Antwort   | 4                        | `0 < correctness < 1`                                  |
| Spiel abgeschlossen          | 25                       | Spiel erreicht `phase = end`                           |
| Serie richtiger Antworten    | 5 × Serienlänge, max. 50 | aufeinanderfolgende richtige Antworten im selben Spiel |
| Teilnahme (auch ohne Punkte) | 10                       | mindestens eine Antwort abgegeben                      |
| Besondere Leistung           | je Erfolg (siehe §6)     | Erfolgsbedingung erfüllt                               |
| Turnier-/Saisonerfolg        | später                   | nur nach Freigabe eines Turniermodus                   |

**Anti-Missbrauch:** Alle Werte werden **serverseitig** berechnet, aus **persistierten**
`PlayerAnswer`-Zeilen und einem als gültig erkannten Spielabschluss (§8).

### 5.3 Levelschwellen (Vorschlag)

Formel-Vorschlag: `XP für Level n = 100 × (n−1)^1.5` (gerundet), damit frühe Level schnell und
späte Level langsam gehen. Konkrete Tabelle:

| Level | Bezeichnung (Briefing §18) | XP ab (kumulativ) | XP bis |
| ----- | -------------------------- | ----------------- | ------ |
| 1     | Anfänger                   | 0                 | 99     |
| 2     | Entdecker                  | 100               | 282    |
| 3     | Abenteurer                 | 283               | 519    |
| 4     | Blockwelt-Held             | 520               | 799    |
| 5     | Meister                    | 800               | 1119   |
| 6     | Champion                   | 1120              | 1478   |
| 7     | Legende                    | 1479              | offen  |

**Hinweis:** Die Schwellen sind bewusst klein gehalten, damit sie in Tests und Vorführungen schnell
erreichbar sind. Sie sind reine Konfiguration und können ohne Codeänderung angepasst werden.

### 5.4 Levelaufstieg

- Beim Aufstieg: Animation, Levelname, Vorschau der nächsten Belohnung.
- Der Aufstieg wird **serverseitig** festgestellt und mit dem Spielabschluss in einer Transaktion
  gespeichert, damit kein Client XP erfinden kann.

### 5.5 Beispielrechnung (verbindlich nachvollziehbar)

Damit XP nicht interpretiert werden muss, hier ein **vollständiges, durchgerechnetes Beispiel**.
Annahmen: Quiz mit **10 Fragen**, Zeitlimit je Frage 20 s, „zu schnell"-Regel **aus** (Bestand).

| Ereignis im Spiel                                        | XP      |
| -------------------------------------------------------- | ------- |
| Teilnahme (mindestens eine Antwort abgegeben)            | +10     |
| 7 richtige Antworten (7 × 10)                            | +70     |
| 2 teilweise richtige Antworten (2 × 4)                   | +8      |
| Längste Serie: 4 richtige in Folge (4 × 5, unter Cap 50) | +20     |
| Spiel abgeschlossen (gültiges `phase = end`)             | +25     |
| **Summe für dieses Spiel**                               | **133** |

- Startet der Spieler bei **0 XP** (Level 1 „Anfänger"), steht er nach dem Spiel bei **133 XP** →
  **Level 2 „Entdecker"** (100–282). Der Aufstieg wird einmalig verbucht.
- **Idempotenz:** Wird dasselbe Spiel erneut als „abgeschlossen" gemeldet, entstehen **keine**
  weiteren XP. Der Anker ist eine `@@unique`-Sperre je (Spieler, Spiel) im XP-Ledger (§7.3).
- **Reihenfolge:** XP werden **einmal**, am Spielende, in **einer** Transaktion berechnet und
  geschrieben – nicht je Antwort (verhindert Doppelvergabe und Rennen).

> **Hinweis:** Die Zahlen (10/4/5/25/10) sind **Vorschläge** und reine Konfiguration. Sie werden vom
> Projektverantwortlichen festgelegt (offene Entscheidung #9, Phase-5b-Bericht §7). Das Beispiel zeigt
> die **Mechanik**, nicht einen beschlossenen Wert.

---

## 6. Belohnungssystem

### 6.1 Grundsätze (Briefing §19)

- Belohnungen sind **rein kosmetisch**.
- **Kein Pay-to-win**, keine kaufbaren Vorteile.
- **Keine** manipulativen Mechaniken, kein unfairer Wettbewerb.
- Gesperrte Gegenstände sind **sichtbar** mit verständlicher Freischaltbedingung.

### 6.2 Belohnungsarten (Vorschlag)

| Art                 | Beispiel                                    | Freischaltung                    |
| ------------------- | ------------------------------------------- | -------------------------------- |
| Level-Belohnung     | Bauhelm bei Level 3                         | Level erreicht                   |
| Erfolgs-Belohnung   | goldene Spitzhacke für „10 Spiele gewonnen" | Erfolg erfüllt                   |
| Serien-Belohnung    | Umhang für „10 richtige in Folge"           | Serie erreicht                   |
| Teilnahme-Belohnung | Farbvariante für „10 Spiele gespielt"       | Anzahl Spiele                    |
| Saison-Belohnung    | exklusiver Effekt                           | später, nur nach Freigabe        |
| Besondere Figur     | Dr. Obscura, O-Bot                          | hohes Level oder seltener Erfolg |

### 6.3 Vorschlag für Erfolge (Auswahl)

| Erfolg-ID       | Name          | Bedingung                           | Belohnung            |
| --------------- | ------------- | ----------------------------------- | -------------------- |
| `first-game`    | Erste Runde   | 1 Spiel abgeschlossen               | XP + Farbvariante    |
| `first-win`     | Erster Sieg   | 1 Spiel als Erster beendet          | Avatar: Umhang       |
| `perfect-round` | Fehlerfrei    | alle Antworten eines Spiels richtig | Avatar: Krone        |
| `streak-10`     | Serie 10      | 10 richtige in Folge                | Avatar: Umhang       |
| `games-10`      | Stammgast     | 10 Spiele                           | Avatar: Werkzeug-Set |
| `games-50`      | Veteran       | 50 Spiele                           | Avatar: Rucksack     |
| `accuracy-90`   | Scharfschütze | ≥ 90 % Trefferquote bei ≥ 5 Spielen | Avatar: Brille       |
| `level-5`       | Meister       | Level 5 erreicht                    | Figur: Dr. Obscura   |
| `level-7`       | Legende       | Level 7 erreicht                    | Figur: O-Bot         |

**Hinweis:** Erfolgsnamen und Bedingungen sind Vorschläge und werden zur Freigabe vorgelegt.

### 6.4 Sichtbarkeit

- Inventar zeigt auch **gesperrte** Gegenstände (Silhouette + Bedingung).
- Profil zeigt „Nächste Belohnung" mit Fortschrittsanzeige.
- Kein zufälliges Lootbox-System (manipulativ). Freischaltungen sind **deterministisch** und
  nachvollziehbar.

---

## 7. Datenarchitektur (Vorschlag, additiv)

**Grundsatz:** Vorhandene Modelle **erweitern**, keine Doppelsysteme. Keine bestehende Spalte ändern.
Jede Migration wird dokumentiert und zur Freigabe vorgelegt.

### 7.1 Neue/erweiterte Modelle (Vorschlag)

| Modell / Erweiterung              | Zweck                                                                                                                                       | Neu oder Erweiterung                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `User.role` um `PLAYER` erweitern | Registrierte Spieler sind weder Trainer noch Admin                                                                                          | **Erweiterung des Enums** (Migration)             |
| `PlayerProfile`                   | 1:1 zu `User`; `xp`, `level`, `selectedCharacterId`, `avatarConfig` (JSONB), `totalScore`, `gamesPlayed`, `correctAnswers`, `answeredCount` | **neu**                                           |
| `Character`                       | Katalog der Figuren: `id`, `name`, `rarity`, `unlockRule`                                                                                   | **neu** (oder Konstante in `shared`, siehe unten) |
| `CosmeticItem`                    | Katalog der Gegenstände: `id`, `category`, `rarity`, `unlockRule`, `zIndex`, `characterCompat`                                              | **neu**                                           |
| `PlayerInventory`                 | Besitz: `userId`, `itemId`, `acquiredAt`, `source`, `equipped`                                                                              | **neu**                                           |
| `PlayerAchievement`               | Erfolge: `userId`, `achievementId`, `unlockedAt`, `progress`                                                                                | **neu**                                           |
| `GamePlayer.userId?`              | Verknüpfung Gast→Konto (nullable, additiv)                                                                                                  | **Erweiterung**                                   |
| `GamePlayer.characterId?`         | gewählte Figur im Spiel (nullable, additiv)                                                                                                 | **Erweiterung**                                   |
| `XpLedger`                        | append-only XP-Protokoll: `userId`, `amount`, `reason`, `gameId`, `createdAt`                                                               | **neu** (Nachvollziehbarkeit, Anti-Doppelvergabe) |

### 7.2 Katalogdaten: Datenbank oder Code?

**Vorschlag:** **Figuren und Gegenstände als Katalog in `@zeropeek/shared`** (Konstanten) statt in
der Datenbank. Begründung: Der Katalog ist Produktdefinition, ändert sich selten, muss auf **Client
und Server** identisch sein (Kompatibilitätsmatrix, Darstellung), und `shared` ist bereits die
einzige Wahrheit für solche Verträge. Die **Datenbank** speichert nur **Besitz und Zustand**
(`PlayerInventory`, `PlayerAchievement`, `PlayerProfile`).

Vorteil: keine Migration für einen neuen Hut; der Client kennt ihn sofort; die Kompatibilitätsmatrix
bleibt an einer Stelle.

### 7.3 Anti-Manipulation (Briefing §20)

| Angriff                                 | Schutz (serverseitig)                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Doppelte Antwortübermittlung            | Bestand: `answeredQuestionId` + DB-`@@unique([playerId, questionId])`                      |
| Wiederholte Punktevergabe               | Bestand: Punkte nur einmal je Antwort im Motor                                             |
| Manipulierte Spielereignisse            | Der Client sendet nur Rohantworten; der Motor entscheidet                                  |
| Ungültiger Spielabschluss               | XP nur bei `phase = end` **und** gültigem Spiel (mindestens eine Frage gespielt)           |
| Ungültige Belohnungsbedingung           | Erfolge/Level werden **nur** serverseitig aus persistierten Daten berechnet                |
| Mehrfaches Einlösen                     | `PlayerInventory` mit `@@unique([userId, itemId])`; XP über `XpLedger` idempotent          |
| XP im Client                            | Client **kann** XP nicht setzen; es gibt keinen Schreibendpunkt dafür                      |
| Wiederholtes Speichern desselben Spiels | XP-Vergabe genau **einmal** je Spiel (`XpLedger` mit `@@unique([userId, gameId, reason])`) |

**Wichtig:** Der XP-Vergabezeitpunkt ist der **Spielabschluss**. Er wird serverseitig im Motor
ausgelöst (`end`), in einer **Transaktion** mit der Erfolgsprüfung.

---

## 8. Spielfluss und Zustandsmaschine

### 8.1 Bestehender Fluss (verifiziert)

`lobby → question → reveal → board → (question …) → end` (die Phase `lead` ist deklariert, wird aber
**nie betreten**). Automatische Timer: `reveal` 6000 ms → `board` 6000 ms → nächste Frage.

### 8.2 Zielbild (Briefing §22)

Die 13 Schritte des Briefings werden auf die vorhandene Maschine abgebildet:

| Briefing-Schritt           | Vorhandener Zustand/Aktion | Neu nötig?                           |
| -------------------------- | -------------------------- | ------------------------------------ |
| 1. Spiel wird vorbereitet  | `host:create` → `lobby`    | nein                                 |
| 2. Spieler treten bei      | `player:join` → `lobby`    | nein                                 |
| 3. Host startet            | `host:start`               | nein                                 |
| 4. Countdown beginnt       | (kein Vorstart-Countdown)  | **ja** (Show-Countdown, nur Anzeige) |
| 5. Frage erscheint         | `question`                 | nein                                 |
| 6. Spieler antworten       | `player:answer`            | nein                                 |
| 7. Antwortzeit endet       | Timer → `reveal`           | nein                                 |
| 8. Antwort wird aufgelöst  | `reveal`                   | nein                                 |
| 9. Punkte werden vergeben  | im Motor beim Antworten    | nein                                 |
| 10. Rangliste aktualisiert | `board`                    | nein                                 |
| 11. Nächste Frage          | `host:next` / Timer        | nein                                 |
| 12. Finale                 | letzte Frage → `end`       | **Finalrunde** optional (neu)        |
| 13. Ergebnis und Gewinner  | `end` → Podium             | Podium-Show (neu, Anzeige)           |

**Regel:** Die Zustandsmaschine bleibt **server-autoritativ**. Es werden **keine** Zustände
erfunden, die der Motor nicht kennt. Ein Vorstart-Countdown (Schritt 4) ist eine **Anzeige** auf dem
Beamer, kein neuer Motorzustand – es sei denn, ein echter `lead`-Zustand wird ausdrücklich gewünscht (offene
Frage).

### 8.3 Widersprüchliche Zustände verhindern (Briefing §22, §42)

| Ursache                        | Schutz                                                                |
| ------------------------------ | --------------------------------------------------------------------- |
| Host und Beamer zeigen anderes | Beamer und Host erhalten **dieselben** Engine-Ereignisse (Fan-out)    |
| Spieler sieht veraltete Frage  | (heute: Lücke, R-5) – siehe §8.4                                      |
| Doppelte Ereignisse            | Reveal ist idempotent; Antworten sind einmalig                        |
| Verzögerte Nachrichten         | Frage trägt `openedAt`; Server entscheidet die Zeit, nicht der Client |

### 8.4 Verbesserungsvorschlag: Zustandswiederherstellung (R-4/R-5)

Das Briefing verlangt Wiederaufnahme und Reconnect. Der Bestand hat hier eine **Lücke**
(verifiziert). Vorschlag (nur Konzept, keine Umsetzung):

1. **Reconnect mitten in der Frage:** `player:rejoin` gibt zusätzlich den **aktuellen**
   `PublicQuestion` (falls Phase `question`) zurück, damit der Spieler die Frage wieder sieht.
2. **Serverneustart:** `engine.get()` rekonstruiert `openedAt` aus einem persistierten Zeitstempel
   (neues Feld oder Ableitung aus `GameEvent`) und **armt den Timer neu**; bereits gegebene Antworten
   werden in den Runtime-State geladen, damit die Doppelantwort als 409 statt als 500 endet.
3. **Wiederverbindung Host:** `host:join` liefert bereits Phase + Spieler; zusätzlich die **aktuelle**
   Frage/Auflösung, damit der Beamer nach einem Neustart sofort korrekt steht.

**Diese Änderungen berühren die Spiellogik und werden nur nach Freigabe umgesetzt.**

### 8.5 Pause/Fortsetzen (neu, optional)

Das Briefing nennt Pause/Fortsetzen. Der Bestand hat das **nicht**. Vorschlag: ein Host-Befehl
`host:pause`/`host:resume`, der den Timer **anhält** (verbleibende Zeit speichern) und beim
Fortsetzen neu startet. Das ist eine echte Motor-Erweiterung und braucht Freigabe.

### 8.6 Überspringen (neu, optional)

`host:skip` würde die aktuelle Frage ohne Wertung beenden. Achtung: das berührt Punkte/Historie
(übersprungene Frage darf nicht als „unanswered" gewertet werden, sonst verfälscht es Statistiken).
Freigabe nötig.

---

## 9. Zusätzliche Spielmodi (Briefing §23)

**Nur Konzept, Priorisierung. Keine vorhandene Spiellogik wird ersetzt.**

| Modus             | Nutzen (Spieler) | Aufwand | Risiko  | Abhängigkeit            | Priorität  |
| ----------------- | ---------------- | ------- | ------- | ----------------------- | ---------- |
| Einzelspieler     | mittel           | hoch    | hoch    | neue Maschine           | später     |
| Mehrspieler       | –                | –       | –       | **vorhanden**           | –          |
| Team-Modus        | hoch             | mittel  | mittel  | `team`-Feld (data-only) | Phase 6.12 |
| Zeitmodus         | mittel           | niedrig | niedrig | vorhandene Timer        | niedrig    |
| Turniermodus      | hoch             | hoch    | hoch    | neue Modelle            | später     |
| Finalrunde        | hoch             | mittel  | mittel  | Show + Motor            | Phase 6.12 |
| K.-o.-Modus       | mittel           | hoch    | hoch    | Finalrunde              | später     |
| Trainingsmodus    | mittel           | mittel  | niedrig | selbstgesteuert         | Phase 6.12 |
| Hausaufgabenmodus | mittel           | mittel  | mittel  | Q7 offen (Briefing)     | offen      |

**Empfehlung:** Team-Modus und Finalrunde zuerst (hoher Show-Nutzen, überschaubarer Aufwand),
Turnier/K.-o. später. Einzelspieler ist der größte Aufwand und sollte erst nach dem Kern-Erlebnis
kommen.

---

## 10. Beamer- und Game-Show-Modus

### 10.1 Bestehende kombinierte Host-/Beamer-Ansicht (verbindlich)

**Verbindlich festgelegt:** Die **bestehende kombinierte Host-/Beamer-Ansicht bleibt erhalten.** Die
Host-Seite (`/host.html`) ist und bleibt zugleich die Präsentationsfläche für den Beamer; es wird
**keine** separate Beamer-Surface und **keine** zusätzliche Route eingeführt.

Der Bestand hat bereits **keine** eigene Beamer-Surface – die Host-Seite ist der Beamer. Das ist die
gewünschte Architektur: ein Gerät steuert und zeigt. Diese Entscheidung ist damit **kein offener
Punkt** mehr.

Der Ausbau des Show-Erlebnisses (Briefing §26) findet **innerhalb** dieser kombinierten Ansicht
statt: die Host-Steuerung wird um klar getrennte **Präsentationsszenen** ergänzt, die auf großen
Bildschirmen wirken. Steuerungs- und Anzeigeelemente bleiben auf derselben Seite, aber visuell klar
getrennt (z. B. eine ein-/ausblendbare Steuerleiste, die im Beamer-Betrieb zurücktritt).

**Show-Token:** Ein Show-Token ist **nicht geplant**. Er wird nur dann weiterverfolgt, wenn dafür
eine **konkrete technische Notwendigkeit nachgewiesen** wird (z. B. ein belegter Bedarf, Steuerung
und Anzeige auf zwei Geräten zu trennen). Bis dahin entfällt er als Abhängigkeit und als
Sicherheitsthema.

### 10.2 Die 13 Show-Szenen (Briefing §26)

| #   | Szene                | Inhalt                                                | Animation               |
| --- | -------------------- | ----------------------------------------------------- | ----------------------- |
| 1   | Begrüßung            | Logo, Titel, „Gleich geht's los", Hintergrundbild     | Fade-in                 |
| 2   | Spielerbeitritt      | PIN riesig, URL, „Tritt bei", wachsende Avatar-Wand   | Pop je Beitritt         |
| 3   | Teilnehmerübersicht  | Alle Spieler mit Avatar und Name in einem Raster      | Gestaffeltes Einblenden |
| 4   | Spielstart-Countdown | 3 – 2 – 1 – Los!                                      | `count-tick`, `pop`     |
| 5   | Fragenanzeige        | Frage groß, Frage x/y, Kategorie                      | `slide-up`              |
| 6   | Antwortmöglichkeiten | Optionen groß, farbcodiert, nummeriert                | Gestaffelt              |
| 7   | Countdown            | Ring + Zahl, ruhige Farbänderung bei wenig Zeit       | `count-tick`            |
| 8   | Antwortauflösung     | Richtige Antwort hervorgehoben, Verteilung als Balken | `reveal-bars`           |
| 9   | Punktevergabe        | Punkte steigen, Avatare reagieren                     | `score-count-up`        |
| 10  | Zwischenrangliste    | Rangliste mit Avataren, Rangwechsel animiert          | `rank-shift`            |
| 11  | Finalrunde           | Ankündigung, besonderer Hintergrund                   | Dramatik-Puls           |
| 12  | Gewinnerpodium       | 1./2./3. mit Avatar, Krone, Punkten                   | `podium-rise`           |
| 13  | Abschluss            | Dank, Statistiken, Ausblick                           | Fade-in                 |

**Regel:** Frage und Antworten stehen **immer im Vordergrund** (Briefing §28). Hintergrundbilder
sind nie so kontrastreich, dass Text schwer lesbar wird.

### 10.3 Integration der Blockwelt-Helden (Briefing §27)

- Spieler erscheinen **mit ihrem Avatar** (Lobby-Wand, Rangliste, Podium).
- Besondere Figuren (Dr. Obscura, O-Bots) können auf dem Podium als Show-Element erscheinen.
- Freigeschaltete Accessoires sind sichtbar.
- Animationen heben Charaktere bei besonderen Ereignissen hervor (z. B. Sprung beim Punktgewinn).
- Figuren müssen **aus großer Entfernung** erkennbar sein: große Darstellung, klare Silhouette,
  hoher Kontrast zum Hintergrund.

### 10.4 Skalierung

Der Beamer nutzt eine **Show-Skala** (über `clamp` und `vmin`), damit die Darstellung auf 1280×720,
1920×1080, 2560×1440 und 4:3 gleich gut wirkt. Keine Navigationsmenüs, keine kleinen Texte.

---

## 11. Sounddesign

### 11.1 Ebenen (Briefing §33)

| Ebene     | Beispiele                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------- |
| **UI**    | Klick, Auswahl, Bestätigung, Fehler, Menü öffnen/schließen                                              |
| **Spiel** | Spielstart, Countdown, richtige Antwort, falsche Antwort, Punktegewinn, Rangwechsel, Finalrunde, Sieger |
| **Musik** | ruhige Spielmusik, spannungsaufbauende Quizmusik, dynamische Finalmusik, Siegermusik                    |

### 11.2 Audioanforderungen (Briefing §34)

- Musik und Effekte **getrennt** regelbar.
- Host steuert die zentrale Show-Musik.
- Spieler regeln ihre **lokale** Lautstärke individuell.
- Stummschaltung möglich.
- **Browser-Autoplay beachten:** Audio startet erst nach einer Nutzerinteraktion; sonst Hinweis
  „Ton aktivieren".
- Keine Dauerschleifen, die stören.
- Keine doppelten/überlappenden Effekte durch fehlerhafte Ereignisse (ein Effekt je Ereignis, mit
  Sperre während der Wiedergabe).
- Keine übermäßige CPU-/Netzwerklast (kleine Dateien, kurze Effekte).

### 11.3 Audio-Asset-Liste

Siehe `docs/assets/ASSET-BRIEFING.md`, Block E. Es werden **keine** urheberrechtlich geschützten
Stücke verwendet. Benötigte Dateien werden gesondert angefordert.

### 11.4 Technischer Vorschlag (Konzept)

- Ein **Audio-Manager** im Frontend mit zwei Bussen (`music`, `sfx`) und je einer Lautstärke.
- Effekte werden als kurze, vorab geladene Dateien abgespielt (Web Audio oder `<audio>`).
- Musik wird nur auf Wunsch gestartet (Autoplay-Regel) und über den Host gesteuert.
- Kein Sound auf dem Beamer ohne Interaktion; der Beamer braucht eine „Show starten"-Geste.

---

## 12. Realtime-Kommunikation (Briefing §42)

### 12.1 Bestand (verifiziert)

Zwei Namespaces, typisierte Verträge, Room-Fan-out, ACK-Muster, server-autoritativer Motor,
Reconnect-Token für Spieler, Session-Cookie für Host. `GameEvent` als Protokoll.

### 12.2 Vorgeschlagene Erweiterungen (nur Konzept)

| Thema                      | Vorschlag                                                              | Freigabe?      |
| -------------------------- | ---------------------------------------------------------------------- | -------------- |
| Verbindungsverlust         | Reconnect gibt aktuellen Zustand zurück (§8.4)                         | ja             |
| Doppelte Ereignisse        | Idempotente Übergänge (Bestand) + Idempotenzschlüssel für neue Befehle | ja             |
| Verzögerte Nachrichten     | Serverzeit als Basis (`openedAt`), optional Clock-Sync (siehe unten)   | ja             |
| Countdown-Synchronisierung | **Clock-Sync** (Ping/Pong, bester Versatz) statt reiner Client-Uhr     | ja             |
| Ergebnis-Synchronisierung  | Ergebnis kommt aus der DB (`PlayerAnswer`), nicht aus dem Client       | nein (Bestand) |
| Spielwiederaufnahme        | Zustand aus DB rekonstruieren (§8.4)                                   | ja             |

### 12.3 Clock-Sync (Vorschlag)

Der Bestand nutzt die **Client-Uhr** für den Countdown (R-7). Vorschlag: Der Client misst per
Ping/Pong den Versatz zur Serverzeit (mehrere Messungen, bester Wert) und rechnet `openedAt` auf
seine Uhr um. Damit ist der Countdown auf allen Geräten gleich, auch bei falsch gestellter Uhr. Das
ist ein zusätzliches Ereignis (`clock:ping`/`clock:pong`) und berührt den Event-Vertrag – Freigabe
nötig.

### 12.4 Skalierung (R-2)

Der Motor ist heute **In-Memory**; es gibt **keinen** Redis-Adapter. Bei mehr als einer Backend-
Replica divergieren die Zustände. Vorschlag: **entweder** bewusst bei einer Instanz bleiben (dann
dokumentieren) **oder** den Redis-Adapter einführen. Das ist eine Betriebsentscheidung und braucht
Freigabe.

---

## 13. Sicherheit (Briefing §43)

| Anforderung                              | Bestand / Vorschlag                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Serverseitige Berechtigungsprüfung       | **Bestand** (Guards, `assertHost`, Rollen)                                    |
| Sichere Benutzerkonten                   | **Bestand** (Argon2id, Sessions, CSRF)                                        |
| Geschützte XP-Vergabe                    | **neu**: nur serverseitig, `XpLedger` idempotent                              |
| Geschütztes Inventar                     | **neu**: `PlayerInventory` nur serverseitig schreibbar                        |
| Validierte Spielereignisse               | **Bestand** (Payload-Prüfung, ACK)                                            |
| Schutz vor doppelten Antworten           | **Bestand** (Motor + DB-Unique)                                               |
| Sichere Datenbankzugriffe                | **Bestand** (Prisma, parametrisiert)                                          |
| Keine Secrets im Client                  | **Bestand** (CSRF im Speicher, keine Tokens in Storage außer Spieler-Session) |
| Keine manipulierbaren Punktestände       | **Bestand** (server-autoritativ)                                              |
| Schutz vor unberechtigten Admin-Aktionen | **Bestand** (letzter Admin, Selbstschutz)                                     |
| **Rate-Limit auf Socket-Events**         | **fehlt** (R-6) → Vorschlag: Limit für `join`/`answer`/`rejoin`               |
| **Spielerkonto-Missbrauch**              | **neu**: Registrierung mit Rate-Limit, Captcha optional (Freigabe)            |

**Datenschutz:** Q5 (IP-Speicherung) ist offen. Vorschlag: **keine** IP-Speicherung; Identifikation
über Konto und Spiel-Token. Das entspricht der Data-Minimisation aus ADR 0006.

---

## 14. Performance (Briefing §44)

Siehe `design-concept.md` §11. Ergänzend für das Spiel:

- Avatar-Rendering über wenige Layer (nicht pro Kombination eine Datei).
- Ranglisten/Statistiken aggregiert, indiziert, nicht N+1.
- Realtime-Ereignisse sparsam (keine hochfrequenten Updates).
- Sound klein und kurz; Musik nur auf Wunsch.

---

## 15. Priorisierung und Bewertung (Briefing §40)

| Funktion                      | Spielermehrwert | Aufwand | Risiko  | Abhängigkeit                         | Entwicklungs-Priorität |
| ----------------------------- | --------------- | ------- | ------- | ------------------------------------ | ---------------------- |
| Designsystem                  | hoch            | mittel  | niedrig | –                                    | **6.1 (zuerst)**       |
| Navigation/Responsive         | hoch            | mittel  | niedrig | Designsystem                         | **6.2**                |
| Login/Registrierung           | hoch            | mittel  | mittel  | Spielerkonto                         | **6.3**                |
| Quizverwaltung/Editor         | mittel          | mittel  | mittel  | R-3-Entscheidung                     | **6.4**                |
| Admin/Host                    | mittel          | mittel  | niedrig | Designsystem                         | **6.5**                |
| Spielerprofile                | hoch            | mittel  | mittel  | Spielerkonto                         | **6.6**                |
| Charakter-/Avatar-System      | **sehr hoch**   | hoch    | mittel  | **Charakter-Assets**                 | **6.7**                |
| Inventar/Belohnungen/XP       | hoch            | mittel  | mittel  | Profile, Anti-Manipulation           | **6.8**                |
| Beamer/Game-Show              | hoch            | hoch    | mittel  | Beamer-Grafiken                      | **6.9**                |
| Hintergrundbilder             | mittel          | niedrig | niedrig | **Bilder (Projektverantwortlicher)** | **6.10**               |
| Sound/Musik                   | mittel          | mittel  | niedrig | **Audio (Projektverantwortlicher)**  | **6.11**               |
| Statistiken/Ranglisten global | mittel          | mittel  | mittel  | Aggregation                          | **6.12**               |
| Team-Modus                    | hoch            | mittel  | mittel  | `team`-Feld                          | 6.12                   |
| Finalrunde                    | hoch            | mittel  | mittel  | Show + Motor                         | 6.12                   |
| Turnier/K.-o.                 | mittel          | hoch    | hoch    | Finalrunde                           | später                 |
| Einzelspieler                 | mittel          | hoch    | hoch    | neue Maschine                        | später                 |

**Regel:** Grundlegende Systeme zuerst. Keine Show ohne Charaktere; keine Charaktere ohne Assets.

---

## 16. Offene Fragen (Spiel)

1. **XP-Werte, Levelschwellen, Erfolge** (§5, §6): genehmigen oder anpassen?
2. **Katalog in `shared` oder in der Datenbank** (§7.2)?
3. **Rolle `PLAYER`** einführen (Enum-Erweiterung, Migration)?
4. **R-3** (Historieverlust beim Quiz-Bearbeiten): Quiz-Snapshot je Spiel einführen?
5. **R-4/R-5** (Zustandswiederherstellung, Reconnect): umsetzen?
6. **Pause/Überspringen** (§8.5, §8.6): gewünscht?
7. **Clock-Sync** (§12.3): einführen?
8. **Redis-Adapter oder bewusst eine Instanz** (§12.4)?
9. **Spielmodi-Priorisierung** (§9): bestätigen?
10. **IP-Speicherung** (Q5): endgültig ausschließen?

> **Entfallen:** „Beamer als eigene Route mit Show-Token" – die kombinierte Host-/Beamer-Ansicht
> bleibt verbindlich (§10.1).
