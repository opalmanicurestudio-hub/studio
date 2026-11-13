// src/app/api/pin/verify/route.ts — CHECK A PIN on the server. Used by every screen that asks for one.
//   { tenantId, pin, roles? }  → { ok, staff: { id, name, role, avatarUrl } } — never the PIN, phone or email.
// `roles` limits who counts (e.g. ['owner','admin'] for refunds). 10 wrong tries per business in 15 minutes locks it.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { beginPinAttempt, endPinAttempt, findStaffByPin, validPin } from '@/lib/pin';
import { limitPublic } from '@/lib/rate-limit';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 80); const pin = String(b.pin || '');
  if (!tenantId || !validPin(pin)) return NextResponse.json({ ok: false, error: 'Enter a 4-digit PIN.' }, { status: 400 });
  // Asked without a sign-in, so each device has its own allowance too: a busy till or time clock stays well inside it.
  const limited = await limitPublic(req, 'pin-verify', tenantId, { perHour: 300, perDay: 0 }); if (limited) return limited;
  const db = getAdminDb();
  const ticket = await beginPinAttempt(db, tenantId);
  if (ticket === null) return NextResponse.json({ ok: false, error: 'Too many wrong PINs — wait 15 minutes, or ask a manager.' }, { status: 423 });
  const hit = await findStaffByPin(db, tenantId, pin);
  const roles: string[] = Array.isArray(b.roles) ? b.roles.map((r: any) => String(r).toLowerCase()) : [];
  // A real PIN that can't do what was asked counts as a wrong one.
  await endPinAttempt(db, tenantId, ticket, !!hit && (!roles.length || roles.includes(hit.role.toLowerCase())));
  if (!hit) return NextResponse.json({ ok: false, error: 'That PIN isn’t right.' }, { status: 401 });
  if (roles.length && !roles.includes(hit.role.toLowerCase())) return NextResponse.json({ ok: false, error: 'That PIN can’t approve this.' }, { status: 403 });
  const s = hit.data || {};
  return NextResponse.json({ ok: true, staff: { id: hit.id, name: hit.name, role: hit.role, avatarUrl: s.avatarUrl || null, isRenter: s.isRenter === true || hit.role === 'renter' } });
}
