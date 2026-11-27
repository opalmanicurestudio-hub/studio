// src/app/api/mileage/route.ts — THE BUSINESS'S MILEAGE LOG (lib/trip-log, lib/trip-log-server; design board "Mileage:
// logged as you go, with proof"). Anyone who keeps the books (money.manage) sees it and downloads it; only the owner logs
// and changes it, as it's the owner's car the return asks about (Schedule C, Part IV). POST { tenantId, action }:
//   list     { year? }                          → the year's trips and figures, kept places, suggested trips, a drive under way
//   start    { lat, lng }                       → a drive starts here, now (the same drive again if one's under way)
//   end      { lat, lng }                       → the drive ends here: where it went and the miles, to save
//   save     { purpose, note?, roundTrip?, use? } → the ended drive kept as a trip
//   cancel   {}                                 → the drive under way dropped
//   miles    { from, to }                       → one way's miles between two places, before adding a trip
//   add      { from, to, miles?, day, purpose, note?, roundTrip?, use? } → a trip added after (typed miles, or from the map)
//   suggested { id, purpose?, roundTrip? }      → a suggested trip logged, its purchase or event kept as proof
//   dismiss  { id }                             → a suggestion that wasn't a drive
//   edit     { id, purpose?, note?, day?, miles?, roundTrip?, use? } → a trip changed (what it was is kept)
//   remove   { id }                             → a trip taken out of the log (kept, marked)
//   setup    { home?, homeIsMain?, year?, start?, end? } → home, whether the business is run from home, odometer readings
//   export   { year }                           → the year's log as a spreadsheet
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireCan } from '@/lib/route-guard';
import { logAuditAdmin } from '@/lib/audit';
import { mileageAction } from '@/lib/mileage-actions';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b?.tenantId || ''); const action = String(b?.action || 'list');
    if (!ID.test(tenantId)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const g = await requireCan(req, tenantId, 'money.manage'); if (g.deny) return g.deny;
    const db = getAdminDb(); const a = g.actor; const tenant: any = g.tenant || (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const by = { id: String(a.id || a.uid || 'owner'), name: String(a.name || 'Owner').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 80) || 'Owner' };
    const actor = { type: 'user', id: by.id, name: by.name } as any;
    // (The owner logs and changes it, as it's their car the return asks about; anyone who keeps the books sees it and
    // downloads it. Suggestions come from the owner's own card purchases too, so they're the owner's only.)
    const r = await mileageAction({ db, tenantId, tenant, who: null, by, canLog: !!a.isTenantOwner, suggest: !!a.isTenantOwner,
      audit: (summary, id) => logAuditAdmin(db, tenantId, { action: 'mileage.trip', targetType: 'mileage', targetId: id, summary, actor }).catch(() => {}),
      onlyWords: 'The owner keeps the mileage log: it’s for their car. You can see it and download it.' }, action, b);
    return reply(r.body, r.status);
  } catch (e: any) {
    console.error('[mileage]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
