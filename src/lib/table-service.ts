// src/lib/table-service.ts — TABLE SERVICE RULES, the same on every screen and on the server (api/tab, api/kitchen,
// api/checkout/complete, the table's tab, the kitchen screen's expo view). Pure: no database here.
// - Courses: what a table orders goes out course by course. A course marked "hold" waits until the server fires it; the
//   kitchen sees it coming but doesn't start it. An item's course is its own setting, else its menu section's name
//   (Mains, Entrées…), else none: it goes to the kitchen right away.
// - Stations: each item is made at one station (Kitchen, Bar, Grill…), so each station's screen shows only its own.
// - Comps and voids: a comp is served and kept, at no charge or part off; a void comes off the check. A comp within the
//   server's own nightly allowance needs no PIN; over it, a manager's. A void before the kitchen starts needs only a
//   reason; after it starts, a manager's PIN, and what it cost to make counts as waste. A manager acts on their own say.
// - Finishing together: a table's course (or a counter order) is timed so its plates are done at once. The slowest
//   dish starts when it's fired; each quicker one starts later, by the difference in make times.

export type Course = { n: number; name: string; hold: boolean };
export const DEFAULT_COURSES: Course[] = [
  { n: 1, name: 'Drinks', hold: false },
  { n: 2, name: 'Starters', hold: false },
  { n: 3, name: 'Mains', hold: true },
  { n: 4, name: 'Dessert', hold: true },
];
export const DEFAULT_STATIONS = ['Kitchen', 'Bar'];
export const MAX_COURSES = 6, MAX_STATIONS = 12, NAME_MAX = 24;
export const DEFAULT_COMP_ALLOWANCE_CENTS = 1000;
export const MAX_COMP_ALLOWANCE_CENTS = 50000;
export const COMP_REASONS = ['Took too long', 'Not right', 'A regular', 'Our mistake', 'Celebration'];
export const VOID_REASONS = ['Rung in by mistake', 'Changed their mind', 'Sent back', 'Dropped or spilled'];
export const REMAKE_REASONS = ['Dropped or spilled', 'Not right', 'Wrong order'];
export const OTHER_REASON = 'Something else';

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const key = (v: unknown) => clean(v).toLowerCase().replace(/[’']/g, '').replace(/é/g, 'e').replace(/s$/, '');

/** The business's courses: its own list when it has a usable one, else the four everyone knows. Numbered in order. */
export function coursesOf(tenant: any): Course[] {
  const raw = tenant?.kitchenSettings?.courses;
  if (!Array.isArray(raw)) return DEFAULT_COURSES;
  const seen = new Set<string>(); const out: Course[] = [];
  for (const c of raw.slice(0, MAX_COURSES)) {
    const name = clean(c?.name); const k = key(name);
    if (!name || seen.has(k)) continue; seen.add(k);
    out.push({ n: out.length + 1, name, hold: c?.hold === true });
  }
  return out.length ? out : DEFAULT_COURSES;
}

/** The business's stations (where things are made): its own list, else Kitchen and Bar. The first is where anything
 *  without a station goes. */
export function stationsOf(tenant: any): string[] {
  const raw = tenant?.kitchenSettings?.stations;
  if (!Array.isArray(raw)) return DEFAULT_STATIONS;
  const seen = new Set<string>(); const out: string[] = [];
  for (const s of raw.slice(0, MAX_STATIONS)) { const name = clean(s); const k = key(name); if (!name || seen.has(k)) continue; seen.add(k); out.push(name); }
  return out.length ? out : DEFAULT_STATIONS;
}

// The other names a menu section goes by, so "Entrées" finds Mains and "Appetizers" finds Starters.
const ALIASES: Record<string, string[]> = {
  drink: ['beverage', 'coffee', 'tea', 'cocktail', 'wine', 'beer', 'bar', 'juice', 'soft drink', 'hot drink', 'cold drink'],
  starter: ['appetizer', 'app', 'small plate', 'snack', 'share', 'to share', 'sharing'],
  main: ['entree', 'main course', 'large plate', 'plate', 'big plate'],
  dessert: ['sweet', 'pudding', 'after'],
};
const DRINKISH = /\b(drinks?|beverages?|coffee|teas?|cocktails?|wines?|beers?|bar|juices?|smoothies?|shakes?|lattes?|espresso|soda|lemonade)\b/i;

/** Which course an item belongs to: its own setting (a course number), else its section's name or one of that name's
 *  other names, else none (null: it goes to the kitchen right away). */
export function courseOfItem(item: any, courses: Course[]): Course | null {
  const own = Number(item?.course);
  if (Number.isInteger(own) && own >= 1) { const c = courses.find((x) => x.n === own); if (c) return c; }
  if (item?.course === 0) return null;   // set to "right away" on purpose
  const section = key(item?.section || item?.menuSection || item?.category || '');
  if (!section) return null;
  for (const c of courses) {
    const ck = key(c.name);
    if (ck === section) return c;
    const alts = ALIASES[ck] || [];
    if (alts.includes(section)) return c;
  }
  return null;
}

/** Where an item is made: its own station when it's one of the business's, else the bar for a drink when there is a
 *  bar, else the first station. */
export function stationOfItem(item: any, stations: string[]): string {
  const own = clean(item?.station);
  if (own) { const hit = stations.find((s) => key(s) === key(own)); if (hit) return hit; }
  const bar = stations.find((s) => key(s) === 'bar');
  const words = `${item?.section || ''} ${item?.menuSection || ''} ${item?.category || ''}`;
  if (bar && DRINKISH.test(words)) return bar;
  return stations[0] || DEFAULT_STATIONS[0];
}

/** The note on a drink a guest ordered from their wait link (lib/wait-line): it's on the tab, but the table hasn't
 *  ordered yet as far as the floor and the server's nudges go. */
export const PREORDER_NOTE = 'Ordered while waiting';

/** Whether an item is a drink, by its section's name (Drinks, Cocktails, Coffee, Wine…). */
export function isDrinkItem(item: any): boolean {
  return DRINKISH.test(`${item?.section || ''} ${item?.menuSection || ''} ${item?.category || ''}`);
}

/** How much a server may comp in a night on their own say, in cents. */
export function compAllowanceCents(tenant: any): number {
  const n = Math.round(Number(tenant?.kitchenSettings?.compAllowanceCents));
  return Number.isFinite(n) && n >= 0 ? Math.min(MAX_COMP_ALLOWANCE_CENTS, n) : DEFAULT_COMP_ALLOWANCE_CENTS;
}

/** The comp reasons offered: the business's own list when it has one, else the usual ones. "Something else" is always
 *  last, and asks for a few words. */
export function compReasonsOf(tenant: any): string[] {
  const raw = tenant?.kitchenSettings?.compReasons;
  const list = Array.isArray(raw) ? raw.map((r: unknown) => String(r ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 8) : [];
  return Array.from(new Set(list.length ? list : COMP_REASONS));
}

/** Whether a table is asked about allergies before its first order (lib/allergens): on unless the business turns it off
 *  (a bar that only pours, say). A regular's profile allergies are brought to the table either way. */
export const askAllergiesOf = (tenant: any): boolean => tenant?.kitchenSettings?.askAllergies !== false;

/** A kitchen ticket's status: has the kitchen started it? Waiting, not fired and cancelled haven't; being made, ready
 *  and served have. */
export const kitchenStarted = (status: unknown) => ['in_progress', 'ready', 'delivered', 'served'].includes(String(status || ''));

export type Need = { pin: boolean; why: string | null };
/** Does this comp or void need a manager's PIN? A manager never does (their own say). A comp does when it would take the
 *  server past their allowance tonight; a void does once the kitchen has started; a remake never does (it's logged). */
export function needsManager(a: { kind: 'comp' | 'void' | 'remake'; actorIsManager: boolean; amountCents?: number; usedTonightCents?: number; allowanceCents?: number; started?: boolean }): Need {
  if (a.actorIsManager) return { pin: false, why: null };
  if (a.kind === 'comp') {
    const over = Math.max(0, Math.round(a.usedTonightCents || 0)) + Math.max(0, Math.round(a.amountCents || 0)) > Math.max(0, Math.round(a.allowanceCents || 0));
    return over ? { pin: true, why: 'Over your allowance for tonight, so a manager approves.' } : { pin: false, why: null };
  }
  if (a.kind === 'void') return a.started ? { pin: true, why: 'The kitchen has started it, so a manager approves.' } : { pin: false, why: null };
  return { pin: false, why: null };
}

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** A tab line's list price (before any comp) and what it costs now. */
export const listPriceOf = (l: any) => round2(Number.isFinite(Number(l?.listPrice)) ? Number(l.listPrice) : Number(l?.price) || 0);

/** The longest make time among some items, in whole minutes (at least 1): "takes about 18 min once fired". */
export function prepMinutes(lines: { makeSeconds?: number | null }[]): number {
  const s = Math.max(0, ...lines.map((l) => Math.max(0, Number(l.makeSeconds) || 0)));
  return Math.max(1, Math.round(s / 60));
}

/** How a course on a table's tab stands, from its lines' kitchen tickets: not fired yet, at the kitchen, all ready, or
 *  all served. `statuses` maps a ticket id to its status (a line with no ticket, like a service, counts as served). */
export function courseStage(lines: { kdsId?: string | null; firedAt?: string | null }[], statuses: Record<string, string>): 'unfired' | 'cooking' | 'ready' | 'served' {
  const live = lines.map((l) => (l.kdsId ? String(statuses[l.kdsId] || (l.firedAt === null ? 'unfired' : 'pending')) : 'delivered')).filter((s) => s !== 'cancelled');
  if (!live.length) return 'served';
  if (live.some((s) => s === 'unfired')) return 'unfired';
  if (live.every((s) => s === 'delivered' || s === 'served')) return 'served';
  if (live.every((s) => s === 'ready' || s === 'delivered' || s === 'served')) return 'ready';
  return 'cooking';
}

/** A table's name as people say it: "Table 12" for a bare number, the name itself otherwise ("Patio 2"). */
export const tableLabel = (name: unknown) => { const s = String(name ?? '').trim(); return !s ? 'Table' : /^\d+[a-z]?$/i.test(s) ? `Table ${s}` : s; };

// ── Expo: each table's course (or each order) as one plate run ───────────────────────────────────────────────────────
export type ExpoTicket = { id: string; col: string; status: string; source: string; item: string; quantity: number; at: string; visitId?: string | null; course?: number | null; courseName?: string | null;
  eventId?: string | null; eventTitle?: string | null; courseNumber?: number | null; tableNumber?: string | null; seatNumber?: string | null; orderId?: string | null; orderNumber?: string | null; name: string;
  madeAt?: string | null; note?: string | null; dueAt?: string | null; firedAt?: string | null };
export type ExpoGroup = { key: string; label: string; sub: string; tickets: ExpoTicket[]; ready: number; total: number; allReady: boolean; at: string };

/** Tickets grouped the way they go out: a table's course together, an event table's course together, an order together;
 *  anything else on its own. The oldest first. */
export function expoGroups(tickets: ExpoTicket[]): ExpoGroup[] {
  const m = new Map<string, ExpoGroup>();
  for (const t of tickets) {
    if (!['pending', 'in_progress', 'ready'].includes(t.status)) continue;
    let k: string, label: string, sub: string;
    if (t.source === 'tab' && t.visitId) { k = `tab|${t.visitId}|${t.course ?? '-'}`; label = tableLabel(t.tableNumber); sub = t.courseName || 'Order'; }
    else if (t.eventId) { k = `event|${t.eventId}|${t.courseNumber ?? '-'}|${t.tableNumber || ''}`; label = t.tableNumber ? tableLabel(t.tableNumber) : (t.eventTitle || 'Event'); sub = `${t.eventTitle || 'Event'}${t.courseNumber !== null && t.courseNumber !== undefined ? `, course ${t.courseNumber}` : ''}`; }
    else if (t.orderId) { k = `order|${t.orderId}`; label = t.orderNumber ? `Order ${t.orderNumber}` : t.name; sub = t.name && t.orderNumber ? t.name : 'Order'; }
    else { k = `one|${t.col}|${t.id}`; label = t.name; sub = t.tableNumber ? tableLabel(t.tableNumber) : 'Order'; }
    const g = m.get(k) || { key: k, label, sub, tickets: [], ready: 0, total: 0, allReady: false, at: t.firedAt || t.at };
    g.tickets.push(t); g.total += 1; if (t.status === 'ready') g.ready += 1;
    const at = t.firedAt || t.at; if (at && (!g.at || at < g.at)) g.at = at;
    m.set(k, g);
  }
  return Array.from(m.values()).map((g) => ({ ...g, allReady: g.total > 0 && g.ready === g.total })).sort((a, b) => Number(b.allReady) - Number(a.allReady) || String(a.at).localeCompare(String(b.at)));
}

/** What's waiting to be fired, by table and course, for the expo and station screens: "Table 12, Dessert, 2". */
export function unfiredGroups(tickets: ExpoTicket[]): { key: string; label: string; course: string; count: number; at: string }[] {
  const m = new Map<string, { key: string; label: string; course: string; count: number; at: string }>();
  for (const t of tickets) {
    if (t.status !== 'unfired') continue;
    const k = `${t.visitId || t.id}|${t.course ?? '-'}`;
    const g = m.get(k) || { key: k, label: tableLabel(t.tableNumber), course: t.courseName || 'Later', count: 0, at: t.at };
    g.count += Math.max(1, Number(t.quantity) || 1); if (t.at < g.at) g.at = t.at; m.set(k, g);
  }
  return Array.from(m.values()).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** The visit a party's tab lives on: their booking's, their walk-in's, or a new table visit. */
export function visitIdForParty(p: any): string {
  const g: string[] = Array.isArray(p?.guestIds) ? p.guestIds : [];
  const appt = g.find((x) => String(x).startsWith('appt:')); if (appt) return appt.slice(5);
  const w = g.find((x) => String(x).startsWith('walkin:')); if (w) return `apt-walkin-${w.slice(7)}`;
  return `apt-party-${p.id}`;
}

// ── Finishing a table's plates together ──────────────────────────────────────────────────────────────────────────────
/** Whether the kitchen times a table's plates to finish together: on unless the business turns it off. */
export const finishTogetherOn = (tenant: any): boolean => tenant?.kitchenSettings?.finishTogether !== false;

export type StartTicket = { id: string; status: string; source: string; item: string; at: string; visitId?: string | null; course?: number | null; orderId?: string | null;
  makeSeconds?: number | null; firedAt?: string | null; remake?: boolean };
export type StartAt = { startAt: number; slowest: string; waitSeconds: number };
/** Plates fired within this of each other go out together (a later addition to the course is its own). */
const TOGETHER_MS = 60000;

/** When each waiting ticket should be started so its table's course (or its order) is done at once: the slowest dish
 *  still to make, fired with it, when it's fired; each quicker one later by the difference. A plate already made, a
 *  remake (someone's waiting for it) and a dish added later to the course aren't timed against, and a ticket on its
 *  own, or one already started, has no plan (start it now, as always). */
export function startPlan(tickets: StartTicket[]): Map<string, StartAt> {
  const groups = new Map<string, StartTicket[]>();
  for (const t of tickets) {
    if (!['pending', 'in_progress'].includes(t.status) || t.remake || !(Number(t.makeSeconds) > 0)) continue;
    const k = t.source === 'tab' && t.visitId ? `tab|${t.visitId}|${t.course ?? '-'}` : t.orderId ? `order|${t.orderId}` : null;
    if (!k) continue;
    const g = groups.get(k) || []; g.push(t); groups.set(k, g);
  }
  const fired = (t: StartTicket) => Date.parse(String(t.firedAt || t.at));
  const out = new Map<string, StartAt>();
  for (const g of groups.values()) {
    for (const t of g) {
      if (t.status !== 'pending') continue;
      const from = fired(t); if (!Number.isFinite(from)) continue;
      const mates = g.filter((x) => Math.abs(fired(x) - from) <= TOGETHER_MS);
      if (mates.length < 2) continue;
      const slow = mates.reduce((a, b2) => (Number(b2.makeSeconds) > Number(a.makeSeconds) ? b2 : a));
      if (slow.id === t.id) continue;
      const wait = Number(slow.makeSeconds) - Number(t.makeSeconds); if (wait <= 0) continue;
      out.set(t.id, { startAt: Math.max(from, fired(slow)) + wait * 1000, slowest: slow.item, waitSeconds: wait });
    }
  }
  return out;
}
/** "in 4 min", "now" */
export const startWords = (startAt: number, now: number) => { const s = Math.ceil((startAt - now) / 1000); return s <= 0 ? 'now' : s < 60 ? 'in under a minute' : `in ${Math.ceil(s / 60)} min`; };
