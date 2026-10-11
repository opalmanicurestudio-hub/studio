// /api/gift-cards/shop — THE ONLINE GIFT CARD SHOP (lib/gift-shop). Public: anyone can buy one for this business.
//   GET  ?tenantId                     → the shop: business, designs on offer, amounts, rules
//   GET  ?tenantId&order&k             → the buyer's private page for one order
//   POST start   { tenantId, … }       → save the order and open the payment form
//        confirm { tenantId, orderId } → after paying: make the card if the payment went through
//        change  { tenantId, orderId, k, sendAt? | now? | recipientEmail? | recipientPhone? } → before it's sent
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { shopInfo, startGiftOrder, confirmGiftOrder, orderView, changeOrder, orderKey } from '@/lib/gift-shop';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const okT = (t: any) => typeof t === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(t);
const okId = (t: any) => typeof t === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(t);

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const tenantId = q.get('tenantId'); if (!okT(tenantId)) return j({ ok: false, error: 'Unknown business.' }, 400);
  const db = getAdminDb(); const order = q.get('order');
  if (order) {
    if (!okId(order) || q.get('k') !== orderKey(tenantId!, order)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    const [v, s] = await Promise.all([orderView(db, tenantId!, order), shopInfo(db, tenantId!)]); if (!v || !s) return j({ ok: false, error: 'That gift wasn’t found.' }, 404);
    return j({ ok: true, order: v, brand: v.ownerName ? { ...s.brand, name: v.ownerName, logo: null, phone: null } : s.brand, timeZone: s.timeZone });
  }
  const s = await shopInfo(db, tenantId!, q.get('provider')); if (!s) return j({ ok: false, error: 'This business wasn’t found.' }, 404);
  return j({ ok: true, ...s });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = b.tenantId; if (!okT(tenantId)) return j({ ok: false, error: 'Unknown business.' }, 400);
  const db = getAdminDb(); const action = String(b.action || '');
  if (action === 'start') {
    const limited = await limitPublic(req, 'gift_shop', tenantId, { perHour: 20, perDay: 60 }); if (limited) return limited;
    try { const r = await startGiftOrder(db, tenantId, b, req.nextUrl.origin); return j(r, r.ok ? 200 : 400); }
    catch (e: any) { console.error('[gift shop] start', e?.message); return j({ ok: false, error: 'The payment form didn’t open. Please try again.' }, 500); }
  }
  if (!okId(b.orderId)) return j({ ok: false, error: 'That order wasn’t found.' }, 404);
  if (action === 'confirm') { try { return j(await confirmGiftOrder(db, tenantId, b.orderId, req.nextUrl.origin)); } catch (e: any) { console.error('[gift shop] confirm', e?.message); return j({ ok: true, paid: false }); } }
  if (action === 'change') {
    if (b.k !== orderKey(tenantId, b.orderId)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    const r = await changeOrder(db, tenantId, b.orderId, { sendAt: b.sendAt, now: b.now === true, recipientEmail: b.recipientEmail, recipientPhone: b.recipientPhone }); return j(r, r.ok ? 200 : 400);
  }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
