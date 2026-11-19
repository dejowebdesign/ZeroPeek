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
 * Names are a readable rendering of each filename. Where the filename carries a
 * qualifier (`muted`, `minimal`, `detail`, `ohne_boden`, `v3`) it is kept in the
 * display name so the host can tell similar motifs apart without seeing them.
 */
export const BACKGROUND_CATALOGUE: readonly BackgroundEntry[] = [
  entry('zeropeek_palmen_tron_background.webp', 'Palmen Tron'),
  entry('zeropeek_synthwave_bruecke_zwei_berge.webp', 'Synthwave – Brücke zwei Berge'),
  entry(
    'zeropeek_synthwave_forschungsstation_muted.webp',
    'Synthwave – Forschungsstation (gedämpft)',
  ),
  entry('zeropeek_synthwave_lagerhalle_minimal.webp', 'Synthwave – Lagerhalle (minimal)'),
  entry('zeropeek_synthwave_megacity_detail.webp', 'Synthwave – Megacity (detailliert)'),
  entry('zeropeek_synthwave_raumstation_ohne_boden.webp', 'Synthwave – Raumstation (ohne Boden)'),
  entry('zeropeek_synthwave_skyline.webp', 'Synthwave – Skyline'),
  entry('zeropeek_synthwave_unterwasser_v3.webp', 'Synthwave – Unterwasser'),
  entry('zeropeek_synthwave_weltraum.webp', 'Synthwave – Weltraum'),
  entry('zeropeek_synthwave_wueste.webp', 'Synthwave – Wüste'),
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
 */
export function pickRandomBackground(random: () => number = Math.random): string {
  const index = Math.floor(random() * BACKGROUND_CATALOGUE.length);
  // Guard against a `random()` of exactly 1 (or a negative value), so the pick
  // can never fall outside the catalogue.
  const safeIndex = Math.min(Math.max(index, 0), BACKGROUND_CATALOGUE.length - 1);
  return BACKGROUND_CATALOGUE[safeIndex]!.id;
}

/**
 * Resolve a host's background choice to the concrete id a game stores.
 *
 * `RANDOM_BACKGROUND` triggers one random pick; a known id is kept as sent; an
 * unknown value is a client error and yields `undefined`, so the caller can
 * reject it rather than silently storing a background nobody supplied.
 */
export function resolveBackgroundChoice(
  choice: unknown,
  random: () => number = Math.random,
): string | undefined {
  if (choice === RANDOM_BACKGROUND) return pickRandomBackground(random);
  return isBackgroundId(choice) ? choice : undefined;
}
