// src/app/api/tuition-desk/route.ts — TUITION AT THE DESK (staff). list: enrolled students with a balance ·
// payer: the client record the checkout uses for the student (found by email, or created and tagged as a student).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { tuitionAccount, TUITION_OPEN } from '@/lib/tuition-desk';
export const dynamic = 'force-dynamic';
const json = (b: any, s = 200) => NextResponse.json(b, { status: s });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || ''); if (!tenantId) return json({ ok: false, error: 'Missing business.' }, 400);
  const auth: any = await verifyStaffActor(req, tenantId).catch(() => null); if (!auth?.ok) return json({ ok: false, error: 'Please sign in.' }, 401);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  if (b.action === 'list') {
    const ps = (await db.collection(`${T}/tuitionPlans`).where('status', 'in', TUITION_OPEN).get()).docs;
    const out = [];
    for (const d of ps.slice(0, 300)) { const a: any = await tuitionAccount(db, tenantId, d.id); if (a && a.balanceCents > 0) out.push({ id: d.id, name: a.name, program: a.program, balanceCents: a.balanceCents, pastDue: a.plan.status === 'past_due', nextDueAt: a.plan.nextDueAt || null, installmentCents: Number(a.plan.installmentCents) || 0 }); }
    out.sort((x, y) => Number(y.pastDue) - Number(x.pastDue) || x.name.localeCompare(y.name));
    return json({ ok: true, students: out });
  }
  if (b.action === 'payer') {
    const a: any = await tuitionAccount(db, tenantId, String(b.planId || '')); if (!a) return json({ ok: false, error: 'That tuition plan wasn’t found.' }, 404);
    const email = String(a.plan.email || '').trim().toLowerCase(); const now = new Date().toISOString();
    if (a.plan.clientId && (await db.doc(`${T}/clients/${a.plan.clientId}`).get()).exists) return json({ ok: true, clientId: a.plan.clientId, name: a.name });
    const found: any = email ? (await db.collection(`${T}/clients`).where('email', '==', email).limit(1).get()).docs[0] || null : null;
    const ref = found ? found.ref : db.collection(`${T}/clients`).doc();
    if (!found) await ref.set({ name: a.name, email: email || null, isStudent: true, studentId: a.plan.studentId || null, source: 'academy', status: 'active', createdAt: now, updatedAt: now });
    await db.doc(`${T}/tuitionPlans/${a.plan.id}`).set({ clientId: ref.id }, { merge: true });
    return json({ ok: true, clientId: ref.id, name: a.name });
  }
  return json({ ok: false, error: 'Unknown action.' }, 400);
}
