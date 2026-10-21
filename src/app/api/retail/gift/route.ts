// src/app/api/retail/gift/route.ts — GIFT EXCHANGE, for the person who received a gift. They prove the gift with the
// code on the gift slip (never the buyer's order code). They see only the items: no prices, no buyer details.
//   GET  ?tenantId&orderId&g           → what can be exchanged, and the shop's window
//   POST { tenantId, orderId, g, selections: [{ lineId, qty, reason }], name, email }
//        → an open return for shop credit in the recipient's own name. The buyer isn't told.
// Same rules as any return: the shop's returns switch and window, final-sale items, what's already coming back.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { canReturnLine } from '@/lib/return-eligibility';
import { reservedByOpenReturns } from '@/lib/return-reserve';
import { giftWindow } from '@/lib/gift-orders';
import { effectiveUnitCents } from '@/lib/retail-swap';

export const dynamic = 'force-dynamic';

const REASONS = ['changed_mind', 'damaged_in_transit', 'defective', 'wrong_item', 'other'];

async function load(tenantId: string, orderId: string, g: string) {
  const db = getAdminDb();
  const [tSnap, oSnap] = await Promise.all([db.collection('tenants').doc(tenantId).get(), db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId).get()]);
  if (!tSnap.exists || !oSnap.exists) return { error: 'We couldn’t find that gift.', status: 404 } as const;
  const order = oSnap.data() as any;
  if (!g || !order.gift?.token || order.gift.token !== g) return { error: 'This gift link isn’t valid.', status: 403 } as const;
  const tenant = tSnap.data() as any;
  const rs = tenant.retailSettings || {};
  const open = (await db.collection(`tenants/${tenantId}/retailReturns`).where('orderId', '==', orderId).limit(50).get()).docs.map((d: any) => d.data());
  return { db, order, tenant, rs, open } as const;
}

function itemsOf(order: any, open: any[]) {
  return (order.lines || []).filter((l: any) => l.digital !== true).map((l: any) => {
    const left = Math.max(0, (l.qtyOrdered || 0) - (l.qtyShorted || 0) - (l.qtyReturned || 0) - reservedByOpenReturns(open, l.lineId));
    const elig = canReturnLine(l, 'changed_mind' as any);
    return { lineId: l.lineId, name: `${l.name}${l.optionsLabel ? ` · ${l.optionsLabel}` : ''}`, qty: left, finalSale: !elig.allowed, finalSaleNote: elig.allowed ? '' : String((elig as any).message || '') };
  }).filter((x: any) => x.qty > 0 || x.finalSale);
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const tenantId = String(p.get('tenantId') || ''); const orderId = String(p.get('orderId') || ''); const g = String(p.get('g') || '');
  { const limited = await limitPublic(req, 'gift', tenantId, { perHour: 60, perDay: 500 }); if (limited) return limited; }
  const r = await load(tenantId, orderId, g);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const w = giftWindow(r.order, r.rs);
  return NextResponse.json({
    ok: true, shopName: String(r.tenant.businessName || r.tenant.name || ''), to: String(r.order.gift?.to || ''),
    shipped: r.order.method === 'ship' && !!r.order.shippingAddress,
    window: w, items: itemsOf(r.order, r.open),
  });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  const tenantId = String(b.tenantId || ''); const orderId = String(b.orderId || ''); const g = String(b.g || '');
  { const limited = await limitPublic(req, 'gift-return', tenantId, { perHour: 10, perDay: 100 }); if (limited) return limited; }
  const r = await load(tenantId, orderId, g);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const w = giftWindow(r.order, r.rs);
  if (!w.open) return NextResponse.json({ error: w.reason }, { status: 409 });
  const name = String(b.name || '').trim().slice(0, 80);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Add your name and email, so your credit can reach you.' }, { status: 400 });
  const sels = Array.isArray(b.selections) ? b.selections : [];
  const lines: any[] = [];
  for (const s of sels) {
    const qty = Math.floor(Number(s?.qty) || 0); if (qty <= 0) continue;
    const orig = (r.order.lines || []).find((l: any) => l.lineId === s.lineId);
    if (!orig || orig.digital === true) return NextResponse.json({ error: 'That item isn’t part of this gift.' }, { status: 400 });
    const left = Math.max(0, (orig.qtyOrdered || 0) - (orig.qtyShorted || 0) - (orig.qtyReturned || 0) - reservedByOpenReturns(r.open, orig.lineId));
    if (qty > left) return NextResponse.json({ error: `Only ${left} of ${orig.name} can still be exchanged.` }, { status: 400 });
    const reason = REASONS.includes(s.reason) ? s.reason : 'changed_mind';
    const elig = canReturnLine(orig, reason as any);
    if (!elig.allowed) return NextResponse.json({ error: String((elig as any).message || ''), finalSale: true }, { status: 409 });
    lines.push({ lineId: orig.lineId, sku: orig.sku || '', name: orig.name, qty, reason });
  }
  if (!lines.length) return NextResponse.json({ error: 'Pick at least one item.' }, { status: 400 });
  const value = lines.reduce((sum, rl) => { const ol = (r.order.lines || []).find((l: any) => l.lineId === rl.lineId); return sum + rl.qty * (ol ? effectiveUnitCents(ol) : 0); }, 0);
  const db = r.db; const now = new Date().toISOString();
  const retRef = db.collection(`tenants/${tenantId}/retailReturns`).doc();
  const orderRef = db.collection(`tenants/${tenantId}/retailOrders`).doc(orderId);
  const batch = db.batch();
  batch.set(retRef, JSON.parse(JSON.stringify({
    id: retRef.id, tenantId, orderId, orderNumber: r.order.orderNumber, lines, resolution: 'store_credit', status: 'open', photoUrls: [],
    storeCreditCents: value, giftRecipient: { name, email }, isGiftReturn: true,
    openedBy: `Gift recipient — ${name}`, openedAt: now,
  })));
  const ev = orderRef.collection('events').doc();
  batch.set(ev, { id: ev.id, type: 'return_opened', at: now, actorId: 'gift_recipient', actorName: name, meta: { returnId: retRef.id, units: lines.reduce((a, l) => a + l.qty, 0), gift: true } });
  await batch.commit();
  const shipped = r.order.method === 'ship' && !!r.order.shippingAddress;
  return NextResponse.json({ ok: true, returnId: retRef.id, shipped, message: shipped ? 'Exchange started. Your prepaid return label is on its way to this page and your email.' : 'Exchange started. Bring the items to the shop and they’ll finish it.' });
}
