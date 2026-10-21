// src/lib/client-search.ts — FINDING A CLIENT WITHOUT LOADING EVERY CLIENT. Each client record carries searchKeys: the
// starts of each word of their name, of their email, and of their phone number. Typing "jes", "marsh", "jess@",
// "917" or the last four digits finds them with one small query (array-contains), however big the client list is.
//
// Keys are written when clients are created or edited on the main paths, and a background job (cron/client-search)
// fills in or corrects any record missing them, at most once a day per business.

export const SEARCH_V = 1;
const MAX_PREFIX = 12;
const MAX_KEYS = 180;

const fold = (s: string) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

function prefixes(word: string, min = 1): string[] {
  const out: string[] = [];
  for (let n = min; n <= Math.min(MAX_PREFIX, word.length); n++) out.push(word.slice(0, n));
  return out;
}

/** Every search key for one client. */
export function clientSearchKeys(c: { name?: unknown; firstName?: unknown; lastName?: unknown; email?: unknown; phone?: unknown; preferredName?: unknown } | null | undefined): string[] {
  if (!c) return [];
  const keys = new Set<string>();
  const nameText = fold([c.name, c.firstName, c.lastName, c.preferredName].filter(Boolean).join(' '));
  const words = nameText.split(/[^a-z0-9]+/).filter(Boolean);
  // O'Brien is found as "obrien" and as "brien".
  const joined = nameText.replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of new Set([...words, ...joined])) prefixes(w).forEach((k) => keys.add(k));
  const email = fold(String(c.email || '').trim());
  if (email.includes('@')) {
    const local = email.split('@')[0];
    prefixes(local, 2).forEach((k) => keys.add(k));
    for (let n = local.length + 1; n <= Math.min(40, email.length); n++) keys.add(email.slice(0, n));   // "jess@gm…"

  }
  const p = digits(c.phone).slice(-10);
  if (p.length >= 7) {
    for (let n = 3; n <= p.length; n++) keys.add(p.slice(0, n));   // area code onward
    keys.add(p.slice(-4)); keys.add(p.slice(-7));                  // last four, local number
  }
  return [...keys].slice(0, MAX_KEYS);
}

/** What one typed search becomes: one key to look up, or null when there's nothing to search. */
export function searchTermKey(term: string): string | null {
  const t = String(term || '').trim();
  if (!t) return null;
  const d = digits(t);
  if (d.length >= 3 && d.length >= t.replace(/[\s()+.-]/g, '').length) return d.length > 10 ? d.slice(-10) : d;   // a phone number
  const f = fold(t).replace(/['’`]/g, '');
  if (f.includes('@')) return f;
  const words = f.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return null;
  // Several words ("jess mar"): look up the longest, then every word must start one of the client's words (matchesSearch).
  return words.reduce((a, b) => (b.length > a.length ? b : a)).slice(0, MAX_PREFIX);
}

/** Does a loaded client match the typed search (the same rule, for lists already on screen)? */
export function matchesSearch(c: any, term: string): boolean {
  const k = searchTermKey(term);
  if (!k) return true;
  const keys = new Set(clientSearchKeys(c));
  if (/^\d+$/.test(k) || k.includes('@')) return keys.has(k);
  return fold(term).replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean).every((w) => keys.has(w.slice(0, MAX_PREFIX)));
}

export function sameKeys(a: unknown, b: string[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const s = new Set(a as string[]);
  return b.every((k) => s.has(k));
}

/** The fields to write alongside a client's details. */
export function searchFields(c: any): { searchKeys: string[]; searchV: number } {
  return { searchKeys: clientSearchKeys(c), searchV: SEARCH_V };
}
