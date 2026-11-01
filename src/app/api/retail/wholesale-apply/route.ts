// src/app/api/retail/wholesale-apply/route.ts — APPLYING FOR WHOLESALE, FROM THE SHOP (the page is
// shop/[tenantId]/wholesale). Public, so it's limited per visitor and per shop (lib/rate-limit), a hidden field
// catches form-filling scripts, and lib/wholesale-server checks every answer again and keeps one application waiting
// per email. A certificate copy is saved by the server to a place it picks (lib/claim-photo-upload); nothing is
// public. The team hears about a new one (notifications) and decides in Wholesale.
//   GET  ?tenantId=        → { open, shopName }            whether the shop takes applications
//   GET  ?tenantId=&code=  → { ok, business }              whether a code works here (the "use your code" link)
//   POST { tenantId, businessName, contactName, email, phone, kind, state, website, certNumber, certFile?, certFileName?, note, hp, ms }
// The hidden field (hp) is one a person never sees and a browser doesn't fill: filled, it's answered as if sent and not
// kept (and logged). ms is how long the form was open: under three seconds, they're asked to check it and send again.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { applyForWholesale, checkApplication, pendingCount, tooManyWaiting } from '@/lib/wholesale-server';
import { resolveWholesaleAccess } from '@/lib/retail-wholesale';
import { getRetailSecrets } from '@/lib/retail-secrets';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const shopNameOf = (tenant: any) => String(tenant?.businessName || tenant?.name || '').trim();

export async function GET(req: NextRequest) {
  const t = s(req.nextUrl.searchParams.get('tenantId'), 120);
  if (!t) return NextResponse.json({ ok: false, error: 'Which shop?' }, { status: 400 });
  const db = getAdminDb();
  const snap = await db.doc(`tenants/${t}`).get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: 'That shop isn’t here.' }, { status: 404 });
  const tenant = snap.data() || {}; const rs = tenant.retailSettings || {};
  const code = s(req.nextUrl.searchParams.get('code'), 40);
  if (!code) return NextResponse.json({ ok: true, open: rs.wholesaleApplyOpen === true, shopName: shopNameOf(tenant) });
  const limited = await limitPublic(req, 'wscode', t, { perHour: 30, perDay: 2000 }); if (limited) return limited;
  const a = await resolveWholesaleAccess(db, t, { ...rs, wholesaleAccessCode: (await getRetailSecrets(db, t)).wholesaleAccessCode }, code);
  if (!a.unlocked) return NextResponse.json({ ok: false, error: a.error || 'That code isn’t one of this shop’s.' }, { status: 403 });
  return NextResponse.json({ ok: true, business: a.account?.businessName || '' });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const t = s(b.tenantId, 120);
  if (!t) return NextResponse.json({ ok: false, error: 'Which shop?' }, { status: 400 });
  const limited = await limitPublic(req, 'wsapply', t, { perHour: 6, perDay: 150 }); if (limited) return limited;
  // The hidden field: a person never sees it, a script fills everything. Answered as if it worked, and nothing kept.
  if (s(b.hp, 200)) { console.warn('[wholesale-apply] not kept: hidden field', t); return NextResponse.json({ ok: true, message: 'Sent.' }); }
  // Sent within three seconds of opening: said plainly, so a person who used autofill just sends it again.
  if (Number.isFinite(Number(b.ms)) && Number(b.ms) < 3000) { console.warn('[wholesale-apply] too fast', t); return NextResponse.json({ ok: false, error: 'Check your answers and send it again.' }, { status: 400 }); }
  const db = getAdminDb();
  const snap = await db.doc(`tenants/${t}`).get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: 'That shop isn’t here.' }, { status: 404 });
  const tenant = snap.data() || {}; const rs = tenant.retailSettings || {};
  if (rs.wholesaleApplyOpen !== true) return NextResponse.json({ ok: false, error: 'This shop isn’t taking wholesale applications right now.' }, { status: 403 });
  // Checked before anything is saved, so a form that isn't right never leaves a file behind.
  const chk = checkApplication(b);
  if (!chk.ok) return NextResponse.json({ ok: false, error: chk.message }, { status: 400 });
  if (tooManyWaiting(await pendingCount(db, t))) return NextResponse.json({ ok: false, error: 'This shop has a lot of applications to look at right now. Try again in a few days.' }, { status: 429 });
  let certFileUrl = '';
  if (b.certFile) {
    const up = await uploadClaimPhotoFromDataUrl(t, 'applications', b.certFile, 'wholesale-certs');
    if (!up.url) return NextResponse.json({ ok: false, error: up.error || 'Your certificate couldn’t be saved. Try again, or send it without one.' }, { status: 422 });
    certFileUrl = up.url;
  }
  const r = await applyForWholesale(db, t, { ...b, certFileUrl, certFileName: s(b.certFileName, 120).replace(/[^\w.\- ]/g, '') }, rs);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.message }, { status: 400 });
  if (r.fresh) {
    // Each manager hears about it (the bell shows a person their own notifications).
    try {
      const staff = (await db.collection(`tenants/${t}/staff`).get()).docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }))
        .filter((m: any) => m.archived !== true && (m.isManager === true || m.isTenantOwner === true || ['owner', 'admin', 'manager'].includes(String(m.role || '').toLowerCase())));
      const at = new Date().toISOString(); const message = `${chk.fields.businessName} applied for wholesale.`;
      const batch = db.batch();
      // No team listed yet: the owner of the business hears about it.
      const people = staff.length ? staff.map((m: any) => m.id) : [String(tenant.userId || tenant.ownerId || '')].filter(Boolean);
      for (const id of people) { const n = db.collection(`tenants/${t}/notifications`).doc(); batch.set(n, { id: n.id, userId: id, type: 'wholesale', title: 'Wholesale application', read: false, createdAt: at, link: '/retail-orders/wholesale', message }); }
      await batch.commit();
    } catch { /* it's waiting in Wholesale either way */ }
  }
  return NextResponse.json({ ok: true, message: r.message });
}
