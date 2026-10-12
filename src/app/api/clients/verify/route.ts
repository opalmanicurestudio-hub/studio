// src/app/api/clients/verify/route.ts — CONFIRMING A CLIENT'S NUMBER AT THE DESK (staff only; enforced here).
//   { action: 'start', clientId, channel? }         → a 6-digit code goes to the phone (or email) on record;
//                                                      returns { verificationId, sentTo } ("the number ending in 0100")
//   { action: 'check', clientId, verificationId, code } → the client reads the code back; on a match the contact is
//                                                      marked confirmed (no device is trusted: this is the desk)
//   { action: 'clear_wrong', clientId }             → managers only: the number reported wrong ("Not you?") has been
//                                                      fixed. Clears the flag and records who and when in the notes.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { startVerify, checkVerify } from '@/lib/client-verify';
export const dynamic = 'force-dynamic';
const s = (v: any, n = 200) => String(v ?? '').trim().slice(0, n);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = s(b.tenantId, 80);
  const auth: any = tenantId ? await verifyStaffActor(req, tenantId) : null;
  if (!auth?.ok) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const me = { uid: String(auth.actor.uid), name: String(auth.actor.name || 'Team member'), manager: !!auth.actor.isManager };
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  const clientId = s(b.clientId, 120); if (!clientId) return NextResponse.json({ ok: false, error: 'Which client?' }, { status: 400 });

  if (b.action === 'start') {
    const r: any = await startVerify(db, tenantId, clientId, { channel: b.channel === 'email' ? 'email' : 'sms', purpose: 'desk' });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, verificationId: r.verificationId, sentTo: r.sentTo, channel: r.channel });
  }

  if (b.action === 'check') {
    const verificationId = s(b.verificationId, 120).replace(/[^\w-]/g, '');
    const v: any = verificationId ? (await db.doc(`${T}/clientVerifications/${verificationId}`).get()).data() : null;
    if (!v || v.clientId !== clientId) return NextResponse.json({ ok: false, error: 'That code has expired. Please send a new one.' }, { status: 400 });
    const r: any = await checkVerify(db, tenantId, { verificationId, code: s(b.code, 12) });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, channel: v.channel });
  }

  if (b.action === 'clear_wrong') {
    if (!me.manager) return NextResponse.json({ ok: false, error: 'Only a manager or the owner can mark the number as fixed.' }, { status: 403 });
    const ref = db.doc(`${T}/clients/${clientId}`); const c: any = (await ref.get()).data();
    if (!c) return NextResponse.json({ ok: false, error: 'That client wasn’t found.' }, { status: 404 });
    const now = new Date().toISOString();
    await ref.set({ phoneReportedWrongAt: null, phoneReportedWrongVia: null, phoneFixedAt: now, phoneFixedBy: { id: me.uid, name: me.name } }, { merge: true });
    const reported = c.phoneReportedWrongAt ? new Date(c.phoneReportedWrongAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
    const note = db.collection(`${T}/clientNotes`).doc();
    await note.set({ clientId, visibility: 'team', authorUid: me.uid, authorName: me.name, at: now, pinned: false, kind: 'phone_fixed',
      text: `${me.name} marked the phone number as fixed${reported ? ` (it was reported as the wrong number on ${reported})` : ''}. Texts to this client can be sent again. Please send them a new link for any upcoming visit.` });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}
