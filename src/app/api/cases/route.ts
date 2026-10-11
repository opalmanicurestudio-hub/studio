// src/app/api/cases/route.ts — Making it right cases (lib/cases). { tenantId, action: 'open', ... } or { tenantId, id, action, ... }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { openCase, actOnCase } from '@/lib/cases';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80);
  if (!tenantId) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb(); const who = await requestActor(db, req.headers.get('authorization'), tenantId);
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  if (b.action === 'upload') {   // a voice note or photo for an incident or "your side", stored with that visit's case files
    const aid = String(b.appointmentId || b.id || 'staff').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'staff';
    const { uploadClaimPhotoFromDataUrl } = await import('@/lib/claim-photo-upload'); const u = await uploadClaimPhotoFromDataUrl(tenantId, aid, b.dataUrl, 'cases');
    return NextResponse.json(u.url ? { ok: true, url: u.url } : { ok: false, error: u.error || 'That didn’t upload.' }, { status: u.url ? 200 : 400 });
  }
  if (b.action === 'renter_settings' || b.action === 'renter_settings_save') {   // a renter's own Making it right settings
    const me: any = (await db.doc(`tenants/${tenantId}/staff/${who.actor.staffId}`).get()).data() || {};
    if (!(me.isRenter === true || me.role === 'renter')) return NextResponse.json({ ok: false, error: 'Only renters have their own settings here.' }, { status: 403 });
    const { renterSettingsRaw, renterSettingsOf, saveRenterSettings } = await import('@/lib/renter-cases');
    const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    if (b.action === 'renter_settings_save') await saveRenterSettings(db, tenantId, who.actor.staffId, b.settings || {});
    const S = renterSettingsOf(t, await renterSettingsRaw(db, tenantId, who.actor.staffId));
    return NextResponse.json({ ok: true, settings: { reasons: S.reasons, fixes: { redo: S.fixes.redo, refund: S.fixes.refund, note: S.fixes.note }, redoWindowDays: S.redoWindowDays, replyHours: S.replyHours, followUpDays: S.followUpDays, aftercare: { text: S.aftercare.text }, fairUse: { requirePhotos: S.fairUse.requirePhotos, maxFixes: S.fairUse.maxFixes, perMonths: S.fairUse.perMonths } } });
  }
  if (b.action === 'reviews_check') {   // Settings → Making it right → Reviews: "Check now"
    if (!who.actor.isManager) return NextResponse.json({ ok: false, error: 'A manager checks reviews.' }, { status: 403 });
    const { reviewSweep } = await import('@/lib/review-watch'); const t: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const r = await reviewSweep(db, tenantId, t, { force: true }); return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (b.action === 'incident') { const { reportIncident } = await import('@/lib/incidents'); const r = await reportIncident(db, tenantId, who.actor, b); return NextResponse.json(r, { status: r.ok ? 200 : 400 }); }
  if (b.action === 'conduct_decide') { const { decideConduct } = await import('@/lib/incidents'); const r = await decideConduct(db, tenantId, who.actor, b); return NextResponse.json(r, { status: r.ok ? 200 : 400 }); }
  const r = b.action === 'open' ? await openCase(db, tenantId, who.actor, b) : await actOnCase(db, tenantId, who.actor, b);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
