// src/app/api/retail/pro-license/route.ts — A LICENSE ON FILE, SENT FROM THE SHOP (the page is shop/[tenantId]/pro;
// lib/pro-license). Public, so it's limited per visitor and per shop (lib/rate-limit), a hidden field catches
// form-filling scripts, and every answer is checked again here. The copy of the license is saved by the server to a
// place it picks (lib/claim-photo-upload, folder pro-licenses); nothing is public. The managers hear about it and decide
// in Licenses (api/retail/pro-licenses). The answer never says whether an email already has a license on file.
//   GET  ?tenantId= → { open, shopName }   whether the shop takes licenses (it has the shop)
//   POST { tenantId, name, email, phone?, number, state, expiresOn, file, fileName?, hp, ms }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';
import { checkLicenseForm, sendLicense, licensesOf, licenseFor } from '@/lib/pro-license';
import { tenantTimeZone, todayIn } from '@/lib/tenant-time';
import { moduleEnabled } from '@/lib/modules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const s = (v: any, n: number) => String(v ?? '').trim().slice(0, n);
const shopNameOf = (tenant: any) => String(tenant?.businessName || tenant?.name || '').trim();
const MAX_WAITING = 200;

export async function GET(req: NextRequest) {
  const t = s(req.nextUrl.searchParams.get('tenantId'), 120);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(t)) return NextResponse.json({ ok: false, error: 'Which shop?' }, { status: 400 });
  const snap = await getAdminDb().doc(`tenants/${t}`).get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: 'That shop isn’t here.' }, { status: 404 });
  const tenant = snap.data() || {};
  return NextResponse.json({ ok: true, open: moduleEnabled(tenant, 'retail'), shopName: shopNameOf(tenant) });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const t = s(b.tenantId, 120);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(t)) return NextResponse.json({ ok: false, error: 'Which shop?' }, { status: 400 });
  const limited = await limitPublic(req, 'prolicense', t, { perHour: 6, perDay: 150 }); if (limited) return limited;
  // The hidden field: a person never sees it, a script fills everything. Answered as if it worked, and nothing kept.
  if (s(b.hp, 200)) { console.warn('[pro-license] not kept: hidden field', t); return NextResponse.json({ ok: true, message: 'Sent. You’ll get an email once it’s checked.' }); }
  // Sent within three seconds of opening (or with no time at all, as only a script sends it): said plainly, so a person
  // who used autofill just sends it again.
  const ms = Number(b.ms);
  if (b.ms == null || !Number.isFinite(ms) || ms < 3000) return NextResponse.json({ ok: false, error: 'Check your answers and send it again.' }, { status: 400 });
  const db = getAdminDb();
  const snap = await db.doc(`tenants/${t}`).get();
  if (!snap.exists) return NextResponse.json({ ok: false, error: 'That shop isn’t here.' }, { status: 404 });
  const tenant = snap.data() || {};
  if (!moduleEnabled(tenant, 'retail')) return NextResponse.json({ ok: false, error: 'This shop isn’t taking licenses right now.' }, { status: 403 });
  // Checked before anything is saved, so a form that isn't right never leaves a file behind.
  const today = todayIn(tenantTimeZone(tenant));
  const chk = checkLicenseForm(b, today);
  if (!chk.ok) return NextResponse.json({ ok: false, error: chk.message }, { status: 400 });
  // (A photo of it is what the team checks it by.)
  if (!b.file) return NextResponse.json({ ok: false, error: 'Add a photo of your license.' }, { status: 400 });
  // A shop with a pile waiting takes no new ones for a while; one sent again (it replaces what that email has waiting)
  // is always taken.
  const had: any = await licenseFor(db, t, chk.fields.email).catch(() => null);
  const replaces = !!had && (had.status === 'waiting' || !!had.pending);
  const waiting = replaces ? 0 : await licensesOf(db, t).where('toCheck', '==', true).count().get().then((c: any) => Number(c.data().count) || 0).catch(() => 0);
  if (waiting >= MAX_WAITING) return NextResponse.json({ ok: false, error: 'This shop has a lot of licenses to look at right now. Try again in a few days.' }, { status: 429 });
  const up = await uploadClaimPhotoFromDataUrl(t, 'licenses', b.file, 'pro-licenses');
  if (!up.url) return NextResponse.json({ ok: false, error: up.error || 'Your copy couldn’t be saved. Try again.' }, { status: 422 });
  const fileUrl = up.url;
  const now = new Date().toISOString();
  const r = await sendLicense(db, t, chk.fields, { fileUrl, fileName: s(b.fileName, 120).replace(/[^\w.\- ]/g, '') || 'license' }, now, today);
  // Each manager hears about it (the bell shows a person their own notifications).
  try {
    const staff = (await db.collection(`tenants/${t}/staff`).get()).docs.map((d: any) => ({ ...(d.data() || {}), id: d.id }))
      .filter((m: any) => m.archived !== true && (m.isManager === true || m.isTenantOwner === true || ['owner', 'admin', 'manager'].includes(String(m.role || '').toLowerCase())));
    const people = staff.length ? staff.map((m: any) => m.id) : [String(tenant.userId || tenant.ownerId || '')].filter(Boolean);
    const message = `${chk.fields.name} sent ${r.fresh ? 'a license' : r.pending ? 'a renewed license' : 'their license again'} to check (${chk.fields.state}).`;
    const batch = db.batch();
    for (const id of people) { const n = db.collection(`tenants/${t}/notifications`).doc(); batch.set(n, { id: n.id, userId: id, type: 'pro_license', title: 'License to check', read: false, createdAt: now, link: '/retail-orders/licenses', message }); }
    await batch.commit();
  } catch { /* it's waiting in Licenses either way */ }
  return NextResponse.json({ ok: true, message: 'Sent. You’ll get an email once it’s checked.' });
}
