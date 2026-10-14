// src/app/api/referrals/public/route.ts — REFERRALS, the public side (lib/referrals-server). No sign-in:
//   info { tenantId, code }            → the welcome page: their first name, the offer, their favorite service
//   welcome { tenantId, code }         → the whole welcome page (photos, favorite and times, provider, steps, where, proof)
//   terms { tenantId }                 → the program terms, in plain words
//   mine { token }                     → the visit-link card: their link, credit and friends (the visit link is the key)
//   gift { token, firstName, phone }   → Gift a friend: the text to send from their own phone (we never text the friend)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { publicInfo, welcomeFor, termsFor, mine, giftFriend } from '@/lib/referrals-server';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });
const TOKEN = /^[A-Za-z0-9_-]{6,80}$/;

async function fromVisit(db: any, token: string) {
  if (!TOKEN.test(token)) return null;
  const ci: any = ((await db.doc(`appointmentCheckIns/${token}`).get()).data()) || null;
  if (!ci?.tenantId || !(ci.id || ci.appointmentId)) return null;
  const tenantId = String(ci.tenantId); const a: any = ((await db.doc(`tenants/${tenantId}/appointments/${String(ci.id || ci.appointmentId)}`).get()).data()) || null;
  if (!a || (a.checkInToken && a.checkInToken !== token) || !a.clientId || a.isRenterBooking) return null;
  if (Date.parse(a.startTime) < Date.now() - 365 * 864e5) return null;
  return { tenantId, clientId: String(a.clientId) };
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const action = String(b.action || ''); const db = getAdminDb();
  try {
    if (action === 'info') return j(await publicInfo(db, String(b.tenantId || '').slice(0, 120), String(b.code || '').slice(0, 40)));
    if (action === 'welcome') return j(await welcomeFor(db, String(b.tenantId || '').slice(0, 120), String(b.code || '').slice(0, 40)));
    if (action === 'terms') return j(await termsFor(db, String(b.tenantId || '').slice(0, 120)));
    const v = await fromVisit(db, String(b.token || '')); if (!v) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    if (action === 'mine') return j(await mine(db, v.tenantId, v.clientId));
    if (action === 'gift') return j(await giftFriend(db, v.tenantId, v.clientId, { firstName: String(b.firstName || ''), phone: String(b.phone || '') }));
    return j({ ok: false, error: 'Unknown action.' }, 400);
  } catch (e: any) { console.error('[referrals/public]', e); return j({ ok: false, error: 'That didn’t work. Please try again.' }, 500); }
}
