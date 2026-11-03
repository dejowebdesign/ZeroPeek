# Feature matrix — NoPeek vs. ZeroPeek

Functional comparison of the reference project **NoPeek** against **ZeroPeek**.
Only behaviour that is actually implemented is marked as implemented — a file or
a placeholder alone is not enough. Each row states the evidence.

## Legend

| Status                    | Meaning                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| ✅ **Complete**           | Implemented end to end (backend, data model and surface), behaves as described. |
| 🟡 **Partial**            | Implemented but with a visible gap against the reference behaviour.             |
| 🔵 **Needs work**         | Present, but below the quality of the reference or fragile.                     |
| ❌ **Missing**            | Not implemented.                                                                |
| ⛔ **N/A (architecture)** | Not sensibly transferable because the two architectures differ.                 |

**Reading the "NoPeek" column:** the reference is analysed from its served,
unminified client assets (`player.js`, `host.js`, `editor.js`, `common.js`,
`clock.js`, `quizschema.js`, `avatars.js`, `branding.js`, `app-config.js`) and
its HTML/CSS, exactly like the earlier `nopeek-audit.md`. Server internals are
inferred from the client contract and marked as such. The ZIP archive referenced
in the task was **not present in this environment**; the live assets are the
same source the prior audit used.

**Reading the "ZeroPeek" column:** every claim is grounded in the file named in
the evidence column of `game-engine-comparison.md` / `security-comparison.md`.

---

## A. Game start and lobby

| Feature                    | NoPeek                                                                                                    | ZeroPeek                                                                      | Status        | Evidence (ZeroPeek)                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------- | -------------------------------------------------- |
| Choose a quiz              | Quiz list with search, templates, import (xlsx/csv/json), draft state, per-quiz meta (count, time, types) | Quiz list on the host home (`/api/quizzes`), no search/templates              | 🔵 Needs work | `pages/host.ts` `showHome`; `routes/quizRoutes.ts` |
| Create a game              | `create` with options (readAloud, shuffle, theme, time override, leadMs, teams, pid, qa)                  | `host:create` with `{ quizId }` only                                          | 🟡 Partial    | `socket.ts` `host:create`; `engine.create`         |
| Unique PIN                 | 6-digit numeric PIN                                                                                       | 6-char unambiguous alphanumeric PIN, collision-retry (12×)                    | ✅ Complete   | `shared/pin.ts`; `gameService.createGame`          |
| QR code                    | Server-generated QR (`g.qr`) on the lobby and join card                                                   | None                                                                          | ❌ Missing    | `grep qr` → only config comments                   |
| Player join                | PIN + nickname (+ optional participant id), 6-digit validation                                            | PIN + nickname; PIN normalised, nickname uniqueness (accent/case-insensitive) | ✅ Complete   | `player:join`; `gameService.joinGame`              |
| Lobby participant overview | Live chips with avatars, teams, "away" state, animations                                                  | Live list of nicknames only                                                   | 🟡 Partial    | `showLobby`; `host:lobby`                          |
| Remove a player            | Kick button per chip                                                                                      | `host:kick` exists in backend, **no UI button**                               | 🔵 Needs work | `socket.ts` `host:kick`; no caller in `host.ts`    |
| Start the game             | Start button, disabled while empty, lock-lobby toggle                                                     | Start button (server rejects empty), no lock toggle                           | 🟡 Partial    | `showLobby`; `engine.start`                        |
| Lock the lobby             | Lock/unlock button, late joins rejected                                                                   | None (join blocked once phase ≠ lobby)                                        | ❌ Missing    | —                                                  |
| Resume a running game      | "Laufende Spiele" list, `attach` rehydrates full state                                                    | "Open games" list, `host:join` returns pin/phase/players                      | ✅ Complete   | `showHome`; `host:join`                            |

## B. Player surface

| Feature                      | NoPeek                                                                                 | ZeroPeek                                                           | Status        | Evidence (ZeroPeek)                                    |
| ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------- | ------------------------------------------------------ |
| Mobile operation             | Dedicated mobile layout, `viewport-fit=cover`, safe-area, vibration, large tap targets | Responsive CSS; no vibration; minimal mobile tuning                | 🔵 Needs work | `index.html`; `styles/tokens.css`                      |
| Show the current question    | Question text (or "read aloud" mode) + answer tiles                                    | Question text + per-type input control                             | ✅ Complete   | `questionView.questionInput`                           |
| Answer options               | 13 types, lettered keys, true/false icons, tile animations                             | 13 types, numeric keys, true/false buttons                         | ✅ Complete   | `questionView.ts`; `constants.QUESTION_TYPES`          |
| Submit an answer             | Per-type controls; server ACK                                                          | Per-type controls; server ACK `{ accepted }`                       | ✅ Complete   | `player:answer`; `engine.submitAnswer`                 |
| Feedback after submit        | Tile highlight + "wait for reveal" screen                                              | "Answer received." notice, then reveal screen                      | ✅ Complete   | `showQuestion`; `showResult`                           |
| Wait for next question       | `waitScreen`                                                                           | `showWaiting` / spinner                                            | ✅ Complete   | `player.ts`                                            |
| Reconnect after a drop       | Token in `localStorage`, auto-rejoin on `connect`, `kicked`/`replaced` handling        | Token in `sessionStorage`, `player:rejoin` on boot, connected flag | ✅ Complete   | `player.ts`; `player:rejoin`; `gameService.rejoinGame` |
| Avatar selection             | Full avatar builder (body/colour/hat/glasses/extra), server-validated ids              | None (avatar stored as a free string)                              | ❌ Missing    | `gameService.joinGame` (`avatar` string)               |
| Cross-game participant id    | `pid` optional/required, used by reports                                               | `PARTICIPANT_ID_MODES` constant exists, **not wired**              | ❌ Missing    | `constants.PARTICIPANT_ID_MODES` (unused)              |
| Personal result after reveal | Points, rank, team rank                                                                | Outcome, points, score, rank                                       | ✅ Complete   | `game:reveal`; `sendPlayerResults`                     |

## C. Real-time game engine

| Feature                      | NoPeek                                                                                   | ZeroPeek                                                                      | Status      | Evidence (ZeroPeek)                            |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------- | ---------------------------------------------- |
| Synchronise all participants | Server absolute timestamp `at` + clock-offset ping/pong (Kahoot-style)                   | Server `openedAt` timestamp; client computes remaining time locally           | ✅ Complete | `PublicQuestion.openedAt`; `startTimer`        |
| Uniform game state           | Server-authoritative                                                                     | Server-authoritative phase machine                                            | ✅ Complete | `services/engine.ts`                           |
| Timer                        | Server sets `answersAt`/`timeLimit`; host + beamer + phones all derive from server clock | Server timer arms auto-reveal; client renders countdown from `openedAt`       | ✅ Complete | `engine.next` (`setTimeout`)                   |
| Question change              | `next`                                                                                   | `host:next` / auto-advance                                                    | ✅ Complete | `engine.next`                                  |
| Close the question           | `close` (manual) + auto on all-answered                                                  | `host:reveal` (manual) + auto on all-answered                                 | ✅ Complete | `engine.reveal`                                |
| Late answers                 | Rejected server-side; `too_fast`/`invalid`/`blocked` errors surfaced                     | Rejected after `timeLimit + 1.5 s` grace; conflict error                      | ✅ Complete | `engine.submitAnswer`                          |
| Disconnects                  | Connected flag, away state, rejoin                                                       | `connected` flag, lobby repaint, rejoin                                       | ✅ Complete | `markConnected`; `disconnect`                  |
| Multiple messages            | One answer per question per player                                                       | One answer per question per player (`answeredQuestionId` + unique index)      | ✅ Complete | `engine.submitAnswer`; `PlayerAnswer @@unique` |
| Manipulation attempts        | Server validates every payload; solution never sent early                                | Server validates every payload; allow-list `questionDisplay` strips solutions | ✅ Complete | `questions.questionDisplay`                    |
| Presentation / beamer sync   | Dedicated host + moderator views share the same clock                                    | Single host screen; no separate moderator view                                | 🟡 Partial  | `pages/host.ts`                                |

## D. Answers and scoring

| Feature                 | NoPeek                                      | ZeroPeek                                                              | Status        | Evidence (ZeroPeek)                                     |
| ----------------------- | ------------------------------------------- | --------------------------------------------------------------------- | ------------- | ------------------------------------------------------- |
| Correct / wrong answers | Server grades; correctness only after close | Server grades via `correctnessOf`                                     | ✅ Complete   | `scoring.correctnessOf`                                 |
| Answer speed            | Measured server-side, shown as Ø/min        | Measured server-side (`elapsedMs`)                                    | ✅ Complete   | `engine.submitAnswer`                                   |
| Time bonus              | Kahoot-style speed points (server)          | `speedBonusRatio` (default 0.5), linear/quadratic curve               | ✅ Complete   | `scoring.speedFactor`, `scoreAnswer`                    |
| Points calculation      | base + speed bonus; double/none modes       | Configurable (Q1): base 1000, bonus 50 %, double/none, rounding       | ✅ Complete   | `scoring.scoreAnswer`; `DEFAULT_SCORING`                |
| Multiple choice         | `multi` with all-correct-set grading        | `multiple` with all-or-nothing (any wrong pick voids)                 | ✅ Complete   | `correctnessOf` (`multiple`)                            |
| Leaderboard             | Animated old→new with gain and streaks      | Sorted list, shared ranks on ties                                     | 🔵 Needs work | `engine.leaderboard`; `rankPlayers`                     |
| Ties                    | Handled (server ranks)                      | Shared ranks + configurable tie-break (Q6)                            | ✅ Complete   | `rankPlayers`; `DEFAULT_TIE_BREAK`                      |
| Team scoring            | `teams` option, team board, team rank       | `team` column + `MIN/MAX_TEAMS`/`TEAM_NAMES` constants, **not wired** | ❌ Missing    | `schema.prisma` `team`; `constants.TEAM_NAMES` (unused) |

## E. Host control

| Feature                     | NoPeek                                                                    | ZeroPeek                                  | Status      | Evidence (ZeroPeek)             |
| --------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- | ----------- | ------------------------------- |
| Start the game              | `next` from lobby                                                         | `host:start`                              | ✅ Complete | `engine.start`                  |
| Pause the game              | **Not present in the reference either**                                   | Not present                               | ⛔ N/A      | —                               |
| Resume the game             | Resume a running game (re-attach), not a mid-question pause               | Resume a running game                     | ✅ Complete | `host:join`                     |
| Close the question          | `close`                                                                   | `host:reveal`                             | ✅ Complete | `engine.reveal`                 |
| Next question               | `next`                                                                    | `host:next`                               | ✅ Complete | `engine.next`                   |
| Show answers & results      | Rich reveal: distribution, correct set, text cloud, slider band, averages | Reveal: distribution bars + solution text | 🟡 Partial  | `questionResult`; `host:reveal` |
| Open the leaderboard        | `board` with animation                                                    | `host:board`                              | ✅ Complete | `engine.board`                  |
| End the game                | `end`                                                                     | `host:end`                                | ✅ Complete | `engine.end`                    |
| Presenter remote / keyboard | Space/Enter/arrow trigger primary action                                  | None                                      | ❌ Missing  | —                               |
| Review previous questions   | `review` / `review-end` frozen snapshot                                   | None                                      | ❌ Missing  | —                               |

## F. Beamer / presentation mode

| Feature                    | NoPeek                                                           | ZeroPeek                                               | Status        | Evidence (ZeroPeek)                   |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ------------- | ------------------------------------- |
| Full-screen presentation   | Dedicated host CSS, `clamp()` fluid typography, max-width 1600px | Host page is presentation-oriented but not full-screen | 🟡 Partial    | `pages/host.ts`; `host.html`          |
| Question + answer options  | Large tiles, lettered keys, fluid sizes                          | Prompt + distribution only on reveal                   | 🟡 Partial    | `showQuestion` (prompt, timer, count) |
| Countdown                  | SVG ring timer with low-time state                               | Text `Ns` countdown                                    | 🔵 Needs work | `startTimer`                          |
| Result display             | Bars + counts + correct highlight                                | Bars + counts + solution text                          | ✅ Complete   | `questionResult`                      |
| Leaderboard                | Animated rows, avatars, gain, streaks                            | Plain ranked list                                      | 🔵 Needs work | `showBoard`                           |
| Winner display             | Podium with animation + report table                             | Ranked list ("Final results")                          | 🟡 Partial    | `showPodium`                          |
| Legibility from a distance | Fluid `clamp()` type, 1600px cap                                 | Base tokens; not tuned for projection                  | 🔵 Needs work | `styles/tokens.css`                   |

## G. Anti-cheat and security

See `security-comparison.md` for the full table. Summary:

| Feature                   | NoPeek                        | ZeroPeek                                    | Status            |
| ------------------------- | ----------------------------- | ------------------------------------------- | ----------------- |
| Solutions not sent early  | ✅                            | ✅ (`questionDisplay` allow-list)           | ✅ Complete       |
| Server-side grading       | ✅                            | ✅                                          | ✅ Complete       |
| Server-side timing        | ✅                            | ✅                                          | ✅ Complete       |
| Double-submit protection  | ✅                            | ✅ (in-memory + DB unique)                  | ✅ Complete       |
| Socket message validation | ✅                            | ✅ (typed + `asString` + engine checks)     | ✅ Complete       |
| Host-action authorisation | ✅ (session, terms)           | ✅ (`assertHost`, admin override)           | ✅ Complete       |
| CSRF protection           | ✅ (X-CSRF-Token)             | ✅ (double-submit, DB token)                | ✅ Complete       |
| Rate limiting             | ⚠️ partly                     | ✅ (`@fastify/rate-limit`)                  | ✅ Complete       |
| "Too fast" flag           | ✅                            | 🟡 implemented but **off** (Q2)             | 🔵 Needs work     |
| Cheat report              | ✅ (IP, flags, min/avg time)  | 🟡 (flagged answers recorded, not surfaced) | 🟡 Partial        |
| IP storage                | ✅ (documented in pin notice) | ⛔ **blocked by Q5** (data minimisation)    | ⛔ N/A (decision) |
| 2FA / account hardening   | ✅ (email 2FA)                | ❌                                          | ❌ Missing        |

## H. Game end and evaluation

| Feature                 | NoPeek                                                     | ZeroPeek                                       | Status        | Evidence (ZeroPeek)                    |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ------------- | -------------------------------------- |
| Final result            | Podium + full report table                                 | Ranked list                                    | 🟡 Partial    | `showPodium`                           |
| Winner                  | Podium (top 3)                                             | First row of the list                          | 🟡 Partial    | `showPodium`                           |
| Individual statistics   | Points, correct, Ø time, fastest, IP, flags                | Rank, score, answered                          | 🟡 Partial    | `gameReport`                           |
| Question statistics     | Per-question correct/answered/Ø time/solution              | Per-question answered/correct/mean correctness | ✅ Complete   | `gameReport`                           |
| Answer distributions    | Bars/cloud/slider + counts                                 | Distribution map → bars                        | ✅ Complete   | `questionResult`; `gameReport`         |
| Game history            | Filterable reports list, progress per pid, combined report | Reports list (finished games)                  | 🟡 Partial    | `listGames`; `showHome`                |
| Persistent game reports | Stored reports + combined                                  | Stored reports (derived from DB)               | ✅ Complete   | `reportService.gameReport`             |
| Export options          | CSV + Excel, print/PDF, combined                           | CSV only (answers + ranking), JSON quiz export | 🔵 Needs work | `exportAnswersCsv`, `exportRankingCsv` |

## I. Team and audience features

| Feature                       | NoPeek                                             | ZeroPeek                                         | Status                 | Evidence (ZeroPeek)             |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------ | ---------------------- | ------------------------------- |
| Team assignment               | `teams` count at create; auto-balanced, team names | `team` column exists; no assignment logic        | ❌ Missing             | `schema.prisma` `team`          |
| Team names                    | Fixed catalogue (Füchse, Eulen, …)                 | `TEAM_NAMES` constant (Falcons, Lynxes, …)       | ❌ Missing (data only) | `constants.TEAM_NAMES`          |
| Team scoring                  | `teamBoard`, team rank per player                  | None                                             | ❌ Missing             | —                               |
| Audience participation        | Audience Q&A (`qa:ask`, `qa:vote`, `qa:mod`)       | None                                             | ❌ Missing             | —                               |
| Audience votes                | Upvotes on approved questions                      | None                                             | ❌ Missing             | —                               |
| Interactive viewer features   | Moderation panel, fab, statuses                    | None                                             | ❌ Missing             | —                               |
| Poll / open / scale questions | Unscored types with live tallies                   | Unscored types collected; tallies only in report | 🟡 Partial             | `correctnessOf` (unscored)      |
| Word cloud                    | Live cloud on reveal                               | Word cloud type exists; no cloud view            | 🟡 Partial             | `questionResult` (generic bars) |

---

## Cross-cutting comparison

| Area                        | NoPeek                                        | ZeroPeek                                         | Status            |
| --------------------------- | --------------------------------------------- | ------------------------------------------------ | ----------------- |
| Question types              | 13                                            | 13 (same set, own implementation)                | ✅ Complete       |
| Answer-text normalisation   | accents/umlauts/case/punctuation              | accents/case/punctuation (`normalizeText`)       | ✅ Complete       |
| Client build freshness      | Build-hash reload guard                       | None                                             | ❌ Missing        |
| Self-paced / homework mode  | Full homework mode (`/hw-api`)                | Not implemented (Q7 open)                        | ⛔ N/A (decision) |
| Themes                      | 10 themes + season auto                       | 10 themes (constants; frontend applies none yet) | 🔵 Needs work     |
| Branding / custom logo      | Admin branding (logo, colours, WCAG contrast) | None                                             | ❌ Missing        |
| Multi-language              | 9 languages                                   | English strings only                             | ❌ Missing        |
| Self-registration / invites | Invite codes, registration modes              | Admin-created users only                         | 🟡 Partial        |
| Legal / privacy surfaces    | Imprint, privacy, terms, consent              | None                                             | ❌ Missing        |
| Persistence model           | Server JSON store                             | PostgreSQL + Prisma (stronger)                   | ✅ Complete       |
