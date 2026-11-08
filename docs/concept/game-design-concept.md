# Phase 2 – Game-Design-Konzept (Charaktere, Fortschritt, Show, Sound)

**Projekt:** ZeroPeek
**Phase:** 2 – Produkt- und Game-Design-Konzept (Teil 2: Spiel)
**Datum:** 2026-11-04
**Status:** Entwurf zur Prüfung durch den Projektverantwortlichen (Dejan Popovic)
**Grundlage:** `docs/analysis/phase-1-technical-inventory.md`, `docs/concept/design-concept.md`

> **Kein Anwendungscode, kein Schema, keine Migration, keine Assets wurden geändert oder erzeugt.**
> **Verbindliche Produktentscheidungen** (Phase 5c, 2026-11-04) sind im Text als **„Verbindlich"**
> gekennzeichnet: XP-Berechnung, Levelkurve, Platzierungsbonus, Spielerregistrierung,
> Gastkonto-Übernahme, charakterexklusive Gegenstände, Quiz-Snapshot und Hintergrundauswahl.
> Alles andere bleibt **Vorschlag** oder **offene Frage**.

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

### 3.1 Anpassbare Kategorien (aus Briefing §14) – Designidee

> **Hinweis (Phase 5c):** Diese Tabelle ist eine **Designidee**. **Verbindlich** ist: Gegenstände sind
> **charakterexklusiv** (§3.2). Welche Kategorien eine Figur hat, ergibt sich aus ihrem Katalog.

| Kategorie           | Beispiele                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Kopfbedeckung       | Basecap, Bauhelm, Krone, Zauberhut, Helme, besondere Kopfbedeckungen                                |
| Brille              | Sonnenbrille, Schutzbrille, Fantasiebrille, futuristische Brille                                    |
| Kleidung            | Hoodie, Abenteuerkleidung, Rüstung, Superhelden-Outfit, besondere Kostüme                           |
| Werkzeug/Ausrüstung | Spitzhacke, Schaufel, Axt, Rucksack, Gürtel, Umhang                                                 |
| Seltene Gegenstände | goldene Spitzhacke, Diamant-Spitzhacke, seltene Rüstungen, exklusive Accessoires, besondere Effekte |
| Farbe (wo passend)  | Fellfarbe (Pixel), Flügel-/Musterfarbe (Biene), Akzentfarbe                                         |

### 3.2 Charakterexklusive Gegenstände (verbindlich, Phase 5c)

**Verbindlich: Jeder Avatar besitzt seine eigenen Gegenstände.** Es gibt **keinen** allgemeinen
Gegenstandskatalog, dessen Elemente beliebig auf allen Figuren getragen werden können.

- Ein Gegenstand ist **ausschließlich für seinen vorgesehenen Charakter** verfügbar.
- Die Kompatibilität steht in einem **zentralen, versionierten Katalog** (§7.2).
- Ein Gegenstand wird auf einem anderen Avatar **gar nicht angeboten** (nicht nur ausgegraut), damit
  keine falsche Kombination entsteht.
- Die Originalfiguren bleiben in **Identität, Silhouette und Gestaltung** erhalten; der Cyber-Stil
  wird **dezent** integriert.

**Gegenstände müssen sichtbar getragen werden können.** Ein Gegenstand darf **nicht** nur als
Inventar-Icon existieren, sondern muss am Avatar **tatsächlich sichtbar ausgerüstet** werden.
Konzeptionell vorgesehen: charakterbezogene **Ausrüstungsslots**, zugehörige **Grafiklayer**,
definierte **Positionen und Größen**, richtige **Ebenenreihenfolge**, charakterabhängige
Kompatibilität und eine **Vorschau** im Avatar-Menü. Die genaue Grafik- und Layerarchitektur wird
anhand der gelieferten Originalassets festgelegt (§3.4).

**Beispiele für individuelle Ausrüstung** (Designidee; endgültige Gegenstände richten sich nach den
Originalcharakteren):

| Avatar      | Mögliche eigene Gegenstände                                    |
| ----------- | -------------------------------------------------------------- |
| Ethan       | Cyberbrille, Tech-Weste, Armband, Rucksack                     |
| Maya        | Cybervisier, futuristische Kleidung, eigener Technik-Rucksack  |
| Pixel       | Cyberhalsband, technisches Geschirr, passende Accessoires      |
| Dr. Obscura | Technische Maske, Spezialmantel, individuelle Apparaturen      |
| O-Bots      | Eigene Sensoren, Module, Aufsätze und technische Erweiterungen |

**Anzahl und Umfang:** Geplant sind ungefähr **15 Avatare** aus dem Blockwelt-Helden-Universum
(inkl. passender Tiere und Insekten). Die endgültige Charakterliste richtet sich nach den
Originalassets des Projektverantwortlichen.

**Inventar und Avatarwechsel (verbindlich):** Registrierte Spieler behalten **alle** freigeschalteten
Gegenstände dauerhaft. Bei einem Avatarwechsel bleiben die Gegenstände erhalten; angezeigt wird die
Ausrüstung des **ausgewählten** Charakters. Die Gegenstände eines anderen Charakters werden **nicht**
automatisch übertragen.

### 3.2a Kategorien und Kompatibilität (Vorschlag, aus Briefing §14/§15)

Kategorien der Anpassung (aus Briefing §14):

| Kategorie           | Beispiele                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Kopfbedeckung       | Basecap, Bauhelm, Krone, Zauberhut, Helme, besondere Kopfbedeckungen                                |
| Brille              | Sonnenbrille, Schutzbrille, Fantasiebrille, futuristische Brille                                    |
| Kleidung            | Hoodie, Abenteuerkleidung, Rüstung, Superhelden-Outfit, besondere Kostüme                           |
| Werkzeug/Ausrüstung | Spitzhacke, Schaufel, Axt, Rucksack, Gürtel, Umhang                                                 |
| Seltene Gegenstände | goldene Spitzhacke, Diamant-Spitzhacke, seltene Rüstungen, exklusive Accessoires, besondere Effekte |
| Farbe (wo passend)  | Fellfarbe (Pixel), Flügel-/Musterfarbe (Biene), Akzentfarbe                                         |

**Kompatibilitätsmatrix (Vorschlag, Auszug).** Sie zeigt, welche **Kategorie** für eine Figur
grundsätzlich vorgesehen ist. Die konkreten **Einzelgegenstände** sind charakterexklusiv (§3.2).

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

**Regel:** Ein nicht kompatibles Teil wird im Editor **gar nicht angeboten** (Briefing §53,
Fehlerquelle 6).

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

**Entschieden (Phase 6.7, verifiziert):** **Einzelbild pro Figur + Thumbnails je Gegenstand.**
Begründung: Die gelieferten Original-Grafiken sind **nicht** auf eine gemeinsame Zeichenfläche
ausgerichtet (Metadaten des Verantwortlichen: `not_defined`/`not_validated`). Ein gestapeltes
Layer-Verfahren würde erfundene Koordinaten voraussetzen und die Figuren falsch zusammensetzen –
genau der in Briefing §53 (Fehlerquelle 6) verbotene Fall. Deshalb zeigt die Vorschau die
**gelieferte** Figur (`*_full_preview.webp`) und listet die ausgerüsteten Gegenstände als eigene,
beschriftete Thumbnails. Sobald der Verantwortliche die **ausgerichteten Layer** (gemeinsame
Zeichenfläche, Ankerpunkt, Skalierung, `zIndex`) liefert, wird **nur**
`packages/frontend/src/avatar.ts` erweitert; der Katalog erhält dann `layerGeometry` und
`alignment: 'aligned'`. Die dafür reservierten Felder sind in `shared/cosmetics.ts` bereits
deklariert, aber **nicht** befüllt.

**CSP-Konform:** Umsetzung ausschließlich über `<img src>` aus `public/` (`img-src 'self'`),
`textContent` für Text und CSS-Klassen – kein Inline-CSS, keine Markup-Strings.

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

**Umsetzung (Phase 6.7):** Die Reihenfolge ist als `EQUIPMENT_SLOTS` in `shared/cosmetics.ts`
deklariert (backpack → outfit → neckAccessory → visor → wristAccessory) und für den späteren
Renderer vorbereitet. **Heute ungenutzt:** Da die gelieferten Grafiken nicht ausgerichtet sind, wird
die Reihenfolge **nicht** angewandt – es wird kein Layer gestapelt (siehe §3.3).

### 3.5 Darstellung und Schärfe

- Figuren werden als **Rasterkunst** in ausreichender Auflösung geliefert (Asset-Briefing).
- Für große Darstellungen (Profil, Podium) gibt es eine **große Variante** oder eine verlustfreie
  Skalierung; Pixel-Art wird mit `image-rendering: pixelated` scharf gehalten, **wenn** die Quelle
  Pixel-Art ist.
- Auf Smartphone wird dieselbe Datei kleiner skaliert (kein zweites Asset nötig, solange die
  Auflösung Reserve hat).

---

## 4. Spielerprofile, Registrierung und Gastkonto-Übernahme

### 4.1 Gastspieler vs. registrierter Spieler (Briefing §11, Phase 5c)

| Merkmal               | Gastspieler                                                           | Registrierter Spieler          |
| --------------------- | --------------------------------------------------------------------- | ------------------------------ |
| Beitritt              | PIN + Nickname, sofort, **ohne Registrierung**                        | Login optional, dann Beitritt  |
| Profil                | temporär (nur im Spiel)                                               | dauerhaft                      |
| Avatar                | Standardfigur, keine Auswahl                                          | eigene Figur + Ausrüstung      |
| Quizhistorie          | **nein**                                                              | **nein** (nur Administratoren) |
| Persönliche Statistik | nur aktueller Punktestand im Spiel                                    | dauerhaft (siehe §4.7)         |
| XP / Level            | **nein** (nur Anzeige während des Spiels)                             | ja                             |
| Inventar / Erfolge    | **nein**                                                              | ja                             |
| Späteres Verknüpfen   | **verbindlich**: Gastrunde kann auf ein neues Konto übertragen werden | –                              |

**Verbindlich:** Die **Registrierung ist keine Voraussetzung** für die Teilnahme. Gäste spielen
weiterhin ohne E-Mail und ohne Konto. Bestehende `ADMIN`/`TRAINER`-Konten bleiben unverändert.

**Bestand:** Heute gibt es **nur** Gastspieler (`GamePlayer` ohne `User`-Bezug). Registrierte
Spieler sind neu. Es gibt heute **keine** Rolle `PLAYER` (Enum `ADMIN`/`TRAINER`).

> **Phasenabgrenzung (Phase 6.2.2):** Phase 6.2.2 führt **keine** Rolle `PLAYER`, **kein**
> Spielerkonto und **kein** Profil ein (das ist 6.3 bzw. 6.6). Die Entscheidung, dass Gäste zunächst
> mit einer **Standardfigur ohne Avatar-Auswahl** teilnehmen, bleibt **unverändert**; eine spätere
> Änderung bräuchte einen eigenen Produktentscheid und eine vorherige Dokumentationsaktualisierung.

### 4.2 Registrierungsangebot (Briefing, Phase 5c – verbindlich)

Die Registrierung wird an **zwei** Stellen aktiv angeboten.

**a) Beim Spielbeitritt** – dezenter Hinweis, der den Beitritt nicht verzögert:

> „Erstelle dein kostenloses ZeroPeek-Konto und sichere deinen Fortschritt dauerhaft."

Der Spieler wählt danach: **als Gast fortfahren**, **Konto erstellen** oder **anmelden**. Der
Gastbeitritt muss weiterhin **sofort** möglich sein; das Angebot ist optional und abbrechbar.

**b) Nach Spielende** – erneutes Angebot mit klarem Nutzen:

- Erspielte XP dauerhaft sichern.
- Persönliche Spielstatistik aufbauen.
- Level und Fortschritt behalten.
- Neue Gegenstände freischalten.
- Eigenen Avatar ausstatten.

Die Registrierung bleibt **freiwillig**.

### 4.3 Kontoanforderungen (verbindlich)

Ein Spielerkonto verwendet: **E-Mail**, **Passwort**, **E-Mail-Bestätigung** und **Anzeigename**.
Die bestehende Authentifizierungsarchitektur (Argon2id, Server-Sessions, CSRF) wird **weiterverwendet**
und nur um die Rolle `PLAYER` erweitert. Die bestehende Admin-/Traineranmeldung darf **nicht**
beschädigt werden. `PLAYER` erhält **keine** Admin- oder Trainerrechte.

### 4.4 Gastkonto-Übernahme (verbindlich, Phase 5c)

Ein Gast soll seinen gerade erspielten Fortschritt **nicht verlieren**, wenn er sich erst nach dem
Spiel registriert.

**Übernahme nach Spielende:** Erstellt ein Gast nach Abschluss einer Runde ein Konto, wird ihm
angeboten, **diese abgeschlossene Runde** seinem neuen Konto zuzuordnen. Übernommen werden:
Quizpunkte, Platzierungsbonus, daraus resultierende XP, die gespielte Runde, die Platzierung, die
Anzahl richtiger Antworten, die Anzahl beantworteter Fragen und die relevanten persönlichen
Statistikwerte. Die Übernahme erfolgt **ausschließlich nach ausdrücklicher Zustimmung** des Spielers.

**Registrierung während einer laufenden Runde:** Erstellt ein Gast mitten in einer Runde ein Konto,
soll seine bestehende Teilnahme **direkt** mit dem neuen Konto verknüpft werden. Erhalten bleiben:
aktueller Spielplatz, bereits beantwortete Fragen, aktueller Punktestand und die Verbindung zur
laufenden Runde. Es darf **keine doppelte Spieleridentität** in der Lobby entstehen.

**Sicherheit (verbindlich):**

- **Zeitlich begrenzter** Gast-/Übernahmenachweis (kurzlebig, an die Runde gebunden).
- **Einmalige Verwendung**; keine doppelte Übertragung derselben Runde.
- **Serverseitige** Überprüfung; **kein** frei manipulierbarer XP-Wert vom Client.
- Keine doppelte Gutschrift von XP oder Platzierungsboni.
- Keine Übernahme **fremder** Spielersessions (kein Gast übernimmt die Runde eines anderen).

**Abgrenzung (verbindlich):** Die Übernahme einer **gerade abgeschlossenen** Runde ist vorgesehen.
Eine **unbegrenzte nachträgliche** Übertragung beliebiger früherer Gastspiele ist **nicht
beschlossen**.

### 4.5 Profilinhalt (Briefing §17)

Anzeigename, gewählter Charakter, aktueller Avatar, Gesamtpunktzahl, Erfahrungspunkte, Spielerlevel,
Erfolge, **persönliche Statistik** (§4.7), richtige Antworten, Trefferquote, persönliche
Bestleistungen, freigeschaltete Gegenstände.

### 4.6 Darstellung

Großes, hochwertiges Charakterbild im Zentrum; Level und XP prominent; Statistiken als Kacheln;
Erfolge als Galerie; gesperrte Erfolge als Silhouette mit Bedingung. Details siehe
`design-concept.md` §8.8.

### 4.7 Persönliche Spielstatistik (verbindlich, Phase 5c)

#### 4.7.1 Abgrenzung zur Quizhistorie

Die **persönliche Statistik** ist ausdrücklich **von der Quizhistorie zu unterscheiden**:

| Bereich                   | Sichtbar für            | Inhalt                                                          |
| ------------------------- | ----------------------- | --------------------------------------------------------------- |
| **Persönliche Statistik** | den Spieler selbst      | zusammengefasster eigener Fortschritt (§4.7.2)                  |
| **Quizhistorie**          | **nur Administratoren** | Fragen, Antworten, Spielberichte, Ergebnisse anderer Teilnehmer |

**Verbindlich:** Spieler dürfen **keine** detaillierte Historie mit alten Fragen, Antworten,
Spielberichten oder Ergebnissen anderer Teilnehmer einsehen. Die persönliche Statistik ist eine
**Zusammenfassung des eigenen Fortschritts**, keine Freigabe der Quizhistorie.

#### 4.7.2 Sichtbare persönliche Werte (verbindlich)

Im Spielerprofil werden angezeigt:

- Gesamtzahl gespielter Runden.
- Anzahl gewonnener Spiele.
- Anzahl der erreichten Podiumsplätze.
- Anzahl richtiger Antworten.
- Anzahl beantworteter Fragen.
- Persönliche Trefferquote.
- Aktueller Punktestand bzw. XP.
- Aktuelles Level.
- Fortschritt bis zum nächsten Level.
- Anzahl freigeschalteter Gegenstände.
- Ausgewählter Avatar und dessen Ausrüstung.

**Regel:** Die Statistik wird **serverseitig** aus persistierten Daten berechnet und ist
**nachvollziehbar** (Roadmap §6.8). Keine dieser Werte wird im Client berechnet oder gespeichert.

---

## 5. Erfahrungspunkte und Level

### 5.1 Trennung von Spielpunkten und Erfahrungspunkten (Briefing §18)

| Begriff                   | Geltungsbereich               | Entstehung                                          | Speicherung                     |
| ------------------------- | ----------------------------- | --------------------------------------------------- | ------------------------------- |
| **Spielpunkte**           | innerhalb **einer** Quizrunde | Antwort im Spiel (`GamePlayer.score`)               | **Bestand**, bleibt unverändert |
| **Erfahrungspunkte (XP)** | dauerhaft im Konto            | serverseitig nach einem **gültigen** Spielabschluss | **neu** (`PlayerProfile.xp`)    |

**Regel:** Die beiden Werte werden **nie** vermischt. XP entsteht **nur** aus abgeschlossenen,
serverseitig validierten Spielen. Ein Spielpunkt ist flüchtig, XP ist dauerhaft.

### 5.2 XP-Berechnung (verbindlich, Phase 5c)

**Die bisherige XP-Vorschlagsrechnung ist ersetzt.** Es gibt **keine** separate Umrechnung und
**keinen** zusätzlichen Teilnahme- oder Leistungsbonus.

> **Verbindlich: Die XP entsprechen den Punkten, die ein Spieler im Quiz für seine Antworten
> erhält.** Das bestehende Punktesystem und seine serverseitige Berechnung bleiben maßgeblich.

- Erreichte **Spielpunkte** werden bei registrierten Spielern nach Abschluss der Runde **als
  dauerhafte XP** gutgeschrieben.
- Beispiel: 8.500 Spielpunkte in einer Runde → **8.500 XP**.
- Es entsteht **kein zweites** XP-Berechnungssystem.

### 5.3 Platzierungsbonus (verbindlich, Phase 5c)

Zusätzlich erhalten die **drei Erstplatzierten** einen einmaligen Bonus:

| Platzierung    | Zusätzliche XP |
| -------------- | -------------: |
| 1. Platz       |       1.500 XP |
| 2. Platz       |       1.000 XP |
| 3. Platz       |         500 XP |
| Weitere Plätze |           0 XP |

**Beispiel:** Sieg mit 8.500 Punkten → 8.500 XP (Fragenpunkte) + 1.500 XP (Siegerbonus) =
**10.000 XP Gesamtgutschrift**.

- Der Platzierungsbonus wird **erst nach Spielabschluss** und Feststellung der **endgültigen
  Platzierung** gutgeschrieben.
- Die **Spielpunktzahl bleibt unverändert**; der Bonus wird **nicht** nachträglich in die
  Spielwertung eingerechnet.

**Gleichstand (verbindlich):** Bei identischer Platzierung erhalten **alle** betroffenen Spieler
**denselben** Platzierungsbonus. Kein Spieler darf durch technischen Zufall oder willkürliche
Reihenfolge benachteiligt werden. Die bestehende Ranglistenlogik ist zu prüfen und für diese Regel
zu dokumentieren (Roadmap §6.8).

**Gäste:** Gäste erhalten **keine** dauerhafte XP-Speicherung. Sie sehen ihren Punktestand während
des Spiels und den Abschlussstand danach. Erstellen sie anschließend ein Konto, können XP und
Statistik **dieser** Runde nach §4.4 übernommen werden.

### 5.4 Levelkurve (verbindlich, Phase 5c)

- Level 1 beginnt bei **0 XP**.
- Die Aufstiege von Level 1 bis einschließlich Level 10 benötigen je **10.000 XP**.
- Ab dem Aufstieg Level 10 → 11 steigt der Betrag auf **11.000 XP**.
- Jeder weitere Aufstieg benötigt **1.000 XP mehr** als der vorherige.

| Neues Level | XP für den Aufstieg | Gesamt-XP |
| ----------: | ------------------: | --------: |
|           1 |                   – |         0 |
|           2 |              10.000 |    10.000 |
|           3 |              10.000 |    20.000 |
|           4 |              10.000 |    30.000 |
|           5 |              10.000 |    40.000 |
|           6 |              10.000 |    50.000 |
|           7 |              10.000 |    60.000 |
|           8 |              10.000 |    70.000 |
|           9 |              10.000 |    80.000 |
|          10 |              10.000 |    90.000 |
|          11 |              11.000 |   101.000 |
|          12 |              12.000 |   113.000 |
|          13 |              13.000 |   126.000 |
|          14 |              14.000 |   140.000 |
|          15 |              15.000 |   155.000 |

**Regel:** Die Berechnung wird **zentral und eindeutig** implementiert (eine Funktion in
`@zeropeek/shared`, siehe §7.2). Es gibt **keine** mehrfach gepflegten Leveltabellen in
verschiedenen Komponenten. Überschreitet eine XP-Gutschrift **mehrere** Levelgrenzen, müssen
**alle** erreichten Level korrekt erkannt und ihre Belohnungen berücksichtigt werden (Roadmap §6.8).

> **Ersetzt:** Die frühere Formel `100 × (n−1)^1.5` und die alte 7-Level-Tabelle gelten **nicht mehr**.

### 5.5 Levelaufstieg

- Beim Aufstieg: Animation, Levelname, Vorschau der nächsten Belohnung.
- Der Aufstieg wird **serverseitig** festgestellt und mit dem Spielabschluss in einer Transaktion
  gespeichert, damit kein Client XP erfinden kann.
- Levelbezeichnungen (Anzeige, Konfiguration): 1 Anfänger · 2 Entdecker · 3 Abenteurer ·
  4 Blockwelt-Held · 5 Meister · 6 Champion · 7 Legende · danach fortlaufend „Legende Stufe n"
  (Feinschliff durch den Projektverantwortlichen).

### 5.6 Beispielrechnung (verbindlich nachvollziehbar)

Damit XP nicht interpretiert werden muss, hier ein **vollständiges, durchgerechnetes Beispiel**.
Annahmen: Quiz mit **10 Fragen**, Zeitlimit je Frage 20 s, „zu schnell"-Regel **aus** (Bestand).

| Ereignis im Spiel                       | XP         |
| --------------------------------------- | ---------- |
| Spielpunkte aus allen Antworten (Summe) | 8.500      |
| Platzierungsbonus (1. Platz)            | +1.500     |
| **Summe für dieses Spiel**              | **10.000** |

- Startet der Spieler bei **0 XP** (Level 1), steht er nach dem Spiel bei **10.000 XP** →
  **Level 2**. Der Aufstieg wird einmalig verbucht.
- **Idempotenz:** Wird dasselbe Spiel erneut als „abgeschlossen" gemeldet, entstehen **keine**
  weiteren XP. Der Anker ist eine `@@unique`-Sperre je (Spieler, Spiel) im XP-Ledger (§7.3).
- **Reihenfolge:** XP werden **einmal**, am Spielende, in **einer** Transaktion berechnet und
  geschrieben – nicht je Antwort (verhindert Doppelvergabe und Rennen).

> **Hinweis:** Die **Mechanik** ist verbindlich (Punkte = XP, Bonus 1500/1000/500, Levelkurve §5.4).
> Die konkreten Erfolgs- und Belohnungsinhalte legt der Projektverantwortliche fest.

---

## 6. Belohnungssystem

### 6.1 Grundsätze (Briefing §19)

- Belohnungen sind **rein kosmetisch**.
- **Kein Pay-to-win**, keine kaufbaren Vorteile.
- **Keine** manipulativen Mechaniken, kein unfairer Wettbewerb.
- Gesperrte Gegenstände sind **sichtbar** mit verständlicher Freischaltbedingung.

### 6.2 Belohnungsarten (Phase 5c)

**Verbindlich:** **Jeder Levelaufstieg schaltet einen neuen Gegenstand frei.** Die Belohnungen sind
**ausschließlich kosmetisch** – **keine** spielerischen Vorteile. Die konkrete Belohnungsliste legt
der Projektverantwortliche fest. Mögliche Gegenstände: Cyberbrillen, futuristische Kleidung,
Rucksäcke, technische Armbänder, Kopfhörer, charakterbezogene Werkzeuge, besondere Cyber-Accessoires,
exklusive Farbvarianten.

| Art                 | Beispiel                                       | Freischaltung                    |
| ------------------- | ---------------------------------------------- | -------------------------------- |
| **Level-Belohnung** | **je Levelaufstieg ein Gegenstand**            | Level erreicht                   |
| Erfolgs-Belohnung   | besonderes Accessoire für „10 Spiele gewonnen" | Erfolg erfüllt                   |
| Serien-Belohnung    | Umhang für „10 richtige in Folge"              | Serie erreicht                   |
| Teilnahme-Belohnung | Farbvariante für „10 Spiele gespielt"          | Anzahl Spiele                    |
| Saison-Belohnung    | exklusiver Effekt                              | später, nur nach Freigabe        |
| Besondere Figur     | Dr. Obscura, O-Bot                             | hohes Level oder seltener Erfolg |

**Verbindlich:** **Keine kaufbaren Vorteile, kein Echtgeld-Shop, keine Lootboxen.**

### 6.2a Levelbelohnung und aktiver Avatar (verbindlich, Phase 5c)

Ein Levelaufstieg schaltet einen Gegenstand aus dem **charakterbezogenen** Belohnungssystem frei
(siehe §6.6). Weil Gegenstände **charakterexklusiv** sind, gilt für die Zuordnung:

- Die Belohnung ist ein Gegenstand **für den aktuell gewählten Avatar**.
- Bei einem Avatarwechsel bleibt der Gegenstand im Besitz und wird **beim Zurückwechseln** wieder
  ausrüstbar; er wird **nicht** automatisch auf andere Charaktere übertragen.
- Freischaltungen sind **deterministisch** und nachvollziehbar (kein Zufall, keine Lootbox).

**Offen (Projektverantwortlicher):** die endgültige **Belohnungsmatrix** und die Zuordnung der
einzelnen Gegenstände. OpenHands entwirft **keine** endgültigen Belohnungsassets.

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

### 6.5 Inventar und Avatar-Ausrüstung (verbindlich, Phase 5c)

- **Registrierte** Spieler behalten alle freigeschalteten Gegenstände **dauerhaft**.
- Ein **Avatarwechsel** löscht **keine** Gegenstände. Angezeigt wird die Ausrüstung des gewählten
  Charakters; Gegenstände anderer Charaktere werden **nicht** übertragen.
- Ausgerüstete Gegenstände sind am Avatar **sichtbar** (§3.2), nicht nur als Icon.
- Keine unzulässige Kombination: Das Inventar bietet nur Gegenstände des **aktiven** Charakters an.

### 6.6 Zuordnung Levelbelohnung → aktiver Avatar (verbindlich, Phase 5c)

Ein Levelaufstieg schaltet einen Gegenstand des **charakterbezogenen** Katalogs frei. Damit die
Zuordnung eindeutig ist:

1. Der Katalog ist **pro Charakter** strukturiert: jeder Gegenstand hat `characterId` und einen
   `unlockRule`-Eintrag (z. B. `level:5`).
2. Beim Aufstieg wählt der Server den **nächsten noch gesperrten Levelgegenstand** des aktuell
   gewählten Avatars (`PlayerProfile.selectedCharacterId`) aus.
3. Ist für diesen Avatar auf dieser Stufe kein Gegenstand definiert, wird die Freischaltung
   **aufgeschoben** und beim nächsten Aufstieg nachgeholt (kein Verlust).
4. Wird der Avatar **gewechselt**, gelten die Freischaltungen weiter; die Zuordnung bleibt an den
   Charakter gebunden, nicht an den Zeitpunkt.

> **Offen:** Die **endgültige Belohnungsmatrix** und die Zuordnung der einzelnen Gegenstände legt der
> Projektverantwortliche fest. OpenHands erstellt **keine** endgültigen Belohnungsassets.

---

## 7. Datenarchitektur (Vorschlag, additiv)

**Grundsatz:** Vorhandene Modelle **erweitern**, keine Doppelsysteme. Keine bestehende Spalte ändern.
Jede Migration wird dokumentiert und zur Freigabe vorgelegt. **Keine** Migration in Phase 5c.

**Speichern oder berechnen?** Grundregel: **Ereignisse** (Gutschriften, Besitz, Snapshots) werden
**gespeichert**; **abgeleitete Kennzahlen** (Level, Trefferquote, Fortschritt) werden **berechnet**,
nicht redundant gespeichert. `PlayerProfile.level` und `xp` sind die Ausnahme: Sie werden als
**Materialisierung** des Ledgers gespeichert, damit Profilabfragen nicht jedes Mal den Ledger
aggregieren müssen – der Ledger bleibt die Wahrheit.

### 7.1 Neue/erweiterte Modelle (Vorschlag)

| Modell / Erweiterung              | Zweck                                                                                                                                                          | Neu oder Erweiterung                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `User.role` um `PLAYER` erweitern | Registrierte Spieler sind weder Trainer noch Admin; **keine** Admin-/Trainerrechte                                                                             | **Erweiterung des Enums** (Migration)             |
| `User.emailVerifiedAt?`           | Bestätigung der E-Mail (verbindlich, §4.3)                                                                                                                     | **Erweiterung** (nullable)                        |
| `PlayerProfile`                   | 1:1 zu `User`; `xp`, `level`, `selectedCharacterId`, `avatarConfig` (JSONB), `totalScore`, `gamesPlayed`, `wins`, `podiums`, `correctAnswers`, `answeredCount` | **neu**                                           |
| `Character`                       | Katalog der Figuren: `id`, `name`, `rarity`, `unlockRule`                                                                                                      | **neu** (oder Konstante in `shared`, siehe unten) |
| `CosmeticItem`                    | Katalog der Gegenstände: `id`, `characterId` (**charakterexklusiv**), `slot`, `rarity`, `unlockRule`, `zIndex`                                                 | **neu**                                           |
| `PlayerInventory`                 | Besitz: `userId`, `itemId`, `acquiredAt`, `source`, `equipped`                                                                                                 | **neu**                                           |
| `PlayerAchievement`               | Erfolge: `userId`, `achievementId`, `unlockedAt`, `progress`                                                                                                   | **neu**                                           |
| `GamePlayer.userId?`              | Verknüpfung Gast→Konto (nullable, additiv)                                                                                                                     | **Erweiterung**                                   |
| `GamePlayer.characterId?`         | gewählte Figur im Spiel (nullable, additiv)                                                                                                                    | **Erweiterung**                                   |
| `XpLedger`                        | append-only XP-Protokoll: `userId`, `amount`, `reason`, `gameId`, `createdAt`                                                                                  | **neu** (Nachvollziehbarkeit, Anti-Doppelvergabe) |
| `Game.guestClaim`                 | kurzlebiger, einmaliger Übernahmenachweis (Token-Hash, `expiresAt`, `usedAt`)                                                                                  | **neu** (Gastkonto-Übernahme, §4.4)               |
| `GameSnapshot`                    | unveränderliche Quiz-Momentaufnahme je Spiel (§8.7)                                                                                                            | **umgesetzt (6.4)**                               |

**Nicht gespeichert (berechnet):** Trefferquote (`correctAnswers / answeredCount`), Fortschritt bis
zum nächsten Level (aus `xp` + Levelkurve §5.4), Ranglistenposition. **Nicht** redundant gespeichert,
um Widersprüche zu vermeiden.

### 7.2 Katalogdaten: Datenbank oder Code?

**Vorschlag:** **Figuren und Gegenstände als Katalog in `@zeropeek/shared`** (Konstanten), **pro
Charakter versioniert** (charakterexklusive Gegenstände, §3.2). Begründung: Der Katalog ist
Produktdefinition, ändert sich selten, muss auf **Client und Server** identisch sein
(Kompatibilitätsmatrix, Darstellung), und `shared` ist bereits die einzige Wahrheit für solche
Verträge. Die **Datenbank** speichert nur **Besitz und Zustand** (`PlayerInventory`,
`PlayerAchievement`, `PlayerProfile`).

Die **Levelkurve** (§5.4) wird als **eine** Funktion in `shared` implementiert (z. B.
`levelForXp(xp)`, `xpForLevel(n)`); es gibt **keine** zweite Leveltabelle in einer anderen Komponente.

Vorteil: keine Migration für einen neuen Hut; der Client kennt ihn sofort; die Kompatibilitätsmatrix
bleibt an einer Stelle. **Offene Frage:** Katalog in `shared` oder in der Datenbank (siehe §16).

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
| Doppelte Gastkonto-Übernahme            | `Game.guestClaim` einmalig (`usedAt`) + `XpLedger`-Unique; serverseitige Prüfung           |
| Übernahme fremder Gastrunde             | Übernahmenachweis ist an **Session und Runde** gebunden, nicht nur an die Spiel-ID         |
| Manipulierte Charakterausrüstung        | `PlayerInventory` nur serverseitig schreibbar; Ausrüstung gegen den Katalog validiert      |

**Wichtig:** Der XP-Vergabezeitpunkt ist der **Spielabschluss**. Er wird serverseitig im Motor
ausgelöst (`end`), in einer **Transaktion** mit der Erfolgsprüfung und der Platzierungsbonus-Berechnung.

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

### 8.7 Unveränderliche Quizhistorie – Quiz-Snapshot (verbindlich, Phase 5c)

**Verbindlich:** Beim **Start** einer Spielrunde wird eine **unveränderliche Momentaufnahme** des
verwendeten Quiz erstellt. Sie enthält mindestens: Fragen, Antwortmöglichkeiten, korrekte Lösungen,
Fragetypen, Reihenfolge und die relevanten Einstellungen.

- Spätere Änderungen am ursprünglichen Quiz dürfen die **bereits gespielte** Runde **nicht** verändern.
- Auch das **Löschen** eines Quiz darf **keine** historischen Spielergebnisse zerstören.
- Die bereits identifizierte Gefahr (R-3: `quizService.updateQuiz` löscht und erstellt Fragen neu;
  `PlayerAnswer.questionId` ist `onDelete: Cascade`) wird damit technisch **entschärft**.

**Vorgesehene Umsetzung (Konzept, Roadmap §6.4):** eine `GameSnapshot`-Tabelle, die beim
`host:start` einmalig die Fragen-/Antwortstruktur des Quiz **kopiert** (JSONB oder normalisiert).
Die Spielrunde liest Fragen danach **aus dem Snapshot**, nicht aus dem live editierbaren Quiz. Das
ist eine additive Schemaerweiterung und wird **erst nach Freigabe** migriert.

> **Keine** Migration und **keine** Codeänderung in Phase 5c.

**Umgesetzt (Phase 6.4):** genau so gebaut. Ein JSONB-Umschlag je Spiel (`game_snapshots`,
`game_id` unique), geschrieben beim Spielstart in derselben Transaktion wie `startedAt`.
`games.quiz_id` und `game_snapshots.quiz_id` sind `ON DELETE SET NULL`, `player_answers.question_id`
hat keinen Fremdschlüssel mehr – ein Quiz zu löschen kann also weder eine Runde noch ihre Antworten
entfernen. Bestandsrunden ohne Snapshot werden beim ersten Report-Lesen nachgefroren. Report:
`docs/reports/phase-6-4-quiz-editor-snapshot.md`.

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

| #   | Szene                | Inhalt                                                           | Animation               |
| --- | -------------------- | ---------------------------------------------------------------- | ----------------------- |
| 1   | Begrüßung            | Logo, Titel, „Gleich geht's los", Hintergrundbild                | Fade-in                 |
| 2   | Spielerbeitritt      | PIN riesig, **QR-Code**, URL, „Tritt bei", wachsende Avatar-Wand | Pop je Beitritt         |
| 3   | Teilnehmerübersicht  | Alle Spieler mit Avatar und Name in einem Raster                 | Gestaffeltes Einblenden |
| 4   | Spielstart-Countdown | 3 – 2 – 1 – Los!                                                 | `count-tick`, `pop`     |
| 5   | Fragenanzeige        | Frage groß, Frage x/y, Kategorie                                 | `slide-up`              |
| 6   | Antwortmöglichkeiten | Optionen groß, farbcodiert, nummeriert                           | Gestaffelt              |
| 7   | Countdown            | Ring + Zahl, ruhige Farbänderung bei wenig Zeit                  | `count-tick`            |
| 8   | Antwortauflösung     | Richtige Antwort hervorgehoben, Verteilung als Balken            | `reveal-bars`           |
| 9   | Punktevergabe        | Punkte steigen, Avatare reagieren                                | `score-count-up`        |
| 10  | Zwischenrangliste    | Rangliste mit Avataren, Rangwechsel animiert                     | `rank-shift`            |
| 11  | Finalrunde           | Ankündigung, besonderer Hintergrund                              | Dramatik-Puls           |
| 12  | Gewinnerpodium       | 1./2./3. mit Avatar, Krone, Punkten                              | `podium-rise`           |
| 13  | Abschluss            | Dank, Statistiken, Ausblick                                      | Fade-in                 |

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

### 10.5 Hintergrundauswahl (verbindlich, Phase 5c)

Die Auswahl des Spielhintergrunds erhält als **Standardwert: ZUFALL**.

- **Zufallsverhalten:** Bei „Zufall" wird **genau einmal** für die jeweilige Spielrunde ein
  Hintergrund bestimmt. **Alle** Teilnehmer und die Host-/Beamer-Ansicht sehen **denselben**
  Hintergrund. Er bleibt während der **gesamten** Runde bestehen.
- **Kein** neuer Hintergrund bei jedem Spielerbeitritt oder jedem Fragenwechsel.
- **Manuelle Auswahl:** Der Host kann **vor Spielbeginn** einen konkreten Hintergrund wählen. Ein
  Wechsel während einer laufenden Runde ist nur durch eine **bewusste Host-Aktion** möglich.
- **Stilrichtung (verbindlich):** sehr dunkel, Wireframe-Linien, perspektivische Räume, dezente
  geometrische Architektur, gedämpfte Farbgebung. **Keine** gerenderten 3D-Objekte, **keine**
  realistischen 3D-Räume, **keine** grellen Neonflächen.
- **Mögliche Umgebungen:** Retro Grid, Future Classroom, Quiz Arena, Spaceship Bridge, Simulation
  Room, Blockwelt Future World.

**Verbindlich:** Es wird **keine** eigene Beamer-Anwendung eingeführt. Die bestehende kombinierte
Host-/Beamer-Ansicht bleibt erhalten (§10.1).

---

## 11. Sounddesign

### 11.1 Ebenen (Briefing §33)

| Ebene     | Beispiele                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------- |
| **UI**    | Klick, Auswahl, Bestätigung, Fehler, Menü öffnen/schließen                                              |
| **Spiel** | Spielstart, Countdown, richtige Antwort, falsche Antwort, Punktegewinn, Rangwechsel, Finalrunde, Sieger |
| **Musik** | ruhige Spielmusik, spannungsaufbauende Quizmusik, dynamische Finalmusik, Siegermusik                    |

### 11.2 Audioanforderungen (Briefing §34, Phase 5c)

- **Verbindlich: Spielaudio läuft ausschließlich über die Host-/Beamer-Ansicht.** Spieler-Telefone
  spielen **keine** Show-Musik ab; sie haben höchstens **lokale UI-Effekte** (z. B. Klick), die sie
  selbst regeln können.
- Musik und Effekte **getrennt** regelbar.
- Host steuert die zentrale Show-Musik.
- Stummschaltung möglich.
- **Browser-Autoplay beachten:** Audio startet erst nach einer Nutzerinteraktion; sonst Hinweis
  „Ton aktivieren".
- Keine Dauerschleifen, die stören.
- Keine doppelten/überlappenden Effekte durch fehlerhafte Ereignisse (ein Effekt je Ereignis, mit
  Sperre während der Wiedergabe).
- Keine übermäßige CPU-/Netzwerklast (kleine Dateien, kurze Effekte).

> **Offen (praktisch zu testen):** Ob und wie die Audioübertragung im Zoom-Betrieb hörbar ankommt,
> wird später **praktisch geprüft** – nicht im Konzept entschieden.

### 11.3 Audio-Asset-Liste

Siehe `docs/assets/ASSET-BRIEFING.md`, Blöcke F (Soundeffekte) und G (Musik). Es werden **keine**
urheberrechtlich geschützten Stücke verwendet. Benötigte Dateien werden gesondert angefordert.

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
| **Gastkonto-Übernahme**                  | **neu**: einmaliger, kurzlebiger, serverseitig geprüfter Übernahmenachweis    |
| **E-Mail-Bestätigung**                   | **neu**: Bestätigungspflicht für Spielerkonten (§4.3)                         |

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

| Funktion                      | Spielermehrwert | Aufwand | Risiko   | Abhängigkeit                           | Entwicklungs-Priorität |
| ----------------------------- | --------------- | ------- | -------- | -------------------------------------- | ---------------------- |
| Designsystem                  | hoch            | mittel  | niedrig  | –                                      | **6.1 (zuerst)**       |
| Navigation/Responsive         | hoch            | mittel  | niedrig  | Designsystem                           | **6.2**                |
| Login/Registrierung           | hoch            | mittel  | mittel   | Spielerkonto, Rolle `PLAYER`           | **6.3**                |
| Quizverwaltung/Editor         | mittel          | mittel  | mittel   | Quiz-Snapshot (§8.7)                   | **6.4**                |
| Admin/Host                    | mittel          | mittel  | niedrig  | Designsystem                           | **6.5**                |
| Spielerprofile                | hoch            | mittel  | mittel   | Spielerkonto                           | **6.6**                |
| Charakter-/Avatar-System      | **sehr hoch**   | hoch    | mittel   | **Charakter-Assets**, Katalog          | **6.7**                |
| Inventar/Belohnungen/XP/Level | hoch            | mittel  | mittel   | Profile, Anti-Manipulation, Levelkurve | **6.8**                |
| Gastkonto-Übernahme           | hoch            | mittel  | **hoch** | Spielerkonto, XP-Ledger, Nachweis      | **6.8**                |
| Beamer/Game-Show              | hoch            | hoch    | mittel   | Beamer-Grafiken                        | **6.9**                |
| Hintergrundbilder/-auswahl    | mittel          | niedrig | niedrig  | **Bilder (Projektverantwortlicher)**   | **6.10**               |
| Sound/Musik                   | mittel          | mittel  | niedrig  | **Audio (Projektverantwortlicher)**    | **6.11**               |
| Statistiken/Ranglisten global | mittel          | mittel  | mittel   | Aggregation                            | **6.12**               |
| Team-Modus                    | hoch            | mittel  | mittel   | `team`-Feld                            | 6.12                   |
| Finalrunde                    | hoch            | mittel  | mittel   | Show + Motor                           | 6.12                   |
| Turnier/K.-o.                 | mittel          | hoch    | hoch     | Finalrunde                             | später                 |
| Einzelspieler                 | mittel          | hoch    | hoch     | neue Maschine                          | später                 |

**Regel:** Grundlegende Systeme zuerst. Keine Show ohne Charaktere; keine Charaktere ohne Assets.
Die **Gastkonto-Übernahme** hat ein **hohes** Risiko (Doppelgutschrift, Fremdübernahme) und hängt am
XP-Ledger; sie wird daher zusammen mit XP/Level in **6.8** umgesetzt, nicht vorher.

---

## 16. Verbindliche Entscheidungen und offene Fragen (Spiel)

### 16.1 Verbindlich (Phase 5c, 2026-11-04)

| Thema                 | Entscheidung                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Spielerregistrierung  | **Freiwillig**; Angebot beim Beitritt **und** nach Spielende; Gastzugang ohne Konto bleibt        |
| Kontoanforderungen    | E-Mail + Passwort + **E-Mail-Bestätigung** + Anzeigename                                          |
| Rolle `PLAYER`        | Wird in die Planung aufgenommen; **keine** Admin-/Trainerrechte                                   |
| Gastkonto-Übernahme   | **Verbindlich** für die **gerade abgeschlossene** Runde; einmalig, serverseitig, mit Nachweis     |
| XP-Berechnung         | **XP = im Quiz erreichte Spielpunkte**; keine zweite XP-Formel                                    |
| Platzierungsbonus     | 1./2./3. Platz = 1.500/1.000/500 XP; **nicht** in die Spielwertung eingerechnet; Gleichstand fair |
| Levelkurve            | Level 1 = 0 XP; L1→L10 je 10.000; ab L10→L11 +11.000, danach je +1.000                            |
| Levelbelohnung        | **Jeder Levelaufstieg** schaltet einen Gegenstand frei; rein kosmetisch                           |
| Gegenstände           | **Charakterexklusiv**; sichtbar am Avatar tragbar; zentraler, versionierter Katalog               |
| Persönliche Statistik | Eigener Fortschritt sichtbar; **Quizhistorie nur Administratoren**                                |
| Quizhistorie          | **Unveränderlicher Quiz-Snapshot** je Spiel (§8.7)                                                |
| Hintergrundauswahl    | **Standard Zufall**; genau einmal je Runde; Host kann vorab wählen                                |
| Sprache               | **Deutsch** standardmäßig, Englisch auswählbar; zentrale Übersetzungsarchitektur                  |
| Quizfragen            | **Keine** automatische Übersetzung oder Veränderung                                               |
| Host                  | Spielleiter, **kein** Mitspieler                                                                  |
| Host/Beamer           | **Bestehende kombinierte Ansicht** bleibt; keine eigene Beamer-Anwendung                          |
| Spielaudio            | **Ausschließlich** Host-/Beamer-Ansicht                                                           |
| QR-Code               | Spielcode **und** QR-Code in der Lobby                                                            |
| Wiederverbindung      | Für Gäste **und** registrierte Spieler                                                            |
| Redis                 | Zum Start **nicht** erforderlich                                                                  |
| Self-Hosting          | Schlanke Einzelinstanz                                                                            |
| Monitoring            | **Keine** zusätzliche Infrastruktur                                                               |
| Backups               | **Keine** neue Backup-Architektur im Projektumfang                                                |
| Performance           | **25 Spieler + Host** als reguläres Ziel; Belastungstest ~**35 Spieler + Host**                   |

### 16.2 Offene Fragen (nicht beschlossen)

1. **Katalog in `shared` oder in der Datenbank** (§7.2)?
2. **Endgültige Belohnungsmatrix** und Gegenstandszuordnung (§6.6)?
3. **Erfolgsnamen und -bedingungen** (§6.3): bestätigen?
4. **R-4/R-5** (Zustandswiederherstellung, Reconnect): umsetzen?
5. **Pause/Überspringen** (§8.5, §8.6): gewünscht?
6. **Clock-Sync** (§12.3): einführen?
7. **Spielmodi-Priorisierung** (§9): bestätigen?
8. **IP-Speicherung** (Q5): endgültig ausschließen?
9. **Levelbezeichnungen** ab Level 7 („Legende Stufe n"): bestätigen?

> **Entfallen:** „Beamer als eigene Route mit Show-Token" (§10.1) und die früheren XP-Vorschläge
> (§5.2/§5.3) – beide durch verbindliche Entscheidungen ersetzt.
