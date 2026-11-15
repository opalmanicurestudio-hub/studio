'use client';
// src/lib/table-tab.ts — A TABLE'S TAB. A seated party is a visit (the one visit record: Seated at Table 4); what they
// order goes on that visit's tab and, one kitchen ticket per item, to the station that makes it (lib/table-service). An
// item in a held course (Mains, Dessert by default) waits as "not fired" until the server fires that course (api/tab).
// At the end the tab fills the normal checkout (split by seat or item, tip on the whole meal); a comped line goes with
// its comp, which the server checks against its approval. Comps, voids, remakes, firing, seat changes and the table's
// allergies go through api/tab, never written here (a kitchen ticket is only ever made here, waiting; the security
// rules let no browser change one after that). Booked parties and walk-ins use the visit they have. A seat's allergies
// (lib/allergens) go on each of its tickets, with what the menu says the dish contains of them.
import { landed } from '@/lib/outbox';
import { arrayUnion, doc, getDoc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { ticketAllergyFields, type TableAllergy } from '@/lib/allergens';
import { visitIdForParty } from '@/lib/table-service';
import type { PickedChoice, Picks } from '@/lib/menu-choices';
import { partName, partTicketId, type AlsoAt } from '@/lib/two-stations';

export interface TabComp { approvalId: string; amount: number; reason: string; by: string; approvedBy: string; at: string }
export interface TabLine {
  lineId: string; itemId: string; itemType: 'product' | 'service'; name: string; price: number; quantity: number; seat: string | null; note: string | null; at: string; by: string; kdsId: string | null;
  /** Rung in during happy hour at its happy-hour price (lib/menu-time): checkout keeps that price. */
  happy?: boolean;
  /** What it sells for before a comp (price is what it costs now). Older lines don't have it: their price is the list. */
  listPrice?: number;
  /** Its course (lib/table-service), and when that course was fired (null: not fired yet). */
  course?: number | null; courseName?: string | null; firedAt?: string | null;
  /** Where it's made, and how long it takes (seconds). */
  station?: string | null; makeSeconds?: number | null;
  comp?: TabComp | null;
  /** What the menu said it contains when it was rung in (lib/allergens), so a seat change can tell the kitchen again. */
  allergens?: string[];
  /** Its choices (lib/menu-choices): what was picked, as priced when it was rung in, and the kitchen's words for them.
   *  The price above includes them. */
  picks?: Record<string, string[]>; choices?: PickedChoice[]; choicesText?: string | null;
  /** Also made at another station (lib/two-stations): each part's ticket, and where and what it is. */
  alsoKdsIds?: string[]; alsoAt?: AlsoAt[];
}

/** The visit a party's tab lives on (lib/table-service, where the server finds it too). */
export { visitIdForParty } from '@/lib/table-service';

export async function ensureTableVisit(fs: Firestore, tenantId: string, p: any, tableName: string, by: string): Promise<string> {
  const id = visitIdForParty(p); const ref = doc(fs, 'tenants', tenantId, 'appointments', id); const now = new Date().toISOString();
  const entry = { at: now, kind: 'note', text: `Seated at ${tableName}, ${p.size || 1} ${Number(p.size) === 1 ? 'guest' : 'guests'}`, by, via: 'host' };
  // With no connection the database keeps these saves on the device and sends them when it's back (lib/outbox landed):
  // the tab opens meanwhile. A visit this device has never seen can't be read with no connection: it's opened by merging
  // only what can't be wrong (never its tab, status or start time, so one already on the server is kept whole), marked
  // so the next time it's opened with a connection it gets them if it has none.
  const snap = await getDoc(ref).catch(() => null);
  if (snap && !snap.exists()) {
    await landed(setDoc(ref, { id, tenantId, isTable: true, partyId: p.id, tableName, partySize: p.size || 1, clientId: p.clientId || null, clientName: p.name || 'Table', noBookedTime: true, source: 'host',
      status: 'servicing', stage: 'in_service', startTime: now, actualStartTime: now, tab: [], timeline: [entry], createdAt: now, updatedAt: now }));
  } else if (snap) {
    const v: any = snap.data() || {};
    // Opened with no connection before: what it couldn't be given then.
    const fill = v.openedOffline && !v.status ? { status: 'servicing', stage: 'in_service', startTime: v.startTime || v.openedOffline, actualStartTime: v.actualStartTime || v.openedOffline, createdAt: v.createdAt || v.openedOffline } : {};
    await landed(setDoc(ref, { isTable: true, partyId: p.id, tableName, partySize: p.size || 1, timeline: arrayUnion(entry), updatedAt: now, ...fill }, { merge: true }));
  } else await landed(setDoc(ref, { id, tenantId, isTable: true, partyId: p.id, tableName, partySize: p.size || 1, ...(p.clientId ? { clientId: p.clientId } : {}), clientName: p.name || 'Table', noBookedTime: true, source: 'host',
    openedOffline: now, timeline: arrayUnion(entry), updatedAt: now }, { merge: true }));
  return id;
}

export type TabItem = { id: string; type: 'product' | 'service'; name: string; price: number; happy?: boolean; alsoAt?: AlsoAt[]; course?: { n: number; name: string; hold: boolean } | null; station?: string | null; makeSeconds?: number | null; allergens?: string[]; choices?: any[] };
/** The choices made for one line (lib/menu-choices priceChoices, worked out from the item as the menu has it). */
export type TabChoice = { picks: Picks; lines: PickedChoice[]; text: string; extra: number };

export const newLineId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** One item onto a table's tab, and its ticket to the station that makes it, in one save. `lineId` can be chosen by the
 *  screen (it knows the line before the save is confirmed, for "Not sent yet" with no connection). */
export async function addToTab(fs: Firestore, tenantId: string, visitId: string, v: { tableName: string; guestName: string }, item: TabItem, o: { seat?: string | null; note?: string | null; by: string; sendNow?: boolean; allergies?: TableAllergy[]; lineId?: string; choice?: TabChoice | null }) {
  const now = new Date().toISOString(); const lineId = o.lineId && /^[a-z0-9]{6,40}$/.test(o.lineId) ? o.lineId : newLineId();
  const b = writeBatch(fs); const kds = doc(fs, 'tenants', tenantId, 'kdsTickets', `tab_${visitId}_${lineId}`);
  const c = item.course || null;
  // A held course waits for the server to fire it, unless they've asked for this one now (or the course is already out).
  const waits = item.type === 'product' && !!c?.hold && o.sendNow !== true;
  // Its choices add (or take off) their own prices; the kitchen reads them each on its own line.
  const ch = item.type === 'product' && o.choice && o.choice.lines.length ? o.choice : null;
  const price = Math.round(((Number(item.price) || 0) + (ch ? Number(ch.extra) || 0 : 0)) * 100) / 100;
  // Also made at another station: a ticket there for its part ("Steak frites: the fries"), joined to this line.
  const also = item.type === 'product' && Array.isArray(item.alsoAt) ? item.alsoAt.slice(0, 2) : [];
  const line: TabLine = { lineId, itemId: item.id, itemType: item.type, name: item.name, price, listPrice: price, quantity: 1, seat: o.seat || null, note: o.note || null, at: now, by: o.by,
    kdsId: item.type === 'product' ? kds.id : null, course: c ? c.n : null, courseName: c ? c.name : null, firedAt: waits ? null : now, station: item.station || null, makeSeconds: Number(item.makeSeconds) || null, comp: null,
    allergens: Array.isArray(item.allergens) ? item.allergens.slice(0, 10) : [], ...(ch ? { picks: ch.picks, choices: ch.lines, choicesText: ch.text } : {}), ...(item.happy ? { happy: true } : {}),
    ...(also.length ? { alsoKdsIds: also.map((_, i) => partTicketId(kds.id, i)), alsoAt: also } : {}) };
  const al = ticketAllergyFields(o.allergies || [], o.seat || null, line.allergens || []);
  b.set(doc(fs, 'tenants', tenantId, 'appointments', visitId), { tab: arrayUnion(line), updatedAt: now }, { merge: true });
  // Food and drink go to the station that makes it (a service on the tab doesn't).
  if (item.type === 'product') b.set(kds, { id: kds.id, source: 'tab', visitId, lineId, tableNumber: v.tableName, seatNumber: o.seat || null, guestName: v.guestName, menuItemId: item.id, menuItemName: item.name, note: o.note || null,
    allergies: al.allergies, contains: al.contains, status: waits ? 'unfired' : 'pending', createdAt: now, ...(waits ? {} : { requestedAt: now, firedAt: now }), tenantId, isDelta: false,
    ...(ch ? { choices: ch.lines, choicesText: ch.text } : {}),
    course: c ? c.n : null, courseName: c ? c.name : null, madeAt: item.station || null, makeSeconds: Number(item.makeSeconds) || null,
    ...(also.length ? { alsoAt: also } : {}) });
  also.forEach((a, i) => { const id = partTicketId(kds.id, i);
    b.set(doc(fs, 'tenants', tenantId, 'kdsTickets', id), { id, source: 'tab', visitId, lineId, tableNumber: v.tableName, seatNumber: o.seat || null, guestName: v.guestName, menuItemId: item.id, menuItemName: partName(item.name, a.part), note: o.note || null,
      allergies: al.allergies, contains: al.contains, status: waits ? 'unfired' : 'pending', createdAt: now, ...(waits ? {} : { requestedAt: now, firedAt: now }), tenantId, isDelta: false, ...(ch ? { choicesText: ch.text } : {}),
      course: c ? c.n : null, courseName: c ? c.name : null, madeAt: a.station, makeSeconds: Number(item.makeSeconds) || null, partOf: kds.id, partFrom: item.station || null, partFor: item.name, partsUsed: true }); });
  await b.commit(); return line;
}

export const tabTotal = (tab: TabLine[] = []) => Math.round(tab.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 1), 0) * 100) / 100;
/** What's been comped on a tab, in dollars. */
export const tabComps = (tab: TabLine[] = []) => Math.round(tab.reduce((s, l) => s + (l.comp ? Math.max(0, (Number(l.listPrice ?? l.price) || 0) - (Number(l.price) || 0)) : 0), 0) * 100) / 100;
