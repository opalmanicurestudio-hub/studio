// /api/gift-cards/shop — THE ONLINE GIFT CARD SHOP (lib/gift-shop). Public: anyone can buy one for this business.
//   GET  ?tenantId                     → the shop: business, designs on offer, amounts, rules
//   GET  ?tenantId&order&k             → the buyer's private page for one order
//   POST start   { tenantId, … }       → save the order and open the payment form
//        confirm { tenantId, orderId } → after paying: make the card if the payment went through
//        change  { tenantId, orderId, k, sendAt? | now? | recipientEmail? | recipientPhone? } → before it's sent
//   Chip in (lib/gift-groups): GET ?group&k|o; POST group-start, chip, group-send, group-cancel, group-move
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { shopInfo, startGiftOrder, confirmGiftOrder, orderView, changeOrder, orderKey, findMyCards, walletView, payDepositWithGiftCard } from '@/lib/gift-shop';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const okT = (t: any) => typeof t === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(t);
const okId = (t: any) => typeof t === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(t);

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const tenantId = q.get('tenantId'); if (!okT(tenantId)) return j({ ok: false, error: 'Unknown business.' }, 400);
  const db = getAdminDb(); const order = q.get('order');
  if (q.get('bulk')) {   // a company order's private page (lib/gift-bulk)
    const id = q.get('bulk') || ''; const B = await import('@/lib/gift-bulk'); if (!okId(id) || q.get('k') !== B.bulkKey(tenantId!, id)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    const [v, s] = await Promise.all([B.bulkView(db, tenantId!, id), shopInfo(db, tenantId!)]); if (!v || !s) return j({ ok: false, error: 'That order wasn’t found.' }, 404);
    return j({ ok: true, order: v, brand: s.brand, timeZone: s.timeZone }); }
  if (q.get('group')) {   // a chip-in: the share page (k) or the organizer's page (o)
    const gid = q.get('group') || ''; const G = await import('@/lib/gift-groups'); const role = okId(gid) ? G.roleFor(tenantId!, gid, q.get('k'), q.get('o')) : null;
    if (!role) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    const [v, s] = await Promise.all([G.groupView(db, tenantId!, gid, role), shopInfo(db, tenantId!)]); if (!v || !s) return j({ ok: false, error: 'That gift wasn’t found.' }, 404);
    return j({ ok: true, group: v, brand: s.brand, timeZone: s.timeZone, max: s.max }); }
  if (q.get('wallet')) { const cards = await walletView(db, tenantId!, q.get('wallet') || '', q.get('k') || ''); const s = await shopInfo(db, tenantId!);
    if (!cards || !s) return j({ ok: false, error: 'This link isn’t valid.' }, 404); return j({ ok: true, cards, brand: s.brand, bookUrl: `/book/${encodeURIComponent(tenantId!)}` }); }
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
  if (action === 'find') { const limited = await limitPublic(req, 'gift_find', tenantId, { perHour: 5, perDay: 15 }); if (limited) return limited;
    const r = await findMyCards(db, tenantId, String(b.contact || '').slice(0, 120), req.nextUrl.origin); return j(r, r.ok ? 200 : 400); }
  if (action === 'deposit') {   // pay a held booking's deposit with a gift card (the online booking page)
    const limited = await limitPublic(req, 'gift_deposit', tenantId, { perHour: 15, perDay: 40 }); if (limited) return limited;
    if (!okId(b.appointmentId)) return j({ ok: false, error: 'We couldn’t find that booking.' }, 404);
    try { const r: any = await payDepositWithGiftCard(db, tenantId, b.appointmentId, String(b.code || '').slice(0, 40), req.nextUrl.origin); return j(r, r.ok ? 200 : 400); }
    catch (e: any) { console.error('[gift shop] deposit', e?.message); return j({ ok: false, error: 'That didn’t go through — nothing was taken. Please try again.' }, 500); }
  }
  // CHIP IN (lib/gift-groups): start one, add a share, and — for the organizer — send it now, change the day, or cancel.
  if (action === 'bulk-request') { const limited = await limitPublic(req, 'gift_bulk', tenantId, { perHour: 3, perDay: 8 }); if (limited) return limited;
    const r: any = await (await import('@/lib/gift-bulk')).requestBulk(db, tenantId, b); return j(r, r.ok ? 200 : 400); }
  if (action === 'bulk-pay' || action === 'bulk-confirm') { const B = await import('@/lib/gift-bulk');
    if (!okId(b.bulkId) || b.k !== B.bulkKey(tenantId, b.bulkId)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    try { const r: any = action === 'bulk-pay' ? await B.payBulk(db, tenantId, b.bulkId, req.nextUrl.origin) : await B.confirmBulk(db, tenantId, b.bulkId, String(b.sessionId || '')); return j(r, r.ok ? 200 : 400); }
    catch (e: any) { console.error('[gift shop] bulk', e?.message); return j({ ok: false, error: 'That didn’t go through — nothing was taken. Please try again.' }, 500); } }
  if (action === 'group-start' || action === 'chip') {
    const limited = await limitPublic(req, 'gift_shop', tenantId, { perHour: 20, perDay: 60 }); if (limited) return limited;
    const G = await import('@/lib/gift-groups');
    try {
      if (action === 'group-start') { const r: any = await G.startGroup(db, tenantId, b, req.nextUrl.origin); return j(r, r.ok ? 200 : 400); }
      if (!okId(b.groupId) || G.roleFor(tenantId, b.groupId, b.k, b.o) === null) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
      const r: any = await G.startChip(db, tenantId, b.groupId, { name: b.name, email: b.email, message: b.message, amount: b.amount }, req.nextUrl.origin); return j(r, r.ok ? 200 : 400);
    } catch (e: any) { console.error('[gift shop] group', e?.message); return j({ ok: false, error: 'The payment form didn’t open. Please try again.' }, 500); }
  }
  if (action === 'group-send' || action === 'group-cancel' || action === 'group-move') {
    const G = await import('@/lib/gift-groups'); if (!okId(b.groupId) || G.roleFor(tenantId, b.groupId, null, b.o) !== 'org') return j({ ok: false, error: 'Only the person collecting can do that.' }, 403);
    const r: any = action === 'group-send' ? await G.finishGroup(db, tenantId, b.groupId, 'Organizer') : action === 'group-cancel' ? await G.cancelGroup(db, tenantId, b.groupId) : await G.moveGroup(db, tenantId, b.groupId, b.sendAt);
    return j(r, r.ok ? 200 : 400);
  }
  if (!okId(b.orderId)) return j({ ok: false, error: 'That order wasn’t found.' }, 404);
  if (action === 'confirm') { try { return j(await confirmGiftOrder(db, tenantId, b.orderId, req.nextUrl.origin)); } catch (e: any) { console.error('[gift shop] confirm', e?.message); return j({ ok: true, paid: false }); } }
  if (action === 'change') {
    if (b.k !== orderKey(tenantId, b.orderId)) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    const r = await changeOrder(db, tenantId, b.orderId, { sendAt: b.sendAt, now: b.now === true, recipientEmail: b.recipientEmail, recipientPhone: b.recipientPhone }); return j(r, r.ok ? 200 : 400);
  }
  return j({ ok: false, error: 'Unknown action.' }, 400);
}
