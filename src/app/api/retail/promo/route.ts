// src/app/api/retail/promo/route.ts — "Apply" on a promo code in the shop's checkout: is it good for this cart, and what
// does it take off? A preview only: the cart is priced and the code checked again on the server at checkout
// (api/retail/checkout), so nothing sent here can change what is charged. Wrong guesses count toward a short lockout.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { checkPromo } from '@/lib/promo-codes-server';
import { choiceSale } from '@/lib/variants';
import { matchOffers } from '@/lib/retail-offers';
import { liveOffers } from '@/lib/retail-offers-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const code = String(b.code || '');
  if (!tenantId || !code.trim()) return NextResponse.json({ ok: false, error: 'Enter a code.' }, { status: 400 });
  const items: any[] = Array.isArray(b.items) ? b.items.slice(0, 60) : [];
  const lines: any[] = items.map((it, i) => ({ id: `p${i}`, productId: String(it.productId || ''), unitPriceCents: Math.max(0, Math.round(Number(it.unitPriceCents) || 0)), qtyOrdered: Math.max(1, Math.floor(Number(it.qty) || 1)), selections: it.selections && typeof it.selections === 'object' ? it.selections : null })).filter((l) => l.productId && !l.productId.includes('/'));
  if (!lines.length) return NextResponse.json({ ok: false, error: 'Your cart is empty.' }, { status: 400 });
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'shop';
  try {
    const db = getAdminDb();
    // Each line as checkout will place it: a listing's line is the variant its choices sell, with the listing noted, so
    // a code made for one variant (or for the listing) applies here as it will there.
    const snaps = await db.getAll(...lines.map((l) => db.doc(`tenants/${tenantId}/inventory/${l.productId}`)));
    snaps.forEach((snap: any, i: number) => {
      if (!snap.exists) return;
      const sale = choiceSale({ ...(snap.data() || {}), id: snap.id }, lines[i].selections);
      if (sale.variantId) { lines[i].listingId = lines[i].productId; lines[i].productId = sale.variantId; }
    });
    for (const l of lines) delete l.selections;
    // As at checkout: a code doesn't stack on items a bundle already takes money off (lib/retail-offers).
    const offers = await liveOffers(db, tenantId);
    // Lines only partly in a bundle count their other units, as checkout splits them.
    const m = offers.length ? matchOffers(lines.map((l) => ({ id: l.id, productId: l.productId, listingId: l.listingId, unitPriceCents: l.unitPriceCents, qty: l.qtyOrdered })), offers) : null;
    const open = lines.map((l) => ({ ...l, qtyOrdered: l.qtyOrdered - (m?.byLine[l.id] ? (m.unitsByLine[l.id] || 0) : 0) })).filter((l) => l.qtyOrdered > 0);
    const r = await checkPromo(db, tenantId, code, open.length ? open : lines, { email: String(b.email || ''), who: ip });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error });
    if (!open.length && !r.freeShipping) return NextResponse.json({ ok: false, error: 'This code can’t be used on items that are already in a bundle.' });
    if (!open.length) return NextResponse.json({ ok: true, code: r.code, label: r.label, cents: 0, freeShipping: true });
    return NextResponse.json({ ok: true, code: r.code, label: r.label, cents: r.cents, freeShipping: r.freeShipping });
  } catch {
    return NextResponse.json({ ok: false, error: 'We couldn’t check that code just now. Please try again.' }, { status: 500 });
  }
}
