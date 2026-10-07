// src/app/api/desk/tick/route.ts — the housekeeping step, asked for by an open front desk (signed-in team only).
// The scheduled job does the same thing; this makes sure it still happens when the schedule runs rarely. At most once
// every 4 minutes per business however many desks are open.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { opsTick, syncKits } from '@/lib/ops-tick';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})); const tenantId = String(body?.tenantId || '').slice(0, 120);
  const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  // A kit was just added, pulled out, put back or retired (or a contents list changed): bring booking and stock in step now.
  if (body?.only === 'kits') { const dbk = getAdminDb(); const tk = await dbk.doc(`tenants/${tenantId}`).get(); if (!tk.exists) return NextResponse.json({ ok: false }, { status: 404 });
    try { await syncKits(dbk, tenantId, tk.data() || {}); return NextResponse.json({ ok: true }); } catch (e) { console.error('[desk/tick] kits', tenantId, e); return NextResponse.json({ ok: false }, { status: 500 }); } }
  const db = getAdminDb(); const now = Date.now(); const mark = db.doc(`tenants/${tenantId}/private/opsTick`);
  // Claim the run (so two desks don't both do it).
  const mine = await db.runTransaction(async (tx: any) => { const s = await tx.get(mark); const last = Date.parse(String(s.data()?.at || '')) || 0; if (now - last < 4 * 60000) return false; tx.set(mark, { at: new Date(now).toISOString() }); return true; }).catch(() => false);
  if (!mine) return NextResponse.json({ ok: true, skipped: true });
  const t = await db.doc(`tenants/${tenantId}`).get(); if (!t.exists) return NextResponse.json({ ok: false }, { status: 404 });
  try { return NextResponse.json({ ok: true, ...(await opsTick(db, tenantId, t.data() || {}, now)) }); }
  catch (e) { console.error('[desk/tick]', tenantId, e); return NextResponse.json({ ok: false }, { status: 500 }); }
}
