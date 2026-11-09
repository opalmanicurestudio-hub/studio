// src/lib/event-guest-link.ts — WHAT A GUEST CAN DO FROM AN EVENT'S LINKS, decided on the server (api/public/event).
// Three guest pages hang off an event, none of them signed in:
//   /event/{business}/{event}          the event's page: reserve a place on its guest list
//   /event/{business}/{event}/rsvp     the meal order page: choose a meal (per course), say what to avoid, give a table
//   /request/{business}/{event}/{table}/{seat}   the QR code at a seat: ask the floor team for water, napkins and so on
// Everything lands on the lists the business already works from: the event's guest list (eventGuests, the manifest and
// seating chart) and the floor board (floorRequests). The PIN on a private event is checked here and never sent to a
// browser, and nothing about other guests leaves the server.

/** What a guest can tell the kitchen about, and how serious each one is (the manifest and kitchen tickets read the
 *  severity: 'critical' is flagged on every ticket). */
export const ALLERGY_CHOICES = [
  { id: 'peanuts', label: 'Peanuts', severity: 'critical' },
  { id: 'nuts', label: 'Tree nuts', severity: 'critical' },
  { id: 'shellfish', label: 'Shellfish', severity: 'critical' },
  { id: 'fish', label: 'Fish', severity: 'critical' },
  { id: 'eggs', label: 'Eggs', severity: 'critical' },
  { id: 'gluten', label: 'Gluten', severity: 'intolerance' },
  { id: 'dairy', label: 'Dairy', severity: 'intolerance' },
  { id: 'soy', label: 'Soy', severity: 'intolerance' },
  { id: 'vegan', label: 'Vegan', severity: 'preference' },
  { id: 'vegetarian', label: 'Vegetarian', severity: 'preference' },
  { id: 'kosher', label: 'Kosher', severity: 'preference' },
  { id: 'halal', label: 'Halal', severity: 'preference' },
] as const;
export const SEVERITY_LABEL: Record<string, string> = { critical: 'Severe allergies', intolerance: 'Intolerances', preference: 'Diets' };

/** What a seat's QR code can ask for when the business hasn't set its own list. 'note' ones open a box to say more. */
export const DEFAULT_REQUEST_TYPES = [
  { id: 'water', label: 'Water refill' },
  { id: 'napkins', label: 'Napkins' },
  { id: 'utensils', label: 'Utensils' },
  { id: 'condiments', label: 'Condiments' },
  { id: 'ice', label: 'More ice' },
  { id: 'menu', label: 'A question about the menu' },
  { id: 'temp', label: 'Temperature' },
  { id: 'spill', label: 'A spill to clean up' },
  { id: 'other', label: 'Something else' },
];
const NOTE_TYPES = new Set(['menu', 'other']);

/** The requests a seat can make: the event's own list, else the business's, else ours. Labels only (the floor board
 *  prints the label; what the guest types goes in the note under it). */
export function requestTypesFor(ev: any, tenant: any): { id: string; label: string; note: boolean }[] {
  const pick = (list: any) => (Array.isArray(list) ? list : []).filter((t: any) => t && t.enabled !== false && typeof t.id === 'string' && t.id && typeof t.label === 'string' && t.label.trim());
  const own = pick(ev?.requestTypes); const biz = pick(tenant?.defaultRequestTypes);
  const list = own.length ? own : biz.length ? biz : DEFAULT_REQUEST_TYPES;
  return list.slice(0, 24).map((t: any) => ({ id: String(t.id).slice(0, 40), label: String(t.label).trim().slice(0, 60), note: NOTE_TYPES.has(String(t.id)) }));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Where the event stands for its guests: still to come, cancelled, or over. `today` is the business's own date. */
export function eventState(ev: any, today: string): 'open' | 'cancelled' | 'over' {
  const status = String(ev?.status || 'upcoming');
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed' || !DAY.test(String(ev?.date || '')) || String(ev.date) < today) return 'over';
  return 'open';
}

/** Why the event's page can't take a reservation, or null when it can. A paid or invitation-only event is arranged
 *  with the business, never reserved free from a link. */
export function reserveBlock(ev: any, today: string): string | null {
  const s = eventState(ev, today);
  if (s === 'cancelled') return 'This event has been canceled.';
  if (s === 'over') return 'This event has already happened.';
  if (ev?.ticketingConfig?.type === 'comp_only' || Number(ev?.ticketingConfig?.price) > 0) return 'Places for this event are arranged with the business directly.';
  return null;
}

/** Why the meal order page can't take an order, or null when it can (it closes at the order deadline the business set). */
export function orderBlock(ev: any, today: string, now = new Date()): string | null {
  const s = eventState(ev, today);
  if (s === 'cancelled') return 'This event has been canceled.';
  if (s === 'over') return 'This event has already happened.';
  const dl = ev?.orderingDeadline ? new Date(ev.orderingDeadline) : null;
  if (dl && !isNaN(dl.getTime()) && now.getTime() > dl.getTime()) return 'Meal orders for this event have closed.';
  return null;
}

/** Whether a seat can call the floor team now: on the day of the event (or the night after, for events that run past
 *  midnight), unless it's been cancelled or marked finished. */
export function requestOpen(ev: any, today: string, yesterday: string): boolean {
  const status = String(ev?.status || 'upcoming'); const d = String(ev?.date || '');
  return status !== 'cancelled' && status !== 'completed' && (d === today || d === yesterday);
}

const COURSE_NAMES: Record<number, string> = { 1: 'Starters', 2: 'Mains', 3: 'Desserts' };
/** A course's name, as the manifest names it. */
export const courseName = (n: number) => COURSE_NAMES[n] || `Course ${n}`;

/** The menu as courses, in order, with what a guest may see of each dish (never its cost, supplies or stock). */
export function menuCourses(items: any[]): { number: number; name: string; items: { id: string; name: string; description: string | null; vegan: boolean; glutenFree: boolean; imageUrl: string | null }[] }[] {
  const by = new Map<number, any[]>();
  for (const m of items || []) {
    if (!m || !m.id || !String(m.name || '').trim()) continue;
    const n = Math.max(1, Math.floor(Number(m.courseNumber) || 1));
    if (!by.has(n)) by.set(n, []);
    by.get(n)!.push({ id: String(m.id), name: String(m.name).trim().slice(0, 80), description: m.description ? String(m.description).slice(0, 280) : null,
      vegan: m.isVegan === true, glutenFree: m.isGlutenFree === true, imageUrl: typeof m.imageUrl === 'string' && /^https:\/\//.test(m.imageUrl) ? m.imageUrl : null });
  }
  return [...by.keys()].sort((a, b) => a - b).map((n) => ({ number: n, name: courseName(n), items: by.get(n)!.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** The seating chart's tables and seats, by name (what a guest picks and what the manifest stores). */
export function chartTables(ev: any): { id: string; name: string; seats: { id: string; label: string }[] }[] {
  return (Array.isArray(ev?.seatingTables) ? ev.seatingTables : []).filter((t: any) => t && t.id && String(t.name || '').trim())
    .map((t: any) => ({ id: String(t.id), name: String(t.name).trim().slice(0, 40), seats: (Array.isArray(t.seats) ? t.seats : []).filter((s: any) => s && s.id && String(s.label || '').trim()).map((s: any) => ({ id: String(s.id), label: String(s.label).trim().slice(0, 12) })) }));
}

/** A seat's table and label from the QR code's ids, or null when the chart no longer has it. */
export function findSeat(ev: any, tableId: string, seatId: string): { table: { id: string; name: string }; seat: { id: string; label: string } } | null {
  const t = chartTables(ev).find((x) => x.id === tableId); const s = t?.seats.find((x) => x.id === seatId);
  return t && s ? { table: { id: t.id, name: t.name }, seat: s } : null;
}

/** Checks a guest's meal choices against the menu: one dish per course, each from its own course. Returns what to
 *  store (the first course's dish is also the guest's meal, as the manifest reads it), or the problem. */
export function mealChoices(courses: ReturnType<typeof menuCourses>, picks: any): { ok: true; courseSelections: Record<string, string> | null; mealChoiceId: string | null; mealChoiceName: string | null } | { ok: false; error: string } {
  if (!courses.length) return { ok: true, courseSelections: null, mealChoiceId: null, mealChoiceName: null };
  const sel: Record<string, string> = {};
  for (const c of courses) {
    const id = String(picks?.[c.number] ?? picks?.[String(c.number)] ?? '');
    if (!id) return { ok: false, error: courses.length === 1 ? 'Choose your meal.' : `Choose your ${c.name.toLowerCase()}.` };
    if (!c.items.some((i) => i.id === id)) return { ok: false, error: 'That dish isn’t on the menu anymore. Please choose again.' };
    sel[String(c.number)] = id;
  }
  const first = courses[0]; const firstItem = first.items.find((i) => i.id === sel[String(first.number)])!;
  return { ok: true, courseSelections: sel, mealChoiceId: firstItem.id, mealChoiceName: firstItem.name };
}

/** The allergies a guest ticked, as the manifest stores them (unknown ids dropped). */
export function allergyList(ids: any): { id: string; label: string; severity: string }[] {
  const want = new Set((Array.isArray(ids) ? ids : []).map((x: any) => String(x)));
  return ALLERGY_CHOICES.filter((a) => want.has(a.id)).map((a) => ({ id: a.id, label: a.label, severity: a.severity }));
}

/** Which guest on the list a meal order belongs to. By email first; else, by name, a guest the host added without an
 *  email; else a new guest. A guest who reserved (and so has an email) and orders by name alone is asked for that email
 *  rather than added twice. An order already made is never replaced from the link (the host changes it), so a second
 *  order for the same person says so instead. */
export function matchGuest(list: { id: string; name?: string; email?: string; mealChoiceId?: string | null; courseSelections?: any }[], name: string, email: string):
  { kind: 'update'; id: string } | { kind: 'already' } | { kind: 'needEmail' } | { kind: 'new' } {
  const ordered = (g: any) => !!(g.mealChoiceId || (g.courseSelections && Object.keys(g.courseSelections).length) || g.orderedAt);
  const em = email.trim().toLowerCase(); const nm = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const hasEmail = (g: any) => !!String(g.email || '').trim();
  const sameName = list.filter((g) => String(g.name || '').trim().toLowerCase().replace(/\s+/g, ' ') === nm);
  if (em) {
    const byEmail = list.find((g) => String(g.email || '').trim().toLowerCase() === em);
    if (byEmail) return ordered(byEmail) ? { kind: 'already' } : { kind: 'update', id: byEmail.id };
    const added = sameName.find((g) => !hasEmail(g) && !ordered(g));
    return added ? { kind: 'update', id: added.id } : { kind: 'new' };
  }
  const added = sameName.find((g) => !hasEmail(g) && !ordered(g));
  if (added) return { kind: 'update', id: added.id };
  if (sameName.some((g) => hasEmail(g) && !ordered(g))) return { kind: 'needEmail' };
  if (sameName.length) return { kind: 'already' };
  return { kind: 'new' };
}

/** A table and seat from a printed code to the chart's own names: exact, else by number ("1" is "Table 1", and seat
 *  "2" is the chart's second seat). Unknown values are dropped, so the guest picks from the list instead. */
export function seatFromCode(tables: { name: string; seats: string[] }[], table: string, seat: string): { table: string; seat: string } {
  if (!tables.length) return { table, seat };
  const num = (x: string) => (x.match(/(\d+)\s*$/) || [])[1] || '';
  const t = tables.find((x) => x.name === table) || (/^\d+$/.test(table) ? tables.find((x) => num(x.name) === String(Number(table))) : undefined);
  if (!t) return { table: '', seat: '' };
  const s = t.seats.includes(seat) ? seat : /^\d+$/.test(seat) ? (t.seats[Number(seat) - 1] || '') : '';
  return { table: t.name, seat: s };
}
