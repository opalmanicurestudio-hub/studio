// /api/retail/driver-location — WHERE A DRIVER IS, WHILE THEY HAVE STOPS OUT (lib/delivery-live-server). The staff app
// sends it every half minute or so while they have stops out: { tenantId, lat?, lng?, accuracy?, fixAgeMs?, sharing }.
// Their route and each stop's arrival estimate are kept for the order pages; their location only when they share it
// (and only a fix taken in the last minute). With no stops left, nothing is kept. A driver now a few minutes from their next stop: that customer is texted, once per try.
// The shop's own team only (no renters), and only for the person signed in.
import { NextRequest, NextResponse, after } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { updateDriver } from '@/lib/delivery-live-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return bad('Missing details.');
  const auth: any = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return bad(auth.error || 'Sign in again.', auth.status || 401);
  const a: any = auth.actor;
  if (a.isRenter) return bad('Deliveries are made by the shop’s own team.', 403);
  const staffId = String(a.uid || a.id || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(staffId)) return bad('Sign in again.', 401);
  const lat = Number(b.lat), lng = Number(b.lng);
  const point = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const db = getAdminDb();
  let r: { stops: number; near: { orderId: string; tries: string }[] };
  try { r = await updateDriver(db, tenantId, staffId, String(a.name || ''), { point, accuracy: b.accuracy, sharing: b.sharing === true, fixAgeMs: b.fixAgeMs == null ? null : Number(b.fixAgeMs) }); }
  catch (e: any) { console.warn('[driver-location]', String(e?.message || e).slice(0, 160)); return bad('That update didn’t save. The next one will.', 503); }
  // "A few minutes away": sent straight away, once per try (the delivery texts' own route marks it). It isn't queued to
  // be tried again later: a text that didn't go is tried by a later update, while it's still true (lib/delivery-live-
  // server limits how often). Sent to the app's own address, never one a caller could choose.
  const secret = String(process.env.CRON_SECRET || '');
  const base = String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '') || req.nextUrl.origin;
  for (const n of r.near) {
    const job = async () => {
      await fetch(`${base}/api/retail/delivery-notify`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(req.headers.get('authorization') ? { Authorization: String(req.headers.get('authorization')) } : {}), ...(secret ? { 'x-cf-internal': secret, 'x-internal-key': secret } : {}) },
        body: JSON.stringify({ tenantId, orderId: n.orderId, moment: 'near', try: n.tries }) }).catch(() => null);
    };
    try { after(job); } catch { void job(); }
  }
  return NextResponse.json({ ok: true, stops: r.stops });
}
