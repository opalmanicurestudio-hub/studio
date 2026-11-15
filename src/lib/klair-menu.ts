// src/lib/klair-menu.ts — KLAIR ANSWERS GUESTS' MENU QUESTIONS (design canvas "Klair at the table"; lib/klair). On the
// table's page and ordering ahead, when the business turns it on: "Is the soup gluten-free?", "What's in the crudo?",
// "What can I have without nuts?". Answered only from the business's own recipes and the allergens it has marked on each
// dish, by matching dish names and allergen words. Nothing is guessed: a dish whose allergens nobody has marked is
// "please ask your server", likely allergens from a starter menu are never used, and anything else (vegan, spicy, how
// it's cooked) goes to the server. Every allergen answer says to tell the server about an allergy. Pure.
import { ALLERGENS, allergenWord, keysFromWords, type AllergenKey } from '@/lib/allergens';

export type MenuFact = { id: string; name: string; allergens: AllergenKey[]; allergensSet: boolean; recipe: string[]; soldOut: boolean };
export type MenuAnswer = { kind: 'dish' | 'list' | 'cant' | 'help'; text: string; tell: boolean };
export const MAX_QUESTION = 200;
export const TELL_SERVER = 'Kitchens share equipment, so tell your server about any allergy. It goes on every ticket.';
/** Ordering ahead has no server: the team. */
export const TELL_TEAM = 'Kitchens share equipment, so if you have an allergy, check with the team before you order.';
export type Who = 'server' | 'team';
const ASK = (w: Who) => (w === 'server' ? 'Please ask your server.' : 'Please ask the team.');
const CHECK = (w: Who) => `I can’t tell that from our recipes. ${w === 'server' ? 'Your server' : 'The team'} can check with the kitchen.`;

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sing = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const SKIP = new Set(['the', 'and', 'with', 'for', 'our', 'your', 'house', 'free', 'any', 'have', 'has', 'what', 'whats', 'which', 'there', 'does', 'this', 'that', 'can', 'are', 'some', 'side', 'plate', 'dish', 'menu']);
const sig = (s: string) => norm(s).split(' ').filter((w) => w.length >= 3 && !SKIP.has(w)).map(sing);

/** Dishes the question names. `full`: those whose every word is in the question (the most words first); `partial`: all
 *  those sharing a word with it, most first. Only a dish named in full ever gets an answer about what's in it. */
export function dishesIn(q: string, facts: MenuFact[]): { full: MenuFact[]; partial: MenuFact[] } {
  const asked = new Set(sig(q)); if (!asked.size) return { full: [], partial: [] };
  const scored = facts.map((f) => { const n = sig(f.name); const hit = n.filter((w) => asked.has(w)).length; return { f, hit, full: n.length > 0 && hit === n.length }; }).filter((x) => x.hit > 0)
    .sort((x, y) => y.hit - x.hit || x.f.name.localeCompare(y.f.name));
  const full = scored.filter((x) => x.full); const best = Math.max(0, ...full.map((x) => x.hit));
  return { full: full.filter((x) => x.hit === best).map((x) => x.f), partial: scored.map((x) => x.f) };
}
/** "What can I have without nuts?", "Which dishes are gluten-free?": a list. */
const LISTY = /\b(without|what can i|which|anything|options|free of|safe for)\b/;
/** Asking about something in a dish (an allergy, an ingredient): "does it have", "allergic to", "free of". */
const ASKS_IN = /\b(allergic|allergy|allergies|intolerant|intolerance|contain|contains|containing|free|without|avoid|safe|have|has|any)\b/;
/** Words that are only the asking. */
const FILLER = new Set(('is the a an of in it its to i im am are be can could does do did you your we our my me there this that what whats which how much many or and if ' +
  'eat eaten eating please thanks thank hi hello ok okay dish dishes menu food something anything made for on at so just also really would will get order ordering like want ' +
  'one ones today tonight special item items here kind type sort side plate serve served come comes go goes with from use used uses inside put need know tell sure isnt doesnt ' +
  'dont s t allergic allergy allergies intolerant intolerance contain contains containing free without avoid safe have has any no not tree pine brazil nut nuts kid kids child son daughter ' +
  'someone somebody anyone anybody person people him her them she they who whos someones friend wife husband partner').split(' '));
const isAllergenWord = (w: string) => keysFromWords(w).length > 0;
/** What the question asks about besides the dish names and the asking: an ingredient ("mustard"), or a word that says
 *  it's a different dish ("sandwich" in "the chicken sandwich" when the menu has "Chicken"). */
const otherWords = (n: string, dishNames: string[]) => {
  const named = new Set(dishNames.flatMap((d) => norm(d).split(' ')));
  return Array.from(new Set(n.split(' ').filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !named.has(w) && !named.has(sing(w)) && !FILLER.has(w) && !isAllergenWord(w))));
};
const TRACKED = `${ALLERGENS.slice(0, -1).map((a) => allergenWord(a.key)).join(', ')} and ${allergenWord(ALLERGENS[ALLERGENS.length - 1].key)}`;
const didYouMean = (list: MenuFact[]) => { const names = list.map((d) => d.name); const shown = names.slice(0, 6);
  return `I couldn’t find that exact dish. Did you mean ${shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} or ${shown[shown.length - 1]}`}${names.length > shown.length ? ` (or ${names.length - shown.length} more)` : ''}? Ask again with its full name.`; };

/** "gluten or wheat", "milk". */
const orWords = (keys: AllergenKey[]) => { const w = keys.map(allergenWord); return w.length <= 1 ? w.join('') : `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]}`; };
const andWords = (keys: AllergenKey[]) => { const w = keys.map(allergenWord); return w.length <= 1 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`; };
const listNames = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Things only a person can answer: how it's cooked, diets, spice, what it goes with. */
const ONLY_A_PERSON = /\b(vegan|vegetarian|veggie|plant based|halal|kosher|keto|paleo|low carb|carbs?|calories?|spic(y|e)|hot|cooked|rare|fried|grilled|organic|local|fresh|frozen|sugar|salt|portion|size|big|recommend|best|good|popular)\b/;

/** The answer to one question. */
export function menuAnswer(question: string, facts: MenuFact[], who: Who = 'server'): MenuAnswer {
  const q = String(question || '').slice(0, MAX_QUESTION); const n = norm(q);
  if (!n) return { kind: 'help', text: 'Ask about a dish, like “Is the soup gluten-free?” or “What’s in the burger?”', tell: false };
  // (Gluten before wheat: it's what people ask about.)
  const keys = keysFromWords(q).sort((a, b) => (a === 'gluten' ? -1 : b === 'gluten' ? 1 : 0));
  const asksIn = keys.length > 0 || ASKS_IN.test(n);
  const listAll = (): MenuAnswer => {
    // "What can I have without nuts?": only dishes whose allergens are marked, and not sold out.
    const ok = facts.filter((f) => f.allergensSet && !f.soldOut && !keys.some((k) => f.allergens.includes(k)));
    if (!ok.length) return { kind: 'list', text: `Nothing on the menu is marked as free of ${orWords(keys)}. ${ASK(who)}`, tell: true };
    const names = ok.map((f) => f.name).slice(0, 12);
    return { kind: 'list', text: `These list no ${orWords(keys)}: ${names.join(', ')}${ok.length > names.length ? `, and ${ok.length - names.length} more` : ''}. Dishes without allergens marked aren’t included.`, tell: true };
  };
  const found = dishesIn(q, facts);
  if (found.full.length) {
    const dishes = found.full.slice(0, 3);
    const extra = otherWords(n, dishes.map((d) => d.name));
    const rest = extra.join(' ');
    // Asked about something the allergen marks don't cover ("mustard"): only what its recipe says, never a verdict.
    if (!keys.length && asksIn && extra.length && !ONLY_A_PERSON.test(rest)) {
      const lists = dishes.flatMap((d) => d.recipe.filter((r) => extra.some((w) => new RegExp(`\\b${w}`, 'i').test(norm(r)))).slice(0, 2).map((r) => `${d.name}’s recipe lists ${r.toLowerCase()}.`));
      return { kind: 'cant', text: `${lists.join(' ')}${lists.length ? ' ' : ''}Our allergen marks cover only ${TRACKED}, so I can’t say about ${extra.slice(0, 2).join(' ')}. ${ASK(who)}`, tell: true };
    }
    // More words than the dish's name ("the chicken sandwich" when the menu has "Chicken"): it may be another dish.
    if (extra.length && !ONLY_A_PERSON.test(rest)) return { kind: 'cant', text: didYouMean(Array.from(new Set([...dishes, ...found.partial]))), tell: asksIn };
    const parts = dishes.map((d) => {
      if (keys.length) {
        if (!d.allergensSet) return `We haven’t marked the allergens in ${d.name} here, so I can’t say.`;
        const has = keys.filter((k) => d.allergens.includes(k));
        // What else was asked and isn't there (wheat and gluten go together: one there means neither is "absent").
        const grain = has.includes('wheat') || has.includes('gluten');
        const absent = keys.filter((k) => !has.includes(k) && !(grain && (k === 'wheat' || k === 'gluten')));
        return has.length ? `${d.name} contains ${andWords(has)}.${absent.length ? ` It lists no ${orWords(absent)}.` : ''}` : `${d.name} lists no ${orWords(keys)} among its allergens.`;
      }
      if (ONLY_A_PERSON.test(rest)) return '';
      const made = d.recipe.length ? `${d.name} is made with ${listNames(d.recipe.map((x) => x.toLowerCase()))}.` : `I don’t have the recipe for ${d.name} here.`;
      const al = !d.allergensSet ? '' : d.allergens.length ? ` It contains ${andWords(d.allergens)}.` : ' It lists none of the major allergens.';
      return `${made}${al}`;
    }).filter(Boolean);
    if (!parts.length) return { kind: 'cant', text: CHECK(who), tell: false };
    const unsure = dishes.some((d) => keys.length ? !d.allergensSet : !d.recipe.length);
    return { kind: 'dish', text: `${parts.join(' ')}${unsure ? ` ${ASK(who)}` : ''}`, tell: keys.length > 0 || dishes.some((d) => d.allergensSet && d.allergens.length > 0) };
  }
  // Only part of a dish's name: never an answer about a dish they may not mean.
  if (found.partial.length && !(keys.length && LISTY.test(n))) return { kind: 'cant', text: didYouMean(found.partial), tell: asksIn };
  if (keys.length) return listAll();
  const extra = otherWords(n, []);
  if (asksIn && extra.length && !ONLY_A_PERSON.test(n)) return { kind: 'cant', text: `Our allergen marks cover only ${TRACKED}, so I can’t say which dishes have ${extra.slice(0, 2).join(' ')}. ${ASK(who)}`, tell: true };
  if (ONLY_A_PERSON.test(n)) return { kind: 'cant', text: CHECK(who), tell: false };
  return { kind: 'help', text: `I can tell you what’s in a dish and which allergens it lists. Try “Is the soup gluten-free?” For anything else, ${ASK(who).toLowerCase()}`, tell: false };
}

/** The menu as the answers see it (only what's on the menu for everyone). */
export function menuFacts(menu: { id: string; name: string; onMenu: boolean; membersOnly: boolean; soldOut: boolean; inStock: boolean; allergens: AllergenKey[]; allergensSet: boolean; recipe?: string[] }[]): MenuFact[] {
  return (Array.isArray(menu) ? menu : []).filter((m) => m && m.onMenu && !m.membersOnly)
    .map((m) => ({ id: m.id, name: m.name, allergens: m.allergens.filter((k) => ALLERGENS.some((a) => a.key === k)), allergensSet: !!m.allergensSet, recipe: Array.isArray(m.recipe) ? m.recipe.slice(0, 12) : [], soldOut: !!m.soldOut || !m.inStock }));
}

/** Klair's settings for guests: on only with the assistant on and the business's say-so. */
export const menuAnswersOn = (tenant: any, klairOn: boolean) => klairOn && tenant?.klair?.menuAnswers === true;
