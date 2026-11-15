// src/lib/floor-word-server.ts — WHAT THE KITCHEN TELLS THE FLOOR, on the server (lib/floor-word has the rules). The 86
// list comes from the menu and tonight's counts (lib/dish-counts-server); the kitchen's message lives with tonight's
// counts (tenants/{id}/dishCounts/{day}.floorNote, written only here), so it's the night's and goes with it.
//   floorWordNow → the 86 list and the message, read at most every 15 seconds a business
//   setFloorNote → the kitchen tells the floor (every phone on the floor tonight buzzes once), or clears it
import { isMenuItem } from '@/lib/menu-server';
import { liveCounts } from '@/lib/dish-counts-server';
import { tonight } from '@/lib/night-close-server';
import { cleanNote, eightySixOf, noteNow, type FloorNote, type FloorWord } from '@/lib/floor-word';
import { jobDef, type JobId } from '@/lib/jobs';
import { LIVE } from '@/lib/shift-check';
import { PUSH_TIER } from '@/lib/push-tier';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const WORD_MS = 15000;
const cache = new Map<string, { at: number; v: FloorWord }>();
/** The kitchen changed something the floor reads (a sold-out, a count, its message): the next read is fresh. */
export function forgetWord(tenantId: string) { for (const k of Array.from(cache.keys())) if (k.startsWith(`${tenantId}|`)) cache.delete(k); }

const off = (s: any) => !s || s.isActive === false || s.status === 'archived' || s.archived === true || s.isRenter === true || s.role === 'renter';
/** The floor's jobs: who hears the kitchen's message. */
const FLOOR_JOBS: JobId[] = ['server', 'host', 'bartender', 'runner', 'busser', 'barback', 'shift_lead', 'manager'];

/** Tonight's 86 list and the kitchen's message. */
export async function floorWordNow(db: any, tenantId: string, tenant: any, o: { fresh?: boolean } = {}): Promise<FloorWord> {
  const day = tonight(tenant); const key = `${tenantId}|${day}`;
  const hit = cache.get(key); if (!o.fresh && hit && Date.now() - hit.at < WORD_MS) return hit.v;
  const T = `tenants/${tenantId}`;
  const [items, doc] = await Promise.all([
    db.collection(`${T}/inventory`).where('type', '==', 'refreshment').limit(400).get()
      .then((s: any) => s.docs.map((d: any) => ({ id: d.id, x: d.data() || {} })).filter((r: any) => isMenuItem(r.x))).catch(() => [] as { id: string; x: any }[]),
    db.doc(`${T}/dishCounts/${day}`).get().then((s: any) => s.data() || {}).catch(() => ({})),
  ]);
  const counts = items.length ? await liveCounts(db, tenantId, tenant, items).catch(() => ({ rows: [] as any[] })) : { rows: [] as any[] };
  const v: FloorWord = { eightySix: eightySixOf(items, counts.rows), note: noteNow(doc.floorNote) };
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), v });
  return v;
}

/** Who's on the floor tonight: the floor's jobs (those on tonight's schedule, when it has any of them). With nobody
 *  given a job yet, everyone on the team who isn't on the kitchen side by their title. */
export async function floorTeamTonight(db: any, T: string, day: string): Promise<string[]> {
  const staff = (await db.collection(`${T}/staff`).limit(400).get()).docs.filter((d: any) => ID.test(d.id) && !off(d.data()));
  let ids: string[] = staff.filter((d: any) => FLOOR_JOBS.includes(jobDef(d.data()?.job)?.id as JobId)).map((d: any) => d.id);
  if (!ids.length) ids = staff.filter((d: any) => !jobDef(d.data()?.job)?.id && !/cook|chef|kitchen|dish|prep|line/i.test(String(d.data()?.title || d.data()?.position || ''))).map((d: any) => d.id);
  if (!ids.length) return [];
  const shifts = await db.collection(`${T}/shifts`).where('date', '==', day).limit(300).get().catch(() => ({ docs: [] }));
  const on = new Set<string>(shifts.docs.map((d: any) => d.data() || {}).filter((x: any) => LIVE(x) && (!x.kind || x.kind === 'work') && x.status !== 'draft').map((x: any) => String(x.staffId || '')));
  return (ids.some((id) => on.has(id)) ? ids.filter((id) => on.has(id)) : ids).slice(0, 80);
}

/** The kitchen tells the floor (null clears it). Everyone on the floor tonight hears a new message once. */
export async function setFloorNote(db: any, tenantId: string, tenant: any, raw: unknown, by: string): Promise<{ ok: true; note: FloorNote | null; told: number } | { ok: false; error: string }> {
  const T = `tenants/${tenantId}`; const day = tonight(tenant); const ref = db.doc(`${T}/dishCounts/${day}`);
  const at = new Date().toISOString(); const who = String(by || 'The kitchen').slice(0, 40);
  if (raw === null) {
    await ref.set({ day, floorNote: { clearedAt: at, clearedBy: who } }, { merge: true });
    forgetWord(tenantId);
    return { ok: true, note: null, told: 0 };
  }
  const c = cleanNote(raw); if ('error' in c) return { ok: false, error: c.error };
  const note: FloorNote = { text: c.text, by: who, at };
  await ref.set({ day, floorNote: { ...note, clearedAt: null } }, { merge: true });
  forgetWord(tenantId);
  let told = 0;
  try {
    const ids = await floorTeamTonight(db, T, day);
    if (ids.length) {
      const b = db.batch();
      for (const userId of ids) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId, type: 'kitchen_note', message: `From the kitchen: ${c.text}`.slice(0, 300), link: '/tables', priority: 'high', read: false, createdAt: at }); }
      await b.commit(); told = ids.length;
      if (PUSH_TIER.kitchen_note === 'now') { const { pushNow } = await import('@/lib/push'); await pushNow(db, tenantId).catch(() => undefined); }
    }
  } catch { /* the message is up even if a buzz didn't go */ }
  return { ok: true, note, told };
}
