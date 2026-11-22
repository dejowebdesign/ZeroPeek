# Phase 6.14 – Host lobby: join QR and background carousel

- **Branch:** `feat/phase-6-14-host-lobby-qr-background-selector` (from `main` = `5b3aa90`).
- **Scope:** two changes to the existing host lobby card, plus one small follow-on.
  1. The join **QR code** is visible again in the join view, next to the PIN and the address.
  2. The **background picker** is a compact carousel with left/right arrows instead of an
     eleven-chip list that pushed the card off a projector screen.
  3. A scanned QR opens `/?pin=…`; the player join form now pre-fills the PIN from that link.
- **Not touched:** the supplied background files (`ZeroPeek_Background.zip`, ten WebP files under
  `packages/frontend/public/backgrounds/`), the question and answer model, scoring, accounts,
  roles, permissions, sessions, API contracts, the database and its schema, and the deployment.
  No migration, no new runtime dependency (only `qrcode-generator`, which was already in the
  workspace, was moved into the frontend package's own `dependencies`).

## 0. Result in one sentence

The host lobby now shows a scannable QR code beside the PIN, and the background is chosen with one
`‹ name 3 / 11 ›` row that steps through Random and the ten delivered images and keeps its position
across a reconnect — all decided by the server, as before.

## 1. What the owner asked for

| Request                                                           | Where it is met                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| QR code back in the upper join area, with PIN and address         | `pages/host.ts` (join scene), `joinQr.ts`, `.lobby__qr` in `tokens.css` |
| Multi-row background list → compact carousel with arrows          | `backgroundPicker()` / `paintCarousel()` in `pages/host.ts`, CSS block  |
| Keep the lobby responsive; protected assets unchanged             | `.show__background-*` rules, no change under `public/backgrounds/`      |
| (Derived from the QR idea) a scanned link should pre-fill the PIN | `pinFromQuery()` in `playerView.ts`, wired in `pages/player.ts`         |

## 2. Inventory taken before the change

| Question                                             | Finding                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Was there already a QR module?                       | Yes — `packages/frontend/src/joinQr.ts` with `joinUrl()`, `currentJoinUrl()`, `qrSvg()`, `renderJoinQr()`. Solid, unchanged. |
| Was it wired into the page?                          | **No.** Nothing imported it; the join view rendered only PIN and address. That is why the code was invisible.                |
| How did the old picker look?                         | `.show__background-options`: a wrapping chip row of eleven buttons. On a projector the lobby card grew past the fold.        |
| Who owns the background choice?                      | The server. `engine.setBackground()` stores it, broadcasts `background`, and the client only repaints. The UI never decides. |
| Where is the choice persisted?                       | As an engine event in the game log, restored on restart (`services/engine.ts`).                                              |
| Is there a design-system guard for host classes?     | Yes — `design-system.test.ts` asserts every emitted class has a rule in `tokens.css`.                                        |
| Does the player page already parse query parameters? | No. `showJoin()` built the form unconditionally, so `?pin=` was ignored.                                                     |

## 3. The join QR

`joinQr.ts` was left as delivered: it composes the URL from the **current origin**, so the code
works behind the deployment's public domain without configuration, and it paints an inline SVG
(no request, no canvas, no `innerHTML`), which keeps the strict CSP intact.

The change is the wiring in the join scene: a `.lobby__qr` container is created and filled with
`renderJoinQr(host, pin)`, placed after the address chip and before the player list. The white
plate in `.lobby__qr svg` is deliberate — a dark symbol on dark glass is exactly what makes a
projector scan fail.

**Scannability was verified, not assumed.** The symbol was rendered to a pixel matrix at 8× scale
and read back with an independent decoder (`jsqr`), not with the encoder's own code:

```
ENCODED: https://zeropeek.example.org/?pin=PEM26A
DECODED: https://zeropeek.example.org/?pin=PEM26A
MATCH:   true
```

## 4. The background carousel

The eleven-chip list became one row: `‹ | name + position | ›`.

- **Order** is `Random` first, then the ten delivered images in delivery order, wrapping at both
  ends — `shared/src/backgrounds.ts` → `BACKGROUND_CHOICES`, `stepBackground()`.
- **Labels are short** (`Skyline`, `Underwater`, `Megacity` …) because the row is one line. Only the
  display name changed; **ids, filenames and paths are untouched**, so stored games, the report and
  every other client keep resolving the same image.
- **The arrows announce their destination** (`aria-label="Next background: Underwater"`), so the
  host knows what a click selects _before_ clicking — a carousel that only reveals the next stop
  afterwards is a guessing game on a projector.
- **Repaint without rebuild:** `paintCarousel()` updates the position line and both arrow labels in
  place, so a live change never replaces the focused button and never steals keyboard focus.
- **Server stays authoritative.** The arrows send `host:background` and wait for the ACK/broadcast;
  `chooseBackground()` never paints optimistically.
- **Random is never a dead click.** `pickRandomBackground(random, exclude)` avoids the image already
  showing, so pressing Random again always changes the picture.
- **Restart and reconnect keep the position.** The engine stores the carousel position (not only the
  resolved image) in the game log and validates it on restore; an unknown or pre-6.14 value falls
  back to Random. `backgroundChoice` rides along on the socket payloads and in the `sync` snapshot.

## 5. The `?pin=` pre-fill

`pinFromQuery()` in `playerView.ts` reads `pin` from the query string and validates it with the
shared `isValidPin` / `normalizePin` before the join form is built. A scanned link therefore opens
the join screen with the PIN already filled — the player only types a name.

The validation is deliberately strict: a link with a character outside the PIN alphabet is
**rejected** rather than silently stripped, because a silently repaired PIN would send the player
into a different lobby than the one on the screen.

## 6. Files

| File                                                     | Change                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/frontend/src/joinQr.ts`                        | New module (URL, SVG symbol, render) — already complete, now used.             |
| `packages/frontend/src/pages/host.ts`                    | QR wiring in the join scene; `backgroundPicker()`, `paintCarousel()`, arrows.  |
| `packages/frontend/src/styles/tokens.css`                | Carousel block replaces `.show__background-options`; `.lobby__qr`.             |
| `packages/frontend/src/hostView.ts`                      | `backgroundLabel()`, `backgroundHint()`, `backgroundSelection()`, neighbour.   |
| `packages/shared/src/backgrounds.ts`                     | `BACKGROUND_CHOICES`, `backgroundChoiceName()`, `stepBackground()`, `exclude`. |
| `packages/shared/src/events.ts`                          | `backgroundChoice` on the player/host sync and background payloads.            |
| `packages/backend/src/services/engine.ts`                | Stores and restores the carousel position, validated with a Random fallback.   |
| `packages/backend/src/socket.ts`                         | Forwards `choice` in the ACK and in both broadcasts.                           |
| `packages/frontend/src/playerView.ts`, `pages/player.ts` | `pinFromQuery()` and the pre-fill in `showJoin()`.                             |

## 7. Tests

New or extended:

- `joinQr.test.ts` — URL composition, uppercase PIN, no trailing slash, SVG shape, replacement.
- `playerView.test.ts` — `pinFromQuery()` accepts a valid PIN and rejects a malformed one.
- `backgrounds.test.ts` — carousel order, wrap-around, unknown id → Random, exclusion on re-roll.
- `hostPage.test.ts` — the QR exists in the join view and encodes this lobby's PIN; carousel
  position, arrow labels and server-ACK repaint.
- `design-system.test.ts` — every new class has a CSS rule.
- `background-sync.integration.test.ts` — position stored, broadcast, restored after a restart.

Full run on the branch: **1421 tests green** (backend 451 / frontend 758 / shared 212),
`npm run typecheck`, `npm run build`, `npm run lint` and `npm run format:check` all clean.

## 8. Verification beyond the test suite

The app was started locally (backend on a spare port, Vite proxying to it), a trainer account and a
one-question quiz were created, and the lobby was driven through the real socket:

| Check                                                 | Result                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| QR in the join view, next to PIN `PEM26A`             | Present, inline `<svg data-join-qr>`, `data-join-url` matches |
| `?pin=PEM26A` opens the join form, name entered, Join | Joined without typing a PIN — pre-fill works                  |
| Arrow `›` from `1 / 11` (Random)                      | Moves to `2 / 11` and repaints the layer                      |
| Reload of the host page                               | Carousel still shows `2 / 11` — position restored from server |
| Player appears in the host roster after joining       | Yes, with the remove action                                   |

## 9. Risks and open points

- **The QR is only as good as the origin.** Behind a proxy that rewrites the host header the code
  encodes the browser's address, which is the correct one by construction; a deployment reachable
  under two names will encode whichever name the host used.
- **No camera test on a real phone.** Scannability was proven by an independent decoder on the
  exact module matrix; a physical scan on the target projector is still worth one look.
- **Short labels are a product choice.** If the owner prefers the descriptive names
  (`Synthwave – Forschungsstation (gedämpft)`), the carousel row needs either a wider card or a
  two-line label — the ids and files do not change either way.
- **Random is a position, not an image.** A host who leaves the carousel on Random sees the label
  `Random` while the screen shows a concrete motif. That is intentional and matches the server.

## 10. Status

Work complete on the branch. **No push, no pull request, no merge, no deploy** — awaiting the
owner's decision.

## 11. Nachtrag (2026-11-04) – Beschreibungszeile über dem Karussell entfernt

Der Abschnitt oben beschreibt den Stand von PR #66. Auf Wunsch des Projektverantwortlichen ist die
Zeile `Background: … Applies to every screen and stays for the whole round.` **über** dem Karussell
wieder entfallen — sie kostete Höhe, ohne etwas zu sagen, was Name und Position nicht schon sagen.

Was sich geändert hat:

- `backgroundLabel()` und `backgroundHint()` sind aus `hostView.ts` entfernt, ebenso der
  `backgroundLabelNode`-Zustand und der `show__background-head`-Wrapper in `pages/host.ts`.
- Die CSS-Regeln `.show__background-head`, `.show__background-label` und
  `.show__background-hint` sind entfernt; `.show__background` ist jetzt ein einfacher Block ohne
  Spalten-Gap. Der Abstand zwischen Trennlinie und Pfeilen ist dadurch 0 px statt 57 px.
- **Unverändert:** Karussell mit `‹`/`›`, mittiger Name, Positionsanzeige `n / 11`, zyklische
  Navigation, `Random` als erste Position, `host:background`-Roundtrip und der Server als einzige
  Autorität. QR, PIN, Join-URL, Lautstärke, Mute und Start-Button sind nicht berührt.

Gemessen mit echtem CSS in Chromium (nicht geschätzt):

| Messwert                    | vorher   | nachher  |
| --------------------------- | -------- | -------- |
| Höhe des Hintergrund-Blocks | 114,4 px | 57,4 px  |
| Kartenhöhe (Ausschnitt)     | 172,4 px | 115,4 px |
| Abstand Trennlinie → Pfeile | 57,0 px  | 0,0 px   |
| Pfeilfläche                 | 44 × 44  | 44 × 44  |
| Name mittig (Abweichung)    | 0,01 px  | 0,01 px  |
| Überlauf horizontal         | 0        | 0        |

Zusätzlich bei Kartenbreiten 320 / 360 / 390 / 768 / 1440 px geprüft: Pfeile bleiben innerhalb der
Karte, kein Name wird abgeschnitten, kein horizontaler Überlauf.

Neuer Test `hostPage.test.ts` → „carries no description above the row": prüft den **gesamten**
Textinhalt des Blocks (`‹Skyline8 / 11›`), damit eine später „nur kleine" Hilfszeile nicht
unbemerkt zurückkehrt.
