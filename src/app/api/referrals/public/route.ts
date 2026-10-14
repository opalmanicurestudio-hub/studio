// src/app/api/referrals/public/route.ts — REFERRALS, the public side (lib/referrals-server). No sign-in:
//   info { tenantId, code }            → the welcome page: their first name, the offer, their favorite service
//   welcome { tenantId, code }         → the whole welcome page (photos, favorite and times, provider, steps, where, proof)
//   opened { tenantId, code }          → counts a link being opened (a number per month; nothing about the person)
//   circle { tenantId } · circle_join { tenantId, name, phone, handle?, why? } · creator { tenantId, code } → the Circle's public page,
//                                        asking to join, a creator's page (lib/circle-server)
//   optin { token, on }                → a member chooses to be shown on the Circle page (first name, last initial)
//   terms { tenantId }                 → the program terms, in plain words
//   mine { token }                     → the visit-link card: their link, credit and friends (the visit link is the key)
//   gift { token, firstName, phone }   → Gift a friend: the text to send from their own phone (we never text the friend)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { publicInfo, welcomeFor, termsFor, mine, giftFriend, clientOfPreview, countOpen } from '@/lib/referrals-server';
import { limitPublic } from '@/lib/rate-limit';

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
    if (action === 'opened') { const tid = String(b.tenantId || '').slice(0, 120); const limited = await limitPublic(req, 'ref_open', tid, { perHour: 30, perDay: 2000 }); if (limited) return j({ ok: true });
      return j(await countOpen(db, tid, String(b.code || '').slice(0, 40))); }
    if (action === 'circle') { const { circlePublic } = await import('@/lib/circle-server'); return j(await circlePublic(db, String(b.tenantId || '').slice(0, 120))); }
    if (action === 'circle_join') { const tid = String(b.tenantId || '').slice(0, 120); const limited = await limitPublic(req, 'circle_join', tid, { perHour: 5, perDay: 200 }); if (limited) return limited;
      const { circleJoin } = await import('@/lib/circle-server'); return j(await circleJoin(db, tid, b)); }
    if (action === 'creator') { const { creatorPage } = await import('@/lib/circle-server'); return j(await creatorPage(db, String(b.tenantId || '').slice(0, 120), String(b.code || '').slice(0, 20))); }
    if (action === 'welcome') return j(await welcomeFor(db, String(b.tenantId || '').slice(0, 120), String(b.code || '').slice(0, 40)));
    if (action === 'terms') return j(await termsFor(db, String(b.tenantId || '').slice(0, 120)));
    // A manager previewing a client's wallet (Referrals → Try it yourself): a private token that lasts 2 hours.
    const pv = b.preview && b.tenantId ? await clientOfPreview(db, String(b.tenantId).slice(0, 120), String(b.preview)) : null;
    const v = pv ? { tenantId: String(b.tenantId).slice(0, 120), clientId: pv } : await fromVisit(db, String(b.token || '')); if (!v) return j({ ok: false, error: 'This link isn’t valid.' }, 404);
    if (action === 'mine') return j(await mine(db, v.tenantId, v.clientId));
    if (action === 'optin') { if (pv) return j({ ok: false, error: 'Only the client can choose this.' }, 403); const { setOptIn } = await import('@/lib/circle-server'); return j(await setOptIn(db, v.tenantId, v.clientId, b.on === true)); }
    if (action === 'gift') return j(await giftFriend(db, v.tenantId, v.clientId, { firstName: String(b.firstName || ''), phone: String(b.phone || '') }));
    return j({ ok: false, error: 'Unknown action.' }, 400);
  } catch (e: any) { console.error('[referrals/public]', e); return j({ ok: false, error: 'That didn’t work. Please try again.' }, 500); }
}
