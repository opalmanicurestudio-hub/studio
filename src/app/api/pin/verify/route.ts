// src/app/api/pin/verify/route.ts — CHECK A PIN on the server. Used by every screen that asks for one.
//   { tenantId, pin, roles? }  → { ok, staff: { id, name, role, avatarUrl } } — never the PIN, phone or email.
// `roles` limits who counts (e.g. ['owner','admin'] for refunds). 10 wrong tries per business in 15 minutes locks it.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { findStaffByPin, pinLocked, recordPinAttempt, validPin } from '@/lib/pin';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const pin = String(b.pin || '');
  if (!tenantId || !validPin(pin)) return NextResponse.json({ ok: false, error: 'Enter a 4-digit PIN.' }, { status: 400 });
  const db = getAdminDb();
  if (await pinLocked(db, tenantId)) return NextResponse.json({ ok: false, error: 'Too many wrong PINs — wait 15 minutes, or ask a manager.' }, { status: 423 });
  const hit = await findStaffByPin(db, tenantId, pin);
  await recordPinAttempt(db, tenantId, !!hit);
  if (!hit) return NextResponse.json({ ok: false, error: 'That PIN isn’t right.' }, { status: 401 });
  const roles: string[] = Array.isArray(b.roles) ? b.roles.map((r: any) => String(r).toLowerCase()) : [];
  if (roles.length && !roles.includes(hit.role.toLowerCase())) return NextResponse.json({ ok: false, error: 'That PIN can’t approve this.' }, { status: 403 });
  const s = hit.data || {};
  return NextResponse.json({ ok: true, staff: { id: hit.id, name: hit.name, role: hit.role, avatarUrl: s.avatarUrl || null, isRenter: s.isRenter === true || hit.role === 'renter' } });
}
