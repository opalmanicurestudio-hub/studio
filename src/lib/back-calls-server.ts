// src/lib/back-calls-server.ts — CALLS TO THE DISH PIT AND THE BARBACK, kept on the server (lib/back-calls has the rules;
// api/back is the way in). Calls live in tenants/{id}/backCalls, read and written only here.
//   readCalls → the calls still going (and the ones done in the last few minutes, for the station that made them)
//   makeCall  → a station asks; the same thing asked again while it's still going is the same call, not a second one
//   stepCall  → "On my way", "Done", "Cancel" (only by the station that asked), "Not me after all" (only by whoever
//               took it), each once
//   tellLate  → a call nobody has taken after a few minutes: the owner and managers hear, once
//   sweepOld  → calls from before yesterday are removed (a call is for the shift it was made in)
import { callFrom, callQueue, canStep, callWords, DONE_SHOWN_MIN, TO_WORD, type Call, type CallTo } from '@/lib/back-calls';
import { tellManagers } from '@/lib/tell-managers';

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
export async function makeCall(db: any, T: string, ask: { to: CallTo; what: string; note: string | null }, from: { id: string; name: string }, askedBy: string | null): Promise<{ call: Call; already: boolean }> {
  if (!ID.test(from.id)) throw new CallStop('Which station is asking?', 400);
  const col = db.collection(`${T}/${COL}`);
  return db.runTransaction(async (tx: any) => {
    // The calls still going (few, whatever the history), this station's among them.
    const mine = (await tx.get(col.where('status', 'in', ['open', 'coming']).limit(300))).docs.map((d: any) => callFrom(d.id, d.data())).filter((c: Call | null): c is Call => !!c && c.fromId === from.id);
    const same = mine.find((c: Call) => c.to === ask.to && c.what === ask.what && String(c.note || '').toLowerCase() === String(ask.note || '').toLowerCase());
    if (same) return { call: same, already: true };
    if (mine.length >= MAX_OPEN_PER_STATION) throw new CallStop('There are a lot of calls waiting from here. Mark the ones you got as done first.');
    const ref = col.doc(); const at = new Date().toISOString();
    const doc = { id: ref.id, to: ask.to, what: ask.what, note: ask.note, from: String(from.name || 'A station').slice(0, 40), fromId: from.id, askedBy: askedBy ? askedBy.slice(0, 60) : null,
      status: 'open', at, takenBy: null, takenById: null, takenAt: null, doneAt: null, doneBy: null, toldAt: null };
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
  for (const to of ['dish', 'barback'] as CallTo[]) {
    for (const c of callQueue(calls, to, now).filter((x) => x.late && !x.toldAt).slice(0, 5)) {
      const ref = db.doc(`${T}/${COL}/${c.id}`);
      const mine = await db.runTransaction(async (tx: any) => { const cur: any = (await tx.get(ref)).data(); if (!cur || cur.status !== 'open' || cur.toldAt) return false; tx.set(ref, { toldAt: new Date(now).toISOString() }, { merge: true }); return true; }).catch(() => false);
      if (!mine) continue;
      const sent = await tellManagers(db, tenantId, tenant, { type: 'back_call_waiting', priority: 'high', link: `/${to}/${tenantId}`,
        message: `${c.from} asked ${TO_WORD[to].toLowerCase()} for ${callWords(c.to, c.what, c.note).toLowerCase()} ${c.mins} minutes ago, and nobody has taken it yet.` });
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
