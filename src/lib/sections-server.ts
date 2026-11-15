// src/lib/sections-server.ts — TONIGHT'S SECTIONS, ON THE SERVER (design canvas "Tonight's sections"; lib/sections,
// api/host/floor 'sections', 'section_tap', 'call_out', 'hand', 'usual'). Who looks after which tables tonight lives on
// each table of the open service (`units[].staffIds`), copied from the floor plan's usual sections when the night opens.
//   - who can take tables: the floor's people (a server, a bartender, a shift lead or a manager, or someone with no job
//     set), and anyone who already has a table tonight; whoever's on the schedule tonight first
//   - who can change them: a manager, the host stand (its tablet too), a shift lead or the front desk; a server hands
//     over their own table (or one nobody has)
//   - who hears: whoever is given a table that's seated now, with the party and where their meal is
//   - the usual sections: a manager keeps tonight's as the floor plan's, for the nights after
// Each change is one transaction on tonight's service, so two people moving tables at once can't undo each other.
import { applyMoves, callOut, handOver, movesWords, tapTable, type Move, type Person, type Unit } from '@/lib/sections';
import { jobDef, type JobId } from '@/lib/jobs';
import { LIVE } from '@/lib/shift-check';
import { PUSH_TIER } from '@/lib/push-tier';
import { readFloor } from '@/lib/floor-server';

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const TAKES_TABLES: JobId[] = ['server', 'bartender', 'shift_lead', 'manager'];
const off = (s: any) => !s || s.isActive === false || s.status === 'archived' || s.archived === true || s.isRenter === true || s.role === 'renter';
const first = (n: unknown) => String(n || '').trim().split(/\s+/)[0]?.slice(0, 40) || 'Someone';
const nameOf = (s: any) => String(s?.name || s?.displayName || [s?.firstName, s?.lastName].filter(Boolean).join(' ') || 'A team member').slice(0, 80);

export class SectionStop extends Error { constructor(msg: string, public status = 400) { super(msg); } }

/** Who can change tonight's sections: a manager, the host stand (its tablet too), a shift lead or the front desk. */
export function runsFloor(actor: any): boolean {
  if (!actor || actor.isRenter) return false;
  return !!actor.isTenantOwner || !!actor.isManager || actor.screen === true || ['owner', 'admin', 'manager', 'shift_lead', 'front_desk'].includes(String(actor.role || '').toLowerCase());
}

/** Tonight's open service (the newest open one), or null. */
async function openSession(db: any, T: string): Promise<any | null> {
  const snap = await db.collection(`${T}/serviceSessions`).where('status', '==', 'open').limit(20).get();
  const all = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).sort((a: any, b: any) => String(b.opensAt || '').localeCompare(String(a.opensAt || '')));
  return all[0] || null;
}

const unitsOf = (s: any): (Unit & { x?: number | null; y?: number | null })[] => (Array.isArray(s?.units) ? s.units : [])
  .filter((u: any) => u && ID.test(String(u.id)))
  .map((u: any) => ({ ...u, id: String(u.id), name: String(u.name || u.id), staffIds: (Array.isArray(u.staffIds) ? u.staffIds : []).map(String).filter((x: string) => ID.test(x)) }));

const takesTables = (s: any, holding: Set<string>, id: string) => !off(s) && (holding.has(id) || !jobDef(s?.job)?.id || TAKES_TABLES.includes(jobDef(s?.job)!.id as JobId));
type FloorPerson = Person & { on: boolean; job: string | null };
const PEOPLE_MS = 45000;
const peopleCache = new Map<string, { at: number; v: FloorPerson[] }>();

/** The floor's people tonight: who can take tables, with whether they're on the schedule tonight. Read at most every
 *  45 seconds a business and night (a business with more than 400 team records, or 60 floor people, shows the first). */
export async function floorPeople(db: any, T: string, session: any): Promise<FloorPerson[]> {
  const key = `${T}|${session?.id || ''}|${unitsOf(session).flatMap((u) => u.staffIds).sort().join(',')}`;
  const hit = peopleCache.get(key); if (hit && Date.now() - hit.at < PEOPLE_MS) return hit.v;
  const v = await readPeople(db, T, session);
  if (peopleCache.size > 200) peopleCache.clear();
  peopleCache.set(key, { at: Date.now(), v });
  return v;
}
async function readPeople(db: any, T: string, session: any): Promise<FloorPerson[]> {
  const holding = new Set(unitsOf(session).flatMap((u) => u.staffIds));
  const [staffSnap, shiftSnap] = await Promise.all([
    db.collection(`${T}/staff`).limit(400).get(),
    session?.businessDay ? db.collection(`${T}/shifts`).where('date', '==', String(session.businessDay)).limit(300).get().catch(() => ({ docs: [] })) : Promise.resolve({ docs: [] }),
  ]);
  const on = new Set<string>(shiftSnap.docs.map((d: any) => d.data() || {}).filter((x: any) => LIVE(x) && (!x.kind || x.kind === 'work') && x.status !== 'draft').map((x: any) => String(x.staffId || '')));
  const out: FloorPerson[] = [];
  for (const d of staffSnap.docs) {
    const s: any = d.data() || {}; if (!ID.test(d.id) || !takesTables(s, holding, d.id)) continue;
    const job = jobDef(s.job)?.id || null;
    out.push({ id: d.id, name: nameOf(s), on: on.has(d.id), job });
  }
  const rank = (p: { on: boolean; job: string | null }) => (p.on ? 0 : 2) + (p.job === 'server' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 60);
}

/** Tonight's sections as the host stand's chart shows them. */
export async function sectionsNow(db: any, T: string) {
  const session = await openSession(db, T);
  if (!session) return { session: null, units: [], people: [] };
  const seatedSnap = await db.collection(`${T}/parties`).where('sessionId', '==', session.id).where('status', '==', 'seated').limit(200).get();
  const seated = new Set<string>(seatedSnap.docs.flatMap((d: any) => (Array.isArray(d.data()?.unitIds) ? d.data().unitIds : []).map(String)));
  const people = await floorPeople(db, T, session);
  return {
    session: session.id,
    units: unitsOf(session).map((u) => ({ id: u.id, name: u.name, staffIds: u.staffIds, seated: seated.has(u.id), x: typeof u.x === 'number' ? u.x : null, y: typeof u.y === 'number' ? u.y : null })),
    people: people.map((p) => ({ id: p.id, name: p.name, on: p.on })),
  };
}

/** One change to tonight's sections, in one transaction: the moves `plan` works out from the tables as they are now. */
async function change(db: any, T: string, plan: (units: Unit[]) => Move[]): Promise<{ moves: Move[]; units: Unit[] }> {
  const session = await openSession(db, T);
  if (!session) throw new SectionStop('Tonight’s floor isn’t open yet.', 409);
  const ref = db.doc(`${T}/serviceSessions/${session.id}`);
  return db.runTransaction(async (tx: any) => {
    const s: any = (await tx.get(ref)).data();
    if (!s || s.status !== 'open') throw new SectionStop('Tonight’s floor has closed.', 409);
    const raw: any[] = Array.isArray(s.units) ? s.units : [];
    const moves = plan(unitsOf(s)).filter((m) => m.from.slice().sort().join() !== m.to.slice().sort().join());
    if (!moves.length) return { moves, units: unitsOf(s) };
    const next = applyMoves(raw.map((u: any) => ({ ...u, id: String(u?.id), staffIds: Array.isArray(u?.staffIds) ? u.staffIds : [] })), moves);
    tx.update(ref, { units: next, sectionsChangedAt: new Date().toISOString() });
    return { moves, units: unitsOf({ units: next }) };
  });
}

/** Whoever was given a table that's seated now hears it: the table, who it came from, the party and where their meal is.
 *  Whoever lost one is told quietly where it went (not the person who moved it, nor someone who called out). Once a person a party. Only reads the
 *  floor when a seated table changed hands. Never throws. */
export async function tellGiven(db: any, tenantId: string, tenant: any, moves: Move[], quiet: (string | null)[] = []): Promise<number> {
  try {
    const T = `tenants/${tenantId}`;
    const changes = moves.map((m) => ({ m, gained: m.to.filter((s) => !m.from.includes(s)), lost: m.from.filter((s) => !m.to.includes(s)) })).filter((x) => x.gained.length || x.lost.length);
    if (!changes.length) return 0;
    const open = await openSession(db, T); if (!open) return 0;
    const seatedSnap = await db.collection(`${T}/parties`).where('sessionId', '==', open.id).where('status', '==', 'seated').limit(200).get();
    const seatedUnits = new Set<string>(seatedSnap.docs.flatMap((d: any) => (Array.isArray(d.data()?.unitIds) ? d.data().unitIds : []).map(String)));
    const live = changes.filter((x) => seatedUnits.has(x.m.unitId)); if (!live.length) return 0;
    const read = await readFloor(db, T, tenant, { fresh: true });
    const ids = Array.from(new Set(live.flatMap((x) => [...x.gained, ...x.lost])));
    const docs = await db.getAll(...ids.map((id) => db.doc(`${T}/staff/${id}`)));
    const staff = new Map<string, any>(docs.filter((d: any) => d.exists).map((d: any) => [d.id, d.data() || {}]));
    const name = (id: string) => first(nameOf(staff.get(id)));
    const items: { userId: string; type: string; message: string }[] = []; const sent = new Set<string>();
    for (const { m, gained, lost } of live) {
      const t = read.seated.find((x) => x.unitIds.includes(m.unitId)); if (!t) continue;
      const from = lost.length ? `, from ${lost.map(name).join(' and ')}` : '';
      const stage = t.row?.stage?.words ? `, ${String(t.row.stage.words).replace(/\.$/, '').toLowerCase()}` : '';
      for (const s of gained) {
        const k = `${t.partyId}|${s}|in`; if (sent.has(k)) continue; sent.add(k);
        items.push({ userId: s, type: 'table_given', message: `${t.nt.table} is yours now${from}. Party of ${Math.max(1, Number(t.row?.party?.size) || 1)}${stage}.` });
      }
      for (const s of lost) {
        const k = `${t.partyId}|${s}|out`; if (quiet.includes(s) || sent.has(k)) continue; sent.add(k);
        items.push({ userId: s, type: 'table_moved', message: `${t.nt.table} went to ${m.to.length ? m.to.map(name).join(' and ') : 'nobody for now'}.` });
      }
    }
    const keep = items.filter((x) => staff.has(x.userId) && !off(staff.get(x.userId))); if (!keep.length) return 0;
    const now = new Date().toISOString(); const b = db.batch();
    for (const x of keep) { const r = db.collection(`${T}/notifications`).doc(); b.set(r, { id: r.id, userId: x.userId, type: x.type, message: x.message.slice(0, 300), link: '/tables', priority: x.type === 'table_given' ? 'high' : 'normal', read: false, createdAt: now }); }
    await b.commit();
    if (keep.some((x) => PUSH_TIER[x.type] === 'now')) { const { pushNow } = await import('@/lib/push'); await pushNow(db, tenantId).catch(() => undefined); }
    return keep.filter((x) => x.type === 'table_given').length;
  } catch { return 0; }
}

/** One person on the floor's team (one read), with their name. */
async function onTeam(db: any, T: string, session: any, id: string, what = 'That person isn’t on the floor’s team.'): Promise<Person> {
  if (!ID.test(id)) throw new SectionStop(what, 404);
  const s: any = (await db.doc(`${T}/staff/${id}`).get()).data();
  if (!s || !takesTables(s, new Set(unitsOf(session).flatMap((u) => u.staffIds)), id)) throw new SectionStop(what, 404);
  return { id, name: nameOf(s) };
}

/** A tap on the chart: the table is theirs now, or back to nobody if it was theirs alone. */
export async function sectionTap(db: any, T: string, unitId: string, staffId: string) {
  const session = await openSession(db, T); if (!session) throw new SectionStop('Tonight’s floor isn’t open yet.', 409);
  if (!ID.test(unitId)) throw new SectionStop('Which table?');
  await onTeam(db, T, session, staffId);
  const r = await change(db, T, (units) => { if (!units.some((u) => u.id === unitId)) throw new SectionStop('That table isn’t on tonight’s floor.', 404); const m = tapTable(units, unitId, staffId); return m ? [m] : []; });
  return { ...r, staffIds: r.units.find((u) => u.id === unitId)?.staffIds || [] };
}

/** Someone called out: their tables to one person, or shared out to whoever's on tonight with the fewest. */
export async function sectionCallOut(db: any, T: string, outId: string, to: string) {
  const session = await openSession(db, T); if (!session) throw new SectionStop('Tonight’s floor isn’t open yet.', 409);
  if (!ID.test(outId)) throw new SectionStop('Who called out?');
  if (to === outId) throw new SectionStop('Pick someone else to take their tables.');
  const listed = await floorPeople(db, T, session);
  const people: Person[] = to !== 'share' && !listed.some((p) => p.id === to) ? [...listed, await onTeam(db, T, session, to)] : listed;
  const onTonight = listed.filter((p) => p.on && p.id !== outId);
  const pool = (onTonight.length ? onTonight : listed.filter((p) => p.id !== outId)).map((p) => ({ id: p.id, name: p.name }));
  if (to === 'share' && !pool.length) throw new SectionStop('There’s nobody else on the floor’s team to share them with.', 409);
  const seatedSnap = await db.collection(`${T}/parties`).where('sessionId', '==', session.id).where('status', '==', 'seated').limit(200).get();
  const seated: string[] = seatedSnap.docs.flatMap((d: any) => (Array.isArray(d.data()?.unitIds) ? d.data().unitIds : []).map(String));
  const r = await change(db, T, (units) => callOut(units, outId, pool, to === 'share' ? 'share' : to, seated));
  return { ...r, people, words: movesWords(r.moves, r.units, people) };
}

/** A seated table handed to someone: theirs alone now. Its own server (or anyone, when nobody has it) or whoever runs
 *  the floor. */
export async function handTable(db: any, T: string, actor: any, partyId: string, to: string) {
  if (!ID.test(partyId)) throw new SectionStop('Which table?');
  const session = await openSession(db, T); if (!session) throw new SectionStop('Tonight’s floor isn’t open yet.', 409);
  const target = await onTeam(db, T, session, to);
  const p: any = (await db.doc(`${T}/parties/${partyId}`).get()).data();
  if (!p || p.status !== 'seated' || String(p.sessionId || '') !== session.id) throw new SectionStop('That table isn’t seated any more.', 404);
  const unitIds: string[] = (Array.isArray(p.unitIds) ? p.unitIds : []).map(String).filter((x: string) => ID.test(x));
  if (!unitIds.length) throw new SectionStop('That party isn’t at a table on tonight’s floor.', 409);
  const me = String(actor?.uid || ''); const boss = runsFloor(actor);
  // Someone who doesn't run the floor hands over what's theirs (and, at a table nobody has, only if they're on the
  // floor's team): at a party across tables, only the tables they have or nobody has.
  if (!boss && !(await onTeam(db, T, session, me, 'Only the table’s own server, or the host, can hand it over.').catch(() => null))) throw new SectionStop('Only the table’s own server, or the host, can hand it over.', 403);
  const r = await change(db, T, (units) => {
    const theirs = units.filter((u) => unitIds.includes(u.id));
    const mine = boss ? theirs : theirs.filter((u) => !u.staffIds.length || u.staffIds.includes(me));
    if (!boss && !mine.some((u) => u.staffIds.includes(me)) && theirs.some((u) => u.staffIds.length)) throw new SectionStop('Only the table’s own server, or the host, can hand it over.', 403);
    return handOver(units, mine.map((u) => u.id), to);
  });
  return { ...r, people: [target] };
}

/** A manager keeps tonight's sections as the floor plan's usual ones, for the nights after. How many tables it set. */
export async function keepAsUsual(db: any, T: string) {
  const open = await openSession(db, T); if (!open) throw new SectionStop('Tonight’s floor isn’t open yet.', 409);
  const sRef = db.doc(`${T}/serviceSessions/${open.id}`); const ref = db.doc(`${T}/floorPlans/default`);
  return db.runTransaction(async (tx: any) => {
    const session: any = (await tx.get(sRef)).data(); const plan: any = (await tx.get(ref)).data();
    if (!session || session.status !== 'open') throw new SectionStop('Tonight’s floor has closed.', 409);
    const tonight = new Map(unitsOf(session).map((u) => [u.id, u.staffIds]));
    const base: any[] = Array.isArray(plan?.units) && plan.units.length ? plan.units : (Array.isArray(session.units) ? session.units : []);
    let n = 0, nobody = 0;
    const units = base.map((u: any) => { const ids = tonight.get(String(u?.id)); if (!ids) return u; n++; if (!ids.length) nobody++; return { ...u, staffIds: ids }; });
    tx.set(ref, { id: 'default', units, updatedAt: new Date().toISOString(), ...(plan ? {} : { source: 'sections' }) }, { merge: true });
    return { tables: n, nobody };
  });
}
