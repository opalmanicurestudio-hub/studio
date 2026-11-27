// src/app/api/portal/renter-mileage/route.ts — A RENTER'S OWN MILEAGE LOG, for their own business (the renter portal's
// Money › Your business › Mileage; included in rent). A renter is self-employed, so their drives for supplies, classes,
// clients and the bank are their own write-off. The same log the business keeps (lib/mileage-actions, lib/trip-log), kept
// apart in tenants/{t}/private/renter_{renterId}/mileage: never in the business's books or its activity, and the business
// doesn't see it. Drives start from where they rent their space (the business's address on the map) or home; home to the
// space is commuting. No suggested drives: those come from the business's own card purchases.
// Signed in with the renter portal's session token. POST { tenantId, token, action, ... } as api/mileage lists them.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renterSession } from '@/lib/renter-session';
import { mileageAction } from '@/lib/mileage-actions';
import { limitByKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const reply = (body: any, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({})); const tenantId = String(b?.tenantId || ''); const action = String(b?.action || 'list');
    if (!ID.test(tenantId)) return reply({ ok: false, error: 'Something went wrong.' }, 400);
    const db = getAdminDb(); const s = await renterSession(db, tenantId, b.token);
    if (!s || !ID.test(s.renterId)) return reply({ ok: false, error: 'Please sign in again.' }, 401);
    const tenant: any = (await db.doc(`tenants/${tenantId}`).get()).data() || {};
    const name = String(s.name || 'You').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 80) || 'You';
    // (Not "run from home": that's the business's own question. Their space is where they work.)
    const { token: _t, homeIsMain: _h, ...body } = b;
    // (Places looked up on the map are the business's to pay for: a ceiling per renter, well past a busy day's driving.)
    if (['start', 'end', 'miles', 'add', 'setup'].includes(action)) { const limited = await limitByKey('renter-mileage', `${tenantId}|${s.renterId}`, 120, 'That’s a lot of map lookups this hour. Try again later, or type the miles.'); if (limited) return limited; }
    const r = await mileageAction({ db, tenantId, tenant, who: s.renterId, by: { id: `renter_${s.renterId}`, name }, canLog: true, suggest: false,
      audit: async () => {}, onlyWords: 'Sign in again to change your log.' }, action, body);
    return reply(r.body, r.status);
  } catch (e: any) {
    console.error('[renter-mileage]', e?.message);
    return reply({ ok: false, error: 'That didn’t go through. Try again.' }, 500);
  }
}
