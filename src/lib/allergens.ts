// src/lib/allergens.ts — ALLERGIES THAT FOLLOW THE GUEST. A dish says what it contains (the nine major US allergens,
// plus gluten, which guests ask about as often); a table says who has an allergy (a seat, or the whole table when nobody
// knows whose it is), seeded from a regular's profile. Ringing in a dish that contains a seat's allergen warns the
// server first. Every ticket for that seat carries the allergy, and the station taps "Allergy noted" before the dish can
// be marked ready (api/kitchen). Pure: the screens and the server use the same rules.

export type AllergenKey = 'milk' | 'eggs' | 'fish' | 'shellfish' | 'treenuts' | 'peanuts' | 'wheat' | 'gluten' | 'soy' | 'sesame';
export const ALLERGENS: { key: AllergenKey; label: string }[] = [
  { key: 'milk', label: 'Milk' }, { key: 'eggs', label: 'Eggs' }, { key: 'fish', label: 'Fish' }, { key: 'shellfish', label: 'Shellfish' },
  { key: 'treenuts', label: 'Tree nuts' }, { key: 'peanuts', label: 'Peanuts' }, { key: 'wheat', label: 'Wheat' }, { key: 'gluten', label: 'Gluten' },
  { key: 'soy', label: 'Soy' }, { key: 'sesame', label: 'Sesame' },
];
const KEYS = new Set<string>(ALLERGENS.map((a) => a.key));
export const isAllergen = (k: unknown): k is AllergenKey => typeof k === 'string' && KEYS.has(k);
export const allergenLabel = (k: string) => ALLERGENS.find((a) => a.key === k)?.label || k;
/** Lower case, for a sentence: "tree nuts". */
export const allergenWord = (k: string) => allergenLabel(k).toLowerCase();
/** The list in the menu's order, each once. */
export const cleanKeys = (v: unknown): AllergenKey[] => { const s = new Set((Array.isArray(v) ? v : []).filter(isAllergen)); return ALLERGENS.map((a) => a.key).filter((k) => s.has(k)); };
/** What a menu item contains, as saved on it. */
export const itemAllergens = (item: any): AllergenKey[] => cleanKeys(item?.allergens);
/** Has anyone said what it contains (an empty list is "none of these"; no list at all is "nobody has said")? */
export const allergensKnown = (item: any): boolean => Array.isArray(item?.allergens);

// Words people write on a profile ("Nuts", "Dairy", "Celiac", "Shrimp") and the allergens they mean. "Nuts" means both
// kinds: a server can't tell which, so both warn.
const WORDS: [RegExp, AllergenKey[]][] = [
  [/\bpeanuts?\b|\bgroundnuts?\b/i, ['peanuts']],
  [/\btree ?nuts?\b|\balmonds?\b|\bcashews?\b|\bwalnuts?\b|\bpecans?\b|\bhazelnuts?\b|\bpistachios?\b|\bmacadamias?\b|\bbrazil ?nuts?\b|\bpine ?nuts?\b/i, ['treenuts']],
  [/\bmilk\b|\bdairy\b|\blactose\b|\bcasein\b|\bwhey\b|\bcheese\b/i, ['milk']],
  [/\beggs?\b/i, ['eggs']],
  [/\bshellfish\b|\bshrimps?\b|\bprawns?\b|\bcrabs?\b|\blobsters?\b|\bcrayfish\b|\bcrustaceans?\b|\bclams?\b|\boysters?\b|\bmussels?\b|\bscallops?\b|\bmollus[ck]s?\b/i, ['shellfish']],
  [/\bfish\b|\bsalmon\b|\btuna\b|\bcod\b|\banchov(y|ies)\b|\bseafood\b/i, ['fish']],
  [/\bc[o]?eliac\b|\bgluten\b/i, ['gluten', 'wheat']],
  [/\bwheat\b/i, ['wheat']],
  [/\bsoy\b|\bsoya\b|\bsoybeans?\b|\btofu\b/i, ['soy']],
  [/\bsesame\b|\btahini\b/i, ['sesame']],
];
// "Seafood" covers both: fish and shellfish.
const BOTH_SEA = /\bseafood\b/i;

/** The allergens a word or phrase means (none: it's something else, kept as written). */
export function keysFromWords(text: unknown): AllergenKey[] {
  const t = String(text || '').trim(); if (!t) return [];
  const out = new Set<AllergenKey>();
  for (const [re, keys] of WORDS) if (re.test(t)) keys.forEach((k) => out.add(k));
  if (BOTH_SEA.test(t)) out.add('shellfish');
  // Plain "nuts" (not tree nuts or peanuts named as such): both kinds.
  if (/\bnuts?\b/i.test(t.replace(/\b(tree|pine|brazil)\s?nuts?\b|\bpeanuts?\b|\bgroundnuts?\b/gi, ''))) { out.add('peanuts'); out.add('treenuts'); }
  return ALLERGENS.map((a) => a.key).filter((k) => out.has(k));
}

/** One allergy at a table: whose seat (null: the whole table, whose isn't known), the allergens, anything else in their
 *  words ("mustard"), how serious, and where it came from. */
export type TableAllergy = { id: string; seat: string | null; keys: AllergenKey[]; other: string | null; severe: boolean; from: 'profile' | 'asked'; by: string; at: string };
export const MAX_TABLE_ALLERGIES = 20;
const SEVERE = /anaphyla|epi-?pen|severe|life[- ]threat|deadly|airborne/i;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A table's allergies as saved on its visit, cleaned (anything unreadable left out). */
export function tableAllergies(v: any): TableAllergy[] {
  return (Array.isArray(v?.allergies) ? v.allergies : []).slice(0, MAX_TABLE_ALLERGIES).map((a: any, i: number) => ({
    id: clip(a?.id, 40) || `a${i}`, seat: a?.seat === null || a?.seat === undefined || a?.seat === '' ? null : clip(a.seat, 4),
    keys: cleanKeys(a?.keys), other: clip(a?.other, 60) || null, severe: a?.severe === true, from: a?.from === 'profile' ? 'profile' : 'asked',
    by: clip(a?.by, 60), at: clip(a?.at, 40),
  })).filter((a: TableAllergy) => a.keys.length > 0 || !!a.other);
}

/** One allergy as a screen sent it, cleaned for saving (null: nothing to save). New ones are 'asked', by whoever saved
 *  them; `id` keeps an existing one's place. */
export function cleanAllergy(v: any, by: string, at: string): TableAllergy | null {
  const keys = cleanKeys(v?.keys); const other = clip(v?.other, 60) || null;
  if (!keys.length && !other) return null;
  const seat = v?.seat === null || v?.seat === undefined || v?.seat === '' ? null : String(v.seat);
  if (seat !== null && !/^\d{1,2}$/.test(seat)) return null;
  const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(v?.id || '')) ? String(v.id) : `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return { id, seat, keys, other, severe: v?.severe === true, from: 'asked', by: clip(by, 60), at };
}

/** A regular's allergies from their profile (client.intel.allergies: picks and a note), for the whole table until the
 *  server puts them on a seat. Nothing when the profile has none. */
export function profileAllergy(client: any, by: string, at: string): TableAllergy | null {
  const a = client?.intel?.allergies || {};
  const flags: string[] = (Array.isArray(a.flags) ? a.flags : []).map((f: any) => clip(f, 40)).filter(Boolean);
  const note = clip(a.notes, 120);
  const legacy = typeof client?.allergies === 'string' ? clip(client.allergies, 120) : '';
  const keys = new Set<AllergenKey>(); const other: string[] = [];
  for (const f of flags) { const k = keysFromWords(f); if (k.length) k.forEach((x) => keys.add(x)); else other.push(f); }
  for (const n of [note, legacy]) { if (!n) continue; keysFromWords(n).forEach((x) => keys.add(x)); }
  // A note that isn't just the picks again goes with it in their words ("carries an EpiPen", "mustard").
  const extra = [...other, ...[note, legacy].filter((n) => n && !keysFromWords(n).length)].join(', ').slice(0, 60);
  if (!keys.size && !extra) return null;
  const name = clip(client?.name || [client?.firstName, client?.lastName].filter(Boolean).join(' '), 40);
  return { id: 'profile', seat: null, keys: ALLERGENS.map((x) => x.key).filter((k) => keys.has(k)), other: extra || null,
    severe: [...flags, note, legacy].some((x) => SEVERE.test(String(x || ''))), from: 'profile', by: name ? `${name}’s profile` : 'Their profile', at };
}

/** The allergies that reach a dish for this seat: that seat's, and the whole table's. A dish for the table (to share,
 *  seat not set) reaches everyone, so every seat's counts. */
export function reaching(list: TableAllergy[], seat: string | null): TableAllergy[] {
  return seat ? list.filter((a) => a.seat === seat || a.seat === null) : list;
}

/** The allergens a dish has that someone it reaches can't have, and who: for the server's warning. */
export function conflicts(itemKeys: string[], list: TableAllergy[], seat: string | null): { keys: AllergenKey[]; who: TableAllergy[] } {
  const has = new Set(cleanKeys(itemKeys)); const who = reaching(list, seat).filter((a) => a.keys.some((k) => has.has(k)));
  const keys = ALLERGENS.map((x) => x.key).filter((k) => who.some((a) => a.keys.includes(k)) && has.has(k));
  return { keys, who };
}

/** "tree nuts and shellfish" */
export function wordsList(keys: string[]): string {
  const w = keys.map(allergenWord);
  return w.length <= 1 ? (w[0] || '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}
export const whoWords = (a: TableAllergy) => (a.seat ? `Seat ${a.seat}` : 'Someone at the table');
const NOUN: Record<string, string> = { milk: 'milk', eggs: 'egg', fish: 'fish', shellfish: 'shellfish', treenuts: 'tree nut', peanuts: 'peanut', wheat: 'wheat', gluten: 'gluten', soy: 'soy', sesame: 'sesame' };
/** "a severe tree nut allergy", "an egg and milk allergy" */
export function allergyPhrase(keys: string[], severe: boolean): string {
  const w = keys.map((k) => NOUN[k] || allergenWord(k)); const list = w.length <= 1 ? (w[0] || '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
  const body = `${severe ? 'severe ' : ''}${list} allergy`;
  return `${/^[aeiou]/i.test(body) ? 'an' : 'a'} ${body}`;
}
/** "Seat 2: tree nuts, severe" */
export function allergyLine(a: TableAllergy): string {
  const what = [wordsList(a.keys), a.other].filter(Boolean).join(', ');
  return `${a.seat ? `Seat ${a.seat}` : 'Whole table'}: ${what}${a.severe ? ', severe' : ''}`;
}

/** What a kitchen ticket says about allergies for this seat and dish (lib/kitchen allergyFlags reads `allergies`):
 *  each allergen and anything else in their words, how serious, and what the menu says the dish contains of them. */
export function ticketAllergyFields(list: TableAllergy[], seat: string | null, itemKeys: string[]) {
  const reach = reaching(list, seat);
  const names = new Map<string, boolean>();
  for (const a of reach) {
    for (const k of a.keys) names.set(allergenLabel(k), (names.get(allergenLabel(k)) || false) || a.severe);
    if (a.other) names.set(a.other, (names.get(a.other) || false) || a.severe);
  }
  const allergies = Array.from(names.entries()).map(([name, severe]) => ({ name, ...(severe ? { severity: 'severe' } : {}) }));
  const c = conflicts(itemKeys, list, seat).keys;
  return { allergies, contains: c.map(allergenLabel) };
}

/** Do two tickets' allergies say the same thing (so an "Allergy noted" still stands)? */
export function sameAllergies(a: any[], b: any[]): boolean {
  const key = (x: any[]) => (Array.isArray(x) ? x : []).map((y: any) => `${String(typeof y === 'string' ? y : y?.name || y?.label || '').toLowerCase()}|${typeof y === 'object' && y?.severity ? 'severe' : ''}`).sort().join(',');
  return key(a) === key(b);
}
/** What a ticket says about allergies, in one line: the station sends what it was shown with "Allergy noted", and the
 *  server refuses the tap if the ticket says something else by then. */
export function allergySig(t: any): string {
  const names = (Array.isArray(t?.allergies) ? t.allergies : []).map((y: any) => `${String(typeof y === 'string' ? y : y?.name || y?.label || '').toLowerCase()}|${typeof y === 'object' && y?.severity ? 'severe' : ''}`).sort();
  const has = (Array.isArray(t?.contains) ? t.contains : []).map((x: any) => String(x).toLowerCase()).sort();
  return `${names.join(',')}/${has.join(',')}/${String(t?.allergyNote || '').trim().toLowerCase()}`;
}

/** The change to make to a ticket when its seat's allergies change: the new allergies, and "Allergy noted" asked again
 *  when what it says changed and the dish hasn't gone out (a plate waiting at the pass is looked at again too). Null:
 *  nothing to change. */
export function ticketAllergyPatch(ticket: any, list: TableAllergy[], seat: string | null, itemKeys: string[]): Record<string, any> | null {
  // A plate already out (or taken off) is left as it was.
  if (!['unfired', 'pending', 'in_progress', 'ready'].includes(String(ticket?.status || ''))) return null;
  const next = ticketAllergyFields(list, seat, itemKeys);
  const same = sameAllergies(ticket?.allergies, next.allergies) && JSON.stringify(ticket?.contains || []) === JSON.stringify(next.contains);
  if (same) return null;
  return { allergies: next.allergies, contains: next.contains, allergyNotedAt: null, allergyNotedBy: null };
}
