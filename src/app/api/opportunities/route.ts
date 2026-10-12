// src/app/api/opportunities/route.ts — OPPORTUNITIES (lib/opportunities, lib/opportunities-server).
// Anyone on the team: their own tasks, and acting on them. Managers: everything, handing out, settings, results.
//   list                                   → tasks (managers: all from the last 60 days; others: their own)
//   claim { id }                           → take an unassigned task
//   assign { id, staffId|null }            → (managers) hand it to someone (they get a bell)
//   reword { id }                          → the next approved wording
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
    return j(await actOnOpportunity(db, tenantId, a, b));
  } catch (e: any) { console.error('[opportunities]', e); return j({ ok: false, error: 'That didn’t work — try again.' }, 500); }
}
