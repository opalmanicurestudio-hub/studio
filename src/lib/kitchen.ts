// src/lib/kitchen.ts — THE KITCHEN SCREEN'S TICKETS, read and moved the same way everywhere (api/kitchen, app/kds).
// A ticket lives in one of two places: a lounge order (refreshmentRequests) or a kitchen ticket (kdsTickets: an event
// course, a table tab, a café sale at the desk). Which place it came from travels with it (`col`), so moving it along
// always writes where it lives (a table tab's ticket used to be written to the lounge's, and never moved). Pure.

import { moduleEnabled } from './modules';

export type KitchenCol = 'refreshmentRequests' | 'kdsTickets';
export type KitchenStep = 'claim' | 'release' | 'ready' | 'carry' | 'drop' | 'deliver' | 'cancel';

/** Is the kitchen screen part of this business's plan? It comes with Lounge & hospitality, and with Classes & events
 *  (an event's meals need it). Off, it's locked (lib/tool-lock), so nothing is sent to it. */
export function kitchenScreenOn(tenant: any): boolean {
  return moduleEnabled(tenant, 'hospitality') || moduleEnabled(tenant, 'classes_events');
}

/** Who makes the lounge's drinks and extras: the kitchen screen, or the front desk (its Assist list). One or the other,
 *  never both, so an order is never made twice. Set in Settings or when a kitchen screen is set up; the desk by default,
 *  and always the desk while the kitchen screen isn't part of the plan (so no order waits on a screen that's locked). */
export function loungeMaker(tenant: any): 'kitchen' | 'desk' {
  return tenant?.kitchenSettings?.loungeOrdersMadeBy === 'kitchen' && kitchenScreenOn(tenant) ? 'kitchen' : 'desk';
}
export const ACTIVE_STATUSES = ['pending', 'in_progress', 'ready'] as const;

/** Which steps a ticket can take from where it is. */
export function canStep(status: string, step: KitchenStep): boolean {
  const s = String(status || '');
  if (step === 'claim') return s === 'pending';
  if (step === 'release') return s === 'in_progress';
  if (step === 'ready') return s === 'pending' || s === 'in_progress';
  if (step === 'carry' || step === 'drop') return s === 'ready';   // taking it out, or letting someone else (once each: see api/kitchen)
  if (step === 'deliver') return s === 'pending' || s === 'in_progress' || s === 'ready';
  if (step === 'cancel') return s === 'pending' || s === 'in_progress' || s === 'ready';
  return false;
}

/** What's still to be paid when a kiosk order is handed over (api/concierge/requests "pay at the station"), or 0. Not
 *  one paid by card, put on a balance, charged to the station, comped or a member perk (each settled when it was
 *  ordered), nor one on a visit (paid at checkout). Used by the kitchen screen and the desk's delivery alike. */
export function collectAtHandover(r: any): number {
  const x = r || {};
  if (x.isGuestKiosk !== true || x.isRedemption === true || x.paidAtKiosk === true || x.chargedToStation === true || x.compedByRenter === true) return 0;
  if (x.settledBy && x.settledBy !== 'desk') return 0;
  if (x.appointmentId && x.appointmentId !== 'guest-walkin') return 0;
  const price = Number(x.priceAtRequest);
  return price > 0 ? Math.round(price * Math.max(1, Math.round(Number(x.quantity) || 1)) * 100) / 100 : 0;
}

/** What a ticket says, from either place, for the screen. */
export function ticketFrom(d: any, col: KitchenCol) {
  const r = d || {};
  const source = col === 'refreshmentRequests' ? 'lounge' : String(r.source || 'event');
  return {
    id: String(r.id || ''), col, source,
    status: String(r.status || 'pending'),
    name: String(r.clientName || r.guestName || 'Guest'),
    item: String(r.itemName || r.menuItemName || 'Item'),
    itemId: r.itemId || r.menuItemId || null,
    quantity: Math.max(1, Math.round(Number(r.quantity) || 1)),
    station: String(r.stationName || (r.tableNumber ? `Table ${r.tableNumber}${r.seatNumber ? `, seat ${r.seatNumber}` : ''}` : source === 'pos' ? 'Desk' : 'Lounge')),
    at: String(r.requestedAt || r.createdAt || ''),
    claimedBy: r.claimedBy?.name ? { staffId: r.claimedBy.staffId || null, name: String(r.claimedBy.name) } : null,
    eventId: r.eventId || null, eventTitle: r.eventTitle || null,
    courseNumber: Number.isFinite(Number(r.courseNumber)) && r.courseNumber !== null && r.courseNumber !== undefined ? Number(r.courseNumber) : null,
    tableNumber: r.tableNumber || null, seatNumber: r.seatNumber || null,
    note: [r.note, r.notes, r.guestNote, r.specialRequests].map((x: any) => String(x || '').trim()).filter(Boolean).join(' · ') || null,
    lookFor: String(r.guestDescription || '').trim() || null,
    accessNote: String(r.accessNote || '').trim() || null,
    allergies: Array.isArray(r.allergies) ? r.allergies : [],
    allergyNote: String(r.allergyNote || '').trim() || null,
    isRedemption: r.isRedemption === true,
    collect: col === 'refreshmentRequests' ? collectAtHandover(r) : 0,
    readyAt: r.readyAt || null, deliveredAt: r.deliveredAt || null,
    carriedBy: String(r.carriedBy || r.bringingOutBy || '').trim() || null,
  };
}
export type KitchenTicket = ReturnType<typeof ticketFrom>;

// An allergy written in someone's own words: a word that means "this matters" (allergic, EpiPen, celiac), or a major
// allergen asked to be left out ("no nuts", "without dairy", "gluten-free"). An allergen named as part of an order
// ("extra shrimp", "oat milk") isn't one, so a coffee order doesn't cry wolf.
const ALLERGENS = 'nuts?|peanuts?|tree ?nuts?|almonds?|cashews?|walnuts?|pecans?|hazelnuts?|pistachios?|gluten|wheat|dairy|lactose|milk|eggs?|shellfish|shrimp|prawns?|crab|lobster|mollus[ck]s?|fish|soy|soya|sesame|mustard|celery|lupin|sulph?ites?|sulfites?';
const ALLERGY_WORDS = new RegExp(`\\b(allerg\\w*|anaphyla\\w*|epi-?pens?|intoleran\\w*|coeliac|celiac)\\b|\\b(no|without|avoid|hold the|free of|can[’']?t have|cannot have|cannot eat|can[’']?t eat)\\s+(any\\s+)?(${ALLERGENS})\\b|\\b(${ALLERGENS})[- ]free\\b`, 'i');

/** The allergies on a ticket, big enough to see across a kitchen: the ones picked from a list (with how serious), and
 *  any note typed by hand that mentions one (so it isn't missed because nobody picked it from the list). */
export function allergyFlags(t: Pick<KitchenTicket, 'allergies' | 'allergyNote' | 'note' | 'accessNote'>) {
  const listed = (Array.isArray(t.allergies) ? t.allergies : []).map((a: any) => (typeof a === 'string'
    ? { name: a, severe: false }
    : { name: String(a?.name || a?.label || a?.allergen || 'Allergy'), severe: a?.severity === 'critical' || a?.severity === 'severe' }));
  const notes = [t.allergyNote, t.note, t.accessNote].map((x) => String(x || '').trim()).filter(Boolean);
  const mentions = notes.filter((n) => ALLERGY_WORDS.test(n));
  return { listed, mentions, any: listed.length > 0 || mentions.length > 0, severe: listed.some((a) => a.severe) || mentions.some((m) => /anaphyla|epi-?pen|severe|life/i.test(m)) };
}

/** Tickets in groups for a busy service: by event course ("Spring dinner, course 2"), or by dish across everyone
 *  ("Risotto × 14"). Oldest group first. */
export function groupTickets(tickets: KitchenTicket[], by: 'course' | 'dish') {
  const groups = new Map<string, { key: string; label: string; tickets: KitchenTicket[]; count: number; at: string }>();
  for (const t of tickets) {
    const key = by === 'course'
      ? (t.eventId ? `${t.eventId}|${t.courseNumber ?? '-'}` : `other|${t.source}`)
      : `${t.item.trim().toLowerCase()}`;
    const label = by === 'course'
      ? (t.eventId ? `${t.eventTitle || 'Event'}${t.courseNumber !== null ? `, course ${t.courseNumber}` : ''}` : t.source === 'lounge' ? 'Lounge orders' : t.source === 'tab' ? 'Table orders' : t.source === 'pos' ? 'Desk orders' : 'Other orders')
      : t.item;
    const g = groups.get(key) || { key, label, tickets: [], count: 0, at: t.at };
    g.tickets.push(t); g.count += t.quantity; if (t.at && (!g.at || t.at < g.at)) g.at = t.at;
    groups.set(key, g);
  }
  return Array.from(groups.values()).sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
