// src/lib/arrival-nudge-server.ts — THE NUDGE AND THE ANSWER, on the server (lib/arrival-nudge has the rules and words).
// nudgeProvider: once a guest is checked in (by the desk or the planner through api/arrival, by the kiosk in
// api/walkins, by their own link in api/checkins), their provider gets one "Sam is here" alert, buzzed at once
// (lib/push pushNow), and the visit records who was told and whether their phone buzzed. Again (the desk's Nudge again):
// only with no answer yet, at most once a minute. Nobody is nudged about a renter's guest (renters are texted in their
// own name), a visit with no provider or already under way, or by the provider themselves.
// replyToArrival: the provider (or a manager for them) answers; the desk and the guest's page read it from the visit.
import { AGAIN_AFTER_MIN, AGAIN_GAP_MS, STARTED, buzzOf, firstOf, isReply, viaWords, type ReplyKind } from '@/lib/arrival-nudge';
import { tenantTimeZone } from '@/lib/tenant-time';

const isHere = (a: any) => ['arrived', 'checked_in', 'checkedIn'].includes(String(a?.checkInStatus || '')) && !STARTED.includes(String(a?.status || '')) && String(a?.stage || '') !== 'in_service';
const ms = (v: any) => { const t = Date.parse(String(v?.toDate ? v.toDate().toISOString() : v || '')); return Number.isFinite(t) ? t : 0; };

export type NudgeResult = { told: boolean; why?: 'gone' | 'renter' | 'no provider' | 'not here' | 'started' | 'already told' | 'self' | 'answered' | 'not told' | 'too soon'; buzz?: string };

export async function nudgeProvider(db: any, tenantId: string, appointmentId: string, opts: { via: string; by?: string | null; again?: boolean; tenant?: any }): Promise<NudgeResult> {
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/appointments/${appointmentId}`);
  const tenant = opts.tenant || ((await db.doc(T).get()).data() || {});
  const nowIso = new Date().toISOString(); const now = Date.parse(nowIso);
  const claim: any = await db.runTransaction(async (tx: any) => {
    const a: any = (await tx.get(ref)).data();
    if (!a) return { why: 'gone' };
    if (a.isRenterBooking || a.renterId) return { why: 'renter' };
    if (!a.staffId) return { why: 'no provider' };
    if (STARTED.includes(String(a.status || '')) || String(a.stage || '') === 'in_service') return { why: 'started' };
    if (!isHere(a)) return { why: 'not here' };
    const n = a.arrivalNudge || null;
    if (!opts.again && n?.at) return { why: 'already told' };
    if (!opts.again && opts.by && opts.by === a.staffId) return { why: 'self' };
    if (opts.again && isReply(a.arrivalReply?.kind)) return { why: 'answered' };
    if (opts.again && !n?.at) return { why: 'not told' };
    // Again: three minutes after the first with no answer (sooner when the buzz failed), and never within a minute.
    if (opts.again && ((now - ms(n.at) < AGAIN_AFTER_MIN * 60000 && n.buzz !== 'failed') || (n.lastAt && now - ms(n.lastAt) < AGAIN_GAP_MS))) return { why: 'too soon' };
    const staff: any = (await tx.get(db.doc(`${T}/staff/${a.staffId}`))).data() || {};
    let svc = String(a.serviceName || '');
    if (!svc && a.serviceId) svc = String(((await tx.get(db.doc(`${T}/services/${a.serviceId}`))).data() || {}).name || '');
    let when = ''; try { when = a.startTime && !a.noBookedTime ? new Date(ms(a.startTime)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenantTimeZone(tenant) }) : ''; } catch { /* no time */ }
    const who = firstOf(a.clientName) || 'Your guest';
    const what = `${when ? ` for their ${when}` : ''}${svc ? ` ${svc.toLowerCase()}` : ''}`;
    const nref = db.collection(`${T}/notifications`).doc();
    tx.set(nref, { id: nref.id, userId: a.staffId, read: false, createdAt: nowIso, type: 'guest_arrived', priority: 'high', appointmentId, link: `/planner?visit=${appointmentId}`,
      title: opts.again ? `${who} is still waiting` : `${who} is here`,
      message: opts.again ? `${who} is still waiting${what}. The desk is asking again.` : `${who} is here${what}. ${viaWords(opts.via)}` });
    tx.set(ref, { arrivalNudge: { at: n?.at || nowIso, lastAt: nowIso, count: (Number(n?.count) || 0) + 1, to: a.staffId, toName: firstOf(staff.name) || null, via: n?.via || opts.via, buzz: null, noteId: nref.id } }, { merge: true });
    return { noteId: nref.id };
  });
  if (!claim?.noteId) return { told: false, why: claim?.why };
  // Buzz now, then say on the visit whether it did (no phone set up, alerts paused, failed): the desk shows it.
  try { await (await import('@/lib/push')).pushNow(db, tenantId); } catch { /* the 1-minute job sends it */ }
  const buzz = buzzOf((await db.doc(`${T}/notifications/${claim.noteId}`).get()).data()?.pushResult);
  await ref.set({ arrivalNudge: { buzz } }, { merge: true }).catch(() => null);
  return { told: true, buzz };
}

export async function replyToArrival(db: any, tenantId: string, appointmentId: string, kind: ReplyKind, actor: { uid: string; name: string; isManager: boolean }):
  Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const T = `tenants/${tenantId}`; const ref = db.doc(`${T}/appointments/${appointmentId}`);
  return db.runTransaction(async (tx: any) => {
    const a: any = (await tx.get(ref)).data();
    if (!a) return { ok: false, error: 'This visit isn’t here any more.', status: 404 };
    if (a.staffId !== actor.uid && !actor.isManager) return { ok: false, error: 'Only their provider, or a manager, can answer for this visit.', status: 403 };
    if (!isHere(a)) return { ok: false, error: STARTED.includes(String(a.status || '')) || a.stage === 'in_service' ? 'This visit has already started.' : 'They aren’t checked in.', status: 409 };
    const staff: any = a.staffId === actor.uid ? { name: actor.name } : (await tx.get(db.doc(`${T}/staff/${a.staffId}`))).data() || {};
    const at = new Date().toISOString();
    tx.set(ref, { arrivalReply: { kind, at, by: actor.uid, byName: firstOf(actor.name) || null, for: firstOf(staff.name) || null } }, { merge: true });
    // The alert that asked is answered: off their list.
    if (a.arrivalNudge?.noteId) tx.set(db.doc(`${T}/notifications/${a.arrivalNudge.noteId}`), { read: true, ackAt: at }, { merge: true });
    return { ok: true };
  });
}
