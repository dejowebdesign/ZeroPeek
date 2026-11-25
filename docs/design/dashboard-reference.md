# Verbindliche In-Game-Dashboard-Referenzen

Diese Spezifikation ordnet die beiden unveränderten Referenzbilder ihren Rollen zu und beschreibt die sichtbare Hierarchie, die beim Entwurf und bei der Umsetzung erhalten bleiben muss. Sie ergänzt – und ersetzt nicht – [`design-system.md`](design-system.md) und [`../concept/design-concept.md`](../concept/design-concept.md). Die Referenzbilder sind verbindliche Zieloberflächen, nicht bloß Inspiration.

## Originale

1. [`player-dashboard.png`](references/player-dashboard.png) – **Player-Dashboard**: persönliche In-Game-Ansicht eines Teilnehmers auf dessen eigenem Gerät. Das Bild zeigt ein laufendes Quiz mit Spieleridentität Ethan, Level-/XP-Anzeige, Platz und Punktestand, Frage 5 von 13, Countdown und vier Antwortmöglichkeiten.
2. [`host-beamer-dashboard.png`](references/host-beamer-dashboard.png) – **Host-/Beamer-Dashboard**: kombinierte Host-Steuerungs- und öffentliche Präsentationsansicht auf Host-Bildschirm/Beamer. Das Bild zeigt links die Host-Navigation, oben Spielstatus-Karten, mittig Frage und Antworten, rechts Lobby-Spieler und Spielablauf sowie unten die Steuerleiste.

Die Dateien wurden aus den bereitgestellten Vorlagen unverändert übernommen. SHA-256-Prüfsummen bei Übernahme:

- Player: `37712c5295461e5f2d0d32d83f8f6b20195055ae43beee3706a1727e0877cd57`
- Host/Beamer: `3d34ca8685b923f283f70861c42944719273b65a456f9f662b619211b93cbebf`

## A. Player-Dashboard

### Zweck und Rollengrenze

Das Dashboard dient ausschließlich dem einzelnen Teilnehmer während des Spiels. Es hebt den eigenen Avatar und Fortschritt, die aktuelle Frage, Antwortauswahl und verbleibende Zeit hervor. Es ist keine Host-Steuerungsoberfläche und wird nicht mit dieser zusammengelegt.

### Sichtbare Hierarchie und Anordnung

- **Kopfbereich:** links eine kompakte Identitätskarte mit Avatar, Name, Level und XP-Fortschrittsleiste; mittig prominent das ZeroPeek-Logo; rechts Platzierung, Punktestand und Einstellungen.
- **Spielfläche:** dunkler, räumlicher Wireframe-Hintergrund mit dezenter ZeroPeek-Marke. Eine große, mittig platzierte Glasfläche bildet den Fokus.
- **Fragekopf:** Kategorie-Symbol und Kategoriebezeichnung links, Fragenfortschritt (z. B. „Frage 5 / 13“) rechts.
- **Frage:** große, kontrastreiche, deutlich priorisierte Frage. Darunter eine schmale violett-cyan-magenta Farbtrennlinie.
- **Antworten:** vier gleichwertige, große Glaskarten in einem 2×2-Raster. Jede Karte hat links einen violett getönten Buchstaben-Key A–D und rechts den Antworttext.
- **Countdown:** eigener kreisförmiger Fortschrittsring rechts neben der Fragekarte, mit gut lesbarem Zeitlabel und großer Zeitangabe. Der Ring ist visuell sekundär zur Frage und Antwort.

### Responsive Erhaltung

Die Spieleransicht ist mobil zuerst auszulegen (Konzept §8.7). Beim Verkleinern bleiben Identität/Fortschritt, Frage, Antworten und Zeit klar priorisiert. Antwortflächen bleiben bequem bedienbar und in sinnvoller Reihenfolge; Inhalte dürfen weder abgeschnitten noch horizontal gescrollt werden. Das Bild dokumentiert die breite Ausgangskomposition; die mobile Anpassung darf die Hierarchie, nicht die Rolle oder Kerninformation, verändern.

## B. Host-/Beamer-Dashboard

### Zweck und Rollengrenze

Dies ist die **kombinierte** Host-Steuerung und öffentliche Quizpräsentation. Die Host-Seite bleibt zugleich die Präsentationsfläche; es wird keine getrennte Beamer-Anwendung oder Route aus dieser Vorlage abgeleitet. Host-Aktionen und öffentliche Fragepräsentation sind innerhalb derselben Oberfläche klar unterscheidbar. Dies entspricht `design-concept.md` §§8.6, 8.14 und 9.5.

### Sichtbare Hierarchie und Anordnung

- **Kopfbereich:** Logo links; Host-Rollenkennzeichnung sowie Benachrichtigungs-, Einstellungs- und Vollbildaktionen rechts.
- **Linke Navigation:** eigenständige, dauerhaft erkennbare Seitenleiste mit Symbol und Text je Eintrag; der aktive Bereich ist cyan hervorgehoben. Beispiele im Bild: Übersicht, Spiel steuern, Quiz & Fragen, Hintergründe, Spieler & Lobby, Inventar & Avatare und Auswertung; Beenden ist getrennt am unteren Rand.
- **Statuszeile:** drei gleichrangige Karten oberhalb der Frage zeigen Spieler in der Lobby, aktuelles Quiz und Fortschritt (Frage x/y).
- **Öffentliche Fragefläche:** große zentrale Glasfläche; deutlich beschriftete aktuelle Frage, farbiger Divider und vier untereinander angeordnete Antwortoptionen mit A–D-Key. Der zentrale Inhalt bleibt aus Distanz lesbar.
- **Rechte Seitenleiste:** obere Lobby-Karte mit echten Spielenden, Avatar/Name und Verbindungsstatus; weitere Teilnehmende können eingeklappt dargestellt werden. Darunter der Spielablauf als lesbare Phasenfolge mit hervorgehobener aktueller Phase und Zeit.
- **Untere Steuerleiste:** am unteren Rand klar gruppierte Timer-/Fortschrittsanzeige sowie Pause, Auflösung, nächste Frage und deutlich abgesetztes Quiz-beenden. Häufige Aktionen bleiben gut erreichbar.
- **Hintergrund:** dunkles, perspektivisches Wireframe-Gitter und dezente Cyan-Akzente; Glasflächen rahmen Inhalte, dürfen jedoch Frage, Antworten oder Status nicht überlagern.

### Responsive Erhaltung

Auf Desktop/Beamer bleibt die mehrspaltige Hierarchie und die kombinierte Host-/Show-Fläche erkennbar. Auf Tablet darf die Navigation kompakt werden und Nebenbereiche können kontrolliert umgeordnet werden; die Steuerleiste bleibt gut erreichbar. Auf Smartphone gelten die dokumentierten Breakpoints und Touch-Mindestgrößen aus `design-system.md` und `design-concept.md`; Nebeninformationen dürfen responsiv umfließen oder einklappen, aber nicht verschwinden, erfunden oder mit der Player-Ansicht vermischt werden. Kein horizontaler Overflow. Die Präsentationsfläche nutzt die dokumentierte eigene Show-Skalierung statt einer bloßen Vergrößerung des normalen App-Shells.

## Gemeinsame Designvorgaben und Bestandsschutz

- Bestehende Design-Tokens und `design-system.md` sind maßgeblich. Die Referenz ermächtigt nicht, vorhandene Tokenwerte stillschweigend zu ändern oder ein paralleles Designsystem einzuführen.
- Erhalten bleiben dunkle retro-futuristische Wireframe-Tiefe, abgestuftes Glassmorphism, Cyan-/Violett-/Magenta-Akzente, klare Typografie und eine zugängliche Kontrast-/Fokusdarstellung.
- Die Bilder sind visuelle Vorgaben, keine Datenquelle. Beispielnamen, Avatarbilder, Quiztext, Spielerzahlen, Punkte, Ränge und Phasenstatus aus ihnen dürfen nicht als statische oder erfundene Laufzeitdaten übernommen werden. Die Implementierung rendert nur tatsächliche Daten aus bestehenden Verträgen.
- Layoutänderungen bleiben Präsentationsänderungen. Serverautorität, Frage- und Antwortfluss, Clock-Synchronisation/Deadline, Scoring, Ranking, Host-/Player-Identität, Socket.IO-Events und -Berechtigungen, Musik, Finale und Podium sowie Backend-APIs und Datenbankschema bleiben unverändert, sofern ein ausdrücklich freigegebener, gesonderter Auftrag nichts anderes verlangt.
- Bestehende CSP-, Accessibility- und Responsive-Verträge gelten weiter. User Content wird über bestehende DOM-Helfer und `textContent` dargestellt; dynamische Stile müssen den bestehenden CSSOM-Ansatz einhalten.

## Vor Umsetzung / Abnahme

1. Player- und Host-/Beamer-Bild getrennt mit den Originaldateien vergleichen.
2. Pro Oberfläche Layout, Proportionen, Typografie, Farben/Hintergrund, Karten, Abstände, Frage/Antworten, Timer/Status, Punkte/Rang/Spielerinformationen, Phasen und Finale/Podium berücksichtigen.
3. Responsive Verhalten und vorhandene Design-System-Tests prüfen; funktionale Änderungen mit den unmittelbar betroffenen Spielablauf-Tests absichern.
4. Keine nicht ausgeführte visuelle oder funktionale Browserprüfung als bestanden melden. Live-Browserprüfung auf der Produktion ist untersagt; die manuelle Abnahme nach Projektverantwortlichen-Deployment bleibt dessen Aufgabe.
