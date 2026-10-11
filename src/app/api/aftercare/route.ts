// src/app/api/aftercare/route.ts — THE CLIENT'S ANSWER TO THE AFTERCARE CHECK-IN (lib/aftercare-send). Public, but only
// with the visit's signed link (?k=) or its check-in token (?t=) — lib/visit-feedback feedbackVisit.
//   { tenantId, appointmentId, k?, t?, answer: 'good' | 'changed' } → saved on the visit (aftercareCheckIn) and the
//   provider is told; "something's changed" also reaches the managers (a notice addressed to nobody in particular).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { feedbackVisit } from '@/lib/visit-feedback';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });
const first = (n: any) => String(n || '').trim().split(/\s+/)[0] || '';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 80); const appointmentId = String(b.appointmentId || '').slice(0, 80);
  const answer = b.answer === 'changed' ? 'changed' : b.answer === 'good' ? 'good' : '';
  if (!answer) return j({ ok: false, error: 'Pick an answer.' }, 400);
  const db = getAdminDb(); const v = await feedbackVisit(db, tenantId, appointmentId, b.k ? String(b.k) : null, b.t ? String(b.t) : null);
  if (!v) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
  const a = v.a; const prev = a.aftercareCheckIn?.answer || null; const now = new Date().toISOString();
  await v.ref.set({ aftercareCheckIn: { answer, at: now } }, { merge: true });
  if (prev !== answer) {
    const who = first(a.clientName) || 'Your client'; const svc = String(a.serviceName || 'their visit').toLowerCase();
    const message = answer === 'good' ? `${who} says their ${svc} is holding up — all good.` : `${who} says something’s changed with their ${svc}. Get in touch with them.`;
    const notes = db.collection(`tenants/${tenantId}/notifications`);
    const targets: Array<string | null> = [a.staffId ? String(a.staffId) : null]; if (answer === 'changed') targets.push(null);
    for (const userId of [...new Set(targets)]) { if (userId === null && answer === 'good') continue; const r = notes.doc();
      await r.set({ id: r.id, ...(userId ? { userId } : {}), type: 'aftercare_checkin', message, link: '/planner', appointmentId, createdAt: now, read: false, ...(answer === 'changed' ? { priority: 'high' } : {}) }); }
  }
  return j({ ok: true, answer });
}
