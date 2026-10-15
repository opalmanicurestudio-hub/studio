// src/app/api/opportunities/route.ts — OPPORTUNITIES (lib/opportunities, lib/opportunities-server).
// Anyone on the team: their own tasks, and acting on them. Managers: everything, handing out, settings, results.
//   list                                   → tasks (managers: all from the last 60 days; others: their own)
//   claim { id }                           → take an unassigned task
//   assign { id, staffId|null }            → (managers) hand it to someone (they get a bell)
//   reword { id }                          → the next approved wording
//   times { id }                           → two real open times (their usual service, provider and day) and today’s price
//   send_times { id, startIsos[] }         → text one or two of those times
//   send_link { id }                       → text a booking link (their service and provider, tagged with the task)
//   book { id, startIso, staffId?, deposit? } → book it through the booking service; closes the task as booked
//   waitlist { id, note? }                 → add them to the waitlist; closes the task
//   card_link { id }                       → text their secure add-your-card link (a payment that didn't go through)
//   note_next { id }                       → a line on their next booked visit (a membership that would save them money)
//   text { id }                            → send the message — consent, the 30-day limit and texting hours checked
//   outcome { id, outcome, note?, channel? } → what happened; makes the follow-up, opens a case, or opts them out
//   dismiss { id }                         → (managers) not worth doing
//   create { title, clientId?, staffId?, dueAt?, why?, message?, valueCents?, priority? } → (managers) a task by hand
//   settings { settings }                  → (managers) finders on/off, per-person limit, the left-alone group
//   run                                    → (managers) run the finders now
//   results                                → (managers) the last 30 days
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { listOpportunities, actOnOpportunity } from '@/lib/opportunities-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120); if (!tenantId) return j({ ok: false, error: 'Missing details.' }, 400);
  const db = getAdminDb(); const w = await requestActor(db, req.headers.get('authorization'), tenantId); if (!w.ok) return j({ ok: false, error: w.error }, w.status);
  const a = w.actor; if (a.role === 'renter') return j({ ok: false, error: 'Your clients’ follow-ups are in your own portal.' }, 403);
  try {
    if (String(b.action || 'list') === 'list') return j(await listOpportunities(db, tenantId, a));
    // Booking from a task goes through the booking service like the client screen does (a signed call on this server).
    const internal = async (path: string, body: any) => { const secret = process.env.CRON_SECRET; if (!secret) return { ok: false, error: 'Booking from a task isn’t set up yet.' };
      return fetch(`${req.nextUrl.origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cf-internal': secret }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: 'We couldn’t reach the booking service.' })); };
    const post = (path: string, body: any) => fetch(`${req.nextUrl.origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false }));
    return j(await actOnOpportunity(db, tenantId, a, b, Date.now(), { internal, post, origin: req.nextUrl.origin }));
  } catch (e: any) { console.error('[opportunities]', e); return j({ ok: false, error: 'That didn’t work — try again.' }, 500); }
}
