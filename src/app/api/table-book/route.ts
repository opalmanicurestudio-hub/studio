// src/app/api/table-book/route.ts — A GUEST BOOKS A TABLE ONLINE, and looks after their booking (public). Lib/table-
// booking has the rules; lib/table-booking-server does the work.
//   info      { tenantId } → the business's name and look, the days it takes bookings, the largest party, what a guest
//             can tell us, and the card rule for big tables.
//   slots     { tenantId, day, size } → that day's times, each open or full.
//   book      { tenantId, day, time, size, name, phone?, email?, asks?, note?, agree? } → booked (and their link sent), or
//             for a big table: the card company's form to save their card, the table held a few minutes meanwhile.
//   card_done { tenantId, id, k } → after the form says the card is saved: the booking confirmed.
//   view      { tenantId, id, k } → their booking (the link is the only key, and it opens nothing else).
//   late      { tenantId, id, k, minutes } → running late: the host stand sees it.
//   cancel    { tenantId, id, k } → cancelled.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { toolLocked } from '@/lib/tool-lock';
import { publicLook } from '@/lib/public-look';
import { BOOKING_ASKS, tableBookingOf } from '@/lib/table-booking';
import { resolveHostingSettings } from '@/lib/floor-plans';
import { accountOf } from '@/lib/reader-sale';
import { BookStop, bookableDays, bookingByToken, bookingView, cancelBooking, cardSaved, makeBooking, runningLate, slotsOn } from '@/lib/table-booking-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const H = { 'Cache-Control': 'no-store' };
const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: H });
const bad = (error: string, status = 400, extra: any = {}) => NextResponse.json({ ok: false, error, ...extra }, { status, headers: H });

const hits = new Map<string, number[]>();
function tooMany(key: string, max: number, add = true): boolean {
  const now = Date.now(); const list = (hits.get(key) || []).filter((t) => now - t < 60000); if (add) list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k);
  return list.length > max;
}
const hourly = new Map<string, number[]>();
function tooHourly(key: string, max: number): boolean {
  const now = Date.now(); const list = (hourly.get(key) || []).filter((t) => now - t < 3600000); list.push(now); hourly.set(key, list);
  if (hourly.size > 5000) for (const [k, v] of hourly) if (!v.some((t) => now - t < 3600000)) hourly.delete(k);
  return list.length > max;
}
function callerOf(req: NextRequest): string {
  const h = (k: string) => String(req.headers?.get?.(k) || '').trim();
  const fwd = h('x-forwarded-for').split(',').map((x) => x.trim()).filter(Boolean);
  return (h('x-vercel-forwarded-for').split(',')[0] || h('x-real-ip') || fwd[fwd.length - 1] || 'unknown').trim().slice(0, 60);
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const action = String(b.action || 'info');
  if (!ID.test(tenantId)) return bad('This link isn’t complete.');
  if (!['info', 'slots', 'book', 'card_done', 'view', 'late', 'cancel'].includes(action)) return bad('Unknown action.');
  const ip = callerOf(req);
  if (tooMany(`ip|${ip}`, 200) || tooMany(`miss|${ip}|${tenantId}`, 20, false)) return bad('One moment, then try again.', 429);
  const db = getAdminDb(); const T = `tenants/${tenantId}`;
  try {
    const tenant: any = (await db.doc(T).get()).data();
    if (!tenant) { tooMany(`miss|${ip}|${tenantId}`, 20); return bad('This page isn’t working.', 404); }
    { const locked = toolLocked(tenant, ['hospitality'], 'guest', 'Booking a table isn’t open right now.'); if (locked) return locked; }
    const look = { look: publicLook(tenant), business: String(tenant.name || tenant.businessName || '').slice(0, 80) };
    const s = tableBookingOf(tenant); const origin = req.nextUrl?.origin || '';

    if (action === 'info') {
      if (!s.on) return ok({ ...look, on: false });
      return ok({ ...look, on: true, days: bookableDays(tenant), maxSize: s.maxSize, asks: BOOKING_ASKS, holdMin: resolveHostingSettings(tenant.hostingSettings).holdGraceMinutes,
        // (Only when cards can really be taken here: otherwise big tables book without one, and aren't told otherwise.)
        card: s.card && s.feePerGuest > 0 && accountOf(tenant) && process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? { from: s.cardFrom, feePerGuest: s.feePerGuest, cancelHours: s.cancelHours } : null,
        groups: `/inquiry/${encodeURIComponent(tenantId)}` });
    }
    if (action === 'slots') {
      const size = Math.round(Number(b.size) || 0); const day = String(b.day || '');
      return ok({ day, size, slots: await slotsOn(db, T, tenant, day, size) });
    }
    if (action === 'book') {
      // A few bookings an hour from one place (as the route sees the caller, which a browser can't set), and each mobile
      // number or email can only have a few to come (lib/table-booking-server).
      if (tooMany(`book|${ip}|${tenantId}`, 4) || tooHourly(`book|${ip}|${tenantId}`, 8)) return bad('That’s a lot of bookings at once. Try again a little later.', 429);
      const slow = await limitPublic(req, 'table_book', tenantId, { perHour: 30, perDay: 2000 }); if (slow) return slow;
      const r = await makeBooking(db, T, tenant, tenantId, { day: b.day, time: b.time, size: b.size, name: b.name, phone: b.phone, email: b.email, asks: b.asks, note: b.note, agree: b.agree === true }, { origin });
      return ok(r);
    }
    // The rest are the guest's own booking, by its link.
    const id = String(b.id || ''); const k = String(b.k || '');
    const booking = await bookingByToken(db, T, id, k);
    if (!booking) { tooMany(`miss|${ip}|${tenantId}`, 20); return bad('This link isn’t working any more.', 404); }
    if (action === 'card_done') {
      const r = await cardSaved(db, T, tenant, tenantId, id, { origin });
      if (r.status === 'pending') return NextResponse.json({ ok: false, pending: true, error: 'Your card is still being saved.' }, { status: 202, headers: H });
      return ok(r);
    }
    if (action === 'late') return ok(await runningLate(db, T, id, Number(b.minutes)));
    if (action === 'cancel') return ok(await cancelBooking(db, T, tenant, tenantId, id, 'guest'));
    return ok({ ...look, booking: await bookingView(db, T, tenant, booking) });
  } catch (e: any) {
    if (e instanceof BookStop) return bad(e.msg, e.status, e.code ? { code: e.code } : {});
    console.error('[table-book]', e);
    return bad('That didn’t go through. Try again in a moment.', 500);
  }
}
