// src/app/api/approvals/route.ts — MANAGER APPROVALS (PIN at the desk, or from the manager's phone).
//   verify  { pin, kind, amount?, ref?, reason }   — staff: a manager's PIN, checked here → a single-use approval
//   request { kind, amount?, ref?, reason, summary } — staff: ask the managers on their phones → pending approval
//   decide  { id, k, choice }                       — the manager, from the link (or signed in as a manager)
// GET ?tenantId&id&k — what the manager is being asked (the phone link).
// Too many wrong PINs locks PIN approvals for 10 minutes.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { logAuditAdmin } from '@/lib/audit';
import { linkOrigin } from '@/lib/app-origin';
import { findByPin, issueApproval, isApprover } from '@/lib/approvals';

export const dynamic = 'force-dynamic';
const KIND_LABEL: Record<string, string> = { waive: 'waive fees', recovery: 'give service recovery', discount: 'give a discount', void: 'void a sale', cancel_override: 'override a cancellation fee', service_override: 'override a service rule', client_recovery: 'issue a recovery credit', pos_override: 'approve an override' };
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('tenantId') || ''), id = String(sp.get('id') || ''), k = String(sp.get('k') || '');
  const db = getAdminDb(); const a: any = tenantId && id ? (await db.doc(`tenants/${tenantId}/approvals/${id}`).get()).data() : null;
  if (!a || !k || a.decideHash !== sha(k)) return NextResponse.json({ ok: false, error: 'This request isn’t available.' }, { status: 404 });
  const t: any = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
  return NextResponse.json({ ok: true, business: t.name || 'The front desk', kind: KIND_LABEL[a.kind] || a.kind, amount: a.amount ?? null, summary: a.summary || null, reason: a.reason || null,
    requestedBy: a.requestedBy || 'The front desk', status: a.status, open: a.status === 'pending' && Date.parse(a.expiresAt) > Date.now(), accent: t.bookingPageSettings?.cfPageConfig?.accentColor || t.brandColor || null });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''), action = String(b.action || '');
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const T = `tenants/${tenantId}`;

  // ── The manager decides from their phone link ──
  if (action === 'decide' && b.k) {
    const ref = db.doc(`${T}/approvals/${String(b.id || '')}`); const a: any = (await ref.get()).data();
    if (!a || a.decideHash !== sha(String(b.k))) return NextResponse.json({ ok: false, error: 'This request isn’t available.' }, { status: 404 });
    if (a.status !== 'pending' || Date.parse(a.expiresAt) < Date.now()) return NextResponse.json({ ok: false, error: 'This request has already been dealt with or has expired.' }, { status: 409 });
    // The manager's PIN is the proof (the link alone isn't) — same guessing guard as the desk.
    const gRef = db.doc(`${T}/approvalGuard/pins`); const g: any = ((await gRef.get()).data() as any) || {};
    const recent = (Array.isArray(g.failures) ? g.failures : []).filter((t: string) => Date.now() - Date.parse(t) < 10 * 60000);
    if (recent.length >= 5) return NextResponse.json({ ok: false, error: 'Too many wrong PINs — try again in a few minutes.' }, { status: 429 });
    const who = await findByPin(db, tenantId, String(b.pin || ''));
    if (!who || !isApprover(who.role)) { await gRef.set({ failures: [...recent, new Date().toISOString()] }, { merge: true }); return NextResponse.json({ ok: false, error: who ? 'That PIN isn’t a manager’s.' : 'That PIN wasn’t recognised.' }, { status: 403 }); }
    const approve = b.choice === 'approve';
    await ref.set({ status: approve ? 'approved' : 'declined', decidedAt: new Date().toISOString(), approverId: who.id, approverName: who.name, via: 'phone', expiresAt: new Date(Date.now() + 10 * 60000).toISOString(), used: false }, { merge: true });
    await logAuditAdmin(db, tenantId, { action: approve ? 'approval.granted' : 'approval.declined', targetType: 'approval', targetId: ref.id, amount: a.amount ?? undefined, summary: `${who.name} ${approve ? 'approved' : 'declined'} remotely: ${a.requestedBy || 'the desk'} asked to ${KIND_LABEL[a.kind] || a.kind}${a.amount ? ` ($${Number(a.amount).toFixed(2)})` : ''}${a.reason ? ` — ${a.reason}` : ''}`, actor: { type: 'user', id: who.id, name: who.name, role: who.role } } as any).catch(() => {});
    return NextResponse.json({ ok: true, status: approve ? 'approved' : 'declined', by: who.name });
  }

  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error || 'Sign in to do that.' }, { status: auth.status || 401 });
  const me = { id: auth.actor.uid, name: auth.actor.name };
  const kind = String(b.kind || 'pos_override').slice(0, 40); const amount = b.amount === undefined || b.amount === null ? null : Math.max(0, Number(b.amount) || 0);
  const refId = b.ref ? String(b.ref).slice(0, 120) : null; const reason = String(b.reason || '').trim().slice(0, 300) || null;

  if (action === 'verify') {
    // Guard against guessing: 5 wrong PINs in 10 minutes → locked for 10 minutes.
    const gRef = db.doc(`${T}/approvalGuard/pins`); const g: any = ((await gRef.get()).data() as any) || {};
    const recent = (Array.isArray(g.failures) ? g.failures : []).filter((t: string) => Date.now() - Date.parse(t) < 10 * 60000);
    if (recent.length >= 5) return NextResponse.json({ ok: false, error: 'Too many wrong PINs — try again in a few minutes, or ask from a manager’s phone.' }, { status: 429 });
    const who = await findByPin(db, tenantId, String(b.pin || ''));
    if (!who || !isApprover(who.role)) {
      await gRef.set({ failures: [...recent, new Date().toISOString()] }, { merge: true });
      return NextResponse.json({ ok: false, error: who ? 'That PIN isn’t a manager’s.' : 'That PIN wasn’t recognised.' }, { status: 403 });
    }
    if (b.requireReason !== false && !reason) return NextResponse.json({ ok: false, error: 'Add a reason.' }, { status: 400 });
    const token = await issueApproval(db, tenantId, { kind, amount, ref: refId, reason, approver: who, requestedBy: me, via: 'pin' });
    await logAuditAdmin(db, tenantId, { action: 'approval.granted', targetType: 'approval', targetId: token, amount: amount ?? undefined, summary: `${who.name} approved (PIN): ${me.name} to ${KIND_LABEL[kind] || kind}${amount ? ` ($${amount.toFixed(2)})` : ''}${reason ? ` — ${reason}` : ''}`, actor: { type: 'user', id: who.id, name: who.name, role: who.role } } as any).catch(() => {});
    return NextResponse.json({ ok: true, token, approver: who });
  }

  if (action === 'request') {
    const t: any = ((await db.doc(T).get()).data() as any) || {};
    if (t?.approvalRules?.phoneApproval === false) return NextResponse.json({ ok: false, error: 'Phone approvals are switched off — use a manager’s PIN.' }, { status: 403 });
    const k = `${crypto.randomBytes(18).toString('base64url')}`;
    const ref = db.collection(`${T}/approvals`).doc();
    const rules = t?.approvalRules || {};
    const chosen: string[] = Array.isArray(rules.remoteApproverIds) ? rules.remoteApproverIds : [];
    const managers = (await db.collection(`${T}/staff`).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
      .filter((m: any) => isApprover(m.role) && m.isActive !== false && (!chosen.length || chosen.includes(m.id)));   // everyone who can approve, unless you've chosen people
    const via = ['text', 'email', 'both'].includes(rules.remoteChannel) ? rules.remoteChannel : 'both';
    if (!managers.length) return NextResponse.json({ ok: false, error: 'Nobody is set up to approve remotely — add a manager, or check Settings → Payments → Voids and approvals.' }, { status: 400 });
    await ref.set({ id: ref.id, kind, amount, ref: refId, reason, summary: String(b.summary || '').slice(0, 300) || null, status: 'pending', requestedBy: me.name, requestedById: me.id,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), decideHash: sha(k), managerForLink: managers[0]?.id || null, managerNameForLink: managers.length === 1 ? managers[0].name : 'A manager', used: false });
    const link = `${linkOrigin(t, req.nextUrl.origin)}/approve/${tenantId}/${ref.id}?k=${k}`;
    const text = `${me.name.split(' ')[0]} asks to ${KIND_LABEL[kind] || kind}${amount ? ` — $${amount.toFixed(2)}` : ''}${b.summary ? ` (${String(b.summary).slice(0, 120)})` : ''}${reason ? `. Reason: ${reason}` : ''}. Approve or decline: ${link}`;
    const { sendNotification } = await import('@/lib/notify');
    for (const m of managers) {
      const n = db.collection(`${T}/notifications`).doc();
      await n.set({ id: n.id, userId: m.id, read: false, createdAt: new Date().toISOString(), type: 'approval_request', approvalId: ref.id, message: text, link }).catch(() => {});
      if (m.id === me.id) continue;
      if (via !== 'email' && String(m.phone || '').trim()) await sendNotification(db, { tenantId, channel: 'sms', to: String(m.phone), kind: 'approval_request', text: `${t.name || 'Front desk'}: ${text}`, recipientType: 'staff', recipientId: m.id } as any).catch(() => {});
      if (via !== 'text' && String(m.email || '').includes('@')) { const { brandedEmailHtml } = await import('@/lib/email-template');
        await sendNotification(db, { tenantId, channel: 'email', to: String(m.email), subject: `Approval needed — ${KIND_LABEL[kind] || kind}${amount ? ` ($${amount.toFixed(2)})` : ''}`, kind: 'approval_request',
          html: brandedEmailHtml({ studioName: t.name || 'Front desk', title: 'Can you approve this?', bodyLines: [text.replace(/ Approve or decline: .*$/, ''), 'You’ll enter your PIN to approve. The request expires in 15 minutes.'], cta: { label: 'Approve or decline', url: link } } as any), recipientType: 'staff', recipientId: m.id } as any).catch(() => {}); }
    }
    return NextResponse.json({ ok: true, id: ref.id, sentTo: managers.length });
  }

  if (action === 'decide') {   // a signed-in manager deciding in the app
    if (!isApprover(auth.actor.role)) return NextResponse.json({ ok: false, error: 'Only a manager can decide.' }, { status: 403 });
    const ref = db.doc(`${T}/approvals/${String(b.id || '')}`); const a: any = (await ref.get()).data();
    if (!a || a.status !== 'pending') return NextResponse.json({ ok: false, error: 'This request has already been dealt with.' }, { status: 409 });
    const approve = b.choice === 'approve';
    await ref.set({ status: approve ? 'approved' : 'declined', decidedAt: new Date().toISOString(), approverId: me.id, approverName: me.name, expiresAt: new Date(Date.now() + 10 * 60000).toISOString(), used: false }, { merge: true });
    return NextResponse.json({ ok: true, status: approve ? 'approved' : 'declined' });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
