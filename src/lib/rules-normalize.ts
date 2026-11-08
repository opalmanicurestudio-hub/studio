// src/lib/rules-normalize.ts — a fingerprint of a rules file that ignores line endings and trailing spaces (a paste into
// the Firebase console can change those), so HQ can compare what's published with what's in the repo.
import { createHash } from 'crypto';

export function normalizeRules(src: string): string {
  return String(src || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();
}
export function rulesFingerprint(src: string): string {
  return createHash('sha256').update(normalizeRules(src)).digest('hex').slice(0, 16);
}
