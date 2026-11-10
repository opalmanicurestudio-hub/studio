// src/app/api/inquiry/route.ts — THE PUBLIC INQUIRY FORM SAVES HERE (app/inquiry/[tenantId]). Someone planning an event
// asks a business for a quote: checked and tidied (lib/inquiry-intake), saved to the business's inquiries
// (quoteRequests, which the Quotes page lists), and the business is told. A paused or closed business takes none
// (lib/tenant-open-server). Limited per visitor and per business, so the form can't be used to flood a business.
// POST { tenantId, ...the form }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { closedReply } from '@/lib/tenant-open-server';
import { cleanInquiry } from '@/lib/inquiry-intake';
import { todayIn, tenantTimeZone } from '@/lib/tenant-time';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const tenantId = String(body?.tenantId || '').trim();
    if (!tenantId || !/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'This form’s link is incomplete.' }, { status: 400 });
    { const limited = await limitPublic(req, 'inquiry', tenantId, { perHour: 8, perDay: 60 }); if (limited) return limited; }
    // A form field people never see (filled in), or the whole form sent within seconds of opening it: a robot, thanked
    // and dropped. (Named so a browser's autofill never fills it.)
    // (How long it took is measured on the visitor's own clock, so a clock that's off never drops a real inquiry.)
    const took = Number(body?.tookMs);
    if (String(body?.cf_hp || '').trim() || (Number.isFinite(took) && took >= 0 && took < 4000)) return NextResponse.json({ ok: true });
    const db = getAdminDb();
    const tSnap = await db.doc(`tenants/${tenantId}`).get();
    if (!tSnap.exists) return NextResponse.json({ ok: false, error: 'This business wasn’t found.' }, { status: 404 });
    const tenant: any = tSnap.data() || {};
    { const closed = closedReply(tenant); if (closed) return closed; }
    const services = (await db.collection(`tenants/${tenantId}/services`).get()).docs
      .map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((x: any) => x.type !== 'addon' && x.status !== 'archived');
    const res = cleanInquiry(body, services, todayIn(tenantTimeZone(tenant)), tenantId);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    const now = new Date().toISOString();
    const ref = db.collection(`tenants/${tenantId}/quoteRequests`).doc();
    await ref.set({ ...res.data, id: ref.id, tenantId, submittedAt: now, createdAt: now });
    try {
      const nRef = db.collection(`tenants/${tenantId}/notifications`).doc();
      const d = res.data;
      await nRef.set({ id: nRef.id, type: 'quote_request', read: false, createdAt: now, link: '/quotes?tab=inquiries',
        message: `New inquiry from ${d.fullName}${d.eventDate ? ` for ${d.eventDate}` : ''}${d.guestCount ? `, ${d.guestCount} people` : ''}.` });
    } catch { /* the inquiry is saved; the bell is a bonus */ }
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (err) {
    console.error('[inquiry] failed', err);
    return NextResponse.json({ ok: false, error: 'Your inquiry didn’t go through. Please try again in a moment.' }, { status: 500 });
  }
}
