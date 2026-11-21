/**
 * Background image catalogue (Phase 6.10).
 *
 * The **single source of truth** for the ten background images the project owner
 * supplied in `ZeroPeek_Background.zip`. Every entry is derived from a supplied
 * filename: the id is the filename stem without the `zeropeek_` prefix and the
 * `.webp` extension, the path points at the untouched file under
 * `packages/frontend/public/backgrounds/`, and the display name is a readable
 * form of that same stem.
 *
 * Boundaries that matter:
 *   - **No invented backgrounds.** The catalogue lists exactly the ten supplied
 *     files, in the order the owner delivered them. Nothing is generated, and no
 *     file is renamed, re-encoded or edited.
 *   - **No image analysis.** Ids, names and paths come from the filenames alone;
 *     the module never reads pixel data, so it cannot mislabel a motif.
 *   - **Server-authoritative selection.** The host chooses a background, but the
 *     choice is stored and broadcast by the server. The random pick is a pure
 *     function here so the same code runs in a unit test and in the engine.
 *
 * The module is runtime-agnostic (no `node:` imports, no DOM), so the backend and
 * the frontend share it unchanged.
 */

/** The sentinel the host sends to ask for a random background. */
export const RANDOM_BACKGROUND = 'random';

/** One supplied background image. */
export interface BackgroundEntry {
  /** Stable id, stored on the game and sent to every client. */
  id: string;
  /** Human-readable display name, derived from the filename. */
  name: string;
  /** The supplied filename, shown in the host picker for traceability. */
  file: string;
  /** Public URL of the untouched WebP file. */
  path: string;
}

/**
 * Build an entry from a supplied filename.
 *
 * The id is the stem with the `zeropeek_` prefix and the `.webp` extension
 * removed, so `zeropeek_synthwave_skyline.webp` becomes `synthwave_skyline`. The
 * display name is the stem with the separators turned into spaces and the words
 * capitalised — derived from the filename, never from the image.
 */
function entry(file: string, name: string): BackgroundEntry {
  const id = file.replace(/^zeropeek_/, '').replace(/\.webp$/, '');
  return { id, name, file, path: `/backgrounds/${file}` };
}

/**
 * The ten supplied backgrounds, in delivery order.
 *
 * Display names are short on purpose (Phase 6.14): the host picks from a
 * one-line carousel, so a long label would wrap or truncate. Only the label
 * changed — ids, filenames and paths are still derived from the delivered files
 * and are untouched, so stored games and every client keep resolving the same
 * image. The filename stays available on each entry for traceability.
 */
export const BACKGROUND_CATALOGUE: readonly BackgroundEntry[] = [
  entry('zeropeek_palmen_tron_background.webp', 'Palm Trees'),
  entry('zeropeek_synthwave_bruecke_zwei_berge.webp', 'Mountain Bridge'),
  entry('zeropeek_synthwave_forschungsstation_muted.webp', 'Research Station'),
  entry('zeropeek_synthwave_lagerhalle_minimal.webp', 'Warehouse'),
  entry('zeropeek_synthwave_megacity_detail.webp', 'Megacity'),
  entry('zeropeek_synthwave_raumstation_ohne_boden.webp', 'Space Station'),
  entry('zeropeek_synthwave_skyline.webp', 'Skyline'),
  entry('zeropeek_synthwave_unterwasser_v3.webp', 'Underwater'),
  entry('zeropeek_synthwave_weltraum.webp', 'Space'),
  entry('zeropeek_synthwave_wueste.webp', 'Desert'),
];

/** Every catalogue id, in catalogue order. */
export const BACKGROUND_IDS: readonly string[] = BACKGROUND_CATALOGUE.map((item) => item.id);

/** The background a game falls back to when its stored id is unknown or absent. */
export const DEFAULT_BACKGROUND_ID = BACKGROUND_CATALOGUE[0]!.id;

/** Look a background up by id, or `undefined` if the id is not in the catalogue. */
export function findBackground(id: string | null | undefined): BackgroundEntry | undefined {
  if (!id) return undefined;
  return BACKGROUND_CATALOGUE.find((item) => item.id === id);
}

/** Whether an id names a supplied background. */
export function isBackgroundId(id: unknown): id is string {
  return typeof id === 'string' && findBackground(id) !== undefined;
}

/**
 * The public path of a background.
 *
 * Falls back to the first catalogue entry for an unknown or missing id, so a
 * stale value (an old game, a hand-edited payload) can never produce a broken
 * image reference. Returns `null` only if the catalogue itself is empty.
 */
export function backgroundPath(id: string | null | undefined): string | null {
  return (findBackground(id) ?? BACKGROUND_CATALOGUE[0])?.path ?? null;
}

/** The display name of a background, with the same fallback as `backgroundPath`. */
export function backgroundName(id: string | null | undefined): string {
  return (findBackground(id) ?? BACKGROUND_CATALOGUE[0])?.name ?? '';
}

/**
 * Pick a background id at random.
 *
 * Pure apart from the injected `random` source, so a test can make the result
 * deterministic. The caller decides **when** to call it: the engine does so once
 * when a game is created and again only on an explicit host action, never per
 * render and never per client. That is what makes the choice stable for the whole
 * round and identical on every screen.
 *
 * `exclude` lets a caller ask for a *different* id than the one already showing.
 * Re-rolling the Random position must never be a dead click, and without this a
 * 1-in-10 roll could land on the current image and look like nothing happened.
 * If the catalogue holds only the excluded id, the exclusion is dropped rather
 * than looping forever.
 */
export function pickRandomBackground(random: () => number = Math.random, exclude?: string): string {
  const pool =
    exclude !== undefined && BACKGROUND_CATALOGUE.length > 1
      ? BACKGROUND_CATALOGUE.filter((item) => item.id !== exclude)
      : BACKGROUND_CATALOGUE;
  const index = Math.floor(random() * pool.length);
  // Guard against a `random()` of exactly 1 (or a negative value), so the pick
  // can never fall outside the pool.
  const safeIndex = Math.min(Math.max(index, 0), pool.length - 1);
  return pool[safeIndex]!.id;
}

/**
 * Resolve a host's background choice to the concrete id a game stores.
 *
 * `RANDOM_BACKGROUND` triggers one random pick; a known id is kept as sent; an
 * unknown value is a client error and yields `undefined`, so the caller can
 * reject it rather than silently storing a background nobody supplied.
 *
 * `current` is the id in force right now. A random pick avoids it, so pressing
 * the Random position again always changes the image instead of sometimes
 * re-rolling the same one.
 */
export function resolveBackgroundChoice(
  choice: unknown,
  random: () => number = Math.random,
  current?: string,
): string | undefined {
  if (choice === RANDOM_BACKGROUND) return pickRandomBackground(random, current);
  return isBackgroundId(choice) ? choice : undefined;
}

/**
 * The carousel positions, in display order (Phase 6.14).
 *
 * `Random` leads, then the catalogue in delivery order, which is exactly the
 * cycle the host steps through: Random → Palm Trees → … → Desert → Random. The
 * list holds ids (and the `random` sentinel), never labels, so the display name
 * stays a lookup and a rename can never reorder the carousel.
 */
export const BACKGROUND_CHOICES: readonly string[] = [RANDOM_BACKGROUND, ...BACKGROUND_IDS];

/**
 * The display name of a carousel position.
 *
 * The `random` sentinel is not in the catalogue, so `backgroundName` would fall
 * back to the first entry's name and label a random round with a concrete motif.
 * This helper names the sentinel explicitly and defers to `backgroundName` for
 * every real id, including its fallback for an unknown one.
 */
export function backgroundChoiceName(choice: string | null | undefined): string {
  if (choice === RANDOM_BACKGROUND) return 'Random';
  return backgroundName(choice);
}

/**
 * The carousel position `step` places away from `current`, wrapping at both ends
 * (Phase 6.14).
 *
 * The two arrows are the only caller: `-1` is "previous", `+1` is "next", and the
 * wrap is what makes the last entry lead back to the first. An unknown `current`
 * starts from the Random position, so a stale id cannot throw or land outside the
 * list. `step` is normalised, so a caller may pass `±10` or a negative value
 * larger than the list.
 */
export function stepBackground(current: string | null | undefined, step: number): string {
  const length = BACKGROUND_CHOICES.length;
  if (length === 0) return '';
  const start = BACKGROUND_CHOICES.indexOf(current ?? '');
  // A missing or unknown current resolves to the Random position, which is where
  // a fresh lobby starts, so the carousel and the server never disagree.
  const from = start === -1 ? 0 : start;
  const offset = Math.trunc(step) % length;
  // `+ length` before the modulo keeps a negative step positive.
  const next = (((from + offset) % length) + length) % length;
  return BACKGROUND_CHOICES[next]!;
}
