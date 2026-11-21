// src/lib/order-allergy.ts — ALLERGIES AND NOTES ON A QUICK-SERVICE ORDER (pure; design board "Allergies and notes on
// every food order"). However the food is ordered (ahead or for delivery, at the kiosk, the counter or the drive-thru, or
// a delivery app's order keyed in), the guest's allergies go on every kitchen ticket and a note goes with the dish it's
// for. The kitchen screen shows allergies big and asks the station to tap "Allergy noted" (lib/kitchen), as at a table.
// - The order's allergies: the major ones (lib/allergens), another in their words, and whether it's severe.
//     tenants/{t}/counterOrders/{id}.allergy = { keys, other, severe, by, at } (none: no field)
// - A dish's note ("no onions"): on that line only, and on its tickets (a combo's: on each part's).
//     counterOrders/{id}.lines[].note
// - What the menu says a dish contains of their allergens is called out before paying, on the counter and on the ticket;
//   a dish nobody has filled in its allergens for is never said to have none.
import { cleanKeys, allergenLabel, itemAllergens, allergensKnown, keysFromWords, ticketAllergyFields, wordsList, type AllergenKey, type TableAllergy } from '@/lib/allergens';

export type OrderAllergy = { keys: AllergenKey[]; other: string | null; severe: boolean; by?: string; at?: string };
export const NOTE_MAX = 140;
/** Another allergy, as typed in one go; and the most kept on an order once allergies from more than one place are joined
 *  (said ahead, at the speaker, at the window). */
export const OTHER_MAX = 60;
export const OTHER_KEEP = 200;

const tidy = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** A dish's note as typed, tidied; null when empty. */
export const cleanLineNote = (v: unknown): string | null => tidy(v, NOTE_MAX) || null;

/** Two dishes' notes say the same (any case): the same line. */
export const sameNote = (a: unknown, b: unknown) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The order's allergies as sent by a screen, cleaned; null when there are none (nothing picked, nothing typed). */
export function cleanOrderAllergy(raw: any, max = OTHER_MAX): Omit<OrderAllergy, 'by' | 'at'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const keys = cleanKeys(raw.keys); const other = tidy(raw.other, max) || null;
  if (!keys.length && !other) return null;
  return { keys, other, severe: raw.severe === true };
}

/** Two sets of allergies as one: every allergen in either, each other one once (any case), severe if either is. Null
 *  when both are none. Never drops an allergen or severe: the other ones are kept up to OTHER_KEEP, and `cut` says some
 *  of their words didn't fit (to be told to the kitchen). */
export function mergeAllergy(a: Pick<OrderAllergy, 'keys' | 'other' | 'severe'> | null | undefined, b: Pick<OrderAllergy, 'keys' | 'other' | 'severe'> | null | undefined): (Omit<OrderAllergy, 'by' | 'at'> & { cut?: boolean }) | null {
  if (!a && !b) return null;
  const keys = cleanKeys([...(a?.keys || []), ...(b?.keys || [])]);
  const seen = new Set<string>(); const others: string[] = [];
  for (const w of [a?.other, b?.other].flatMap((x) => String(x || '').split(',')).map((x) => x.trim()).filter(Boolean)) { const k = w.toLowerCase(); if (!seen.has(k)) { seen.add(k); others.push(w); } }
  const all = others.join(', '); const other = all.slice(0, OTHER_KEEP);
  if (!keys.length && !other) return null;
  return { keys, other: other || null, severe: !!(a?.severe || b?.severe), ...(all.length > OTHER_KEEP ? { cut: true } : {}) };
}
/** The same allergies (nothing new to add)? */
export const sameAllergy = (a: Pick<OrderAllergy, 'keys' | 'other' | 'severe'> | null | undefined, b: Pick<OrderAllergy, 'keys' | 'other' | 'severe'> | null | undefined) =>
  JSON.stringify([cleanKeys(a?.keys), String(a?.other || '').toLowerCase(), !!a?.severe]) === JSON.stringify([cleanKeys(b?.keys), String(b?.other || '').toLowerCase(), !!b?.severe]);

/** What a guest said they're allergic to, in their words ("peanuts and kiwi", "shellfish/sesame"): the major allergens
 *  it names, and every part that isn't one of them kept in their words (never dropped). */
export function allergyFromWords(said: string[], severe = false): Omit<OrderAllergy, 'by' | 'at'> | null | 'too_long' {
  const parts = said.flatMap((w) => String(w || '').split(/,|\/|&|\band\b|\bor\b/i)).map((x) => tidy(x, OTHER_KEEP + 1)).filter(Boolean);
  // (One part longer than an allergy is typed: never kept cut short.)
  if (parts.some((p) => p.length > OTHER_MAX)) return 'too_long';
  const keys: AllergenKey[] = []; const other: string[] = [];
  for (const p of parts) { const k = keysFromWords(p); if (k.length) keys.push(...k); if (!k.length || !isPlainAllergen(p)) other.push(p); }
  const m = mergeAllergy({ keys, other: null, severe }, { keys: [], other: Array.from(new Set(other)).join(', '), severe });
  // (More than an order keeps: never saved cut short; the team is told instead.)
  return m?.cut ? 'too_long' : m;
}
/** A part that is just an allergen's own name ("peanuts", "tree nut", "dairy"), so nothing more needs keeping in words. */
const PLAIN = /^(milk|dairy|eggs?|fish|shellfish|seafood|tree ?nuts?|nuts?|peanuts?|wheat|gluten|soy|soya|sesame)( allergy)?$/i;
const isPlainAllergen = (p: string) => PLAIN.test(p.trim());

/** As kept on the order: the same, or null. */
export const orderAllergyOf = (o: any): OrderAllergy | null => {
  const a = cleanOrderAllergy(o?.allergy, OTHER_KEEP);
  return a ? { ...a, by: String(o?.allergy?.by || '').slice(0, 60) || undefined, at: typeof o?.allergy?.at === 'string' ? o.allergy.at : undefined } : null;
};

/** "Peanuts, sesame, severe" for a chip; "" when none. */
export function allergyWords(a: Pick<OrderAllergy, 'keys' | 'other' | 'severe'> | null | undefined): string {
  if (!a) return '';
  const what = [...a.keys.map(allergenLabel), ...(a.other ? [a.other] : [])].join(', ');
  return what ? `${what}${a.severe ? ', severe' : ''}` : '';
}

/** The fields a kitchen ticket carries for the order's allergies and this dish (lib/kitchen allergyFlags reads them):
 *  each allergy and how serious, and what the menu says the dish contains of them. Nothing when there are none. */
export function ticketFields(a: OrderAllergy | null, item: any): { allergies?: any[]; contains?: string[] } {
  if (!a) return {};
  const as: TableAllergy = { id: 'order', seat: null, keys: a.keys, other: a.other, severe: a.severe, from: 'asked', by: a.by || 'Order', at: a.at || '' };
  const f = ticketAllergyFields([as], null, itemAllergens(item));
  return { allergies: f.allergies, contains: f.contains };
}

/** What a dish contains of the guest's allergens, by the menu (lib/allergens): the allergens, or 'unknown' when nobody has
 *  filled in what it contains (never "none"). An empty list: none of theirs. */
export function dishConflict(item: { allergens?: unknown; allergensSet?: boolean } | null | undefined, a: Pick<OrderAllergy, 'keys'> | null | undefined): AllergenKey[] | 'unknown' {
  if (!a || !a.keys.length) return [];
  const known = item && (item.allergensSet === true || (item.allergensSet === undefined && allergensKnown(item)));
  if (!known) return 'unknown';
  const mine = new Set(a.keys); return cleanKeys(item!.allergens).filter((k) => mine.has(k));
}

/** "Contains peanuts", or, when the menu doesn't say what it contains, a word for whoever is ordering: the guest (the
 *  kitchen sees their allergy on the ticket) or the team (check with the kitchen). '' when it's clear. */
export function conflictWords(c: AllergenKey[] | 'unknown', a: Pick<OrderAllergy, 'keys'> | null | undefined, who: 'guest' | 'team' = 'team'): string {
  if (c === 'unknown') return a && a.keys.length ? (who === 'guest' ? 'Its allergens aren’t listed. The kitchen sees your allergy on the ticket.' : `Allergens not listed: check ${wordsList(a.keys)} with the kitchen`) : '';
  return c.length ? `Contains ${wordsList(c)}` : '';
}

/** "Contains milk, wheat" for a dish on a menu (what it says it contains); null when nobody has filled it in. */
export function containsLine(item: { allergens?: unknown; allergensSet?: boolean } | null | undefined): string | null {
  const known = item && (item.allergensSet === true || (item.allergensSet === undefined && allergensKnown(item)));
  if (!known) return null;
  const k = cleanKeys(item!.allergens);
  // (What's listed is the dish itself: a choice, a sauce or a swap can add one, which the guest is told on the dish.)
  return k.length ? `Contains ${wordsList(k)}` : 'None of the major allergens listed';
}
