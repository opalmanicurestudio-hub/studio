// src/app/api/timeclock/punch/route.ts — THE ONE PLACE A CLOCK-IN, BREAK OR CLOCK-OUT IS RECORDED (lib/punch).
//   { tenantId, action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'state', pin?, staffId?, geo? }
// Who is punching:
//   • a PIN (the kiosk and the staff page) — checked here, with the same lock-out after repeated wrong PINs;
//   • a signed-in team member (Bearer token, the staff portal included) — punches for themselves;
//   • a manager signed in may punch for someone else (staffId) — recorded as done by them.
// 'state' answers where the person is (clocked in, on a break) without recording anything, so screens show the right
// buttons. Errors come back in plain words and nothing is written.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { findStaffByPin, pinLocked, recordPinAttempt } from '@/lib/pin';
import { recordPunch, punchState, type PunchAction } from '@/lib/punch';
export const dynamic = 'force-dynamic';


export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || '').slice(0, 80); const action = String(b.action || '');
  if (!tenantId || !['clock_in', 'clock_out', 'break_start', 'break_end', 'state'].includes(action)) return NextResponse.json({ ok: false, error: 'Missing details.' }, { status: 400 });
  const db = getAdminDb();
  let staffId = ''; let actor: { id: string; name?: string } | undefined; let via = String(b.via || 'kiosk').slice(0, 20);

  if (b.pin != null && b.pin !== '') {
    if (await pinLocked(db, tenantId)) return NextResponse.json({ ok: false, error: 'Too many wrong PINs — the clock is locked for 15 minutes. Ask a manager.' }, { status: 423 });
    const hit = await findStaffByPin(db, tenantId, String(b.pin));
    await recordPinAttempt(db, tenantId, !!hit);
    if (!hit) return NextResponse.json({ ok: false, error: 'PIN not recognised. Check it and try again.' }, { status: 401 });
    if (b.staffId && String(b.staffId) !== hit.id) return NextResponse.json({ ok: false, error: 'That PIN belongs to someone else.' }, { status: 401 });
    staffId = hit.id; actor = { id: hit.id, name: hit.name };
  } else {
    const who = await requestActor(db, req.headers.get('authorization'), tenantId);
    if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
    const target = String(b.staffId || who.actor.staffId);
    if (target !== who.actor.staffId && !who.actor.isManager) return NextResponse.json({ ok: false, error: 'Only a manager can clock someone else in or out.' }, { status: 403 });
    staffId = target; actor = { id: who.actor.staffId, name: who.actor.name };
    if (who.actor.portal) via = 'portal'; else if (target !== who.actor.staffId) via = 'manager';
  }

  if (action === 'state') {
    const [tSnap, sSnap] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/staff/${staffId}`).get()]);
    const recent = (await db.collection(`tenants/${tenantId}/activityLogs`).where('timestamp', '>=', new Date(Date.now() - 2 * 86400000).toISOString()).get()).docs.map((d: any) => d.data() || {}).filter((p: any) => p.staffId === staffId);
    const s: any = sSnap.data() || {};
    return NextResponse.json({ ok: true, staff: { id: staffId, name: s.name || '', avatarUrl: s.avatarUrl || null, role: s.role || 'staff' }, state: punchState(recent, tSnap.data() || {}) });
  }
  const r = await recordPunch(db, { tenantId, staffId, action: action as PunchAction, via, actor, geo: b.geo && typeof b.geo === 'object' ? { verified: !!b.geo.verified, warnOnly: !!b.geo.warnOnly, coords: b.geo.coords || null } : undefined });
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
