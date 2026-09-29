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
import { linkOrigin } from '@/lib/app-origin';
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
  if (!tenantId || (!id && action !== 'create')) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  // create — a new call-back from the desk's booking sheet (saved on the server, with what's needed to resume it).
  if (action === 'create') {
    const { callbackReason, callbackTargetIso } = await import('@/lib/callback-reasons');
    const nowIso0 = new Date().toISOString();
    const reason = String(b.reason || 'other'); const promised = b.timePromised === true && Number.isFinite(Date.parse(String(b.dueAt || '')));
    const contactBy = CONTACT.includes(b.contactBy) ? b.contactBy : 'call';
    const phone = String(b.callerPhone || '').trim().slice(0, 40), email = String(b.callerEmail || '').trim().toLowerCase().slice(0, 160);
    if (contactBy === 'email' ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : phone.replace(/\D/g, '').length < 7)
      return NextResponse.json({ ok: false, error: contactBy === 'email' ? 'They prefer email — add their email address.' : 'Add their phone number.' }, { status: 400 });
    if (promised && Date.parse(String(b.dueAt)) <= Date.now()) return NextResponse.json({ ok: false, error: 'The promised time needs to be later than now.' }, { status: 400 });
    const owner: any = b.ownerId ? (b.ownerId === auth.actor.uid ? { name: auth.actor.name } : ((await db.doc(`${T}/staff/${String(b.ownerId)}`).get()).data() as any)) : null;
    const ref0 = id ? db.doc(`${T}/callBackDrafts/${id}`) : db.collection(`${T}/callBackDrafts`).doc();
    const prev: any = id ? ((await ref0.get()).data() || {}) : {};
    await ref0.set({
      id: ref0.id, tenantId, createdAt: prev.createdAt || nowIso0, updatedAt: nowIso0, createdByStaffId: prev.createdByStaffId || auth.actor.uid,
      callerName: String(b.callerName || '').trim().slice(0, 80) || 'Unknown caller', callerPhone: phone, callerEmail: email || null,
      clientId: b.clientId ? String(b.clientId) : null, clientName: String(b.callerName || '').trim().slice(0, 80),
      note: String(b.note || '').slice(0, 1000), promised: String(b.promised || '').trim().slice(0, 200) || null,
      reason, reasonLabel: callbackReason(reason).label, urgent: !!callbackReason(reason).urgent,
      timePromised: promised, dueAt: promised ? new Date(Date.parse(String(b.dueAt))).toISOString() : callbackTargetIso(reason),
      contactBy, ownerId: owner ? String(b.ownerId) : null, ownerName: owner?.name || null,
      snapshot: b.snapshot && typeof b.snapshot === 'object' && JSON.stringify(b.snapshot).length <= 20000 ? b.snapshot : (prev.snapshot || null),
      snapshotKind: 'staff_book_sheet', status: 'pending', source: 'desk',
    }, { merge: true });
    return NextResponse.json({ ok: true, id: ref0.id });
  }
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
    if (b.dueAt !== undefined) { const t = Date.parse(String(b.dueAt)); if (!Number.isFinite(t)) return NextResponse.json({ ok: false, error: 'Pick a due time.' }, { status: 400 }); f.dueAt = new Date(t).toISOString(); if (typeof b.timePromised === 'boolean') f.timePromised = b.timePromised; }
    if (b.contactBy !== undefined) { if (!CONTACT.includes(b.contactBy)) return NextResponse.json({ ok: false, error: 'Choose call, text or email.' }, { status: 400 }); f.contactBy = b.contactBy; }
    if (b.promised !== undefined) f.promised = String(b.promised || '').slice(0, 200) || null;
    if (b.note !== undefined) f.note = String(b.note || '').slice(0, 1000);
    await ref.set(f, { merge: true });
    // Optionally, tell the caller what to expect — the way they asked to be reached
    // (email if they prefer email; otherwise a text).
    let told = false; let toldBy: 'sms' | 'email' | null = null;
    const phone = String(d.callerPhone || '').trim();
    const contact = f.contactBy || d.contactBy || 'call';
    if (b.tellCaller === true) {
      try {
        const tenant: any = ((await db.doc(T).get()).data() as any) || {};
        const cl: any = d.clientId ? (((await db.doc(`${T}/clients/${d.clientId}`).get()).data() as any) || {}) : {};
        const email = String(d.callerEmail || cl.email || '').trim();
        const due = f.dueAt || d.dueAt; const owner = f.ownerName ?? d.ownerName;
        const tz = tenant.timezone || undefined;
        const dayOf = (x: Date) => x.toLocaleDateString('en-US', { timeZone: tz });
        // Only a time staff chose to promise is ever told to the caller — otherwise "as soon as we can".
        const promisedTime = (f.timePromised ?? d.timePromised) === true;
        const when = due && promisedTime ? (() => { const t = new Date(due); const time = t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
          return dayOf(t) === dayOf(new Date()) ? time : `${t.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz })} at ${time}`; })() : null;
        const studio = tenant.name || 'us';
        const text = `Thanks for calling ${studio}${d.callerName && d.callerName !== 'Unknown caller' ? `, ${String(d.callerName).split(' ')[0]}` : ''}. ${owner ? String(owner).split(' ')[0] : 'We'} will get back to you${when ? ` by ${when}` : ' as soon as we can'}.`;
        const { sendNotification } = await import('@/lib/notify');
        // The richer email (Settings → Messages → Call-back confirmations; each part can be switched off).
        const cfg = { summary: true, callerId: true, links: true, addDetails: true, ...(tenant.callbackEmail || {}) };
        const bizPhone = String(tenant.phone || tenant.twilioPhoneNumber || '').trim() || null;
        const bizEmail = String(tenant.email || tenant.contactEmail || tenant.ownerEmail || '').trim() || null;
        const origin = linkOrigin(tenant, req.nextUrl.origin);
        const reasonId = String(d.reason || '');
        const about = cfg.summary && reasonId && reasonId !== 'other' ? (d.reasonLabel || '').toLowerCase() : '';
        const bookLink = cfg.links && ['book', 'change', 'running_late', 'service_question', 'clinic'].includes(reasonId) ? `${origin}/book/${tenantId}` : null;
        let detailsLink: string | null = null;
        if (cfg.addDetails) {
          const tok = d.detailsToken || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
          if (!d.detailsToken) await ref.set({ detailsToken: tok }, { merge: true });
          detailsLink = `${origin}/callback/${tenantId}/${id}?k=${tok}`;
        }
        if (contact === 'email' && email.includes('@')) {
          const { brandedEmailHtml } = await import('@/lib/email-template');
          const lines = [text,
            ...(about ? [`We’ll be following up about: ${about}.`] : []),
            ...(cfg.callerId && contact === 'email' && bizPhone && (f.contactBy || d.contactBy) !== 'email' ? [`We’ll call from ${bizPhone}.`] : []),
            ...(detailsLink ? ['Before we get back to you, you can add a little more detail — only if you’d like to.'] : []),
            bizEmail ? `If it becomes urgent, or the time no longer works, just reply to this email${bizPhone ? ` or call us at ${bizPhone}` : ''}.` : bizPhone ? `If it becomes urgent, call us at ${bizPhone}.` : ''].filter(Boolean);
          told = !!(await sendNotification(db, { tenantId, channel: 'email', to: email, subject: `We’ll get back to you — ${studio}`, kind: 'callback_confirmation',
            html: brandedEmailHtml({ studioName: studio, title: 'Thanks for calling', bodyLines: lines,
              ...(detailsLink ? { cta: { label: 'Add details', url: detailsLink } } : {}), ...(bookLink ? { secondaryCta: { label: 'Book online', url: bookLink } } : {}) } as any),
            ...(bizEmail ? { replyTo: bizEmail } : {}), clientId: d.clientId || null, clientName: who } as any))?.ok;
          if (told) toldBy = 'email';
        } else if (contact !== 'email' && phone) {
          const smsText = `${text}${about ? ` It’s about ${about}.` : ''}${cfg.callerId && contact === 'call' && bizPhone ? ` We’ll call from ${bizPhone}.` : ''}${detailsLink ? ` Add details (optional): ${detailsLink}` : ''}`;
          told = !!(await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'callback_confirmation', text: smsText, clientId: d.clientId || null, clientName: who } as any))?.ok;
          if (told) toldBy = 'sms';
        }
        if (told) await ref.set({ confirmationSentAt: nowIso, confirmationSentBy: toldBy }, { merge: true });
      } catch (e) { console.error('[callbacks] confirmation failed', e); }
    }
    return NextResponse.json({ ok: true, told, toldBy });
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
