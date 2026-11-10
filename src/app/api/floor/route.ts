// src/app/api/floor/route.ts — THE FLOOR BOARD (app/floor/[tenantId]), through the server. Like the kitchen screen, a
// floor tablet has nobody signed in: it's set up once by a manager (api/kitchen 'pair', the same screens) and carries its
// own key; a PIN (api/kitchen 'pin') puts a name on what's done. A team member signed in on their own device can use it
// with no key, under their own name.
//   board    { tenantId, key, staffPass? }  → tonight's event (the one running, or today's next), its tables and seats,
//                                             who's at each seat (name, arrived, meal, allergies), what the seats have
//                                             asked for (open, and done in the last 90 minutes), food ready to run for
//                                             the event, the team's names, and the tables this person looks after
//   request  { tenantId, key, staffPass?, id, step: 'ack'|'done'|'backup'|'unbackup' } → one request moved along, once
//   mytables { tenantId, key, staffPass, eventId, tableIds } → the tables this person looks after tonight
//   arrive   { tenantId, key, staffPass?, guestId, here: boolean } → a guest marked here (or not)
// A paused or closed business has its floor board closed too.
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limitPublic } from '@/lib/rate-limit';
import { accessLockOf } from '@/lib/tenant-access';
import { eventToday } from '@/lib/studio-page';
import { hasTimeZone, tenantTimeZone, wallParts } from '@/lib/tenant-time';
import { ticketFrom } from '@/lib/kitchen';
import { offTeam, screenOf, teamInstead, workingNow } from '@/lib/screen-keys';
import { resolveSeat } from '@/lib/hosting';

export const dynamic = 'force-dynamic';

const ok = (b: any = {}) => NextResponse.json({ ok: true, ...b }, { headers: { 'Cache-Control': 'no-store' } });
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const clean = (v: any, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const STEPS = ['ack', 'done', 'backup', 'unbackup'] as const;
const DONE_SHOWN_MS = 90 * 60000;
const LATE_MIN = 5;   // the same point lib/hosting escalates at

const REQUESTS_FROM_MS = 36 * 3600000;   // a request left open longer than this is from another day: not tonight's
const SHARED_MS = 3000;                   // tablets polling together share one read of the guest list and team

/** Tonight's event: one running today (or that started yesterday and runs past midnight); otherwise today's event that
 *  has started most recently, or the next one to start. An event left "running" from days ago doesn't count. */
async function tonight(db: any, T: string, tenant: any, now: Date) {
  const today = eventToday(tenant, now);
  const yesterday = eventToday(tenant, new Date(now.getTime() - 86400000));
  const w = wallParts(now, hasTimeZone(tenant) ? tenantTimeZone(tenant) : 'Pacific/Honolulu');
  const hm = `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
  const live = (e: any) => !['cancelled', 'canceled', 'completed'].includes(String(e.status || ''));
  const running = (await db.collection(`${T}/studioEvents`).where('status', '==', 'active').limit(10).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  // Yesterday's counts only while it's still running past midnight (it ends after it starts, on the clock), or before 6 in
  // the morning when it has no end time: an event nobody marked finished doesn't keep the board.
  const overnight = (e: any) => e.date === yesterday && (e.endTime ? String(e.endTime) < String(e.time || '00:00') && hm < String(e.endTime) : hm < '06:00');
  const run = running.find((e: any) => e.date === today) || running.find(overnight) || null;
  if (run) return run;
  const todays = (await db.collection(`${T}/studioEvents`).where('date', '==', today).get()).docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
    .filter(live).sort((a: any, b: any) => String(a.time || '').localeCompare(String(b.time || '')));
  const started = todays.filter((e: any) => String(e.time || '00:00') <= hm && (!e.endTime || String(e.endTime) > hm || String(e.endTime) < String(e.time || '')));
  return started[started.length - 1] || todays.find((e: any) => String(e.time || '00:00') > hm) || todays[todays.length - 1] || null;
}

// The guest list and team, shared by tablets asking within a few seconds of each other (what's asked for, and food
// ready to run, is always read fresh). A change made through this route clears it here.
const shared = new Map<string, { at: number; guests: any[]; team: any[] }>();
const clearShared = (tenantId: string) => { for (const k of Array.from(shared.keys())) if (k.startsWith(`${tenantId}|`)) shared.delete(k); };

type FloorTable = { id: string; name: string; x: number | null; y: number | null; seats: { id: string; label: string }[]; staffIds: string[]; chartStaffIds: string[] };
const tablesOf = (ev: any): FloorTable[] => (Array.isArray(ev?.seatingTables) ? ev.seatingTables : []).filter((t: any) => t && t.id).map((t: any) => ({
  id: clean(t.id, 80), name: clean(t.name, 40) || 'Table', x: Number.isFinite(Number(t.x)) && t.x !== null ? Number(t.x) : null, y: Number.isFinite(Number(t.y)) && t.y !== null ? Number(t.y) : null,
  seats: (Array.isArray(t.seats) ? t.seats : []).filter((s: any) => s && s.id).map((s: any) => ({ id: clean(s.id, 80), label: clean(s.label, 12) })),
  staffIds: (Array.isArray(t.staffIds) ? t.staffIds : []).map((x: any) => clean(x, 80)).filter(Boolean) as string[],
  chartStaffIds: (Array.isArray(t.staffIds) ? t.staffIds : []).map((x: any) => clean(x, 80)).filter(Boolean) as string[],
}));

const allergyOf = (a: any) => (typeof a === 'string' ? { label: clean(a, 40), severe: false } : { label: clean(a?.label || a?.name || a?.id, 40), severe: a?.severity === 'critical' || a?.severity === 'severe' || a?.severe === true });

export async function POST(req: NextRequest) {
  try {
    const b: any = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId || ''); if (!ID.test(tenantId)) return bad('Which business?');
    const action = String(b.action || '');
    if (!['board', 'request', 'mytables', 'arrive'].includes(action)) return bad('Unknown action.');
    const db = getAdminDb(); const T = `tenants/${tenantId}`;

    // A set-up screen, or a team member signed in on their own device.
    let screen: any = await screenOf(db, tenantId, b.key);
    let member: { id: string; name: string } | null = null;
    if (!screen && !b.key) {
      const t: any = await teamInstead(req, db, tenantId);
      if (t.deny) return t.deny;
      if (t.renter) return bad('This is for the business’s own team.', 403);
      member = t.member; screen = { ref: null, name: member!.name, passes: {} };
    }
    if (!screen) {
      const slow = await limitPublic(req, 'kitchen_key', tenantId, { perHour: 60, perDay: 2000 }); if (slow) return slow;
      return bad('This screen isn’t set up, or was stopped. A manager can set it up again here.', 401);
    }
    const tenant: any = (await db.doc(T).get()).data() || {};
    if (accessLockOf(tenant).locked) return NextResponse.json({ ok: false, closed: true, error: 'The floor board is closed for now. The business owner can tell you more.' }, { status: 403 });
    const staff = member || (b.staffPass ? await workingNow(db, tenantId, screen, b.staffPass) : null);
    const staffOk = b.staffPass && !member ? !!staff : undefined;
    const by = staff?.name || screen.name;
    const now = new Date(); const nowIso = now.toISOString();

    if (action === 'board') {
      const ev: any = await tonight(db, T, tenant, now);
      const since = new Date(now.getTime() - REQUESTS_FROM_MS).toISOString();
      const doneSince = now.getTime() - DONE_SHOWN_MS;
      const key = `${tenantId}|${ev?.id || '-'}`; const hit = shared.get(key);
      const fresh = hit && now.getTime() - hit.at < SHARED_MS ? hit : null;
      const [reqSnap, staffSnap, guestSnap, readySnap, assignSnap] = await Promise.all([
        db.collection(`${T}/floorRequests`).where('createdAt', '>=', since).get(),
        fresh ? null : db.collection(`${T}/staff`).get(),
        fresh || !ev ? null : db.collection(`${T}/eventGuests`).where('eventId', '==', ev.id).get(),
        ev ? db.collection(`${T}/kdsTickets`).where('eventId', '==', ev.id).where('status', '==', 'ready').get() : Promise.resolve({ docs: [] as any[] }),
        ev ? db.collection(`${T}/studioEvents/${ev.id}/staffAssignments`).get() : Promise.resolve({ docs: [] as any[] }),
      ]);
      // Who looks after each table: the seating chart's own, and whoever picked it tonight.
      const tables = tablesOf(ev);
      const picked = new Map<string, string[]>();
      for (const d of assignSnap.docs) { const ids = d.data()?.tableIds; if (Array.isArray(ids)) picked.set(d.id, ids.map(String)); }
      for (const t of tables) for (const [sid, ids] of Array.from(picked)) if (ids.includes(t.id) && !t.staffIds.includes(sid)) t.staffIds.push(sid);
      const where = (x: { tableId?: any; tableNumber?: any }) => resolveSeat({ id: '', tableId: x.tableId || null, tableNumber: x.tableNumber || null }, tables).tableId;
      const ownersOf = (tableId: string | null) => (tableId ? (tables.find((t) => t.id === tableId)?.staffIds || []).filter((id) => onTeam.has(id)) : []);
      const list = fresh || {
        at: now.getTime(),
        team: (staffSnap?.docs || []).map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((s: any) => !offTeam(s) && s.role !== 'renter')
          .map((s: any) => ({ id: s.id, name: clean(s.name || s.displayName, 60) || 'Team member' })),
        guests: (guestSnap?.docs || []).map((d: any) => { const g: any = d.data() || {}; return {
          id: d.id, name: clean(g.name, 80) || 'Guest', tableNumber: g.tableNumber || null, tableIdRaw: g.tableId || null, seat: clean(g.seatNumber, 12) || null, here: g.checkedIn === true,
          meal: clean(g.mealChoiceName, 60) || null, allergies: (Array.isArray(g.allergies) ? g.allergies : []).map(allergyOf).filter((a: any) => a.label), note: clean(g.allergyNote, 160) || null,
        }; }),
      };
      if (!fresh) { shared.set(key, list); if (shared.size > 200) shared.delete(shared.keys().next().value as string); }
      const onTeam = new Set<string>(list.team.map((x: any) => x.id));
      const requests = reqSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
        .filter((r: any) => (r.status === 'new' || r.status === 'acknowledged' || (r.status === 'done' && Date.parse(String(r.resolvedAt || '')) >= doneSince)))
        .filter((r: any) => !ev || !r.eventId || r.eventId === ev.id)
        .map((r: any) => {
          const tableId = where(r); const waited = Math.max(0, Math.floor((now.getTime() - Date.parse(String(r.createdAt || nowIso))) / 60000)) || 0;
          const open = r.status !== 'done';
          // Needs someone now: flagged by the host, waited too long, or at a table nobody looks after.
          const urgent = open && (r.escalated === true || (r.status === 'new' && waited >= LATE_MIN) || (r.status === 'new' && !!tableId && ownersOf(tableId).length === 0));
          return {
            id: r.id, status: r.status, type: clean(r.requestType || r.type, 40) || null, label: clean(r.label || r.requestType || r.type, 60) || 'Help', note: clean(r.requestText || '', 160) || null,
            tableId, table: clean(r.tableNumber, 40) || null, seat: clean(r.seatNumber || r.seatLabel, 12) || null,
            guest: clean(r.guestName, 80) || null, allergies: (Array.isArray(r.guestAllergies) ? r.guestAllergies : []).map(allergyOf).filter((a: any) => a.label),
            createdAt: String(r.createdAt || ''), acknowledgedAt: r.acknowledgedAt || null, by: clean(r.claimedByName || r.acknowledgedBy, 60) || null,
            resolvedAt: r.resolvedAt || null, resolvedBy: clean(r.resolvedBy, 60) || null, needsBackup: r.needsBackup === true, escalated: r.escalated === true, urgent,
          };
        })
        // Open before done; then flagged by the host, then anyone who needs a hand getting about, then what's urgent, then oldest.
        .sort((a: any, b2: any) => Number(a.status === 'done') - Number(b2.status === 'done') || Number(b2.escalated) - Number(a.escalated)
          || Number(b2.type === 'accessibility') - Number(a.type === 'accessibility') || Number(b2.urgent) - Number(a.urgent) || String(a.createdAt).localeCompare(String(b2.createdAt)));
      const guests = list.guests.map(({ tableNumber, tableIdRaw, ...g }: any) => ({ ...g, tableId: where({ tableId: tableIdRaw, tableNumber }), table: clean(tableNumber, 40) || null }));
      const ready = readySnap.docs.map((d: any) => ticketFrom({ ...d.data(), id: d.id }, 'kdsTickets'))
        .map((t: any) => ({ ...t, tableId: where(t) }))
        .sort((a: any, b2: any) => String(a.readyAt || a.at).localeCompare(String(b2.readyAt || b2.at)));
      const mine: string[] = staff?.id ? tables.filter((t) => t.staffIds.includes(staff.id)).map((t) => t.id) : [];
      const said = clean(ev?.broadcastMessage, 280);
      return ok({
        screen: screen.name, business: { name: clean(tenant.name || tenant.businessName, 80) || 'Floor' }, staff, staffOk, signedIn: !!member,
        event: ev ? { id: ev.id, title: clean(ev.title || ev.name, 120) || 'Tonight', date: ev.date || null, time: clean(ev.time, 5) || null, running: ev.status === 'active',
          message: said && !ev.broadcastDismissed ? { text: said, at: String(ev.broadcastSentAt?.toDate?.()?.toISOString?.() || ev.broadcastSentAt || '') } : null } : null,
        tables, guests, requests, ready, team: list.team, mine, now: nowIso,
      });
    }

    if (action === 'request') {
      const id = String(b.id || ''); const step = String(b.step || '') as typeof STEPS[number];
      if (!ID.test(id) || !STEPS.includes(step)) return bad('That isn’t a request.');
      const ref = db.doc(`${T}/floorRequests/${id}`);
      const r: any = await db.runTransaction(async (tx: any) => {
        const cur: any = (await tx.get(ref)).data(); if (!cur) return { error: 'That request is gone.', status: 404 };
        if (step === 'ack') { if (cur.status !== 'new') return { already: true, who: cur.status === 'done' ? null : clean(cur.claimedByName || cur.acknowledgedBy, 60) || null, done: cur.status === 'done' }; tx.set(ref, { status: 'acknowledged', acknowledgedAt: nowIso, acknowledgedBy: by, claimedBy: staff?.id || null, claimedByName: by, claimedAt: nowIso }, { merge: true }); }
        else if (step === 'done') {
          if (cur.status === 'done') return { already: true };
          const wait = Math.max(0, Math.round((now.getTime() - Date.parse(String(cur.createdAt || nowIso))) / 1000));
          tx.set(ref, { status: 'done', resolvedAt: nowIso, resolvedBy: by, waitSeconds: Number.isFinite(wait) ? wait : null, ...(cur.claimedByName ? {} : { claimedBy: staff?.id || null, claimedByName: by }) }, { merge: true });
        } else { if (cur.status === 'done') return { error: 'That request is already done.', status: 409 }; tx.set(ref, { needsBackup: step === 'backup', ...(step === 'backup' ? { backupAskedBy: by, backupAskedAt: nowIso } : {}) }, { merge: true }); }
        return { ok: true };
      });
      if (r.error) return bad(r.error, r.status);
      return ok({ already: !!r.already, who: r.who || null, done: !!r.done, staffOk });
    }

    if (action === 'mytables') {
      if (!staff?.id || !ID.test(staff.id)) return bad('Enter your PIN first, so these are yours.', 403);
      const eventId = String(b.eventId || ''); if (!ID.test(eventId)) return bad('Which event?');
      const ev: any = (await db.doc(`${T}/studioEvents/${eventId}`).get()).data();
      if (!ev) return bad('That event is gone.', 404);
      const real = new Set(tablesOf(ev).map((t) => t.id));
      const tableIds = Array.from(new Set((Array.isArray(b.tableIds) ? b.tableIds : []).map((x: any) => clean(x, 80)))).filter((x: any) => real.has(x)).slice(0, 60);
      await db.doc(`${T}/studioEvents/${eventId}/staffAssignments/${staff.id}`).set({ tableIds, staffId: staff.id, staffName: staff.name, updatedAt: nowIso }, { merge: true });
      return ok({ mine: tableIds, staffOk });
    }

    // arrive
    const guestId = String(b.guestId || ''); if (!ID.test(guestId)) return bad('Which guest?');
    const gRef = db.doc(`${T}/eventGuests/${guestId}`); const g: any = (await gRef.get()).data();
    if (!g) return bad('That guest isn’t on the list.', 404);
    const ev: any = await tonight(db, T, tenant, now);
    if (!ev || g.eventId !== ev.id) return bad('That guest isn’t on tonight’s list.', 409);
    const here = b.here === true;
    await gRef.set({ checkedIn: here, checkedInAt: here ? nowIso : null, checkedInBy: here ? by : null }, { merge: true });
    clearShared(tenantId);
    return ok({ here, staffOk });
  } catch (e: any) {
    console.error('[floor] failed', e?.message || e);
    return bad('That didn’t go through. Try again.', 500);
  }
}
