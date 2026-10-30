// /api/retail/delivery-map — THE MAP ON THE ORDER PAGE WHILE A DELIVERY IS ON ITS WAY (mockup 1C, lib/delivery-live).
// GET ?t=&o=&e=&k= (the key the order page was given for this order, for a few minutes: lib/delivery-live-server).
// Drawn here from Mapbox's map pictures with the server's own key, so neither the key nor the driver's exact location
// reaches a browser: the driver (roughly, about a city block), the customer's address and the shop. Only while the order
// is out and the driver shares where they are; otherwise nothing (the page shows the delivery without a map).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { deliveryFrom } from '@/lib/delivery-plan';
import { destOf, liveFor, mapKeyOk } from '@/lib/delivery-live-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

// The same picture for the same order and place is kept here for two minutes, so a page left open (or many) asks the
// map service once, not on every look.
const kept = new Map<string, { at: number; type: string; buf: ArrayBuffer }>();
const KEEP_MS = 2 * 60e3;
const none = (status = 404) => new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } });
const at = (p: { lat: number; lng: number }) => `${p.lng.toFixed(4)},${p.lat.toFixed(4)}`;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tenantId = String(sp.get('t') || ''); const orderId = String(sp.get('o') || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId) || !/^[A-Za-z0-9_-]{1,80}$/.test(orderId)) return none(400);
  if (!mapKeyOk(tenantId, orderId, sp.get('e'), sp.get('k'))) return none(403);
  const token = String(process.env.MAPBOX_TOKEN || '').trim();
  if (!token) return none();
  const db = getAdminDb();
  const [oSnap, tSnap] = await Promise.all([db.doc(`tenants/${tenantId}/retailOrders/${orderId}`).get(), db.doc(`tenants/${tenantId}`).get()]);
  const order: any = oSnap.exists ? oSnap.data() : null;
  if (!order || order.method !== 'delivery' || order.delivery?.status !== 'out' || !/^[A-Za-z0-9_-]{1,128}$/.test(String(order.delivery?.driverId || ''))) return none();
  const doc: any = (await db.doc(`tenants/${tenantId}/driverLocations/${String(order.delivery.driverId)}`).get()).data() || null;
  const live = liveFor(orderId, doc);
  if (!live?.point) return none();
  const dest = destOf(order);
  const origin = deliveryFrom((tSnap.data() as any)?.retailSettings).origin;
  // The customer's address (dark pin), the driver (green), the shop (gray).
  const marks = [dest ? `pin-l+16171a(${at(dest)})` : '', `pin-l-car+1f7a4d(${at(live.point)})`, origin ? `pin-s+6d7075(${at(origin)})` : ''].filter(Boolean).join(',');
  const pic = (type: string, buf: ArrayBuffer) => new NextResponse(buf, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=60' } });
  const hit = kept.get(`${orderId}|${marks}`);
  if (hit && Date.now() - hit.at < KEEP_MS) return pic(hit.type, hit.buf);
  const url = `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${marks}/auto/600x440@2x?padding=64&access_token=${encodeURIComponent(token)}`;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' } as any);
    if (!r.ok) { console.warn('[delivery-map] map refused', r.status); return none(502); }
    const buf = await r.arrayBuffer(); const type = r.headers.get('content-type') || 'image/png';
    // Only a few pictures are kept, never past their two minutes.
    for (const [k, v] of kept) if (Date.now() - v.at >= KEEP_MS) kept.delete(k);
    while (kept.size >= 30) kept.delete(kept.keys().next().value as string);
    kept.set(`${orderId}|${marks}`, { at: Date.now(), type, buf });
    return pic(type, buf);
  } catch { return none(504); } finally { clearTimeout(timer); }
}
