// src/app/api/academy/live/route.ts
//
// LIVE CLASS — the instructor's side (owners, managers, instructors).
//   list · start · state · ask · reveal · close · end

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { appendAudit } from '@/lib/academy-compliance';
import { newJoinCode, sessionState, endSession } from '@/lib/academy-live';
import { linkOrigin } from '@/lib/app-origin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const isInstructor = String(auth.actor.role || '').toLowerCase() === 'instructor';
  if (!auth.actor.isManager && !auth.actor.isTenantOwner && !isInstructor) return NextResponse.json({ ok: false, error: 'Owners, managers and instructors only.' }, { status: 403 });
  const db = getAdminDb(); const who = auth.actor.name || auth.actor.uid;
  const col = db.collection(`tenants/${tenantId}/liveSessions`);
  const ref = (id: any) => col.doc(String(id || ''));
  try {
    if (b.action === 'list') {
      const s = await col.orderBy('startedAt', 'desc').limit(30).get();
      return NextResponse.json({ ok: true, sessions: s.docs.map((d: any) => { const x = d.data() as any; return { id: d.id, title: x.title, status: x.status, code: x.code, startedAt: x.startedAt, endedAt: x.endedAt || null, summary: x.summary || null }; }) });
    }
    if (b.action === 'start') {
      const title = String(b.title || '').trim().slice(0, 120) || `Class ${new Date().toLocaleDateString()}`;
      let code = newJoinCode(); for (let i = 0; i < 5 && !(await col.where('code', '==', code).where('status', '==', 'live').limit(1).get()).empty; i++) code = newJoinCode();
      const r = col.doc();
      await r.set({ id: r.id, title, code, status: 'live', programId: b.programId || null, courseId: b.courseId || null, startedAt: new Date().toISOString(), by: who, current: null, questions: [] });
      await appendAudit(tenantId, { type: 'live.started', by: who, summary: `Live class “${title}” started (code ${code})`, data: { sessionId: r.id } });
      return NextResponse.json({ ok: true, id: r.id, code });
    }
    if (b.action === 'state') {
      const st = await sessionState(tenantId, String(b.id || ''));
      if (!st) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
      const t = ((await db.doc(`tenants/${tenantId}`).get()).data() as any) || {};
      return NextResponse.json({ ok: true, ...st, joinUrl: `${linkOrigin(t, req.nextUrl.origin)}/learn/${tenantId}/live?code=${st.session.code}` });
    }
    if (b.action === 'ask') {
      const q = String(b.q || '').trim().slice(0, 300); const options = (b.options || []).map((o: any) => String(o).trim().slice(0, 120)).filter(Boolean).slice(0, 6);
      if (!q || options.length < 2) return NextResponse.json({ ok: false, error: 'A question and at least two answers.' }, { status: 400 });
      const correct = Number.isInteger(b.correct) && b.correct >= 0 && b.correct < options.length ? b.correct : null;
      const s = ((await ref(b.id).get()).data() as any) || {};
      const cur = { id: randomBytes(5).toString('hex'), q, options, correct, open: true, reveal: false, at: new Date().toISOString() };
      await ref(b.id).set({ current: cur, questions: [...(s.questions || []), { id: cur.id, q, options, correct }] }, { merge: true });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'reveal' || b.action === 'close') {
      const s = ((await ref(b.id).get()).data() as any) || {};
      if (!s.current) return NextResponse.json({ ok: true });
      await ref(b.id).set({ current: { ...s.current, open: false, reveal: b.action === 'reveal' ? true : s.current.reveal } }, { merge: true });
      return NextResponse.json({ ok: true });
    }
    if (b.action === 'end') return NextResponse.json({ ok: true, ...(await endSession(tenantId, String(b.id || ''), who)) });
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
