// /api/retail/delivery-quote — CAN WE DELIVER THERE, FOR HOW MUCH, AND WHEN (lib/delivery-server). Checkout asks once
// the customer has typed an address and chosen delivery: whether the address is in one of the shop's zones, the fee
// for what's in the bag, the delivery windows (each only marked full, never how many places are left), and whether
// "within N minutes" is on offer right now. The address is looked up on the map for this checkout only and not kept;
// the answer carries a signed distance, so placing the order doesn't look it up again.
//   POST { tenantId, address: { line1, line2?, city, state, postalCode }, itemsCents, ck?, token? }
//     → { ok: true, miles, feeCents, free, freeOverCents, expressCents, minutes, asap, windows, dropoffNotes, token }
//     → { ok: false, reason, message, minimumCents? }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { checkoutSlotHash } from '@/lib/pickup-slots-server';
import { deliveryFor } from '@/lib/delivery-server';
import { whenLabel } from '@/lib/pickup-slots';
import { dayKey } from '@/lib/tenant-time';

export const dynamic = 'force-dynamic';

// Each visitor gets a few looks a minute, counted in memory first: every new address is a map lookup.
const asks = new Map<string, { minute: number; n: number }>();
const str = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ error: 'Missing details.' }, { status: 400 });
  try {
    const { visitorIp, limitPublic } = await import('@/lib/rate-limit');
    const who = `${tenantId}|${visitorIp(req)}`; const minute = Math.floor(Date.now() / 60000);
    const a = asks.get(who); const n = a && a.minute === minute ? a.n + 1 : 1;
    if (asks.size > 5000) asks.clear();
    asks.set(who, { minute, n });
    if (n > 20) return NextResponse.json({ error: 'Please wait a moment and try again.' }, { status: 429 });
    // Counted across every server too: each new address is a paid map lookup and a read of the shop's orders.
    const limited = await limitPublic(req, 'delivq', tenantId, { perHour: 120, perDay: 5000 }); if (limited) return limited;
    const db = getAdminDb();
    const t = await db.doc(`tenants/${tenantId}`).get();
    if (!t.exists) return NextResponse.json({ error: 'Shop not found.' }, { status: 404 });
    const tenant: any = t.data() || {};
    const ad = b.address && typeof b.address === 'object' ? b.address : {};
    const address = { line1: str(ad.line1, 120), line2: str(ad.line2, 80), city: str(ad.city, 80), state: str(ad.state, 40), postalCode: str(ad.postalCode, 12) };
    const ck = String(b.ck || '');
    const same = /^[A-Za-z0-9_-]{16,64}$/.test(ck) ? checkoutSlotHash(tenantId, ck) : '';
    const now = Date.now();
    const v = await deliveryFor(db, tenantId, tenant, address, { itemsCents: Math.max(0, Math.floor(Number(b.itemsCents) || 0)), now, sameCheckout: same, token: b.token });
    if (!v.ok) return NextResponse.json({ ok: false, reason: v.reason, message: v.message, ...(v.minimumCents ? { minimumCents: v.minimumCents } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({
      ok: true, miles: v.miles, feeCents: v.fee.feeCents, free: v.fee.free, freeOverCents: v.zone.freeOverCents, minimumCents: v.zone.minimumCents,
      expressCents: v.zone.expressCents, minutes: v.plan.asap.minutes,
      asap: v.asap.ok ? { ok: true, by: whenLabel(Date.parse(v.asap.byIso), v.tz, dayKey(new Date(now), v.tz)) } : { ok: false },
      windows: v.windows.map((w) => ({ key: w.key, label: w.label, day: w.day, full: w.full })),
      dropoffNotes: v.plan.dropoffNotes, token: v.token,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[delivery-quote]', String(e?.message || e).slice(0, 160));
    return NextResponse.json({ error: 'Delivery couldn’t be checked just now. Try again.' }, { status: 500 });
  }
}
