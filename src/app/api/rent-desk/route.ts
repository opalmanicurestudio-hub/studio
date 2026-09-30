// src/app/api/rent-desk/route.ts — RENT AT THE DESK (staff). list: renters with what they owe · payer: the client record
// the checkout uses for a renter (found by email / phone, or created and tagged as a renter), so receipts reach them.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { renterAccount, renterName } from '@/lib/rent-desk';
export const dynamic = 'force-dynamic';
const json = (b: any, s = 200) => NextResponse.json(b, { status: s });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || ''); if (!tenantId) return json({ ok: false, error: 'Missing business.' }, 400);
  const auth: any = await verifyStaffActor(req, tenantId).catch(() => null); if (!auth?.ok) return json({ ok: false, error: 'Please sign in.' }, 401);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  if (b.action === 'list') {
    const rs = (await db.collection(`${T}/renters`).get()).docs.filter((d: any) => !['inactive', 'archived', 'ended', 'former'].includes(String((d.data() || {}).status || '')));
    const out = [];
    for (const d of rs.slice(0, 200)) { const a: any = await renterAccount(db, T, d.id); if (a) out.push({ id: d.id, name: a.name, boothName: a.booth?.name || null, owedCents: a.owedCents, balanceCents: a.balanceCents, oldestDue: a.unpaid[0]?.dueDate || null }); }
    out.sort((x, y) => y.owedCents - x.owedCents || x.name.localeCompare(y.name));
    return json({ ok: true, renters: out });
  }
  if (b.action === 'payer') {
    const a: any = await renterAccount(db, T, String(b.renterId || '')); if (!a) return json({ ok: false, error: 'That renter wasn’t found.' }, 404);
    const r = a.renter; const email = String(r.email || '').trim().toLowerCase(); const phone = String(r.phone || '').replace(/\D/g, '');
    if (r.clientId && (await db.doc(`${T}/clients/${r.clientId}`).get()).exists) return json({ ok: true, clientId: r.clientId, name: a.name });
    let found: any = null;
    if (email) found = (await db.collection(`${T}/clients`).where('email', '==', email).limit(1).get()).docs[0] || null;
    if (!found && phone) found = (await db.collection(`${T}/clients`).where('phone', '==', r.phone).limit(1).get()).docs[0] || null;
    const now = new Date().toISOString();
    const ref = found ? found.ref : db.collection(`${T}/clients`).doc();
    if (!found) await ref.set({ name: renterName(r), email: email || null, phone: r.phone || null, isRenter: true, renterId: r.id, source: 'renter', status: 'active', createdAt: now, updatedAt: now });
    await db.doc(`${T}/renters/${r.id}`).set({ clientId: ref.id, updatedAt: now }, { merge: true });
    return json({ ok: true, clientId: ref.id, name: a.name });
  }
  return json({ ok: false, error: 'Unknown action.' }, 400);
}
