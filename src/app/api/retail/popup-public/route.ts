// src/app/api/retail/popup-public/route.ts — A POP-UP'S PRODUCTS FOR THE LINE (shop/[tenantId]/popup/[popupId]; lib/popup).
// Public: what the sign on the table opens. GET ?tenantId=&id= → { shopName, name, place, open, items } where each item
// is { id, name, priceCents, imageUrl, number, left, prosOnly, cart } (the cart is how checkout takes it). `open`: taking
// orders from the line right now. Nothing about who bought what; limited per visitor.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { moduleEnabled } from '@/lib/modules';
import { leftAt, lineOrdered, popupsOf, takingLineOrders } from '@/lib/popup';
import { popupProducts } from '@/lib/popup-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,120}$/;
// (Every phone in a line asks every half minute: one answer serves them all for a few seconds, per server.)
const FRESH_MS = 10_000;
const recent = new Map<string, { at: number; body: any }>();

export async function GET(req: NextRequest) {
  const t = String(req.nextUrl.searchParams.get('tenantId') || ''); const id = String(req.nextUrl.searchParams.get('id') || '');
  if (!ID.test(t) || !ID.test(id)) return NextResponse.json({ ok: false, error: 'That pop-up isn’t here.' }, { status: 400 });
  // (Read again every half minute by each phone in the line: a visitor's allowance, and none for the whole shop.)
  const limited = await limitPublic(req, 'popup-view', t, { perHour: 400, perDay: 0 }); if (limited) return limited;
  const hit = recent.get(`${t}/${id}`);
  if (hit && Date.now() - hit.at < FRESH_MS) return NextResponse.json(hit.body, { headers: { 'Cache-Control': 'no-store' } });
  const db = getAdminDb();
  const [ts, ps] = await Promise.all([db.doc(`tenants/${t}`).get(), popupsOf(db, t).doc(id).get()]);
  const tenant: any = ts.exists ? ts.data() || {} : null; const p: any = ps.exists ? ps.data() || {} : null;
  if (!tenant || !p || p.marker || !moduleEnabled(tenant, 'pickup')) return NextResponse.json({ ok: false, error: 'That pop-up isn’t here.' }, { status: 404 });
  const today = todayIn(tenantTimeZone(tenant));
  const open = takingLineOrders(p, today);
  const shopName = String(tenant.businessName || tenant.name || '').trim();
  if (!open) return NextResponse.json({ ok: true, shopName, name: p.name || '', place: p.place || '', open: false, over: p.status === 'closed' || p.day < today, items: [] }, { headers: { 'Cache-Control': 'no-store' } });
  const orders = (await db.collection(`tenants/${t}/retailOrders`).where('popupId', '==', id).get()).docs.map((d: any) => d.data() || {});
  const left = leftAt(p, lineOrdered(orders, Date.now()));
  const products = await popupProducts(db, t, tenant, (p.items || []).map((x: any) => String(x.id)));
  const items = (p.items || []).map((x: any) => products.get(String(x.id))).filter(Boolean)
    // (What the table has left; checkout checks the shop's own stock too.)
    .map((x: any) => ({ id: x.id, name: x.name, priceCents: x.priceCents, imageUrl: x.imageUrl, number: x.number, prosOnly: x.prosOnly, cart: x.cart, left: Math.max(0, left[x.id] ?? 0) }));
  const body = { ok: true, shopName, name: p.name || '', place: p.place || '', open: true, items };
  if (recent.size > 500) recent.clear();
  recent.set(`${t}/${id}`, { at: Date.now(), body });
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
