# Phase 2 – Premium Designkonzept (Designsystem, Oberflächen, Responsive)

**Projekt:** ZeroPeek
**Phase:** 2 – Produkt- und Game-Design-Konzept (Teil 1: Design)
**Datum:** 2026-11-04
**Status:** Entwurf zur Prüfung durch den Projektverantwortlichen (Dejan Popovic)
**Grundlage:** `docs/analysis/phase-1-technical-inventory.md`

> **Kein Anwendungscode, kein Schema, keine Migration, keine Assets wurden geändert oder erzeugt.**
> Dieses Dokument ist ein Konzept. Es enthält keine erfundenen vorhandenen Funktionen; jeder Bezug
> auf Bestand ist in der Bestandsaufnahme belegt.

**Designrichtung:** Premium Gaming / Dark Glassmorphism, violett-cyanfarbene Lichtstimmung,
Blockwelt-Helden-Universum.

---

## 1. Produktvision (Kurzfassung)

ZeroPeek wird eine eigenständige **Quiz- und Game-Show-Plattform** mit drei verbundenen Erlebnissen
in **einem** Produkt:

| Erlebnis       | Zielgruppe                       | Kernoberflächen                               | Erfolgskriterium                                                 |
| -------------- | -------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| **Verwaltung** | Projektverantwortlicher, Trainer | Startseite, Quizverwaltung, Editor, Admin     | Schnell ein Quiz bauen und ein Spiel starten, ohne Handbuch      |
| **Spiel**      | Spieler (Mobil)                  | Beitritt, Antworten, Profil, Avatar, Inventar | Man will „noch eine Runde" – wegen Figur, Fortschritt, Belohnung |
| **Show**       | Publikum (Beamer)                | Beamer-/Game-Show-Modus, Podium               | Wirkt wie eine echte Show, nicht wie ein vergrößertes Formular   |

**Leitentscheidung:** Design-first, danach schrittweise Implementierung. Jede größere Entscheidung
wird gegen Spielerlebnis, Nutzen, Umsetzbarkeit, Performance, Wartbarkeit, Sicherheit,
Erweiterbarkeit und Bestandskompatibilität bewertet (§13).

---

## 2. Gestaltungsprinzipien

1. **Dunkel und ruhig als Basis.** Der Hintergrund bleibt dunkel (`#08080f`/`#0e0e1a`). Farbe ist
   Akzent, nicht Fläche.
2. **Glas mit Lesbarkeit.** Glasflächen dürfen Text nie schwer lesbar machen: eine Mindestdeckkraft
   des Textes auf jeder Glasvariante ist Pflicht (§4.2, §4.4).
3. **Ein System, keine Einzelstile.** Jede Farbe, jeder Abstand, jede Rundung, jede Dauer kommt aus
   Tokens. Keine zufälligen Werte in Einzelkomponenten.
4. **Bewegung mit Bedeutung.** Animation erklärt Zustand (Frage öffnet, Punkte landen, Rang wechselt).
   Sie ist nie Dekoration um ihrer selbst willen.
5. **Große Ziele, große Flächen.** Buttons/Karten sind groß genug für Touch und für den Beamer.
6. **Wiedererkennbarkeit.** Die Blockwelt-Helden sind die Identität: gleiche Figuren, gleiche
   Silhouetten, gleiche Farben in jeder Oberfläche.
7. **Rollenklarheit.** Wer etwas darf, sieht es – aber die Anzeige ist nie die Berechtigung
   (serverseitig bleibt die Autorität).
8. **Sparsam mit Effekten.** Ein starker Effekt pro Szene. Keine konkurrierenden Animationen.
9. **Leistung ist Teil des Designs.** Ein Effekt, der auf einem Mittelklasse-Smartphone ruckelt, ist
   falsch designt, nicht nur schlecht umgesetzt.
10. **Barrierefreiheit als Grundlage.** Kontrast, Fokus, `prefers-reduced-motion`, Tastatur.

---

## 3. Farbdesign

### 3.1 Grundpalette (Bestand, bleibt)

Das vorhandene Token-Set ist die Basis und wird **erweitert, nicht ersetzt**:

| Rolle                  | Token             | Wert                     | Verwendung                      |
| ---------------------- | ----------------- | ------------------------ | ------------------------------- |
| Haupthintergrund       | `--bg`            | `#08080f`                | Seitenhintergrund               |
| Sekundärer Hintergrund | `--bg-2`          | `#0e0e1a`                | Überlagerungen, Panels          |
| Glasfläche normal      | `--surface`       | `rgba(255,255,255,.045)` | Karten                          |
| Glasfläche erhöht      | `--surface-2`     | `rgba(255,255,255,.075)` | Eingaben, Hover                 |
| Kontur                 | `--border`        | `rgba(255,255,255,.09)`  | Trennlinien                     |
| Kontur stark           | `--border-strong` | `rgba(255,255,255,.16)`  | Rahmen von Bedienelementen      |
| Text                   | `--text`          | `#f5f5fb`                | Primärtext                      |
| Text gedämpft          | `--muted`         | `#9c9cb5`                | Sekundärtext                    |
| Text schwach           | `--faint`         | `#616180`                | Platzhalter, Hinweise           |
| Akzent violett         | `--accent`        | `#7c5cff`                | Primäraktion, Fokus             |
| Akzent cyan            | `--accent-2`      | `#22d3ee`                | Sekundärakzent, Verlaufspartner |
| Verlauf                | `--grad`          | violett → cyan (135°)    | Primärbutton, Rangzahl, PIN     |
| Erfolg                 | `--ok`            | `#22c55e`                | Richtige Antwort, Erfolg        |
| Fehler                 | `--bad`           | `#f43f5e`                | Falsche Antwort, Fehler         |
| Warnung                | `--warn`          | `#f59e0b`                | Hinweis, Ablauf                 |

### 3.2 Vorgeschlagene Ergänzungen (neu, zu genehmigen)

> Diese Werte sind **Vorschläge**. Sie erweitern das Bestandsset; bestehende Tokens behalten ihren
> Wert, damit sich der Bestand optisch nicht verschiebt.

**Grundlage: die gemessene Logo-Farbwelt (Phase 5b).** Das Logo besteht (nur undurchsichtige, bunte
Pixel) zu **38,9 % aus Violett/Indigo (255–285°)**, **23,2 % aus Cyan (≈187°)**, **17,5 % aus
Magenta (285–315°)** und **20,3 % aus Blau (195–240°)**; dazu **14,9 % Silber/Grau**. Die vorhandenen
Tokens (`--accent #7c5cff`, `--accent-2 #22d3ee`) liegen in derselben Familie, treffen die Logo-Töne
aber nicht exakt. Deshalb wird eine **markengetreue Akzentleiter** vorgeschlagen, die den Tokens
**zur Seite gestellt** (nicht überschrieben) wird:

| Rolle          | Vorschlag     | Herkunft (Logo)     | Verwendung                     |
| -------------- | ------------- | ------------------- | ------------------------------ |
| Marken-Cyan    | `#15dbee`     | häufigster Cyan-Ton | helle Akzente, Show-Highlights |
| Marken-Violett | `#7c3aed`-nah | Indigo/Violett-Band | Primärakzent-Ergänzung         |
| Marken-Magenta | `#de4ef1`     | Magenta-Band        | Belohnungs-/Selten-Akzente     |
| Marken-Indigo  | `#5815bf`     | tiefes Violett      | Flächen, Verläufe              |
| Metall/Silber  | `#e2e8f0`     | Silber-Anteil       | Icons, Sekundärstrukturen      |

**Zusätzliche Akzente für Belohnungen und Raritäten** (nötig für Inventar/Erfolge/Level):

| Rolle                  | Vorschlag                     | Verwendung                                  |
| ---------------------- | ----------------------------- | ------------------------------------------- |
| Rarität „selten"       | `#7c5cff` (violett, = Akzent) | Seltene Gegenstände                         |
| Rarität „episch"       | `#c084fc`                     | Epische Gegenstände, Levelaufstieg          |
| Rarität „legendarisch" | `#fbbf24` (gold)              | Goldene Spitzhacke, Kronen, Sieger          |
| Rarität „exklusiv"     | `#22d3ee` (cyan)              | Zeitlich begrenzte Saisonstücke             |
| XP-Leiste              | Verlauf violett → cyan        | Fortschrittsbalken                          |
| Neutralflächen         | `--bg-3: #14142a`             | Karten in Karten, Tabellenzeilen im Wechsel |

**Beamer-spezifische Palette** (eigene Tokens, siehe §9): stärkere Kontraste und größere
Farbflächen, weil aus Distanz betrachtet wird.

### 3.3 Statusfarben und Semantik

| Zustand                | Farbe              | Nicht nur Farbe: zusätzlich          |
| ---------------------- | ------------------ | ------------------------------------ |
| Richtige Antwort       | `--ok`             | Häkchen-Symbol + Text „Richtig"      |
| Falsche Antwort        | `--bad`            | Kreuz-Symbol + Text „Falsch"         |
| Keine Antwort          | `--muted`          | Strich-Symbol + Text „Keine Antwort" |
| Offene Frage / Achtung | `--warn`           | Uhr-Symbol                           |
| Verbunden / getrennt   | `--ok` / `--faint` | Punkt + Text „verbunden"/„getrennt"  |
| Fokus (Tastatur)       | `--accent`         | 2 px Fokusring mit Offset            |

**Regel:** Farbe ist nie das einzige Signal (Farbfehlsichtigkeit). Jeder Status hat Symbol + Text.

### 3.4 Kontrastanforderung

- Primärtext auf Glas: Ziel **≥ 7:1** (WCAG AAA für Fließtext).
- Sekundärtext: **≥ 4.5:1**.
- Der Beamer wird auf **≥ 4.5:1** bei deutlich größerer Schrift optimiert.
- Prüfung erfolgt in der Implementierungsphase automatisiert (siehe Roadmap, Teststrategie).

---

## 4. Glassmorphism – abgestufte Varianten

Heute existiert genau **eine** Glasfläche (`.card`: `rgba(255,255,255,.045)` + `blur(16px)` +
Rahmen + Schatten). Das Briefing verlangt **mehrere abgestufte Varianten**. Vorschlag von sechs
Varianten mit definierten Werten:

| Variante       | Token             | Fläche                   | Unschärfe | Kontur                                  | Schatten                                        | Einsatz                            |
| -------------- | ----------------- | ------------------------ | --------- | --------------------------------------- | ----------------------------------------------- | ---------------------------------- |
| **Karte**      | `--glass-card`    | `rgba(255,255,255,.045)` | 16 px     | `1px solid rgba(255,255,255,.09)`       | `0 20px 50px -20px rgba(0,0,0,.7)` + Innenlicht | Standardkarten                     |
| **Erhöht**     | `--glass-raised`  | `rgba(255,255,255,.075)` | 20 px     | `1px solid rgba(255,255,255,.16)`       | wie Karte, +10 % Tiefe                          | Hover, aktive Karte, Dialog-Träger |
| **Dialog**     | `--glass-dialog`  | `rgba(14,14,26,.92)`     | 24 px     | `1px solid rgba(255,255,255,.16)`       | `0 30px 80px -30px rgba(0,0,0,.85)`             | Modale, Overlays                   |
| **Navigation** | `--glass-nav`     | `rgba(10,10,20,.72)`     | 18 px     | unten `1px solid rgba(255,255,255,.09)` | `0 8px 30px -12px rgba(0,0,0,.6)`               | Seitenleiste, Kopfzeile            |
| **Eingabe**    | `--glass-input`   | `rgba(255,255,255,.06)`  | 10 px     | `1px solid rgba(255,255,255,.16)`       | –                                               | Felder, Selects                    |
| **Overlay**    | `--glass-overlay` | `rgba(4,4,10,.72)`       | 6 px      | –                                       | –                                               | Abdunklung hinter Dialog           |

**Regeln:**

1. **Mindestkontrast:** Auf `--glass-card` und `--glass-raised` darf Text nur in `--text` oder
   `--muted` gesetzt werden, nie in `--faint`.
2. **Nicht stapeln:** Maximal **zwei** Glasflächen übereinander (z. B. Dialog über Overlay). Drei
   oder mehr Ebenen erzeugen Milchigkeit und brechen die Lesbarkeit.
3. **Unschärfe ist teuer.** `backdrop-filter` wird nur auf Flächen mit sichtbarem Hintergrund
   verwendet. Auf dem Beamer (statischer Hintergrund) wird `blur` reduziert oder abgeschaltet
   (§9, §12).
4. **Fallback:** Ohne `backdrop-filter`-Unterstützung (oder bei `prefers-reduced-transparency`)
   fällt jede Variante auf eine **deckende** Fläche zurück, die den Kontrast garantiert. Der Fallback
   ist Pflicht, nicht optional.
5. **Nicht über Text:** Glas liegt nie direkt hinter Fließtext ohne Kontur.

---

## 5. Typografie

Heute gibt es einen System-Font-Stack und wenige, nicht systematisierte Größen. Vorschlag:

### 5.1 Schriftfamilie

- **Empfehlung:** System-Stack beibehalten (kein Web-Font-Download, keine Ladezeit, kein
  Datenschutzthema, CSP-konform).
- **Optional:** eine einzelne, lokal gehostete Anzeigeschrift **nur** für Überschriften und
  Zahlenanzeigen (Beamer, Punkte, Level). Entscheidung liegt beim Projektverantwortlichen; ohne
  Freigabe bleibt der
  System-Stack. Kein externes CDN (CSP `font-src 'self'` wäre sonst nötig).
- **Zahlen:** `font-variant-numeric: tabular-nums` überall, wo Zahlen sich live ändern (Countdown,
  Punkte, Rang, PIN). Das ist bereits an mehreren Stellen vorhanden und wird systematisiert.

### 5.2 Typografische Rollen

| Rolle                 | Token                  | Größe (Desktop)                  | Gewicht | Zeilenhöhe | Einsatz                        |
| --------------------- | ---------------------- | -------------------------------- | ------- | ---------- | ------------------------------ |
| Seitentitel           | `--type-page`          | `clamp(1.6rem, 3vw, 2.25rem)`    | 750     | 1.1        | Kopf jeder Seite               |
| Abschnittsüberschrift | `--type-section`       | `1.15rem`                        | 700     | 1.2        | Gruppierung                    |
| Kartentitel           | `--type-card`          | `1.05rem`                        | 650     | 1.25       | Kartenkopf                     |
| Fließtext             | `--type-body`          | `0.95rem`                        | 400–600 | 1.5        | Inhalt                         |
| Beschriftung          | `--type-label`         | `0.8rem`                         | 600     | 1.3        | Feldlabels, Tabellenkopf       |
| Hilfetext             | `--type-help`          | `0.75rem`                        | 400     | 1.4        | Hinweise                       |
| Zahlenanzeige         | `--type-number`        | `1.6rem`                         | 750     | 1          | Punkte, Werte                  |
| Punktestand groß      | `--type-score`         | `clamp(2rem, 5vw, 3rem)`         | 800     | 1          | Rangliste, Ergebnis            |
| Countdown             | `--type-countdown`     | `clamp(2.5rem, 10vw, 6rem)`      | 800     | 1          | Beamer/Spieler-Timer           |
| Beamer-Frage          | `--type-show-question` | `clamp(1.75rem, 3.5vw, 3.25rem)` | 700     | 1.15       | Fragenprompt auf großer Fläche |
| Beamer-Antwort        | `--type-show-answer`   | `clamp(1.25rem, 2vw, 2rem)`      | 600     | 1.2        | Antwortoptionen Beamer         |

### 5.3 Regeln

- **Keine Schriftgröße unter 0.75 rem** in bedienbaren Bereichen; auf dem Beamer **nichts unter
  1.25 rem**.
- **Umbruch:** Beamer-Fragen brechen spätestens nach 2 Zeilen; lange Antworten werden gekürzt
  (Ellipse) mit vollem Text im Tooltip/Arialabel – nie über den Rand laufen.
- **Zeilenlänge:** Fließtext max. ~70 Zeichen (ca. `62ch`).
- **Gewicht statt Größe:** Hierarchie bevorzugt über Gewicht/Farbe, nicht über viele Größenstufen.

---

## 6. Komponenten

Alle Komponenten sind **aus Tokens** gebaut, CSP-konform (keine Inline-Styles/-Skripte), und über
den vorhandenen DOM-Builder (`dom.ts`, `textContent`) erzeugt. Jede Komponente hat die Zustände
`default`, `hover`, `focus-visible`, `active`, `disabled`, `loading`, `error` (wo sinnvoll).

### 6.1 Inventar und Status

| Komponente                            | Bestand?                 | Vorschlag / Ergänzung                                                                    |
| ------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| Button (`primary`, `ghost`, `danger`) | **vorhanden**            | Ergänzen: `secondary` (cyan), `icon`, Ladezustand mit Spinner, Mindesthöhe 44 px (Touch) |
| Karte                                 | **vorhanden**            | Varianten `card--raised`, `card--interactive`, `card--rarity` (Rarität-Rahmen)           |
| Eingabefeld / Select                  | **vorhanden**            | Ergänzen: Fehlerzustand mit Meldung, Zeichenzähler, Größen `sm`/`md`/`lg`                |
| Dialog / Overlay                      | **vorhanden**            | Systematisieren: Fokusfalle, `Esc` schließt, `aria-modal`, Bestätigungsdialog            |
| Tabs                                  | **fehlt**                | Neu: `tablist`/`tab`/`tabpanel`, Tastaturnavigation (Pfeiltasten)                        |
| Navigation                            | **teilweise**            | Neu: Seitenleiste (Desktop), Bottom-Bar (Mobil), Kopfzeile mit Breadcrumb                |
| Dropdown / Menü                       | **fehlt**                | Neu: Aktionsmenü mit Tastatur und `aria-haspopup`                                        |
| Fortschrittsanzeige                   | **teilweise**            | Neu: XP-Leiste, Levelring, Fragefortschritt, Antwortquote                                |
| Statusanzeige                         | **fehlt**                | Neu: Badge/Chip mit Farbe **und** Symbol                                                 |
| Rangliste                             | **vorhanden**            | Ergänzen: Podiumsvariante, Avatar-Spalte, Rangwechsel-Animation                          |
| Spieleranzeige                        | **teilweise**            | Neu: Spielerkarte (Avatar + Name + Punktestand + Verbindungsstatus)                      |
| Avatar-Vorschau                       | **fehlt**                | Neu: gerahmte Figur mit Accessoire-Layern und Raritätsrahmen                             |
| Benachrichtigung                      | **vorhanden** (`.toast`) | Systematisieren: Positionen, Dauer, `aria-live`, Stapelung                               |
| Chip / Badge                          | **fehlt**                | Neu: für Kategorien, Schwierigkeitsgrade, Erfolge                                        |
| Skeleton-Ladeplatzhalter              | **fehlt**                | Neu: für Listen und Karten statt Vollflächen-Spinner                                     |
| Leerer Zustand                        | **teilweise**            | Neu: einheitliche „noch nichts hier"-Darstellung mit Aktion                              |
| Countdown-Ring                        | **fehlt**                | Neu: Beamer-Timer mit Fortschrittsring und Zahl                                          |
| Podium                                | **fehlt**                | Neu: 1./2./3. Platz mit Avatar und Krone                                                 |

### 6.2 Verhalten und Regeln

- **Fokus:** Jedes interaktive Element hat einen sichtbaren `:focus-visible`-Ring (`--accent`,
  2 px, Offset 2 px). Fokusreihenfolge folgt der Leserichtung.
- **Ladezustand:** Ein Button, der arbeitet, zeigt einen Spinner und ist gesperrt; kein doppelter
  Klick (bereits heute in mehreren Stellen so umgesetzt – wird systematisiert).
- **Fehler:** Feldnahe Fehlermeldung, nicht nur ein globaler Toast. Der Server liefert Feldpfade
  (`issues[].path`) – diese werden an das Feld gebunden.
- **Bestätigung:** Zerstörende Aktionen (Quiz löschen, Spiel beenden, Spieler entfernen) bekommen
  einen Bestätigungsdialog mit klarer Konsequenz. Kritische Host-Aktionen zusätzlich mit deutlicher
  Beschriftung (§8.4).
- **Leere Zustände** erklären, was zu tun ist, und bieten die Aktion direkt an.
- **Touch:** Alle Ziele ≥ 44 × 44 px, Abstand ≥ 8 px.

---

## 7. Bewegung und Animation

### 7.1 Grundregeln

1. **Zweck vor Effekt.** Jede Animation erklärt etwas (Zustandswechsel, Fokus, Ergebnis).
2. **Kurze Wege.** Übergänge 150–240 ms (bestehende Tokens `--dur-fast`, `--dur`). Show-Szenen
   dürfen länger sein (bis 600 ms), aber nie blockieren.
3. **Ein Höhepunkt pro Szene.** Nicht gleichzeitig aufblenden, schütteln und funkeln.
4. **`prefers-reduced-motion` respektieren.** Dann werden Animationen durch sofortige
   Zustandswechsel ersetzt (kein Funken, kein Schütteln, keine Bewegung großer Flächen).
5. **Kein Layout-Thrashing.** Animiert werden `transform` und `opacity`, nicht `width`/`height`/
   `top`/`left` (Ausnahme: der Fortschrittsbalken, der `width` animiert – dort bewusst, weil es
   selten und klein ist).
6. **60 fps als Ziel, 30 fps als Untergrenze** auf einem Referenz-Mittelklasse-Smartphone.
7. **Keine Endlosanimation im Vordergrund.** Dauerhafte Bewegung nur als ruhiger Hintergrund
   (Aurora/Sternenhimmel) und auf `prefers-reduced-motion` abschaltbar.

### 7.2 Vorgeschlagene Animationsbibliothek (Tokens)

| Name                | Dauer   | Kurve      | Einsatz                                          |
| ------------------- | ------- | ---------- | ------------------------------------------------ |
| `fade-in`           | 180 ms  | `--ease`   | Bildschirm-/Kartenwechsel                        |
| `slide-up`          | 220 ms  | `--ease`   | Karten, Dialoge, Antwortoptionen                 |
| `pop`               | 200 ms  | `--spring` | Bestätigung, Punkte, Erfolg                      |
| `shake`             | 300 ms  | linear     | Falsche Antwort (subtil)                         |
| `count-tick`        | 200 ms  | `--ease`   | Countdown-Zahlwechsel                            |
| `reveal-bars`       | 400 ms  | `--ease`   | Antwortverteilung wächst                         |
| `rank-shift`        | 350 ms  | `--ease`   | Rangwechsel in der Rangliste                     |
| `score-count-up`    | 600 ms  | `--ease`   | Punkte zählen hoch                               |
| `podium-rise`       | 600 ms  | `--spring` | Podium erscheint (Beamer)                        |
| `confetti`          | 1200 ms | linear     | Sieger (Beamer; abschaltbar, ressourcenschonend) |
| `starlight-twinkle` | 3–6 s   | linear     | Login-Sternenhimmel (sehr dezent)                |
| `shooting-star`     | 900 ms  | `--ease`   | Login, selten (alle ~12 s)                       |

**Regel:** Diese Bibliothek ist **geschlossen**. Neue Animationen müssen entweder eine vorhandene
wiederverwenden oder begründet als Token ergänzt werden – nie ad hoc in einer Komponente.

---

## 8. Oberflächen (Screens) im Detail

Für jeden wichtigen Bildschirm: Zweck, Layout, Komponenten, Navigation, Interaktionen, Zustände,
Responsive, technische Abhängigkeiten. **Alle hier genannten neuen Bereiche sind Vorschläge.**

### 8.1 Startseite / Dashboard (neu, Konsolidierung)

- **Zweck:** Ein zentraler Einstieg, der je nach Rolle die richtigen Wege zeigt.
- **Layout (Desktop):** Seitenleiste links (Navigation), oben eine Kopfzeile mit Logo (verlinkt auf
  die Startseite) und Rollenmenü; Inhalt als mehrspaltiges Kartenraster: „Weiter spielen", „Letzte
  Spiele", „Schnellstart" (letztes Quiz starten), „Profil-Fortschritt" (XP, Level, nächste
  Belohnung), „Ranglisten-Ausschnitt".
- **Rollen:** Trainer sieht Verwaltung; Spieler sieht Profil/Avatar/Inventar; Admin sieht zusätzlich
  Admin. Die Anzeige folgt der Rolle, die Prüfung bleibt serverseitig.
- **Zustände:** Erststart (keine Spiele → „Erstes Quiz anlegen"), leer, geladen, Fehler.
- **Abhängigkeiten:** Neue Startseite ersetzt nicht die vorhandenen Seiten; sie **verlinkt** sie.
  Braucht ein Spielerprofil (Phase 6.6) für den Fortschrittsbereich.

### 8.2 Login und Registrierung

- **Zweck:** Trainer/Admin anmelden; Spieler können sich registrieren (neu) oder als Gast beitreten.
- **Login-Layout:** Zentrierte Milchglaskarte auf animiertem Sternenhimmel (Kapitel 10 im Briefing,
  siehe `docs/concept/game-design-concept.md` §10). Logo oben, Titel, Benutzername, Passwort,
  Primäraktion, Link „Passwort vergessen?" (später), Link „Als Gast beitreten".
- **Registrierung (neu, verbindlich):** Anzeigename, **E-Mail (Pflicht)**, Passwort mit Stärkeanzeige
  und Mindestlänge (10 Zeichen, wie Bestand), Bestätigung, **E-Mail-Bestätigung**. Danach direkt in
  die Charakterauswahl.
- **Registrierungsangebot beim Spielbeitritt (verbindlich):** dezenter Hinweis, der den Beitritt
  **nicht verzögert**: „Erstelle dein kostenloses ZeroPeek-Konto und sichere deinen Fortschritt
  dauerhaft." Auswahl: **als Gast fortfahren**, **Konto erstellen**, **anmelden**. Der Gastbeitritt
  bleibt sofort möglich.
- **Registrierungsangebot nach Spielende (verbindlich):** erneutes Angebot mit Nutzenliste (XP
  sichern, Statistik aufbauen, Level behalten, Gegenstände freischalten, Avatar ausstatten). Ein Gast
  kann die **gerade abgeschlossene** Runde übernehmen (`game-design-concept.md` §4.4).
- **Gastspieler:** Kein Konto, nur Nickname + PIN. Temp-Avatar (Standardfigur mit Zufallsfarbe).
  Hinweis: „Als Gast spielst du ohne dauerhaften Fortschritt."
- **Zustände:** Leerlauf, Validierungsfehler (feldnah), Laden, gesperrt (disabled-Konto),
  E-Mail bereits vergeben, **E-Mail unbestätigt**, Erfolg.
- **Abhängigkeiten:** Registrierung braucht ein Spielerkonto-Modell (neu, §7.1 im
  Game-Design-Konzept). Bestehende Auth (Argon2id, Sessions, CSRF) wird **erweitert, nicht ersetzt**.
- **Wichtig:** Bestehende Konten und Rollen bleiben unverändert. Registrierte Spieler sind **keine**
  `ADMIN`/`TRAINER`; die Rolle `PLAYER` ist eine additive Ergänzung des Enums (Migration, Freigabe).

### 8.3 Quizverwaltung

- **Zweck:** Übersicht aller Quizze, Aktionen, Zustand.
- **Layout:** Kopfzeile mit Titel und Aktionen (Neu, Importieren). Liste als Kartenzeilen oder
  Tabelle (umschaltbar): Titel, Beschreibung, Fragenzahl, Kategorie (neu), Schwierigkeit (neu),
  zuletzt geändert, Aktionen (Bearbeiten, Duplizieren, Exportieren, Löschen, Starten).
- **Interaktionen:** Suche/Filter (neu), Sortierung, Löschen mit Bestätigung.
- **Zustände:** leer („erstes Quiz anlegen"), geladen, Fehler, Ladeplatzhalter.
- **Abhängigkeiten:** Kategorie/Schwierigkeit brauchen additive Felder (Migration). Import/Export
  bleiben unverändert.

### 8.4 Quiz-Editor

- **Zweck:** Quizze schnell und sicher bauen.
- **Layout:** Kopf mit Titel/Eingaben und Speichern; darunter Fragenliste als große Karten; jede
  Karte: Typ-Badge, Fragetext (großes Feld), typspezifische Felder, Zeitlimit, Punkte, Kategorie/
  Schwierigkeit (neu); links ein Griff zum Ziehen (Drag-and-drop, neu), ↑/↓ bleiben als
  Tastatur-Alternative erhalten; unten „Frage hinzufügen" und „Vorschau".
- **Interaktionen:** Drag-and-drop mit Tastatur-Alternative (Pflicht für Barrierefreiheit),
  Autospeichern mit sichtbarem Zustand („gespeichert vor X s"), Undo (neu), Vorschau als Overlay,
  Bestätigungsdialog beim Verlassen mit ungespeicherten Änderungen.
- **Zustände:** ungespeichert/gespeichert/speichert/Fehler; Validierungsfehler feldnah.
- **Abhängigkeiten:** Der Editor darf die bestehende **serverseitige** Validierung nicht umgehen.
  Autospeichern nutzt den vorhandenen `PUT /api/quizzes/:id`.
- **Bestandsschutz-Warnung (R-3):** Das Speichern ersetzt die Fragenliste und kaskadiert Antworten.
  Autospeichern würde das Risiko **erhöhen** (häufigere Ersetzungen). Empfehlung: Autospeichern erst
  nach einer Entscheidung zu R-3 einführen, oder nur für Metadaten (Titel/Beschreibung), nicht für
  die Fragenliste. **Das ist eine offene Frage an den Projektverantwortlichen.**

### 8.5 Admin-Bereich

- **Zweck:** Benutzer, Rollen, System, Statistik verwalten.
- **Layout:** Seitenleiste mit Unterbereichen (Benutzer, Rollen, Quizze, Kategorien, Statistiken,
  Einstellungen, Spielverwaltung). Das Logo in der Kopfzeile verlinkt auf das Admin-Dashboard
  (bereits umgesetzt in PR #15).
- **Interaktionen:** Wie heute (Anlegen, Rolle, Sperren, Passwort-Reset), modernisiert.
- **Zustände:** Tabellen mit Lade-/Leer-/Fehlerzustand.
- **Abhängigkeiten:** Bestehende Regeln (letzter Admin) bleiben serverseitig. Neue Unterbereiche
  (Statistiken, Kategorien) brauchen neue Endpunkte – separat freizugeben.

### 8.6 Host-Steuerung

- **Zweck:** Ein Spiel souverän führen, ohne die Show zu verlassen.
- **Layout:** Drei Bereiche: **links** Spielzustand (Phase, Frage x/y, verbleibende Zeit, wie viele
  geantwortet haben); **Mitte** die Show-Fläche (dieselben Szenen wie der Beamer, siehe §9); **rechts
  oder unten** die Steuerleiste (Start, Pause/Fortsetzen, Auflösen, Nächste Frage, Überspringen,
  Rangliste, Beenden, Musik/Sound, Teilnehmer).
- **Zustandsanzeige:** Immer sichtbar, in welcher Phase das Spiel ist – mit Farbe **und** Text.
- **Kritische Aktionen:** Beenden und Überspringen mit Bestätigung; „Beenden" hebt sich ab.
- **Erreichbarkeit:** Die häufigsten Aktionen (Auflösen, Nächste) sind die größten und liegen an
  einer festen Stelle; Tastaturkürzel (neu, nur Host) mit sichtbarer Übersicht.
- **Abhängigkeiten:** Pause/Fortsetzen existiert heute **nicht** und braucht Motor-Erweiterung
  (Freigabe nötig, §42 im Briefing). Überspringen existiert heute **nicht**.
- **Verbindlich (Phase 5c):** Die Host-Steuerung und die Präsentationsfläche sind **dieselbe
  kombinierte Ansicht** (§8.14). Es gibt **keine** separate Beamer-Anwendung. Steuerung und Anzeige
  sind auf derselben Seite visuell klar getrennt (z. B. ein-/ausblendbare Steuerleiste).

### 8.7 Spieleroberfläche

- **Zweck:** In Sekunden beitreten, entspannt antworten, Ergebnis sehen.
- **Layout (Mobil zuerst):** Beitritt (PIN, Nickname, Avatar-Vorschau), Wartezimmer („Du bist dabei",
  Spielerzahl, Avatar), Frage (großer Prompt, große Antwortflächen, Countdown), Auflösung (Richtig/
  Falsch, eigene Punkte, Rang), Rangliste, Ende (Platz, Punkte, Podium, „Nochmal spielen").
- **Interaktionen:** Eine Antwort pro Frage (bereits serverseitig erzwungen). Antwortflächen groß,
  deutlich, mit Farbwechsel beim Wählen. Kein Doppeltippen.
- **Zustände:** getrennt/verbunden, „warten auf Host", „Zeit abgelaufen", „bereits geantwortet",
  Fehler.
- **Registrierungsangebot (verbindlich, Phase 5c):** Beim Beitritt ein **dezenter, abbrechbarer**
  Hinweis („Konto erstellen und Fortschritt sichern"), der den Beitritt **nicht verzögert**. Am
  **Spielende** ein erneutes Angebot mit Nutzenliste; ein Gast kann die **gerade abgeschlossene**
  Runde übernehmen (`game-design-concept.md` §4.2/§4.4).
- **Abhängigkeiten:** `questionInput` (vorhanden) bleibt die Basis; die Darstellung wird
  erweitert (Avatar, Animationen), die Eingabelogik nicht verändert.

> **Phasenabgrenzung (Phase 6.2.2):** In Phase 6.2.2 werden **nur** die Lobby-Anteile verbessert, die
> ohne neue Assets und ohne Datenmodell möglich sind: Anzeige der Mitspieler und der bereits
> vorhandenen Verbindungszustände sowie Status-/Feedbackmeldungen. Die **Avatar-Vorschau** und die
> **Avatar-Anzeige** gehören zur Charakter-/Avatar-Phase **6.7** (Charakter-Assets fehlen). Gäste
> nehmen weiterhin mit einer **Standardfigur ohne Avatar-Auswahl** teil. Das **Registrierungsangebot**
> (Beitritt/Spielende) gehört zu **6.3**. Verbindliche Abgrenzung:
> `../roadmap/technical-roadmap.md` §3.1.

### 8.8 Spielerprofil (neu)

- **Zweck:** Fortschritt sichtbar machen – Charakter, Level, XP, Erfolge, **persönliche Statistik**.
- **Layout:** Kopf mit großem Charakterbild (der gewählte Held), Name, Level, XP-Leiste zur nächsten
  Stufe. Darunter Kacheln: Gesamtpunktzahl, Trefferquote, Spiele, **gewonnene Spiele**,
  **Podiumsplätze**, beste Serie, längste Serie, persönliche Bestleistungen; Galerie „Erfolge";
  Vorschau „Nächste Belohnung".
- **Verbindlich (Phase 5c):** Das Profil zeigt **nur die persönliche Statistik** (eigener
  Fortschritt). Die **Quizhistorie** (alte Fragen, Antworten, Spielberichte, Ergebnisse anderer)
  bleibt **ausschließlich Administratoren** vorbehalten – sie erscheint **nicht** im Spielerprofil.
- **Zustände:** neu (noch keine Spiele), teilweise, voll; gesperrte Erfolge als Silhouette mit
  Bedingung.
- **Abhängigkeiten:** Braucht Spielerkonto + XP/Level/Statistik (neu). Daten kommen ausschließlich
  serverseitig (§17 im Briefing; `game-design-concept.md` §4.7).

> **Phasenabgrenzung (Phase 6.2.2):** Ein **echtes** Spielerprofil ist **nicht** Teil von 6.2.2. Es
> setzt Konto und Rolle `PLAYER` (6.3) sowie das Profilmodell und die Profil-API (6.6) voraus und
> braucht die Charakter-Assets (6.7) für das zentrale Charakterbild. In 6.2.2 zeigt der Nav-Bereich
> „Profil" **nur** einen klar gekennzeichneten Platzhalter („Dein Spielerprofil kommt mit Phase 6.6.")
> – ohne Profil-Datenmodell, ohne Profil-API und ohne Datenbankänderung. Verbindliche Abgrenzung:
> `../roadmap/technical-roadmap.md` §3.1.

### 8.9 Blockwelt-Helden-Charakterauswahl (neu)

- **Zweck:** Aus den verbindlichen Figuren wählen (ca. **15** geplant, endgültige Liste nach
  Originalassets).
- **Layout:** Raster von Charakterkarten (Ethan, Maya, Pixel, Biene; Dr. Obscura und O-Bots als
  besondere/freischaltbare). Jede Karte: Figur, Name, kurze Eigenschaft, Sperrzustand.
- **Interaktionen:** Auswählen → Bestätigen. Gesperrte zeigen die Freischaltbedingung.
- **Zustände:** verfügbar, gesperrt (mit Bedingung), ausgewählt, wird geladen.
- **Verbindlich (Phase 5c):** Jeder Charakter hat **eigene** Gegenstände. Beim Wechsel wird die
  Ausrüstung des gewählten Charakters angezeigt; Gegenstände anderer Charaktere werden **nicht**
  übertragen (`game-design-concept.md` §3.2).
- **Abhängigkeiten:** Braucht die Charakter-Assets (fehlen, R-10) und ein Charaktermodell (neu).

### 8.10 Avatar-Editor (neu)

- **Zweck:** Die Figur individualisieren.
- **Layout:** Mitte die große Figur (Layer-Vorschau), rechts/oben Kategorien (Kopfbedeckung, Brille,
  Kleidung, Werkzeug, Zubehör, Farbe, Effekt), darunter die Auswahl je Kategorie. Links ein
  „Zufällig"-Button.
- **Interaktionen:** Sofortige Vorschau beim Wechsel; „Speichern"; „Zurücksetzen".
- **Zustände:** Vorschau lädt, inkompatibles Teil wird **nicht** angeboten (charakterexklusiv,
  `game-design-concept.md` §3.2), gespeichert, Fehler.
- **Verbindlich (Phase 5c):** Gegenstände sind **charakterexklusiv** und müssen am Avatar **sichtbar**
  ausgerüstet werden (Ausrüstungsslots, Grafiklayer, Position, Größe, Ebenenreihenfolge). Rendering
  als **PNG-Layer-Stapel**; endgültige Layerarchitektur **nach** Prüfung der Originalassets
  (`game-design-concept.md` §3.3/§3.4).
- **Abhängigkeiten:** Braucht Gegenstands-Assets (pro Charakter) und ein modulares Layer-Modell (neu).

### 8.11 Inventar (neu)

- **Zweck:** Besitz, Freischaltung, Ausrüstung.
- **Layout:** Filter nach Kategorie/Seltenheit/Besitz; Raster aus Gegenstandskarten; gesperrte
  sichtbar mit Bedingung; Detailansicht mit „Ausrüsten"/„Ansehen".
- **Verbindlich (Phase 5c):** Das Inventar zeigt die Gegenstände des **aktiven** Charakters. Ein
  Avatarwechsel löscht **keine** Gegenstände; er zeigt die jeweilige Ausrüstung. **Jeder
  Levelaufstieg** schaltet einen neuen Gegenstand frei (`game-design-concept.md` §6.2/§6.5).
- **Zustände:** besessen/ausgerüstet/gesperrt/neu.
- **Abhängigkeiten:** Inventar-Modell (neu), serverseitige Freischaltung (§17).

### 8.12 Ranglisten (erweitert)

- **Zweck:** Wettbewerb sichtbar machen.
- **Layout:** Umschalter „Dieses Spiel" (vorhanden) / „Global" / „Diese Woche" / „Heute" (neu).
  Podium oben, Liste darunter mit Avatar, Name, Punkten, Rangänderung.
- **Abhängigkeiten:** Globale Ranglisten brauchen Aggregation über Spiele (neu, §40).

### 8.13 Statistiken (neu)

- **Zweck:** Entwicklung sehen (Trainer: Quizqualität; Spieler: eigene Leistung).
- **Layout:** Kennzahlenkarten, Verlauf, Fragetyp-Verteilung, schwierigste Fragen, Erfolgsquote.
- **Abhängigkeiten:** `reportService` liefert Rohdaten; neue Aggregationen nötig.

### 8.14 Beamer / Game-Show-Modus (verbindlich: kombinierte Host-Ansicht)

Siehe `docs/concept/game-design-concept.md` §10 (13 Szenen) und §26 im Briefing.

- **Zweck:** Professionelle Präsentation auf großer Fläche.
- **Layout:** Vollbild, kein Navigationsmenü, minimale Bedienelemente (nur wenn nötig und dezent),
  alles auf Distanz lesbar.
- **Verbindlich:** Die **bestehende kombinierte Host-/Beamer-Ansicht bleibt erhalten** – die
  Host-Seite ist zugleich die Präsentationsfläche. Es wird **keine** separate Beamer-Surface und
  **keine** eigene Route eingeführt.
- **Hintergrund (verbindlich, Phase 5c):** Standard ist **Zufall**; genau **einmal** je Runde
  bestimmt, für alle gleich, bleibt die ganze Runde. Der Host kann **vorab** einen konkreten
  Hintergrund wählen. Stil: dunkel, Wireframe, dezente Architektur (`game-design-concept.md` §10.5).
- **Abhängigkeiten:** Beamer-Grafiken (fehlen, R-10) und die Show-Animationen. Innerhalb der
  bestehenden Host-Seite werden Steuerung und Anzeige visuell klar getrennt.

### 8.15 Einstellungen (neu)

- **Zweck:** Audio (Musik/Effekte getrennt), Sprache (später), Konto (Passwort ändern, E-Mail),
  Barrierefreiheit (Animationen reduzieren, Kontrast).
- **Abhängigkeiten:** Audio-System (neu), Konto-Erweiterung.

---

## 9. Responsive Design

### 9.1 Breakpoints (Vorschlag)

| Name    | Breite           | Layout                                             |
| ------- | ---------------- | -------------------------------------------------- |
| Kompakt | ≤ 480 px         | Einspaltig, Bottom-Navigation, große Buttons       |
| Mobil   | 481–767 px       | Einspaltig, Bottom-Navigation                      |
| Tablet  | 768–1023 px      | Zwei Spalten, kompakte Seitenleiste (Icons)        |
| Desktop | 1024–1439 px     | Seitenleiste + mehrspaltige Inhalte                |
| Breit   | ≥ 1440 px        | Mehr Spalten, größere Abstände, zentrierter Inhalt |
| Beamer  | ≥ 1600 px (16:9) | Eigene Show-Skalierung, kein Navigationsmenü       |

### 9.2 Desktop

Großzügige Layouts, feste Seitenleiste, mehrspaltige Karten, große Eingabefelder, übersichtliche
Tabellen, große Quiz-/Ergebnisdarstellung. Zeiger-Genauigkeit erlaubt kleinere Ziele, aber nie
kleiner als 32 px.

### 9.3 Tablet

Angepasste Navigation (Seitenleiste eingeklappt, per Icon), flexible Spalten (2), große
Touch-Flächen, optimierte Host-Steuerung (Steuerleiste unten, gut erreichbar mit zwei Daumen),
komfortable Quizverwaltung.

### 9.4 Smartphone

Mobile Navigation (Bottom-Bar, max. 5 Einträge + „Mehr"), einspaltig, große Buttons (≥ 44 px),
lesbare Typografie (≥ 16 px Fließtext), komfortable Antwortflächen (volle Breite, ≥ 56 px hoch),
optimierte Profile, **eigener Avatar-Editor-Modus** (Kategorien als horizontale Reiter, große
Vorschau oben).

### 9.5 Beamer

Eigenes Präsentationslayout (§8.14). Keine Navigationsmenüs, keine kleinen Texte, klare visuelle
Priorität: Frage → Antworten → Zeit → Spielerzahl. Getestet bei 1280×720, 1920×1080 und 2560×1440
sowie 4:3 (1024×768) als Rückfall.

### 9.6 Übergänge zwischen Größen

- Kein horizontaler Scroll bei keiner Breite.
- `viewport-fit=cover` und Safe-Area-Insets auf Mobil (Notch).
- Tabellen werden auf Mobil zu Karten (umschaltbar), nicht zu horizontalem Scroll.
- Der Beamer-Modus wird **nicht** durch dieselben Breakpoints erzwungen, sondern hat eine eigene
  Skalierung (Show-Skala über `clamp` und `vmin`).

---

## 10. Barrierefreiheit

- **Kontrast:** siehe §3.4.
- **Fokus:** sichtbar, logisch, nie entfernt.
- **Tastatur:** alle Funktionen erreichbar; Drag-and-drop hat Tastatur-Alternative.
- **`prefers-reduced-motion`:** Bewegung reduziert/abgeschaltet; Zustand bleibt verständlich.
- **`prefers-reduced-transparency`:** Glas wird deckend.
- **`prefers-contrast: more`:** Konturen und Text verstärkt.
- **Screenreader:** `aria-live` für Spielzustand (Frage, Auflösung, Rang), `aria-modal` für Dialoge,
  aussagekräftige Labels, keine Farbe als einzige Information.
- **Sprache:** Die Anwendung ist heute durchgehend Englisch. Eine deutsche Oberfläche wäre eine
  Produktentscheidung (i18n-Vorbereitung) – **offene Frage an den Projektverantwortlichen**.

---

## 11. Leistung

### 11.1 Gemessene Kapazität (Phase 5b, Lasttest mit echtem Backend, inkl. Host)

| Messgröße                        | 25 Spieler + Host | 35 Spieler + Host (Stress) |
| -------------------------------- | ----------------- | -------------------------- |
| Beitritt aller Spieler (Wanduhr) | 91 ms             | 136 ms                     |
| Antwort p95                      | 26 ms             | 35 ms                      |
| Speicher (RSS)                   | 138 MB            | 137 MB                     |

**Testumgebung:** 4 vCPU AMD EPYC 9B14, 15 GiB RAM, Debian 13, Node v24.21.0, PostgreSQL 16,
Backend in-process im Loopback; **eine** echte Host-Verbindung steuert das Spiel; Testdauer ~30,7 s
je Lauf. Der Test belegt die Serverkapazität im Loopback, **nicht** reale Mobilfunknetze oder
mehrere hundert Spieler. Die Zielgröße „25 Spieler + Host" ist mit **einem** Backend-Prozess
komfortabel tragbar. Werkzeug: `tools/loadtest.mjs` (nicht Teil der Anwendung). Vollständige
Testumgebung, Grenzen und Rohwerte: `docs/reports/phase-5b-revision-and-first-works.md` §2.2.

### 11.2 Budgets (Abnahmekriterium für Phase 6)

| Ressource                 | Budget              |
| ------------------------- | ------------------- |
| Erstes JS (gzip/Seite)    | < 60 KB             |
| Logo / Favicon            | ≤ 100 KB / ≤ 120 KB |
| Beamer-Hintergrund (WebP) | ≤ 400 KB je Bild    |
| Charakter-Basislayer      | ≤ 150 KB je Figur   |
| Audio-Effekt (Opus)       | ≤ 40 KB je Effekt   |
| Glasflächen gleichzeitig  | ≤ 3 sichtbar        |
| Sternenhimmel-Partikel    | ≤ 120 (Mobil ≤ 60)  |

### 11.3 Maßnahmen

| Risiko                  | Maßnahme                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `backdrop-filter` teuer | Begrenzte Anzahl Glasflächen, Reduktion/Abschaltung auf Beamer und schwachen Geräten         |
| Animationen             | Nur `transform`/`opacity`; `prefers-reduced-motion`; keine Endlosanimation im Vordergrund    |
| Sternenhimmel           | Canvas oder CSS mit begrenzter Partikelzahl; pausiert bei inaktivem Tab; reduziert auf Mobil |
| Charakter-Rendering     | Komposition aus wenigen Layern statt vollständiger Grafiken je Kombination (§14)             |
| Hintergrundbilder       | Optimierte Web-Formate, `loading="lazy"`, `srcset`; Beamer-Bilder vorab geladen              |
| Audio                   | Nur bei Bedarf, keine Dauerlast, entkoppelt vom Renderpfad                                   |
| Realtime                | Ereignisse zusammengefasst, keine hochfrequenten Positionsupdates                            |
| Datenbank               | Indizes für Ranglisten-Aggregation; keine N+1-Abfragen (Bestand prüfen)                      |

**Referenzgeräte:** ein Mittelklasse-Smartphone (Android), ein iPad, ein Laptop. Ziel: flüssige
Bedienung, keine sichtbaren Ruckler bei Szenenwechseln.

---

## 12. Fallbacks

| Umgebung                       | Fallback                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Kein `backdrop-filter`         | Deckende Flächen mit garantiertem Kontrast                                           |
| `prefers-reduced-motion`       | Sofortige Zustandswechsel, keine Bewegung großer Flächen                             |
| `prefers-reduced-transparency` | Glas → deckend                                                                       |
| `prefers-contrast: more`       | Verstärkte Konturen, höherer Textkontrast                                            |
| Schwaches Gerät (erkannt)      | Sternenhimmel aus, Blur reduziert, Animationen minimal                               |
| Kein Audio/gesperrtes Autoplay | Stiller Start, Hinweis „Ton aktivieren", Bedienung ohne Ton                          |
| Fehlendes Bild-Asset           | Neutraler Platzhalter **nur zur Laufzeit**, nie als endgültige Lösung (Briefing §31) |

---

## 13. Bewertung der Designentscheidungen (Kriterien aus Teil A)

| Entscheidung                                   | Spielerlebnis | Nutzen | Umsetzbarkeit | Performance | Wartbarkeit | Sicherheit | Erweiterbarkeit | Bestand |
| ---------------------------------------------- | ------------- | ------ | ------------- | ----------- | ----------- | ---------- | --------------- | ------- |
| Bestehendes Token-Set erweitern statt ersetzen | +             | +      | ++            | +           | ++          | 0          | ++              | ++      |
| Sechs Glasvarianten statt einer                | ++            | +      | +             | −           | +           | 0          | +               | +       |
| System-Font beibehalten                        | +             | +      | ++            | ++          | ++          | +          | +               | ++      |
| Geschlossene Animationsbibliothek              | ++            | +      | ++            | +           | ++          | 0          | +               | ++      |
| Seitenleiste + Bottom-Navigation               | ++            | ++     | +             | +           | +           | 0          | ++              | +       |
| Show-Szenen in der bestehenden Host-Ansicht    | ++            | ++     | +             | +           | +           | 0          | ++              | +       |
| Charakter-Layer statt Einzelgrafiken           | ++            | ++     | +             | ++          | ++          | 0          | ++              | ++      |
| Autospeichern im Editor                        | +             | ++     | +             | 0           | +           | −          | +               | − (R-3) |

Legende: `++` sehr gut, `+` gut, `0` neutral, `−` Risiko. **Risiken sind in der Roadmap zu
adressieren.**

---

## 14. Offene Designfragen

1. **Schrift:** System-Stack beibehalten oder eine lokal gehostete Anzeigeschrift einführen?
2. **Farbzusätze** (§3.2) und **Glasvarianten** (§4): genehmigen oder anpassen?
3. **Autospeichern** (§8.4): erst nach Entscheidung zum Quiz-Snapshot?
4. **Navigation:** Seitenleiste auf Desktop – gewünscht, oder Kopfzeile wie heute?
5. **Startseite** (§8.1): als neue konsolidierende Seite – gewünscht, oder bestehende Seiten belassen?

> **Bereits entschieden (Phase 5c):** **Sprache** = Deutsch standardmäßig, Englisch auswählbar
> (zentrale Übersetzungsarchitektur). **Host/Beamer** = bestehende kombinierte Ansicht. Der
> **Beamer als eigene Surface mit eigener Route** entfällt (§8.14).
