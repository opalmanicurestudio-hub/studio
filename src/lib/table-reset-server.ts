// src/lib/table-reset-server.ts — CLEAR AND RESET, read and kept on the server (lib/table-reset has the lists).
//   clearingFor → the tables to clear and the ones leaving soon, tonight, with the business's reset steps.
//   markLeft    → a table that's paid has gone: the party is finished, and its table is being cleared from now. Only
//                 once the check is closed (or nothing was ordered): a table that hasn't paid, or paid on their phones
//                 and hasn't been closed yet, stays with its server, so no sale is left unrecorded.
//   clearOn     → "On it": the host stand and everyone clearing see who's taking it (or not after all). Someone else's
//                 isn't taken over while it's fresh, and only its owner lets it go.
//   clearDone   → "Ready to seat": this table is free on the host stand at once (joined tables are each said ready).
// Whoever clears tables is on the team (any role); everything they do here carries their name.
import { readFloor, forgetFloor, tablesOf } from '@/lib/floor-server';
import { floorSettingsOf } from '@/lib/table-stage';
import { tableLabel, visitIdForParty } from '@/lib/table-service';
import { leftUncleared } from '@/lib/seat-next';
import { tenantTimeZone } from '@/lib/tenant-time';
import { clearList, leavingList, type ClearItem, type LeavingItem } from '@/lib/table-reset';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export class ResetStop extends Error { constructor(public msg: string, public status = 409) { super(msg); } }
const nowIso = () => new Date().toISOString();
/** Someone else's "On it" stands this long before another person can take the table over. */
const CLAIM_MS = 10 * 60000;

export type ClearingNow = { session: string | null; toClear: ClearItem[]; leaving: LeavingItem[]; steps: string[]; waitForReady: boolean; clearMin: number };

/** Tonight's tables to clear and the ones leaving soon. */
export async function clearingFor(db: any, T: string, tenant: any): Promise<ClearingNow> {
  const fs = floorSettingsOf(tenant);
  const base = { steps: fs.resetSteps, waitForReady: fs.clearUntil === 'ready', clearMin: fs.clearMin };
  const read = await readFloor(db, T, tenant);
  if (!read.session) return { session: null, toClear: [], leaving: [], ...base };
  const now = Date.now(); const tz = tenantTimeZone(tenant);
  const everyone = [...read.parties, ...(read.lobby || [])];
  const held: Record<string, { name: string; at: string | null }> = {};
  for (const p of everyone) if (p?.id) held[String(p.id)] = { name: String(p.name || 'Guests').slice(0, 40), at: p.arrivesAt || null };
  const waiting = everyone.filter((p: any) => ['waiting', 'notified'].includes(String(p?.status))).map((p: any) => ({ name: String(p.name || ''), size: Number(p.size) || 1, joinedAt: p.joinedAt || null, needs: Array.isArray(p.needs) ? p.needs.map(String) : [] }));
  const timeWords = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(' AM', ' am').replace(' PM', ' pm');
  const toClear = clearList({ tables: tablesOf(read, tenant, now), parties: read.parties, waiting, held, now, label: tableLabel, timeWords });
  return { session: read.session.id, toClear, leaving: leavingList(read.seated.map((t) => t.row), now), ...base };
}

/** The table that paid has left. Returns the walk-in queue row to close too, when they came from it. */
export async function markLeft(db: any, T: string, tenantId: string, partyId: string, by: string): Promise<{ walkInId: string | null }> {
  if (!ID.test(partyId)) throw new ResetStop('Which table?', 400);
  const pRef = db.doc(`${T}/parties/${partyId}`);
  const r = await db.runTransaction(async (tx: any) => {
    const p: any = (await tx.get(pRef)).data();
    if (!p) throw new ResetStop('That table wasn’t found.', 404);
    if (p.status === 'finished') return { walkInId: null };
    if (p.status !== 'seated') throw new ResetStop('They’re not at a table now.');
    const v: any = (await tx.get(db.doc(`${T}/appointments/${visitIdForParty({ ...p, id: partyId })}`))).data() || null;
    const tab: any[] = Array.isArray(v?.tab) ? v.tab : [];
    const booked = (Array.isArray(p.guestIds) ? p.guestIds : []).some((g: any) => String(g).startsWith('appt:'));
    // Closed (checked out), or nothing was ever ordered. Paid on their phones but not closed: their server closes it.
    const closed = !!v && v.status === 'completed';
    if (!closed && (booked || tab.length)) throw new ResetStop(v?.payPaidAt ? 'They paid at the table, but the check isn’t closed yet. Their server closes it first.' : 'They haven’t paid yet. Their server or the host can close the table.');
    tx.set(pRef, { status: 'finished', finishedAt: nowIso(), leftBy: by.slice(0, 60) }, { merge: true });
    const key = (Array.isArray(p.guestIds) ? p.guestIds : []).map(String).find((g: string) => g.startsWith('walkin:'));
    return { walkInId: key ? key.slice('walkin:'.length) : null };
  });
  forgetFloor(tenantId);
  return r;
}

/** The parties that left this table and nobody has said it's ready, the latest first (tonight's, read fresh). */
async function leftAt(db: any, T: string, tenant: any, unitId: string): Promise<any[]> {
  if (!ID.test(unitId)) throw new ResetStop('Which table?', 400);
  const read = await readFloor(db, T, tenant);
  if (!read.session) throw new ResetStop('Tonight’s floor isn’t open.');
  const snap = await db.collection(`${T}/parties`).where('sessionId', '==', read.session.id).where('status', '==', 'finished').limit(400).get();
  const list = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((p: any) => leftUncleared(p, unitId) && ID.test(String(p.id)))
    .sort((a: any, b: any) => Date.parse(b.finishedAt || '') - Date.parse(a.finishedAt || ''));
  if (!list.length) throw new ResetStop('That table is ready already.');
  return list;
}

/** "On it" (on), or not after all. */
// A tap kept on a phone through a Wi-Fi drop says when it was tapped: guests who left after that (a minute's grace for
// the phone's clock) aren't what it meant.
const leftBy = (p: any, tappedAt: number | null) => tappedAt === null || (Date.parse(p.finishedAt || '') || 0) <= tappedAt + 60000;
export async function clearOn(db: any, T: string, tenant: any, tenantId: string, unitId: string, by: string, on: boolean, tappedAt: number | null = null): Promise<{ by: string | null }> {
  const [p] = (await leftAt(db, T, tenant, unitId)).filter((x: any) => leftBy(x, tappedAt));
  if (!p) throw new ResetStop('That table is ready already.');
  const ref = db.doc(`${T}/parties/${p.id}`);
  const out = await db.runTransaction(async (tx: any) => {
    const cur: any = (await tx.get(ref)).data();
    if (!cur || !leftUncleared(cur, unitId)) throw new ResetStop('That table is ready already.');
    const who = cur.clearOn?.by ? String(cur.clearOn.by) : null; const me = by.slice(0, 60);
    const fresh = !!who && Date.now() - Date.parse(cur.clearOn?.at || '') < CLAIM_MS;
    if (on && who && who !== me && fresh) throw new ResetStop(`${who} is on it.`);
    if (!on && who && who !== me) throw new ResetStop(`${who} is on it, so it’s theirs to let go.`);
    tx.set(ref, { clearOn: on ? { by: me, at: nowIso() } : null }, { merge: true });
    return { by: on ? me : null };
  });
  forgetFloor(tenantId);
  return out;
}

/** "Ready to seat": the table is free again. */
export async function clearDone(db: any, T: string, tenant: any, tenantId: string, unitId: string, by: string, tappedAt: number | null = null): Promise<{ cleared: number }> {
  const list = (await leftAt(db, T, tenant, unitId)).filter((x: any) => leftBy(x, tappedAt));
  const at = nowIso(); let cleared = 0;
  await db.runTransaction(async (tx: any) => {
    const refs = list.slice(0, 10).map((p: any) => db.doc(`${T}/parties/${p.id}`));
    const snaps = await Promise.all(refs.map((r: any) => tx.get(r)));
    snaps.forEach((s: any, i: number) => {
      const cur: any = s.data(); if (!cur || !leftUncleared(cur, unitId)) return;
      // This table is ready; the party is done with once every table it sat at is.
      const units = (Array.isArray(cur.unitIds) ? cur.unitIds : []).map(String);
      const done = Array.from(new Set([...(Array.isArray(cur.clearedUnits) ? cur.clearedUnits : []).map(String), unitId]));
      tx.set(refs[i], { clearedUnits: done, clearedBy: by.slice(0, 60), ...(units.every((u: string) => done.includes(u)) ? { clearedAt: at } : {}) }, { merge: true }); cleared += 1;
    });
  });
  forgetFloor(tenantId);
  return { cleared };
}
