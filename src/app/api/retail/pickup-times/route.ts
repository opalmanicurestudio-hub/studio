// /api/retail/pickup-times — the pickup windows checkout offers (lib/pickup-slots-server): inside the shop's hours,
// none on a closed day or while online pickup is paused, none that start before the order can be ready, and each
// marked full once its orders reach what it can take. Read only when checkout asks, never on a plain shop visit.
//   GET ?tenantId&ck=<this checkout's key>[&fresh=1] → { scheduled, windows: [{ key, label, day, full }], readyBy, reason }
// The checkout's key keeps its own earlier unpaid try from making a window look full to it; fresh skips the memory.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { checkoutSlotHash, shopPickup } from '@/lib/pickup-slots-server';

export const dynamic = 'force-dynamic';

// A few seconds of memory per shop: a page refreshed over and over doesn't re-read every order each time. Placing an
// order always counts again for itself (api/retail/checkout), so a moment-old answer here never oversells.
const recent = new Map<string, { at: number; body: any }>();
// A per-visitor allowance kept in memory first, so a refresh loop costs nothing to turn away.
const asks = new Map<string, { minute: number; n: number }>();

export async function GET(req: NextRequest) {
  const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  try {
    const { visitorIp } = await import('@/lib/rate-limit');
    const who = `${tenantId}|${visitorIp(req)}`; const minute = Math.floor(Date.now() / 60000);
    const a = asks.get(who); const n = a && a.minute === minute ? a.n + 1 : 1;
    if (asks.size > 5000) asks.clear();
    asks.set(who, { minute, n });
    if (n > 30) return NextResponse.json({ error: 'Please wait a moment and try again.' }, { status: 429 });
    const ck = String(req.nextUrl.searchParams.get('ck') || '');
    const same = /^[A-Za-z0-9_-]{16,64}$/.test(ck) ? checkoutSlotHash(tenantId, ck) : '';
    const memo = `${tenantId}|${same}`;
    const hit = recent.get(memo);
    if (hit && Date.now() - hit.at < 8000 && req.nextUrl.searchParams.get('fresh') !== '1') return NextResponse.json(hit.body, { headers: { 'Cache-Control': 'no-store' } });
    const db = getAdminDb();
    const t = await db.doc(`tenants/${tenantId}`).get();
    if (!t.exists) return NextResponse.json({ error: 'Shop not found.' }, { status: 404 });
    const { view } = await shopPickup(db, tenantId, t.data(), Date.now(), same);
    // How many places are left is the shop's business: the customer sees only whether a window is full.
    const body = { ...view, windows: view.windows.map((w) => ({ key: w.key, label: w.label, day: w.day, full: w.full })) };
    if (recent.size > 500) recent.clear();
    recent.set(memo, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[pickup-times]', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: 'Pickup times couldn’t be loaded.' }, { status: 500 });
  }
}
