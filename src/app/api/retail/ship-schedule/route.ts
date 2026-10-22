import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { verifyStaffActor } from '@/lib/staff-auth';
import { MAX_BUSY, busyWithRoom, normalizeSchedule, scheduleFrom, type BusyPeriod } from '@/lib/ship-promise';
import { addDays, dayKey, tenantTimeZone } from '@/lib/tenant-time';

// ─── /api/retail/ship-schedule ───────────────────────────────────────────────
// Saves a change to the shop's shipping schedule (lib/ship-promise) for anyone who runs the shop: the owner, admins and
// managers, so a manager can add a busy period or act on a capacity suggestion without waiting for the owner. Each
// changed part is checked and tidied by the same reader every screen and route uses (normalizeSchedule) and saved on
// its own path, so a change here can't overwrite a different one made at the same time.
//   · Busy periods change one at a time (`busy`: add or replace one by its id, remove one, or end one now), against
//     the list as it's saved, so one never overwrites another, or one the capacity check added meanwhile. Ended ones
//     over a month old are cleared out as the list is saved, and a full list makes room by letting the one that
//     ended longest ago go (lib/ship-promise busyWithRoom); one that's on or still to come is never pushed out.
//   · Ending or removing an extra day the capacity check added stops it adding another today.
//   · The whole schedule comes back, tidied, so the screen shows exactly what was kept.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEYS = ['processingDays', 'shipDays', 'cutoff', 'cutoffByDay', 'pickups', 'carrierHolidays', 'closures', 'standardTransit', 'countdown', 'capacity', 'showDates'] as const;
type BusyOp = { op: 'upsert'; period: BusyPeriod } | { op: 'remove'; id: string } | { op: 'end'; id: string };

export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json().catch(() => ({}));
    const tenantId = String(body.tenantId || '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenantId)) return NextResponse.json({ error: 'Missing business.' }, { status: 400 });
    const patch: Record<string, any> = {};
    for (const k of KEYS) if (body.patch && Object.prototype.hasOwnProperty.call(body.patch, k)) patch[k] = body.patch[k];
    const op: BusyOp | null = body.busy && ['upsert', 'remove', 'end'].includes(body.busy.op) ? body.busy : null;
    if (!Object.keys(patch).length && !op) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

    const auth = await verifyStaffActor(req, tenantId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (!auth.actor.isManager) return NextResponse.json({ error: 'Only a manager can change the shipping schedule.' }, { status: 403 });

    const db = getAdminDb();
    const ref = db.doc(`tenants/${tenantId}`);
    const at = new Date().toISOString();
    const result = await db.runTransaction(async (tx: any) => {
      const tenant: any = (await tx.get(ref)).data() || {};
      const rs = tenant.retailSettings || {};
      const tz = tenantTimeZone(tenant);
      const today = dayKey(new Date(), tz);
      const cur = scheduleFrom(rs);
      const changed: Record<string, any> = { ...patch };
      if (op) {
        let list = cur.busy.filter((b) => b.to >= addDays(today, -31));
        const id = String(op.op === 'upsert' ? op.period?.id || '' : op.id || '');
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return { error: 'That busy period couldn’t be found. Open the schedule again.', status: 400 };
        const was = list.find((b) => b.id === id) || null;
        if (op.op === 'upsert') {
          const one = normalizeSchedule({ busy: [op.period] }).busy[0];
          if (!one || one.id !== id) return { error: 'Choose the days it starts and ends.', status: 400 };
          if (was) list = list.map((b) => (b.id === id ? one : b));
          else {
            // A new one: old ones that ended make way; if every one is on or still to come, it can't fit.
            const room = busyWithRoom(list, today);
            if (!room) return { error: `There’s room for ${MAX_BUSY} busy periods that are on or still to come. Remove one first.`, status: 400 };
            list = [...room, one];
          }
        } else {
          if (!was) return { error: 'That busy period couldn’t be found. Open the schedule again.', status: 404 };
          // Ended now: started before today, it ends yesterday (or when it already ended); started today or still to
          // come, it comes off.
          const yesterday = addDays(today, -1);
          list = op.op === 'end' && was.from < today ? list.map((b) => (b.id === id ? { ...b, to: b.to < yesterday ? b.to : yesterday } : b)) : list.filter((b) => b.id !== id);
          if (was.auto === 'more_time') changed.capacity = { ...cur.capacity, ...(changed.capacity || {}), pausedOn: today };
        }
        changed.busy = list;
      }
      const next = normalizeSchedule({ ...cur, ...changed, savedAt: at }, { shipProcessingHours: rs.shipProcessingHours });
      const clean = (v: any) => JSON.parse(JSON.stringify(v));
      // The first save writes the whole schedule (so what the shop saw, including what an old "ship within hours"
      // setting meant, is what's kept); after that each part goes on its own path.
      tx.update(ref, rs.shipSchedule && typeof rs.shipSchedule === 'object'
        ? { ...Object.fromEntries(Object.keys(changed).map((k) => [`retailSettings.shipSchedule.${k}`, clean((next as any)[k])])), 'retailSettings.shipSchedule.savedAt': at }
        : { 'retailSettings.shipSchedule': clean(next) });
      return { schedule: next };
    });
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, schedule: result.schedule });
  } catch (err: any) {
    console.error('[ship-schedule] failed:', err?.message);
    return NextResponse.json({ error: 'That didn’t save. Try again.' }, { status: 500 });
  }
}
