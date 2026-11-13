// src/app/api/retail/pickup-tools/route.ts — THE PICKUP AND DRIVE-THRU SWITCH (lib/modules 'pickup'), from Shop setup.
// POST { tenantId, on } → managers: the pickup window and its board, Pickups and pop-up tables, on or off for the
// business. It's on only while the shop is (moduleEnabled), so turning it on with the shop off says so. In the log.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { moduleEnabled } from '@/lib/modules';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '');
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(tenantId) || typeof b.on !== 'boolean') return NextResponse.json({ ok: false, error: 'On or off?' }, { status: 400 });
  const g: any = await requireRole(req, tenantId, 'manager'); if (g.deny) return g.deny;
  if (g.actor?.isRenter) return NextResponse.json({ ok: false, error: 'That’s the business’s own.' }, { status: 403 });
  const db = getAdminDb(); const ref = db.doc(`tenants/${tenantId}`);
  const tenant: any = (await ref.get()).data() || {};
  if (b.on && !moduleEnabled(tenant, 'retail')) return NextResponse.json({ ok: false, error: 'Pickup and drive-thru sells the shop’s products. Turn the shop on first.' }, { status: 409 });
  await ref.set({ modules: { pickup: b.on } }, { merge: true });
  await logAuditAdmin(db, tenantId, { action: b.on ? 'module.pickup_on' : 'module.pickup_off', targetType: 'tenant', targetId: tenantId, summary: `Pickup and drive-thru turned ${b.on ? 'on' : 'off'}`, actor: { type: 'user', id: String(g.actor?.uid || ''), name: String(g.actor?.name || 'A manager').slice(0, 80) } } as any).catch(() => {});
  return NextResponse.json({ ok: true, on: b.on });
}
