# Host controls fix – Skip/End confirmation and the leaderboard's Next button

- **Branch:** `fix/host-next-skip-confirmation` (from `main` = `30e286e`, PR #50 merged)
- **Scope:** two host-control defects reported after practical testing of Phase 6.9.3:
  the **Skip question** / **End game** confirmation was bypassed, and the **Next question**
  button was reported missing on the leaderboard. No schema change, no migration, no new
  dependency, no change to any game rule.
- **Status:** work complete on the branch, **awaiting owner approval** — no push, no pull
  request, no merge, no deploy yet.

## 0. Result in one sentence

Clicking **Skip question** or **End game** now sends the command **only** after the
confirmation is accepted (Cancel is inert), and the leaderboard offers **Next question**
only while a further question actually exists — so the last leaderboard shows **End game**
alone instead of a button that would immediately finish the game.

## 1. Findings fixed

Each root cause below was confirmed in the code and reproduced, not assumed.

1. **Skip/End fired before the confirmation.** `hostButton()` already bound the command via
   the button's `onClick` (`el()` attaches it with `addEventListener`). `controlsFor()` then
   added a **second** handler with `node.onclick = () => confirmDialog(...)`. Both ran: the
   command was sent at once, _and_ the dialog opened. Reproduced in jsdom — clicking
   **Skip question** sent `host:skip` immediately, and **Cancel** left it sent.
2. **The Next button was unreliable on the leaderboard.** The board always rendered
   **Next question**, including on the **last** leaderboard, where the next click ends the
   game. The client had no data to tell "more questions" from "last", so the control could
   neither be hidden nor trusted — matching the report that Next seemed absent or wrong.

## 2. Changes

### 2.1 Frontend

| File                                  | Change                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/frontend/src/pages/host.ts` | `hostButton()` takes an optional `confirm`; when set, the button's **only** click action is to open the dialog, and the command is sent from `onConfirm`. The stray `node.onclick` overrides in `controlsFor()` are gone. |
| `packages/frontend/src/hostView.ts`   | `hostActions()` takes `hasNext` (default `true`) and omits `next` on the board when it is `false`; the `board` handler payload carries `hasNext`.                                                                         |

### 2.2 Backend / shared

| File                                      | Change                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/backend/src/services/engine.ts` | New private `hasNextQuestion()`; the `board` event and `hostState()` carry `hasNext` (derived from the quiz length, so a reconnect restores the right controls). |
| `packages/backend/src/socket.ts`          | The `board` fan-out forwards `hasNext` to `host:board`.                                                                                                          |
| `packages/shared/src/events.ts`           | `HostState.hasNext` and the `host:board` payload gain `hasNext`.                                                                                                 |

Design points worth stating explicitly:

- **The confirmation is now the button's single action.** Previously the command and the
  dialog were two independent listeners on the same element; the fix makes them mutually
  exclusive by construction, so a future change cannot re-introduce the double fire.
- **`hasNext` is derived server-side.** The client never guesses from `players.length` or an
  index; a reload or reconnect on the board renders exactly the controls the live event did.
- **Hiding Next is display only.** The engine still refuses `next` from any non-`board`
  phase, so the missing button is not a security boundary.

## 3. Tests

- `packages/frontend/src/hostPage.test.ts` — **Skip** and **End** send nothing until the
  dialog is confirmed, Cancel sends nothing, and confirming sends exactly one command; the
  board offers **Next** while a further question exists, drops it on the last board, and
  restores the same controls from a reconnect snapshot. Verified failing on the pre-fix code.
- `packages/frontend/src/hostView.test.ts` — `hostActions()` gating of `next` by `hasNext`.
- `packages/backend/src/gameplay-reliability.integration.test.ts` — §A2: the `board` event
  and `hostState` report `hasNext: true` before the last question and `false` on it.

## 4. Bestandsschutz (regression check)

- No quiz, question, answer, account, role, permission or game record is touched.
- No event was removed: `host:board` gained `hasNext`, `HostState` gained `hasNext`; the
  request shapes are unchanged and the engine's phase guards are unchanged.
- The AUTO gating from Phase 6.9.3 (answer resolution and leaderboard advance) is untouched.

## 5. Open product decisions (for the owner, not decided here)

1. **`End game` on the last leaderboard.** It is kept, so the host still has an explicit way
   to close the round. If the last board should instead end on its own, that is a product
   decision.
