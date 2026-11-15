// src/lib/table-recovery-server.ts — the Making it right case for a table's visit (lib/table-recovery, lib/cases): one
// case a visit, started by the table's own "Something not right?", by the host acting on late food, or by a comp or a
// remake for something that went wrong; whatever happens after joins the same case. The visit claims the case's id
// first (in one step), so two things at one table at the same moment make one case, not two.
import { FieldValue } from 'firebase-admin/firestore';
import { openCase } from '@/lib/cases';
import { caseReasonFor, fixLine, reportItem, wentWrong, type TableFix } from '@/lib/table-recovery';
import type { RequestActor } from '@/lib/request-actor';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const nowIso = () => new Date().toISOString();
const tableName = (v: any) => { const n = String(v?.tableName || '').trim(); return n ? (/^\d/.test(n) ? `Table ${n}` : n) : 'A table'; };
export const guestName = (v: any) => String(v?.clientName || '').trim().slice(0, 120) || `${tableName(v)} guest`;
/** A claim whose case never appeared (the open failed) is let go after this long. */
const CLAIM_MS = 60000;
const MANAGERS = ['owner', 'admin', 'manager'];
const open = (c: any) => !!c && !c.locked && c.status !== 'closed';

type Claim = { id: string; mine: boolean } | null;
/** The visit's case id: the one it has (still being worked, or still being opened), or a new one claimed now. */
async function claim(db: any, T: string, visitId: string): Promise<Claim> {
  const vRef = db.doc(`${T}/appointments/${visitId}`);
  return db.runTransaction(async (tx: any) => {
    const v: any = (await tx.get(vRef)).data(); if (!v) return null;
    const cur = String(v.makeRightCaseId || '');
    if (ID.test(cur)) {
      const c = await tx.get(db.doc(`${T}/cases/${cur}`));
      if (c.exists ? open(c.data()) : Date.now() - Date.parse(String(v.makeRightClaimedAt || '')) < CLAIM_MS) return { id: cur, mine: false };
    }
    const id = db.collection(`${T}/cases`).doc().id;
    tx.set(vRef, { makeRightCaseId: id, makeRightClaimedAt: nowIso() }, { merge: true });
    return { id, mine: true };
  });
}
/** A case someone else is opening right now: wait for it a few seconds. */
async function caseDoc(db: any, T: string, id: string, waitMs = 4000): Promise<any | null> {
  for (let t = 0; ; t += 250) {
    const c: any = (await db.doc(`${T}/cases/${id}`).get()).data();
    if (c || t >= waitMs) return c || null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The visit's case while it's still being worked, or null (without starting one). */
export async function visitCase(db: any, T: string, v: any): Promise<{ id: string; c: any } | null> {
  const id = String(v?.makeRightCaseId || ''); if (!ID.test(id)) return null;
  const c = await caseDoc(db, T, id, Date.now() - Date.parse(String(v?.makeRightClaimedAt || '')) < CLAIM_MS ? 4000 : 0);
  return open(c) ? { id, c } : null;
}

/** The visit's case: the one already open, or a new one. */
export async function caseForVisit(db: any, tenantId: string, actor: RequestActor, visitId: string, o: { via: 'table' | 'floor'; reasonId: string; words: string }): Promise<{ ok: true; id: string; opened: boolean } | { ok: false; error: string }> {
  const T = `tenants/${tenantId}`;
  const cl = await claim(db, T, visitId); if (!cl) return { ok: false, error: 'That table’s visit wasn’t found.' };
  if (!cl.mine) return { ok: true, id: cl.id, opened: false };
  const v: any = (await db.doc(`${T}/appointments/${visitId}`).get()).data() || {};
  const r: any = await openCase(db, tenantId, actor, { via: o.via, appointmentId: visitId, clientId: v.clientId || '', clientName: guestName(v), reasonId: o.reasonId, words: o.words }, { id: cl.id }).catch((e: any) => ({ ok: false, error: String(e?.message || e) }));
  if (!r?.ok) {
    // Let the claim go so the next try opens it.
    await db.runTransaction(async (tx: any) => { const ref = db.doc(`${T}/appointments/${visitId}`); const x: any = (await tx.get(ref)).data() || {}; if (x.makeRightCaseId === cl.id) tx.set(ref, { makeRightCaseId: null, makeRightClaimedAt: null }, { merge: true }); }).catch(() => {});
    return { ok: false, error: r?.error || 'That case couldn’t be opened.' };
  }
  return { ok: true, id: cl.id, opened: true };
}

/** Another report from the same table, on its case: a line on the timeline, and a safety one makes the case a safety
 *  case and calls the managers. */
export async function reportOnCase(db: any, tenantId: string, caseId: string, rep: { label: string; dish: string | null; words: string | null; safety: boolean }) {
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/cases/${caseId}`);
  const c: any = await caseDoc(db, T, caseId); if (!open(c)) return;
  const at = nowIso();
  const text = `Their table’s page again: ${reportItem(rep.label, rep.dish)}${rep.words ? `. “${rep.words.slice(0, 300)}”` : ''}`;
  const patch: any = { updatedAt: at, timeline: FieldValue.arrayUnion({ at, by: 'The table', text }) };
  if (rep.safety && !c.safety) { patch.safety = true; patch.needsManager = true; patch.incident = c.incident || { started: at, whatHappened: rep.words || rep.label, present: [], statements: [], checkIn48At: null }; }
  await ref.set(patch, { merge: true });
  if (rep.safety && !c.safety) {
    const tenant: any = (await db.doc(T).get()).data() || {};
    const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => s.archived !== true);
    const ids = Array.from(new Set([...staff.filter((s: any) => MANAGERS.includes(String(s.role))).map((s: any) => s.id), tenant.userId].filter(Boolean))) as string[];
    const b = db.batch();
    for (const u of ids) { const n = db.collection(`${T}/notifications`).doc(); b.set(n, { id: n.id, userId: u, type: 'case_safety', message: `Action needed: A safety concern has been reported for ${c.clientName || 'a table'} (${rep.label}). A manager is needed now.`, link: `/cases?id=${caseId}`, caseId, createdAt: at, read: false }); }
    await b.commit();
  }
}

/** A comp, a remake or a void at a table: on the visit's case; a case is started for one whose reason means something
 *  went wrong. Only a comp counts as the fix ("Made right at the table", fix chosen), and only on a case with no fix
 *  yet that isn't about safety: a person still closes it, and a safety case keeps its manager's steps. Best-effort:
 *  the comp itself has already happened. */
export async function logTableFix(db: any, tenantId: string, who: { id: string; name: string; role?: string; manager?: boolean }, visitId: string, f: Omit<TableFix, 'by' | 'at'>): Promise<string | null> {
  if (!ID.test(visitId)) return null;
  const T = `tenants/${tenantId}`;
  const v: any = (await db.doc(`${T}/appointments/${visitId}`).get()).data() || {};
  const text = fixLine(f);
  let have = await visitCase(db, T, v);
  if (!have) {
    if (!wentWrong(f.reason)) return null;
    const actor: RequestActor = { staffId: who.id, name: who.name, role: who.role || 'staff', isManager: !!who.manager, isOwner: false, portal: false, caps: [] };
    const r = await caseForVisit(db, tenantId, actor, visitId, { via: 'floor', reasonId: caseReasonFor(f.reason), words: `${text}, at ${tableName(v)}.` });
    if (!r.ok) return null;
    const c = await caseDoc(db, T, r.id); have = open(c) ? { id: r.id, c } : null;
    if (!have) return null;
  }
  const c = have.c; const at = nowIso();
  const patch: any = { tableFixes: FieldValue.arrayUnion({ ...f, by: who.name, at }), updatedAt: at, timeline: FieldValue.arrayUnion({ at, by: who.name, text }) };
  if (f.kind === 'comp' && !c.fix && !c.safety) {
    patch.fix = { kind: 'note', label: 'Made right at the table', amountCents: Math.round((Number(f.amount) || 0) * 100), redoAppointmentId: null, redo: null, by: who.name, approvedBy: null, at, todo: null };
    if (['heard', 'owned'].includes(String(c.status))) patch.status = 'fix_chosen';
  }
  await db.doc(`${T}/cases/${have.id}`).set(patch, { merge: true });
  return have.id;
}
