// src/app/api/callbacks/route.ts — THE CALLBACK QUEUE.
// "I'll have someone call you back" becomes a tracked promise: every call-back
// draft (saved at the desk, or by the AI receptionist) has an owner, a due time,
// how the caller wants to be reached, what they were told, attempts, and an
// outcome when it's done. Same documents as before (tenants/{t}/callBackDrafts),
// so the desk's drafts list and the receptionist's inbox keep working.
//   update  — owner, due, contact method, what they were told, note (+ optionally text them a confirmation)
//   attempt — log a try ("no answer — left a voicemail")
//   resolve — close it with an outcome (required) and a note
//   reopen  — back to the queue
// Staff only.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { logAuditAdmin } from '@/lib/audit';
import { verifyStaffActor } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';
const OUTCOMES = ['booked', 'answered', 'no_answer', 'declined', 'other'] as const;
const CONTACT = ['call', 'text', 'email'] as const;

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), id = String(b.id || ''), action = String(b.action || '');
  if (!tenantId || !id) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const ref = db.doc(`${T}/callBackDrafts/${id}`); const d: any = (await ref.get()).data();
  if (!d) return NextResponse.json({ ok: false, error: 'That call-back wasn’t found.' }, { status: 404 });
  const nowIso = new Date().toISOString(); const me = { id: auth.actor.uid, name: auth.actor.name };
  const actor = { type: 'user' as const, id: auth.actor.uid, name: auth.actor.name, role: auth.actor.role };
  const who = d.callerName || d.clientName || 'a caller';

  if (action === 'update') {
    const f: any = { updatedAt: nowIso };
    if (b.ownerId !== undefined) {
      if (b.ownerId === null || b.ownerId === '') { f.ownerId = null; f.ownerName = null; }
      else { const st: any = b.ownerId === auth.actor.uid ? { name: auth.actor.name } : ((await db.doc(`${T}/staff/${String(b.ownerId)}`).get()).data() as any);
        if (!st) return NextResponse.json({ ok: false, error: 'That team member wasn’t found.' }, { status: 400 });
        f.ownerId = String(b.ownerId); f.ownerName = st.name || null; }
    }
    if (b.dueAt !== undefined) { const t = Date.parse(String(b.dueAt)); if (!Number.isFinite(t)) return NextResponse.json({ ok: false, error: 'Pick a due time.' }, { status: 400 }); f.dueAt = new Date(t).toISOString(); }
    if (b.contactBy !== undefined) { if (!CONTACT.includes(b.contactBy)) return NextResponse.json({ ok: false, error: 'Choose call, text or email.' }, { status: 400 }); f.contactBy = b.contactBy; }
    if (b.promised !== undefined) f.promised = String(b.promised || '').slice(0, 200) || null;
    if (b.note !== undefined) f.note = String(b.note || '').slice(0, 1000);
    await ref.set(f, { merge: true });
    // Optionally, text the caller what to expect ("…will get back to you by 3:00 PM").
    let told = false;
    const phone = String(d.callerPhone || '').trim();
    if (b.tellCaller === true && phone) {
      try {
        const tenant: any = ((await db.doc(T).get()).data() as any) || {};
        const due = f.dueAt || d.dueAt; const owner = f.ownerName ?? d.ownerName;
        const when = due ? new Date(due).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined }) : null;
        const text = `Thanks for calling ${tenant.name || 'us'}${d.callerName ? `, ${String(d.callerName).split(' ')[0]}` : ''}. ${owner ? String(owner).split(' ')[0] : 'We'} will get back to you${when ? ` by ${when}` : ' soon'}.`;
        const { sendNotification } = await import('@/lib/notify');
        told = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'callback_confirmation', text, clientId: d.clientId || null, clientName: who } as any))?.ok;
        if (told) await ref.set({ confirmationSentAt: nowIso }, { merge: true });
      } catch (e) { console.error('[callbacks] confirmation failed', e); }
    }
    return NextResponse.json({ ok: true, told });
  }
  if (action === 'attempt') {
    const note = String(b.note || '').trim().slice(0, 200) || 'Tried — no answer';
    const attempts = [...(Array.isArray(d.attempts) ? d.attempts : []), { at: nowIso, by: me.name, note }].slice(-20);
    await ref.set({ attempts, updatedAt: nowIso, ...(b.nextDueAt && Number.isFinite(Date.parse(b.nextDueAt)) ? { dueAt: new Date(Date.parse(b.nextDueAt)).toISOString() } : {}) }, { merge: true });
    return NextResponse.json({ ok: true, attempts: attempts.length });
  }
  if (action === 'resolve') {
    if (!OUTCOMES.includes(b.outcome)) return NextResponse.json({ ok: false, error: 'Choose what happened.' }, { status: 400 });
    const note = String(b.note || '').trim().slice(0, 500) || null;
    if (b.outcome === 'other' && !note) return NextResponse.json({ ok: false, error: 'Add a short note about what happened.' }, { status: 400 });
    await ref.set({ status: 'resolved', outcome: b.outcome, outcomeNote: note, resolvedAt: nowIso, resolvedBy: me.name, resolvedById: me.id, updatedAt: nowIso }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: 'callback.resolved', targetType: d.clientId ? 'client' : 'callback', targetId: d.clientId || id,
      summary: `Call-back to ${who} — ${String(b.outcome).replace('_', ' ')}${note ? `: ${note}` : ''}`, actor }).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (action === 'reopen') {
    await ref.set({ status: 'pending', outcome: null, resolvedAt: null, resolvedBy: null, updatedAt: nowIso }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
