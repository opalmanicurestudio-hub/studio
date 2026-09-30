'use client';
// src/lib/table-tab.ts — A TABLE'S TAB. A seated party is a visit (the one visit record: Seated at Table 4); what they
// order goes on that visit's tab and, one kitchen ticket per item, to the kitchen screen. At the end the tab fills the
// normal checkout (split by seat or item, tip on the whole meal). Booked parties and walk-ins use the visit they have.
import { arrayUnion, doc, getDoc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';

export interface TabLine { lineId: string; itemId: string; itemType: 'product' | 'service'; name: string; price: number; quantity: number; seat: string | null; note: string | null; at: string; by: string; kdsId: string | null }

/** The visit a party's tab lives on: their booking's, their walk-in's, or a new table visit. */
export function visitIdForParty(p: any): string {
  const g: string[] = p?.guestIds || [];
  const appt = g.find((x) => x.startsWith('appt:')); if (appt) return appt.slice(5);
  const w = g.find((x) => x.startsWith('walkin:')); if (w) return `apt-walkin-${w.slice(7)}`;
  return `apt-party-${p.id}`;
}

export async function ensureTableVisit(fs: Firestore, tenantId: string, p: any, tableName: string, by: string): Promise<string> {
  const id = visitIdForParty(p); const ref = doc(fs, 'tenants', tenantId, 'appointments', id); const now = new Date().toISOString();
  const snap = await getDoc(ref); const entry = { at: now, kind: 'note', text: `Seated at ${tableName} — ${p.size || 1} ${Number(p.size) === 1 ? 'guest' : 'guests'}`, by, via: 'host' };
  if (!snap.exists()) {
    await setDoc(ref, { id, tenantId, isTable: true, partyId: p.id, tableName, partySize: p.size || 1, clientId: p.clientId || null, clientName: p.name || 'Table', noBookedTime: true, source: 'host',
      status: 'servicing', stage: 'in_service', startTime: now, actualStartTime: now, tab: [], timeline: [entry], createdAt: now, updatedAt: now });
  } else await setDoc(ref, { isTable: true, partyId: p.id, tableName, partySize: p.size || 1, timeline: arrayUnion(entry), updatedAt: now }, { merge: true });
  return id;
}

export async function addToTab(fs: Firestore, tenantId: string, visitId: string, v: { tableName: string; guestName: string }, item: { id: string; type: 'product' | 'service'; name: string; price: number }, o: { seat?: string | null; note?: string | null; by: string }) {
  const now = new Date().toISOString(); const lineId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const b = writeBatch(fs); const kds = doc(fs, 'tenants', tenantId, 'kdsTickets', `tab_${visitId}_${lineId}`);
  const line: TabLine = { lineId, itemId: item.id, itemType: item.type, name: item.name, price: Number(item.price) || 0, quantity: 1, seat: o.seat || null, note: o.note || null, at: now, by: o.by, kdsId: item.type === 'product' ? kds.id : null };
  b.set(doc(fs, 'tenants', tenantId, 'appointments', visitId), { tab: arrayUnion(line), updatedAt: now }, { merge: true });
  // Food and drink go to the kitchen screen (a service on the tab doesn't).
  if (item.type === 'product') b.set(kds, { id: kds.id, source: 'tab', visitId, tableNumber: v.tableName, seatNumber: o.seat || null, guestName: v.guestName, menuItemId: item.id, menuItemName: item.name, note: o.note || null, allergies: [], status: 'pending', createdAt: now, tenantId, isDelta: false });
  await b.commit(); return line;
}

/** Take a line off the tab — only while the kitchen hasn't started it (its ticket is cancelled too). */
export async function removeFromTab(fs: Firestore, tenantId: string, visitId: string, line: TabLine): Promise<{ ok: boolean; message?: string }> {
  if (line.kdsId) { const k = await getDoc(doc(fs, 'tenants', tenantId, 'kdsTickets', line.kdsId)); const st = String((k.data() as any)?.status || 'pending');
    if (k.exists() && !['pending', 'cancelled'].includes(st)) return { ok: false, message: `The kitchen has already started ${line.name} — ask them before taking it off.` }; }
  const ref = doc(fs, 'tenants', tenantId, 'appointments', visitId); const tab: TabLine[] = (((await getDoc(ref)).data() as any)?.tab || []);
  const b = writeBatch(fs); const now = new Date().toISOString();
  b.set(ref, { tab: tab.filter((x) => x.lineId !== line.lineId), updatedAt: now }, { merge: true });
  if (line.kdsId) b.set(doc(fs, 'tenants', tenantId, 'kdsTickets', line.kdsId), { status: 'cancelled', cancelledAt: now }, { merge: true });
  await b.commit(); return { ok: true };
}
export const tabTotal = (tab: TabLine[] = []) => Math.round(tab.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 1), 0) * 100) / 100;
