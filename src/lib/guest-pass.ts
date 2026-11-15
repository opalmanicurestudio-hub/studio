// src/lib/guest-pass.ts — THE GUEST PASS (design canvas "Guest pass"; api/table-pay; the page at bill/[tenantId]/[token]).
// One link for a table: the same one the check's code opens. While they're seated it shows where their order is, course
// by course (held until they're ready, ordered, being made, on its way, served), what the tab comes to so far, a way to
// ask for their server, water or the check without waving, a regular's usual, and paying or splitting when they're ready.
// It never shows anyone's name but the business's, and nothing about any other table. Pure.
import type { Course } from '@/lib/table-service';

export type ItemState = 'held' | 'ordered' | 'making' | 'on_way' | 'served';
export type PassItem = { name: string; seat: number | null; state: ItemState };
export type PassCourse = { n: number; name: string; state: ItemState; items: PassItem[] };
const RANK: Record<ItemState, number> = { making: 0, ordered: 1, on_way: 2, held: 3, served: 4 };

/** Where one thing on the tab is, from its kitchen ticket (null when the line isn't made in the kitchen). */
export function itemState(line: any, ticket: { status?: string } | null | undefined): ItemState | null {
  const st = String(ticket?.status || '');
  if (st === 'cancelled') return null;
  if (st === 'delivered' || st === 'served') return 'served';
  if (st === 'ready') return 'on_way';
  if (st === 'in_progress') return 'making';
  if (st === 'unfired' || (!line?.firedAt && line?.kdsId && (!ticket || !st))) return 'held';
  return 'ordered';
}

/** Their order, course by course, as it stands: each course says the least far along of what's in it (served only when
 *  everything is), and a course that's held says so until it's sent. Only what's made in the kitchen or at the bar. */
export function passCourses(tab: any[], tickets: Record<string, { status?: string } | undefined>, courses: Course[]): PassCourse[] {
  const by = new Map<number, PassCourse>();
  for (const l of Array.isArray(tab) ? tab : []) {
    if (!l || l.itemType === 'service') continue;
    const s = itemState(l, l.kdsId ? tickets[String(l.kdsId)] : null); if (!s) continue;
    const n = Number(l.course) || 0; const c = courses.find((x) => x.n === n);
    const g = by.get(n) || { n, name: c?.name || String(l.courseName || '') || (n ? `Course ${n}` : 'Your order'), state: 'served' as ItemState, items: [] };
    const seat = Number(l.seat); const qty = Math.max(1, Math.round(Number(l.quantity) || 1));
    for (let i = 0; i < Math.min(qty, 20); i++) g.items.push({ name: String(l.name || 'Item').slice(0, 80), seat: Number.isFinite(seat) && seat > 0 ? seat : null, state: s });
    by.set(n, g);
  }
  for (const g of by.values()) {
    const states = g.items.map((i) => i.state);
    g.state = states.every((s) => s === 'served') ? 'served' : states.every((s) => s === 'held') ? 'held' : states.filter((s) => s !== 'served').sort((a, b) => RANK[a] - RANK[b])[0];
  }
  return Array.from(by.values()).sort((a, b) => a.n - b.n);
}
export const STATE_WORDS: Record<ItemState, string> = { held: 'When you’re ready', ordered: 'Ordered', making: 'Being made', on_way: 'On its way', served: 'Served' };

/** What a guest can ask for from their phone. ('report' is "Something not right?", lib/table-recovery: it's kept with
 *  the asks so the server's phone shows it first, but it isn't asked for this way.) */
export type AskKind = 'server' | 'water' | 'check' | 'usual' | 'report';
export const ASKS: { value: Exclude<AskKind, 'usual'>; label: string }[] = [
  { value: 'server', label: 'Our server' }, { value: 'water', label: 'Water, please' }, { value: 'check', label: 'The check, please' },
];
export const ASK_KINDS: AskKind[] = ['server', 'water', 'check', 'usual'];
export const MAX_ASKS = 20;
/** One thing a table asked for, kept on the visit (guestAsks). */
export type GuestAsk = { id: string; what: AskKind; at: string; item?: string | null };
export const ASK_ID = /^[a-z0-9]{4,16}$/;

/** What the server's phone says (lib/nudges). */
export function askText(a: Pick<GuestAsk, 'what' | 'item'>, table: string): string {
  const t = table || 'A table';
  if (a.what === 'report') return `${t} says something isn’t right${a.item ? `: ${a.item}` : ''}. A manager should go over.`;
  return a.what === 'water' ? `${t} would like water.` : a.what === 'check' ? `${t} would like the check.` : a.what === 'usual' ? `${t} would like their usual${a.item ? `: ${a.item}` : ''}.` : `${t} is asking for their server.`;
}
/** What the guest sees once it's sent, and once someone has it ("Ana has it"). */
export function askSaid(a: Pick<GuestAsk, 'what' | 'item'>, seenBy: string | null): string {
  if (a.what === 'report') return seenBy ? `Thanks for telling us. ${seenBy} is coming over.` : 'Thanks for telling us. A manager is on the way.';
  const item = a.what === 'water' ? 'water' : a.what === 'check' ? 'the check' : a.what === 'usual' ? (a.item || 'your usual') : '';
  if (a.what === 'server') return seenBy ? `${seenBy} is on the way.` : 'We let your server know.';
  if (a.what === 'check') return seenBy ? `${seenBy} is bringing the check.` : 'We let your server know you’d like the check.';
  return seenBy ? `${item[0].toUpperCase()}${item.slice(1)} is on its way. ${seenBy} has it.` : `We let your server know you’d like ${item}.`;
}
/** Marked done by the server (lib/nudges keeps it on the party): someone has it. Put off a few minutes isn't done. */
export const askSeen = (a: GuestAsk, done: Record<string, { at?: string; until?: string | null; by?: string } | undefined>) => { const d = done?.[`ask:${a.id}`]; return !!d && !d.until; };
export const askOpen = (a: GuestAsk, done: Record<string, any>) => !askSeen(a, done);
/** Asked again while the last one of the same kind is still open: nothing new (a tap twice is one ask). */
export const openOfKind = (asks: GuestAsk[], what: AskKind, done: Record<string, any>) => asks.find((a) => a.what === what && askOpen(a, done)) || null;
/** A first name, for "Ana has it" (never a full name on a guest's phone). */
export const firstName = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0]?.slice(0, 30) || '';
