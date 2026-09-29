// src/app/api/calls/route.ts — THE CALL LOG: record once, route to the right people, track only what needs it.
// A call becomes a record with an OUTCOME:
//   logged   — for reference; nobody needs to act
//   message  — passed on to someone (they acknowledge, reply, or hand it back)
//   action   — someone must do something by a time (stays open until the outcome is recorded)
//   callback — the caller needs a call back → the callback queue (linked)
//   urgent   — someone is told right now (and managers)
// What the CALLER said is kept apart from the staff's private note. Recipients answer from a private link
// (no sign-in) or in the app. Staff actions: create · ack · reply · handback · reassign · resolve.
// Public (recipient key): GET view · POST ack / reply / handback.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { linkOrigin } from '@/lib/app-origin';
import { callbackReason } from '@/lib/callback-reasons';

export const dynamic = 'force-dynamic';
const OUTCOMES = ['logged', 'message', 'action', 'callback', 'urgent'] as const;
const RESOLUTIONS = ['answered', 'booked', 'passed_on', 'no_action', 'other'] as const;
const iso = () => new Date().toISOString();
const first = (n: any) => String(n || '').split(' ')[0];
const token = () => `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

async function notifyRecipient(db: any, tenantId: string, tenant: any, call: any, r: any, origin: string) {
  const T = `tenants/${tenantId}`;
  const link = `${linkOrigin(tenant, origin)}/msg/${tenantId}/${call.id}?k=${r.token}`;
  const head = call.outcome === 'urgent' ? 'URGENT — ' : '';
  const text = `${head}${call.callerName || 'A caller'}${call.reasonLabel ? ` (${call.reasonLabel.toLowerCase()})` : ''}: ${call.summary || 'called'}${call.ask ? ` — please ${call.ask.replace(/^please\s+/i, '')}` : ''}${call.dueAt ? ` by ${new Date(call.dueAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tenant.timezone || undefined })}` : ''}.`;
  try {
    const st: any = r.type === 'staff' ? (((await db.doc(`${T}/staff/${r.id}`).get()).data() as any) || {}) : {};
    if (st.renterId) {                                  // a renter: their portal + the channel they chose
      const { notifyRenter } = await import('@/lib/renter-comms');
      await notifyRenter(db, tenantId, String(st.renterId), 'desk_messages', text, { tone: call.outcome === 'urgent' ? 'red' : 'amber', link, subject: 'A message from the front desk' } as any);
      return;
    }
    const n = db.collection(`${T}/notifications`).doc();
    await n.set({ id: n.id, userId: r.type === 'staff' ? r.id : null, ...(r.type === 'role' ? { forRoles: ['owner', 'admin', 'manager'] } : {}), read: false, createdAt: iso(), type: 'call_message', callId: call.id, message: text, link });
    const phone = String(st.phone || '').trim();
    if (phone && (call.outcome === 'urgent' || call.outcome === 'action' || tenant?.callLog?.textStaff !== false)) {
      const { sendNotification } = await import('@/lib/notify');
      await sendNotification(db, { tenantId, channel: 'sms', to: phone, kind: 'call_message', text: `${tenant.name || 'Front desk'}: ${text} ${link}`, recipientType: 'staff', recipientId: r.id } as any);
    }
  } catch (e) { console.error('[calls] notify failed', e); }
}

async function loadByKey(db: any, tenantId: string, id: string, k: string) {
  if (!tenantId || !id || !k || k.length < 16) return null;
  const ref = db.doc(`tenants/${tenantId}/calls/${id}`); const c: any = (await ref.get()).data();
  const r = c && (c.recipients || []).find((x: any) => x.token === k);
  return r ? { ref, c, r } : null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || ''), id = String(sp.get('id') || '');
  const db = getAdminDb(); const x = await loadByKey(db, tenantId, id, String(sp.get('k') || ''));
  if (!x) return NextResponse.json({ ok: false, error: 'This message isn’t available.' }, { status: 404 });
  const t: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  const { c, r } = x;
  // What a recipient sees: the caller's words, what's asked of them — never the staff's private note.
  return NextResponse.json({ ok: true, business: t.name || 'Front desk', callerName: c.callerName || 'A caller', callerPhone: c.callerPhone || null, reason: c.reasonLabel || null,
    summary: c.summary || '', ask: c.ask || null, dueAt: c.dueAt || null, outcome: c.outcome, urgent: c.outcome === 'urgent', ackedAt: r.ackedAt || null, open: c.status !== 'resolved', loggedBy: first(c.loggedBy),
    accent: t.bookingPageSettings?.cfPageConfig?.accentColor || t.brandColor || null, timezone: t.timezone || null });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), action = String(b.action || '');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const tenant: any = ((await db.doc(T).get()).data() as any) || {};
  const origin = req.nextUrl.origin;

  // ── Recipients answer from their private link ──
  if (b.k) {
    const x = await loadByKey(db, tenantId, String(b.id || ''), String(b.k));
    if (!x) return NextResponse.json({ ok: false, error: 'This message isn’t available.' }, { status: 404 });
    const { ref, c, r } = x;
    if (c.status === 'resolved') return NextResponse.json({ ok: false, error: 'This has already been dealt with.' }, { status: 409 });
    const note = String(b.text || '').trim().slice(0, 500);
    const recips = (c.recipients || []).map((y: any) => (y.token === r.token ? { ...y, ackedAt: y.ackedAt || iso() } : y));
    if (action === 'ack') { await ref.set({ recipients: recips, updatedAt: iso(), history: [...(c.history || []), { at: iso(), by: r.name, what: 'Got it' }].slice(-40) }, { merge: true }); return NextResponse.json({ ok: true }); }
    if (action === 'reply' || action === 'handback') {
      if (!note) return NextResponse.json({ ok: false, error: action === 'reply' ? 'Write your reply.' : 'Say why you’re handing it back.' }, { status: 400 });
      await ref.set({ recipients: recips, updatedAt: iso(), ...(action === 'handback' ? { status: 'open', handedBackBy: r.name, handedBackAt: iso() } : { lastReplyAt: iso() }),
        history: [...(c.history || []), { at: iso(), by: r.name, what: action === 'reply' ? `Replied: ${note}` : `Handed back: ${note}` }].slice(-40) }, { merge: true });
      const n = db.collection(`${T}/notifications`).doc();
      await n.set({ id: n.id, userId: c.loggedById || null, read: false, createdAt: iso(), type: 'call_reply', callId: c.id, link: 'pos',
        message: `${first(r.name)} ${action === 'reply' ? 'replied' : 'handed back'} about ${c.callerName || 'the caller'}: ${note}` }).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  }

  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const me = { id: auth.actor.uid, name: auth.actor.name };

  if (action === 'create') {
    const outcome = OUTCOMES.includes(b.outcome) ? b.outcome : 'logged';
    const summary = String(b.summary || '').trim().slice(0, 1000);
    if (!summary) return NextResponse.json({ ok: false, error: 'Write a line about what they said.' }, { status: 400 });
    const reason = b.reason ? String(b.reason) : null;
    const wanted: any[] = Array.isArray(b.recipients) ? b.recipients.slice(0, 5) : [];
    if (['message', 'action', 'urgent'].includes(outcome) && !wanted.length) return NextResponse.json({ ok: false, error: 'Choose who needs to know.' }, { status: 400 });
    const dueMs = Date.parse(String(b.dueAt || ''));
    if (outcome === 'action' && !(dueMs > Date.now())) return NextResponse.json({ ok: false, error: 'Pick when it needs doing by.' }, { status: 400 });
    const recipients: any[] = [];
    for (const w of wanted) {
      if (w?.type === 'role') { recipients.push({ type: 'role', id: 'managers', name: 'Managers', token: token() }); continue; }
      const st: any = w?.id ? (((await db.doc(`${T}/staff/${String(w.id)}`).get()).data() as any) || null) : null;
      if (st) recipients.push({ type: 'staff', id: String(w.id), name: st.name || 'Team member', isRenter: !!st.renterId, token: token() });
    }
    if (outcome === 'urgent' && !recipients.some((r) => r.type === 'role')) recipients.push({ type: 'role', id: 'managers', name: 'Managers', token: token() });
    const ref = db.collection(`${T}/calls`).doc();
    const call: any = {
      id: ref.id, tenantId, at: iso(), direction: b.direction === 'out' ? 'out' : 'in', source: 'desk',
      callerName: String(b.callerName || '').trim().slice(0, 80) || 'Unknown caller', callerPhone: String(b.callerPhone || '').trim().slice(0, 40) || null,
      clientId: b.clientId ? String(b.clientId) : null, appointmentId: b.appointmentId ? String(b.appointmentId) : null,
      reason, reasonLabel: reason ? callbackReason(reason).label : null, summary, privateNote: String(b.privateNote || '').trim().slice(0, 1000) || null,
      outcome, ask: String(b.ask || '').trim().slice(0, 300) || null, dueAt: dueMs > 0 ? new Date(dueMs).toISOString() : null,
      callerWaiting: b.callerWaiting === true, promised: String(b.promised || '').trim().slice(0, 200) || null,
      recipients, ackNeeded: ['message', 'action', 'urgent'].includes(outcome),
      status: outcome === 'logged' ? 'resolved' : 'open', ...(outcome === 'logged' ? { resolution: { outcome: 'no_action', note: 'Logged for reference', by: me.name, at: iso() } } : {}),
      loggedBy: me.name, loggedById: me.id, updatedAt: iso(), history: [{ at: iso(), by: me.name, what: `Logged — ${outcome === 'logged' ? 'for reference' : outcome}` }],
    };
    await ref.set(call);
    for (const r of recipients) await notifyRecipient(db, tenantId, tenant, call, r, origin);
    // Text the caller a link while they're on the phone (booking page, or their visit link).
    let linkSent: string | null = null;
    if (call.callerPhone && ['book', 'visit'].includes(b.sendLink)) {
      let url: string | null = null;
      if (b.sendLink === 'book') url = `${linkOrigin(tenant, origin)}/book/${tenantId}`;
      else if (call.appointmentId) { const ap: any = ((await db.doc(`${T}/appointments/${call.appointmentId}`).get()).data() as any) || {}; if (ap.checkInToken) url = `${linkOrigin(tenant, origin)}/check-in/${ap.checkInToken}`; }
      if (url) { const { sendNotification } = await import('@/lib/notify');
        const r = await sendNotification(db, { tenantId, channel: 'sms', to: call.callerPhone, kind: 'call_link', text: `${tenant.name || 'Us'}: ${b.sendLink === 'book' ? 'here’s where to book' : 'here’s your visit link'} — ${url}`, clientId: call.clientId, clientName: call.callerName } as any);
        linkSent = r?.ok ? b.sendLink : null;
        await ref.set({ linkSent: { what: b.sendLink, ok: !!r?.ok, at: iso() } }, { merge: true }); }
    }
    // Callback → the callback queue, linked both ways (acting as this staff member).
    let callbackId: string | null = null;
    if (outcome === 'callback') {
      try {
        const r = await fetch(`${origin}/api/callbacks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.headers.get('authorization') || '' },
          body: JSON.stringify({ tenantId, action: 'create', callerName: call.callerName, callerPhone: call.callerPhone, callerEmail: b.callerEmail || null, clientId: call.clientId,
            reason: reason || 'other', contactBy: b.contactBy || 'call', ownerId: b.callbackOwnerId || null, note: summary, promised: call.promised, timePromised: false }) }).then((x) => x.json());
        if (r?.ok) { callbackId = r.id; await ref.set({ callbackId, status: 'callback_scheduled' }, { merge: true }); await db.doc(`${T}/callBackDrafts/${r.id}`).set({ callId: ref.id }, { merge: true }); }
      } catch (e) { console.error('[calls] callback link', e); }
    }
    await logAuditAdmin(db, tenantId, { action: 'call.logged', targetType: call.clientId ? 'client' : 'call', targetId: call.clientId || ref.id,
      summary: `Call from ${call.callerName} — ${outcome}${recipients.length ? ` → ${recipients.map((r) => first(r.name)).join(', ')}` : ''}`, actor: { type: 'user', id: me.id, name: me.name, role: auth.actor.role } }).catch(() => {});
    return NextResponse.json({ ok: true, id: ref.id, callbackId, linkSent });
  }

  const ref = db.doc(`${T}/calls/${String(b.id || '')}`); const c: any = (await ref.get()).data();
  if (!c) return NextResponse.json({ ok: false, error: 'That call wasn’t found.' }, { status: 404 });
  const push = (what: string) => [...(c.history || []), { at: iso(), by: me.name, what }].slice(-40);

  if (action === 'ack') {   // a recipient acknowledges in the app
    const recips = (c.recipients || []).map((y: any) => (y.id === me.id || (y.type === 'role' && ['owner', 'admin', 'manager'].includes(String(auth.actor.role))) ? { ...y, ackedAt: y.ackedAt || iso() } : y));
    await ref.set({ recipients: recips, updatedAt: iso(), history: push('Got it') }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  if (action === 'reassign') {
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (!reason) return NextResponse.json({ ok: false, error: 'Say why it’s being passed to someone else.' }, { status: 400 });
    const st: any = b.toId ? (((await db.doc(`${T}/staff/${String(b.toId)}`).get()).data() as any) || null) : null;
    if (!st) return NextResponse.json({ ok: false, error: 'Choose who to pass it to.' }, { status: 400 });
    const r = { type: 'staff', id: String(b.toId), name: st.name || 'Team member', isRenter: !!st.renterId, token: token() };
    await ref.set({ recipients: [...(c.recipients || []), r], updatedAt: iso(), history: push(`Passed to ${first(st.name)} — ${reason}`) }, { merge: true });
    await notifyRecipient(db, tenantId, tenant, { ...c, id: ref.id }, r, origin);
    return NextResponse.json({ ok: true });
  }
  if (action === 'resolve') {
    if (!RESOLUTIONS.includes(b.outcome)) return NextResponse.json({ ok: false, error: 'Choose what happened.' }, { status: 400 });
    const note = String(b.note || '').trim().slice(0, 500);
    if (b.outcome === 'other' && !note) return NextResponse.json({ ok: false, error: 'Add a short note about what happened.' }, { status: 400 });
    await ref.set({ status: 'resolved', resolution: { outcome: b.outcome, note: note || null, by: me.name, at: iso() }, updatedAt: iso(), history: push(`Closed — ${String(b.outcome).replace('_', ' ')}${note ? `: ${note}` : ''}`) }, { merge: true });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
