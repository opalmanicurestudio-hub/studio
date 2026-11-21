// /api/retail/stores — THE SHOP'S STORES, for the Find a store page and checkout's pickup choice (design board "The
// online shop at more than one store"; lib/shop-stores-server). Only with two or more locations: each one on the shop,
// with its address, whether it's open now and until when (or when it opens), whether it delivers, and directions. The
// customer's phone sorts them nearest first, on the phone: where they are is never sent here.
//   GET ?tenantId → { several, stores: [{ id, name, address, lat, lng, delivers, directions, open, until, opens }], timeZone }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { shopStoresOf, storeRows } from '@/lib/shop-stores-server';
import { tenantTimeZone } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';

// Half a minute of memory per shop: whether a store is open changes on the hour, not by the second.
const recent = new Map<string, { at: number; body: any }>();
// A per-visitor allowance kept in memory, so a refresh loop costs nothing to turn away.
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
    const hit = recent.get(tenantId);
    if (hit && Date.now() - hit.at < 30000) return NextResponse.json(hit.body, { headers: { 'Cache-Control': 'no-store' } });
    const db = getAdminDb();
    const t = await db.doc(`tenants/${tenantId}`).get();
    if (!t.exists) return NextResponse.json({ error: 'Shop not found.' }, { status: 404 });
    const tenant: any = t.data() || {};
    const { several, stores } = await shopStoresOf(db, tenantId);
    const body = { several, stores: await storeRows(db, tenantId, tenant, stores), timeZone: tenantTimeZone(tenant) };
    if (recent.size > 500) recent.clear();
    recent.set(tenantId, { at: Date.now(), body });
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[stores]', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: 'The stores couldn’t be loaded.' }, { status: 500 });
  }
}
