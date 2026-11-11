// src/lib/voice-order.ts — TAKING AN ORDER BY VOICE (pure; L21). The drive-thru's voice assistant hears "a double
// cheeseburger with no onions and a large fries", and its tools (api/counter/assistant) turn that into menu lines here:
// which item was meant, which of its choices, and what still has to be asked ("Which size: small, medium or large?").
// Nothing is guessed that the guest didn't say: two items that both fit is a question back, never a pick, and a choice
// the item must have (a size) is asked for rather than filled in. Prices always come from the menu (lib/menu-choices).
import { choiceGroups, type Picks } from '@/lib/menu-choices';

type MenuLike = { id: string; name: string; section: string; price: number; from?: boolean; startPrice?: number; choices: any[]; soldOut: boolean; onMenu: boolean; membersOnly: boolean; inStock: boolean };

const STOP = new Set(['a', 'an', 'the', 'some', 'of', 'with', 'and', 'please', 'order', 'one', 'my', 'me', 'i', 'want', 'get', 'can', 'have', 'like', 'would', 'd', 'id', 'just']);
/** Words for matching: lower case, no punctuation, simple plurals made single ("fries" stays: it's in the menu that way). */
export function words(s: string): string[] {
  return String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -1) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}
const key = (s: string) => words(s).filter((w) => !STOP.has(w)).join(' ');
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

/** What can be ordered here right now (on the menu, not for members only, in stock, not sold out). */
export const orderableNow = (m: MenuLike) => m.onMenu && !m.membersOnly && m.inStock && !m.soldOut;

/** The menu as the assistant reads it: each section's items with prices and choices, and what's sold out right now. */
export function menuForVoice(menu: MenuLike[]): string {
  const live = menu.filter(orderableNow);
  const sections = Array.from(new Set(live.map((m) => m.section)));
  const lines = sections.map((s) => `${s}: ${live.filter((m) => m.section === s).map((m) => {
    const groups = choiceGroups(m).map((g) => `${g.name}${g.required ? ' (must choose one)' : ''}: ${g.options.filter((o) => !o.soldOut).map((o) => `${o.name}${o.price ? ` ${o.price > 0 ? '+' : '-'}${money(Math.abs(o.price))}` : ''}`).join(', ')}`);
    return `${m.name} ${money(m.price)}${groups.length ? ` [${groups.join('; ')}]` : ''}`;
  }).join('. ')}.`);
  const out = menu.filter((m) => m.onMenu && !m.membersOnly && (!m.inStock || m.soldOut)).map((m) => m.name);
  return [...lines, out.length ? `Sold out right now: ${out.join(', ')}.` : ''].filter(Boolean).join('\n');
}

/** Which item was meant. One clear match, or the few it could be (a question back), or nothing on the menu. */
export function matchItem<T extends MenuLike>(menu: T[], spoken: string): { item: T } | { ambiguous: T[] } | { none: true; soldOut?: T } {
  const want = key(spoken); if (!want) return { none: true };
  const all = menu.filter((m) => m.onMenu && !m.membersOnly);
  const exact = all.filter((m) => key(m.name) === want);
  const pickLive = (list: T[]) => list.filter(orderableNow);
  if (exact.length) { const l = pickLive(exact); return l.length === 1 ? { item: l[0] } : l.length > 1 ? { ambiguous: l } : { none: true, soldOut: exact[0] }; }
  // Every word of the menu name heard ("double burger" in "double burger with cheese"), or every word heard in the name.
  const w = new Set(want.split(' '));
  const scored = all.map((m) => { const n = key(m.name).split(' ').filter(Boolean); const hit = n.filter((x) => w.has(x)).length; return { m, hit, full: hit === n.length, cover: hit / Math.max(1, w.size) }; })
    .filter((x) => x.hit > 0);
  const full = scored.filter((x) => x.full).sort((a, b) => b.hit - a.hit);
  if (full.length) {
    const best = full.filter((x) => x.hit === full[0].hit).map((x) => x.m);
    const l = pickLive(best); return l.length === 1 ? { item: l[0] } : l.length > 1 ? { ambiguous: l } : { none: true, soldOut: best[0] };
  }
  const part = scored.filter((x) => x.cover >= 0.5).sort((a, b) => b.hit - a.hit);
  if (!part.length) return { none: true };
  const best = part.filter((x) => x.hit === part[0].hit).map((x) => x.m);
  const l = pickLive(best); return l.length === 1 ? { item: l[0] } : l.length > 1 ? { ambiguous: l.slice(0, 4) } : { none: true, soldOut: best[0] };
}

const NEGATE = new Set(['no', 'without', 'hold', 'minus', 'skip', 'nix']);
const content = (s: string) => words(s).filter((w) => !STOP.has(w) && !NEGATE.has(w));
const negated = (s: string) => words(s).some((w) => NEGATE.has(w));

/** The choices that were said, as picks for the item; what it still needs asked; anything said that it doesn't have;
 *  and anything that fits more than one option (asked about, never guessed). An option matches only when it says the
 *  same thing: "no onions" is never the Onions extra, and "large" is never "Extra large". Leaving out something the
 *  item doesn't come with anyway ("no cheese" on a burger whose cheese is an extra) is simply nothing to do. */
export function matchChoices(item: any, said: string[]): { picks: Picks; ask: { group: string; options: string[] } | null; unknown: string[]; soldOut: string[]; unsure: { said: string; options: string[] }[] } {
  const groups = choiceGroups(item);
  const picks: Picks = {}; const unknown: string[] = []; const soldOut: string[] = []; const unsure: { said: string; options: string[] }[] = [];
  const all = groups.flatMap((g) => g.options.map((o) => ({ g, o, words: content(o.name), neg: negated(o.name) })));
  for (const raw of said.map((x) => String(x || '').trim()).filter(Boolean)) {
    const heard = content(raw); const neg = negated(raw);
    if (!heard.length) continue;
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((w) => b.includes(w));
    // The same words, and the same sense (both "no ..." or neither).
    let hits = all.filter((x) => x.neg === neg && same(x.words, heard));
    // Otherwise every word of the option was heard ("extra large cup" for "Extra large"), the fullest option winning.
    if (!hits.length) {
      const part = all.filter((x) => x.neg === neg && x.words.length && x.words.every((w) => heard.includes(w)));
      const most = Math.max(0, ...part.map((x) => x.words.length));
      hits = part.filter((x) => x.words.length === most);
    }
    if (hits.length > 1) { unsure.push({ said: raw, options: hits.map((x) => x.o.name) }); continue; }
    if (!hits.length) {
      // "No cheese" where cheese is only an extra: nothing to leave out.
      if (neg && all.some((x) => !x.neg && same(x.words, heard))) continue;
      unknown.push(raw); continue;
    }
    const { g, o } = hits[0];
    if (o.soldOut) { soldOut.push(o.name); continue; }
    picks[g.id] = g.pick === 'one' ? [o.id] : Array.from(new Set([...(picks[g.id] || []), o.id])).slice(0, g.max);
  }
  const missing = groups.find((g) => g.required && !(picks[g.id] || []).length && g.options.some((o) => !o.soldOut));
  return { picks, ask: missing ? { group: missing.name, options: missing.options.filter((o) => !o.soldOut).map((o) => o.name) } : null, unknown, soldOut, unsure };
}

/** "Which size: small, medium or large?" */
export const askFor = (a: { group: string; options: string[] }) => a.options.length === 1
  ? `${a.options[0]} is the only ${a.group.toLowerCase()} left right now. Is that okay?`
  : `Which ${a.group.toLowerCase()}: ${a.options.slice(0, -1).join(', ')} or ${a.options[a.options.length - 1]}?`;
