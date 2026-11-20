// src/app/api/arrival/route.ts — THEY'RE HERE, for the team (lib/arrival-nudge; the server half is
// lib/arrival-nudge-server). Signed in (the app or the staff portal).
//   tell  { tenantId, appointmentId, via }  → right after the desk or the planner checks someone in: their provider is
//                                             nudged once, at once (the kiosk and the guest's own link do this themselves)
//   again { tenantId, appointmentId }       → the desk's Nudge again: no answer yet, at most once a minute
//   reply { tenantId, appointmentId, reply } → the provider (or a manager for them) answers: now, five, ten, send
// Renters, who run their own business here, don't nudge or answer for the shop's visits.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { isReply } from '@/lib/arrival-nudge';
import { nudgeProvider, replyToArrival } from '@/lib/arrival-nudge-server';

export const dynamic = 'force-dynamic';
const ID = /^[A-Za-z0-9_-]{1,200}$/;
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({}));
  const tenantId = String(b.tenantId || ''); const appointmentId = String(b.appointmentId || ''); const action = String(b.action || '');
  if (!ID.test(tenantId) || !ID.test(appointmentId)) return fail('Which visit?');
  const auth = await verifyStaffActor(req, tenantId);
  if (!auth.ok) return fail(auth.error, auth.status);
  const actor = auth.actor; const db = getAdminDb();
  if (actor.isRenter) return fail('Renters’ own guests are told in their own name.', 403);

  if (action === 'tell' || action === 'again') {
    const via = action === 'again' ? 'front desk' : String(b.via || '') === 'planner' ? 'planner' : 'front desk';
    const r = await nudgeProvider(db, tenantId, appointmentId, { via, by: actor.uid, again: action === 'again', tenant: auth.tenant });
    if (action === 'again' && !r.told) {
      const words: Record<string, string> = { answered: 'Their provider has already answered.', 'too soon': 'They were just nudged. Give it a minute.', 'not told': 'Their provider hasn’t been told yet. Check them in first.', started: 'This visit has already started.', 'not here': 'They aren’t checked in.', gone: 'This visit isn’t here any more.' };
      return fail(words[r.why || ''] || 'There’s nobody to nudge for this visit.', r.why === 'gone' ? 404 : 409);
    }
    return NextResponse.json({ ok: true, ...r });
  }
  if (action === 'reply') {
    if (!isReply(b.reply)) return fail('Choose an answer.');
    const r = await replyToArrival(db, tenantId, appointmentId, b.reply, actor);
    return r.ok ? NextResponse.json({ ok: true }) : fail(r.error, r.status);
  }
  return fail('Unknown action.');
}
