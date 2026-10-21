// src/app/api/retail/promo/route.ts — "Apply" on a promo code in the shop's checkout: is it good for this cart, and what
// does it take off? A preview only: the cart is priced and the code checked again on the server at checkout
// (api/retail/checkout), so nothing sent here can change what is charged. Wrong guesses count toward a short lockout.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { checkPromo } from '@/lib/promo-codes-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const code = String(b.code || '');
  if (!tenantId || !code.trim()) return NextResponse.json({ ok: false, error: 'Enter a code.' }, { status: 400 });
  const items: any[] = Array.isArray(b.items) ? b.items.slice(0, 60) : [];
  const lines = items.map((it, i) => ({ id: `p${i}`, productId: String(it.productId || ''), unitPriceCents: Math.max(0, Math.round(Number(it.unitPriceCents) || 0)), qtyOrdered: Math.max(1, Math.floor(Number(it.qty) || 1)) })).filter((l) => l.productId);
  if (!lines.length) return NextResponse.json({ ok: false, error: 'Your cart is empty.' }, { status: 400 });
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'shop';
  try {
    const r = await checkPromo(getAdminDb(), tenantId, code, lines, { email: String(b.email || ''), who: ip });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error });
    return NextResponse.json({ ok: true, code: r.code, label: r.label, cents: r.cents, freeShipping: r.freeShipping });
  } catch {
    return NextResponse.json({ ok: false, error: 'We couldn’t check that code just now. Please try again.' }, { status: 500 });
  }
}
