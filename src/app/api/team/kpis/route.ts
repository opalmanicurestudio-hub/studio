// src/app/api/team/kpis/route.ts — STAFF NUMBERS AND ONE-ON-ONES (lib/staff-kpis, lib/staff-kpis-server).
// Anyone on the team: their own numbers and their one-on-ones. Managers: the team's numbers, goals, and booking.
//   mine                                   → my numbers (last 30 days vs the 30 before), goals, my next one-on-one
//   team                                   → (managers) the team's numbers, each person's, suggested topics
//   goals { goals }                        → (managers) the business's goals
//   agenda { staffId }                     → (managers) a starting agenda: their numbers' topics + last time's next steps
//   book { staffId, startTime, minutes, agenda, staffCanAdd }  → (managers) on both schedules; tells them
//   list { staffId? }                      → one-on-ones (yours, or a team member's for managers)
//   topic { id, text }                     → add a topic (the person, if allowed, or the manager)
//   close { id, notes, nextSteps, cancel? } → (the manager) done with notes and next steps, or cancelled
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { requestActor } from '@/lib/request-actor';
import { myNumbers, teamNumbers, saveGoals, startingAgenda, bookOneOnOne, oneOnOnesFor, addTopic, closeOneOnOne } from '@/lib/staff-kpis-server';

export const dynamic = 'force-dynamic';
const j = (b: any, status = 200) => NextResponse.json(b, { status });

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || '').slice(0, 120); if (!tenantId) return j({ ok: false, error: 'Missing details.' }, 400);
  const db = getAdminDb(); const w = await requestActor(db, req.headers.get('authorization'), tenantId); if (!w.ok) return j({ ok: false, error: w.error }, w.status);
  const a = w.actor; const manager = !!(a.isOwner || a.isManager); const action = String(b.action || 'mine');
  const need = () => j({ ok: false, error: 'Managers only.' }, 403);
  let r: any;
  if (action === 'mine') r = a.staffId ? await myNumbers(db, tenantId, a.staffId) : { ok: false, error: 'Sign in as a team member.' };
  else if (action === 'team') { if (!manager) return need(); r = await teamNumbers(db, tenantId); }
  else if (action === 'goals') { if (!manager) return need(); r = await saveGoals(db, tenantId, b.goals || {}); }
  else if (action === 'agenda') { if (!manager) return need(); r = { ok: true, agenda: await startingAgenda(db, tenantId, String(b.staffId || '')) }; }
  else if (action === 'book') { if (!manager) return need(); r = await bookOneOnOne(db, tenantId, { staffId: a.staffId, name: a.name }, { staffId: String(b.staffId || ''), startTime: String(b.startTime || ''), minutes: b.minutes, agenda: b.agenda, staffCanAdd: b.staffCanAdd }); }
  else if (action === 'list') { const sid = manager && b.staffId ? String(b.staffId) : a.staffId; r = { ok: true, items: await oneOnOnesFor(db, tenantId, sid) }; }
  else if (action === 'topic') r = await addTopic(db, tenantId, { staffId: a.staffId, manager }, String(b.id || ''), String(b.text || ''));
  else if (action === 'close') r = await closeOneOnOne(db, tenantId, { staffId: a.staffId, manager }, String(b.id || ''), { notes: b.notes, nextSteps: Array.isArray(b.nextSteps) ? b.nextSteps : [], cancel: b.cancel === true });
  else r = { ok: false, error: 'Unknown action.' };
  return j(r, r.ok ? 200 : 409);
}
