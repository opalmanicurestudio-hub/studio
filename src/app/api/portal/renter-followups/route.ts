// src/app/api/portal/renter-followups/route.ts — A RENTER'S OWN FOLLOW-UPS, from their portal (lib/opportunities-server
// renterOpportunitySweep). Only when the business allows it (Opportunities → Finders → Renters). Signed in with the
// renter portal's session token; a renter only ever sees and acts on tasks for their own clients (renterId = them).
//   get                         → whether it's allowed, their settings, their open list
//   settings { on, hour, max }  → switch it on or off; when the list is ready; most a day
//   text { id } · reword { id } · skip { id } → the 5-minute list (consent, texting hours and limits checked as always)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { renterSession, renterStaff } from '@/lib/renter-session';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120);
  const db = getAdminDb(); const s = await renterSession(db, tenantId, b.token);
  if (!s) return j({ ok: false, error: 'Please sign in again.' }, 401);
  const me = await renterStaff(db, tenantId, s.renterId); if (!me) return j({ ok: false, error: 'Your provider profile isn’t set up yet. Please ask the studio.' }, 409);
  const T = `tenants/${tenantId}`; const action = String(b.action || 'get');
  const { oppSettingsOf, renterOppOf } = await import('@/lib/opportunities');
  const tenant: any = (await db.doc(T).get()).data() || {}; const allowed = oppSettingsOf(tenant).renters;
  try {
    if (action === 'get') {
      const set = renterOppOf(((await db.doc(`${T}/renterSettings/${me.id}`).get()).data() || {}).opportunities);
      const items = !allowed ? [] : (await db.collection(`${T}/opportunities`).where('renterId', '==', me.id).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((o: any) => o.status === 'open').map((o: any) => ({ id: o.id, kind: o.kind, status: o.status, clientName: o.clientName, why: o.why, message: o.message, phone: o.phone || null, dueAt: o.dueAt }));
      return j({ ok: true, allowed, settings: set, items });
    }
    if (!allowed) return j({ ok: false, error: 'The studio hasn’t switched this on for renters.' }, 403);
    if (action === 'settings') {
      const v = renterOppOf({ on: b.on === true, hour: b.hour, max: b.max });
      await db.doc(`${T}/renterSettings/${me.id}`).set({ opportunities: v }, { merge: true }); return j({ ok: true, settings: v });
    }
    if (['text', 'reword', 'skip'].includes(action)) {
      const o: any = (await db.doc(`${T}/opportunities/${String(b.id || '').slice(0, 80)}`).get()).data();
      if (!o || o.renterId !== me.id) return j({ ok: false, error: 'This follow-up is no longer available.' }, 404);
      const { actOnOpportunity } = await import('@/lib/opportunities-server');
      const actor = { staffId: me.id, name: String(me.name || 'Provider'), role: 'renter', isManager: false, isOwner: false, portal: true };
      return j(await actOnOpportunity(db, tenantId, actor, { action, id: b.id }, Date.now()));
    }
    return j({ ok: false, error: 'Unknown action.' }, 400);
  } catch (e: any) { console.error('[renter-followups]', e); return j({ ok: false, error: 'That didn’t work. Please try again.' }, 500); }
}
