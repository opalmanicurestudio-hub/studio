'use client';
// src/lib/table-tab.ts — A TABLE'S TAB. A seated party is a visit (the one visit record: Seated at Table 4); what they
// order goes on that visit's tab and, one kitchen ticket per item, to the station that makes it (lib/table-service). An
// item in a held course (Mains, Dessert by default) waits as "not fired" until the server fires that course (api/tab).
// At the end the tab fills the normal checkout (split by seat or item, tip on the whole meal); a comped line goes with
// its comp, which the server checks against its approval. Comps, voids, remakes, firing, seat changes and the table's
// allergies go through api/tab, never written here (a kitchen ticket is only ever made here, waiting; the security
// rules let no browser change one after that). Booked parties and walk-ins use the visit they have. A seat's allergies
// (lib/allergens) go on each of its tickets, with what the menu says the dish contains of them.
import { arrayUnion, doc, getDoc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { ticketAllergyFields, type TableAllergy } from '@/lib/allergens';

export interface TabComp { approvalId: string; amount: number; reason: string; by: string; approvedBy: string; at: string }
export interface TabLine {
  lineId: string; itemId: string; itemType: 'product' | 'service'; name: string; price: number; quantity: number; seat: string | null; note: string | null; at: string; by: string; kdsId: string | null;
  /** What it sells for before a comp (price is what it costs now). Older lines don't have it: their price is the list. */
  listPrice?: number;
  /** Its course (lib/table-service), and when that course was fired (null: not fired yet). */
  course?: number | null; courseName?: string | null; firedAt?: string | null;
  /** Where it's made, and how long it takes (seconds). */
  station?: string | null; makeSeconds?: number | null;
  comp?: TabComp | null;
  /** What the menu said it contains when it was rung in (lib/allergens), so a seat change can tell the kitchen again. */
  allergens?: string[];
}

/** The visit a party's tab lives on: their booking's, their walk-in's, or a new table visit. */
export function visitIdForParty(p: any): string {
  const g: string[] = p?.guestIds || [];
  const appt = g.find((x) => x.startsWith('appt:')); if (appt) return appt.slice(5);
  const w = g.find((x) => x.startsWith('walkin:')); if (w) return `apt-walkin-${w.slice(7)}`;
  return `apt-party-${p.id}`;
}

export async function ensureTableVisit(fs: Firestore, tenantId: string, p: any, tableName: string, by: string): Promise<string> {
  const id = visitIdForParty(p); const ref = doc(fs, 'tenants', tenantId, 'appointments', id); const now = new Date().toISOString();
  const snap = await getDoc(ref); const entry = { at: now, kind: 'note', text: `Seated at ${tableName}, ${p.size || 1} ${Number(p.size) === 1 ? 'guest' : 'guests'}`, by, via: 'host' };
  if (!snap.exists()) {
    await setDoc(ref, { id, tenantId, isTable: true, partyId: p.id, tableName, partySize: p.size || 1, clientId: p.clientId || null, clientName: p.name || 'Table', noBookedTime: true, source: 'host',
      status: 'servicing', stage: 'in_service', startTime: now, actualStartTime: now, tab: [], timeline: [entry], createdAt: now, updatedAt: now });
  } else await setDoc(ref, { isTable: true, partyId: p.id, tableName, partySize: p.size || 1, timeline: arrayUnion(entry), updatedAt: now }, { merge: true });
  return id;
}

export type TabItem = { id: string; type: 'product' | 'service'; name: string; price: number; course?: { n: number; name: string; hold: boolean } | null; station?: string | null; makeSeconds?: number | null; allergens?: string[] };

export async function addToTab(fs: Firestore, tenantId: string, visitId: string, v: { tableName: string; guestName: string }, item: TabItem, o: { seat?: string | null; note?: string | null; by: string; sendNow?: boolean; allergies?: TableAllergy[] }) {
  const now = new Date().toISOString(); const lineId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const b = writeBatch(fs); const kds = doc(fs, 'tenants', tenantId, 'kdsTickets', `tab_${visitId}_${lineId}`);
  const c = item.course || null;
  // A held course waits for the server to fire it, unless they've asked for this one now (or the course is already out).
  const waits = item.type === 'product' && !!c?.hold && o.sendNow !== true;
  const price = Number(item.price) || 0;
  const line: TabLine = { lineId, itemId: item.id, itemType: item.type, name: item.name, price, listPrice: price, quantity: 1, seat: o.seat || null, note: o.note || null, at: now, by: o.by,
    kdsId: item.type === 'product' ? kds.id : null, course: c ? c.n : null, courseName: c ? c.name : null, firedAt: waits ? null : now, station: item.station || null, makeSeconds: Number(item.makeSeconds) || null, comp: null,
    allergens: Array.isArray(item.allergens) ? item.allergens.slice(0, 10) : [] };
  const al = ticketAllergyFields(o.allergies || [], o.seat || null, line.allergens || []);
  b.set(doc(fs, 'tenants', tenantId, 'appointments', visitId), { tab: arrayUnion(line), updatedAt: now }, { merge: true });
  // Food and drink go to the station that makes it (a service on the tab doesn't).
  if (item.type === 'product') b.set(kds, { id: kds.id, source: 'tab', visitId, lineId, tableNumber: v.tableName, seatNumber: o.seat || null, guestName: v.guestName, menuItemId: item.id, menuItemName: item.name, note: o.note || null,
    allergies: al.allergies, contains: al.contains, status: waits ? 'unfired' : 'pending', createdAt: now, ...(waits ? {} : { requestedAt: now, firedAt: now }), tenantId, isDelta: false,
    course: c ? c.n : null, courseName: c ? c.name : null, madeAt: item.station || null, makeSeconds: Number(item.makeSeconds) || null });
  await b.commit(); return line;
}

export const tabTotal = (tab: TabLine[] = []) => Math.round(tab.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 1), 0) * 100) / 100;
/** What's been comped on a tab, in dollars. */
export const tabComps = (tab: TabLine[] = []) => Math.round(tab.reduce((s, l) => s + (l.comp ? Math.max(0, (Number(l.listPrice ?? l.price) || 0) - (Number(l.price) || 0)) : 0), 0) * 100) / 100;
