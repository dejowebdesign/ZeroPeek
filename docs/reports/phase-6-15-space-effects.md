# Phase 6.15 – Space Effects Upgrade

Branch: `feat/space-effects-upgrade` (Basis: `origin/main` = `270c11c`, der Merge von PR #68).
Status: **Arbeit fertig, wartet auf Freigabe.** Nicht gemergt, nicht deployt.

---

## 1. Ausgangslage

PR #68 (Sternenebene 10 % transparenter) ist **gemergt**. `LAYER_OPACITY = 0.9` steht auf `main` und
gilt in dieser Phase unverändert weiter: die neuen Effekte multiplizieren denselben Faktor an
derselben Zeichenstelle, und ein Test hält das fest.

Das Feld ist eine Canvas in `starfieldCanvas.ts` mit einem einzigen `requestAnimationFrame`-Loop.
Sterne werden pro Frame als Punkte gezeichnet; ihre Position ist eine reine Funktion der
verstrichenen Zeit. Genau dieses Zeitmodell übernehmen die neuen Effekte.

## 2. Architektur: eine Engine, nicht zwei

Neu ist `packages/frontend/src/starfieldEffects.ts` — **reine** Geometrie: Typen, Intervalle, Caps,
Flugbahnen, Flare-Kurve, Mote-Position, Nebeldefinition. Das Modul kennt weder Canvas noch Uhr noch
DOM. Dadurch ist es ohne Renderer testbar, und es kann keine zweite Engine entstehen.

`starfieldCanvas.ts` besitzt die Pools und zeichnet sie aus dem **bestehenden** `tick()`. Kein
zusätzlicher Loop, keine zusätzliche Canvas für das Feld, keine neuen Abhängigkeiten.

Zeichenreihenfolge (Briefing §6, visuelle Priorität):

```
Nebel (vorgefertigt)  →  Motes  →  Sterne  →  Sternschnuppen / Kometen / Ringe
```

Die Spielkarten liegen als DOM über der Canvas (`z-index`-Stapel unverändert), die Effekte können
sie also nicht überdecken.

## 3. Die fünf Effekte

**Sternschnuppen.** Diagonale Flugbahn nach unten, Richtung und Winkel pro Stern zufällig (30–72°
unter der Horizontalen, beide Seiten). Kopf mit Radius 1,1–2,0 px, Schweif 90–220 px, Geschwindigkeit
420–940 px/s, Farbe aus den drei Markentönen (Weiß, Cyan, Violett). Der Schweif ist **ein** linearer
Farbverlauf statt einer Punktkette: ein Strich pro Flug. Der Kopf blendet über die ersten 20 % ein
und über die letzten 33 % aus, damit nichts „aufpoppt“.

**Kometen.** Dieselbe Geometrie, bewusst anders im Gefühl: 55–125 px/s, Schweif 170–280 px, Alpha
0,30–0,52. Deutlich langsamer, länger, dezenter.

**Lichtimpulse.** Ein einzelner, sehr schwacher expandierender Ring (Alpha 0,06–0,10), Lebensdauer
2,6 s. Das ist der einzige Effekt, der wie ein „Impuls" wirkt, deshalb ist er der seltenste und im
Calm-Modus vollständig aus.

**Funkelnde Sterne.** Auf den bestehenden Sinus-Twinkle kommt ein seltener Flare: `sin(...)^6`, also
ein schmaler Peak. Der Stern bleibt fast immer auf seiner Grundhelligkeit und leuchtet kurz auf. Die
Phase ist pro Stern, daher keine synchronen Muster. `TWINKLE_DEPTH`, Sternanzahl und Dichte sind
unverändert.

**Motes.** Staubteilchen als nahe Ebene, 26 (Host) bzw. 16 (Player), Drift 3–9 px/s plus leichtes
Bobben. Position ebenfalls eine reine Funktion der Zeit.

**Nebel.** Drei sehr weiche Veils (Dunkelblau, Violett, leichtes Cyan) mit Alpha 0,10–0,17, als
`NEBULA_ALPHA = 0.55` über die ganze Fläche. Sie werden **einmal** in eine 1/8-große Offscreen-Canvas
vorgefertigt und dann skaliert — Radialverläufe pro Frame wären teuer. Ein „Atmen" von ±1,2 % hält sie
lebendig, ohne einen zweiten Loop.

## 4. Frequenz und Obergrenzen

| Effekt        | Intervall normal | Intervall calm | Gleichzeitig max. |
| ------------- | ---------------- | -------------- | ----------------- |
| Sternschnuppe | 8–20 s           | 24–55 s        | **2**             |
| Komet         | 55–120 s         | 150–300 s      | **1**             |
| Lichtimpuls   | 90–180 s         | aus            | **1**             |
| Motes         | —                | —              | 26 / 16 (fix)     |
| Nebel-Veils   | —                | —              | 3 (fix)           |

Paare: Nach einer Sternschnuppe folgt mit 22 % Wahrscheinlichkeit 0,45 s später eine zweite. Sie wird
**geplant**, nicht sofort erzeugt, damit das Paar als Abfolge wirkt und nicht als Doppelblitz.

Die Caps sind **strukturell**: die Pools haben genau so viele Slots, wie erlaubt sind, und ein noch
fliegender Slot ist einfach nicht verfügbar. Es gibt keine Zählung, die man falsch machen könnte.

Spawn-Zeitpunkte sind absolute Fälligkeitzeiten, keine Wahrscheinlichkeit pro Frame. Ein langsamer
Frame kann die Rate daher nicht vervielfachen, und nach einem versteckten Tab gibt es keinen
Nachhol-Schwall (getestet: 200 s Sprung → höchstens 2 Köpfe in einem Frame).

## 5. Calm und Reduced Motion

Die beiden sind jetzt **getrennt**, was vorher nicht der Fall war: `starfieldLayer.ts` faltete
`isCalm() || prefersReducedMotion()` zu einem Flag zusammen und reichte es als `calm` weiter. Damit
hätte ein Reduced-Motion-Nutzer bewegte Sternschnuppen bekommen, weil `calm` sie nur ausdünnt.

- **Calm** (Nutzerwunsch): weniger Sternschnuppen (24–55 s), langsamere Drift, kein Ring, kein
  Kometen-Ring, ruhigeres Atmen. Das Feld bleibt lebendig.
- **Reduced Motion** (Betriebssystem): keine Sternschnuppen, keine Kometen, keine Ringe, keine Motes,
  kein Atmen des Nebels. Die Sterne behalten ihr bisheriges Verhalten samt Twinkle — genau das, was
  die Oberfläche vorher zugesagt hat.

## 6. Performance

- **Ein** Loop, **eine** Feld-Canvas. Der Nebel hat eine zusätzliche Offscreen-Canvas, die nur bei
  Größenänderung neu gebaut wird.
- Pools werden einmal allokiert; pro Frame wird nichts angelegt. Der einzige Gradient pro Frame ist
  der Schweif einer fliegenden Sternschnuppe.
- DPR-Deckel 2, `document.hidden`-Pause, Resize-Pfad und Lifecycle sind unverändert.
- Gemessen in Chromium, 600 Frames nach 60 Aufwärmframes, deterministischer Seed:

| Auflösung | vorher (main) | nachher | Differenz |
| --------- | ------------- | ------- | --------- |
| 1920×1080 | 0,43 ms       | 0,47 ms | +0,04 ms  |
| 390×844   | 0,13 ms       | 0,19 ms | +0,06 ms  |

Bei 16,7 ms Budget pro Frame sind das rund 3 %. Die Werte sind Mediane aus 5 Läufen (1920) bzw. 3
Läufen (Telefon); die Streuung zwischen den Läufen ist größer als der Unterschied.

## 7. Visuelle Prüfung

Aufbau: echtes Modul aus dem Bundle, eingebettetes Testmotiv mit derselben Stapelreihenfolge wie die
App (`opacity: .38`, `saturate(.9)`), eine Glaskarte als Lesbarkeitsprobe. Pixelmessung in Python
gegen `origin/main` als Nullprobe.

| Auflösung | Motivband vorher | nachher | Δ     |
| --------- | ---------------- | ------- | ----- |
| 1920×1080 | 35,81            | 39,59   | +3,88 |
| 1440×900  | 35,88            | 39,27   | +3,56 |
| 1024×768  | 35,82            | 38,89   | +3,18 |
| 390×844   | 35,93            | 40,24   | +4,50 |

Das Motiv wird also **etwas heller**, nicht dunkler: der Nebel legt Licht dazu, statt zu verdecken.
Verteilung über alle Pixel: Median +3,2, p99 +5,1 — keine Fläche wird nennenswert abgedunkelt.
Kartenregion bleibt kontrastreich (p95 91,4, Textspitzen 245).

Sternschnuppe isoliert vermessen (Sterne ausgeblendet, ein Frame): Kopf-Alpha **235**, Schweif
monoton fallend **235 → 20**, Breite **2–4 px** bei 1920. Breit genug, um auf dem Beamer zu lesen,
schmal genug, um nicht als Balken zu wirken.

**Einschränkung, offen gesagt:** `chromium --headless --screenshot` erfasst hier **keine**
Canvas-Inhalte — auch die unveränderte Version aus `main` erscheint im Screenshot schwarz. Die
Zahlen oben stammen deshalb aus `getImageData`/`toDataURL` im Browser und aus der Pixelmessung des
exportierten Frames, nicht aus Bildschirmfotos. Echte Screenshots brauchen einen Browser mit
funktionierender Compositing-Ausgabe; das ist auf diesem Rechner nicht verfügbar.

## 8. Tests

Neu `starfieldEffects.test.ts` (25 Tests): Flugbahn, Zeitreinheit, Ablauf und Wiederverwendung,
Caps, Kometen-/Sternschnuppen-Verhältnis, Intervallfenster, Calm-Spreizung, Mote-Umlauf, Nebelgrenzen,
Flare-Verteilung, Geometrie-Helfer.

Erweitert `starfieldCanvas.test.ts` (11 → 19 Tests): `LAYER_OPACITY`-Deckel, unveränderte Sternzahl
und Mote-Pool, Host > Player, Pause im versteckten Tab, Calm dünnt aus statt zu entfernen, Reduced
Motion ohne bewegte Effekte, kein Nachhol-Schwall, Pool wächst nicht über 10 Minuten.

Ergebnis: **1096 Tests grün** (Frontend 786, Shared 212, Backend 98; die DB-gebundenen Suites sind
wie zuvor übersprungen). Typecheck, Lint, Prettier und Build sauber.

## 9. Geänderte Dateien

| Datei                                                 | Änderung                                           |
| ----------------------------------------------------- | -------------------------------------------------- |
| `packages/frontend/src/starfieldEffects.ts`           | neu — reine Effekt-Geometrie, Intervalle, Caps     |
| `packages/frontend/src/starfieldEffects.test.ts`      | neu — 25 Tests                                     |
| `packages/frontend/src/starfieldCanvas.ts`            | Pools, Zeichenreihenfolge, Nebel-Pre-Render, Flare |
| `packages/frontend/src/starfieldLayer.ts`             | `calm` und `reducedMotion` getrennt durchreichen   |
| `packages/frontend/src/starfieldCanvas.test.ts`       | Recorder erweitert, 8 neue Tests                   |
| `docs/phases.md`, `docs/roadmap/technical-roadmap.md` | Status und §9.10                                   |

Nicht angefasst: Hintergrundbilder, `background.ts`, Scrim/Vignette, `finaleEffects.ts`, Audio,
QR-Code, Host-Lobby, Spielkarten, Schema, API.

## 10. Offener Punkt zur Entscheidung

Das Performance-Budget in Roadmap §16 nennt „Sternenhimmel-Partikel ≤ 120 (Mobil ≤ 60)". Phase 6.13
zeichnet bereits 420–539 Sterne; die Zahl stammt aus der CSS-Kachelzeit und wurde nie auf das
Canvas-Feld übertragen. Diese Phase ändert die Sternzahl nicht und hält die Effekt-Caps hart, aber
die Diskrepanz bleibt dokumentiert und sollte vom Eigentümer entschieden werden, nicht stillschweigend
vom Code.

## 11. Was bewusst nicht gemacht wurde

- Kein zweiter Renderer, keine zweite Canvas für das Feld.
- Keine Änderung an `LAYER_OPACITY`, Hintergrund-Opacity, Scrim oder Vignette.
- Keine neuen Assets, keine KI-Bilder.
- Keine Änderung an Feuerwerk oder Audio.
- Kein Merge, kein Deployment.
