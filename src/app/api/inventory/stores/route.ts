// /api/inventory/stores — STOCK AT EACH STORE (lib/store-stock-server; design board "Stock at each store, and tonight's
// counts at each location"). With more than one location:
//   view  { tenantId, itemId }                     → each store's number, the total, and "Not at a store yet"
//   count { tenantId, itemId, at, counted }        → a count at a store
//   move  { tenantId, itemId, from, to, qty }      → between stores (or from or to "none": Not at a store yet)
//   clear { tenantId, itemId }                     → every store counted: what's left "Not at a store yet" comes off
// Anyone on the business's own team; booth renters run their own business and can't change the shop's stock.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/route-guard';
import { clearUnplaced, countAtStore, moveStock, storeStockView } from '@/lib/store-stock-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 120); const itemId = String(b.itemId || '');
  if (!ID.test(tenantId) || !ID.test(itemId)) return NextResponse.json({ ok: false, error: 'Which item?' }, { status: 400 });
  const g = await requireRole(req, tenantId, 'staff'); if (g.deny) return g.deny;
  if (g.actor?.isRenter) return NextResponse.json({ ok: false, error: 'Only the business’s own team can count its stock.' }, { status: 403 });
  const db = getAdminDb(); const who = { id: String(g.actor.uid), name: String(g.actor.name || 'A team member').slice(0, 60) };
  try {
    const action = String(b.action || 'view');
    const r = action === 'count' ? await countAtStore(db, tenantId, itemId, b.at, b.counted, who)
      : action === 'move' ? await moveStock(db, tenantId, itemId, b.from, b.to, b.qty, who)
      : action === 'clear' ? await clearUnplaced(db, tenantId, itemId, who)
      : await storeStockView(db, tenantId, itemId);
    return NextResponse.json(r, { status: r.ok ? 200 : r.status || 400 });
  } catch (e: any) {
    console.error('[inventory/stores]', String(e?.message || e).slice(0, 200));
    return NextResponse.json({ ok: false, error: 'That didn’t save. Try again.' }, { status: 500 });
  }
}
