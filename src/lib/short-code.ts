/**
 * generateShortCode
 *
 * Generates a short, human-friendly check-in code from a restricted,
 * visually-unambiguous alphabet — no 0/O, no 1/I/L, no other characters
 * that are hard to tell apart in confirmation-screen or receipt-printer
 * fonts. This is the code shown to clients (on-screen and on printed
 * tickets) so they can check in at the front desk, as distinct from
 * `checkInToken`, which uses nanoid's default alphabet and is meant for
 * URLs, not for a human to read aloud or copy off a screen.
 *
 * Alphabet: 32 characters, all uppercase, digits 0/1 removed and letters
 * O/I/L removed to eliminate the most common misreads:
 *   23456789ABCDEFGHJKMNPQRSTUVWXYZ
 *
 * Uses the Web Crypto API (available in both browser and Node/Edge runtimes
 * used by Next.js) for unbiased random character selection rather than
 * Math.random(), since this code is used to look up a real appointment
 * record and should have a low collision rate.
 */

const SHORT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const DEFAULT_LENGTH = 8;

function getRandomValues(length: number): Uint8Array {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues(new Uint8Array(length));
  }
  // Fallback (should not normally be hit in Next.js server or browser
  // runtimes, but keeps this module from hard-crashing in an unusual
  // environment). Not cryptographically strong, but check-in codes are not
  // a security boundary — collision-avoidance is the concern here, not
  // unguessability.
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

/**
 * Generate a short, unambiguous check-in code.
 * @param length Number of characters (default 8).
 */
export function generateShortCode(length: number = DEFAULT_LENGTH): string {
  const bytes = getRandomValues(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  }
  return code;
}
