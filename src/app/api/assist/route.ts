// src/app/api/assist/route.ts — STATION ASSIST (O4). Staff only; every change names who made it.
//   create      { tenantId, kind, label, note?, urgency, neededBy?, resourceId?, stationName?, visitId?, clientName? }
//   accept      { tenantId, id }          — one runner only (two people never both go)
//   deliver     { tenantId, id }
//   cancel      { tenantId, id }          — the requester or a manager
//   propose-sub { tenantId, id, text }    — the runner offers an alternative…
//   decide-sub  { tenantId, id, approve } — …and only the requester approves or declines it
// A student's request goes to the instructors (managers if there are none). Unaccepted requests escalate to managers
// (lib/assist escalateAt; the 5-minute task in /api/cron/no-shows sends the alert).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { escalateAt, type AssistUrgency } from '@/lib/assist';
export const dynamic = 'force-dynamic';

const str = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const KINDS = ['linen', 'supplies', 'help', 'refreshment', 'other'];

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = str(b.tenantId, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing business.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const me = auth.actor; const db = getAdminDb(); const T = `tenants/${tenantId}`; const now = new Date().toISOString();
  const notify = async (patch: any) => { const n = db.collection(`${T}/notifications`).doc(); await n.set({ id: n.id, createdAt: now, read: false, resolved: false, link: '/pos', ...patch }); };

  if (b.action === 'create') {
    const urgency: AssistUrgency = ['now', 'soon', 'by'].includes(b.urgency) ? b.urgency : 'soon';
    const neededBy = urgency === 'by' && Date.parse(b.neededBy || '') ? new Date(Date.parse(b.neededBy)).toISOString() : null;
    if (urgency === 'by' && !neededBy) return NextResponse.json({ ok: false, error: 'Choose when it’s needed by.' }, { status: 400 });
    const meStaff: any = me.uid ? (await db.doc(`${T}/staff/${me.uid}`).get().catch(() => null))?.data?.() || null : null;
    const student = !!meStaff?.isStudent;
    const rec: any = { kind: KINDS.includes(b.kind) ? b.kind : 'other', label: str(b.label, 60) || 'Request', note: str(b.note, 200) || null, urgency, neededBy,
      resourceId: str(b.resourceId, 80) || null, stationName: str(b.stationName, 60) || null, visitId: str(b.visitId, 80) || null, clientName: str(b.clientName, 60) || null,
      status: 'open', requestedById: me.uid || null, requestedByName: me.name, routedTo: student ? 'instructor' : 'team', createdAt: now };
    rec.escalateAt = escalateAt(rec);
    const ref = db.collection(`${T}/assistRequests`).doc(); rec.id = ref.id; await ref.set(rec);
    const msg = `${me.name.split(' ')[0]} needs ${rec.label.toLowerCase()}${rec.stationName ? ` at ${rec.stationName}` : ''}${urgency === 'now' ? ' — now' : neededBy ? ` by ${new Date(neededBy).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}`;
    if (student) {   // students → their instructors (managers when there are none)
      const staff = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      const leads = staff.filter((s: any) => /instructor|educator/i.test(String(s.role || s.title || '')) || s.isInstructor);
      const to = (leads.length ? leads : staff.filter((s: any) => ['owner', 'admin', 'manager'].includes(String(s.role)))).slice(0, 10);
      for (const s of to) await notify({ userId: s.id, type: 'assist', priority: urgency === 'now' ? 'urgent' : 'high', message: `Student request: ${msg}`, assistId: ref.id });
    } else await notify({ userId: null, type: 'assist', priority: urgency === 'now' ? 'urgent' : 'high', message: msg, assistId: ref.id });
    return NextResponse.json({ ok: true, id: ref.id });
  }

  const ref = db.doc(`${T}/assistRequests/${str(b.id, 80)}`);
  if (['accept', 'deliver', 'cancel', 'propose-sub', 'decide-sub'].includes(b.action)) {
    try {
      const out = await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref); if (!snap.exists) throw new Error('That request no longer exists.');
        const r: any = snap.data();
        if (['delivered', 'cancelled'].includes(r.status)) throw new Error('That request is already closed.');
        const mine = r.requestedById && r.requestedById === me.uid;
        if (b.action === 'accept') { if (r.status === 'accepted' && r.acceptedById !== me.uid) throw new Error(`${r.acceptedByName || 'Someone'} is already on it.`);
          tx.update(ref, { status: 'accepted', acceptedById: me.uid || null, acceptedByName: me.name, acceptedAt: now }); return { notifyRequester: `${me.name.split(' ')[0]} is on the way with ${String(r.label).toLowerCase()}`, r }; }
        if (b.action === 'deliver') { tx.update(ref, { status: 'delivered', deliveredById: me.uid || null, deliveredByName: me.name, deliveredAt: now, ...(r.acceptedById ? {} : { acceptedById: me.uid || null, acceptedByName: me.name, acceptedAt: now }) }); return { r }; }
        if (b.action === 'cancel') { if (!mine && !me.isManager) throw new Error('Only the person who asked (or a manager) can cancel it.');
          tx.update(ref, { status: 'cancelled', cancelledByName: me.name, cancelledAt: now }); return { r }; }
        if (b.action === 'propose-sub') { const text = str(b.text, 120); if (!text) throw new Error('Say what you can bring instead.');
          tx.update(ref, { sub: { text, by: me.name, byId: me.uid || null, at: now, decision: null } }); return { notifyRequester: `${me.name.split(' ')[0]} can bring “${text}” instead of ${String(r.label).toLowerCase()} — approve or decline`, r }; }
        if (!r.sub) throw new Error('There’s no alternative to decide on.');   // decide-sub
        if (!mine) throw new Error('Only the person who asked can approve a swap.');
        tx.update(ref, { sub: { ...r.sub, decision: b.approve ? 'approved' : 'declined', decidedAt: now }, ...(b.approve ? { label: r.sub.text, originalLabel: r.label } : {}) });
        return { notifyRunner: r.sub.byId ? { id: r.sub.byId, text: `${me.name.split(' ')[0]} ${b.approve ? 'approved' : 'declined'} “${r.sub.text}”` } : null, r };
      });
      if (out?.notifyRequester && out.r?.requestedById) await notify({ userId: out.r.requestedById, type: 'assist', priority: 'normal', message: out.notifyRequester, assistId: str(b.id, 80) });
      if (out?.notifyRunner) await notify({ userId: out.notifyRunner.id, type: 'assist', priority: 'normal', message: out.notifyRunner.text, assistId: str(b.id, 80) });
      return NextResponse.json({ ok: true });
    } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || 'That didn’t work.') }, { status: 409 }); }
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
