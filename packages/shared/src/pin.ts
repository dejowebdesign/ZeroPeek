/**
 * Game PIN generation and validation.
 *
 * A PIN is short enough to type on a phone and to read from a projector. To
 * avoid ambiguous characters (0/O, 1/I/L, 5/S, 8/B) the alphabet excludes them,
 * so a PIN read aloud is never misheard.
 *
 * The generator takes a random source so the server can use `crypto` and tests
 * can be deterministic. `generatePin` does not guarantee uniqueness across
 * active games – the caller retries on collision (see the game service).
 */

/** Unambiguous alphabet: no 0/O, 1/I/L, 5/S, 8/B. */
export const PIN_ALPHABET = '234679ACDEFGHJKMNPQRTUVWXYZ';

/** Number of characters in a PIN. */
export const PIN_LENGTH = 6;

/** A random source returning a float in `[0, 1)`, like `Math.random`. */
export type RandomSource = () => number;

/** Create one PIN using the given random source. */
export function generatePin(random: RandomSource = Math.random): string {
  let pin = '';
  for (let i = 0; i < PIN_LENGTH; i += 1) {
    const index = Math.floor(random() * PIN_ALPHABET.length) % PIN_ALPHABET.length;
    pin += PIN_ALPHABET[index];
  }
  return pin;
}

/**
 * Normalise user input before lookup: upper-case, strip anything that is not in
 * the alphabet (spaces, dashes, a stray `0` typed for `O`).
 */
export function normalizePin(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((char) => PIN_ALPHABET.includes(char))
    .join('');
}

/** True when the input is a well-formed PIN. */
export function isValidPin(input: string): boolean {
  return normalizePin(input).length === PIN_LENGTH;
}
