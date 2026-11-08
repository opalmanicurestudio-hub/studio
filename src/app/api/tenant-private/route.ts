// src/app/api/tenant-private/route.ts — the business's private details (lib/tenant-private): the owner's mobile for
// briefs and alerts, the curbside alert number, the ship-from address, and the guest Wi-Fi. They're kept off the public
// business record, so the team's screens read and change them here. Managers and the owner only.
//
// POST { tenantId, action: 'get' }                       → { ok, values }
// POST { tenantId, action: 'set', values: { ...some } }  → { ok, values }
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { tenantPrivate, setTenantPrivate, movePrivateFields, type TenantPrivate } from '@/lib/tenant-private';

export const dynamic = 'force-dynamic';

const shown = (p: TenantPrivate) => ({ ownerPhone: p.ownerPhone, curbsideAlertPhone: p.curbsideAlertPhone, shipFrom: p.shipFrom, wifiNetwork: p.wifiNetwork, wifiPassword: p.wifiPassword });

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const tenantId = String(b?.tenantId || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ ok: false, error: 'Unknown business.' }, { status: 400 });
  const db = getAdminDb();
  try {
    const w = await requestActor(db, req.headers.get('authorization'), tenantId);
    if (!w.ok) return NextResponse.json({ ok: false, error: w.error }, { status: w.status });
    if (!(w.actor.isOwner || w.actor.isManager)) return NextResponse.json({ ok: false, error: 'Managers only.' }, { status: 403 });
    // Any old copies on the business record move to the private place the first time the team opens them.
    try { await movePrivateFields(db, tenantId); } catch (e) { console.error('[tenant-private] move', e); }
    if (b?.action === 'set') {
      const v = b?.values && typeof b.values === 'object' ? b.values : {};
      const patch: any = {};
      for (const k of ['ownerPhone', 'curbsideAlertPhone', 'shipFrom', 'wifiNetwork', 'wifiPassword']) if (k in v) patch[k] = v[k];
      await setTenantPrivate(db, tenantId, patch);
    } else if (b?.action !== 'get') {
      return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, values: shown(await tenantPrivate(db, tenantId)) });
  } catch (e) {
    console.error('[tenant-private]', e);
    return NextResponse.json({ ok: false, error: 'That didn’t save. Please try again.' }, { status: 500 });
  }
}
