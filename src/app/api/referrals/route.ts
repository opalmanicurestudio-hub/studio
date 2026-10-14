// src/app/api/referrals/route.ts — REFERRALS for the business (lib/referrals-server). Managers only.
//   overview                                   → tiles, top people who refer, waiting for a visit, needs a look
//   settings { referrals }                     → the program (and the friend's welcome offer as an approved discount)
//   decide { id, action: approve|decline|confirm, referrerPhone? } → the few that need a person
//   find { q } · preview { clientId } → try it yourself: a client's wallet (private link, 2 hours) and welcome link
//   give_now { id }                            → give a friend's credit now (their visit is paid; skips the day's wait)
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { referralOverview, setReferralSettings, decideReferral, findClients, previewFor, giveNow, sampleWelcome } from '@/lib/referrals-server';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120); if (!tenantId) return j({ ok: false, error: 'Missing details.' }, 400);
  const db = getAdminDb(); const w = await requestActor(db, req.headers.get('authorization'), tenantId); if (!w.ok) return j({ ok: false, error: w.error }, w.status);
  const a = w.actor; if (!(a.isManager || a.isOwner)) return j({ ok: false, error: 'Only managers can do this.' }, 403);
  try {
    const action = String(b.action || 'overview');
    if (action === 'overview') return j(await referralOverview(db, tenantId));
    if (action === 'settings') return j(await setReferralSettings(db, tenantId, b.referrals || {}, { id: a.staffId, name: a.name }));
    if (action === 'decide') return j(await decideReferral(db, tenantId, { id: String(b.id || ''), action: b.decision, referrerPhone: b.referrerPhone }, { id: a.staffId, name: a.name }));
    if (action === 'find') return j(await findClients(db, tenantId, String(b.q || '').slice(0, 60)));
    if (action === 'preview') return j(await previewFor(db, tenantId, String(b.clientId || '').slice(0, 120), { name: a.name }));
    if (action === 'sample') return j(await sampleWelcome(db, tenantId));
    if (action === 'give_now') return j(await giveNow(db, tenantId, String(b.id || ''), { name: a.name }));
    return j({ ok: false, error: 'Unknown action.' }, 400);
  } catch (e: any) { console.error('[referrals]', e); return j({ ok: false, error: 'That didn’t work. Please try again.' }, 500); }
}
