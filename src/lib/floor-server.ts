// src/lib/floor-server.ts — TONIGHT'S FLOOR, read on the server: the host stand's open session, every party on it, and
// for each seated table its tab, the kitchen's tickets and where it is in its meal (lib/table-stage). Read once for a
// few seconds a business (every server's phone, the host stand and each waiting guest's link ask often), and forgotten
// when something changes it here.
//   tablesNow  → a server's tables and their nudges (api/tab 'nudges')
//   floorNow   → each table's stage and likely free time, and who looks after which tables (api/host/floor)
//   waitNow    → a waiting guest's place in line and wait (api/wait)
//   ringPreorder → the drinks a guest ordered while waiting go on the table's tab and to the bar, once (api/host/floor,
//                  api/host/notify)

import { coursesOf, courseOfItem, isDrinkItem, PREORDER_NOTE, stationOfItem, stationsOf, tableLabel, visitIdForParty } from '@/lib/table-service';
import { itemAllergens, tableAllergies, ticketAllergyFields } from '@/lib/allergens';
import { allNudges, nudgeSettingsOf, type NudgeTable } from '@/lib/nudges';
import { floorSettingsOf, tableStage, type Stage } from '@/lib/table-stage';
import { floorTables, type SeatTable } from '@/lib/seat-next';
import { isWaitDrink, linePlace, waitSettingsOf, type LinePlace } from '@/lib/wait-line';
import { resolveHostingSettings } from '@/lib/floor-plans';
import { businessDayFor, partyFromWalkIn } from '@/lib/hosting-sessions';
import { tenantTimeZone } from '@/lib/tenant-time';
import { deskPrice, saleName } from '@/lib/variants';
import { makeSecondsOf } from '@/lib/counter-orders';
import { itemSoldOut } from '@/lib/menu-choices';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export class FloorStop extends Error { constructor(public msg: string, public status = 409) { super(msg); } }

export type SeatedTable = { partyId: string; unitIds: string[]; nt: NudgeTable; row: any; stage: Stage };
export type FloorRead = { at: number; session: any | null; parties: any[]; seated: SeatedTable[]; staff: Record<string, string>;
  /** Tonight's lobby list (the walk-in queue), waiting as the host stand shows it: they're in line too. */
  lobby: any[] };

/** Several documents in one step of a transaction (one round trip where the database allows it). */
async function readAll(tx: any, refs: any[]): Promise<any[]> {
  if (!refs.length) return [];
  if (typeof tx.getAll === 'function') return tx.getAll(...refs);
  return Promise.all(refs.map((r) => tx.get(r)));
}

const FLOOR_MS = 5000;
const cache = new Map<string, { at: number; v: FloorRead }>();
/** Something changed tonight's floor here: the next read is fresh. */
export function forgetFloor(tenantId: string) { cache.delete(tenantId); }

/** Tonight's floor, read fresh at most every few seconds a business. */
export async function readFloor(db: any, T: string, tenant: any, o: { fresh?: boolean } = {}): Promise<FloorRead> {
  const tenantId = T.split('/')[1];
  const hit = cache.get(tenantId);
  if (!o.fresh && hit && Date.now() - hit.at < FLOOR_MS) return hit.v;
  const v = await readFresh(db, T, tenant);
  cache.set(tenantId, { at: Date.now(), v });
  return v;
}

async function readFresh(db: any, T: string, tenant: any): Promise<FloorRead> {
  const now = Date.now();
  const sessions = (await db.collection(`${T}/serviceSessions`).where('status', '==', 'open').limit(20).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .sort((a: any, b: any) => String(b.opensAt || '').localeCompare(String(a.opensAt || '')));
  const session: any = sessions[0] || null;
  if (!session) return { at: now, session: null, parties: [], seated: [], staff: {}, lobby: [] };
  const unitList: any[] = Array.isArray(session.units) ? session.units : [];
  const units = new Map<string, any>(unitList.map((u: any) => [String(u.id), u]));
  // Tonight's parties that matter to the floor, one status at a time (so a long night's finished parties can't crowd out
  // the seated ones): seated, waiting, called, booked, those who've finished (a table being cleared), and those who left
  // the list (so their lobby-list row isn't counted in line again).
  const STATUSES: [string, number][] = [['seated', 200], ['waiting', 200], ['notified', 200], ['expected', 200], ['finished', 400], ['left', 200], ['no_show', 100]];
  const parties = (await Promise.all(STATUSES.map(([st, n]) => db.collection(`${T}/parties`).where('sessionId', '==', session.id).where('status', '==', st).limit(n).get())))
    .flatMap((snap: any) => snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })));
  const seatedParties = parties.filter((p: any) => p.status === 'seated');
  // The lobby list, as the host stand mirrors it: tonight's, still waiting, and not already on the host's own list.
  const carried = new Set(parties.flatMap((p: any) => (Array.isArray(p.guestIds) ? p.guestIds : [])));
  const hs = resolveHostingSettings(tenant?.hostingSettings); const tz = tenantTimeZone(tenant);
  const lobby = (await db.collection(`${T}/walkIns`).where('status', 'in', ['waiting', 'notified', 'confirmed', 'held']).limit(200).get().catch(() => ({ docs: [] }))).docs
    .map((d: any) => { const m = partyFromWalkIn({ id: d.id, ...(d.data() || {}) }, session.id); return m ? { ...m, id: `walkin:${d.id}` } : null; })
    .filter((m: any) => m && ['waiting', 'notified'].includes(m.status) && !carried.has(m.id)
      && (!m.joinedAt || !session.businessDay || businessDayFor(new Date(m.joinedAt), tz, hs.dayCutoverHour) === session.businessDay));
  const vids = seatedParties.map((p: any) => visitIdForParty(p)).filter((x: string) => ID.test(x));
  const visits = vids.length ? await db.getAll(...vids.map((v: string) => db.doc(`${T}/appointments/${v}`))) : [];
  const vById = new Map<string, any>(visits.map((d: any) => [d.id, d.exists ? d.data() || {} : null]));
  const tickets = new Map<string, any>();
  for (let i = 0; i < vids.length; i += 30) {
    const snap = await db.collection(`${T}/kdsTickets`).where('visitId', 'in', vids.slice(i, i + 30)).get();
    for (const d of snap.docs) tickets.set(d.id, d.data() || {});
  }
  // Who looks after which tables, by first name.
  const staffIds = Array.from(new Set(unitList.flatMap((u: any) => (Array.isArray(u.staffIds) ? u.staffIds : []).map(String)))).filter((x) => ID.test(x)).slice(0, 60);
  const staffDocs = staffIds.length ? await db.getAll(...staffIds.map((id) => db.doc(`${T}/staff/${id}`))) : [];
  const staff: Record<string, string> = {};
  for (const d of staffDocs) { const x: any = d.exists ? d.data() || {} : {}; staff[d.id] = String(x.firstName || String(x.name || x.displayName || '').split(' ')[0] || 'A server').slice(0, 40); }

  const courses = coursesOf(tenant); const fs = floorSettingsOf(tenant);
  const seated: SeatedTable[] = seatedParties.map((p: any) => {
    const vid = visitIdForParty(p); const v: any = vById.get(vid) || {};
    const unitIds = (Array.isArray(p.unitIds) ? p.unitIds : []).map(String);
    const us = unitIds.map((u: string) => units.get(u)).filter(Boolean);
    const label = us.length ? us.map((u: any) => tableLabel(u.name)).join(' + ') : tableLabel(v.tableName);
    const ids = Array.from(new Set(us.flatMap((u: any) => (Array.isArray(u.staffIds) ? u.staffIds : []).map(String))));
    const tab = Array.isArray(v.tab) ? v.tab : [];
    const tk: Record<string, any> = {};
    for (const l of tab) if (l?.kdsId && tickets.has(l.kdsId)) { const k = tickets.get(l.kdsId); tk[l.kdsId] = { status: String(k.status || ''), readyAt: k.readyAt || null, deliveredAt: k.deliveredAt || null }; }
    const nt: NudgeTable = { visitId: vid, partyId: p.id, table: label, seatedAt: p.seatedAt || null, tab, tickets: tk, allergies: tableAllergies(v), done: p.nudges && typeof p.nudges === 'object' ? p.nudges : {}, courses };
    const paidAt = v.status === 'completed' ? (v.checkedOutAt || v.completedAt || null) : null;
    const stage = tableStage({ seatedAt: p.seatedAt || null, size: Number(p.size) || 1, tab, tickets: tk, courses, checkAt: p.checkAt || null, paidAt }, fs, now);
    const row = { visitId: vid, table: label, staffIds: ids, total: Math.round(tab.reduce((s2: number, l: any) => s2 + (Number(l?.price) || 0) * (Number(l?.quantity) || 1), 0) * 100) / 100,
      stage: { key: stage.key, words: stage.words, step: stage.step, freeIn: stage.freeIn }, checkAt: p.checkAt || null,
      party: { id: p.id, name: String(p.name || 'Table').slice(0, 80), size: Number(p.size) || 1, guestIds: Array.isArray(p.guestIds) ? p.guestIds : [], clientId: p.clientId || v.clientId || null, unitIds, seatedAt: p.seatedAt || null } };
    return { partyId: p.id, unitIds, nt, row, stage };
  });
  return { at: now, session, parties, seated, staff, lobby };
}

/** Tonight's seated tables with what each needs next (lib/nudges): only the person's own section when `mine` and they
 *  have one. */
export async function tablesNow(db: any, T: string, tenant: any, meId: string, mine: boolean) {
  const read = await readFloor(db, T, tenant);
  const settings = nudgeSettingsOf(tenant);
  if (!read.session) return { tables: [], nudges: [], settings, me: meId, mineOnly: false, hasSection: false, session: null };
  const minePick = read.seated.filter((t) => t.row.staffIds.includes(meId));
  const shown = mine && minePick.length ? minePick : read.seated;
  return { tables: shown.map((t) => t.row), nudges: allNudges(shown.map((t) => t.nt), settings, Date.now()), settings, me: meId, mineOnly: mine && minePick.length > 0, hasSection: minePick.length > 0, session: read.session.id };
}

/** Each seated table's stage by table, for the host stand. */
export function stagesByUnit(read: FloorRead): Record<string, Stage & { partyId: string }> {
  const out: Record<string, Stage & { partyId: string }> = {};
  for (const t of read.seated) for (const u of t.unitIds) out[u] = { ...t.stage, partyId: t.partyId };
  return out;
}

/** The floor as the host stand and a guest's link both see it (lib/seat-next). */
export function tablesOf(read: FloorRead, tenant: any, now: number): SeatTable[] {
  if (!read.session) return [];
  const hs = resolveHostingSettings(tenant?.hostingSettings);
  return floorTables(read.session.units || [], read.parties, stagesByUnit(read), floorSettingsOf(tenant), now, { holdBeforeMinutes: hs.holdBeforeMinutes, holdGraceMinutes: hs.holdGraceMinutes });
}

/** A waiting party's place in line and wait. */
export function waitNow(read: FloorRead, tenant: any, party: any, now: number): LinePlace {
  const line = (p: any) => ({ id: p.id, size: Number(p.size) || 1, needs: Array.isArray(p.needs) ? p.needs : [], status: String(p.status), joinedAt: p.joinedAt || null, laterUntil: p.laterUntil || null });
  const waiting = [...read.parties, ...(read.lobby || [])].filter((p: any) => ['waiting', 'notified'].includes(String(p.status))).map(line);
  return linePlace(line(party), tablesOf(read, tenant, now), waiting, floorSettingsOf(tenant), now);
}

/** The drinks guests can order while they wait, from the menu (lib/wait-line), with what each contains. Read at most
 *  every half minute a business (each waiting guest's link asks often); what's sold out is taken off each time. */
const DRINKS_MS = 30000;
const drinksCache = new Map<string, { at: number; key: string; v: any[] }>();
export async function waitDrinks(db: any, T: string, tenant: any, soldOut: Set<string> = new Set()): Promise<{ id: string; name: string; price: number; section: string; contains: string[]; x: any }[]> {
  const s = waitSettingsOf(tenant); const key = JSON.stringify(s.sections);
  const hit = drinksCache.get(T);
  let list: any[];
  if (hit && hit.key === key && Date.now() - hit.at < DRINKS_MS) list = hit.v;
  else {
    const snap = await db.collection(`${T}/inventory`).where('type', '==', 'refreshment').limit(400).get();
    list = [];
    for (const d of snap.docs) {
      const x: any = { id: d.id, ...(d.data() || {}) };
      if (!isWaitDrink(x, s, isDrinkItem) || x.parentId) continue;
      const price = deskPrice(x, new Map()); if (!(price > 0)) continue;
      list.push({ id: d.id, name: saleName(x, new Map()).slice(0, 80), price, section: String(x.section || x.menuSection || x.category || '').slice(0, 60), contains: itemAllergens(x), x });
    }
    list.sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
    drinksCache.set(T, { at: Date.now(), key, v: list });
  }
  return list.filter((d) => !soldOut.has(d.id) && !itemSoldOut(d.x)).slice(0, 60);
}
/** The menu changed here: the next read of the drinks is fresh. */
export const forgetDrinks = (T: string) => { drinksCache.delete(T); };

/** The drinks a guest ordered while waiting go on their table's tab and to the bar (each one its own ticket, made now),
 *  once. Asked again after that (they've now sat down somewhere), it points the drinks not yet taken out at the table
 *  they're at. Prices come from the menu now, never from what was saved with the order. */
export async function ringPreorder(db: any, T: string, tenant: any, partyId: string, tableName: string, by: string): Promise<{ rung: number; moved: number; skipped: string[] }> {
  if (!ID.test(partyId)) throw new FloorStop('Which party?', 400);
  const table = String(tableName || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Waiting list';
  const pRef = db.doc(`${T}/parties/${partyId}`);
  const courses = coursesOf(tenant); const stations = stationsOf(tenant);
  const res = await db.runTransaction(async (tx: any) => {
    const ps = await tx.get(pRef); const p: any = ps.exists ? ps.data() || {} : null;
    if (!p) throw new FloorStop('That party wasn’t found.', 404);
    // Only for a party that's here: seated, or called forward.
    if (!['seated', 'notified'].includes(String(p.status))) throw new FloorStop('They’re not here now.');
    if (p.preorderRungAt) {
      const ids = (Array.isArray(p.preorderKds) ? p.preorderKds : []).filter((x: string) => ID.test(String(x))).slice(0, 20);
      const snaps = ids.length ? await readAll(tx, ids.map((id: string) => db.doc(`${T}/kdsTickets/${id}`))) : [];
      let moved = 0;
      for (const s of snaps) { const k: any = s.exists ? s.data() || {} : null; if (k && !['delivered', 'cancelled'].includes(String(k.status)) && k.tableNumber !== table) { tx.set(s.ref, { tableNumber: table }, { merge: true }); moved += 1; } }
      return { rung: 0, moved, skipped: [] as string[] };
    }
    const lines: any[] = (Array.isArray(p.preorder) ? p.preorder : []).filter((l: any) => l && ID.test(String(l.itemId)) && Number(l.qty) > 0).slice(0, 8);
    if (!lines.length) return { rung: 0, moved: 0, skipped: [] as string[] };
    const vid = visitIdForParty({ ...p, id: partyId }); const vRef = db.doc(`${T}/appointments/${vid}`);
    const vs = await tx.get(vRef); const v: any = vs.exists ? vs.data() || {} : null;
    if (v && v.status === 'completed') throw new FloorStop('That table has already paid.');
    const ids = Array.from(new Set(lines.map((l) => String(l.itemId))));
    const items = await readAll(tx, ids.map((id) => db.doc(`${T}/inventory/${id}`)));
    const byId = new Map<string, any>(items.map((d: any) => [d.id, d.exists ? { id: d.id, ...(d.data() || {}) } : null]));
    const now = new Date().toISOString(); const allergies = tableAllergies(v || {});
    const tab: any[] = []; const kds: string[] = []; const skipped: string[] = [];
    let i = 0;
    for (const l of lines) {
      const x = byId.get(String(l.itemId));
      const price = x ? deskPrice(x, new Map()) : 0;
      if (!x || !(price > 0) || x.isArchived === true || x.status === 'archived') { skipped.push(String(l.name || 'A drink').slice(0, 60)); continue; }
      const raw = { ...x, category: x.category || x.department || '' };
      const c = courseOfItem(raw, courses); const station = stationOfItem(raw, stations); const allergens = itemAllergens(x).slice(0, 10);
      for (let q = 0; q < Math.min(4, Math.floor(Number(l.qty) || 0)); q++) {
        const lineId = `${Date.now().toString(36)}w${(i++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        const kdsId = `tab_${vid}_${lineId}`;
        const name = saleName(x, new Map()).slice(0, 80);
        tab.push({ lineId, itemId: x.id, itemType: 'product', name, price, listPrice: price, quantity: 1, seat: null, note: PREORDER_NOTE, at: now, by, kdsId,
          course: c ? c.n : null, courseName: c ? c.name : null, firedAt: now, station, makeSeconds: x.type === 'refreshment' ? makeSecondsOf(x) : null, comp: null, allergens });
        const al = ticketAllergyFields(allergies, null, allergens);
        tx.set(db.doc(`${T}/kdsTickets/${kdsId}`), { id: kdsId, source: 'tab', visitId: vid, lineId, tableNumber: table, seatNumber: null, guestName: String(p.name || 'Guest').slice(0, 80), menuItemId: x.id, menuItemName: name,
          note: PREORDER_NOTE, allergies: al.allergies, contains: al.contains, status: 'pending', createdAt: now, requestedAt: now, firedAt: now, tenantId: T.split('/')[1], isDelta: false,
          course: c ? c.n : null, courseName: c ? c.name : null, madeAt: station, makeSeconds: x.type === 'refreshment' ? makeSecondsOf(x) : null });
        kds.push(kdsId);
      }
    }
    if (!tab.length) { tx.set(pRef, { preorderRungAt: now, preorderKds: [], preorderSkipped: skipped }, { merge: true }); return { rung: 0, moved: 0, skipped }; }
    const entry = { at: now, kind: 'note', text: `${tab.length === 1 ? 'A drink' : `${tab.length} drinks`} ordered while waiting, sent to the bar`, by, via: 'host' };
    if (!v) {
      tx.set(vRef, { id: vid, tenantId: T.split('/')[1], isTable: true, partyId, tableName: table, partySize: Number(p.size) || 1, clientId: p.clientId || null, clientName: String(p.name || 'Table').slice(0, 80), noBookedTime: true, source: 'host',
        status: 'servicing', stage: 'in_service', startTime: now, actualStartTime: now, tab, timeline: [entry], createdAt: now, updatedAt: now });
    } else {
      tx.set(vRef, { tab: [...(Array.isArray(v.tab) ? v.tab : []), ...tab], timeline: [...(Array.isArray(v.timeline) ? v.timeline : []), entry].slice(-60), updatedAt: now }, { merge: true });
    }
    tx.set(pRef, { preorderRungAt: now, preorderKds: kds, preorderSkipped: skipped }, { merge: true });
    return { rung: tab.length, moved: 0, skipped };
  });
  forgetFloor(T.split('/')[1]);
  return res;
}

/** A guest who leaves the list after their drinks went to the bar: the drinks not yet taken out are taken off the bar's
 *  screen. On a tab started only for them (they never sat down), every drink from the wait list comes off and the tab
 *  is closed: nobody is charged for a drink they never sat down to. On a booking's own visit, a drink already taken out
 *  stays (it was theirs). Returns how many came off; throws when it couldn't be done (the caller says so). */
export async function voidPreorder(db: any, T: string, partyId: string, by: string, reason = 'Left the wait list'): Promise<number> {
  if (!ID.test(partyId)) return 0;
  const pRef = db.doc(`${T}/parties/${partyId}`);
  const n = await db.runTransaction(async (tx: any) => {
    const p: any = (await tx.get(pRef)).data() || {};
    const ids = (Array.isArray(p.preorderKds) ? p.preorderKds : []).filter((x: string) => ID.test(String(x))).slice(0, 20);
    if (!p.preorderRungAt || !ids.length || p.status === 'seated' || p.seatedAt) return 0;
    const vid = visitIdForParty({ ...p, id: partyId }); const vRef = db.doc(`${T}/appointments/${vid}`);
    const v: any = (await tx.get(vRef)).data() || null;
    const snaps = await readAll(tx, ids.map((id: string) => db.doc(`${T}/kdsTickets/${id}`)));
    const now = new Date().toISOString(); const off = new Set<string>(); const onlyTheirs = !!v && v.partyId === partyId && v.source === 'host';
    for (const s of snaps) {
      const k: any = s.exists ? s.data() || {} : null; if (!k || k.status === 'cancelled') continue;
      if (k.status !== 'delivered') { tx.set(s.ref, { status: 'cancelled', cancelledAt: now, cancelReason: reason }, { merge: true }); off.add(s.id); }
      else if (onlyTheirs) off.add(s.id);
    }
    if (v && v.status !== 'completed' && off.size) {
      const tab = (Array.isArray(v.tab) ? v.tab : []).filter((l: any) => !off.has(String(l?.kdsId || '')));
      const entry = { at: now, kind: 'note', text: `${off.size === 1 ? 'A drink' : `${off.size} drinks`} ordered while waiting taken off: ${reason.toLowerCase()}`, by, via: 'host' };
      tx.set(vRef, { tab, timeline: [...(Array.isArray(v.timeline) ? v.timeline : []), entry].slice(-60), updatedAt: now, ...(onlyTheirs && !tab.length ? { status: 'cancelled', stage: 'cancelled' } : {}) }, { merge: true });
    }
    tx.set(pRef, { preorderVoidedAt: off.size ? now : null, drinksStuckAt: null }, { merge: true });
    return off.size;
  });
  forgetFloor(T.split('/')[1]);
  return n;
}

/** When the drinks couldn't be taken off, the host stand is told (and can try again from the party). */
export async function voidPreorderOrFlag(db: any, T: string, partyId: string, by: string, reason?: string): Promise<{ off: number; stuck: boolean }> {
  try { return { off: await voidPreorder(db, T, partyId, by, reason), stuck: false }; }
  catch (e) {
    console.error('[void preorder]', e);
    await db.doc(`${T}/parties/${partyId}`).set({ drinksStuckAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    return { off: 0, stuck: true };
  }
}
