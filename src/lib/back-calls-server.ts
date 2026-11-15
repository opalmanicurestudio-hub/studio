// src/lib/back-calls-server.ts — CALLS TO THE DISH PIT AND THE BARBACK, kept on the server (lib/back-calls has the rules;
// api/back is the way in). Calls live in tenants/{id}/backCalls, read and written only here.
//   readCalls → the calls still going (and the ones done in the last few minutes, for the station that made them)
//   makeCall  → a station asks; the same thing asked again while it's still going is the same call, not a second one
//   stepCall  → "On my way", "Done", "Cancel" (only by the station that asked), "Not me after all" (only by whoever
//               took it), each once
//   tellLate  → a call nobody has taken after a few minutes: the owner and managers hear, once
//   sweepOld  → calls from before yesterday are removed (a call is for the shift it was made in)
//   whoFor    → a call to people: who it goes to (the runners, the table's server, the managers), with its table, and for
//               a run from expo, what's on it; tellPeople buzzes them; runsDone closes a run once expo sends it out
import { callFrom, callLine, callQueue, canStep, callWords, DONE_SHOWN_MIN, PEOPLE, TO_WORD, type Call, type CallTo } from '@/lib/back-calls';
import { managerIds, tellManagers } from '@/lib/tell-managers';
import { sectionOf } from '@/lib/floor-buzz';
import { jobDef } from '@/lib/jobs';
import { LIVE } from '@/lib/shift-check';
import { PUSH_TIER } from '@/lib/push-tier';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const COL = 'backCalls';
/** Calls still going from one station at once: a tap that keeps landing is a stuck finger, not twenty needs. */
export const MAX_OPEN_PER_STATION = 12;
export class CallStop extends Error { constructor(public msg: string, public status = 409) { super(msg); } }

/** The calls still going, and the ones done in the last few minutes. */
export async function readCalls(db: any, T: string, now = Date.now()): Promise<Call[]> {
  const since = new Date(now - DONE_SHOWN_MIN * 60000).toISOString();
  const [going, done] = await Promise.all([
    db.collection(`${T}/${COL}`).where('status', 'in', ['open', 'coming']).limit(300).get(),
    db.collection(`${T}/${COL}`).where('doneAt', '>=', since).limit(100).get().catch(() => ({ docs: [] as any[] })),
  ]);
  const out = new Map<string, Call>();
  for (const d of [...going.docs, ...done.docs]) { const c = callFrom(d.id, d.data()); if (c) out.set(d.id, c); }
  return Array.from(out.values());
}

/** A station asks. Asked again while the first is still going, it's the same call (`already`). */
export async function makeCall(db: any, T: string, ask: { to: CallTo; what: string; note: string | null }, from: { id: string; name: string }, askedBy: string | null,
  people: PeopleCall | null = null): Promise<{ call: Call; already: boolean }> {
  if (!ID.test(from.id)) throw new CallStop('Which station is asking?', 400);
  const col = db.collection(`${T}/${COL}`);
  return db.runTransaction(async (tx: any) => {
    // The calls still going (few, whatever the history), this station's among them.
    const mine = (await tx.get(col.where('status', 'in', ['open', 'coming']).limit(300))).docs.map((d: any) => callFrom(d.id, d.data())).filter((c: Call | null): c is Call => !!c && c.fromId === from.id);
    const sameNote = (c: Call) => String(c.note || '').toLowerCase() === String(ask.note || '').toLowerCase();
    // A call to people is the same call for the same table (and course), and for "Something else", the same words.
    const same = mine.find((c: Call) => c.to === ask.to && c.what === ask.what && (people ? c.visitId === people.visitId && c.course === people.course && (ask.what !== 'other' || sameNote(c)) : sameNote(c)));
    if (same) {
      // A run asked for again with more of the table's plates now ready: the same run, with them on it.
      if (people && ask.to === 'runner' && ask.what === 'run' && people.ticketIds.some((x) => !same.ticketIds.includes(x))) {
        const ids = Array.from(new Set([...same.ticketIds, ...people.ticketIds])).slice(0, 40);
        const note = people.note !== undefined ? people.note : same.note;
        tx.set(col.doc(same.id), { ticketIds: ids, note }, { merge: true });
        return { call: { ...same, ticketIds: ids, note: note ?? null }, already: true };
      }
      return { call: same, already: true };
    }
    if (mine.length >= MAX_OPEN_PER_STATION) throw new CallStop('There are a lot of calls waiting from here. Mark the ones you got as done first.');
    const ref = col.doc(); const at = new Date().toISOString();
    const doc = { id: ref.id, to: ask.to, what: ask.what, note: people?.note !== undefined ? people.note : ask.note, from: String(from.name || 'A station').slice(0, 40), fromId: from.id, askedBy: askedBy ? askedBy.slice(0, 60) : null,
      status: 'open', at, takenBy: null, takenById: null, takenAt: null, doneAt: null, doneBy: null, toldAt: null,
      ...(people ? { table: people.table, visitId: people.visitId, course: people.course, forIds: people.forIds, ticketIds: people.ticketIds } : {}) };
    tx.set(ref, doc);
    return { call: callFrom(ref.id, doc)!, already: false };
  });
}

/** One step on a call. "On my way" on one someone else already took says who (`already`); done twice is fine. */
export async function stepCall(db: any, T: string, id: string, step: 'coming' | 'done' | 'cancel' | 'release', by: { id: string; name: string }, fromId: string): Promise<{ call: Call; already: boolean }> {
  if (!ID.test(id)) throw new CallStop('That call isn’t here any more.', 404);
  const ref = db.doc(`${T}/${COL}/${id}`);
  return db.runTransaction(async (tx: any) => {
    const s = await tx.get(ref); const c = s.exists ? callFrom(id, s.data()) : null;
    if (!c) throw new CallStop('That call isn’t here any more.', 404);
    if (!canStep(c.status, step)) {
      if ((step === 'coming' && c.status === 'coming') || (step === 'done' && c.status === 'done') || (step === 'cancel' && c.status === 'cancelled')) return { call: c, already: true };
      throw new CallStop(c.status === 'done' ? 'That one’s already done.' : c.status === 'cancelled' ? 'That call was cancelled.' : step === 'cancel' ? `${c.takenBy || 'Someone'} is already on the way.` : 'That call has moved on.');
    }
    // Who took it is known by id (the person's PIN or sign-in, else the screen), never by a name two people could share.
    if (step === 'release' && (c.takenById ? c.takenById !== by.id : c.takenBy !== by.name)) throw new CallStop(`${c.takenBy || 'Someone else'} took this one. Only they can let it go.`);
    if (step === 'cancel' && c.fromId !== fromId) throw new CallStop('Only the station that asked can cancel it.', 403);
    const at = new Date().toISOString(); const who = by.name.slice(0, 60); const whoId = by.id.slice(0, 80);
    const patch = step === 'coming' ? { status: 'coming', takenBy: who, takenById: whoId, takenAt: at }
      : step === 'done' ? { status: 'done', doneAt: at, doneBy: who, ...(c.takenBy ? {} : { takenBy: who, takenById: whoId, takenAt: at }) }
      : step === 'cancel' ? { status: 'cancelled', cancelledAt: at, cancelledBy: who }
      : { status: 'open', takenBy: null, takenById: null, takenAt: null };
    tx.set(ref, patch, { merge: true });
    return { call: callFrom(id, { ...s.data(), ...patch })!, already: false };
  });
}

/** Calls nobody has taken in time: the owner and managers hear, once for each (claimed first, so two screens reading at
 *  the same moment don't both tell them). */
export async function tellLate(db: any, tenantId: string, tenant: any, calls: Call[], now = Date.now()): Promise<number> {
  const T = `tenants/${tenantId}`; let told = 0;
  for (const to of ['dish', 'barback', 'runner', 'server', 'manager'] as CallTo[]) {
    for (const c of callQueue(calls, to, now).filter((x) => x.late && !x.toldAt).slice(0, 5)) {
      const ref = db.doc(`${T}/${COL}/${c.id}`);
      const mine = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(ref)).data(); if (!cur || cur.status !== 'open' || cur.toldAt) return false; tx.set(ref, { toldAt: new Date(now).toISOString() }, { merge: true }); return true; }).catch(() => false);
      if (!mine) continue;
      const sent = await tellManagers(db, tenantId, tenant, { type: 'back_call_waiting', priority: 'high', link: PEOPLE.includes(to) ? '/tables' : `/${to}/${tenantId}`,
        message: PEOPLE.includes(to) ? `${c.from} called ${TO_WORD[to].toLowerCase()} (${callLine(c).toLowerCase()}) ${c.mins} minutes ago, and nobody has taken it yet.`
          : `${c.from} asked ${TO_WORD[to].toLowerCase()} for ${callWords(c.to, c.what, c.note).toLowerCase()} ${c.mins} minutes ago, and nobody has taken it yet.` });
      // Not written (the database didn't take it): let it go, so the next check tries again.
      if (sent < 0) { await ref.set({ toldAt: null }, { merge: true }).catch(() => undefined); continue; }
      told++;
    }
  }
  return told;
}

/** Calls from before yesterday are removed: a call is for the shift it was made in. A few at a time. */
export async function sweepOld(db: any, T: string, now = Date.now()): Promise<number> {
  const before = new Date(now - 2 * 86400000).toISOString();
  const snap = await db.collection(`${T}/${COL}`).where('at', '<', before).limit(100).get().catch(() => ({ docs: [] as any[] }));
  if (!snap.docs.length) return 0;
  const b = db.batch(); for (const d of snap.docs) b.delete(d.ref); await b.commit().catch(() => undefined);
  return snap.docs.length;
}

// ── CALLS TO PEOPLE ──────────────────────────────────────────────────────────────────────────────────────────────────
export type PeopleCall = { table: string | null; visitId: string | null; course: string | null; forIds: string[]; ticketIds: string[]; note?: string | null };
const off = (s: any) => !s || s.isActive === false || s.status === 'archived' || s.archived === true || s.isRenter === true || s.role === 'renter';
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const courseOf = (t: any) => (t?.course === null || t?.course === undefined ? 'now' : String(t.course));

/** Who a call to people goes to, and what it's about. A run from expo names its table's visit, its course and its plates
 *  (still ready, of that visit); a call to a table's server names the table. Runners: whoever has the runner job (those
 *  on tonight's schedule, when any are); with no runners, the table's server. A table nobody has, or no server: the
 *  managers. */
export async function whoFor(db: any, tenantId: string, tenant: any, to: CallTo, what: string, o: { visitId?: unknown; course?: unknown; ticketIds?: unknown }, day: string): Promise<PeopleCall> {
  const T = `tenants/${tenantId}`;
  const visitId = typeof o.visitId === 'string' && ID.test(o.visitId) ? o.visitId : null;
  const needsTable = (to === 'runner' && what === 'run') || to === 'server';
  if (needsTable && !visitId) throw new CallStop('Which table?', 400);
  let table: string | null = null; let section: string[] = []; let note: string | null | undefined; let ticketIds: string[] = []; let course: string | null = null;
  if (visitId) {
    const v: any = (await db.doc(`${T}/appointments/${visitId}`).get()).data();
    if (!v) throw new CallStop('That table isn’t here any more.', 404);
    const sec = v.partyId && ID.test(String(v.partyId)) ? await sectionOf(db, T, String(v.partyId)) : null;
    table = sec?.table || clip(v.tableName ? (/^\d+[a-z]?$/i.test(String(v.tableName)) ? `Table ${v.tableName}` : v.tableName) : 'A table', 40);
    section = sec?.staffIds || [];
  }
  if (to === 'runner' && what === 'run') {
    const want = Array.isArray(o.ticketIds) ? Array.from(new Set(o.ticketIds.map(String).filter((x) => ID.test(x)))).slice(0, 30) : [];
    if (!want.length) throw new CallStop('Which plates?', 400);
    const docs = await db.getAll(...want.map((id) => db.doc(`${T}/kdsTickets/${id}`)));
    const plates = docs.filter((d: any) => d.exists).map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((t: any) => String(t.visitId || '') === visitId && t.status === 'ready');
    if (!plates.length) throw new CallStop('Those plates aren’t waiting at the pass any more.', 409);
    ticketIds = plates.map((t: any) => t.id);
    const c = courseOf(plates[0]); course = c === 'now' ? null : clip(plates[0].courseName || `Course ${c}`, 20);
    const names = plates.map((t: any) => `${clip(t.menuItemName || t.itemName || 'A dish', 30)}${Number(t.quantity) > 1 ? ` × ${Math.round(Number(t.quantity))}` : ''}`);
    note = clip(names.slice(0, 6).join(', ') + (names.length > 6 ? ' and more' : ''), 200);
  }
  let forIds: string[] = [];
  if (to === 'runner') {
    const staff = (await db.collection(`${T}/staff`).limit(400).get()).docs.filter((d: any) => !off(d.data()) && jobDef(d.data()?.job)?.id === 'runner').map((d: any) => d.id);
    const shifts = staff.length ? await db.collection(`${T}/shifts`).where('date', '==', day).limit(300).get().catch(() => ({ docs: [] })) : { docs: [] };
    const on = new Set<string>(shifts.docs.map((d: any) => d.data() || {}).filter((x: any) => LIVE(x) && (!x.kind || x.kind === 'work') && x.status !== 'draft').map((x: any) => String(x.staffId || '')));
    forIds = staff.some((id: string) => on.has(id)) ? staff.filter((id: string) => on.has(id)) : staff;
    if (!forIds.length) forIds = section;
  } else if (to === 'server') forIds = section;
  // Only people still on the team (a section can name someone who's left).
  if (forIds.length && to !== 'manager') {
    const docs = await db.getAll(...forIds.slice(0, 40).map((id) => db.doc(`${T}/staff/${id}`)));
    forIds = docs.filter((d: any) => d.exists && !off(d.data())).map((d: any) => d.id);
  }
  if (!forIds.length || to === 'manager') forIds = Array.from(new Set([...forIds, ...(await managerIds(db, tenantId, tenant).catch(() => [] as string[]))]));
  return { table, visitId, course, forIds: forIds.slice(0, 40), ticketIds, ...(note !== undefined ? { note } : {}) };
}

/** Each person a call went to hears it on their phone, at once. */
export async function tellPeople(db: any, tenantId: string, call: Call): Promise<number> {
  try {
    if (!PEOPLE.includes(call.to) || !call.forIds.length) return 0;
    const T = `tenants/${tenantId}`; const now = new Date().toISOString(); const b = db.batch();
    const message = call.to === 'runner' && call.what === 'run' ? `Food to run, ${callLine(call)}` : `${call.from} needs you: ${callLine(call)}`;
    for (const userId of call.forIds) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId, type: 'kitchen_call', message: message.slice(0, 300), link: '/tables', priority: 'high', read: false, createdAt: now }); }
    await b.commit();
    if (PUSH_TIER.kitchen_call === 'now') { const { pushNow } = await import('@/lib/push'); await pushNow(db, tenantId).catch(() => undefined); }
    return call.forIds.length;
  } catch { return 0; }
}

/** Expo sent plates out: any run for them is done (whoever had it, or expo itself). */
export async function runsDone(db: any, T: string, ticketIds: string[], by: string): Promise<number> {
  try {
    const ids = new Set(ticketIds.filter((x) => ID.test(x))); if (!ids.size) return 0;
    const snap = await db.collection(`${T}/${COL}`).where('status', 'in', ['open', 'coming']).limit(300).get();
    let n = 0;
    for (const d of snap.docs) {
      const c = callFrom(d.id, d.data()); if (!c || c.to !== 'runner' || c.what !== 'run' || !c.ticketIds.some((x) => ids.has(x))) continue;
      const at = new Date().toISOString();
      await d.ref.set({ status: 'done', doneAt: at, doneBy: c.takenBy || clip(by, 60), ...(c.takenBy ? {} : { takenBy: clip(by, 60), takenAt: at }) }, { merge: true }); n++;
    }
    return n;
  } catch { return 0; }
}
