# Reverse-Engineering-Audit — NoPeek (nopeek.projekt-chrisb.de)

Datum: 2026-11-02 · Art: reine Analyse, keine Implementierung · Methode: öffentliche HTTP-Abrufe,
Lesen der ausgelieferten (unminifizierten) Client-Assets, DOM-/CSS-/Screenshot-Erfassung per
headless Chromium (Desktop 1280×800, Tablet 820×1180, Smartphone 390×844).

Artefakte: `/var/tmp/nopeek/` (`assets/`, `pages/`, `shot/*.png`, `branding.json`).

> Kennzeichnung: **[B]** = bestätigt (direkt beobachtet/gelesen), **[V]** = Vermutung (aus
> Client-Code abgeleitet, serverseitig nicht verifizierbar), **[U]** = unbekannt.

Vollständiger Bericht siehe Chat-Antwort; diese Datei ist die Persistenz-Kopie.
