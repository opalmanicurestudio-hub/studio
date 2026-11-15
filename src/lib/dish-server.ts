// src/lib/dish-server.ts — THE DISH PIT, read and kept on the server (lib/dish has the rules; api/back is the way in).
//   dishFor        → what the dish screen shows: the plates and glasses heading its way, the tables being cleared now,
//                    tonight's rush, the machine check (due or not, today's readings) and today's breakage
//   rushFor        → tonight's rush in words (the barback's screen shows it too)
//   recentTickets  → the last hour and a half's tickets, shared with the barback's screen
//   recordMachine  → a machine reading, kept for the inspector; one outside the limits needs what was done, and the
//                    owner and managers hear at once
//   recordBreak    → something broken, with who and when
//   machineLog     → the last 30 days of readings, to print
// Readings live in tenants/{id}/machineChecks and breakage in tenants/{id}/breakage, by the business's own day (lib/
// night-close-server tonight: a night that runs past midnight is still that night).
import { checkDue, cleanBreak, cleanReading, dishSettingsOf, limitWords, plateFlow, readingOk, readingUnit, readingWord, rushWords, type MachineCheck } from '@/lib/dish';
import { ticketFrom } from '@/lib/kitchen';
import { stationsOf } from '@/lib/table-service';
import { addDays, tonight } from '@/lib/night-close-server';
import { tellManagers } from '@/lib/tell-managers';

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export class DishStop extends Error { constructor(public msg: string, public status = 400) { super(msg); } }

/** The business's bar station, if it has one (its drinks come back as glasses). */
export const barOf = (tenant: any) => stationsOf(tenant).find((s) => s.trim().toLowerCase() === 'bar') || null;

const checkOf = (id: string, d: any): MachineCheck => ({ id, at: String(d.at || ''), value: Number(d.value) || 0, unit: String(d.unit || ''), ok: d.ok === true, note: d.note ? clip(d.note, 200) : null, by: clip(d.by, 60) || 'Someone' });

/** Today's readings, oldest first. */
async function todaysChecks(db: any, T: string, day: string): Promise<MachineCheck[]> {
  const snap = await db.collection(`${T}/machineChecks`).where('day', '==', day).limit(50).get();
  return snap.docs.map((d: any) => checkOf(d.id, d.data() || {})).sort((a: MachineCheck, b: MachineCheck) => a.at.localeCompare(b.at));
}

// Every dish screen reads every few seconds: the heavy part (the tickets, the tables being cleared, tonight's rush) is
// worked out once for a business every few seconds and shared, and the rush once every 10 minutes. The machine check and
// breakage are read fresh, so a reading just taken shows at once.
const KEEP_MS = 12000, RUSH_MS = 10 * 60000;
const kept = new Map<string, { at: number; p: Promise<any> }>();
function keep<V>(m: Map<string, { at: number; p: Promise<any> }>, k: string, ms: number, make: () => Promise<V>): Promise<V> {
  const hit = m.get(k); if (hit && Date.now() - hit.at < ms) return hit.p;
  const p = make(); m.set(k, { at: Date.now(), p }); p.catch(() => m.delete(k));
  if (m.size > 500) for (const [kk, v] of Array.from(m)) if (Date.now() - v.at > RUSH_MS) m.delete(kk);
  return p;
}
/** Tonight's rush in words, from the guests expected each hour (lib/briefing). */
export const rushFor = (db: any, T: string, tenant: any, day: string): Promise<string | null> => keep(kept, `${T}|rush|${day}`, RUSH_MS, () =>
  import('@/lib/briefing-server').then((m) => m.briefingFor(db, T, tenant, null, { id: '', name: '' })).then((b: any) => rushWords(b?.guests?.byHour || [])).catch(() => null));

/** The kitchen's and the lounge's tickets from the last hour and a half (every plate or drink that went out in the last
 *  hour), shared by the dish and barback screens. `capped`: a list hit its limit or didn't load, so counts from it may be
 *  short. */
const TICKET_LIMIT = 1500;
export const recentTickets = (db: any, T: string) => keep(kept, `${T}|tickets`, KEEP_MS, async () => {
  const since = new Date(Date.now() - 90 * 60000).toISOString();
  // A list that didn't load counts as cut short too: counts from it aren't known, not zero.
  const failed = { docs: [] as any[], failed: true };
  const [kt, lt]: any[] = await Promise.all([
    db.collection(`${T}/kdsTickets`).where('createdAt', '>=', since).limit(TICKET_LIMIT).get().catch(() => failed),
    db.collection(`${T}/refreshmentRequests`).where('requestedAt', '>=', since).limit(TICKET_LIMIT).get().catch(() => failed),
  ]);
  return { capped: !!kt.failed || !!lt.failed || kt.docs.length >= TICKET_LIMIT || lt.docs.length >= TICKET_LIMIT,
    tickets: [...kt.docs.map((d: any) => ticketFrom({ id: d.id, ...d.data() }, 'kdsTickets')), ...lt.docs.map((d: any) => ticketFrom({ id: d.id, ...d.data() }, 'refreshmentRequests'))] };
});

/** The plates and glasses that went out in the last hour, and the tables being cleared now. */
const busyFor = (db: any, T: string, tenant: any) => keep(kept, `${T}|busy`, KEEP_MS, async () => {
  const [{ tickets }, clearing] = await Promise.all([
    recentTickets(db, T),
    import('@/lib/table-reset-server').then((m) => m.clearingFor(db, T, tenant)).catch(() => null),
  ]);
  return { flow: plateFlow(tickets, barOf(tenant), Date.now()), clearing: (clearing?.toClear || []).slice(0, 8).map((c: any) => ({ table: clip(c.table, 40), size: Number(c.size) || 0, minutes: Number(c.minutes) || 0 })) };
});

export async function dishFor(db: any, T: string, tenant: any, now = Date.now()) {
  const day = tonight(tenant, new Date(now)); const s = dishSettingsOf(tenant);
  const [busy, checks, broken, rush] = await Promise.all([
    busyFor(db, T, tenant),
    todaysChecks(db, T, day),
    db.collection(`${T}/breakage`).where('day', '==', day).limit(200).get(),
    rushFor(db, T, tenant, day),
  ]);
  const due = checkDue(s, checks, now);
  return {
    day,
    flow: busy.flow,
    clearing: busy.clearing,
    rush,
    machine: { on: s.on, machine: s.machine, word: readingWord(s), unit: readingUnit(s), limit: limitWords(s), min: s.machine === 'hot' ? s.minF : s.ppmMin, max: s.machine === 'hot' ? null : s.ppmMax, everyHours: s.everyHours, due: due.due, nextAt: due.nextAt, last: due.last, today: checks },
    broken: broken.docs.map((d: any) => { const x = d.data() || {}; return { id: d.id, kind: String(x.kind || 'other'), count: Number(x.count) || 0, note: x.note ? clip(x.note, 60) : null, by: clip(x.by, 60), at: String(x.at || '') }; })
      .sort((a: any, b: any) => a.at.localeCompare(b.at)),
  };
}

/** A machine reading. Outside the limits it needs a few words on what was done, and the owner and managers hear. */
export async function recordMachine(db: any, tenantId: string, tenant: any, input: { value: unknown; note: unknown }, by: string): Promise<MachineCheck> {
  const T = `tenants/${tenantId}`; const s = dishSettingsOf(tenant);
  if (!s.on) throw new DishStop('Machine checks are off for this business. A manager can turn them on in Settings, Closing the night.', 409);
  const value = cleanReading(s, input.value);
  if (value === null) throw new DishStop(s.machine === 'hot' ? 'Type the temperature the gauge shows, in °F.' : 'Type the strength the test strip shows, in ppm.');
  const ok = readingOk(s, value); const note = clip(input.note, 200) || null;
  if (!ok && !note) throw new DishStop(`That’s outside ${limitWords(s)}. Say what you did about it (ran it again, called for service, washing by hand).`, 422);
  const now = new Date(); const ref = db.collection(`${T}/machineChecks`).doc();
  const doc = { id: ref.id, day: tonight(tenant, now), at: now.toISOString(), machine: s.machine, value, unit: readingUnit(s), ok, limit: limitWords(s), note, by: clip(by, 60) || 'Someone' };
  await ref.set(doc);
  if (!ok) await tellManagers(db, tenantId, tenant, { type: 'dish_machine_out', priority: 'high', link: `/dish/${tenantId}`,
    message: `Dish machine: ${readingWord(s).toLowerCase()} ${value}${readingUnit(s) === '°F' ? '°F' : ' ppm'}, outside ${limitWords(s)} (${doc.by}). What was done: ${note}` });
  return checkOf(ref.id, doc);
}

/** Something broken, kept with who and when. */
export async function recordBreak(db: any, T: string, tenant: any, input: any, by: string) {
  const b = cleanBreak(input); if ('error' in b) throw new DishStop(b.error);
  const now = new Date(); const ref = db.collection(`${T}/breakage`).doc();
  await ref.set({ id: ref.id, day: tonight(tenant, now), at: now.toISOString(), kind: b.kind, count: b.count, note: b.note, by: clip(by, 60) || 'Someone' });
  return { id: ref.id };
}

/** The last 30 days of readings, newest first, for printing. */
export async function machineLog(db: any, T: string, tenant: any) {
  const day = tonight(tenant); const from = addDays(day, -29);
  const snap = await db.collection(`${T}/machineChecks`).where('day', '>=', from).limit(600).get();
  return snap.docs.map((d: any) => ({ ...checkOf(d.id, d.data() || {}), day: String(d.data()?.day || ''), limit: clip(d.data()?.limit, 40) }))
    .sort((a: any, b: any) => b.at.localeCompare(a.at));
}
