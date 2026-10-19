// src/app/api/retail/pick-info/route.ts — WHAT A PACKER NEEDS ABOUT THE PRODUCTS IN THEIR ORDERS: the bin, the overflow
// spot and the shipping weight. The staff portal can't read the product records directly (they hold costs), so it
// asks here. Any signed-in team member. POST { tenantId, productIds: string[] } → { items: { [id]: {...} } }.
import { NextRequest, NextResponse } from 'next/server';
import { verifyStaffActor } from '@/lib/staff-auth';
import { getAdminDb } from '@/lib/firebase-admin';
import { binOf, overflowOf } from '@/lib/bins';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || '').trim();
  if (!tenantId) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const ids = [...new Set((Array.isArray(b.productIds) ? b.productIds : []).map((x: unknown) => String(x || '').trim()).filter((x: string) => x && !x.includes('/')))].slice(0, 200) as string[];
  if (!ids.length) return NextResponse.json({ ok: true, items: {} });
  const db = getAdminDb();
  const refs = ids.map((id) => db.collection(`tenants/${tenantId}/inventory`).doc(id));
  const items: Record<string, { bin: string; overflow: string; weightOz: number | null; onHand: number | null }> = {};
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100));
    snaps.forEach((s: any) => {
      if (!s.exists) return;
      const d = s.data() || {};
      const w = Number(d.weightOz);
      items[s.id] = { bin: binOf(d), overflow: overflowOf(d), weightOz: Number.isFinite(w) && w > 0 ? w : null, onHand: Number.isFinite(Number(d.totalStock)) ? Number(d.totalStock) : null };
    });
  }
  return NextResponse.json({ ok: true, items });
}
